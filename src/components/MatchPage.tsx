import { useEffect, useRef, useState } from 'react';
import { useMatch } from '../store/match';
import { sfx, isMuted, setMuted } from '../sound';
import { ChatLog } from './ChatLog';
import { ConfirmBar } from './ConfirmBar';
import { TopProgress } from './TopProgress';

export function MatchPage() {
  const { config, game, gameState, result, exitMatch, rematch } = useMatch();
  const events = useMatch((s) => s.events);
  const status = useMatch((s) => s.status);
  const lastEventIdx = useRef(0);
  const [muted, setMutedState] = useState(isMuted());

  // 事件驱动音效：仅对新增事件播放
  useEffect(() => {
    for (let i = lastEventIdx.current; i < events.length; i++) {
      const e = events[i];
      if (e.type === 'reveal') e.text.includes('抓') ? sfx.challenge() : sfx.reveal();
      else if (e.type === 'system' && e.text.includes('掷硬币')) sfx.coin();
      else if (e.type === 'action' && (e.text.includes('扣出') || e.text.includes('出拳'))) sfx.card();
    }
    lastEventIdx.current = events.length;
  }, [events]);

  // 思考音效
  useEffect(() => {
    if (status === 'calling') sfx.think();
  }, [status]);

  // 胜利音效
  useEffect(() => {
    if (result) sfx.win();
  }, [result]);

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
          className="btn ghost sound-toggle"
          title={muted ? '音效已关闭' : '音效已开启'}
          onClick={() => {
            const next = !muted;
            setMuted(next);
            setMutedState(next);
            if (!next) sfx.click();
          }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            sfx.click();
            if (result || window.confirm('比赛尚未结束，确定要离开吗？')) exitMatch();
          }}
        >
          ← 返回设置
        </button>
      </header>

      <TopProgress />

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
