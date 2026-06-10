import { create } from 'zustand';
import { callModel, parseAIResponse } from '../engine/aiClient';
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
  function commit(parsed: AIResponse, applied: { state: unknown; events: GameEvent[] }, note?: string) {
    const { game, pending, autoPlay } = get();
    if (!game || !pending) return;
    const events = [...get().events];
    if (note) events.push(makeEvent('system', note));
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
    if (!result && nextPending && autoPlay) {
      setTimeout(() => {
        if (get().autoPlay && get().status === 'awaiting-confirm') void get().advance();
      }, 900);
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
      set({
        config,
        game,
        gameState: state,
        events: [makeEvent('system', `比赛开始：《${game.name}》，祝各位蛐蛐武运昌隆！`)],
        pending: game.nextAction(state),
        status: 'awaiting-confirm',
        result: null,
        error: null,
        autoPlay: false,
      });
    },

    advance: async () => {
      const { game, gameState, pending, config, status } = get();
      if (!game || !pending || !config || status === 'calling' || status === 'finished') return;
      set({ status: 'calling', error: null });
      const actor = findActor(config, pending.actorId);

      try {
        if (actor.config.kind === 'bot') {
          await sleep(500);
          const parsed = pending.botAction();
          const applied = game.applyAction(gameState, pending.actorId, parsed.action, parsed.speech);
          if (applied.error) throw new Error(`测试机器人产生了非法动作：${applied.error}`);
          commit(parsed, applied);
          return;
        }

        let lastError = '';
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const text = await callModel(
              actor.config,
              buildMessages(game, pending, actor, config, get().events, lastError || undefined),
            );
            const parsed = parseAIResponse(text);
            const applied = game.applyAction(gameState, pending.actorId, parsed.action, parsed.speech);
            if (applied.error) {
              lastError = applied.error;
              continue;
            }
            commit(parsed, applied);
            return;
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
            // 网络/服务类错误直接中断重试循环，交给用户重试按钮
            if (lastError.includes('请求模型') || lastError.includes('HTTP')) throw e;
          }
        }
        // 三次输出仍不合法：由系统代为随机行动，保证比赛能进行下去
        const fallback = pending.botAction();
        const applied = game.applyAction(gameState, pending.actorId, fallback.action, fallback.speech);
        if (applied.error) throw new Error(`兜底动作也失败了：${applied.error}`);
        commit(fallback, applied, `${actor.name} 连续 3 次输出无效（${lastError}），本步由系统代为随机行动`);
      } catch (e) {
        set({
          status: 'awaiting-confirm',
          error: `${actor.name} 行动失败：${e instanceof Error ? e.message : String(e)}`,
          autoPlay: false,
        });
      }
    },

    setAutoPlay: (v) => {
      set({ autoPlay: v });
      if (v && get().status === 'awaiting-confirm') void get().advance();
    },

    exitMatch: () =>
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
      }),

    rematch: () => {
      const { config } = get();
      if (config) get().startMatch(config);
    },
  };
});
