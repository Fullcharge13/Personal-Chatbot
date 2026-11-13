import { filterByPeriod, listSenders, parseChatExport } from './index';
import kakao from './fixtures/kakao-android.txt?raw';
import whatsapp from './fixtures/whatsapp-android.txt?raw';

test('detects kakao and whatsapp fixtures', () => {
  expect(parseChatExport(kakao).format).toBe('kakao');
  expect(parseChatExport(whatsapp).format).toBe('whatsapp');
  expect(parseChatExport(whatsapp).messages).toHaveLength(4);
});

test('unknown format throws UNKNOWN_FORMAT', () => {
  expect(() => parseChatExport('그냥 메모입니다')).toThrow('UNKNOWN_FORMAT');
  expect(() => parseChatExport('')).toThrow('UNKNOWN_FORMAT');
});

test('listSenders sorts by count desc', () => {
  const msgs = [
    { at: new Date(), sender: '가', text: '1' },
    { at: new Date(), sender: '나', text: '2' },
    { at: new Date(), sender: '나', text: '3' },
  ];
  expect(listSenders(msgs)).toEqual([
    { name: '나', count: 2 },
    { name: '가', count: 1 },
  ]);
});

test('filterByPeriod keeps messages inside the window', () => {
  const now = new Date(2024, 5, 15);
  const msgs = [
    { at: new Date(2022, 0, 1), sender: 'a', text: 'old' },
    { at: new Date(2023, 11, 1), sender: 'a', text: 'within-year' },
    { at: new Date(2024, 4, 1), sender: 'a', text: 'recent' },
  ];
  expect(filterByPeriod(msgs, 'all', now)).toHaveLength(3);
  expect(filterByPeriod(msgs, '1y', now).map((m) => m.text)).toEqual(['within-year', 'recent']);
  expect(filterByPeriod(msgs, '3m', now).map((m) => m.text)).toEqual(['recent']);
});
