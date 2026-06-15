import { create } from 'zustand';
import { callModelStream, parseAIResponse, type ModelReply } from '../engine/aiClient';
import { buildMessages } from '../engine/prompts';
import { getGame } from '../games/registry';
import type { GameDefinition, PendingAction } from '../games/types';
import type { AIResponse, GameEvent, MatchConfig, MatchResult, Participant } from '../types';
import { makeEvent } from '../types';

export type MatchStatus = 'idle' | 'awaiting-confirm' | 'calling' | 'simulating' | 'finished';

/** 预模拟模式：每步骤的预计算快照，replay 时直接应用，无需等待 AI */
interface SimFrame {
  pending: PendingAction;
  actorReplies: { actorId: string; parsed: AIResponse; reasoning?: string; note?: string }[];
  gameStateAfter: unknown;
  eventsAfter: GameEvent[];
  result: MatchResult | null;
  nextPending: PendingAction | null;
}

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
  /** 流式思考瞬态：可流式步骤推进时实时展示的思维链（完成后清空，由正式 thinking 事件取代） */
  streamingThinking: { actorId: string; text: string } | null;
  /** 预模拟模式 */
  simulationMode: boolean;
  simulating: boolean;
  simProgress: { step: number; label: string } | null;
  simulatedSteps: SimFrame[] | null;
  replayIdx: number;

  startMatch: (config: MatchConfig, simMode?: boolean) => void;
  advance: () => Promise<void>;
  setAutoPlay: (v: boolean) => void;
  exitMatch: () => void;
  rematch: () => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
    if (pending.system) return; // 系统步骤无模型
    if (pending.streamThinking) return; // 可流式步骤推进时才开流，让用户从头看思考
    if (prefetched?.pending === pending) return;
    const ids = pending.simultaneous ?? [pending.actorId];
    const replies = new Map<string, Promise<ModelReply>>();
    for (const id of ids) {
      const actor = findActor(config, id);
      if (actor.config.kind !== 'api') continue;
      const promise = callModelStream(actor.config, buildMessages(game, pending, actor, config, get().events));
      promise.catch(() => {});
      replies.set(id, promise);
    }
    if (replies.size) prefetched = { pending, replies };
  }

  /** 构造一条思考事件：text 为小结（模型 thought 或截断的完整思考），detail 为完整思考 */
  function thinkingEvent(actorId: string, thought?: string, reasoning?: string): GameEvent | null {
    let text = thought;
    let detail = reasoning;
    if (!text && reasoning) {
      text = reasoning.length > 200 ? reasoning.slice(0, 200) + '……' : reasoning;
      detail = reasoning.length > 200 ? reasoning : undefined;
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
    // 思考过程：保密步骤默认不展示（会泄露选择），revealThinking 例外，hideThinking 则强制不展示。
    if ((!pending.suppressSpeech || pending.revealThinking) && !pending.hideThinking) {
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
      startPrefetch();
      if (autoPlay) {
        setTimeout(() => {
          if (get().autoPlay && get().status === 'awaiting-confirm') void get().advance();
        }, 900);
      }
    }
  }

  /**
   * 预模拟：在后台跑完整局，把所有步骤快照存入 simulatedSteps，
   * 完成后重置到初始状态，供用户逐步快进演绎。
   */
  async function runSimulation() {
    const { config, game, gameState: initialState, events: initEvents } = get();
    if (!config || !game) return;

    const frames: SimFrame[] = [];
    let st = initialState;
    let evs: GameEvent[] = [...initEvents];
    let stepNum = 0;

    try {
      while (true) {
        if (!get().simulating) break; // 用户中途退出
        const gameResult = game.result(st);
        if (gameResult) break;
        const pending = game.nextAction(st);
        if (!pending) break;

        stepNum++;
        set({ simProgress: { step: stepNum, label: pending.phase } });

        const actorReplies: SimFrame['actorReplies'] = [];

        if (pending.system) {
          actorReplies.push({ actorId: pending.actorId, parsed: pending.botAction() });
        } else {
          const ids = pending.simultaneous ?? [pending.actorId];
          const resolved = await Promise.all(
            ids.map(async (id): Promise<SimFrame['actorReplies'][number]> => {
              const actor = findActor(config, id);
              if (actor.config.kind === 'bot') {
                return { actorId: id, parsed: pending.botAction() };
              }
              const messages = buildMessages(game, pending, actor, config, evs);
              let lastError = '';
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  const reply = await callModelStream(actor.config, messages);
                  const parsed = parseAIResponse(reply.content);
                  const dry = game.applyAction(st, id, parsed.action, parsed.speech);
                  if (dry.error) { lastError = dry.error; continue; }
                  return { actorId: id, parsed, reasoning: reply.reasoning };
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  if (msg.includes('请求模型') || msg.includes('HTTP')) throw e;
                  lastError = msg;
                }
              }
              const actorName = findActor(config, id).name;
              return {
                actorId: id,
                parsed: pending.botAction(),
                note: `${actorName} 连续 3 次输出无效（${lastError}），本步由系统代为随机行动`,
              };
            }),
          );
          actorReplies.push(...resolved);
        }

        // 计算本步骤应用后的完整快照（与 commit/simultaneous 路径保持一致）
        const newEvs: GameEvent[] = [...evs];
        let curSt = st;

        if (pending.system) {
          const { parsed } = actorReplies[0];
          const applied = game.applyAction(curSt, pending.actorId, parsed.action, parsed.speech);
          if (applied.error) throw new Error(applied.error);
          curSt = applied.state;
          newEvs.push(...applied.events);
        } else if (actorReplies.length === 1) {
          const { actorId, parsed, reasoning, note } = actorReplies[0];
          if (note) newEvs.push(makeEvent('system', note));
          if ((!pending.suppressSpeech || pending.revealThinking) && !pending.hideThinking) {
            const ev = thinkingEvent(actorId, parsed.thought, reasoning);
            if (ev) newEvs.push(ev);
          }
          if (parsed.speech && !pending.suppressSpeech) {
            newEvs.push(makeEvent('speech', parsed.speech, actorId));
          }
          const applied = game.applyAction(curSt, actorId, parsed.action, parsed.speech);
          if (applied.error) throw new Error(`${findActor(config, actorId).name} 行动失败：${applied.error}`);
          curSt = applied.state;
          newEvs.push(...applied.events);
        } else {
          // 同时决策
          for (const { actorId, parsed, reasoning, note } of actorReplies) {
            if (note) newEvs.push(makeEvent('system', note));
            if (pending.revealThinking && !pending.hideThinking) {
              const ev = thinkingEvent(actorId, parsed.thought, reasoning);
              if (ev) newEvs.push(ev);
            }
            const applied = game.applyAction(curSt, actorId, parsed.action, parsed.speech);
            if (applied.error) throw new Error(`${findActor(config, actorId).name} 出手失败：${applied.error}`);
            curSt = applied.state;
            newEvs.push(...applied.events);
          }
        }

        const frameResult = game.result(curSt);
        const nextPending = frameResult ? null : game.nextAction(curSt);

        frames.push({
          pending,
          actorReplies,
          gameStateAfter: curSt,
          eventsAfter: newEvs,
          result: frameResult,
          nextPending,
        });

        st = curSt;
        evs = newEvs;
      }

      // 模拟完成：重置到初始状态，等待用户一步步快进演绎
      if (!get().simulating) return; // 中途退出，不更新状态
      set({
        simulating: false,
        simulatedSteps: frames,
        replayIdx: 0,
        gameState: initialState,
        events: initEvents,
        pending: game.nextAction(initialState),
        status: 'awaiting-confirm',
        result: null,
        simProgress: null,
        error: null,
      });
    } catch (e) {
      set({
        simulating: false,
        simProgress: null,
        status: 'awaiting-confirm',
        error: `模拟失败：${e instanceof Error ? e.message : String(e)}`,
      });
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
    streamingThinking: null,
    simulationMode: false,
    simulating: false,
    simProgress: null,
    simulatedSteps: null,
    replayIdx: 0,

    startMatch: (config, simMode = false) => {
      const game = getGame(config.gameId);
      if (!game) {
        set({ error: `未找到游戏 ${config.gameId}` });
        return;
      }
      const state = game.setup(config.players, config.judge, config.options);
      const firstPending = game.nextAction(state);
      const events = [makeEvent('system', `比赛开始：《${game.name}》，祝各位蛐蛐武运昌隆！`)];
      if (firstPending && !firstPending.system) {
        const first = findActor(config, firstPending.actorId);
        events.push(makeEvent('system', `🪙 掷硬币决定先后手 —— 本局由「${first.name}」优先出手！`));
      }
      set({
        config,
        game,
        gameState: state,
        events,
        pending: firstPending,
        status: simMode ? 'simulating' : 'awaiting-confirm',
        result: null,
        error: null,
        autoPlay: false,
        streamingThinking: null,
        simulationMode: simMode,
        simulating: simMode,
        simProgress: simMode ? { step: 0, label: '准备中…' } : null,
        simulatedSteps: null,
        replayIdx: 0,
      });
      prefetched = null;
      if (simMode) {
        void runSimulation();
      } else {
        startPrefetch();
      }
    },

    /** 推进一步：replay 模式直接应用预计算快照；实时模式走原有 AI 调用逻辑 */
    advance: async () => {
      const { game, gameState, pending, config, status, simulatedSteps, replayIdx, autoPlay } = get();
      if (!game || !pending || !config || status === 'calling' || status === 'finished' || status === 'simulating') return;

      // ===== 回放模式：直接应用预计算快照，无需等待 =====
      if (simulatedSteps) {
        const frame = simulatedSteps[replayIdx];
        if (!frame) return;
        set({
          gameState: frame.gameStateAfter,
          events: frame.eventsAfter,
          pending: frame.nextPending,
          result: frame.result,
          status: frame.result ? 'finished' : 'awaiting-confirm',
          replayIdx: replayIdx + 1,
          error: null,
        });
        if (!frame.result && frame.nextPending && get().autoPlay) {
          setTimeout(() => {
            if (get().autoPlay && get().status === 'awaiting-confirm') void get().advance();
          }, 200);
        }
        return;
      }

      // ===== 实时模式 =====
      set({ status: 'calling', error: null });

      // 立即消费并清空预取：失败时不会残留已 reject 的 promise，重试一定发起新请求
      const primedReplies = prefetched?.pending === pending ? prefetched.replies : null;
      prefetched = null;

      // 取一个行动者的合法回复：bot 直接兜底；api 走预取/重试，3 次仍非法则随机兜底。
      // 传入 onReasoning 时改用流式调用，实时回吐思维链。
      async function resolveActor(
        actorId: string,
        onReasoning?: (t: string) => void,
      ): Promise<{ parsed: AIResponse; reasoning?: string; note?: string }> {
        const actor = findActor(config!, actorId);
        if (actor.config.kind === 'bot') {
          await sleep(400);
          return { parsed: pending!.botAction() };
        }
        const primed = primedReplies?.get(actorId);
        let lastError = '';
        for (let attempt = 1; attempt <= 3; attempt++) {
          let reply: ModelReply;
          try {
            const messages = buildMessages(game!, pending!, actor, config!, get().events, lastError || undefined);
            // 一律走流式传输（onReasoning 仅在需实时展示的步骤传入；否则静默流式，仅为避免超时）
            reply =
              attempt === 1 && primed
                ? await primed
                : await callModelStream(actor.config, messages, onReasoning);
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
          note: `${findActor(config!, actorId).name} 连续 3 次输出无效（${lastError}），本步由系统代为随机行动`,
        };
      }

      try {
        // ===== 系统步骤（如「亮拳」揭晓）：无模型/机器人，直接应用动作 =====
        if (pending.system) {
          const parsed = pending.botAction();
          const applied = game.applyAction(gameState, pending.actorId, parsed.action, parsed.speech);
          if (applied.error) throw new Error(applied.error);
          commit(parsed, applied);
          return;
        }

        const ids = pending.simultaneous ?? [pending.actorId];

        // ===== 单人步骤 =====
        if (ids.length === 1) {
          const actorId = ids[0];
          // 可流式步骤且为真实模型：实时展示思维链
          const streamable = pending.streamThinking && findActor(config, actorId).config.kind === 'api';
          const onReasoning = streamable
            ? (t: string) => set({ streamingThinking: { actorId, text: t } })
            : undefined;
          if (streamable) set({ streamingThinking: { actorId, text: '' } });

          const { parsed, reasoning, note } = await resolveActor(actorId, onReasoning);
          prefetched = null;
          set({ streamingThinking: null });
          const applied = game.applyAction(gameState, actorId, parsed.action, parsed.speech);
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
          if (pending.revealThinking && !pending.hideThinking) {
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
          streamingThinking: null,
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
        streamingThinking: null,
        simulationMode: false,
        simulating: false,
        simProgress: null,
        simulatedSteps: null,
        replayIdx: 0,
      });
    },

    rematch: () => {
      const { config, simulationMode } = get();
      if (config) get().startMatch(config, simulationMode);
    },
  };
});
