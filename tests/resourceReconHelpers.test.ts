import { describe, expect, it } from 'vitest';
import { classifyImageCandidate, sanitizeResourceUrl } from '../automation/experiments/resourceReconHelpers';

describe('response resource reconnaissance helpers', () => {
  it('sanitizes URL values without retaining query values', () => {
    expect(sanitizeResourceUrl('https://lh3.googleusercontent.com/a/b?sig=secret&x=1')).toEqual({
      protocol: 'https', host: 'lh3.googleusercontent.com', pathPattern: '/a/b', queryParameterNames: ['sig', 'x'],
    });
  });

  it('classifies a larger natural image as a high-resolution candidate', () => {
    expect(classifyImageCandidate(1408, 768, 1024, 559)).toBe('likely original/high-resolution candidate');
  });
});
