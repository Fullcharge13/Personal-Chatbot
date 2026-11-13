import type { PersonaSheet } from '../types';

export const SHEET_FIELDS: { key: keyof PersonaSheet; label: string; rows: number; hint?: string }[] = [
  { key: 'name', label: '이름', rows: 1 },
  { key: 'relation', label: '관계', rows: 1, hint: '나와 어떤 사이인지' },
  { key: 'personality', label: '성격', rows: 3 },
  { key: 'speechStyle', label: '말투', rows: 3, hint: '반말/존댓말, 말버릇, 자주 쓰는 표현' },
  { key: 'background', label: '배경 설정', rows: 3, hint: '직업, 사는 곳, 세계관 등' },
  { key: 'notes', label: '메모', rows: 3, hint: '그 밖에 이 인물이 지켜야 할 것' },
];
