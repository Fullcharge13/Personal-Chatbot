import * as store from '../db/store';
import type { LlmProvider } from '../llm/provider';
import { searchMemories } from '../memory/search';
import { LIMITS, type ChatMessage, type Memory, type Persona, type ProfileEntry, type Thread } from '../types';
import { buildSystemPrompt } from './prompt';

export interface OpenerInput {
  persona: Persona;
  profile: ProfileEntry[];
  summary?: string;
  threads: Thread[];
  memories: Memory[];
  lastMessageAt?: number;
  now: number;
}

export function shouldOpen(lastMessageAt: number | undefined, now: number): boolean {
  return lastMessageAt === undefined || now - lastMessageAt >= LIMITS.openerGapMs;
}

function timeOfDay(hour: number): string {
  if (hour < 6) return '새벽';
  if (hour < 11) return '아침';
  if (hour < 17) return '낮';
  if (hour < 21) return '저녁';
  return '밤';
}

function describeGap(lastMessageAt: number | undefined, now: number): string {
  if (lastMessageAt === undefined) return '이번이 첫 대화입니다.';
  const hours = Math.floor((now - lastMessageAt) / 3_600_000);
  const amount = hours >= 24 ? `${Math.floor(hours / 24)}일` : `${Math.max(hours, 1)}시간`;
  return `마지막 대화 이후 ${amount}이 지났습니다.`;
}

/**
 * Pure: takes stored data and the current time, returns the message to open with.
 * Kept free of storage and UI so a server can call the same function later for notifications.
 */
export async function generateOpener(
  input: OpenerInput,
  llm: LlmProvider,
): Promise<{ text: string; usedThreadId?: string } | null> {
  const thread = [...input.threads].filter((t) => !t.used).sort((a, b) => a.createdAt - b.createdAt)[0];
  const system = buildSystemPrompt({
    persona: input.persona,
    profile: input.profile,
    summary: input.summary,
    memories: input.memories,
    now: new Date(input.now),
  });
  const situation = [
    `(상황 안내) 사용자가 방금 대화방을 열었습니다. ${describeGap(input.lastMessageAt, input.now)} 지금은 ${timeOfDay(new Date(input.now).getHours())}입니다.`,
    thread
      ? `지난 대화에서 이어갈 화제가 있습니다: "${thread.text}". 이 화제로 먼저 말을 거세요.`
      : '지난 대화와 지금 시간대에 어울리는 말로 먼저 말을 거세요.',
    `${input.persona.name}의 말투로 한두 문장만 쓰세요. 이 안내에 대한 언급은 하지 마세요.`,
  ].join('\n');

  try {
    const text = (await llm.complete({ system, messages: [{ role: 'user', content: situation }], maxTokens: 300 })).trim();
    return text ? { text, usedThreadId: thread?.id } : null;
  } catch {
    return null;
  }
}

const running = new Map<string, Promise<ChatMessage | null>>();

/** Generates and stores an opener when the conversation has been quiet for an hour. */
export function openIfDue(personaId: string, llm: LlmProvider, now: number): Promise<ChatMessage | null> {
  const existing = running.get(personaId);
  if (existing) return existing.then(() => null);
  const job = run(personaId, llm, now).finally(() => running.delete(personaId));
  running.set(personaId, job);
  return job;
}

async function run(personaId: string, llm: LlmProvider, now: number): Promise<ChatMessage | null> {
  const persona = await store.getActivePersona();
  if (!persona || persona.id !== personaId) return null;

  const [last] = await store.listMessages(personaId, 1);
  if (last?.kind === 'opener') return null; // an earlier opener is still unanswered
  if (!shouldOpen(last?.at, now)) return null;

  const opener = await generateOpener(
    {
      persona,
      profile: await store.getProfile(),
      summary: (await store.getSummary(personaId))?.text,
      threads: await store.listOpenThreads(personaId),
      memories: searchMemories('', await store.listMemories(personaId), now, 5),
      lastMessageAt: last?.at,
      now,
    },
    llm,
  );
  if (!opener) return null;

  // The user may have started typing while the opener was being written; theirs comes first.
  const [latest] = await store.listMessages(personaId, 1);
  if (latest?.id !== last?.id) return null;

  const message = await store.addMessage({
    personaId,
    sender: 'persona',
    text: opener.text,
    at: Math.max(now, (latest?.at ?? 0) + 1),
    kind: 'opener',
  });
  if (opener.usedThreadId) await store.markThreadUsed(opener.usedThreadId);
  return message;
}
