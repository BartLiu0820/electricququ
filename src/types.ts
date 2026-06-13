/** 参赛者 / 裁判的模型接入配置（统一 OpenAI 兼容格式） */
export interface ApiConfig {
  /** api = 真实模型；bot = 测试机器人（无需 key，随机合法动作） */
  kind: 'api' | 'bot';
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface Participant {
  id: string; // p1..p4 / judge
  name: string;
  role: 'player' | 'judge';
  config: ApiConfig;
}

export interface MatchConfig {
  gameId: string;
  players: Participant[];
  judge: Participant | null;
  options: Record<string, unknown>;
}

export type GameEventType = 'speech' | 'action' | 'system' | 'judge' | 'reveal' | 'thinking';

export interface GameEvent {
  id: string;
  type: GameEventType;
  actorId?: string;
  text: string;
  /** thinking 事件专用：完整思考全文（text 为其总结） */
  detail?: string;
  ts: number;
}

export interface MatchResult {
  winnerIds: string[];
  summary: string;
  scores?: Record<string, number>;
}

/** AI 一次回复：可选思考小结 + 可选公开发言 + 结构化动作 */
export interface AIResponse {
  /** 心理博弈小结（≤300字，仅自己可见，不发给对手） */
  thought?: string;
  speech?: string;
  action: Record<string, unknown>;
}

let seq = 0;
export function makeEvent(type: GameEventType, text: string, actorId?: string): GameEvent {
  return { id: `e${Date.now()}_${seq++}`, type, text, actorId, ts: Date.now() };
}
