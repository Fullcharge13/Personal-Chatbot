import { consolidate } from './consolidate';
import * as s from '../db/store';
import { createFakeProvider } from '../llm/fake';
import { LlmError } from '../llm/provider';
import { sheet } from '../test-helpers';

let pid: string;
beforeEach(async () => {
  await s.wipeAll();
  pid = (await s.createPersona(sheet('지수'))).id;
});

const reply = (o: object) => JSON.stringify(o);
async function seed() {
  await s.addMessage({ personaId: pid, sender: 'user', text: '금요일에 면접 결과 나와', at: 1 });
  await s.addMessage({ personaId: pid, sender: 'persona', text: '오 떨리겠다', at: 2 });
}

test('no unconsolidated messages → "nothing", llm not called', async () => {
  const fake = createFakeProvider([]);
  expect(await consolidate(pid, fake)).toBe('nothing');
  expect(fake.calls).toHaveLength(0);
});

test('saves summary, memories (source "chat"), threads; marks messages consolidated', async () => {
  await seed();
  await s.saveSummary(pid, '이전 요약');
  const fake = createFakeProvider([
    reply({
      summary: '면접 결과를 기다리는 중',
      memories: [{ text: '삼성 면접을 봤다', date: '2026-11-10', keywords: ['면접', '삼성'] }],
      threads: ['금요일 면접 결과'],
    }),
  ]);
  expect(await consolidate(pid, fake)).toBe('done');
  expect((await s.getSummary(pid))!.text).toBe('면접 결과를 기다리는 중');
  const mems = await s.listMemories(pid);
  expect(mems).toHaveLength(1);
  expect(mems[0]).toMatchObject({ source: 'chat', text: '삼성 면접을 봤다', date: '2026-11-10', keywords: ['면접', '삼성'] });
  expect((await s.listOpenThreads(pid)).map((t) => t.text)).toEqual(['금요일 면접 결과']);
  expect(await s.listUnconsolidated(pid)).toHaveLength(0);
  const sent = fake.calls[0].messages[0].content;
  expect(sent).toContain('이전 요약');
  expect(sent).toContain('금요일에 면접 결과 나와');
});

test('LlmError → "failed", nothing saved, messages stay unconsolidated', async () => {
  await seed();
  const fake = createFakeProvider([new LlmError('network', 'x')]);
  expect(await consolidate(pid, fake)).toBe('failed');
  expect(await s.listUnconsolidated(pid)).toHaveLength(2);
  expect(await s.getSummary(pid)).toBeUndefined();
});

test('malformed JSON → "failed", messages stay unconsolidated', async () => {
  await seed();
  expect(await consolidate(pid, createFakeProvider(['요약하기 어렵네요']))).toBe('failed');
  expect(await s.listUnconsolidated(pid)).toHaveLength(2);
});

test('fenced JSON is accepted', async () => {
  await seed();
  const fake = createFakeProvider(['```json\n' + reply({ summary: '요약', memories: [], threads: [] }) + '\n```']);
  expect(await consolidate(pid, fake)).toBe('done');
});

test('missing "threads" or "memories" keys are treated as empty arrays', async () => {
  await seed();
  expect(await consolidate(pid, createFakeProvider([reply({ summary: '요약만' })]))).toBe('done');
  expect(await s.listMemories(pid)).toHaveLength(0);
  expect(await s.listOpenThreads(pid)).toHaveLength(0);
  expect((await s.getSummary(pid))!.text).toBe('요약만');
});

test('a reply without a summary string keeps the previous summary', async () => {
  await seed();
  await s.saveSummary(pid, '이전 요약');
  expect(await consolidate(pid, createFakeProvider([reply({ memories: [], threads: ['화제'] })]))).toBe('done');
  expect((await s.getSummary(pid))!.text).toBe('이전 요약');
});

test('failed (unsent) user messages are not sent to the model', async () => {
  await seed();
  const bad = await s.addMessage({ personaId: pid, sender: 'user', text: '전송 실패한 말', at: 3 });
  await s.updateMessage(bad.id, { failed: true });
  const fake = createFakeProvider([reply({ summary: 's' })]);
  await consolidate(pid, fake);
  expect(fake.calls[0].messages[0].content).not.toContain('전송 실패한 말');
});

test('concurrent calls for the same persona run the llm once', async () => {
  await seed();
  const fake = createFakeProvider([reply({ summary: 's' }), reply({ summary: 's2' })]);
  await Promise.all([consolidate(pid, fake), consolidate(pid, fake)]);
  expect(fake.calls).toHaveLength(1);
});
