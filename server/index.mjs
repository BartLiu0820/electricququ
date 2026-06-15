import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { Readable } from 'node:stream';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- 加载项目根目录 .env（极简解析，无第三方依赖） ----
function loadEnvFile() {
  const file = path.join(root, '.env');
  const vars = {};
  if (!fs.existsSync(file)) return vars;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return vars;
}
const envVars = loadEnvFile();

// 请求超时（秒）：可在 .env 用 REQUEST_TIMEOUT 配置，下限 60s（推理模型本就慢，过小会频繁误超时），默认 180s
const REQUEST_TIMEOUT_MS = Math.max(60, Number(envVars.REQUEST_TIMEOUT) || 180) * 1000;

const app = express();
app.use(express.json({ limit: '4mb' }));

// ---- .env 中按 X_API_KEY / X_BASE_URL / X_MODEL 前缀分组的预设（不暴露 key 本身） ----
app.get('/api/presets', (_req, res) => {
  const groups = {};
  for (const name of Object.keys(envVars)) {
    const m = name.match(/^(.+)_(API_KEY|BASE_URL|MODEL)$/);
    if (!m) continue;
    (groups[m[1]] ??= {})[m[2]] = name;
  }
  const presets = Object.entries(groups)
    .filter(([, g]) => g.API_KEY && g.BASE_URL)
    .map(([prefix, g]) => ({
      label: prefix,
      baseURL: envVars[g.BASE_URL],
      model: g.MODEL ? envVars[g.MODEL] : '',
      keyRef: `env:${g.API_KEY}`,
    }));
  res.json({ presets });
});

// 统一 OpenAI 兼容格式的转发代理：浏览器把目标 baseURL/apiKey 一并传来，
// 由服务端发起请求以规避 CORS。apiKey 可用 "env:VAR_NAME" 引用服务端 .env。
app.post('/api/chat', async (req, res) => {
  const { baseURL, apiKey, model, messages, temperature, stream } = req.body ?? {};
  if (!baseURL || !model || !Array.isArray(messages)) {
    res.status(400).json({ error: '缺少 baseURL / model / messages' });
    return;
  }
  let key = typeof apiKey === 'string' ? apiKey : '';
  if (key.startsWith('env:')) {
    const name = key.slice(4).trim();
    if (!envVars[name]) {
      res.status(400).json({ error: `.env 中找不到 ${name}（请检查项目根目录 .env 文件）` });
      return;
    }
    key = envVars[name];
  }
  let url;
  try {
    const base = String(baseURL).replace(/\/+$/, '');
    url = base.endsWith('/chat/completions') ? base : base + '/chat/completions';
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('bad protocol');
  } catch {
    res.status(400).json({ error: 'baseURL 不是合法的 http(s) 地址' });
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  // 默认不强制 temperature（部分推理模型如 kimi-k2 只接受 temperature=1）；
  // 仅当请求方显式给出数值时才透传。
  const payload = { model, messages };
  if (typeof temperature === 'number') payload.temperature = temperature;
  if (stream) payload.stream = true;

  const send = (body) =>
    fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });

  try {
    let upstream = await send(payload);

    // 兜底：若因 temperature 不被接受而 400，去掉该字段重试一次（此时只读取错误体，未消费数据流）
    if (!upstream.ok && upstream.status === 400 && 'temperature' in payload) {
      const errText = await upstream.text();
      if (/temperature/i.test(errText)) {
        const { temperature: _omit, ...stripped } = payload;
        console.log(`[proxy] ${model} temperature 被拒，去掉后重试`);
        upstream = await send(stripped);
      } else {
        // 非 temperature 的 400，直接回传
        console.log(`[proxy] ${model} @ ${url} -> HTTP 400: ${errText.slice(0, 300)}`);
        res.status(400);
        try { res.json(JSON.parse(errText)); } catch { res.json({ error: errText.slice(0, 500) }); }
        return;
      }
    }

    // ===== 流式：把上游 SSE 直接管道转发给前端 =====
    if (stream && upstream.ok && upstream.body) {
      clearTimeout(timer); // 已开始响应，改由流的生命周期管理；客户端断开则中止上游
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.on('close', () => {
        try { controller.abort(); } catch {}
      });
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    }

    // ===== 非流式（或上游出错）：缓冲后回传 JSON =====
    const text = await upstream.text();
    if (!upstream.ok) {
      console.log(`[proxy] ${model} @ ${url} -> HTTP ${upstream.status}: ${text.slice(0, 300)}`);
    }
    res.status(upstream.status);
    try {
      res.json(JSON.parse(text));
    } catch {
      res.json({ error: `上游返回非 JSON（HTTP ${upstream.status}）：${text.slice(0, 500)}` });
    }
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    console.log(`[proxy] ${model} @ ${url} -> 请求失败: ${e?.message ?? e}`);
    res.status(502).json({
      error: aborted
        ? `请求模型超时（${REQUEST_TIMEOUT_MS / 1000}s），该模型本步推理过久——可在过程实录顶部看用时；可点重试，或换更快的模型/降低手牌复杂度`
        : `请求模型失败：${e?.message ?? e}`,
    });
  } finally {
    clearTimeout(timer);
  }
});

// 生产模式：托管打包后的前端
const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// 注意：不要用通用的 PORT 环境变量 —— 预览/托管工具常会注入 PORT 导致与前端端口冲突
const port = process.env.API_PORT ?? 3001;
app.listen(port, () =>
  console.log(`[server] API 代理已启动: http://localhost:${port}（.env 预设 ${Object.keys(envVars).length ? '已加载' : '未找到'}）`),
);
