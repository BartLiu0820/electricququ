import type { GameViewProps } from '../types';
import { MOVE_EMOJI, type RpsState } from './index';

const PHASE_LABEL: Record<RpsState['phase'], string> = {
  talk: '🗣️ 喊话博弈中',
  throw: '🤜 秘密出拳中',
  reveal: '⚡ 即将亮拳',
  judge: '👨‍⚖️ 裁判点评中',
  done: '🏁 比赛结束',
};

const AVATAR_HUES = [200, 330, 120, 45];

export function RpsArena({ state }: GameViewProps<RpsState>) {
  const noThrows = Object.keys(state.throws).length === 0;
  // 仅在亮拳之后展示真实手势：裁判点评 / 比赛结束 / 新一局尚未有人出拳时显示上一局结果
  const showReveal =
    state.lastReveal !== null &&
    (state.phase === 'judge' || state.phase === 'done' || (state.phase === 'talk' && noThrows));
  const inThrow = state.phase === 'throw' || state.phase === 'reveal';

  return (
    <div className="rps-arena">
      <div className="arena-status">
        <span className="round-chip">
          第 {Math.min(state.round, state.totalRounds)} / {state.totalRounds} 局
        </span>
        <span className="phase-chip">{PHASE_LABEL[state.phase]}</span>
      </div>

      <div className="rps-players">
        {state.players.map((p, i) => {
          const lastTalk = [...state.talks].reverse().find((t) => t.id === p.id);
          const thrown = p.id in state.throws;
          const revealMove = showReveal ? state.lastReveal!.throws[p.id] : null;
          const gain = showReveal ? state.lastReveal!.gains[p.id] : 0;
          const isTalking = state.phase === 'talk' && state.players[state.talkIdx]?.id === p.id;
          return (
            <div
              key={p.id}
              className={`rps-player ${isTalking ? 'active' : ''} ${revealMove && gain > 0 ? 'round-winner' : ''}`}
            >
              <div className="speech-slot">
                {state.phase === 'talk' && lastTalk && (
                  <div className="speech-bubble">{lastTalk.text}</div>
                )}
              </div>
              <div
                className="avatar"
                style={{ background: `hsl(${AVATAR_HUES[i % 4]} 70% 45%)` }}
              >
                {p.name.slice(0, 1)}
              </div>
              <div className="player-name">{p.name}</div>
              <div className="score-badge">{state.scores[p.id]} 分</div>
              <div className="hand-slot">
                {revealMove ? (
                  <div key={`${state.lastReveal!.round}-${p.id}`} className={`hand reveal-pop ${gain > 0 ? 'winner' : ''}`}>
                    {MOVE_EMOJI[revealMove]}
                    {gain > 0 && <span className="gain">+{gain}</span>}
                  </div>
                ) : thrown ? (
                  <div className="hand locked">🔒</div>
                ) : inThrow ? (
                  <div className="hand waiting shake">❔</div>
                ) : (
                  <div className="hand idle">✊</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showReveal && <div className="reveal-banner">{state.lastReveal!.text}</div>}
    </div>
  );
}
