import type { AIResponse, ApiConfig } from '../types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 经由本地后端代理调用任意 OpenAI 兼容端点 */
export async function callModel(cfg: ApiConfig, messages: ChatMessage[]): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('模型返回了空内容');
  }
  return content;
}

/** 从模型输出里提取 {speech, action} JSON（容忍代码块围栏与前后杂文） */
export function parseAIResponse(text: string): AIResponse {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('输出中找不到 JSON 对象');
  let obj: unknown;
  try {
    obj = JSON.parse(t.slice(start, end + 1));
  } catch {
    throw new Error('JSON 解析失败，请确保输出是一个合法 JSON 对象');
  }
  if (typeof obj !== 'object' || obj === null) throw new Error('输出不是 JSON 对象');
  const r = obj as Record<string, unknown>;
  const action =
    typeof r.action === 'object' && r.action !== null ? (r.action as Record<string, unknown>) : {};
  const speech = typeof r.speech === 'string' && r.speech.trim() ? r.speech.trim() : undefined;
  return { speech, action };
}
