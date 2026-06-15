import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMatch } from '../store/match';

const AVATAR_HUES: Record<string, number> = { p1: 200, p2: 330, p3: 120, p4: 45, judge: 270 };

/** 思考：默认展示小结，若有完整思考则可展开到独立分区 */
function ThinkBubble({ text, detail }: { text: string; detail?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="chat-think">
      <div className="think-summary">💭 {text}</div>
      {detail && (
        <>
          <button className="think-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? '收起完整思考 ▲' : '展开完整思考 ▼'}
          </button>
          {open && <div className="think-full">{detail}</div>}
        </>
      )}
    </div>
  );
}

export function ChatLog() {
  const events = useMatch((s) => s.events);
  const config = useMatch((s) => s.config);
  const streamingThinking = useMatch((s) => s.streamingThinking);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 流式时用 instant 跟上 token 速度，保证最新内容始终在视野内；其余用平滑滚动
    ref.current?.scrollTo({
      top: ref.current.scrollHeight,
      behavior: streamingThinking ? 'auto' : 'smooth',
    });
  }, [events.length, streamingThinking?.text]);

  const nameOf = (id?: string) => {
    if (!id || !config) return '';
    if (config.judge?.id === id) return `${config.judge.name}（裁判）`;
    return config.players.find((p) => p.id === id)?.name ?? id;
  };

  const items: ReactNode[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];

    // 思考过程：归在该玩家本次发言之内，紧贴其发言之前；与发言共用一个名字
    if (e.type === 'thinking') {
      const next = events[i + 1];
      const paired = next && next.type === 'speech' && next.actorId === e.actorId ? next : null;
      items.push(
        <div key={e.id} className="chat-item">
          <span className="chat-name" style={{ color: `hsl(${AVATAR_HUES[e.actorId ?? ''] ?? 0} 80% 70%)` }}>
            {nameOf(e.actorId)}
          </span>
          <ThinkBubble text={e.text} detail={e.detail} />
          {paired && <div className="chat-bubble">{paired.text}</div>}
        </div>,
      );
      if (paired) i++; // 已和发言合并，跳过下一条
      continue;
    }

    if (e.type === 'speech') {
      items.push(
        <div key={e.id} className="chat-item">
          <span className="chat-name" style={{ color: `hsl(${AVATAR_HUES[e.actorId ?? ''] ?? 0} 80% 70%)` }}>
            {nameOf(e.actorId)}
          </span>
          <div className="chat-bubble">{e.text}</div>
        </div>,
      );
      continue;
    }

    if (e.type === 'judge') {
      items.push(
        <div key={e.id} className="chat-item">
          <span className="chat-name judge">⚖️ 裁判</span>
          <div className="chat-bubble judge">{e.text}</div>
        </div>,
      );
      continue;
    }

    items.push(
      <div key={e.id} className={`chat-line ${e.type}`}>
        {e.type === 'reveal' ? '🎴 ' : ''}
        {e.text}
      </div>,
    );
  }

  return (
    <div className="chat-log" ref={ref}>
      {items}
      {streamingThinking && (
        <div className="chat-item">
          <span className="chat-name" style={{ color: `hsl(${AVATAR_HUES[streamingThinking.actorId] ?? 0} 80% 70%)` }}>
            {nameOf(streamingThinking.actorId)}
          </span>
          <div className="chat-think">
            <div className="think-summary streaming">
              💭 {streamingThinking.text || '思考中'}
              <span className="stream-caret">▍</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
