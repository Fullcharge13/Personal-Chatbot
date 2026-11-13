# 개인용 챗봇 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 채팅앱 내보내기 파일로 인물을 입히고, 사용자 정보와 지난 대화를 기억하며 먼저 말을 거는 홈 화면 설치형 개인 챗봇 웹앱을 만든다.

**Architecture:** 서버 없는 PWA. 모든 데이터는 IndexedDB에 인물 식별자별로 저장하고, 기기 밖으로 나가는 것은 브라우저에서 AI 제공사 API로 가는 직접 호출뿐이다. 해석, 추출, 검색, 프롬프트 조립, 정리, 첫 마디 생성은 화면과 분리된 순수 모듈로 만들고 React 화면은 이들을 호출만 한다.

**Tech Stack:** TypeScript, React 18, Vite, vite-plugin-pwa, Dexie(IndexedDB), Vitest, @testing-library/react, fake-indexeddb, jsdom.

**Spec:** `docs/superpowers/specs/2026-11-13-personal-chatbot-design.md`

## Global Constraints

- 서버 없음. 네트워크 요청은 `https://api.anthropic.com/v1/messages` 호출뿐이다. 분석, 로깅, 외부 글꼴 요청을 넣지 않는다.
- 브라우저 직접 호출은 `anthropic-dangerous-direct-browser-access: true` 헤더로 가능함을 확인했다(2026-11-13). `anthropic-version: 2023-06-01`. SDK를 쓰지 않고 `fetch`로 호출한다.
- 앱 차원의 주제 필터 없음. 탈옥 문구나 거절 우회 재시도도 없음. 모델의 거절 응답은 그대로 표시한다.
- API 키는 IndexedDB `settings`에만 저장하고 백업 파일에 넣지 않는다.
- 원본 내보내기 txt는 저장하지 않는다. 추출 결과만 저장한다.
- 모든 기억, 대화, 요약, 이어갈 화제는 `personaId`로 구분한다.
- 수치: 말투 예시 최대 30개, 관련 기억 상위 10개, 최근 대화 30개, 먼저 말 걸기 공백 기준 1시간(3,600,000ms).
- 화면 문구는 한국어. 식별자와 커밋 메시지는 영어.
- 기본 모델 이름은 `claude-sonnet-5-5`, 설정에서 자유 입력으로 바꿀 수 있다.
- 테스트 명령은 `npm test`(= `vitest run`). 전체 통과가 green의 기준이다.

## Review Focus

1. **왓츠앱 날짜 순서 모호성.** `3/4/24`가 3월 4일인지 4월 3일인지 줄 하나로는 알 수 없다. 기대: 파일 전체에서 12를 넘는 값을 찾아 순서를 정하고, 끝까지 모호하면 일/월 순으로 본다. → Task 5
2. **모델이 깨진 JSON을 돌려줌.** 코드 울타리, 앞뒤 설명 문구, 잘린 JSON. 기대: 울타리와 문구는 벗겨서 읽고, 끝내 못 읽는 구간은 건너뛰되 다른 구간 결과는 보존한다. → Task 6, Task 9
3. **BOM, CRLF, 여러 줄 메시지, 머리줄처럼 보이는 본문.** 기대: BOM과 `\r`을 제거하고, 머리줄 형식이 아닌 줄은 앞 메시지에 이어 붙인다. → Task 4, Task 5
4. **한국어 조사.** 기억의 핵심어가 `면접`이고 사용자가 `면접은 어땠냐면`이라고 쓴다. 기대: 포함 관계로 일치시킨다. → Task 7
5. **첫 마디 중복.** 앱이 연달아 두 번 열리거나 React StrictMode로 효과가 두 번 실행된다. 기대: 첫 마디는 한 번만 저장된다. → Task 10, Task 14

## File Structure

```
src/
  types.ts                  공통 타입
  llm/provider.ts           LlmProvider 인터페이스, LlmError
  llm/anthropic.ts          Anthropic fetch 구현
  llm/fake.ts               테스트용 가짜 제공자
  llm/json.ts               모델 응답에서 JSON 꺼내기
  db/store.ts               Dexie 스키마와 저장 함수
  db/backup.ts              백업 내보내기, 가져오기
  import/parsers/kakao.ts   카카오톡 해석기
  import/parsers/whatsapp.ts 왓츠앱 해석기
  import/parsers/index.ts   형식 판별과 진입점
  import/extractor.ts       인물 추출기
  memory/search.ts          기억 검색기
  chat/prompt.ts            프롬프트 조립기
  chat/consolidate.ts       대화 정리기
  chat/opener.ts            첫 마디 생성기
  ui/App.tsx                탭 이동, 제공자 생성
  ui/SettingsScreen.tsx  ui/ProfileScreen.tsx
  ui/PersonaScreen.tsx   ui/ImportWizard.tsx
  ui/ChatScreen.tsx
  main.tsx  styles.css
```
테스트는 대상 파일 옆에 `*.test.ts(x)`로 둔다.

---

### Task 1: 프로젝트 뼈대와 공통 타입

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/test-setup.ts`, `src/types.ts`, `.gitignore`
- Test: `src/types.test.ts`

**Interfaces:**
- Produces (`src/types.ts`):

```ts
export type Sender = 'user' | 'persona';
export interface ParsedMessage { at: Date; sender: string; text: string }
export interface PersonaSheet {
  name: string; relation: string; personality: string;
  speechStyle: string; background: string; notes: string;
}
export interface Persona extends PersonaSheet {
  id: string; speechSamples: string[]; active: boolean; createdAt: number;
}
export interface Memory {
  id: string; personaId: string; source: 'import' | 'chat';
  text: string; date?: string; keywords: string[]; createdAt: number;
}
export interface Thread { id: string; personaId: string; text: string; createdAt: number; used: boolean }
export interface ChatMessage {
  id: string; personaId: string; sender: Sender; text: string;
  at: number; consolidated: boolean; failed?: boolean;
}
export interface Summary { personaId: string; text: string; updatedAt: number }
export interface ProfileEntry { key: string; label: string; text: string }
export interface Settings { apiKey: string; provider: 'anthropic'; model: string }
export const LIMITS = {
  speechSamples: 30, memories: 10, recentMessages: 30, openerGapMs: 3_600_000,
} as const;
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const PROFILE_KEYS = [
  { key: 'basic', label: '기본 정보' }, { key: 'resume', label: '이력서' },
  { key: 'hobby', label: '취미' }, { key: 'story', label: '과거 이야기' },
] as const;
```

- [ ] **Step 1:** `npm create vite@latest . -- --template react-ts` 후 `npm i dexie` 와 `npm i -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom fake-indexeddb vite-plugin-pwa`. `package.json` scripts에 `"test": "vitest run"` 추가.
- [ ] **Step 2:** `vite.config.ts`에 `test: { environment: 'jsdom', setupFiles: ['src/test-setup.ts'], globals: true }` 설정. `src/test-setup.ts`는 `import 'fake-indexeddb/auto'`와 `import '@testing-library/jest-dom/vitest'`.
- [ ] **Step 3: 실패하는 테스트 작성** (`src/types.test.ts`)

```ts
test('limits match the spec', () => {
  expect(LIMITS).toEqual({ speechSamples: 30, memories: 10, recentMessages: 30, openerGapMs: 3_600_000 });
  expect(PROFILE_KEYS.map(p => p.key)).toEqual(['basic', 'resume', 'hobby', 'story']);
});
```
- [ ] **Step 4:** `npm test` → FAIL (모듈 없음).
- [ ] **Step 5:** `src/types.ts`를 위 Interfaces 그대로 작성. Vite 템플릿의 예시 화면과 자산은 삭제.
- [ ] **Step 6:** `npm test` → PASS. `npm run build` → 오류 없음.
- [ ] **Step 7:** Commit `chore: scaffold project and shared types`

---

### Task 2: 모델 연결부

**Files:**
- Create: `src/llm/provider.ts`, `src/llm/anthropic.ts`, `src/llm/fake.ts`, `src/llm/json.ts`
- Test: `src/llm/anthropic.test.ts`, `src/llm/json.test.ts`

**Interfaces:**
- Consumes: `Settings` (Task 1)
- Produces:

```ts
// provider.ts
export interface LlmRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
}
export type LlmErrorKind = 'auth' | 'network' | 'quota' | 'other';
export class LlmError extends Error { constructor(public kind: LlmErrorKind, message: string) }
export interface LlmProvider {
  complete(req: LlmRequest): Promise<string>;
  stream(req: LlmRequest, onDelta: (text: string) => void): Promise<string>; // 전체 텍스트 반환
}
// anthropic.ts
export function createAnthropicProvider(s: Pick<Settings, 'apiKey' | 'model'>, fetchFn?: typeof fetch): LlmProvider;
// fake.ts
export function createFakeProvider(replies: (string | Error)[]): LlmProvider & { calls: LlmRequest[] };
// json.ts
export function extractJson<T>(raw: string): T | null;
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// anthropic.test.ts — fetchFn을 vi.fn()으로 주입
test('sends required headers and body', async () => {
  // fetch → 200 { content: [{ type: 'text', text: '안녕' }] }
  expect(url).toBe('https://api.anthropic.com/v1/messages');
  expect(headers['x-api-key']).toBe('k');
  expect(headers['anthropic-version']).toBe('2023-06-01');
  expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(body).toMatchObject({ model: 'm', max_tokens: 100, system: 's', messages: [{ role: 'user', content: 'hi' }] });
  expect(result).toBe('안녕');
});
test('empty messages array is sent as a single user turn "(대화 시작)"', ...);
test('401 → LlmError kind auth', ...);
test('429 → kind quota, message is the provider error message verbatim', ...);
test('fetch rejects → kind network', ...);
test('500 → kind other', ...);
test('stream parses SSE content_block_delta events, calls onDelta per chunk, returns joined text', async () => {
  // ReadableStream 본문: 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"안"}}\n\n' + 같은 형식 "녕" + 'data: {"type":"message_stop"}\n\n'
  expect(deltas).toEqual(['안', '녕']); expect(result).toBe('안녕');
});
test('stream handles an SSE event split across two chunks', ...);
test('a refusal text is returned as-is with no retry', async () => { expect(fetchFn).toHaveBeenCalledTimes(1); });

// json.test.ts
test('plain JSON', () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }));
test('fenced', () => expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }));
test('prose around', () => expect(extractJson('결과입니다: {"a":1} 이상입니다.')).toEqual({ a: 1 }));
test('truncated → null', () => expect(extractJson('{"a":[1,2')).toBeNull());
test('no json → null', () => expect(extractJson('죄송합니다')).toBeNull());
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 네 파일 구현. `extractJson`은 첫 `{`부터 마지막 `}`까지 잘라 `JSON.parse`한다. `stream`은 요청 본문에 `stream: true`를 넣고 미완성 줄을 버퍼에 남긴다. 오류 본문의 `error.message`를 `LlmError.message`로 쓴다. 가짜 제공자는 `replies`를 순서대로 돌려주고 `Error`면 던진다.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add LLM provider with Anthropic browser client`

---

### Task 3: 저장소

**Files:**
- Create: `src/db/store.ts`
- Test: `src/db/store.test.ts`

**Interfaces:**
- Consumes: Task 1 타입
- Produces:

```ts
export const db: Dexie; // 테이블: personas, memories, threads, messages, summaries, profile, settings
export async function getSettings(): Promise<Settings>;            // 없으면 { apiKey:'', provider:'anthropic', model: DEFAULT_MODEL }
export async function saveSettings(s: Settings): Promise<void>;
export async function getProfile(): Promise<ProfileEntry[]>;       // 항상 PROFILE_KEYS 순서로 4개
export async function saveProfileEntry(key: string, text: string): Promise<void>;
export async function getActivePersona(): Promise<Persona | undefined>;
export async function createPersona(sheet: PersonaSheet, speechSamples?: string[]): Promise<Persona>; // 새 인물을 active로, 기존은 비활성
export async function updatePersona(id: string, patch: Partial<PersonaSheet & { speechSamples: string[] }>): Promise<void>;
export async function addMemories(personaId: string, items: Omit<Memory, 'id' | 'personaId' | 'createdAt'>[]): Promise<void>;
export async function listMemories(personaId: string): Promise<Memory[]>;   // 최신순
export async function deleteMemory(id: string): Promise<void>;
export async function addThreads(personaId: string, texts: string[]): Promise<void>;
export async function listOpenThreads(personaId: string): Promise<Thread[]>;
export async function markThreadUsed(id: string): Promise<void>;
export async function addMessage(m: Omit<ChatMessage, 'id' | 'consolidated'>): Promise<ChatMessage>;
export async function updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void>;
export async function listMessages(personaId: string, limit?: number): Promise<ChatMessage[]>; // 시간순, limit는 마지막 N개
export async function listUnconsolidated(personaId: string): Promise<ChatMessage[]>;
export async function markConsolidated(ids: string[]): Promise<void>;
export async function getSummary(personaId: string): Promise<Summary | undefined>;
export async function saveSummary(personaId: string, text: string): Promise<void>;
export async function wipeAll(): Promise<void>;
```
id는 `crypto.randomUUID()`. `speechSamples`는 저장 시 30개로 자른다.

- [ ] **Step 1: 실패하는 테스트 작성** (각 테스트 전에 `wipeAll()`)

```ts
test('settings default', async () => expect(await getSettings()).toEqual({ apiKey: '', provider: 'anthropic', model: 'claude-sonnet-5-5' }));
test('profile always returns four entries in order, saved text persists', ...);
test('createPersona activates the new one and deactivates the old; old data remains', async () => {
  const a = await createPersona(sheet('A')); await addMemories(a.id, [mem('a기억')]); await addMessage(msg(a.id, '안녕'));
  const b = await createPersona(sheet('B'));
  expect((await getActivePersona())!.id).toBe(b.id);
  expect(await listMemories(a.id)).toHaveLength(1);
  expect(await listMemories(b.id)).toHaveLength(0);
  expect(await listMessages(b.id)).toHaveLength(0);
});
test('speechSamples are capped at 30', ...);
test('listMessages(limit) returns the last N in chronological order', ...);
test('listOpenThreads excludes used threads', ...);
test('markConsolidated removes messages from listUnconsolidated', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** `src/db/store.ts` 구현. 색인: `memories: 'id, personaId, createdAt'`, `threads: 'id, personaId'`, `messages: 'id, personaId, at'`, `summaries: 'personaId'`, `profile: 'key'`, `settings: 'id'`(단일 행 `id: 'main'`).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add on-device store`

---

### Task 4: 카카오톡 해석기

**Files:**
- Create: `src/import/parsers/kakao.ts`, `src/import/parsers/fixtures/kakao-android.txt`, `kakao-ios.txt`, `kakao-pc.txt`
- Test: `src/import/parsers/kakao.test.ts`

**Interfaces:**
- Produces: `export function parseKakao(text: string): ParsedMessage[] | null` — 카카오톡 형식이 아니면 `null`.

세 형식의 머리줄:
- 안드로이드: `2024년 3월 1일 오후 2:15, 홍길동 : 안녕` (날짜만 있는 줄 `2024년 3월 1일 오후 2:15`는 구분선)
- 아이폰: `2024. 3. 1. 오후 2:15, 홍길동 : 안녕` (구분선 `2024년 3월 1일 금요일`)
- PC: `[홍길동] [오후 2:15] 안녕` (날짜는 구분선 `--------------- 2024년 3월 1일 금요일 ---------------`에서 가져옴)

견본 파일은 각각 머리말 2줄, 구분선, 메시지 4개(그중 하나는 세 줄짜리), 시스템 문구 1개(`홍길동님이 들어왔습니다.`)로 직접 작성한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test.each(['android', 'ios', 'pc'])('%s fixture', (kind) => {
  const r = parseKakao(read(`kakao-${kind}.txt`))!;
  expect(r).toHaveLength(4);
  expect(r[0]).toEqual({ at: new Date(2024, 2, 1, 14, 15), sender: '홍길동', text: '안녕' });
  expect(r[2].text).toBe('첫 줄\n둘째 줄\n셋째 줄');
});
test('오전 12:05 → 0시 5분, 오후 12:05 → 12시 5분', ...);
test('system lines (입장, 퇴장, 구분선, 저장한 날짜) are dropped', ...);
test('BOM and CRLF are stripped', () => expect(parseKakao('﻿' + android.replace(/\n/g, '\r\n'))).toEqual(parseKakao(android)));
test('a body line that contains " : " but no date prefix is appended to the previous message', ...);
test('sender name containing a comma or colon is kept whole', () => // "2024년 3월 1일 오후 2:15, 김, 철수 : 응" → sender '김, 철수'
test('non-kakao text → null', () => expect(parseKakao('hello\nworld')).toBeNull());
test('empty string → null', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** `parseKakao` 구현. 보낸 사람과 본문은 날짜 접두 뒤에서 **첫 번째** ` : `로 나눈다. 머리줄이 하나도 없으면 `null`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add KakaoTalk export parser`

---

### Task 5: 왓츠앱 해석기와 형식 판별

**Files:**
- Create: `src/import/parsers/whatsapp.ts`, `src/import/parsers/index.ts`, `src/import/parsers/fixtures/whatsapp-android.txt`, `whatsapp-ios.txt`
- Test: `src/import/parsers/whatsapp.test.ts`, `src/import/parsers/index.test.ts`

**Interfaces:**
- Consumes: `parseKakao` (Task 4)
- Produces:

```ts
export function parseWhatsApp(text: string): ParsedMessage[] | null;
export type ChatFormat = 'kakao' | 'whatsapp';
export function parseChatExport(text: string): { format: ChatFormat; messages: ParsedMessage[] }; // 모르는 형식이면 Error('UNKNOWN_FORMAT')
export function listSenders(messages: ParsedMessage[]): { name: string; count: number }[]; // 많은 순
export function filterByPeriod(messages: ParsedMessage[], period: 'all' | '1y' | '3m', now: Date): ParsedMessage[];
```

지원하는 머리줄:
- 안드로이드: `1/3/24, 14:15 - Name: text`, `1/3/24, 2:15 PM - Name: text`, 한국어 `24. 3. 1. 오후 2:15 - 이름: 내용`
- 아이폰: `[2024/3/1 14:15:02] Name: text`, `[1/3/24, 2:15:02 PM] Name: text`, 한국어 `[24. 3. 1. 오후 2:15:02] 이름: 내용`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test.each(['android', 'ios'])('%s fixture', ...); // 4개, 첫 메시지 { at: new Date(2024, 2, 1, 14, 15), sender: '홍길동', text: '안녕' }, 세 줄 메시지 보존
test('korean-locale lines with 오전/오후 parse', ...);
test('AM/PM lines parse, including U+202F before PM', ...);
test('lines without "Name:" (system notices such as encryption notice) are dropped', ...);
test('<Media omitted>, <미디어 파일을 생략했습니다>, and U+200E-prefixed attachment lines are dropped', ...);
test('date order: a value over 12 in the first slot anywhere in the file → day/month for the whole file', () => {
  const r = parseWhatsApp('3/4/24, 10:00 - A: x\n25/4/24, 10:00 - A: y')!;
  expect(r[0].at).toEqual(new Date(2024, 3, 3, 10, 0));
});
test('date order: a value over 12 in the second slot → month/day', () => {
  const r = parseWhatsApp('3/4/24, 10:00 - A: x\n3/25/24, 10:00 - A: y')!;
  expect(r[0].at).toEqual(new Date(2024, 2, 4, 10, 0));
});
test('date order: fully ambiguous → day/month', ...);
test('year-first [2024/3/1 ...] is never ambiguous', ...);
test('BOM and CRLF are stripped', ...);
test('non-whatsapp text → null', ...);

// index.test.ts
test('detects kakao and whatsapp fixtures', ...);
test('unknown format throws UNKNOWN_FORMAT', ...);
test('listSenders sorts by count desc', ...);
test('filterByPeriod 3m keeps only messages within 3 months before now; all keeps everything', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현. `parseChatExport`는 카카오톡을 먼저 시도하고 다음에 왓츠앱을 시도한다. 날짜 순서 판정은 파일의 모든 머리줄을 한 번 훑어 정한다.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add WhatsApp parser and format detection`

---

### Task 6: 인물 추출기

**Files:**
- Create: `src/import/extractor.ts`
- Test: `src/import/extractor.test.ts`

**Interfaces:**
- Consumes: `LlmProvider`, `extractJson` (Task 2), `ParsedMessage`, `PersonaSheet`, `LIMITS`
- Produces:

```ts
export const CHUNK_CHARS = 12_000;
export function chunkMessages(messages: ParsedMessage[], target: string, me: string): string[];
// 각 줄 "[YYYY-MM-DD] 이름: 내용". target과 me가 아닌 사람의 이름은 "다른 사람"으로 바꾼다. 메시지 중간에서 자르지 않는다.
export function estimateImport(messages: ParsedMessage[]): { messages: number; chunks: number; approxInputTokens: number }; // 토큰 ≈ 글자 수
export interface ChunkResult {
  traits: string[]; phrases: string[]; samples: string[];
  events: { text: string; date?: string; keywords: string[] }[];
}
export interface ExtractionState { results: (ChunkResult | null)[]; done: number } // 이어하기용
export interface ExtractionOutput {
  sheet: PersonaSheet; speechSamples: string[];
  memories: { text: string; date?: string; keywords: string[] }[];
  skippedChunks: number;
}
export async function extractPersona(args: {
  chunks: string[]; target: string; me: string; llm: LlmProvider;
  onProgress?: (done: number, total: number) => void;
  resume?: ExtractionState; onState?: (s: ExtractionState) => void;
}): Promise<ExtractionOutput>;
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('chunkMessages keeps each chunk ≤ CHUNK_CHARS and never splits a message', ...);
test('a single message longer than CHUNK_CHARS becomes its own chunk', ...);
test('third-party senders are renamed "다른 사람"', ...);
test('estimateImport counts messages and chunks', ...);
test('calls llm once per chunk plus one merge call; reports progress', async () => {
  // fake: chunk1 JSON, chunk2 JSON, merge JSON({ name, relation, personality, speechStyle, background, notes })
  expect(fake.calls).toHaveLength(3);
  expect(progress).toEqual([[1, 2], [2, 2]]);
  expect(out.sheet.name).toBe('지수');
  expect(out.memories).toHaveLength(3);       // 두 구간의 events 합
  expect(out.skippedChunks).toBe(0);
});
test('speechSamples only include strings that literally appear in the chunks, deduped, capped at 30', ...);
test('malformed chunk reply is skipped; other chunks survive', async () => {
  // replies: '죄송합니다', valid, merge
  expect(out.skippedChunks).toBe(1); expect(out.memories.length).toBeGreaterThan(0);
});
test('fenced JSON chunk reply is accepted', ...);
test('LlmError mid-run rejects, and onState was called with completed chunks; resume skips them', async () => {
  // 1차: chunk1 ok, chunk2 throws LlmError('network') → reject, 마지막 onState.done === 1
  // 2차: resume 전달 → fake.calls는 chunk2와 merge 두 번뿐
});
test('all chunks malformed → rejects with Error("EXTRACTION_EMPTY")', ...);
test('malformed merge reply → sheet falls back to name=target, speechStyle=phrases joined, personality=traits joined', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현. 구간 지시문은 target의 성격 특징, 자주 쓰는 표현, 대표 메시지 원문, 둘 사이의 사건(날짜, 핵심어 포함)을 `ChunkResult` JSON으로만 답하라고 요청한다. 합치기 지시문은 모든 구간의 traits와 phrases를 주고 `PersonaSheet` JSON을 요청한다. 지시문의 문구는 구현자가 정한다.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add persona extractor`

---

### Task 7: 기억 검색기

**Files:**
- Create: `src/memory/search.ts`
- Test: `src/memory/search.test.ts`

**Interfaces:**
- Produces: `export function searchMemories(query: string, memories: Memory[], now: number, limit?: number): Memory[]` — 기본 `limit`은 `LIMITS.memories`.

점수 = (query에 포함된 핵심어 수 × 10) + 최신성(0~5, 30일 이내 5에서 1년 이상 0까지 선형). 핵심어 길이 2 미만은 무시한다. 점수 0도 결과에 포함한다(최신순으로 뒤를 채움).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('keyword match outranks recency', ...);
test('more matched keywords rank higher', ...);
test('equal keyword score → newer first', ...);
test('korean particles: keyword "면접" matches query "면접은 어땠냐면"', ...);
test('single-character keywords are ignored', ...);
test('returns at most 10 by default', ...);
test('empty query returns the most recent memories', ...);
test('empty memories → []', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현 (`query.includes(keyword)`).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add keyword memory search`

---

### Task 8: 프롬프트 조립기

**Files:**
- Create: `src/chat/prompt.ts`
- Test: `src/chat/prompt.test.ts`

**Interfaces:**
- Consumes: `searchMemories` (Task 7), `LlmRequest` (Task 2)
- Produces:

```ts
export const MAX_PROFILE_CHARS = 8_000; // 항목당
export function buildSystemPrompt(a: {
  persona: Persona; profile: ProfileEntry[]; summary?: string; memories: Memory[]; now: Date;
}): string;
export function buildChatRequest(a: {
  persona: Persona; profile: ProfileEntry[]; summary?: string;
  allMemories: Memory[]; recent: ChatMessage[]; now: Date;
}): LlmRequest; // maxTokens 1024
```
시스템 프롬프트의 구역 제목과 순서: `# 인물`, `# 말투 예시`, `# 사용자 정보`, `# 지금까지의 대화 요약`, `# 관련 기억`, `# 현재 시각`. 내용이 빈 구역은 제목째 생략한다(`# 인물`과 `# 현재 시각`은 항상 포함).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('sections appear in spec order', () => {
  const idx = ['# 인물', '# 말투 예시', '# 사용자 정보', '# 지금까지의 대화 요약', '# 관련 기억', '# 현재 시각'].map(h => s.indexOf(h));
  expect(idx.every(i => i >= 0)).toBe(true); expect([...idx].sort((a, b) => a - b)).toEqual(idx);
});
test('includes every sheet field and the role instruction naming the persona', ...);
test('empty profile entries, missing summary, no memories → those sections are omitted', ...);
test('a profile entry longer than 8000 chars is truncated', ...);
test('system prompt contains no jailbreak or policy-override wording', () => {
  expect(s).not.toMatch(/정책.*무시|제한 없이|검열/);
});
test('buildChatRequest keeps only the last 30 messages, user→user, persona→assistant', ...);
test('query for memory search is the last 3 user messages joined', ...);
test('messages always start with a user turn (leading persona messages are folded into the system prompt under "# 직전에 건넨 말")', ...);
test('failed messages are excluded', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현. 역할 지시는 "당신은 {name}입니다. 아래 설정과 말투 그대로 {name}로서만 말합니다. AI 비서처럼 설명하거나 목록으로 답하지 않습니다." 를 쓴다.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add prompt builder`

---

### Task 9: 대화 정리기

**Files:**
- Create: `src/chat/consolidate.ts`
- Test: `src/chat/consolidate.test.ts`

**Interfaces:**
- Consumes: store 함수 (Task 3), `LlmProvider`, `extractJson`
- Produces: `export async function consolidate(personaId: string, llm: LlmProvider): Promise<'done' | 'nothing' | 'failed'>`

모델에 기존 요약과 정리되지 않은 메시지를 주고 `{ summary: string, memories: [{ text, date?, keywords }], threads: string[] }` JSON을 받는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('no unconsolidated messages → "nothing", llm not called', ...);
test('saves summary, memories (source "chat"), threads; marks messages consolidated', ...);
test('LlmError → "failed", nothing saved, messages stay unconsolidated', ...);
test('malformed JSON → "failed", messages stay unconsolidated', ...);
test('fenced JSON is accepted', ...);
test('missing "threads" or "memories" keys are treated as empty arrays', ...);
test('concurrent calls for the same persona run the llm once', async () => {
  const [a, b] = await Promise.all([consolidate(id, fake), consolidate(id, fake)]);
  expect(fake.calls).toHaveLength(1);
});
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현. 모듈 수준 `Map<personaId, Promise>`로 중복 실행을 막는다.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add conversation consolidator`

---

### Task 10: 첫 마디 생성기

**Files:**
- Create: `src/chat/opener.ts`
- Test: `src/chat/opener.test.ts`

**Interfaces:**
- Consumes: store 함수 (Task 3), `buildSystemPrompt` (Task 8), `LlmProvider`
- Produces:

```ts
export interface OpenerInput {
  persona: Persona; profile: ProfileEntry[]; summary?: string;
  threads: Thread[]; memories: Memory[]; lastMessageAt?: number; now: number;
}
export function shouldOpen(lastMessageAt: number | undefined, now: number): boolean; // 메시지가 없으면 true, 있으면 공백 ≥ 1시간
export async function generateOpener(input: OpenerInput, llm: LlmProvider): Promise<{ text: string; usedThreadId?: string } | null>;
export async function openIfDue(personaId: string, llm: LlmProvider, now: number): Promise<ChatMessage | null>;
```
`generateOpener`는 저장소를 건드리지 않는 순수 기능이다(2차에서 서버가 호출할 지점). `openIfDue`만 저장소를 읽고 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('shouldOpen: 59분 → false, 60분 → true, 메시지 없음 → true', ...);
test('with an open thread: the oldest open thread text is in the request and its id is returned', ...);
test('without threads: request mentions the gap length and time of day; usedThreadId undefined', ...);
test('LlmError → null', ...);
test('openIfDue saves one persona message and marks the thread used', ...);
test('openIfDue returns null when the gap is under one hour', ...);
test('openIfDue returns null when the last message is an unanswered persona opener', ...);
test('two concurrent openIfDue calls save exactly one message', async () => {
  await Promise.all([openIfDue(id, fake, now), openIfDue(id, fake, now)]);
  expect((await listMessages(id)).filter(m => m.sender === 'persona')).toHaveLength(1);
});
test('a used thread is not reused on the next open', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현. 요청은 Task 8의 시스템 프롬프트에 "먼저 말을 거는 한두 문장을 쓴다"는 지시와 화제 또는 공백 정보를 담은 user 메시지 하나를 붙인다. 중복 방지는 Task 9와 같은 방식.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add proactive opener`

---

### Task 11: 백업

**Files:**
- Create: `src/db/backup.ts`
- Test: `src/db/backup.test.ts`

**Interfaces:**
- Consumes: `db` (Task 3)
- Produces:

```ts
export async function exportBackup(): Promise<string>; // JSON 문자열, { version: 1, exportedAt, personas, memories, threads, messages, summaries, profile, settings: { provider, model } }
export async function importBackup(json: string): Promise<void>; // 기존 데이터를 지우고 교체. API 키는 기존 값 유지
```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test('export does not contain the api key', async () => {
  await saveSettings({ apiKey: 'sk-secret', provider: 'anthropic', model: 'm' });
  expect(await exportBackup()).not.toContain('sk-secret');
});
test('round trip restores personas, memories, messages, threads, summaries, profile', ...);
test('import keeps the api key already on the device', ...);
test('invalid JSON → Error("BACKUP_INVALID"), existing data untouched', ...);
test('wrong version → Error("BACKUP_INVALID"), existing data untouched', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현. 가져오기는 검증을 모두 마친 뒤 하나의 Dexie 트랜잭션에서 교체한다.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add backup export and import`

---

### Task 12: 앱 틀, 설정 화면, 내 정보 화면, PWA

**Files:**
- Create: `src/ui/App.tsx`, `src/ui/SettingsScreen.tsx`, `src/ui/ProfileScreen.tsx`, `src/styles.css`, `public/icon-192.png`, `public/icon-512.png`
- Modify: `src/main.tsx`, `vite.config.ts`(VitePWA: `name: '개인 챗봇'`, `display: 'standalone'`, `lang: 'ko'`, 아이콘 2개, `registerType: 'autoUpdate'`), `index.html`(`lang="ko"`, viewport, `apple-mobile-web-app-capable`)
- Test: `src/ui/App.test.tsx`, `src/ui/SettingsScreen.test.tsx`, `src/ui/ProfileScreen.test.tsx`

**Interfaces:**
- Consumes: store (Task 3), backup (Task 11), `createAnthropicProvider` (Task 2)
- Produces: `export function App(props?: { llmFactory?: (s: Settings) => LlmProvider }): JSX.Element` — 하단 탭 `대화`, `인물`, `내 정보`, `설정`. 각 화면은 `llm: LlmProvider | null`을 prop으로 받는다(API 키가 없으면 `null`). Task 13, 14가 채울 `PersonaScreen`, `ChatScreen`은 이 Task에서 제목만 있는 자리 표시 컴포넌트로 둔다.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
test('four tabs render and switch screens', ...);
test('settings: api key input is type=password; saving persists; model defaults to claude-sonnet-5-5', ...);
test('settings: "백업 내보내기" triggers a download whose content lacks the api key', ...);
test('settings: importing an invalid file shows "백업 파일을 읽을 수 없습니다" and keeps data', ...);
test('settings: "전체 삭제" requires typing 삭제 before wiping', ...);
test('profile: four labeled textareas (기본 정보, 이력서, 취미, 과거 이야기) load and save', ...);
test('profile: attaching a .txt file appends its text to that entry', ...);
test('profile: attaching a non-txt file shows "txt 파일만 넣을 수 있습니다"', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현. 화면 폭 360~430px 기준의 단일 열 배치, 하단 고정 탭. 색과 글꼴은 구현자가 정하되 시스템 글꼴만 쓴다.
- [ ] **Step 4:** `npm test` → PASS. `npm run build` → `dist/manifest.webmanifest`와 서비스 워커 파일 생성 확인.
- [ ] **Step 5:** Commit `feat: add app shell, settings, profile, PWA manifest`

---

### Task 13: 인물 화면과 가져오기 마법사

**Files:**
- Create: `src/ui/PersonaScreen.tsx`(자리 표시 교체), `src/ui/ImportWizard.tsx`
- Test: `src/ui/PersonaScreen.test.tsx`, `src/ui/ImportWizard.test.tsx`

**Interfaces:**
- Consumes: store (Task 3), `parseChatExport`, `listSenders`, `filterByPeriod` (Task 5), `chunkMessages`, `estimateImport`, `extractPersona` (Task 6)
- Produces: `PersonaScreen({ llm })`, `ImportWizard({ llm, onDone })`

마법사 단계: 파일 선택 → 참여자 선택(`인물이 될 사람`, `나`) → 기간과 예상 분량 → 추출 진행 → 초안 확인 → 저장.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
test('no persona: shows an empty sheet form; saving creates the active persona', ...);
test('editing a field and saving updates the persona', ...);
test('"새 인물로 바꾸기" asks for confirmation, then shows an empty form; old persona data remains in the store', ...);
test('memory list shows memories and deleting one removes it', ...);
test('wizard: unknown file shows "지원하지 않는 형식입니다. 카카오톡 또는 왓츠앱 내보내기 txt 파일을 넣어주세요" and saves nothing', ...);
test('wizard: lists senders by count; target and me must differ before continuing', ...);
test('wizard: period options 전체/최근 1년/최근 3개월 update the message and chunk estimate', ...);
test('wizard: without an api key the extract button is disabled with "설정에서 API 키를 먼저 넣어주세요"', ...);
test('wizard: progress text "2 / 5 구간" updates during extraction', ...);
test('wizard: on LlmError shows the error and "이어서 다시 시도"; retry resumes without re-sending finished chunks', ...);
test('wizard: draft is editable; when a sheet already exists each field offers 기존 유지 / 새 내용 사용 (default 기존 유지 for non-empty fields)', ...);
test('wizard: saving stores sheet, speech samples, memories (source "import"); the raw file text is not in any table', ...);
test('wizard: shows "N개 구간을 읽지 못해 건너뛰었습니다" when skippedChunks > 0', ...);
test('wizard: after first successful import shows the one-time backup reminder', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현. 이어하기 상태(`ExtractionState`)는 컴포넌트 상태에만 둔다.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add persona screen and import wizard`

---

### Task 14: 대화 화면

**Files:**
- Create: `src/ui/ChatScreen.tsx`(자리 표시 교체)
- Test: `src/ui/ChatScreen.test.tsx`

**Interfaces:**
- Consumes: store (Task 3), `buildChatRequest` (Task 8), `consolidate` (Task 9), `openIfDue` (Task 10), `LlmError` (Task 2)
- Produces: `ChatScreen({ llm, now?: () => number })`

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
test('no persona → "인물 탭에서 인물을 먼저 만들어주세요"', ...);
test('no api key → "설정에서 API 키를 넣어주세요" and input disabled', ...);
test('on mount with a 2-hour gap: runs consolidate, then shows the opener as a persona bubble', ...);
test('on mount under StrictMode the opener appears exactly once', ...);
test('on mount with a 10-minute gap: no opener', ...);
test('sending: user bubble appears immediately, reply streams in, both are stored', ...);
test('the request sent to the llm is built from persona, profile, summary, memories, recent messages', ...);
test('network LlmError: user message kept and marked failed with "다시 보내기"; tapping it resends and clears the mark', ...);
test('auth LlmError shows "API 키를 확인해주세요" with a link to 설정', ...);
test('quota LlmError shows the provider message verbatim', ...);
test('a refusal reply is displayed as a normal persona bubble; llm called once', ...);
test('send is disabled while a reply is streaming; empty or whitespace input is not sent', ...);
test('visibilitychange to hidden triggers consolidate', ...);
test('consolidate failure shows nothing to the user', ...);
test('a QuotaExceededError from the store shows "저장 공간이 부족합니다. 설정에서 백업을 내보내주세요"', ...);
```
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현. 마운트 순서는 `consolidate` → `openIfDue`. 새 메시지가 오면 맨 아래로 스크롤한다. 입력창은 가상 키보드 위에 붙도록 `100dvh` 기준으로 배치한다.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: add chat screen`

---

### Task 15: 배포 준비와 사용 안내

**Files:**
- Create: `README.md`, `.github/workflows/deploy.yml`
- Modify: `vite.config.ts`(`base: './'`)

- [ ] **Step 1:** `README.md`를 비개발자용 한국어로 작성. 내용: API 키 발급받기, GitHub Pages에 올리기(저장소 만들기, 푸시, Pages 켜기), 휴대폰 홈 화면에 추가하기(아이폰 Safari와 안드로이드 Chrome), 첫 사용 순서(설정 → 내 정보 → 인물 → 대화), 백업, 그리고 "API 키는 이 휴대폰에만 저장되며 대화 내용은 AI 답변을 받을 때만 Anthropic으로 전송된다. 사용하는 모델은 제공사의 이용 정책을 따른다"는 안내.
- [ ] **Step 2:** `deploy.yml`은 `main` 푸시 시 `npm ci && npm test && npm run build` 후 `dist`를 GitHub Pages에 올린다.
- [ ] **Step 3:** `npm test` → 전체 PASS. `npm run build` → 오류 없음. `grep -rE "https?://" dist/assets/*.js | grep -v api.anthropic.com` 결과에 요청 대상이 되는 외부 주소가 없는지 확인(Global Constraints 1항).
- [ ] **Step 4:** `npx vite preview`로 띄워 `curl -s localhost:4173/manifest.webmanifest`가 `"display":"standalone"`을 포함하는지 확인.
- [ ] **Step 5:** Commit `docs: add README and deploy workflow`

**실제 휴대폰에서 사용자가 확인할 것 (자동화 불가):** 홈 화면 설치, 실제 API 키로 대화, 실제 내보내기 파일 가져오기, 스펙 2절의 실패 조건 네 가지.
