import { LIMITS, PROFILE_KEYS } from './types';

test('limits match the spec', () => {
  expect(LIMITS).toEqual({ speechSamples: 30, memories: 10, recentMessages: 30, openerGapMs: 3_600_000 });
  expect(PROFILE_KEYS.map((p) => p.key)).toEqual(['basic', 'resume', 'hobby', 'story']);
});
