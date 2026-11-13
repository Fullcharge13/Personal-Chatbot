import { DEFAULT_MODEL } from '../types';
import { db, getSettings } from './store';

const TABLES = ['personas', 'memories', 'threads', 'messages', 'summaries', 'profile'] as const;

/** Everything on the device except the API key, as one JSON string. */
export async function exportBackup(): Promise<string> {
  const settings = await getSettings();
  const data: Record<string, unknown> = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: { provider: settings.provider, model: settings.model },
  };
  for (const name of TABLES) data[name] = await db.table(name).toArray();
  return JSON.stringify(data);
}

function parseBackup(json: string): Record<string, unknown> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('BACKUP_INVALID');
  }
  const valid =
    !!data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    data.version === 1 &&
    TABLES.every((name) => Array.isArray(data[name]));
  if (!valid) throw new Error('BACKUP_INVALID');
  return data;
}

/** What a backup holds, for showing before anything is replaced. */
export function inspectBackup(json: string): { exportedAt: string; personas: number; messages: number; memories: number } {
  const data = parseBackup(json);
  const count = (name: string) => (data[name] as unknown[]).length;
  return {
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    personas: count('personas'),
    messages: count('messages'),
    memories: count('memories'),
  };
}

/** Replaces all data with the backup. The API key already on the device is kept. */
export async function importBackup(json: string): Promise<void> {
  const data = parseBackup(json);

  const current = await getSettings();
  const backed = (data.settings ?? {}) as { model?: unknown };
  const model = typeof backed.model === 'string' && backed.model ? backed.model : DEFAULT_MODEL;

  await db.transaction('rw', db.tables, async () => {
    for (const name of TABLES) {
      await db.table(name).clear();
      await db.table(name).bulkAdd(data[name] as object[]);
    }
    await db.table('settings').put({ id: 'main', apiKey: current.apiKey, provider: 'anthropic', model });
  });
}
