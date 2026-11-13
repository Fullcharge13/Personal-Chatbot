import { parseKakao } from './kakao';
import android from './fixtures/kakao-android.txt?raw';
import ios from './fixtures/kakao-ios.txt?raw';
import pc from './fixtures/kakao-pc.txt?raw';

const fixtures: Record<string, string> = { android, ios, pc };

test.each(['android', 'ios', 'pc'])('%s fixture', (kind) => {
  const r = parseKakao(fixtures[kind])!;
  expect(r).toHaveLength(4);
  expect(r[0]).toEqual({ at: new Date(2024, 2, 1, 14, 15), sender: '홍길동', text: '안녕' });
  expect(r[1].sender).toBe('나');
  expect(r[2].text).toBe('첫 줄\n둘째 줄\n셋째 줄');
  expect(r[3]).toEqual({ at: new Date(2024, 2, 2, 9, 5), sender: '나', text: '좋은 아침' });
});

test('오전 12:05 → 0시 5분, 오후 12:05 → 12시 5분', () => {
  const r = parseKakao(
    '2024년 3월 1일 오전 12:05, 가 : a\n2024년 3월 1일 오후 12:05, 가 : b',
  )!;
  expect(r[0].at).toEqual(new Date(2024, 2, 1, 0, 5));
  expect(r[1].at).toEqual(new Date(2024, 2, 1, 12, 5));
});

test('system lines (입장, 퇴장, 구분선, 저장한 날짜) are dropped', () => {
  const r = parseKakao(android)!;
  expect(r.some((m) => /들어왔습니다|저장한 날짜|카카오톡 대화/.test(m.text))).toBe(false);
  expect(r.some((m) => /들어왔습니다/.test(m.sender))).toBe(false);
});

test('pc: a system line does not get appended to the previous message', () => {
  const r = parseKakao(pc)!;
  expect(r[1].text).toBe('응 안녕');
});

test('BOM and CRLF are stripped', () => {
  expect(parseKakao('﻿' + android.replace(/\n/g, '\r\n'))).toEqual(parseKakao(android));
});

test('a body line that contains " : " but no date prefix is appended to the previous message', () => {
  const r = parseKakao('2024년 3월 1일 오후 2:15, 가 : 메모\n시간 : 3시\n장소 : 강남')!;
  expect(r).toHaveLength(1);
  expect(r[0].text).toBe('메모\n시간 : 3시\n장소 : 강남');
});

test('sender name containing a comma is kept whole', () => {
  const r = parseKakao('2024년 3월 1일 오후 2:15, 김, 철수 : 응')!;
  expect(r[0].sender).toBe('김, 철수');
  expect(r[0].text).toBe('응');
});

test('message text containing " : " keeps everything after the first separator', () => {
  const r = parseKakao('2024년 3월 1일 오후 2:15, 가 : 비율 1 : 2 로 해')!;
  expect(r[0].text).toBe('비율 1 : 2 로 해');
});

test('blank lines inside a multi-line message are preserved', () => {
  const r = parseKakao('2024년 3월 1일 오후 2:15, 가 : 위\n\n아래\n2024년 3월 1일 오후 2:16, 나 : 응')!;
  expect(r[0].text).toBe('위\n\n아래');
});

test('non-kakao text → null', () => expect(parseKakao('hello\nworld')).toBeNull());
test('empty string → null', () => expect(parseKakao('')).toBeNull());
