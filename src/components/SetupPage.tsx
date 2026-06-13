import { useEffect, useMemo, useState } from 'react';
import { deleteCustomSpec, listGames } from '../games/registry';
import { useMatch } from '../store/match';
import type { ApiConfig, MatchConfig, Participant } from '../types';
import { GameEditor } from './GameEditor';

const SETUP_KEY = 'ddqq.setup';

const BASE_URL_PRESETS = [
  'https://api.deepseek.com/v1',
  'https://api.moonshot.cn/v1',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'https://open.bigmodel.cn/api/paas/v4',
  'https://api.openai.com/v1',
  'https://api.anthropic.com/v1',
];

interface SlotForm extends ApiConfig {
  name: string;
}

/** 服务端 /api/presets 返回的 .env 预设（key 以 env:VAR 引用，不下发明文） */
interface EnvPreset {
  label: string;
  baseURL: string;
  model: string;
  keyRef: string;
}

interface SetupForm {
  gameId: string;
  playerCount: number;
  players: SlotForm[];
  judgeOn: boolean;
  judge: SlotForm;
  totalRounds: number;
}

function defaultSlot(name: string): SlotForm {
  return { name, kind: 'bot', baseURL: '', apiKey: '', model: '' };
}

/**
 * 从一段自由文本里自动识别 baseURL / apiKey / model。
 * 兼容：三行各一项、key=value、key: value、逗号分隔、带中英文标签等。
 */
function parseConfigPaste(raw: string): { baseURL?: string; apiKey?: string; model?: string } {
  const out: { baseURL?: string; apiKey?: string; model?: string } = {};
  const text = (raw ?? '').trim();
  if (!text) return out;

  // 1) 优先抓带标签的键值对（不用 \b：中文字符前 ASCII 词边界不成立）
  const labelRe =
    /["']?(base[_\s-]?url|url|端点|地址|api[_\s-]?key|key|密钥|model|模型名|模型)["']?\s*[:=：]\s*["']?([^"'\n,]+?)["']?(?=\s*[\n,]|$)/gi;
  const consumed: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(text))) {
    const label = m[1].toLowerCase().replace(/[_\s-]/g, '');
    const val = m[2].trim();
    if (!val) continue;
    if (/(baseurl|url|端点|地址)/.test(label)) out.baseURL = val;
    else if (/(apikey|key|密钥)/.test(label)) out.apiKey = val;
    else if (/(model|模型)/.test(label)) out.model = val;
    consumed.push(m[0]);
  }

  // 2) 剩余未消费部分按 token 拆分，靠特征分类
  let rest = text;
  for (const c of consumed) rest = rest.replace(c, ' ');
  const tokens = rest
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
    // 跳过残留的标签碎片：含中文，或「纯标签词 + 冒号」（不误伤含 :// 的 URL）
    .filter((t) => t && !/[一-龥]/.test(t) && !/^[A-Za-z_]+[:：]$/.test(t));
  for (const tok of tokens) {
    if (!out.baseURL && /^https?:\/\//i.test(tok)) {
      out.baseURL = tok;
    } else if (
      !out.apiKey &&
      (/^sk-/i.test(tok) || (tok.length >= 20 && /^[A-Za-z0-9_-]+$/.test(tok)))
    ) {
      out.apiKey = tok;
    } else if (!out.model) {
      out.model = tok;
    }
  }
  return out;
}

function defaultForm(): SetupForm {
  return {
    gameId: 'rps',
    playerCount: 2,
    players: [defaultSlot('玩家1'), defaultSlot('玩家2'), defaultSlot('玩家3'), defaultSlot('玩家4')],
    judgeOn: false,
    judge: defaultSlot('裁判'),
    totalRounds: 5,
  };
}

function loadForm(): SetupForm {
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (!raw) return defaultForm();
    const f = { ...defaultForm(), ...JSON.parse(raw) } as SetupForm;
    while (f.players.length < 4) f.players.push(defaultSlot(`玩家${f.players.length + 1}`));
    return f;
  } catch {
    return defaultForm();
  }
}

function SlotEditor({
  slot,
  title,
  presets,
  onChange,
}: {
  slot: SlotForm;
  title: string;
  presets: EnvPreset[];
  onChange: (s: SlotForm) => void;
}) {
  const set = <K extends keyof SlotForm>(k: K, v: SlotForm[K]) => onChange({ ...slot, [k]: v });
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteHint, setPasteHint] = useState('');

  const applyPaste = (raw: string) => {
    const parsed = parseConfigPaste(raw);
    const got = Object.entries(parsed).filter(([, v]) => v);
    if (got.length === 0) {
      setPasteHint('⚠️ 没识别出任何字段，请检查粘贴内容');
      return;
    }
    onChange({
      ...slot,
      kind: 'api',
      baseURL: parsed.baseURL ?? slot.baseURL,
      apiKey: parsed.apiKey ?? slot.apiKey,
      model: parsed.model ?? slot.model,
    });
    const labels: Record<string, string> = { baseURL: 'Base URL', apiKey: 'API Key', model: '模型名' };
    setPasteHint(`✅ 已识别并填入：${got.map(([k]) => labels[k]).join('、')}`);
  };

  return (
    <div className="slot-card">
      <div className="slot-head">
        <span className="slot-title">{title}</span>
        <input
          className="slot-name"
          value={slot.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="名称"
        />
        <select value={slot.kind} onChange={(e) => set('kind', e.target.value as ApiConfig['kind'])}>
          <option value="bot">🤖 测试机器人（无需 key）</option>
          <option value="api">🧠 真实模型（OpenAI 兼容）</option>
        </select>
      </div>
      {slot.kind === 'api' && presets.length > 0 && (
        <div className="preset-row">
          <span className="preset-label">从 .env 导入：</span>
          {presets.map((p) => (
            <button
              key={p.label}
              className="btn tiny preset-chip"
              title={`${p.baseURL}　${p.model}`}
              onClick={() =>
                onChange({ ...slot, kind: 'api', baseURL: p.baseURL, model: p.model, apiKey: p.keyRef })
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      {slot.kind === 'api' && (
        <div className="paste-row">
          <button
            className="btn tiny paste-toggle"
            onClick={() => {
              setPasteOpen((v) => !v);
              setPasteHint('');
            }}
          >
            📋 批量粘贴
          </button>
          {pasteOpen && (
            <div className="paste-box">
              <textarea
                autoFocus
                className="paste-area"
                placeholder={
                  '把 Base URL、API Key、模型名一起粘进来，自动识别填入。\n支持三行 / 逗号分隔 / key=value 等格式，例如：\nhttps://api.deepseek.com\nsk-xxxxxxxx\ndeepseek-chat'
                }
                onChange={(e) => applyPaste(e.target.value)}
              />
              {pasteHint && <span className="paste-hint">{pasteHint}</span>}
            </div>
          )}
        </div>
      )}
      {slot.kind === 'api' && (
        <div className="slot-fields">
          <label className="field">
            <span>Base URL</span>
            <input
              list="baseurl-presets"
              value={slot.baseURL}
              onChange={(e) => set('baseURL', e.target.value)}
              placeholder="https://api.deepseek.com/v1"
            />
          </label>
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={slot.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
          </label>
          <label className="field">
            <span>模型名</span>
            <input value={slot.model} onChange={(e) => set('model', e.target.value)} placeholder="deepseek-chat" />
          </label>
        </div>
      )}
    </div>
  );
}

export function SetupPage() {
  const startMatch = useMatch((s) => s.startMatch);
  const [form, setForm] = useState<SetupForm>(loadForm);
  const [games, setGames] = useState(listGames);
  const [editorOpen, setEditorOpen] = useState(false);
  const [err, setErr] = useState('');
  const [presets, setPresets] = useState<EnvPreset[]>([]);

  useEffect(() => {
    localStorage.setItem(SETUP_KEY, JSON.stringify(form));
  }, [form]);

  useEffect(() => {
    fetch('/api/presets')
      .then((r) => r.json())
      .then((d) => setPresets(Array.isArray(d.presets) ? d.presets : []))
      .catch(() => {});
  }, []);

  const game = useMemo(() => games.find((g) => g.id === form.gameId) ?? games[0], [games, form.gameId]);

  // 玩家数量与裁判设置随所选游戏的约束收敛
  useEffect(() => {
    if (!game) return;
    setForm((f) => ({
      ...f,
      gameId: game.id,
      playerCount: Math.max(game.minPlayers, Math.min(game.maxPlayers, f.playerCount)),
      judgeOn: game.judge === 'required' ? true : game.judge === 'none' ? false : f.judgeOn,
    }));
  }, [game]);

  if (!game) return null;

  const setSlot = (i: number, s: SlotForm) =>
    setForm((f) => ({ ...f, players: f.players.map((p, j) => (j === i ? s : p)) }));

  const start = () => {
    setErr('');
    const players: Participant[] = [];
    for (let i = 0; i < form.playerCount; i++) {
      const s = form.players[i];
      if (s.kind === 'api' && (!s.baseURL.trim() || !s.model.trim())) {
        setErr(`${s.name || `玩家${i + 1}`} 选择了真实模型，但 Base URL / 模型名未填写`);
        return;
      }
      players.push({
        id: `p${i + 1}`,
        name: s.name.trim() || `玩家${i + 1}`,
        role: 'player',
        config: { kind: s.kind, baseURL: s.baseURL.trim(), apiKey: s.apiKey.trim(), model: s.model.trim() },
      });
    }
    const names = new Set(players.map((p) => p.name));
    if (names.size !== players.length) {
      setErr('玩家名称不能重复（AI 之间通过名称互相称呼）');
      return;
    }
    let judge: Participant | null = null;
    if (form.judgeOn) {
      const s = form.judge;
      if (s.kind === 'api' && (!s.baseURL.trim() || !s.model.trim())) {
        setErr('裁判选择了真实模型，但 Base URL / 模型名未填写');
        return;
      }
      judge = {
        id: 'judge',
        name: s.name.trim() || '裁判',
        role: 'judge',
        config: { kind: s.kind, baseURL: s.baseURL.trim(), apiKey: s.apiKey.trim(), model: s.model.trim() },
      };
    }
    const config: MatchConfig = {
      gameId: game.id,
      players,
      judge,
      options: { totalRounds: form.totalRounds },
    };
    startMatch(config);
  };

  return (
    <div className="setup-page">
      <header className="setup-header">
        <h1>🦗 电子斗蛐蛐</h1>
        <p>让 AI 模型同台竞技 —— 选游戏、配蛐蛐、开斗！</p>
      </header>

      <section className="setup-section">
        <h2>① 选择游戏</h2>
        <div className="game-grid">
          {games.map((g) => (
            <div
              key={g.id}
              className={`game-card ${form.gameId === g.id ? 'selected' : ''}`}
              onClick={() => setForm((f) => ({ ...f, gameId: g.id }))}
            >
              <div className="game-card-head">
                <span className="game-name">
                  {g.id === 'rps' ? '✊ ' : g.id === 'bluff' ? '🃏 ' : '🎲 '}
                  {g.name}
                </span>
                {g.custom && (
                  <button
                    className="btn tiny ghost"
                    title="删除该自定义游戏"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`删除自定义游戏《${g.name}》？`)) {
                        deleteCustomSpec(g.id);
                        const next = listGames();
                        setGames(next);
                        if (form.gameId === g.id) setForm((f) => ({ ...f, gameId: next[0].id }));
                      }
                    }}
                  >
                    🗑
                  </button>
                )}
              </div>
              <p className="game-desc">{g.description}</p>
              <p className="game-meta">
                {g.minPlayers === g.maxPlayers ? `${g.minPlayers} 人` : `${g.minPlayers}~${g.maxPlayers} 人`} ·{' '}
                {g.judge === 'required' ? '需要裁判' : g.judge === 'optional' ? '裁判可选' : '无裁判'}
                {g.custom ? ' · 自定义' : ''}
              </p>
            </div>
          ))}
          <div className="game-card add-card" onClick={() => setEditorOpen(true)}>
            <span className="add-plus">＋</span>
            <p>新增自定义游戏</p>
            <p className="game-meta">按标准格式录入规则</p>
          </div>
        </div>
      </section>

      <section className="setup-section">
        <h2>② 参赛选手</h2>
        <div className="row-controls">
          <label>
            玩家数量：
            <select
              value={form.playerCount}
              onChange={(e) => setForm((f) => ({ ...f, playerCount: Number(e.target.value) }))}
            >
              {Array.from({ length: game.maxPlayers - game.minPlayers + 1 }).map((_, i) => (
                <option key={i} value={game.minPlayers + i}>
                  {game.minPlayers + i} 人
                </option>
              ))}
            </select>
          </label>
          {game.id === 'rps' && (
            <label>
              局数：
              <select
                value={form.totalRounds}
                onChange={(e) => setForm((f) => ({ ...f, totalRounds: Number(e.target.value) }))}
              >
                {[3, 5, 7, 9].map((n) => (
                  <option key={n} value={n}>
                    {n} 局
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="slots">
          {form.players.slice(0, form.playerCount).map((s, i) => (
            <SlotEditor key={i} slot={s} title={`玩家 ${i + 1}`} presets={presets} onChange={(v) => setSlot(i, v)} />
          ))}
        </div>
      </section>

      {game.judge !== 'none' && (
        <section className="setup-section">
          <h2>③ 裁判</h2>
          {game.judge === 'optional' ? (
            <label className="judge-toggle">
              <input
                type="checkbox"
                checked={form.judgeOn}
                onChange={(e) => setForm((f) => ({ ...f, judgeOn: e.target.checked }))}
              />
              启用裁判（负责解说点评）
            </label>
          ) : (
            <p className="judge-note">该游戏由裁判 AI 主持，必须配置裁判。</p>
          )}
          {form.judgeOn && (
            <div className="slots">
              <SlotEditor
                slot={form.judge}
                title="裁判"
                presets={presets}
                onChange={(v) => setForm((f) => ({ ...f, judge: v }))}
              />
            </div>
          )}
        </section>
      )}

      {err && <div className="form-error">⚠️ {err}</div>}

      <div className="start-row">
        <button className="btn primary big" onClick={start}>
          🔥 开始斗蛐蛐
        </button>
        <p className="key-tip">
          API Key 仅保存在你的浏览器本地（localStorage），经本机代理转发，不会上传任何服务器。
          也可以在项目根目录 .env 中按 <code>前缀_API_KEY / 前缀_BASE_URL / 前缀_MODEL</code> 配置后一键导入（明文 key 不会离开服务端）。
        </p>
      </div>

      <datalist id="baseurl-presets">
        {BASE_URL_PRESETS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {editorOpen && (
        <GameEditor
          onClose={(savedId) => {
            setEditorOpen(false);
            const next = listGames();
            setGames(next);
            if (savedId) setForm((f) => ({ ...f, gameId: savedId }));
          }}
        />
      )}
    </div>
  );
}
