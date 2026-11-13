import { parseWhatsApp } from './whatsapp';
import android from './fixtures/whatsapp-android.txt?raw';
import ios from './fixtures/whatsapp-ios.txt?raw';

const fixtures: Record<string, string> = { android, ios };

test.each(['android', 'ios'])('%s fixture', (kind) => {
  const r = parseWhatsApp(fixtures[kind])!;
  expect(r).toHaveLength(4);
  expect(r[0]).toEqual({ at: new Date(2024, 2, 1, 14, 15), sender: '홍길동', text: '안녕' });
  expect(r[2].text).toBe('첫 줄\n둘째 줄\n셋째 줄');
  expect(r[3]).toEqual({ at: new Date(2024, 2, 2, 9, 5), sender: '나', text: '좋은 아침' });
});

test('korean-locale lines with 오전/오후 parse (android and ios)', () => {
  const a = parseWhatsApp('24. 3. 1. 오후 2:15 - 지수: 안녕\n24. 3. 1. 오전 12:05 - 지수: 자?')!;
  expect(a[0]).toEqual({ at: new Date(2024, 2, 1, 14, 15), sender: '지수', text: '안녕' });
  expect(a[1].at).toEqual(new Date(2024, 2, 1, 0, 5));
  const i = parseWhatsApp('[24. 3. 1. 오후 2:15:02] 지수: 안녕')!;
  expect(i[0]).toEqual({ at: new Date(2024, 2, 1, 14, 15), sender: '지수', text: '안녕' });
});

test('AM/PM lines parse, including U+202F before PM', () => {
  const r = parseWhatsApp('3/25/24, 2:15 PM - A: x\n3/25/24, 12:05 AM - A: y\n[3/25/24, 2:15:02 PM] A: z')!;
  expect(r[0].at).toEqual(new Date(2024, 2, 25, 14, 15));
  expect(r[1].at).toEqual(new Date(2024, 2, 25, 0, 5));
  expect(r[2].at).toEqual(new Date(2024, 2, 25, 14, 15));
});

test('lines without "Name:" (system notices) are dropped', () => {
  const r = parseWhatsApp(android)!;
  expect(r.some((m) => /encrypted/.test(m.text) || /encrypted/.test(m.sender))).toBe(false);
});

test('media placeholders and U+200E-prefixed lines are dropped', () => {
  const r = parseWhatsApp(
    '1/3/24, 14:15 - A: <미디어 파일을 생략했습니다>\n1/3/24, 14:16 - A: ‎<attached: 0001.jpg>\n1/3/24, 14:17 - A: 진짜 메시지',
  )!;
  expect(r.map((m) => m.text)).toEqual(['진짜 메시지']);
});

test('a continuation line after a dropped message is not attached to an earlier one', () => {
  const r = parseWhatsApp('1/3/24, 14:15 - A: 하나\n1/3/24, 14:16 - A: <Media omitted>\n캡션\n1/3/24, 14:17 - A: 둘')!;
  expect(r.map((m) => m.text)).toEqual(['하나', '둘']);
});

test('date order: a value over 12 in the first slot anywhere in the file → day/month for the whole file', () => {
  const r = parseWhatsApp('3/4/24, 10:00 - A: x\n25/4/24, 10:00 - A: y')!;
  expect(r[0].at).toEqual(new Date(2024, 3, 3, 10, 0));
});

test('date order: a value over 12 in the second slot → month/day', () => {
  const r = parseWhatsApp('3/4/24, 10:00 - A: x\n3/25/24, 10:00 - A: y')!;
  expect(r[0].at).toEqual(new Date(2024, 2, 4, 10, 0));
});

test('date order: fully ambiguous → day/month', () => {
  const r = parseWhatsApp('3/4/24, 10:00 - A: x')!;
  expect(r[0].at).toEqual(new Date(2024, 3, 3, 10, 0));
});

test('year-first [2024/3/1 ...] is never ambiguous', () => {
  const r = parseWhatsApp('[2024/3/4 10:00:00] A: x')!;
  expect(r[0].at).toEqual(new Date(2024, 2, 4, 10, 0));
});

test('four-digit trailing year and dotted european dates parse', () => {
  const r = parseWhatsApp('25.03.2024, 10:00 - A: x')!;
  expect(r[0].at).toEqual(new Date(2024, 2, 25, 10, 0));
});

test('message text containing ": " keeps everything after the first separator', () => {
  const r = parseWhatsApp('1/3/24, 14:15 - A: 메모: 내일 3시')!;
  expect(r[0]).toMatchObject({ sender: 'A', text: '메모: 내일 3시' });
});

test('BOM and CRLF are stripped', () => {
  expect(parseWhatsApp('﻿' + android.replace(/\n/g, '\r\n'))).toEqual(parseWhatsApp(android));
});

test('non-whatsapp text → null', () => expect(parseWhatsApp('hello\nworld')).toBeNull());
test('empty string → null', () => expect(parseWhatsApp('')).toBeNull());
