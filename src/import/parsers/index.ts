import type { ParsedMessage } from '../../types';
import { parseKakao } from './kakao';
import { parseWhatsApp } from './whatsapp';

export type ChatFormat = 'kakao' | 'whatsapp';

export function parseChatExport(text: string): { format: ChatFormat; messages: ParsedMessage[] } {
  const kakao = parseKakao(text);
  if (kakao) return { format: 'kakao', messages: kakao };
  const whatsapp = parseWhatsApp(text);
  if (whatsapp) return { format: 'whatsapp', messages: whatsapp };
  throw new Error('UNKNOWN_FORMAT');
}

export function listSenders(messages: ParsedMessage[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of messages) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export type Period = 'all' | '1y' | '3m';

export function filterByPeriod(messages: ParsedMessage[], period: Period, now: Date): ParsedMessage[] {
  if (period === 'all') return messages;
  const from = new Date(now);
  if (period === '1y') from.setFullYear(from.getFullYear() - 1);
  else from.setMonth(from.getMonth() - 3);
  return messages.filter((m) => m.at >= from);
}
