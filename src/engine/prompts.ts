import type { GameDefinition, PendingAction } from '../games/types';
import type { GameEvent, MatchConfig, Participant } from '../types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function actorName(config: MatchConfig, id?: string): string {
  if (!id) return '系统';
  const p = config.players.find((x) => x.id === id) ?? (config.judge?.id === id ? config.judge : null);
  return p?.name ?? id;
}

/** 把公开事件流转成给 AI 看的过程记录（不含任何隐藏信息） */
function publicLog(config: MatchConfig, events: GameEvent[]): string {
  return events
    .filter((e) => e.type !== 'thinking') // 思考过程是各模型私有，不进入对手可见的公开记录
    .slice(-50)
    .map((e) =>
      e.type === 'speech'
        ? `${actorName(config, e.actorId)} 说：“${e.text}”`
        : e.type === 'judge'
          ? `裁判：${e.text}`
          : `〔${e.text}〕`,
    )
    .join('\n');
}

export function buildMessages(
  game: GameDefinition<any>,
  pending: PendingAction,
  actor: Participant,
  config: MatchConfig,
  events: GameEvent[],
  lastError?: string,
): ChatMessage[] {
  const playerNames = config.players.map((p) => p.name).join('、');
  const goal =
    actor.role === 'judge'
      ? (game.judgeGoal ?? '作为裁判，公正地主持并裁决这场游戏。')
      : game.playerGoal(actor.name, config.players);

  const system = [
    `你是「${actor.name}」，正在参加一场名为《${game.name}》的对战游戏。`,
    actor.role === 'judge' ? '你的身份：裁判。' : '你的身份：参赛玩家。',
    `参赛玩家：${playerNames}${config.judge ? `；裁判：${config.judge.name}` : ''}。`,
    '',
    '【游戏规则】',
    game.rulesText,
    '',
    '【你的目标】',
    goal,
    '',
    '【输出格式】',
    '你必须只输出一个 JSON 对象，不要输出任何 JSON 之外的文字。格式：',
    `{"thought": "（可选）用不超过300字概括你这一步的核心心理博弈思路", "speech": "（可选）你想公开说的话，不想说就省略此字段", "action": ${pending.schemaHint}}`,
    'thought 字段是你的私密思考小结，只有你自己和观众能看到，不会发给其他玩家；请在其中提炼关键的博弈判断（如何读对手、为何这样决策），而不是复述规则。',
    pending.suppressSpeech ? '注意：本步为秘密行动，speech 将被忽略，请不要试图通过发言泄露信息。' : '',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const log = publicLog(config, events);
  // 决断步：把各对手最近一次公开发言单独拎出来，提醒可据此临场改策略
  let decisiveBlock = '';
  if (pending.decisive) {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'speech' && e.actorId && e.actorId !== actor.id && !seen.has(e.actorId)) {
        seen.add(e.actorId);
        lines.push(`${actorName(config, e.actorId)}：“${e.text}”`);
      }
    }
    decisiveBlock = [
      '【关键决断 · 请结合对手发言】',
      '现在是你真正出手的一步。对手们刚才的发言可能是虚张声势、诱导或反向心理战——不要被表面的话带偏，也不要拘泥于自己之前的打算。',
      '请重新审视当前局面，必要时果断推翻原计划、临场改变策略。',
      lines.length ? `对手最新发言：\n${lines.reverse().join('\n')}` : '（对手暂无公开发言）',
    ].join('\n');
  }

  const user = [
    log ? `【公开过程记录】\n${log}` : '',
    `【当前局面（你可见的信息）】\n${pending.visibleState}`,
    `【现在轮到你 — ${pending.phase}】\n${pending.instruction}`,
    decisiveBlock,
    lastError
      ? `【重要】你上一次的输出存在问题：${lastError}\n请严格按要求重新输出一个合法的 JSON。`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
