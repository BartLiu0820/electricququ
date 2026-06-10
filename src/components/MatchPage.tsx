import { useMatch } from '../store/match';
import { ChatLog } from './ChatLog';
import { ConfirmBar } from './ConfirmBar';

export function MatchPage() {
  const { config, game, gameState, result, exitMatch, rematch } = useMatch();
  if (!config || !game || gameState === null) return null;

  const View = game.View;
  const winnerNames = result
    ? config.players.filter((p) => result.winnerIds.includes(p.id)).map((p) => p.name)
    : [];

  return (
    <div className="match-page">
      <header className="match-header">
        <span className="logo">🦗 电子斗蛐蛐</span>
        <span className="match-title">《{game.name}》</span>
        <button
          className="btn ghost"
          onClick={() => {
            if (result || window.confirm('比赛尚未结束，确定要离开吗？')) exitMatch();
          }}
        >
          ← 返回设置
        </button>
      </header>

      <div className="match-body">
        <main className="arena-pane">
          <View state={gameState} players={config.players} judge={config.judge} />
        </main>
        <aside className="log-pane">
          <div className="log-title">💬 过程实录</div>
          <ChatLog />
        </aside>
      </div>

      <ConfirmBar />

      {result && (
        <div className="result-overlay">
          <div className="result-card">
            <div className="result-trophy">🏆</div>
            <h2>
              {winnerNames.length === config.players.length ? '平局！' : `${winnerNames.join('、')} 获胜！`}
            </h2>
            <p className="result-summary">{result.summary}</p>
            {result.scores && (
              <div className="result-scores">
                {config.players.map((p) => (
                  <span key={p.id} className="score-pill">
                    {p.name}：{result.scores![p.id]}
                  </span>
                ))}
              </div>
            )}
            <div className="result-actions">
              <button className="btn primary" onClick={rematch}>
                🔁 再来一局
              </button>
              <button className="btn" onClick={exitMatch}>
                返回设置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
