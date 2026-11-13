import { extractJson } from './json';

test('plain JSON', () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }));
test('fenced', () => expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 }));
test('prose around', () => expect(extractJson('결과입니다: {"a":1} 이상입니다.')).toEqual({ a: 1 }));
test('truncated → null', () => expect(extractJson('{"a":[1,2')).toBeNull());
test('no json → null', () => expect(extractJson('죄송합니다')).toBeNull());
test('non-object JSON → null', () => expect(extractJson('[1,2]')).toBeNull());
