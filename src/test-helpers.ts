import type { Memory, PersonaSheet } from './types';

export const sheet = (name: string): PersonaSheet => ({
  name,
  relation: '친구',
  personality: '다정함',
  speechStyle: '반말',
  background: '',
  notes: '',
});

export const mem = (
  text: string,
  keywords: string[] = [],
  date?: string,
): Omit<Memory, 'id' | 'personaId' | 'createdAt'> => ({ source: 'chat', text, keywords, date });
