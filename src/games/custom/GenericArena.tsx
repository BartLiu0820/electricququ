import type { GameViewProps } from '../types';
import type { CustomState } from './index';

const AVATAR_HUES = [200, 330, 120, 45];

export function GenericArena({ state, judge }: GameViewProps<CustomState>) {
  return (
    <div className="generic-arena">
      <div className="arena-status">
        <span className="round-chip">回合 {state.turns}</span>
        <span className="phase-chip">
          {state.stage === 'init' && '🎬 裁判开局中'}
          {state.stage === 'player' && '🎮 玩家行动中'}
          {state.stage === 'judge' && '👨‍⚖️ 裁判裁决中'}
          {state.stage === 'done' && '🏁 比赛结束'}
        </span>
      </div>

      <div className="narration-panel">
        <div className="narration-title">⚖️ {judge?.name ?? '裁判'} 叙述的局面</div>
        <div className="narration-body">{state.narration || '（等待裁判初始化局面……）'}</div>
      </div>

      <div className="rps-players">
        {state.players.map((p, i) => (
          <div
            key={p.id}
            className={`rps-player ${state.currentPlayerId === p.id && state.stage === 'player' ? 'active' : ''}`}
          >
            <div className="avatar" style={{ background: `hsl(${AVATAR_HUES[i % 4]} 70% 45%)` }}>
              {p.name.slice(0, 1)}
            </div>
            <div className="player-name">{p.name}</div>
            {state.winnerIds.includes(p.id) && state.stage === 'done' && <div>🏆</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
