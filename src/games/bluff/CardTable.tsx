import { useState } from 'react';
import type { GameViewProps } from '../types';
import { cardLabel, type BluffState, type Card } from './index';

const AVATAR_HUES = [200, 330, 120, 45];

function CardChip({ card, big, lie }: { card: Card; big?: boolean; lie?: boolean }) {
  const red = card.suit === '♥' || card.suit === '♦' || card.rank === 'JOKER';
  return (
    <span className={`card-chip ${red ? 'red' : ''} ${big ? 'big' : ''} ${lie ? 'lie' : ''}`}>
      {cardLabel(card)}
    </span>
  );
}

export function CardTable({ state, judge }: GameViewProps<BluffState>) {
  const [peek, setPeek] = useState(false);
  // 质疑后到收牌前：底牌翻开留在牌桌展示
  const revealPhase = !!state.lastChallenge && (state.phase === 'judge' || state.phase === 'collect');
  const activeId =
    state.phase === 'lead' || state.phase === 'respond'
      ? state.turn
      : state.phase === 'judge'
        ? state.judgeId
        : state.phase === 'collect'
          ? (state.lastChallenge?.loserId ?? null)
          : null;
  const lastClaim = state.claims[state.claims.length - 1] ?? null;

  // 按声明顺序把底牌堆切回每一手（pile 是各次出牌的顺序拼接）
  let offset = 0;
  const claimGroups = state.claims.map((c) => {
    const cards = state.pile.slice(offset, offset + c.count);
    offset += c.count;
    return { ...c, cards };
  });

  return (
    <div className="card-table">
      <div className="arena-status">
        <span className="round-chip">
          {state.currentRank ? `本轮点数「${state.currentRank}」` : '等待开新一轮'}
        </span>
        <span className="phase-chip">
          {state.phase === 'lead' && '🃏 开新一轮'}
          {state.phase === 'respond' && '🤔 跟出或抓'}
          {state.phase === 'collect' && '📥 收牌中'}
          {state.phase === 'judge' && '👨‍⚖️ 裁判点评中'}
          {state.phase === 'done' && '🏁 比赛结束'}
        </span>
      </div>

      <div className="table-felt">
        <div className="pile-area">
          {revealPhase ? (
            <div key={state.lastChallenge!.seq} className="challenge-reveal">
              <div className={`verdict ${state.lastChallenge!.truthful ? 'honest' : 'liar'}`}>
                {state.lastChallenge!.truthful ? '✅ 句句属实' : '❌ 谎话连篇'}
              </div>
              <div className="reveal-grouped">
                {claimGroups.map((g, i) => (
                  <div key={i} className="peek-row">
                    <span className="peek-claim">
                      {state.players.find((p) => p.id === g.playerId)?.name} 声明「{g.rank}」×{g.count}
                    </span>
                    <span className="peek-cards">
                      {g.cards.map((c) => (
                        <span key={c.id} className="flip-card">
                          <CardChip card={c} lie={c.rank !== g.rank && c.rank !== 'JOKER'} />
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              <div className="collect-label">
                📥 {state.players.find((p) => p.id === state.lastChallenge!.loserId)?.name} 将收走牌桌全部{' '}
                {state.pile.length} 张{state.phase === 'collect' ? '（点击「收牌」并入手牌）' : ''}
              </div>
            </div>
          ) : (
            <div className="pile-stack">
              {peek && state.pile.length > 0 ? (
                <div className="peek-pile">
                  {claimGroups.map((g, i) => (
                    <div key={i} className="peek-row">
                      <span className="peek-claim">
                        {state.players.find((p) => p.id === g.playerId)?.name} 声明 {g.count} 张「{g.rank}」
                      </span>
                      <span className="peek-cards">
                        {g.cards.map((c) => (
                          <CardChip key={c.id} card={c} lie={c.rank !== g.rank && c.rank !== 'JOKER'} />
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="card-backs" key={state.pile.length}>
                  {Array.from({ length: Math.min(state.pile.length, 8) }).map((_, i) => (
                    <span key={i} className={`card-back ${i === Math.min(state.pile.length, 8) - 1 ? 'slide-in' : ''}`} style={{ left: i * 7, top: -i * 2 }} />
                  ))}
                  {state.pile.length === 0 && <span className="pile-empty">底牌堆空</span>}
                </div>
              )}
              {state.pile.length > 0 && <div className="pile-count">{state.pile.length} 张</div>}
              {lastClaim && (
                <div className="last-claim">
                  最新声明：{state.players.find((p) => p.id === lastClaim.playerId)?.name} 出了 {lastClaim.count} 张「{lastClaim.rank}」
                </div>
              )}
              {state.pile.length > 0 && (
                <button className="btn small peek-btn" onClick={() => setPeek((v) => !v)}>
                  {peek ? '🙈 盖回去' : '👁️ 偷看底牌'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bluff-players">
        {state.players.map((p, i) => (
          <div key={p.id} className={`bluff-player ${activeId === p.id ? 'active' : ''} ${state.winnerId === p.id ? 'champion' : ''}`}>
            <div className="bluff-player-head">
              <div className="avatar small" style={{ background: `hsl(${AVATAR_HUES[i % 4]} 70% 45%)` }}>
                {p.name.slice(0, 1)}
              </div>
              <span className="player-name">{p.name}</span>
              <span className="count-badge">{state.hands[p.id].length} 张</span>
              {state.winnerId === p.id && <span>🏆</span>}
            </div>
            <div className="hand-cards">
              {state.hands[p.id].map((c) => (
                <CardChip key={c.id} card={c} />
              ))}
              {state.hands[p.id].length === 0 && <span className="hand-empty">（已出完）</span>}
            </div>
          </div>
        ))}
        {judge && (
          <div className={`bluff-player judge-panel ${activeId === judge.id ? 'active' : ''}`}>
            <div className="bluff-player-head">
              <div className="avatar small" style={{ background: 'hsl(270 60% 50%)' }}>
                ⚖
              </div>
              <span className="player-name">{judge.name}（裁判）</span>
            </div>
          </div>
        )}
      </div>
      <p className="god-view-tip">
        👁️ 上帝视角：你能看到所有玩家的真实手牌，还可以偷看底牌堆（红框 = 与声明不符的谎牌）。AI 们彼此看不到。
      </p>
    </div>
  );
}
