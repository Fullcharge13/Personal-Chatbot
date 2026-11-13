import { generateOpener, openIfDue, shouldOpen, type OpenerInput } from './opener';
import * as s from '../db/store';
import { createFakeProvider } from '../llm/fake';
import { LlmError } from '../llm/provider';
import { sheet } from '../test-helpers';
import type { Persona, Thread } from '../types';

const HOUR = 3_600_000;
const NOW = new Date(2026, 10, 13, 21, 30).getTime();

const persona: Persona = { ...sheet('지수'), id: 'p', speechSamples: [], active: true, createdAt: 0 };
const thread = (id: string, text: string, createdAt: number): Thread => ({ id, personaId: 'p', text, createdAt, used: false });
const input = (o: Partial<OpenerInput> = {}): OpenerInput => ({
  persona, profile: [], threads: [], memories: [], lastMessageAt: NOW - 5 * HOUR, now: NOW, ...o,
});

test('shouldOpen: 59분 → false, 60분 → true, 메시지 없음 → true', () => {
  expect(shouldOpen(NOW - 59 * 60_000, NOW)).toBe(false);
  expect(shouldOpen(NOW - 60 * 60_000, NOW)).toBe(true);
  expect(shouldOpen(undefined, NOW)).toBe(true);
});

describe('generateOpener', () => {
  test('with open threads: the oldest thread text is in the request and its id is returned', async () => {
    const fake = createFakeProvider(['면접 결과 나왔어?']);
    const r = await generateOpener(input({ threads: [thread('t2', '이사 준비', 20), thread('t1', '금요일 면접 결과', 10)] }), fake);
    expect(r).toEqual({ text: '면접 결과 나왔어?', usedThreadId: 't1' });
    expect(fake.calls[0].messages[0].content).toContain('금요일 면접 결과');
    expect(fake.calls[0].system).toContain('당신은 지수입니다');
  });

  test('without threads: request mentions the gap length and time of day; usedThreadId undefined', async () => {
    const fake = createFakeProvider(['뭐해?']);
    const r = await generateOpener(input(), fake);
    expect(r).toEqual({ text: '뭐해?', usedThreadId: undefined });
    const content = fake.calls[0].messages[0].content;
    expect(content).toContain('5시간');
    expect(content).toContain('밤');
  });

  test('gap is described in days when longer than a day', async () => {
    const fake = createFakeProvider(['오랜만이야']);
    await generateOpener(input({ lastMessageAt: NOW - 3 * 24 * HOUR }), fake);
    expect(fake.calls[0].messages[0].content).toContain('3일');
  });

  test('first ever conversation is described as such', async () => {
    const fake = createFakeProvider(['안녕']);
    await generateOpener(input({ lastMessageAt: undefined }), fake);
    expect(fake.calls[0].messages[0].content).toContain('첫 대화');
  });

  test('reply is trimmed; empty reply → null', async () => {
    expect(await generateOpener(input(), createFakeProvider(['  뭐해?\n']))).toMatchObject({ text: '뭐해?' });
    expect(await generateOpener(input(), createFakeProvider(['   ']))).toBeNull();
  });

  test('LlmError → null', async () => {
    expect(await generateOpener(input(), createFakeProvider([new LlmError('network', 'x')]))).toBeNull();
  });
});

describe('openIfDue', () => {
  let pid: string;
  beforeEach(async () => {
    await s.wipeAll();
    pid = (await s.createPersona(sheet('지수'))).id;
  });
  const personaMessages = async () => (await s.listMessages(pid)).filter((m) => m.sender === 'persona');

  test('saves one persona message and marks the thread used', async () => {
    await s.addMessage({ personaId: pid, sender: 'user', text: '잘자', at: NOW - 2 * HOUR });
    await s.addThreads(pid, ['금요일 면접 결과']);
    const m = await openIfDue(pid, createFakeProvider(['면접 결과 나왔어?']), NOW);
    expect(m).toMatchObject({ sender: 'persona', text: '면접 결과 나왔어?', at: NOW });
    expect(await personaMessages()).toHaveLength(1);
    expect(await s.listOpenThreads(pid)).toHaveLength(0);
  });

  test('opens on the very first visit', async () => {
    expect(await openIfDue(pid, createFakeProvider(['안녕']), NOW)).toMatchObject({ text: '안녕' });
  });

  test('returns null when the gap is under one hour', async () => {
    await s.addMessage({ personaId: pid, sender: 'user', text: '응', at: NOW - 10 * 60_000 });
    const fake = createFakeProvider(['x']);
    expect(await openIfDue(pid, fake, NOW)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  test('returns null when the last message is an unanswered persona message', async () => {
    await s.addMessage({ personaId: pid, sender: 'persona', text: '뭐해?', at: NOW - 5 * HOUR });
    const fake = createFakeProvider(['x']);
    expect(await openIfDue(pid, fake, NOW)).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  test('llm failure saves nothing and leaves the thread open', async () => {
    await s.addThreads(pid, ['화제']);
    expect(await openIfDue(pid, createFakeProvider([new LlmError('network', 'x')]), NOW)).toBeNull();
    expect(await personaMessages()).toHaveLength(0);
    expect(await s.listOpenThreads(pid)).toHaveLength(1);
  });

  test('unknown persona id → null', async () => {
    expect(await openIfDue('nope', createFakeProvider(['x']), NOW)).toBeNull();
  });

  test('two concurrent calls save exactly one message', async () => {
    const fake = createFakeProvider(['안녕', '또 안녕']);
    await Promise.all([openIfDue(pid, fake, NOW), openIfDue(pid, fake, NOW)]);
    expect(await personaMessages()).toHaveLength(1);
  });

  test('a used thread is not reused on the next open', async () => {
    await s.addThreads(pid, ['금요일 면접 결과']);
    await openIfDue(pid, createFakeProvider(['면접 결과 나왔어?']), NOW);
    await s.addMessage({ personaId: pid, sender: 'user', text: '붙었어', at: NOW + 1000 });
    const fake = createFakeProvider(['축하해']);
    await openIfDue(pid, fake, NOW + 3 * HOUR);
    expect(fake.calls[0].messages[0].content).not.toContain('금요일 면접 결과');
  });
});
