export interface LlmRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
}

export type LlmErrorKind = 'auth' | 'network' | 'quota' | 'other';

export class LlmError extends Error {
  kind: LlmErrorKind;
  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

export interface LlmProvider {
  complete(req: LlmRequest): Promise<string>;
  /** Calls onDelta for each text piece and resolves with the full text. */
  stream(req: LlmRequest, onDelta: (text: string) => void): Promise<string>;
}
