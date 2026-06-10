import { useEffect, useRef } from 'react';
import { useMatch } from '../store/match';

const AVATAR_HUES: Record<string, number> = { p1: 200, p2: 330, p3: 120, p4: 45, judge: 270 };

export function ChatLog() {
  const events = useMatch((s) => s.events);
  const config = useMatch((s) => s.config);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
  }, [events.length]);

  const nameOf = (id?: string) => {
    if (!id || !config) return '';
    if (config.judge?.id === id) return `${config.judge.name}（裁判）`;
    return config.players.find((p) => p.id === id)?.name ?? id;
  };

  return (
    <div className="chat-log" ref={ref}>
      {events.map((e) => {
        if (e.type === 'speech') {
          return (
            <div key={e.id} className="chat-item">
              <span className="chat-name" style={{ color: `hsl(${AVATAR_HUES[e.actorId ?? ''] ?? 0} 80% 70%)` }}>
                {nameOf(e.actorId)}
              </span>
              <div className="chat-bubble">{e.text}</div>
            </div>
          );
        }
        if (e.type === 'judge') {
          return (
            <div key={e.id} className="chat-item">
              <span className="chat-name judge">⚖️ 裁判</span>
              <div className="chat-bubble judge">{e.text}</div>
            </div>
          );
        }
        return (
          <div key={e.id} className={`chat-line ${e.type}`}>
            {e.type === 'reveal' ? '🎴 ' : ''}
            {e.text}
          </div>
        );
      })}
    </div>
  );
}
