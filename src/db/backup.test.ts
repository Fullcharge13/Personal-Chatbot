import { exportBackup, importBackup, inspectBackup } from './backup';
import * as s from './store';
import { mem, sheet } from '../test-helpers';

beforeEach(() => s.wipeAll());

async function seed() {
  await s.saveSettings({ apiKey: 'sk-secret', provider: 'anthropic', model: 'my-model' });
  await s.saveProfileEntry('hobby', '등산');
  const p = await s.createPersona(sheet('지수'), ['헐']);
  await s.addMemories(p.id, [mem('제주도 감', ['제주도'])]);
  await s.addThreads(p.id, ['면접 결과']);
  await s.addMessage({ personaId: p.id, sender: 'user', text: '안녕', at: 1 });
  await s.saveSummary(p.id, '요약');
  return p;
}

test('export does not contain the api key', async () => {
  await seed();
  const json = await exportBackup();
  expect(json).not.toContain('sk-secret');
  expect(JSON.parse(json).version).toBe(1);
  expect(JSON.parse(json).settings).toEqual({ provider: 'anthropic', model: 'my-model' });
});

test('round trip restores personas, memories, messages, threads, summaries, profile', async () => {
  const p = await seed();
  const json = await exportBackup();
  await s.wipeAll();
  await importBackup(json);
  expect((await s.getActivePersona())!).toMatchObject({ id: p.id, name: '지수', speechSamples: ['헐'] });
  expect((await s.listMemories(p.id)).map((m) => m.text)).toEqual(['제주도 감']);
  expect((await s.listOpenThreads(p.id)).map((t) => t.text)).toEqual(['면접 결과']);
  expect((await s.listMessages(p.id)).map((m) => m.text)).toEqual(['안녕']);
  expect((await s.getSummary(p.id))!.text).toBe('요약');
  expect((await s.getProfile())[2].text).toBe('등산');
  expect((await s.getSettings()).model).toBe('my-model');
});

test('import replaces existing data rather than merging', async () => {
  await seed();
  const json = await exportBackup();
  const extra = await s.createPersona(sheet('철수'));
  await importBackup(json);
  expect((await s.getActivePersona())!.name).toBe('지수');
  expect(await s.db.personas.get(extra.id)).toBeUndefined();
});

test('import keeps the api key already on the device', async () => {
  await seed();
  const json = await exportBackup();
  await s.saveSettings({ apiKey: 'sk-device', provider: 'anthropic', model: 'other' });
  await importBackup(json);
  expect(await s.getSettings()).toEqual({ apiKey: 'sk-device', provider: 'anthropic', model: 'my-model' });
});

test.each([
  ['invalid JSON', 'not json'],
  ['wrong version', JSON.stringify({ version: 2, personas: [] })],
  ['missing tables', JSON.stringify({ version: 1 })],
  ['table is not an array', JSON.stringify({ version: 1, personas: {}, memories: [], threads: [], messages: [], summaries: [], profile: [] })],
  ['a JSON array', '[]'],
])('%s → BACKUP_INVALID, existing data untouched', async (_name, json) => {
  const p = await seed();
  await expect(importBackup(json)).rejects.toThrow('BACKUP_INVALID');
  expect((await s.getActivePersona())!.id).toBe(p.id);
  expect(await s.listMessages(p.id)).toHaveLength(1);
});

test('inspectBackup reports counts without touching stored data', async () => {
  await seed();
  const json = await exportBackup();
  await s.wipeAll();
  expect(inspectBackup(json)).toMatchObject({ personas: 1, messages: 1, memories: 1 });
  expect(typeof inspectBackup(json).exportedAt).toBe('string');
  expect(await s.getActivePersona()).toBeUndefined();
  expect(() => inspectBackup('nope')).toThrow('BACKUP_INVALID');
});
