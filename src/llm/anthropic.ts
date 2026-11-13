import type { Settings } from '../types';
import { LlmError, type LlmErrorKind, type LlmProvider, type LlmRequest } from './provider';

const URL = 'https://api.anthropic.com/v1/messages';

function kindFor(status: number, message: string): LlmErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429 || /credit|billing|quota/i.test(message)) return 'quota';
  return 'other';
}

async function toError(res: Response): Promise<LlmError> {
  let message = `요청이 실패했습니다 (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.error?.message === 'string') message = body.error.message;
  } catch {
    // keep the generic message
  }
  return new LlmError(kindFor(res.status, message), message);
}

export function createAnthropicProvider(
  s: Pick<Settings, 'apiKey' | 'model'>,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): LlmProvider {
  async function send(req: LlmRequest, stream: boolean): Promise<Response> {
    const messages = req.messages.length ? req.messages : [{ role: 'user' as const, content: '(대화 시작)' }];
    let res: Response;
    try {
      res = await fetchFn(URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': s.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: s.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages,
          ...(stream ? { stream: true } : {}),
        }),
      });
    } catch (e) {
      throw new LlmError('network', e instanceof Error ? e.message : '네트워크 오류');
    }
    if (!res.ok) throw await toError(res);
    return res;
  }

  return {
    async complete(req) {
      const res = await send(req, false);
      const body = await res.json();
      const parts: { type: string; text?: string }[] = Array.isArray(body?.content) ? body.content : [];
      return parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text ?? '')
        .join('');
    },

    async stream(req, onDelta) {
      const res = await send(req, true);
      if (!res.body) throw new LlmError('other', '응답 본문이 없습니다');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
      const handle = (line: string) => {
        if (!line.startsWith('data:')) return;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            full += ev.delta.text;
            onDelta(ev.delta.text);
          } else if (ev.type === 'error') {
            throw new LlmError('other', ev.error?.message ?? '스트림 오류');
          }
        } catch (e) {
          if (e instanceof LlmError) throw e;
        }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          lines.forEach(handle);
        }
      } catch (e) {
        if (e instanceof LlmError) throw e;
        throw new LlmError('network', e instanceof Error ? e.message : '네트워크 오류');
      }
      if (buffer) handle(buffer);
      return full;
    },
  };
}
