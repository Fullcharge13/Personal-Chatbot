import type { LlmProvider, LlmRequest } from './provider';

/** Test double: returns the scripted replies in order; an Error entry is thrown. */
export function createFakeProvider(replies: (string | Error)[]): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  let i = 0;
  const next = async (req: LlmRequest) => {
    calls.push(req);
    if (i >= replies.length) throw new Error('fake provider ran out of replies');
    const r = replies[i++];
    if (r instanceof Error) throw r;
    return r;
  };
  return {
    calls,
    complete: next,
    async stream(req, onDelta) {
      const text = await next(req);
      onDelta(text);
      return text;
    },
  };
}
