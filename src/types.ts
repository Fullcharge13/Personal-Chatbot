export type Sender = 'user' | 'persona';

export interface ParsedMessage {
  at: Date;
  sender: string;
  text: string;
}

export interface PersonaSheet {
  name: string;
  relation: string;
  personality: string;
  speechStyle: string;
  background: string;
  notes: string;
}

export interface Persona extends PersonaSheet {
  id: string;
  speechSamples: string[];
  active: boolean;
  createdAt: number;
}

export interface Memory {
  id: string;
  personaId: string;
  source: 'import' | 'chat';
  text: string;
  date?: string;
  keywords: string[];
  createdAt: number;
}

export interface Thread {
  id: string;
  personaId: string;
  text: string;
  createdAt: number;
  used: boolean;
}

export interface ChatMessage {
  id: string;
  personaId: string;
  sender: Sender;
  text: string;
  at: number;
  consolidated: boolean;
  failed?: boolean;
}

export interface Summary {
  personaId: string;
  text: string;
  updatedAt: number;
}

export interface ProfileEntry {
  key: string;
  label: string;
  text: string;
}

export interface Settings {
  apiKey: string;
  provider: 'anthropic';
  model: string;
}

export const LIMITS = {
  speechSamples: 30,
  memories: 10,
  recentMessages: 30,
  openerGapMs: 3_600_000,
} as const;

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export const PROFILE_KEYS = [
  { key: 'basic', label: '기본 정보' },
  { key: 'resume', label: '이력서' },
  { key: 'hobby', label: '취미' },
  { key: 'story', label: '과거 이야기' },
] as const;

export const EMPTY_SHEET: PersonaSheet = {
  name: '',
  relation: '',
  personality: '',
  speechStyle: '',
  background: '',
  notes: '',
};
