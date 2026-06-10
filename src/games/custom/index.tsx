import type { CustomGameSpec, GameDefinition, PendingAction } from '../types';
import type { GameEvent } from '../../types';
import { makeEvent } from '../../types';
import { GenericArena } from './GenericArena';

export interface CustomState {
  spec: CustomGameSpec;
  players: { id: string; name: string }[];
  judgeId: string;
  stage: 'init' | 'player' | 'judge' | 'done';
  narration: string;
  currentPlayerId: string | null;
  lastMove: { playerId: string; text: string } | null;
  turns: number;
  maxTurns: number;
  winnerIds: string[];
  summary: string;
}

function findPlayerByName(state: CustomState, nameRaw: unknown): string | null {
  const n = String(nameRaw ?? '').trim();
  if (!n) return null;
  const exact = state.players.find((p) => p.name === n || p.id === n);
  if (exact) return exact.id;
  const fuzzy = state.players.find((p) => p.name.includes(n) || n.includes(p.name));
  return fuzzy?.id ?? null;
}

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 把标准格式录入的自定义游戏包装成 GameDefinition：由裁判 AI 驱动整个流程 */
export function makeCustomGame(spec: CustomGameSpec): GameDefinition<CustomState> {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description || '自定义游戏（裁判 AI 主持）',
    minPlayers: spec.minPlayers,
    maxPlayers: spec.maxPlayers,
    judge: 'required',
    rulesText: [
      spec.rules,
      '',
      '【胜负判定】',
      spec.winCondition,
      '',
      '【主持方式】本游戏由裁判 AI 主持：裁判负责维护与叙述局面、指定行动顺序、裁决动作合法性并宣布胜负。玩家的行动以自然语言描述提交，由裁判裁决。',
    ].join('\n'),
    playerGoal: (playerName) =>
      `你是玩家「${playerName}」。${spec.playerGoal}\n请服从裁判的主持：每次轮到你时，根据裁判叙述的局面，用清晰、无歧义的自然语言描述你的行动。`,
    judgeGoal: [
      spec.judgeGoal || '公正、严格地按规则主持游戏。',
      '你的职责：1) 开局时初始化并叙述局面；2) 每名玩家行动后，裁决其是否合法（非法则要求重做），更新并完整叙述新局面（注意：所有玩家都能看到你的叙述，不要泄露应当保密的信息，保密信息只用模糊描述）；3) 指定下一个行动的玩家；4) 当满足胜负条件时宣布游戏结束、获胜者与总结。',
    ].join('\n'),

    setup: (players, judge) => ({
      spec,
      players: players.map((p) => ({ id: p.id, name: p.name })),
      judgeId: judge!.id,
      stage: 'init',
      narration: '',
      currentPlayerId: null,
      lastMove: null,
      turns: 0,
      maxTurns: 80,
      winnerIds: [],
      summary: '',
    }),

    nextAction: (state): PendingAction | null => {
      if (state.stage === 'done') return null;
      const playerNames = state.players.map((p) => p.name).join('、');

      if (state.stage === 'init') {
        return {
          actorId: state.judgeId,
          phase: '裁判开局',
          instruction: [
            `请根据规则初始化游戏（参赛玩家：${playerNames}）。在 narration 中完整叙述开局局面（所有人可见），并用 nextPlayer 指定第一个行动的玩家名。`,
            '如果规则需要随机要素（发牌、抽签等），由你来随机决定并记录。',
          ].join('\n'),
          visibleState: '（游戏尚未开始）',
          schemaHint: '{"type":"init","narration":"开局局面描述","nextPlayer":"玩家名"}',
          botAction: () => ({
            action: {
              type: 'init',
              narration: '（测试裁判）游戏开始，局面随机生成。',
              nextPlayer: randomOf(state.players).name,
            },
          }),
        };
      }

      if (state.stage === 'player') {
        const actor = state.players.find((p) => p.id === state.currentPlayerId)!;
        return {
          actorId: actor.id,
          phase: '玩家行动',
          instruction:
            '轮到你行动。在 action.move 中用自然语言清晰描述你的行动（将由裁判裁决）。speech 字段可用来公开喊话。',
          visibleState: `裁判叙述的当前局面：\n${state.narration}`,
          schemaHint: '{"type":"move","move":"你的行动描述"}',
          botAction: () => ({
            speech: '让我试试这一步。',
            action: { type: 'move', move: '（测试机器人）我做出一个合理的随机行动。' },
          }),
        };
      }

      // judge 裁决
      const mover = state.players.find((p) => p.id === state.lastMove?.playerId);
      return {
        actorId: state.judgeId,
        phase: '裁判裁决',
        instruction: [
          `玩家 ${mover?.name} 的行动：「${state.lastMove?.text}」`,
          '请裁决并推进游戏：',
          '- 在 narration 中叙述裁决结果与最新局面（若该行动非法，说明原因并视为浪费回合或要求性处理，由你按规则决定）；',
          '- 若游戏未结束：finished 为 false，并用 nextPlayer 指定下一个行动的玩家名；',
          `- 若已满足胜负条件或无法继续：finished 为 true，winners 列出获胜玩家名（平局可列多人，从 ${playerNames} 中选），summary 给出整场总结。`,
          `（当前已进行 ${state.turns} 个回合，上限 ${state.maxTurns} 回合，超限将强制平局。）`,
        ].join('\n'),
        visibleState: `此前的局面叙述：\n${state.narration}`,
        schemaHint:
          '{"type":"update","narration":"...","finished":false,"nextPlayer":"玩家名"} 或 {"type":"update","narration":"...","finished":true,"winners":["玩家名"],"summary":"..."}',
        botAction: () => {
          const finish = Math.random() < 0.12 || state.turns >= state.maxTurns - 1;
          return {
            action: finish
              ? {
                  type: 'update',
                  narration: '（测试裁判）游戏达到了结束条件。',
                  finished: true,
                  winners: [randomOf(state.players).name],
                  summary: '（测试裁判）随机判定的胜负结果。',
                }
              : {
                  type: 'update',
                  narration: '（测试裁判）行动有效，局面继续推进。',
                  finished: false,
                  nextPlayer: randomOf(state.players).name,
                },
          };
        },
      };
    },

    applyAction: (state, _actorId, action) => {
      const events: GameEvent[] = [];

      if (state.stage === 'init') {
        const narration = String(action.narration ?? '').trim();
        if (!narration) return { state, events: [], error: 'narration 不能为空' };
        const nextId = findPlayerByName(state, action.nextPlayer);
        if (!nextId) {
          return {
            state,
            events: [],
            error: `nextPlayer 必须是参赛玩家名之一：${state.players.map((p) => p.name).join('、')}`,
          };
        }
        events.push(makeEvent('judge', `开局：${narration}`));
        return { state: { ...state, stage: 'player', narration, currentPlayerId: nextId }, events };
      }

      if (state.stage === 'player') {
        const move = String(action.move ?? '').trim();
        if (!move) return { state, events: [], error: 'action.move 不能是空的，请描述你的行动' };
        events.push(
          makeEvent('action', `${state.players.find((p) => p.id === state.currentPlayerId)?.name} 行动：${move}`),
        );
        return {
          state: { ...state, stage: 'judge', lastMove: { playerId: state.currentPlayerId!, text: move } },
          events,
        };
      }

      // judge update
      const narration = String(action.narration ?? '').trim();
      if (!narration) return { state, events: [], error: 'narration 不能为空' };
      const turns = state.turns + 1;
      const forceEnd = turns >= state.maxTurns;
      const finished = Boolean(action.finished) || forceEnd;

      if (finished) {
        const winnersRaw = Array.isArray(action.winners) ? action.winners : [];
        const winnerIds = winnersRaw
          .map((w) => findPlayerByName(state, w))
          .filter((x): x is string => x !== null);
        const summary = String(action.summary ?? '').trim() || (forceEnd ? '达到回合上限，强制结束（平局）。' : narration);
        events.push(makeEvent('judge', narration));
        if (forceEnd && !Boolean(action.finished)) events.push(makeEvent('system', '已达回合上限，比赛强制结束'));
        return {
          state: {
            ...state,
            stage: 'done',
            narration,
            turns,
            winnerIds: winnerIds.length > 0 ? winnerIds : state.players.map((p) => p.id),
            summary,
          },
          events,
        };
      }

      const nextId = findPlayerByName(state, action.nextPlayer);
      if (!nextId) {
        return {
          state,
          events: [],
          error: `游戏未结束时必须用 nextPlayer 指定下一个行动的玩家（${state.players.map((p) => p.name).join('、')}）`,
        };
      }
      events.push(makeEvent('judge', narration));
      return {
        state: { ...state, stage: 'player', narration, turns, currentPlayerId: nextId, lastMove: null },
        events,
      };
    },

    result: (state) => {
      if (state.stage !== 'done') return null;
      const winners = state.players.filter((p) => state.winnerIds.includes(p.id));
      return {
        winnerIds: state.winnerIds,
        summary:
          winners.length === state.players.length
            ? `平局。${state.summary}`
            : `${winners.map((w) => w.name).join('、')} 获胜！${state.summary}`,
      };
    },

    View: GenericArena,
  };
}
