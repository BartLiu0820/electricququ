import { create } from 'zustand';
import { callModel, parseAIResponse, type ModelReply } from '../engine/aiClient';
import { buildMessages } from '../engine/prompts';
import { getGame } from '../games/registry';
import type { GameDefinition, PendingAction } from '../games/types';
import type { AIResponse, GameEvent, MatchConfig, MatchResult, Participant } from '../types';
import { makeEvent } from '../types';

export type MatchStatus = 'idle' | 'awaiting-confirm' | 'calling' | 'finished';

interface MatchStore {
  config: MatchConfig | null;
  game: GameDefinition<any> | null;
  gameState: unknown;
  events: GameEvent[];
  pending: PendingAction | null;
  status: MatchStatus;
  result: MatchResult | null;
  error: string | null;
  autoPlay: boolean;
  /** 正在思考的参赛者 id（status === 'calling' 时） */
  startMatch: (config: MatchConfig) => void;
  advance: () => Promise<void>;
  setAutoPlay: (v: boolean) => void;
  exitMatch: () => void;
  rematch: () => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findActor(config: MatchConfig, id: string): Participant {
  const p = config.players.find((x) => x.id === id) ?? (config.judge?.id === id ? config.judge : null);
  if (!p) throw new Error(`找不到参赛者 ${id}`);
  return p;
}

export const useMatch = create<MatchStore>((set, get) => {
  // 预取缓存：在 awaiting-confirm 阶段后台先算下一步各 API 行动者的响应，
  // 用户点「推进」时若已就绪即可秒出。键为 pending 引用，确保对应同一步。
  let prefetched: { pending: PendingAction; replies: Map<string, Promise<ModelReply>> } | null = null;

  function startPrefetch() {
    const { game, pending, config, status } = get();
    if (!game || !pending || !config || status !== 'awaiting-confirm') return;
    if (prefetched?.pending === pending) return; // 已在预取这一步
    const ids = pending.simultaneous ?? [pending.actorId];
    const replies = new Map<string, Promise<ModelReply>>();
    for (const id of ids) {
      const actor = findActor(config, id);
      if (actor.config.kind !== 'api') continue; // 测试机器人本就很快，无需预取
      const promise = callModel(actor.config, buildMessages(game, pending, actor, config, get().events));
      promise.catch(() => {}); // 预取失败不抛全局，留给真正 advance 时再走重试/报错
      replies.set(id, promise);
    }
    if (replies.size) prefetched = { pending, replies };
  }

  /** 构造一条思考事件：text 为小结（模型 thought 或截断的完整思考），detail 为完整思考 */
  function thinkingEvent(actorId: string, thought?: string, reasoning?: string): GameEvent | null {
    let text = thought;
    let detail = reasoning;
    if (!text && reasoning) {
      text = reasoning.length > 300 ? reasoning.slice(0, 300) + '……' : reasoning;
      detail = reasoning.length > 300 ? reasoning : undefined;
    }
    if (!text) return null;
    const ev = makeEvent('thinking', text, actorId);
    if (detail && detail !== text) ev.detail = detail;
    return ev;
  }

  function commit(
    parsed: AIResponse,
    applied: { state: unknown; events: GameEvent[] },
    note?: string,
    reasoning?: string,
  ) {
    const { game, pending, autoPlay } = get();
    if (!game || !pending) return;
    const events = [...get().events];
    if (note) events.push(makeEvent('system', note));
    // 思考过程：保密步骤默认不展示（会泄露选择），但 revealThinking 步骤例外。
    if (!pending.suppressSpeech || pending.revealThinking) {
      const ev = thinkingEvent(pending.actorId, parsed.thought, reasoning);
      if (ev) events.push(ev);
    }
    if (parsed.speech && !pending.suppressSpeech) {
      events.push(makeEvent('speech', parsed.speech, pending.actorId));
    }
    events.push(...applied.events);
    const result = game.result(applied.state);
    const nextPending = result ? null : game.nextAction(applied.state);
    set({
      gameState: applied.state,
      events,
      pending: nextPending,
      result,
      status: result ? 'finished' : 'awaiting-confirm',
      error: null,
    });
    if (!result && nextPending) {
      startPrefetch(); // 立即在后台预取下一步
      if (autoPlay) {
        setTimeout(() => {
          if (get().autoPlay && get().status === 'awaiting-confirm') void get().advance();
        }, 900);
      }
    }
  }

  return {
    config: null,
    game: null,
    gameState: null,
    events: [],
    pending: null,
    status: 'idle',
    result: null,
    error: null,
    autoPlay: false,

    startMatch: (config) => {
      const game = getGame(config.gameId);
      if (!game) {
        set({ error: `未找到游戏 ${config.gameId}` });
        return;
      }
      const state = game.setup(config.players, config.judge, config.options);
      const firstPending = game.nextAction(state);
      const events = [makeEvent('system', `比赛开始：《${game.name}》，祝各位蛐蛐武运昌隆！`)];
      if (firstPending) {
        const first = findActor(config, firstPending.actorId);
        events.push(makeEvent('system', `🪙 掷硬币决定先后手 —— 本局由「${first.name}」优先出手！`));
      }
      set({
        config,
        game,
        gameState: state,
        events,
        pending: firstPending,
        status: 'awaiting-confirm',
        result: null,
        error: null,
        autoPlay: false,
      });
      prefetched = null;
      startPrefetch(); // 第一步也提前预取
    },

    /** 取得单个行动者的合法响应（含预取复用、3 次重试、兜底随机）。校验针对 baseState（同时决策时各人相互独立）。 */
    // 注：定义为闭包内普通函数，便于 advance 复用
    advance: async () => {
      const { game, gameState, pending, config, status } = get();
      if (!game || !pending || !config || status === 'calling' || status === 'finished') return;
      set({ status: 'calling', error: null });

      // 取一个行动者的合法回复：bot 直接兜底；api 走预取/重试，3 次仍非法则随机兜底
      async function resolveActor(
        actorId: string,
      ): Promise<{ parsed: AIResponse; reasoning?: string; note?: string }> {
        const actor = findActor(config!, actorId);
        if (actor.config.kind === 'bot') {
          await sleep(400);
          return { parsed: pending!.botAction() };
        }
        const primed = prefetched?.pending === pending ? prefetched.replies.get(actorId) : undefined;
        let lastError = '';
        for (let attempt = 1; attempt <= 3; attempt++) {
          let reply: ModelReply;
          try {
            reply =
              attempt === 1 && primed
                ? await primed
                : await callModel(
                    actor.config,
                    buildMessages(game!, pending!, actor, config!, get().events, lastError || undefined),
                  );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.includes('请求模型') || msg.includes('HTTP')) throw e; // 网络/服务错误：上抛交重试按钮
            lastError = msg;
            continue;
          }
          try {
            const parsed = parseAIResponse(reply.content);
            const dry = game!.applyAction(gameState, actorId, parsed.action, parsed.speech);
            if (dry.error) {
              lastError = dry.error;
              continue;
            }
            return { parsed, reasoning: reply.reasoning };
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
          }
        }
        return {
          parsed: pending!.botAction(),
          note: `${actor.name} 连续 3 次输出无效（${lastError}），本步由系统代为随机行动`,
        };
      }

      try {
        const ids = pending.simultaneous ?? [pending.actorId];

        // ===== 单人步骤 =====
        if (ids.length === 1) {
          const { parsed, reasoning, note } = await resolveActor(ids[0]);
          prefetched = null;
          const applied = game.applyAction(gameState, ids[0], parsed.action, parsed.speech);
          if (applied.error) throw new Error(applied.error);
          commit(parsed, applied, note, reasoning);
          return;
        }

        // ===== 同时决策步骤（如石头剪子布出拳）：并行思考，顺序应用，最后一并揭幕 =====
        const resolved = await Promise.all(ids.map((id) => resolveActor(id)));
        prefetched = null;
        let st = gameState;
        const events = [...get().events];
        for (let k = 0; k < ids.length; k++) {
          const id = ids[k];
          const { parsed, reasoning, note } = resolved[k];
          if (note) events.push(makeEvent('system', note));
          if (pending.revealThinking) {
            const ev = thinkingEvent(id, parsed.thought, reasoning);
            if (ev) events.push(ev);
          }
          const applied = game.applyAction(st, id, parsed.action, parsed.speech);
          if (applied.error) throw new Error(`${findActor(config, id).name} 出手失败：${applied.error}`);
          st = applied.state;
          events.push(...applied.events);
        }
        const result = game.result(st);
        const nextPending = result ? null : game.nextAction(st);
        set({
          gameState: st,
          events,
          pending: nextPending,
          result,
          status: result ? 'finished' : 'awaiting-confirm',
          error: null,
        });
        if (!result && nextPending) {
          startPrefetch();
          if (get().autoPlay) {
            setTimeout(() => {
              if (get().autoPlay && get().status === 'awaiting-confirm') void get().advance();
            }, 900);
          }
        }
      } catch (e) {
        set({
          status: 'awaiting-confirm',
          error: `行动失败：${e instanceof Error ? e.message : String(e)}`,
          autoPlay: false,
        });
      }
    },

    setAutoPlay: (v) => {
      set({ autoPlay: v });
      if (v && get().status === 'awaiting-confirm') void get().advance();
    },

    exitMatch: () => {
      prefetched = null;
      set({
        config: null,
        game: null,
        gameState: null,
        events: [],
        pending: null,
        status: 'idle',
        result: null,
        error: null,
        autoPlay: false,
      });
    },

    rematch: () => {
      const { config } = get();
      if (config) get().startMatch(config);
    },
  };
});
