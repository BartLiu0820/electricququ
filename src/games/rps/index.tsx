import type { GameDefinition, PendingAction } from '../types';
import type { GameEvent, Participant } from '../../types';
import { makeEvent } from '../../types';
import { RpsArena } from './RpsArena';

export type RpsMove = 'rock' | 'paper' | 'scissors';

export interface RpsState {
  players: { id: string; name: string }[];
  judgeId: string | null;
  totalRounds: number;
  round: number;
  phase: 'talk' | 'throw' | 'judge' | 'done';
  talkIdx: number;
  talks: { id: string; text: string }[];
  throws: Record<string, RpsMove>;
  scores: Record<string, number>;
  lastReveal: {
    round: number;
    throws: Record<string, RpsMove>;
    gains: Record<string, number>;
    text: string;
  } | null;
}

export const MOVE_LABEL: Record<RpsMove, string> = {
  rock: '✊ 石头',
  paper: '✋ 布',
  scissors: '✌️ 剪刀',
};
export const MOVE_EMOJI: Record<RpsMove, string> = { rock: '✊', paper: '✋', scissors: '✌️' };

function normalizeMove(raw: unknown): RpsMove | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (/rock|石头|拳头|✊/.test(s)) return 'rock';
  if (/paper|布|✋/.test(s)) return 'paper';
  if (/scissors|剪刀|剪子|✌/.test(s)) return 'scissors';
  return null;
}

/** a 对 b：1 胜 / 0 平 / -1 负 */
function beats(a: RpsMove, b: RpsMove): number {
  if (a === b) return 0;
  const win = (a === 'rock' && b === 'scissors') || (a === 'scissors' && b === 'paper') || (a === 'paper' && b === 'rock');
  return win ? 1 : -1;
}

function name(state: RpsState, id: string): string {
  return state.players.find((p) => p.id === id)?.name ?? id;
}

function scoreBoard(state: RpsState): string {
  return state.players.map((p) => `${p.name} ${state.scores[p.id]} 分`).join('，');
}

function advanceRound(state: RpsState): RpsState {
  if (state.round >= state.totalRounds) return { ...state, phase: 'done' };
  return { ...state, round: state.round + 1, phase: 'talk', talkIdx: 0, talks: [], throws: {} };
}

const TALK_BOTS = [
  '我已经看穿你的套路了，这局我必出石头……还是剪刀呢？',
  '心理战对我没用，我是随机的化身！',
  '上一局只是热身，这局让你见识真正的实力。',
  '我劝你出布，真的，信我。',
  '蛐蛐界的传说即将诞生。',
];
const JUDGE_BOTS = ['精彩的一回合！心理博弈暗流涌动。', '局势胶着，胜负仍未可知。', '好一场龙争虎斗！'];

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const rpsGame: GameDefinition<RpsState> = {
  id: 'rps',
  name: '石头剪子布·博弈版',
  description: '出拳前先进行一轮公开喊话博弈，再秘密出拳同时揭晓。多人时两两对战计分。',
  minPlayers: 2,
  maxPlayers: 4,
  judge: 'optional',
  rulesText: [
    '这是带喊话博弈的多局制石头剪子布：',
    '1. 比赛进行若干局，每局分两个阶段：先是“喊话阶段”，各玩家按座次轮流公开说一句话（可以恐吓、欺骗、试探或保持沉默）；然后是“出拳阶段”，所有玩家秘密选择 石头(rock)/剪刀(scissors)/布(paper)，全部选定后同时亮拳。',
    '2. 亮拳后两两比较：石头胜剪刀、剪刀胜布、布胜石头。每赢一名对手得 1 分，平局不得分。',
    '3. 所有局打完后总分最高者获胜（可能并列）。',
    '4. 喊话内容不构成任何约束——说要出石头完全可以出布，这正是博弈所在。',
  ].join('\n'),
  playerGoal: (playerName) =>
    `你是玩家「${playerName}」。利用喊话阶段进行心理博弈（虚张声势、诱导、读出对手的模式），在出拳阶段做出最优选择，争取总分第一。注意分析对手历史出拳与发言的规律。`,
  judgeGoal: '你是本场比赛的解说裁判。每局亮拳后，用一两句话犀利点评各玩家的心理博弈与出拳选择，活跃气氛。',

  setup: (players, judge, options) => {
    const totalRounds = Math.max(1, Math.min(15, Number(options.totalRounds) || 5));
    const order = shuffle(players); // 掷硬币：随机先后手座次
    return {
      players: order.map((p) => ({ id: p.id, name: p.name })),
      judgeId: judge?.id ?? null,
      totalRounds,
      round: 1,
      phase: 'talk',
      talkIdx: 0,
      talks: [],
      throws: {},
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      lastReveal: null,
    };
  },

  nextAction: (state): PendingAction | null => {
    if (state.phase === 'done') return null;
    const common = `当前比分：${scoreBoard(state)}。第 ${state.round} / ${state.totalRounds} 局。`;

    if (state.phase === 'talk') {
      const actor = state.players[state.talkIdx];
      const said = state.talks.map((t) => `${name(state, t.id)}：“${t.text}”`).join('\n');
      return {
        actorId: actor.id,
        phase: '喊话',
        instruction:
          '喊话阶段：请在 speech 字段里说一句话进行心理博弈（也可以不说话）。action 固定为 {"type":"talk"}。',
        visibleState: `${common}\n本局已喊话：\n${said || '（你是第一个发言的）'}`,
        schemaHint: '{"type":"talk"}',
        botAction: () => ({ speech: randomOf(TALK_BOTS), action: { type: 'talk' } }),
      };
    }

    if (state.phase === 'throw') {
      const pendingIds = state.players.filter((p) => !(p.id in state.throws)).map((p) => p.id);
      const talks = state.talks.map((t) => `${name(state, t.id)}：“${t.text}”`).join('\n');
      return {
        actorId: pendingIds[0],
        simultaneous: pendingIds, // 全员一步同时出拳
        revealThinking: true, // 都决定完才揭幕，故出拳思考可展示
        phase: '同时出拳',
        instruction:
          '出拳阶段：所有玩家此刻同时秘密出拳，你看不到别人的选择，别人也看不到你的。请结合本局喊话综合判断后，秘密选择你的手势，move 取 "rock"（石头）/"paper"（布）/"scissors"（剪刀）之一。',
        visibleState: `${common}\n本局喊话记录：\n${talks || '（无人发言）'}\n（所有人此刻同时出拳，彼此选择互不可见）`,
        schemaHint: '{"type":"throw","move":"rock|paper|scissors"}',
        suppressSpeech: true,
        decisive: true,
        botAction: () => ({
          action: { type: 'throw', move: randomOf(['rock', 'paper', 'scissors'] as RpsMove[]) },
        }),
      };
    }

    // judge 点评
    return {
      actorId: state.judgeId!,
      phase: '裁判点评',
      instruction:
        '请在 speech 字段点评刚刚结束的这一局（各玩家的喊话与出拳、局势变化）。action 固定为 {"type":"comment"}。',
      visibleState: `${common}\n刚刚一局的结果：${state.lastReveal?.text ?? ''}`,
      schemaHint: '{"type":"comment"}',
      botAction: () => ({ speech: randomOf(JUDGE_BOTS), action: { type: 'comment' } }),
    };
  },

  applyAction: (state, actorId, action, speech) => {
    if (state.phase === 'talk') {
      const talks = [...state.talks, { id: actorId, text: speech ?? '（沉默）' }];
      const talkIdx = state.talkIdx + 1;
      const next: RpsState =
        talkIdx >= state.players.length
          ? { ...state, talks, talkIdx, phase: 'throw' }
          : { ...state, talks, talkIdx };
      const events: GameEvent[] = speech
        ? []
        : [makeEvent('action', `${name(state, actorId)} 选择保持沉默`)];
      return { state: next, events };
    }

    if (state.phase === 'throw') {
      const move = normalizeMove((action as { move?: unknown }).move);
      if (!move) {
        return { state, events: [], error: 'move 必须是 "rock"、"paper" 或 "scissors" 之一' };
      }
      const throws = { ...state.throws, [actorId]: move };
      const events: GameEvent[] = [makeEvent('action', `${name(state, actorId)} 已秘密出拳 🤫`)];

      if (Object.keys(throws).length < state.players.length) {
        return { state: { ...state, throws }, events };
      }

      // 全部出拳，亮拳计分
      const gains: Record<string, number> = Object.fromEntries(state.players.map((p) => [p.id, 0]));
      for (let i = 0; i < state.players.length; i++) {
        for (let j = i + 1; j < state.players.length; j++) {
          const a = state.players[i].id;
          const b = state.players[j].id;
          const r = beats(throws[a], throws[b]);
          if (r === 1) gains[a]++;
          else if (r === -1) gains[b]++;
        }
      }
      const scores = { ...state.scores };
      for (const id of Object.keys(gains)) scores[id] += gains[id];
      const revealText =
        state.players.map((p) => `${p.name} ${MOVE_LABEL[throws[p.id]]}`).join(' ｜ ') +
        ' ⇒ ' +
        (state.players.every((p) => gains[p.id] === 0)
          ? '本局平局'
          : state.players
              .filter((p) => gains[p.id] > 0)
              .map((p) => `${p.name} +${gains[p.id]} 分`)
              .join('，'));
      events.push(makeEvent('reveal', `第 ${state.round} 局亮拳：${revealText}`));

      let next: RpsState = {
        ...state,
        throws,
        scores,
        lastReveal: { round: state.round, throws, gains, text: revealText },
      };
      next = next.judgeId ? { ...next, phase: 'judge' } : advanceRound(next);
      return { state: next, events };
    }

    // judge comment
    return { state: advanceRound(state), events: [] };
  },

  result: (state) => {
    if (state.phase !== 'done') return null;
    const max = Math.max(...state.players.map((p) => state.scores[p.id]));
    const winners = state.players.filter((p) => state.scores[p.id] === max);
    return {
      winnerIds: winners.map((w) => w.id),
      summary:
        `${state.totalRounds} 局战罢，最终比分：${scoreBoard(state)}。` +
        (winners.length === state.players.length
          ? '势均力敌，平局收场！'
          : `${winners.map((w) => w.name).join('、')} 获胜！`),
      scores: state.scores,
    };
  },

  View: RpsArena,
};
