import { CHUNK_CHARS, chunkMessages, estimateImport, extractPersona, type ExtractionState } from './extractor';
import { createFakeProvider } from '../llm/fake';
import { LlmError } from '../llm/provider';
import type { ParsedMessage } from '../types';

const msg = (sender: string, text: string, day = 1): ParsedMessage => ({ at: new Date(2024, 2, day, 10, 0), sender, text });

const chunkReply = (o: Partial<{ traits: string[]; phrases: string[]; samples: string[]; events: unknown[] }>) =>
  JSON.stringify({ traits: [], phrases: [], samples: [], events: [], ...o });
const mergeReply = JSON.stringify({
  name: '지수',
  relation: '대학 친구',
  personality: '다정함',
  speechStyle: 'ㅋㅋ를 자주 씀',
  background: '',
  notes: '',
});

describe('chunkMessages', () => {
  test('formats lines as "[YYYY-MM-DD] 이름: 내용"', () => {
    expect(chunkMessages([msg('지수', '안녕')], '지수', '나')).toEqual(['[2024-03-01] 지수: 안녕']);
  });

  test('keeps each chunk ≤ CHUNK_CHARS and never splits a message', () => {
    const msgs = Array.from({ length: 400 }, (_, i) => msg('지수', `메시지 ${i} ` + '가'.repeat(80)));
    const chunks = chunkMessages(msgs, '지수', '나');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= CHUNK_CHARS)).toBe(true);
    expect(chunks.join('\n').split('\n')).toHaveLength(400);
  });

  test('a single message longer than CHUNK_CHARS becomes its own chunk', () => {
    const chunks = chunkMessages([msg('지수', '짧음'), msg('지수', '가'.repeat(CHUNK_CHARS + 10)), msg('지수', '끝')], '지수', '나');
    expect(chunks).toHaveLength(3);
  });

  test('third-party senders are renamed "다른 사람"', () => {
    const [c] = chunkMessages([msg('지수', 'a'), msg('철수', 'b'), msg('나', 'c')], '지수', '나');
    expect(c).toContain('다른 사람: b');
    expect(c).not.toContain('철수');
  });

  test('no messages → no chunks', () => expect(chunkMessages([], '지수', '나')).toEqual([]));
});

test('estimateImport counts messages and chunks', () => {
  const msgs = [msg('지수', '안녕'), msg('나', '응')];
  const e = estimateImport(msgs);
  expect(e.messages).toBe(2);
  expect(e.chunks).toBe(1);
  expect(e.approxInputTokens).toBeGreaterThan(0);
});

describe('extractPersona', () => {
  const chunks = ['[2024-03-01] 지수: 헐 대박ㅋㅋ\n[2024-03-01] 나: 왜', '[2024-03-02] 지수: 밥 먹었어?'];

  test('calls llm once per chunk plus one merge call; reports progress', async () => {
    const fake = createFakeProvider([
      chunkReply({ traits: ['장난기'], events: [{ text: '같이 제주도 감', date: '2024-03-01', keywords: ['제주도'] }] }),
      chunkReply({ events: [{ text: '면접 봄', keywords: ['면접'] }, { text: '이사함', keywords: ['이사'] }] }),
      mergeReply,
    ]);
    const progress: [number, number][] = [];
    const out = await extractPersona({ chunks, target: '지수', me: '나', llm: fake, onProgress: (d, t) => progress.push([d, t]) });
    expect(fake.calls).toHaveLength(3);
    expect(progress).toEqual([[1, 2], [2, 2]]);
    expect(out.sheet.name).toBe('지수');
    expect(out.sheet.relation).toBe('대학 친구');
    expect(out.memories).toHaveLength(3);
    expect(out.memories[0]).toEqual({ text: '같이 제주도 감', date: '2024-03-01', keywords: ['제주도'] });
    expect(out.skippedChunks).toBe(0);
  });

  test('speechSamples only include strings that literally appear in the chunks, deduped, capped at 30', async () => {
    const real = Array.from({ length: 40 }, (_, i) => `진짜${i}`);
    const text = real.map((r) => `[2024-03-01] 지수: ${r}`).join('\n');
    const fake = createFakeProvider([
      chunkReply({ samples: ['지어낸 말', '진짜0', '진짜0', ...real] }),
      mergeReply,
    ]);
    const out = await extractPersona({ chunks: [text], target: '지수', me: '나', llm: fake });
    expect(out.speechSamples).toHaveLength(30);
    expect(out.speechSamples).not.toContain('지어낸 말');
    expect(new Set(out.speechSamples).size).toBe(30);
  });

  test('malformed chunk reply is skipped; other chunks survive', async () => {
    const fake = createFakeProvider(['죄송합니다', chunkReply({ events: [{ text: '면접 봄', keywords: ['면접'] }] }), mergeReply]);
    const out = await extractPersona({ chunks, target: '지수', me: '나', llm: fake });
    expect(out.skippedChunks).toBe(1);
    expect(out.memories).toHaveLength(1);
  });

  test('fenced JSON chunk reply is accepted', async () => {
    const fake = createFakeProvider(['```json\n' + chunkReply({ traits: ['다정함'] }) + '\n```', chunkReply({}), mergeReply]);
    const out = await extractPersona({ chunks, target: '지수', me: '나', llm: fake });
    expect(out.skippedChunks).toBe(0);
  });

  test('events with wrong shapes are dropped, missing keywords become []', async () => {
    const fake = createFakeProvider([
      chunkReply({ events: [{ text: '좋은 기억' }, { nope: 1 }, 'str', { text: '', keywords: [] }] }),
      mergeReply,
    ]);
    const out = await extractPersona({ chunks: [chunks[0]], target: '지수', me: '나', llm: fake });
    expect(out.memories).toEqual([{ text: '좋은 기억', date: undefined, keywords: [] }]);
  });

  test('LlmError mid-run rejects after reporting state; resume skips finished chunks', async () => {
    const first = createFakeProvider([chunkReply({ traits: ['장난기'] }), new LlmError('network', '끊김')]);
    let state: ExtractionState | undefined;
    await expect(
      extractPersona({ chunks, target: '지수', me: '나', llm: first, onState: (s) => (state = s) }),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(state!.done).toBe(1);

    const second = createFakeProvider([chunkReply({ events: [{ text: '면접 봄', keywords: ['면접'] }] }), mergeReply]);
    const out = await extractPersona({ chunks, target: '지수', me: '나', llm: second, resume: state });
    expect(second.calls).toHaveLength(2);
    expect(out.memories).toHaveLength(1);
    expect(second.calls[1].messages[0].content).toContain('장난기');
  });

  test('all chunks malformed → rejects with EXTRACTION_EMPTY', async () => {
    const fake = createFakeProvider(['음', '글쎄요']);
    await expect(extractPersona({ chunks, target: '지수', me: '나', llm: fake })).rejects.toThrow('EXTRACTION_EMPTY');
  });

  test('malformed merge reply → sheet falls back to target name, joined phrases and traits', async () => {
    const fake = createFakeProvider([chunkReply({ traits: ['장난기', '다정함'], phrases: ['ㅋㅋ', '헐'] }), chunkReply({}), '모르겠어요']);
    const out = await extractPersona({ chunks, target: '지수', me: '나', llm: fake });
    expect(out.sheet).toEqual({ name: '지수', relation: '', personality: '장난기, 다정함', speechStyle: 'ㅋㅋ, 헐', background: '', notes: '' });
  });

  test('merge reply with missing or non-string fields is filled with empty strings', async () => {
    const fake = createFakeProvider([chunkReply({ traits: ['a'] }), JSON.stringify({ name: '지수', personality: 3 })]);
    const out = await extractPersona({ chunks: [chunks[0]], target: '지수', me: '나', llm: fake });
    expect(out.sheet).toEqual({ name: '지수', relation: '', personality: '', speechStyle: '', background: '', notes: '' });
  });
});
