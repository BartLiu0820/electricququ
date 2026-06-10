import { bluffGame } from './bluff';
import { makeCustomGame } from './custom';
import { rpsGame } from './rps';
import type { CustomGameSpec, GameDefinition } from './types';

const CUSTOM_KEY = 'ddqq.customGames';

export const builtinGames: GameDefinition<any>[] = [rpsGame, bluffGame];

export function loadCustomSpecs(): CustomGameSpec[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveCustomSpec(spec: CustomGameSpec): void {
  const specs = loadCustomSpecs().filter((s) => s.id !== spec.id);
  specs.push(spec);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(specs));
}

export function deleteCustomSpec(id: string): void {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(loadCustomSpecs().filter((s) => s.id !== id)));
}

export function getGame(id: string): GameDefinition<any> | null {
  const builtin = builtinGames.find((g) => g.id === id);
  if (builtin) return builtin;
  const spec = loadCustomSpecs().find((s) => s.id === id);
  return spec ? makeCustomGame(spec) : null;
}

/** 设置页展示用：内置 + 自定义的游戏元信息 */
export function listGames(): {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  judge: 'none' | 'optional' | 'required';
  custom: boolean;
}[] {
  return [
    ...builtinGames.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      judge: g.judge,
      custom: false,
    })),
    ...loadCustomSpecs().map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description || '自定义游戏（裁判 AI 主持）',
      minPlayers: s.minPlayers,
      maxPlayers: s.maxPlayers,
      judge: 'required' as const,
      custom: true,
    })),
  ];
}
