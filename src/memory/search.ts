import { LIMITS, type Memory } from '../types';

const DAY = 86_400_000;

function recency(ageMs: number): number {
  const days = ageMs / DAY;
  if (days <= 30) return 5;
  if (days >= 365) return 0;
  return 5 * (1 - (days - 30) / 335);
}

/**
 * Ranks memories for a query: each keyword contained in the query is worth 10,
 * recency adds up to 5. Containment (not token equality) so Korean particles
 * attached to a word still match.
 */
export function searchMemories(
  query: string,
  memories: Memory[],
  now: number,
  limit: number = LIMITS.memories,
): Memory[] {
  const q = query.toLowerCase();
  return memories
    .map((memory) => {
      const hits = new Set(
        memory.keywords.map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 2 && q.includes(k)),
      ).size;
      return { memory, score: hits * 10 + recency(now - memory.createdAt) };
    })
    .sort((a, b) => b.score - a.score || b.memory.createdAt - a.memory.createdAt)
    .slice(0, limit)
    .map((x) => x.memory);
}
