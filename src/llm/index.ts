import type { Settings } from '../types';
import { createAnthropicProvider } from './anthropic';
import { createGoogleProvider } from './google';
import type { LlmProvider } from './provider';

/** Builds the connection for whichever provider the settings name. */
export function createProvider(s: Settings, fetchFn?: typeof fetch): LlmProvider {
  return s.provider === 'google' ? createGoogleProvider(s, fetchFn) : createAnthropicProvider(s, fetchFn);
}
