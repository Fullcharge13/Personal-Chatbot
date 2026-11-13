import type { LlmRequest } from '../llm/provider';
import { searchMemories } from '../memory/search';
import { LIMITS, type ChatMessage, type Memory, type Persona, type ProfileEntry } from '../types';

export const MAX_PROFILE_CHARS = 8_000;

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatNow(now: Date): string {
  return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${WEEKDAYS[now.getDay()]}요일 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function section(title: string, body: string): string {
  return `# ${title}\n${body}`;
}

export function buildSystemPrompt(a: {
  persona: Persona;
  profile: ProfileEntry[];
  summary?: string;
  memories: Memory[];
  now: Date;
}): string {
  const { persona: p } = a;
  const parts: string[] = [];

  const optional = (label: string, value: string) => (value.trim() ? `${label}: ${value.trim()}` : null);
  const sheet = [
    `당신은 ${p.name}입니다. 아래 설정과 말투 그대로 ${p.name}로서만 말합니다. AI 비서처럼 설명하거나 목록으로 답하지 않습니다.`,
    '메신저로 대화하듯 짧고 자연스럽게 말합니다.',
    '',
    `이름: ${p.name}`,
    optional('사용자와의 관계', p.relation),
    optional('성격', p.personality),
    optional('말투', p.speechStyle),
    optional('배경 설정', p.background),
    optional('메모', p.notes),
  ].filter((l): l is string => l !== null);
  parts.push(section('인물', sheet.join('\n')));

  if (p.speechSamples.length) {
    parts.push(
      section(
        '말투 예시',
        `${p.name}가 실제로 쓴 메시지입니다. 이 말투를 따릅니다.\n` + p.speechSamples.map((s) => `- ${s}`).join('\n'),
      ),
    );
  }

  const profile = a.profile.filter((e) => e.text.trim() !== '');
  if (profile.length) {
    parts.push(
      section(
        '사용자 정보',
        profile.map((e) => `## ${e.label}\n${e.text.trim().slice(0, MAX_PROFILE_CHARS)}`).join('\n\n'),
      ),
    );
  }

  if (a.summary?.trim()) parts.push(section('지금까지의 대화 요약', a.summary.trim()));

  if (a.memories.length) {
    parts.push(
      section('관련 기억', a.memories.map((m) => `- ${m.date ? `(${m.date}) ` : ''}${m.text}`).join('\n')),
    );
  }

  parts.push(section('현재 시각', formatNow(a.now)));
  return parts.join('\n\n');
}

export function buildChatRequest(a: {
  persona: Persona;
  profile: ProfileEntry[];
  summary?: string;
  allMemories: Memory[];
  recent: ChatMessage[];
  now: Date;
}): LlmRequest {
  const recent = a.recent.filter((m) => !m.failed).slice(-LIMITS.recentMessages);

  const query = recent
    .filter((m) => m.sender === 'user')
    .slice(-3)
    .map((m) => m.text)
    .join(' ');
  const memories = searchMemories(query, a.allMemories, a.now.getTime());

  // The API expects the first turn to be the user's; openers the persona sent first move to the system prompt.
  const firstUser = recent.findIndex((m) => m.sender === 'user');
  const leading = firstUser < 0 ? recent : recent.slice(0, firstUser);
  const rest = firstUser < 0 ? [] : recent.slice(firstUser);

  let system = buildSystemPrompt({ ...a, memories });
  if (leading.length) {
    system += '\n\n' + section('직전에 건넨 말', leading.map((m) => m.text).join('\n'));
  }

  const messages: LlmRequest['messages'] = [];
  for (const m of rest) {
    const role = m.sender === 'user' ? 'user' : 'assistant';
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content += '\n' + m.text;
    else messages.push({ role, content: m.text });
  }

  return { system, messages, maxTokens: 1024 };
}
