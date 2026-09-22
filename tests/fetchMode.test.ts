import { describe, expect, it } from 'vitest';
import { isAttachExistingMode } from '../automation/experiments/fetchMode';

describe('Phase 2A Fetch attach mode', () => {
  it('requires the explicit attach flag', () => {
    expect(isAttachExistingMode([])).toBe(false);
    expect(isAttachExistingMode(['--attach-existing'])).toBe(true);
  });
});
