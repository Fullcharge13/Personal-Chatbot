import { buildChatRequest, buildSystemPrompt, MAX_PROFILE_CHARS } from './prompt';
import type { ChatMessage, Memory, Persona, ProfileEntry } from '../types';

const persona: Persona = {
  id: 'p',
  name: '지수',
  relation: '대학 친구',
  personality: '장난기 많음',
  speechStyle: '반말, ㅋㅋ',
  background: '서울 거주',
  notes: '매운 음식 좋아함',
  speechSamples: ['헐 대박ㅋㅋ', '밥 먹었어?'],
  active: true,
  createdAt: 0,
};
const profile: ProfileEntry[] = [
  { key: 'basic', label: '기본 정보', text: '이름은 민수' },
  { key: 'resume', label: '이력서', text: '' },
  { key: 'hobby', label: '취미', text: '등산' },
  { key: 'story', label: '과거 이야기', text: '' },
];
const NOW = new Date(2026, 10, 13, 21, 30);
let n = 0;
const memory = (text: string, keywords: string[] = [], date?: string): Memory => ({
  id: `m${n++}`, personaId: 'p', source: 'chat', text, keywords, date, createdAt: NOW.getTime() - 1000,
});
const chat = (sender: 'user' | 'persona', text: string, at: number, failed = false): ChatMessage => ({
  id: `c${n++}`, personaId: 'p', sender, text, at, consolidated: false, failed,
});
const HEADS = ['# 인물', '# 말투 예시', '# 사용자 정보', '# 지금까지의 대화 요약', '# 관련 기억', '# 현재 시각'];

test('sections appear in spec order', () => {
  const s = buildSystemPrompt({ persona, profile, summary: '지난 요약', memories: [memory('제주도 감')], now: NOW });
  const idx = HEADS.map((h) => s.indexOf(h));
  expect(idx.every((i) => i >= 0)).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
});

test('includes every sheet field, samples, and the role instruction naming the persona', () => {
  const s = buildSystemPrompt({ persona, profile, memories: [], now: NOW });
  for (const v of ['대학 친구', '장난기 많음', '반말, ㅋㅋ', '서울 거주', '매운 음식 좋아함', '헐 대박ㅋㅋ', '밥 먹었어?']) {
    expect(s).toContain(v);
  }
  expect(s).toContain('당신은 지수입니다');
  expect(s).toContain('지수로서만 말합니다');
});

test('includes profile text with labels, memory text with date, summary, and the current time', () => {
  const s = buildSystemPrompt({ persona, profile, summary: '지난 요약', memories: [memory('제주도 감', [], '2024-03-01')], now: NOW });
  expect(s).toContain('기본 정보');
  expect(s).toContain('이름은 민수');
  expect(s).toContain('등산');
  expect(s).toContain('지난 요약');
  expect(s).toContain('제주도 감');
  expect(s).toContain('2024-03-01');
  expect(s).toContain('2026년 11월 13일');
  expect(s).toContain('21:30');
});

test('empty profile entries, missing summary, no memories, no samples → those sections are omitted', () => {
  const empty = profile.map((p) => ({ ...p, text: '  ' }));
  const s = buildSystemPrompt({ persona: { ...persona, speechSamples: [] }, profile: empty, memories: [], now: NOW });
  expect(HEADS.filter((h) => s.includes(h))).toEqual(['# 인물', '# 현재 시각']);
  expect(s).not.toContain('이력서');
});

test('a profile entry longer than the cap is truncated', () => {
  const long = [{ key: 'resume', label: '이력서', text: '가'.repeat(MAX_PROFILE_CHARS + 500) }];
  const s = buildSystemPrompt({ persona, profile: long, memories: [], now: NOW });
  expect(s).toContain('가'.repeat(MAX_PROFILE_CHARS));
  expect(s).not.toContain('가'.repeat(MAX_PROFILE_CHARS + 1));
});

test('system prompt contains no jailbreak or policy-override wording', () => {
  const s = buildSystemPrompt({ persona, profile, summary: 's', memories: [memory('m')], now: NOW });
  expect(s).not.toMatch(/정책.*무시|제한 없이|검열|jailbreak|ignore (all|previous)/i);
});

test('buildChatRequest keeps only the last 30 messages, user→user, persona→assistant', () => {
  const recent: ChatMessage[] = [];
  for (let i = 0; i < 40; i++) recent.push(chat(i % 2 === 0 ? 'user' : 'persona', `m${i}`, i));
  const r = buildChatRequest({ persona, profile, allMemories: [], recent, now: NOW });
  expect(r.messages).toHaveLength(30);
  expect(r.messages[0]).toEqual({ role: 'user', content: 'm10' });
  expect(r.messages[1]).toEqual({ role: 'assistant', content: 'm11' });
  expect(r.messages[29].content).toBe('m39');
  expect(r.maxTokens).toBe(1024);
});

test('consecutive same-role messages are merged into one turn', () => {
  const r = buildChatRequest({
    persona, profile, allMemories: [], now: NOW,
    recent: [chat('user', '야', 1), chat('user', '자?', 2), chat('persona', '아니', 3)],
  });
  expect(r.messages).toEqual([
    { role: 'user', content: '야\n자?' },
    { role: 'assistant', content: '아니' },
  ]);
});

test('memory search uses the last 3 user messages; top memories land in the system prompt', () => {
  const hit = { ...memory('삼성 면접 봄', ['면접']), createdAt: 0 };
  const filler = Array.from({ length: 12 }, (_, i) => memory(`잡담${i}`));
  const r = buildChatRequest({
    persona, profile, allMemories: [...filler, hit], now: NOW,
    recent: [chat('user', '면접 얘기 기억나?', 1), chat('persona', '응', 2), chat('user', '그때 말이야', 3)],
  });
  expect(r.system).toContain('삼성 면접 봄');
  expect((r.system.match(/잡담/g) ?? []).length).toBe(9);
});

test('leading persona messages are folded into the system prompt under "# 직전에 건넨 말"', () => {
  const r = buildChatRequest({
    persona, profile, allMemories: [], now: NOW,
    recent: [chat('persona', '어제 면접 어땠어?', 1), chat('user', '잘 봤어', 2)],
  });
  expect(r.messages).toEqual([{ role: 'user', content: '잘 봤어' }]);
  expect(r.system).toContain('# 직전에 건넨 말');
  expect(r.system).toContain('어제 면접 어땠어?');
});

test('failed messages are excluded', () => {
  const r = buildChatRequest({
    persona, profile, allMemories: [], now: NOW,
    recent: [chat('user', '실패한 말', 1, true), chat('user', '보낸 말', 2)],
  });
  expect(r.messages).toEqual([{ role: 'user', content: '보낸 말' }]);
});
