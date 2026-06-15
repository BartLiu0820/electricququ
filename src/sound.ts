// 轻量音效：用 Web Audio 实时合成，无需任何音频素材文件。
// 浏览器要求音频在用户手势后才能发声，故 AudioContext 懒创建并在每次播放时 resume。

let muted = localStorage.getItem('ddqq.muted') === '1';
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  muted = v;
  localStorage.setItem('ddqq.muted', v ? '1' : '0');
}

interface BlipOpts {
  type?: OscillatorType;
  gain?: number;
  slideTo?: number;
  delay?: number;
}

/** 播放一个短促音，可滑音 */
function blip(freq: number, dur: number, opts: BlipOpts = {}): void {
  if (muted) return;
  const a = ac();
  if (!a) return;
  const { type = 'sine', gain = 0.12, slideTo, delay = 0 } = opts;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.015, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  /** 按钮点击/推进 */
  click: () => blip(520, 0.05, { type: 'triangle', gain: 0.1 }),
  /** 选择卡片/选项 */
  select: () => blip(660, 0.06, { type: 'triangle', gain: 0.1, slideTo: 880 }),
  /** 开始思考 */
  think: () => {
    blip(300, 0.16, { type: 'sine', gain: 0.06, slideTo: 380 });
    blip(380, 0.16, { type: 'sine', gain: 0.05, slideTo: 300, delay: 0.18 });
  },
  /** 掷硬币 */
  coin: () => {
    blip(900, 0.08, { type: 'square', gain: 0.06, slideTo: 1400 });
    blip(1400, 0.1, { type: 'square', gain: 0.05, slideTo: 700, delay: 0.1 });
    blip(700, 0.16, { type: 'triangle', gain: 0.08, slideTo: 1050, delay: 0.22 });
  },
  /** 出牌/扣牌 */
  card: () => blip(240, 0.07, { type: 'sawtooth', gain: 0.06, slideTo: 170 }),
  /** 揭幕/亮拳 */
  reveal: () => {
    blip(523, 0.1, { type: 'triangle', gain: 0.11 });
    blip(784, 0.16, { type: 'triangle', gain: 0.11, delay: 0.09 });
  },
  /** 质疑/抓 */
  challenge: () => blip(440, 0.18, { type: 'sawtooth', gain: 0.1, slideTo: 180 }),
  /** 胜利 */
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.22, { type: 'triangle', gain: 0.12, delay: i * 0.12 }));
  },
};
