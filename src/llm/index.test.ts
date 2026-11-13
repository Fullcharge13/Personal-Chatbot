import { createProvider } from './index';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const req = { system: 's', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 10 };

test('anthropic settings call the Anthropic API', async () => {
  const fetchFn = vi.fn(async (..._a: unknown[]) => ok({ content: [{ type: 'text', text: 'a' }] }));
  const llm = createProvider({ apiKey: 'k', provider: 'anthropic', model: 'm' }, fetchFn as unknown as typeof fetch);
  expect(await llm.complete(req)).toBe('a');
  expect((fetchFn.mock.calls[0] as [string])[0]).toBe('https://api.anthropic.com/v1/messages');
});

test('google settings call the Gemini API', async () => {
  const fetchFn = vi.fn(async (..._a: unknown[]) => ok({ candidates: [{ content: { parts: [{ text: 'g' }] } }] }));
  const llm = createProvider({ apiKey: 'k', provider: 'google', model: 'm' }, fetchFn as unknown as typeof fetch);
  expect(await llm.complete(req)).toBe('g');
  expect((fetchFn.mock.calls[0] as [string])[0]).toContain('generativelanguage.googleapis.com');
});
