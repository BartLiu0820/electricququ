import type React from 'react';
import type { AIResponse, GameEvent, MatchResult, Participant } from '../types';

/** 引擎暂停点：描述“接下来该谁、做什么”，等待平台使用者确认后才调用 AI */
export interface PendingAction {
  actorId: string;
  /** UI 展示的阶段名，如「喊话」「出拳」「声明出牌」 */
  phase: string;
  /** 本步要求（拼进 user prompt） */
  instruction: string;
  /** 该行动者可见的局面信息（信息隐藏在这里实现） */
  visibleState: string;
  /** action 字段的 JSON 格式说明 */
  schemaHint: string;
  /** true 时丢弃该步的 speech（如秘密出拳阶段防止泄露） */
  suppressSpeech?: boolean;
  /** true 表示这是"真正出手"的关键决断步（出拳/出牌），提示 AI 结合对手最新发言临场决策 */
  decisive?: boolean;
  /**
   * 同时决策的行动者 id 列表（如石头剪子布出拳）：一次推进让所有人并行思考、同时出手，
   * 最后统一揭幕。设置后引擎会对该步并行调用各行动者模型。actorId 取列表首位用于展示兜底。
   */
  simultaneous?: string[];
  /** 即使 suppressSpeech 也展示思考过程（用于同时出拳——全员决定完才揭幕，不算剧透） */
  revealThinking?: boolean;
  /** 测试机器人 / AI 连续失败时的兜底动作 */
  botAction: () => AIResponse;
}

export interface ApplyResult<S = unknown> {
  state: S;
  events: GameEvent[];
  /** 非空表示动作非法，引擎会把原因带回给 AI 重试 */
  error?: string;
}

export interface GameViewProps<S = unknown> {
  state: S;
  players: Participant[];
  judge: Participant | null;
}

/** 游戏扩展点：实现该接口即可注册新游戏 */
export interface GameDefinition<S = unknown> {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  judge: 'none' | 'optional' | 'required';
  /** 给 AI 学习的完整规则 */
  rulesText: string;
  playerGoal: (playerName: string, players: Participant[]) => string;
  judgeGoal?: string;
  setup: (players: Participant[], judge: Participant | null, options: Record<string, unknown>) => S;
  nextAction: (state: S) => PendingAction | null;
  applyAction: (state: S, actorId: string, action: Record<string, unknown>, speech?: string) => ApplyResult<S>;
  result: (state: S) => MatchResult | null;
  View: React.FC<GameViewProps<S>>;
}

/** 自定义游戏的标准录入格式 */
export interface CustomGameSpec {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  rules: string;
  playerGoal: string;
  judgeGoal: string;
  winCondition: string;
  createdAt: number;
}
