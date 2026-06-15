import type { AIResponse, ApiConfig } from '../types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelReply {
  content: string;
  /** 推理模型的思考过程（OpenAI 兼容字段 reasoning_content / reasoning） */
  reasoning?: string;
}

/** 经由本地后端代理调用任意 OpenAI 兼容端点 */
export async function callModel(cfg: ApiConfig, messages: ChatMessage[]): Promise<ModelReply> {
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
  const msg = data?.choices?.[0]?.message;
  const content = msg?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('模型返回了空内容');
  }
  const rawReasoning = msg?.reasoning_content ?? msg?.reasoning;
  const reasoning =
    typeof rawReasoning === 'string' && rawReasoning.trim() ? rawReasoning.trim() : undefined;
  return { content, reasoning };
}

/**
 * 流式调用：边生成边把累积的思维链回调给 onReasoning，结束后返回完整 {content, reasoning}。
 * 用于在 UI 上实时展示推理模型的思考，避免干等。
 */
export async function callModelStream(
  cfg: ApiConfig,
  messages: ChatMessage[],
  onReasoning?: (accumulated: string) => void,
): Promise<ModelReply> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    const detail = data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';

  const handleData = (jsonStr: string) => {
    if (jsonStr === '[DONE]') return;
    let obj: unknown;
    try {
      obj = JSON.parse(jsonStr);
    } catch {
      return; // 忽略非 JSON 的 keep-alive 等
    }
    const delta = (obj as { choices?: { delta?: Record<string, unknown> }[] })?.choices?.[0]?.delta;
    if (!delta) return;
    const r = delta.reasoning_content ?? delta.reasoning;
    if (typeof r === 'string') {
      reasoning += r;
      onReasoning?.(reasoning);
    }
    if (typeof delta.content === 'string') content += delta.content;
  };

  // 解析 SSE：按行读，处理以 "data:" 开头的行
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('data:')) handleData(line.slice(5).trim());
    }
  }
  if (buffer.trim().startsWith('data:')) handleData(buffer.trim().slice(5).trim());

  if (!content.trim()) {
    // 有些模型只在 reasoning 里输出（异常情况）；没有 content 视为失败
    throw new Error('模型流式返回了空内容');
  }
  return { content, reasoning: reasoning.trim() || undefined };
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
  const thought = typeof r.thought === 'string' && r.thought.trim() ? r.thought.trim() : undefined;
  return { thought, speech, action };
}
