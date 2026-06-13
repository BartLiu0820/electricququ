import { useMatch } from '../store/match';

export function ConfirmBar() {
  const { pending, status, error, autoPlay, advance, setAutoPlay, config } = useMatch();
  if (!config || status === 'finished' || status === 'idle') return null;

  const actor = pending
    ? (config.players.find((p) => p.id === pending.actorId) ??
      (config.judge?.id === pending.actorId ? config.judge : null))
    : null;
  const actorLabel =
    pending?.simultaneous && pending.simultaneous.length > 1
      ? '全体玩家'
      : actor
        ? `${actor.name}${actor.role === 'judge' ? '（裁判）' : ''}`
        : '';

  return (
    <div className="confirm-bar">
      {error && (
        <div className="confirm-error">
          ⚠️ {error}
          <button className="btn small" onClick={() => void advance()}>
            重试
          </button>
        </div>
      )}
      {!error && status === 'calling' && (
        <div className="confirm-main">
          <span className="spinner" />
          <span>
            {actorLabel} 正在思考<span className="dots">…</span>
          </span>
        </div>
      )}
      {!error && status === 'awaiting-confirm' && pending && (
        <div className="confirm-main">
          <span className="next-label">
            下一步：<b>{actorLabel}</b> · {pending.phase}
          </span>
          <button className="btn primary" onClick={() => void advance()}>
            ▶ 推进
          </button>
        </div>
      )}
      <label className="auto-toggle">
        <input type="checkbox" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} />
        自动连续推进
      </label>
    </div>
  );
}
