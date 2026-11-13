import * as s from './store';
import { sheet, mem } from '../test-helpers';

beforeEach(() => s.wipeAll());

test('settings default', async () => {
  expect(await s.getSettings()).toEqual({ apiKey: '', provider: 'anthropic', model: 'claude-sonnet-5-5' });
});

test('settings persist', async () => {
  await s.saveSettings({ apiKey: 'k', provider: 'anthropic', model: 'm' });
  expect(await s.getSettings()).toEqual({ apiKey: 'k', provider: 'anthropic', model: 'm' });
});

test('profile always returns four entries in order, saved text persists', async () => {
  await s.saveProfileEntry('hobby', '등산');
  const p = await s.getProfile();
  expect(p.map((e) => e.key)).toEqual(['basic', 'resume', 'hobby', 'story']);
  expect(p.map((e) => e.label)).toEqual(['기본 정보', '이력서', '취미', '과거 이야기']);
  expect(p[2].text).toBe('등산');
  expect(p[0].text).toBe('');
});

test('createPersona activates the new one and deactivates the old; old data remains', async () => {
  const a = await s.createPersona(sheet('A'));
  await s.addMemories(a.id, [mem('a기억')]);
  await s.addMessage({ personaId: a.id, sender: 'user', text: '안녕', at: 1 });
  const b = await s.createPersona(sheet('B'));
  expect((await s.getActivePersona())!.id).toBe(b.id);
  expect(await s.listMemories(a.id)).toHaveLength(1);
  expect(await s.listMemories(b.id)).toHaveLength(0);
  expect(await s.listMessages(b.id)).toHaveLength(0);
  expect(await s.listMessages(a.id)).toHaveLength(1);
});

test('no persona → getActivePersona is undefined', async () => {
  expect(await s.getActivePersona()).toBeUndefined();
});

test('updatePersona patches fields', async () => {
  const a = await s.createPersona(sheet('A'));
  await s.updatePersona(a.id, { personality: '무뚝뚝함' });
  expect((await s.getActivePersona())!.personality).toBe('무뚝뚝함');
});

test('speechSamples are capped at 30', async () => {
  const many = Array.from({ length: 40 }, (_, i) => `말${i}`);
  const a = await s.createPersona(sheet('A'), many);
  expect(a.speechSamples).toHaveLength(30);
  await s.updatePersona(a.id, { speechSamples: many });
  expect((await s.getActivePersona())!.speechSamples).toHaveLength(30);
});

test('listMemories is newest first; deleteMemory removes one', async () => {
  const a = await s.createPersona(sheet('A'));
  await s.addMemories(a.id, [mem('하나')]);
  await new Promise((r) => setTimeout(r, 5));
  await s.addMemories(a.id, [mem('둘')]);
  const list = await s.listMemories(a.id);
  expect(list.map((m) => m.text)).toEqual(['둘', '하나']);
  await s.deleteMemory(list[0].id);
  expect((await s.listMemories(a.id)).map((m) => m.text)).toEqual(['하나']);
});

test('listMessages(limit) returns the last N in chronological order', async () => {
  const a = await s.createPersona(sheet('A'));
  for (let i = 1; i <= 5; i++) await s.addMessage({ personaId: a.id, sender: 'user', text: `m${i}`, at: i });
  expect((await s.listMessages(a.id, 2)).map((m) => m.text)).toEqual(['m4', 'm5']);
  expect((await s.listMessages(a.id)).map((m) => m.text)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
});

test('updateMessage patches a message', async () => {
  const a = await s.createPersona(sheet('A'));
  const m = await s.addMessage({ personaId: a.id, sender: 'user', text: 'x', at: 1 });
  await s.updateMessage(m.id, { failed: true });
  expect((await s.listMessages(a.id))[0].failed).toBe(true);
});

test('listOpenThreads excludes used threads, oldest first', async () => {
  const a = await s.createPersona(sheet('A'));
  await s.addThreads(a.id, ['면접 결과', '이사']);
  const open = await s.listOpenThreads(a.id);
  expect(open.map((t) => t.text)).toEqual(['면접 결과', '이사']);
  await s.markThreadUsed(open[0].id);
  expect((await s.listOpenThreads(a.id)).map((t) => t.text)).toEqual(['이사']);
});

test('markConsolidated removes messages from listUnconsolidated', async () => {
  const a = await s.createPersona(sheet('A'));
  const m1 = await s.addMessage({ personaId: a.id, sender: 'user', text: 'x', at: 1 });
  await s.addMessage({ personaId: a.id, sender: 'persona', text: 'y', at: 2 });
  await s.markConsolidated([m1.id]);
  expect((await s.listUnconsolidated(a.id)).map((m) => m.text)).toEqual(['y']);
});

test('summary save and get', async () => {
  const a = await s.createPersona(sheet('A'));
  expect(await s.getSummary(a.id)).toBeUndefined();
  await s.saveSummary(a.id, '요약');
  expect((await s.getSummary(a.id))!.text).toBe('요약');
});

test('each provider keeps its own key and model', async () => {
  await s.saveSettings({ apiKey: 'ant-key', provider: 'anthropic', model: 'claude-x' });
  await s.saveSettings({ apiKey: 'goo-key', provider: 'google', model: 'gemini-x' });
  expect(await s.getSettings()).toEqual({ apiKey: 'goo-key', provider: 'google', model: 'gemini-x' });
  expect(await s.getProviderSettings('anthropic')).toEqual({ apiKey: 'ant-key', model: 'claude-x' });
  expect(await s.getProviderSettings('google')).toEqual({ apiKey: 'goo-key', model: 'gemini-x' });
});

test('a provider never saved gets an empty key and its own default model', async () => {
  expect(await s.getProviderSettings('google')).toEqual({ apiKey: '', model: 'gemini-3.8-flash' });
  expect(await s.getProviderSettings('anthropic')).toEqual({ apiKey: '', model: 'claude-sonnet-5-5' });
});

test('settings saved before providers existed still load', async () => {
  await s.db.settings.put({ id: 'main', apiKey: 'old', provider: 'anthropic', model: 'm' } as never);
  expect(await s.getSettings()).toEqual({ apiKey: 'old', provider: 'anthropic', model: 'm' });
  expect(await s.getProviderSettings('anthropic')).toEqual({ apiKey: 'old', model: 'm' });
});
