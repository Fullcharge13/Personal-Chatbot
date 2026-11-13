import * as store from '../db/store';
import { extractJson } from '../llm/json';
import type { LlmProvider } from '../llm/provider';
import type { ChatMessage } from '../types';

const SYSTEM = [
  '아래는 사용자와 인물의 메신저 대화입니다. 다음 대화를 위해 기억할 것을 정리해 주세요.',
  '다음 형식의 JSON 하나만 답하세요. 설명은 쓰지 마세요.',
  '{',
  '  "summary": "기존 요약에 새 대화를 반영해 다시 쓴 전체 요약 (10문장 이내)",',
  '  "memories": [{ "text": "오래 기억할 사실이나 사건 한두 문장", "date": "YYYY-MM-DD", "keywords": ["검색용 명사 2~5개"] }],',
  '  "threads": ["다음에 인물이 먼저 물어볼 만한, 아직 끝나지 않은 화제"]',
  '}',
  '대화에 없는 내용은 지어내지 마세요. 해당 사항이 없으면 빈 배열로 둡니다.',
].join('\n');

const running = new Map<string, Promise<'done' | 'nothing' | 'failed'>>();

/** Folds unconsolidated messages into the summary, new memories and open threads. */
export function consolidate(personaId: string, llm: LlmProvider): Promise<'done' | 'nothing' | 'failed'> {
  const existing = running.get(personaId);
  if (existing) return existing;
  const job = run(personaId, llm).finally(() => running.delete(personaId));
  running.set(personaId, job);
  return job;
}

export const BATCH_SIZE = 60;

async function run(personaId: string, llm: LlmProvider): Promise<'done' | 'nothing' | 'failed'> {
  const pending = (await store.listUnconsolidated(personaId)).filter((m) => !m.failed);
  if (pending.length === 0) return 'nothing';
  // Small batches keep each reply well inside the output limit, so a long backlog cannot get stuck.
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    if (!(await consolidateBatch(personaId, pending.slice(i, i + BATCH_SIZE), llm))) return 'failed';
  }
  return 'done';
}

async function consolidateBatch(personaId: string, batch: ChatMessage[], llm: LlmProvider): Promise<boolean> {
  const previous = (await store.getSummary(personaId))?.text ?? '';
  const transcript = batch.map((m) => `${m.sender === 'user' ? '사용자' : '인물'}: ${m.text}`).join('\n');

  let reply: string;
  try {
    reply = await llm.complete({
      system: SYSTEM,
      messages: [{ role: 'user', content: `기존 요약:\n${previous || '(없음)'}\n\n새 대화:\n${transcript}` }],
      maxTokens: 1500,
    });
  } catch {
    return false;
  }

  const json = extractJson<Record<string, unknown>>(reply);
  if (!json) return false;

  const memories = (Array.isArray(json.memories) ? json.memories : [])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .filter((m) => typeof m.text === 'string' && m.text.trim() !== '')
    .map((m) => ({
      source: 'chat' as const,
      text: m.text as string,
      date: typeof m.date === 'string' ? m.date : undefined,
      keywords: Array.isArray(m.keywords) ? m.keywords.filter((k): k is string => typeof k === 'string') : [],
    }));
  const threads = (Array.isArray(json.threads) ? json.threads : []).filter(
    (t): t is string => typeof t === 'string' && t.trim() !== '',
  );
  const summary = typeof json.summary === 'string' ? json.summary.trim() : '';

  // One transaction: if the page is frozen or storage fails midway, nothing is half-written
  // and the same messages are simply consolidated again next time.
  try {
    await store.db.transaction('rw', store.db.summaries, store.db.memories, store.db.threads, store.db.messages, async () => {
      if (summary) await store.saveSummary(personaId, summary);
      if (memories.length) await store.addMemories(personaId, memories);
      if (threads.length) await store.addThreads(personaId, threads);
      await store.markConsolidated(batch.map((m) => m.id));
    });
  } catch {
    return false;
  }
  return true;
}
