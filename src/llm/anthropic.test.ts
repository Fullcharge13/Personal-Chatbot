import { createAnthropicProvider } from './anthropic';
import { LlmError } from './provider';

const req = { system: 's', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 100 };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function sseResponse(chunks: string[]) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      chunks.forEach((ch) => c.enqueue(enc.encode(ch)));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}
const delta = (t: string) =>
  `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })}\n\n`;

function setup(response: Response | Error) {
  const fetchFn = vi.fn(async (..._a: unknown[]) => {
    if (response instanceof Error) throw response;
    return response;
  });
  const llm = createAnthropicProvider({ apiKey: 'k', model: 'm' }, fetchFn as unknown as typeof fetch);
  return { fetchFn, llm };
}
function sent(fetchFn: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
}

test('sends required headers and body', async () => {
  const { fetchFn, llm } = setup(jsonResponse(200, { content: [{ type: 'text', text: '안녕' }] }));
  const result = await llm.complete(req);
  const { url, headers, body } = sent(fetchFn);
  expect(url).toBe('https://api.anthropic.com/v1/messages');
  expect(headers['x-api-key']).toBe('k');
  expect(headers['anthropic-version']).toBe('2023-06-01');
  expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(body).toMatchObject({ model: 'm', max_tokens: 100, system: 's', messages: [{ role: 'user', content: 'hi' }] });
  expect(result).toBe('안녕');
});

test('empty messages array is sent as a single user turn "(대화 시작)"', async () => {
  const { fetchFn, llm } = setup(jsonResponse(200, { content: [{ type: 'text', text: 'x' }] }));
  await llm.complete({ ...req, messages: [] });
  expect(sent(fetchFn).body.messages).toEqual([{ role: 'user', content: '(대화 시작)' }]);
});

test('401 → LlmError kind auth', async () => {
  const { llm } = setup(jsonResponse(401, { error: { message: 'invalid x-api-key' } }));
  await expect(llm.complete(req)).rejects.toMatchObject({ kind: 'auth' });
});

test('429 → kind quota, message is the provider error message verbatim', async () => {
  const { llm } = setup(jsonResponse(429, { error: { message: 'rate limit reached' } }));
  const err = await llm.complete(req).catch((e) => e);
  expect(err).toBeInstanceOf(LlmError);
  expect(err.kind).toBe('quota');
  expect(err.message).toBe('rate limit reached');
});

test('400 with a billing message → kind quota', async () => {
  const { llm } = setup(jsonResponse(400, { error: { message: 'Your credit balance is too low' } }));
  await expect(llm.complete(req)).rejects.toMatchObject({ kind: 'quota', message: 'Your credit balance is too low' });
});

test('fetch rejects → kind network', async () => {
  const { llm } = setup(new TypeError('Failed to fetch'));
  await expect(llm.complete(req)).rejects.toMatchObject({ kind: 'network' });
});

test('500 → kind other', async () => {
  const { llm } = setup(jsonResponse(500, { error: { message: 'boom' } }));
  await expect(llm.complete(req)).rejects.toMatchObject({ kind: 'other' });
});

test('non-JSON error body still yields an LlmError', async () => {
  const { llm } = setup(new Response('<html>bad gateway</html>', { status: 502 }));
  await expect(llm.complete(req)).rejects.toMatchObject({ kind: 'other' });
});

test('stream parses SSE deltas, calls onDelta per chunk, returns joined text', async () => {
  const { fetchFn, llm } = setup(sseResponse([delta('안'), delta('녕'), 'event: message_stop\ndata: {"type":"message_stop"}\n\n']));
  const deltas: string[] = [];
  const result = await llm.stream(req, (t) => deltas.push(t));
  expect(sent(fetchFn).body.stream).toBe(true);
  expect(deltas).toEqual(['안', '녕']);
  expect(result).toBe('안녕');
});

test('stream handles an SSE event split across two chunks', async () => {
  const full = delta('안녕하세요');
  const { llm } = setup(sseResponse([full.slice(0, 40), full.slice(40)]));
  const deltas: string[] = [];
  expect(await llm.stream(req, (t) => deltas.push(t))).toBe('안녕하세요');
  expect(deltas).toEqual(['안녕하세요']);
});

test('stream error status → LlmError', async () => {
  const { llm } = setup(jsonResponse(401, { error: { message: 'no' } }));
  await expect(llm.stream(req, () => {})).rejects.toMatchObject({ kind: 'auth' });
});

test('a refusal text is returned as-is with no retry', async () => {
  const { fetchFn, llm } = setup(jsonResponse(200, { content: [{ type: 'text', text: '그 요청은 도와드릴 수 없어요.' }] }));
  expect(await llm.complete(req)).toBe('그 요청은 도와드릴 수 없어요.');
  expect(fetchFn).toHaveBeenCalledTimes(1);
});
