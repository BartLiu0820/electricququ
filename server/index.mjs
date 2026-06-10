import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const app = express();
app.use(express.json({ limit: '4mb' }));

// 统一 OpenAI 兼容格式的转发代理：浏览器把目标 baseURL/apiKey 一并传来，
// 由服务端发起请求以规避 CORS。apiKey 不在服务端持久化。
app.post('/api/chat', async (req, res) => {
  const { baseURL, apiKey, model, messages, temperature } = req.body ?? {};
  if (!baseURL || !model || !Array.isArray(messages)) {
    res.status(400).json({ error: '缺少 baseURL / model / messages' });
    return;
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
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, temperature: temperature ?? 0.8 }),
      signal: controller.signal,
    });
    const text = await upstream.text();
    res.status(upstream.status);
    try {
      res.json(JSON.parse(text));
    } catch {
      res.json({ error: `上游返回非 JSON（HTTP ${upstream.status}）：${text.slice(0, 500)}` });
    }
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    res.status(502).json({ error: aborted ? '请求模型超时（180s）' : `请求模型失败：${e?.message ?? e}` });
  } finally {
    clearTimeout(timer);
  }
});

// 生产模式：托管打包后的前端
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = process.env.PORT ?? 3001;
app.listen(port, () => console.log(`[server] API 代理已启动: http://localhost:${port}`));
