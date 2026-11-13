import { createGoogleProvider } from './google';
import { LlmError } from './provider';

const req = {
  system: 's',
  messages: [
    { role: 'user' as const, content: 'hi' },
    { role: 'assistant' as const, content: 'yo' },
    { role: 'user' as const, content: 'again' },
  ],
  maxTokens: 100,
};
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gm';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function sseResponse(chunks: string[]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        chunks.forEach((ch) => c.enqueue(enc.encode(ch)));
        c.close();
      },
    }),
    { status: 200 },
  );
}
const reply = (...parts: object[]) => ({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] });
const sse = (...parts: object[]) => `data: ${JSON.stringify(reply(...parts))}\n\n`;

function setup(response: Response | Error) {
  const fetchFn = vi.fn(async (..._a: unknown[]) => {
    if (response instanceof Error) throw response;
    return response;
  });
  const llm = createGoogleProvider({ apiKey: 'gk', model: 'gm' }, fetchFn as unknown as typeof fetch);
  return { fetchFn, llm };
}
function sent(fetchFn: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
}

test('sends the key in a header and maps system, roles and output limit', async () => {
  const { fetchFn, llm } = setup(jsonResponse(200, reply({ text: '안녕' })));
  expect(await llm.complete(req)).toBe('안녕');
  const { url, headers, body } = sent(fetchFn);
  expect(url).toBe(`${BASE}:generateContent`);
  expect(url).not.toContain('gk');
  expect(headers['x-goog-api-key']).toBe('gk');
  expect(body.system_instruction).toEqual({ parts: [{ text: 's' }] });
  expect(body.contents).toEqual([
    { role: 'user', parts: [{ text: 'hi' }] },
    { role: 'model', parts: [{ text: 'yo' }] },
    { role: 'user', parts: [{ text: 'again' }] },
  ]);
  // room for the model's own reasoning on top of the visible reply
  expect(body.generationConfig.maxOutputTokens).toBe(100 + 8192);
});

test('empty messages array is sent as a single user turn "(대화 시작)"', async () => {
  const { fetchFn, llm } = setup(jsonResponse(200, reply({ text: 'x' })));
  await llm.complete({ ...req, messages: [] });
  expect(sent(fetchFn).body.contents).toEqual([{ role: 'user', parts: [{ text: '(대화 시작)' }] }]);
});

test('joins text parts and skips thought parts', async () => {
  const { llm } = setup(jsonResponse(200, reply({ text: '생각 중', thought: true }, { text: '안' }, { text: '녕' })));
  expect(await llm.complete(req)).toBe('안녕');
});

test('400 "API key not valid" and 403 → kind auth', async () => {
  const a = setup(jsonResponse(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }));
  await expect(a.llm.complete(req)).rejects.toMatchObject({ kind: 'auth' });
  const b = setup(jsonResponse(403, { error: { message: 'Permission denied' } }));
  await expect(b.llm.complete(req)).rejects.toMatchObject({ kind: 'auth' });
});

test('429 → kind quota with the provider message verbatim', async () => {
  const { llm } = setup(jsonResponse(429, { error: { message: 'Quota exceeded for quota metric' } }));
  const err = await llm.complete(req).catch((e) => e);
  expect(err).toBeInstanceOf(LlmError);
  expect(err).toMatchObject({ kind: 'quota', message: 'Quota exceeded for quota metric' });
});

test('fetch rejects → network; 500 → other; other 400 → other', async () => {
  await expect(setup(new TypeError('Failed to fetch')).llm.complete(req)).rejects.toMatchObject({ kind: 'network' });
  await expect(setup(jsonResponse(500, { error: { message: 'boom' } })).llm.complete(req)).rejects.toMatchObject({ kind: 'other' });
  await expect(
    setup(jsonResponse(400, { error: { message: 'model not found' } })).llm.complete(req),
  ).rejects.toMatchObject({ kind: 'other', message: 'model not found' });
});

test('a blocked prompt is reported once, with the reason, and not retried', async () => {
  const { fetchFn, llm } = setup(jsonResponse(200, { promptFeedback: { blockReason: 'SAFETY' } }));
  const err = await llm.complete(req).catch((e) => e);
  expect(err).toBeInstanceOf(LlmError);
  expect(err.kind).toBe('other');
  expect(err.message).toContain('SAFETY');
  expect(fetchFn).toHaveBeenCalledTimes(1);
});

test('a candidate cut off with no text reports its finish reason', async () => {
  const { llm } = setup(jsonResponse(200, { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] }));
  await expect(llm.complete(req)).rejects.toMatchObject({ kind: 'other', message: expect.stringContaining('PROHIBITED_CONTENT') });
});

test('stream uses the SSE endpoint, calls onDelta per chunk, skips thoughts, returns joined text', async () => {
  const { fetchFn, llm } = setup(sseResponse([sse({ text: '음', thought: true }), sse({ text: '안' }), sse({ text: '녕' })]));
  const deltas: string[] = [];
  expect(await llm.stream(req, (t) => deltas.push(t))).toBe('안녕');
  expect(deltas).toEqual(['안', '녕']);
  expect(sent(fetchFn).url).toBe(`${BASE}:streamGenerateContent?alt=sse`);
});

test('stream handles an event split across two chunks and CRLF line endings', async () => {
  const full = sse({ text: '안녕하세요' }).replace(/\n/g, '\r\n');
  const { llm } = setup(sseResponse([full.slice(0, 30), full.slice(30)]));
  expect(await llm.stream(req, () => {})).toBe('안녕하세요');
});

test('a stream blocked before any text reports the reason', async () => {
  const { llm } = setup(sseResponse([`data: ${JSON.stringify({ promptFeedback: { blockReason: 'OTHER' } })}\n\n`]));
  await expect(llm.stream(req, () => {})).rejects.toMatchObject({ kind: 'other', message: expect.stringContaining('OTHER') });
});

test('model names are URL-encoded', async () => {
  const fetchFn = vi.fn(async (..._a: unknown[]) => jsonResponse(200, reply({ text: 'x' })));
  await createGoogleProvider({ apiKey: 'k', model: 'a/b?c' }, fetchFn as unknown as typeof fetch).complete(req);
  expect((fetchFn.mock.calls[0] as [string])[0]).toContain('/models/a%2Fb%3Fc:generateContent');
});
