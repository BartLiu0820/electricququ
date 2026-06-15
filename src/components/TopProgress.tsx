import { useEffect, useRef, useState } from 'react';
import { useMatch } from '../store/match';

/** 顶部环节进度条：展示当前是谁、在哪个环节，思考中显示实时用时与进度动画，帮助把控节奏 */
export function TopProgress() {
  const { pending, status, config, result, simProgress, simulatedSteps, replayIdx } = useMatch();
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (status === 'calling') {
      startedAt.current = Date.now();
      setElapsed(0);
      const t = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 100);
      return () => clearInterval(t);
    }
    setElapsed(0);
  }, [status]);

  if (!config || status === 'idle' || result) return null;

  // 预模拟进行中
  if (status === 'simulating') {
    return (
      <div className="top-progress thinking">
        <div className="tp-line">
          <span className="tp-phase">
            ⚙️ 预先模拟中… 第 {simProgress?.step ?? 0} 步：{simProgress?.label ?? '初始化'}
          </span>
          <span className="tp-timer">后台运算完毕后即可快进演绎</span>
        </div>
        <div className="tp-bar">
          <div className="tp-bar-fill indeterminate" />
        </div>
      </div>
    );
  }

  const actor =
    pending && !pending.system
      ? (config.players.find((p) => p.id === pending.actorId) ??
        (config.judge?.id === pending.actorId ? config.judge : null))
      : null;
  const actorName = pending?.simultaneous && pending.simultaneous.length > 1
    ? '全体玩家'
    : actor?.name ?? (pending?.system ? '' : '');

  const calling = status === 'calling';
  const slow = elapsed > 20;
  const isReplay = !!simulatedSteps;
  const totalSteps = simulatedSteps?.length ?? 0;

  return (
    <div className={`top-progress ${calling ? 'thinking' : ''}`}>
      <div className="tp-line">
        <span className="tp-phase">
          {calling
            ? `🧠 ${actorName} 正在推理…`
            : pending?.system
              ? `🎬 ${pending.phase} · 等待揭晓`
              : `${isReplay ? '⚡' : '⏸'} ${isReplay ? '快进演绎' : '当前环节'}：${actorName ? actorName + ' · ' : ''}${pending?.phase ?? ''}`}
        </span>
        {calling && (
          <span className={`tp-timer ${slow ? 'slow' : ''}`}>
            {elapsed.toFixed(1)}s{slow ? '（推理较久，请耐心等待）' : ''}
          </span>
        )}
        {isReplay && !calling && (
          <span className="tp-timer">{replayIdx} / {totalSteps} 步</span>
        )}
      </div>
      <div className="tp-bar">
        <div className={`tp-bar-fill ${calling ? 'indeterminate' : 'idle'}`} />
      </div>
    </div>
  );
}
