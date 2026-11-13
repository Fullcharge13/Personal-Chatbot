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
  /** Set on a message the persona sent first, so an unanswered one is not followed by another. */
  kind?: 'opener';
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

export type Provider = 'anthropic' | 'google';

/** The provider in use, with its key and model. */
export interface Settings {
  apiKey: string;
  provider: Provider;
  model: string;
}

export const LIMITS = {
  speechSamples: 30,
  memories: 10,
  recentMessages: 30,
  openerGapMs: 3_600_000,
} as const;

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-sonnet-5-5',
  google: 'gemini-3.8-flash',
};
export const DEFAULT_MODEL = DEFAULT_MODELS.anthropic;

export const PROVIDERS: { id: Provider; label: string; keyHint: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', keyHint: 'sk-ant-...' },
  { id: 'google', label: 'Google (Gemini)', keyHint: 'Google AI Studio에서 발급한 키' },
];

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
