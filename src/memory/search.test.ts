import { searchMemories } from './search';
import type { Memory } from '../types';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
let n = 0;
const m = (text: string, keywords: string[], ageDays: number): Memory => ({
  id: `m${n++}`,
  personaId: 'p',
  source: 'chat',
  text,
  keywords,
  createdAt: NOW - ageDays * DAY,
});

test('keyword match outranks recency', () => {
  const old = m('면접 봄', ['면접'], 400);
  const fresh = m('점심 먹음', ['점심'], 1);
  expect(searchMemories('면접 어땠어', [fresh, old], NOW)[0]).toBe(old);
});

test('more matched keywords rank higher', () => {
  const one = m('a', ['면접'], 1);
  const two = m('b', ['면접', '삼성'], 300);
  expect(searchMemories('삼성 면접', [one, two], NOW)[0]).toBe(two);
});

test('equal keyword score → newer first', () => {
  const older = m('a', ['면접'], 200);
  const newer = m('b', ['면접'], 100);
  expect(searchMemories('면접', [older, newer], NOW).map((x) => x.text)).toEqual(['b', 'a']);
});

test('korean particles: keyword "면접" matches query "면접은 어땠냐면"', () => {
  const hit = m('면접 봄', ['면접'], 300);
  const miss = m('이사함', ['이사'], 1);
  expect(searchMemories('면접은 어땠냐면', [miss, hit], NOW)[0]).toBe(hit);
});

test('matching ignores letter case', () => {
  const hit = m('x', ['Netflix'], 300);
  expect(searchMemories('netflix 봤어', [m('y', ['z'], 1), hit], NOW)[0]).toBe(hit);
});

test('single-character keywords are ignored', () => {
  const noisy = m('a', ['나'], 300);
  const fresh = m('b', [], 1);
  expect(searchMemories('나 오늘 피곤해', [noisy, fresh], NOW)[0]).toBe(fresh);
});

test('returns at most 10 by default; limit is respected', () => {
  const many = Array.from({ length: 25 }, (_, i) => m(`t${i}`, [], i));
  expect(searchMemories('x', many, NOW)).toHaveLength(10);
  expect(searchMemories('x', many, NOW, 3)).toHaveLength(3);
});

test('empty query returns the most recent memories', () => {
  const a = m('old', ['면접'], 50);
  const b = m('new', [], 2);
  expect(searchMemories('', [a, b], NOW).map((x) => x.text)).toEqual(['new', 'old']);
});

test('empty memories → []', () => expect(searchMemories('x', [], NOW)).toEqual([]));
