import Dexie, { type Table } from 'dexie';
import {
  DEFAULT_MODEL,
  LIMITS,
  PROFILE_KEYS,
  type ChatMessage,
  type Memory,
  type Persona,
  type PersonaSheet,
  type ProfileEntry,
  type Settings,
  type Summary,
  type Thread,
} from '../types';

type SettingsRow = Settings & { id: 'main' };
type ProfileRow = { key: string; text: string };

class AppDb extends Dexie {
  personas!: Table<Persona, string>;
  memories!: Table<Memory, string>;
  threads!: Table<Thread, string>;
  messages!: Table<ChatMessage, string>;
  summaries!: Table<Summary, string>;
  profile!: Table<ProfileRow, string>;
  settings!: Table<SettingsRow, string>;

  constructor() {
    super('personal-chatbot');
    this.version(1).stores({
      personas: 'id',
      memories: 'id, personaId, createdAt',
      threads: 'id, personaId',
      messages: 'id, personaId, at',
      summaries: 'personaId',
      profile: 'key',
      settings: 'id',
    });
  }
}

export const db = new AppDb();

const newId = () => crypto.randomUUID();
const capSamples = (samples: string[]) => samples.slice(0, LIMITS.speechSamples);

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('main');
  if (!row) return { apiKey: '', provider: 'anthropic', model: DEFAULT_MODEL };
  return { apiKey: row.apiKey, provider: row.provider, model: row.model };
}

export async function saveSettings(s: Settings): Promise<void> {
  await db.settings.put({ ...s, id: 'main' });
}

export async function getProfile(): Promise<ProfileEntry[]> {
  const rows = await db.profile.toArray();
  return PROFILE_KEYS.map(({ key, label }) => ({
    key,
    label,
    text: rows.find((r) => r.key === key)?.text ?? '',
  }));
}

export async function saveProfileEntry(key: string, text: string): Promise<void> {
  await db.profile.put({ key, text });
}

export async function getActivePersona(): Promise<Persona | undefined> {
  return (await db.personas.toArray()).find((p) => p.active);
}

export async function createPersona(sheet: PersonaSheet, speechSamples: string[] = []): Promise<Persona> {
  const persona: Persona = {
    ...sheet,
    id: newId(),
    speechSamples: capSamples(speechSamples),
    active: true,
    createdAt: Date.now(),
  };
  await db.transaction('rw', db.personas, async () => {
    await db.personas.toCollection().modify({ active: false });
    await db.personas.add(persona);
  });
  return persona;
}

export async function updatePersona(
  id: string,
  patch: Partial<PersonaSheet & { speechSamples: string[] }>,
): Promise<void> {
  const next = patch.speechSamples ? { ...patch, speechSamples: capSamples(patch.speechSamples) } : patch;
  await db.personas.update(id, next);
}

export async function addMemories(
  personaId: string,
  items: Omit<Memory, 'id' | 'personaId' | 'createdAt'>[],
): Promise<void> {
  const createdAt = Date.now();
  await db.memories.bulkAdd(items.map((m) => ({ ...m, id: newId(), personaId, createdAt })));
}

export async function listMemories(personaId: string): Promise<Memory[]> {
  const rows = await db.memories.where('personaId').equals(personaId).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteMemory(id: string): Promise<void> {
  await db.memories.delete(id);
}

export async function addThreads(personaId: string, texts: string[]): Promise<void> {
  const base = Date.now();
  await db.threads.bulkAdd(
    texts.map((text, i) => ({ id: newId(), personaId, text, createdAt: base + i, used: false })),
  );
}

export async function listOpenThreads(personaId: string): Promise<Thread[]> {
  const rows = await db.threads.where('personaId').equals(personaId).toArray();
  return rows.filter((t) => !t.used).sort((a, b) => a.createdAt - b.createdAt);
}

export async function markThreadUsed(id: string): Promise<void> {
  await db.threads.update(id, { used: true });
}

export async function addMessage(m: Omit<ChatMessage, 'id' | 'consolidated'>): Promise<ChatMessage> {
  const message: ChatMessage = { ...m, id: newId(), consolidated: false };
  await db.messages.add(message);
  return message;
}

export async function updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void> {
  await db.messages.update(id, patch);
}

export async function listMessages(personaId: string, limit?: number): Promise<ChatMessage[]> {
  const rows = (await db.messages.where('personaId').equals(personaId).toArray()).sort((a, b) => a.at - b.at);
  return limit ? rows.slice(-limit) : rows;
}

export async function listUnconsolidated(personaId: string): Promise<ChatMessage[]> {
  return (await listMessages(personaId)).filter((m) => !m.consolidated);
}

export async function markConsolidated(ids: string[]): Promise<void> {
  await db.messages.where('id').anyOf(ids).modify({ consolidated: true });
}

export async function getSummary(personaId: string): Promise<Summary | undefined> {
  return db.summaries.get(personaId);
}

export async function saveSummary(personaId: string, text: string): Promise<void> {
  await db.summaries.put({ personaId, text, updatedAt: Date.now() });
}

export async function wipeAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}

/** Saves an import result in one step: either the persona, its samples and memories all land, or none do. */
export async function saveImport(a: {
  targetId: string | null;
  sheet: PersonaSheet;
  speechSamples: string[];
  memories: Omit<Memory, 'id' | 'personaId' | 'createdAt'>[];
}): Promise<void> {
  await db.transaction('rw', db.personas, db.memories, async () => {
    let id = a.targetId;
    if (id) await updatePersona(id, { ...a.sheet, speechSamples: a.speechSamples });
    else id = (await createPersona(a.sheet, a.speechSamples)).id;
    if (a.memories.length) await addMemories(id, a.memories);
  });
}
