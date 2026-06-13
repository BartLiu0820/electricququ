import type { GameDefinition, PendingAction } from '../types';
import type { GameEvent } from '../../types';
import { makeEvent } from '../../types';
import { CardTable } from './CardTable';

export interface Card {
  id: number;
  rank: string; // 'A','2'..'10','J','Q','K','JOKER'
  suit: string; // ♠ ♥ ♦ ♣ 🃏
}

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export interface BluffState {
  players: { id: string; name: string }[];
  judgeId: string | null;
  hands: Record<string, Card[]>;
  pile: Card[];
  claims: { playerId: string; count: number; rank: string }[];
  currentRank: string | null;
  phase: 'lead' | 'respond' | 'judge' | 'done';
  /** lead 阶段：开新一轮的玩家；respond 阶段：当前应对的玩家 */
  turn: string;
  lastPlay: { playerId: string; cards: Card[]; count: number; rank: string } | null;
  lastChallenge: {
    seq: number;
    challengerId: string;
    targetId: string;
    cards: Card[];
    truthful: boolean;
    loserId: string;
    pileCount: number;
  } | null;
  /** 待收走的底牌：质疑结算后底牌先留在牌桌展示，直到输家开新一轮才并入其手牌（避免牌桌与手牌重复） */
  pendingCollect: { loserId: string; cards: Card[] } | null;
  winnerId: string | null;
}

export function cardLabel(c: Card): string {
  return c.rank === 'JOKER' ? '🃏王' : `${c.suit}${c.rank}`;
}

function buildDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ id: id++, rank, suit });
  deck.push({ id: id++, rank: 'JOKER', suit: '🃏' });
  deck.push({ id: id++, rank: 'JOKER', suit: '🃏' });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function sortHand(hand: Card[]): Card[] {
  const order = (c: Card) => (c.rank === 'JOKER' ? 99 : RANKS.indexOf(c.rank));
  return [...hand].sort((a, b) => order(a) - order(b) || a.suit.localeCompare(b.suit));
}

function name(state: BluffState, id: string): string {
  return state.players.find((p) => p.id === id)?.name ?? id;
}

function nextOf(state: BluffState, id: string): string {
  const idx = state.players.findIndex((p) => p.id === id);
  return state.players[(idx + 1) % state.players.length].id;
}

/** 行动者的有效手牌：若有待收走的底牌且归属于他，先并入再展示（用于出牌前的提示与校验） */
function effHand(state: BluffState, id: string): Card[] {
  if (state.pendingCollect && state.pendingCollect.loserId === id) {
    return sortHand([...state.hands[id], ...state.pendingCollect.cards]);
  }
  return state.hands[id];
}

function handText(hand: Card[]): string {
  return hand.map((c, i) => `${i}:${cardLabel(c)}`).join('  ');
}

/** 显式告知玩家手中王（万能牌）的数量，避免模型误判自己没有王 */
function jokerNote(hand: Card[]): string {
  const n = hand.filter((c) => c.rank === 'JOKER').length;
  return n > 0
    ? `⚠️ 特别注意：你手中有 ${n} 张王（🃏，万能牌），可当作任何点数使用，记得把它们算进你的策略。`
    : '你手中没有王。';
}

function countsText(state: BluffState): string {
  return state.players.map((p) => `${p.name} 剩 ${effHand(state, p.id).length} 张`).join('，');
}

function normalizeRank(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase();
  const map: Record<string, string> = { '1': 'A', '11': 'J', '12': 'Q', '13': 'K' };
  const r = map[s] ?? s;
  return RANKS.includes(r) ? r : null;
}

function validatePlay(
  state: BluffState,
  actorId: string,
  action: Record<string, unknown>,
): { rank: string; indexes: number[] } | { error: string } {
  const hand = state.hands[actorId];
  const rank = normalizeRank(action.rank);
  if (!rank) return { error: 'rank 必须是 A、2-10、J、Q、K 之一（不能声明王）' };
  if (state.phase === 'respond' && state.currentRank && rank !== state.currentRank) {
    return { error: `本轮已声明点数「${state.currentRank}」，跟出时 rank 必须也是「${state.currentRank}」` };
  }
  const raw = action.cardIndexes;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) {
    return { error: 'cardIndexes 必须是含 1~4 个手牌序号的数组' };
  }
  const indexes = raw.map((x) => Number(x));
  if (indexes.some((n) => !Number.isInteger(n) || n < 0 || n >= hand.length)) {
    return { error: `cardIndexes 中存在无效序号，你的手牌序号范围是 0~${hand.length - 1}` };
  }
  if (new Set(indexes).size !== indexes.length) return { error: 'cardIndexes 不能重复' };
  return { rank, indexes };
}

const JUDGE_BOTS = ['这一抓惊心动魄！', '牌桌之上，谎言与胆识齐飞。', '局势逆转，精彩！'];
const PLAY_BOTS = ['这把牌稳得很。', '不信你就来抓。', '我从不说谎……大概。'];

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

/** 测试机器人策略：尽量诚实地出最多的点数，偶尔说谎/质疑 */
function botPlay(state: BluffState, actorId: string): { speech?: string; action: Record<string, unknown> } {
  const hand = effHand(state, actorId);
  if (state.phase === 'respond') {
    const ownerEmpty = state.lastPlay && state.hands[state.lastPlay.playerId].length === 0;
    if (ownerEmpty || Math.random() < 0.25) return { action: { type: 'challenge' } };
    const rank = state.currentRank!;
    const matching = hand
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.rank === rank || c.rank === 'JOKER')
      .map(({ i }) => i);
    const indexes = matching.length > 0 ? matching.slice(0, 2) : [Math.floor(Math.random() * hand.length)];
    return { speech: randomOf(PLAY_BOTS), action: { type: 'play', rank, cardIndexes: indexes } };
  }
  // lead：挑手里最多的点数
  const groups = new Map<string, number[]>();
  hand.forEach((c, i) => {
    if (c.rank === 'JOKER') return;
    groups.set(c.rank, [...(groups.get(c.rank) ?? []), i]);
  });
  if (groups.size === 0) {
    return { action: { type: 'play', rank: randomOf(RANKS), cardIndexes: [0] } };
  }
  const best = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  return {
    speech: randomOf(PLAY_BOTS),
    action: { type: 'play', rank: best[0], cardIndexes: best[1].slice(0, 3) },
  };
}

export const bluffGame: GameDefinition<BluffState> = {
  id: 'bluff',
  name: '吹牛（扑克）',
  description: '扣牌声明点数，可以说谎；下家选择跟出或“抓”。被抓包或冤枉好人都要收走底牌，先出完手牌者胜。',
  minPlayers: 2,
  maxPlayers: 4,
  judge: 'optional',
  rulesText: [
    '吹牛（又称“说谎者”）扑克规则：',
    '1. 一副 54 张牌（含大小王）平均分给所有玩家（多余的牌按座次分给前几位）。',
    '2. 开新一轮的玩家声明一个点数（A、2-10、J、Q、K），并面朝下扣出 1~4 张牌，宣称它们都是该点数——但实际可以是任何牌（即“吹牛”）。',
    '3. 下家二选一：(a) 跟出：同样面朝下扣出 1~4 张并声明同一点数（同样可以说谎）；(b) 抓（质疑）：翻开上家刚扣出的牌当场验证。',
    '4. 验证规则：若上家扣的牌全部是所声明的点数或王（大小王是万能牌，可当任何点数），则上家诚实，质疑者收走桌面全部底牌；否则上家说谎，由上家收走全部底牌。',
    '5. 收走底牌的玩家开启新一轮，重新声明任意点数。',
    '6. 谁先出完手牌且最后一手未被抓出说谎，谁获胜：若你出完了所有手牌，下家不抓或抓了发现你是诚实的，你立即获胜。',
    '7. 你只能看到自己的手牌、各家剩余张数和公开的声明记录，看不到别人扣出的真实牌面。',
  ].join('\n'),
  playerGoal: (playerName) =>
    `你是玩家「${playerName}」。目标是第一个出完手牌。灵活运用说谎与诚实，根据各家声明的点数与你手牌的矛盾推断谁在吹牛；在合适的时机果断“抓”，也要小心自己的谎言被抓包。发言（speech）可以用来施压、迷惑对手。`,
  judgeGoal: '你是本场吹牛比赛的解说裁判。在每次“抓”的验证之后，点评这次质疑的判断质量与局势变化。',

  setup: (players, judge) => {
    const order = shuffle(players); // 掷硬币：随机先后手座次与发牌顺序
    const deck = buildDeck();
    const hands: Record<string, Card[]> = Object.fromEntries(order.map((p) => [p.id, []]));
    deck.forEach((card, i) => hands[order[i % order.length].id].push(card));
    for (const id of Object.keys(hands)) hands[id] = sortHand(hands[id]);
    return {
      players: order.map((p) => ({ id: p.id, name: p.name })),
      judgeId: judge?.id ?? null,
      hands,
      pile: [],
      claims: [],
      currentRank: null,
      phase: 'lead',
      turn: order[0].id,
      lastPlay: null,
      lastChallenge: null,
      pendingCollect: null,
      winnerId: null,
    };
  },

  nextAction: (state): PendingAction | null => {
    if (state.phase === 'done') return null;

    if (state.phase === 'judge') {
      return {
        actorId: state.judgeId!,
        phase: '裁判点评',
        instruction: '请在 speech 字段点评刚才这次“抓”的质疑判断与当前局势。action 固定为 {"type":"comment"}。',
        visibleState: `${countsText(state)}。`,
        schemaHint: '{"type":"comment"}',
        botAction: () => ({ speech: randomOf(JUDGE_BOTS), action: { type: 'comment' } }),
      };
    }

    const actorId = state.turn;
    const hand = effHand(state, actorId);
    const claimLog = state.claims
      .map((c) => `${name(state, c.playerId)} 声明出了 ${c.count} 张「${c.rank}」`)
      .join('；');

    if (state.phase === 'lead') {
      return {
        actorId,
        phase: '开新一轮',
        instruction:
          '你来开新一轮：声明一个点数 rank（A、2-10、J、Q、K），并用 cardIndexes 指定要扣出的 1~4 张手牌的序号。扣出的牌可以与声明不符（吹牛）。',
        visibleState: [
          `你的手牌（序号:牌面）：${handText(hand)}`,
          jokerNote(hand),
          `各家手牌数：${countsText(state)}`,
          '桌面底牌堆：空（新一轮开始）',
        ].join('\n'),
        schemaHint: '{"type":"play","rank":"K","cardIndexes":[0,1]}',
        decisive: true,
        botAction: () => botPlay(state, actorId),
      };
    }

    // respond
    const owner = state.lastPlay!.playerId;
    const ownerEmpty = state.hands[owner].length === 0;
    return {
      actorId,
      phase: '跟出或抓',
      instruction: [
        `上家 ${name(state, owner)} 刚声明扣出了 ${state.lastPlay!.count} 张「${state.lastPlay!.rank}」。你二选一：`,
        `(a) 跟出：{"type":"play","rank":"${state.currentRank}","cardIndexes":[...]}（必须声明同点数「${state.currentRank}」，扣 1~4 张，可以说谎）；`,
        '(b) 抓（质疑上家）：{"type":"challenge"}。',
        ownerEmpty ? `⚠️ 注意：${name(state, owner)} 已经出完了所有手牌！如果你不抓，他将立即获胜。` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      visibleState: [
        `你的手牌（序号:牌面）：${handText(hand)}`,
        jokerNote(hand),
        `各家手牌数：${countsText(state)}`,
        `本轮声明点数：「${state.currentRank}」；本轮声明记录：${claimLog}`,
        `桌面底牌堆共 ${state.pile.length} 张（牌面不可见）`,
      ].join('\n'),
      schemaHint: `{"type":"play","rank":"${state.currentRank}","cardIndexes":[0]} 或 {"type":"challenge"}`,
      decisive: true,
      botAction: () => botPlay(state, actorId),
    };
  },

  applyAction: (state, actorId, action) => {
    if (state.phase === 'judge') {
      return { state: { ...state, phase: 'lead' }, events: [] };
    }

    const type = String(action.type ?? '');
    const events: GameEvent[] = [];

    if (state.phase === 'respond' && type === 'challenge') {
      const play = state.lastPlay!;
      const truthful = play.cards.every((c) => c.rank === play.rank || c.rank === 'JOKER');
      const loserId = truthful ? actorId : play.playerId;
      const faces = play.cards.map(cardLabel).join(' ');
      const pileCount = state.pile.length;
      events.push(
        makeEvent(
          'reveal',
          `${name(state, actorId)} 抓！翻开 ${name(state, play.playerId)} 扣出的牌：${faces} —— ` +
            (truthful
              ? `句句属实！${name(state, actorId)} 冤枉好人，收走底牌 ${pileCount} 张`
              : `谎话连篇！${name(state, play.playerId)} 被抓包，收走底牌 ${pileCount} 张`),
        ),
      );
      const challenge = {
        seq: (state.lastChallenge?.seq ?? 0) + 1,
        challengerId: actorId,
        targetId: play.playerId,
        cards: play.cards,
        truthful,
        loserId,
        pileCount,
      };
      if (truthful && state.hands[play.playerId].length === 0) {
        // 对方出完且经受住质疑，立即获胜——游戏结束，底牌无需再并入任何人
        events.push(makeEvent('system', `${name(state, play.playerId)} 手牌全部出完且经受住质疑，获胜！🏆`));
        return {
          state: { ...state, pile: [], claims: [], currentRank: null, lastPlay: null, lastChallenge: challenge, pendingCollect: null, phase: 'done', winnerId: play.playerId },
          events,
        };
      }
      // 底牌先留在牌桌展示（pendingCollect），等输家开新一轮时才并入其手牌，避免牌桌与手牌出现重复牌
      return {
        state: {
          ...state,
          pile: [],
          claims: [],
          currentRank: null,
          lastPlay: null,
          lastChallenge: challenge,
          pendingCollect: { loserId, cards: state.pile },
          phase: state.judgeId ? 'judge' : 'lead',
          turn: loserId,
        },
        events,
      };
    }

    if (type !== 'play') {
      return {
        state,
        events: [],
        error:
          state.phase === 'respond'
            ? 'action.type 必须是 "play"（跟出）或 "challenge"（抓）'
            : 'action.type 必须是 "play"',
      };
    }

    // 若该玩家正开新一轮且有待收的底牌，此刻才把底牌并入其手牌（牌桌展示到此结束）
    let work = state;
    if (state.pendingCollect && state.pendingCollect.loserId === actorId) {
      const merged = sortHand([...state.hands[actorId], ...state.pendingCollect.cards]);
      work = { ...state, hands: { ...state.hands, [actorId]: merged }, pendingCollect: null };
      events.push(
        makeEvent('action', `${name(state, actorId)} 收走底牌 ${state.pendingCollect.cards.length} 张并入手牌（现 ${merged.length} 张），开启新一轮`),
      );
    }

    const v = validatePlay(work, actorId, action);
    if ('error' in v) return { state, events: [], error: v.error };

    const hand = work.hands[actorId];
    const played = v.indexes.map((i) => hand[i]);
    const remaining = hand.filter((_, i) => !v.indexes.includes(i));
    const prevOwner = work.lastPlay?.playerId ?? null;

    events.push(makeEvent('action', `${name(work, actorId)} 声明扣出 ${played.length} 张「${v.rank}」（牌面未公开）`));

    const next: BluffState = {
      ...work,
      hands: { ...work.hands, [actorId]: remaining },
      pile: [...work.pile, ...played],
      claims: [...work.claims, { playerId: actorId, count: played.length, rank: v.rank }],
      currentRank: v.rank,
      lastPlay: { playerId: actorId, cards: played, count: played.length, rank: v.rank },
      phase: 'respond',
      turn: '',
    };

    // 跟出即默认不质疑：若上家已空手，上家立即获胜
    if (work.phase === 'respond' && prevOwner && work.hands[prevOwner].length === 0) {
      events.push(makeEvent('system', `${name(work, prevOwner)} 手牌出完且无人质疑，获胜！🏆`));
      return { state: { ...next, phase: 'done', winnerId: prevOwner }, events };
    }

    next.turn = nextOf(work, actorId);
    return { state: next, events };
  },

  result: (state) => {
    if (state.phase !== 'done' || !state.winnerId) return null;
    const counts = Object.fromEntries(state.players.map((p) => [p.id, state.hands[p.id].length]));
    return {
      winnerIds: [state.winnerId],
      summary: `${name(state, state.winnerId)} 率先出完手牌获胜！其余玩家剩牌：${state.players
        .filter((p) => p.id !== state.winnerId)
        .map((p) => `${p.name} ${counts[p.id]} 张`)
        .join('，')}`,
      scores: counts,
    };
  },

  View: CardTable,
};
