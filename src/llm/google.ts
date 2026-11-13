import type { Settings } from '../types';
import { LlmError, type LlmErrorKind, type LlmProvider, type LlmRequest } from './provider';
import { parseJson, readSse } from './sse';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Gemini counts its own reasoning against the output limit, so a small limit can leave
 * nothing for the visible reply. This much headroom is added on top of what the caller asked for.
 */
const THINKING_HEADROOM = 8192;

function kindFor(status: number, message: string): LlmErrorKind {
  if (status === 401 || status === 403 || /api key/i.test(message)) return 'auth';
  if (status === 429 || /quota|billing/i.test(message)) return 'quota';
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

/** Visible text of one response object (a whole reply, or one streamed piece). */
function textOf(body: Record<string, any> | null): string {
  const parts: { text?: string; thought?: boolean }[] = body?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

/** Why a response carried no text, when the API says so. Shown to the user as is; never retried. */
function blockReason(body: Record<string, any> | null): string | null {
  const reason = body?.promptFeedback?.blockReason ?? body?.candidates?.[0]?.finishReason;
  return typeof reason === 'string' && reason !== 'STOP' ? reason : null;
}

const blocked = (reason: string) => new LlmError('other', `모델이 답변하지 않았습니다 (사유: ${reason})`);

export function createGoogleProvider(
  s: Pick<Settings, 'apiKey' | 'model'>,
  fetchFn: typeof fetch = (...a) => fetch(...a),
): LlmProvider {
  async function send(req: LlmRequest, method: string): Promise<Response> {
    const messages = req.messages.length ? req.messages : [{ role: 'user' as const, content: '(대화 시작)' }];
    let res: Response;
    try {
      res = await fetchFn(`${BASE}/${encodeURIComponent(s.model)}:${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': s.apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: req.system }] },
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: { maxOutputTokens: req.maxTokens + THINKING_HEADROOM },
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
      const body = await (await send(req, 'generateContent')).json();
      const text = textOf(body);
      const reason = blockReason(body);
      if (!text && reason) throw blocked(reason);
      return text;
    },

    async stream(req, onDelta) {
      const res = await send(req, 'streamGenerateContent?alt=sse');
      let full = '';
      let reason: string | null = null;
      await readSse(res, (data) => {
        const body = parseJson(data);
        const text = textOf(body);
        if (text) {
          full += text;
          onDelta(text);
        }
        reason = blockReason(body) ?? reason;
      });
      if (!full && reason) throw blocked(reason);
      return full;
    },
  };
}
