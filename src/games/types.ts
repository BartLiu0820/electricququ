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
