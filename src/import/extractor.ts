import { extractJson } from '../llm/json';
import type { LlmProvider } from '../llm/provider';
import { LIMITS, type ParsedMessage, type PersonaSheet } from '../types';

export const CHUNK_CHARS = 12_000;

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Turns messages into text blocks of at most CHUNK_CHARS, never splitting a message. */
export function chunkMessages(messages: ParsedMessage[], target: string, me: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const m of messages) {
    const name = m.sender === target || m.sender === me ? m.sender : '다른 사람';
    const line = `[${day(m.at)}] ${name}: ${m.text}`;
    if (current && current.length + 1 + line.length > CHUNK_CHARS) {
      chunks.push(current);
      current = '';
    }
    current = current ? current + '\n' + line : line;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function estimateImport(messages: ParsedMessage[]): {
  messages: number;
  chunks: number;
  approxInputTokens: number;
} {
  const chunks = chunkMessages(messages, '', '');
  return {
    messages: messages.length,
    chunks: chunks.length,
    approxInputTokens: chunks.reduce((n, c) => n + c.length, 0),
  };
}

export interface ExtractedEvent {
  text: string;
  date?: string;
  keywords: string[];
}

export interface ChunkResult {
  traits: string[];
  phrases: string[];
  samples: string[];
  events: ExtractedEvent[];
}

export interface ExtractionState {
  results: (ChunkResult | null)[];
  done: number;
}

export interface ExtractionOutput {
  sheet: PersonaSheet;
  speechSamples: string[];
  memories: ExtractedEvent[];
  skippedChunks: number;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

function toChunkResult(raw: string): ChunkResult | null {
  const json = extractJson<Record<string, unknown>>(raw);
  if (!json) return null;
  const events = (Array.isArray(json.events) ? json.events : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .filter((e) => typeof e.text === 'string' && e.text.trim() !== '')
    .map((e) => ({
      text: e.text as string,
      date: typeof e.date === 'string' ? e.date : undefined,
      keywords: strings(e.keywords),
    }));
  return { traits: strings(json.traits), phrases: strings(json.phrases), samples: strings(json.samples), events };
}

function chunkSystem(target: string, me: string): string {
  return [
    `아래는 "${target}"와 "${me}"의 메신저 대화 일부입니다. "${target}"라는 사람을 파악하기 위한 자료를 뽑아주세요.`,
    '다음 형식의 JSON 하나만 답하세요. 설명은 쓰지 마세요.',
    '{',
    `  "traits": ["${target}의 성격이나 태도를 나타내는 짧은 표현"],`,
    `  "phrases": ["${target}가 자주 쓰는 말버릇, 어미, 감탄사, 이모티콘"],`,
    `  "samples": ["${target}의 말투가 잘 드러나는 메시지 원문 그대로 (최대 8개, 한 글자도 바꾸지 말 것)"],`,
    `  "events": [{ "text": "두 사람 사이에 있었던 일이나 ${target}에 관한 사실 한두 문장", "date": "YYYY-MM-DD", "keywords": ["검색용 명사 2~5개"] }]`,
    '}',
    '대화에 없는 내용은 지어내지 마세요.',
  ].join('\n');
}

function mergeSystem(target: string, me: string): string {
  return [
    `여러 대화 구간에서 뽑은 "${target}"의 특징 목록입니다. 이를 하나의 인물 설정으로 정리해 주세요.`,
    '다음 형식의 JSON 하나만 답하세요. 모든 값은 한국어 문자열입니다.',
    '{',
    `  "name": "${target}",`,
    `  "relation": "${me}와의 관계",`,
    '  "personality": "성격 서너 문장",',
    '  "speechStyle": "말투 설명: 존댓말 여부, 문장 길이, 말버릇, 자주 쓰는 표현",',
    '  "background": "대화에서 드러난 직업, 사는 곳, 취미 등 배경",',
    '  "notes": "그 밖에 이 인물을 연기할 때 알아둘 점"',
    '}',
  ].join('\n');
}

const unique = (items: string[]) => [...new Set(items)];

export async function extractPersona(args: {
  chunks: string[];
  target: string;
  me: string;
  llm: LlmProvider;
  onProgress?: (done: number, total: number) => void;
  resume?: ExtractionState;
  onState?: (s: ExtractionState) => void;
}): Promise<ExtractionOutput> {
  const { chunks, target, me, llm } = args;
  const results: (ChunkResult | null)[] = args.resume ? [...args.resume.results] : [];
  const start = args.resume?.done ?? 0;

  for (let i = start; i < chunks.length; i++) {
    const reply = await llm.complete({
      system: chunkSystem(target, me),
      messages: [{ role: 'user', content: chunks[i] }],
      maxTokens: 2000,
    });
    results[i] = toChunkResult(reply);
    args.onState?.({ results: [...results], done: i + 1 });
    args.onProgress?.(i + 1, chunks.length);
  }

  const ok = results.filter((r): r is ChunkResult => r !== null);
  if (ok.length === 0) throw new Error('EXTRACTION_EMPTY');

  const traits = unique(ok.flatMap((r) => r.traits));
  const phrases = unique(ok.flatMap((r) => r.phrases));
  const source = chunks.join('\n');
  const speechSamples = unique(ok.flatMap((r) => r.samples))
    .filter((s) => source.includes(s))
    .slice(0, LIMITS.speechSamples);

  const mergeReplyText = await llm.complete({
    system: mergeSystem(target, me),
    messages: [{ role: 'user', content: `성격 특징:\n${traits.join('\n')}\n\n말버릇:\n${phrases.join('\n')}` }],
    maxTokens: 1500,
  });
  const merged = extractJson<Record<string, unknown>>(mergeReplyText);
  const field = (k: keyof PersonaSheet) => (merged && typeof merged[k] === 'string' ? (merged[k] as string) : '');
  const sheet: PersonaSheet = merged
    ? {
        name: field('name') || target,
        relation: field('relation'),
        personality: field('personality'),
        speechStyle: field('speechStyle'),
        background: field('background'),
        notes: field('notes'),
      }
    : { name: target, relation: '', personality: traits.join(', '), speechStyle: phrases.join(', '), background: '', notes: '' };

  return {
    sheet,
    speechSamples,
    memories: ok.flatMap((r) => r.events),
    skippedChunks: results.length - ok.length,
  };
}
