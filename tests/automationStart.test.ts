import { describe, expect, it, vi } from 'vitest';
import { startAutomationRun } from '../src/services/automationStart';

function client(overrides: Record<string, unknown> = {}) {
  const rpc = vi.fn().mockResolvedValue({
    data: { commandSeq: 1, runId: '11111111-1111-4111-8111-111111111111', runState: 'running' },
    error: null
  });
  const query = vi.fn(() => ({
    eq: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { owner_user_id: 'owner-1', command_seq: 0 }, error: null })
    }))
  }));
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'owner-1', email: 'owner@example.com' } }, error: null })
    },
    from: vi.fn(() => ({ select: query })),
    rpc,
    ...overrides
  } as never;
}

describe('startAutomationRun', () => {
  it('uses the authenticated owner and authoritative command sequence', async () => {
    const supabase = client();
    const result = await startAutomationRun(supabase);

    expect(result).toEqual({ ownerId: 'owner-1', runId: '11111111-1111-4111-8111-111111111111', commandSeq: 1, runState: 'running' });
    expect((supabase as any).rpc).toHaveBeenCalledWith('automation_request_command', expect.objectContaining({
      p_owner: 'owner-1',
      p_expected_seq: 0,
      p_action: 'START',
      p_target_run: null
    }));
  });

  it('fails closed for a malformed RPC result', async () => {
    const supabase = client({
      rpc: vi.fn().mockResolvedValue({ data: { runId: 'not-a-uuid' }, error: null })
    });

    await expect(startAutomationRun(supabase)).rejects.toThrow('INVALID_START_RESULT');
  });

  it('does not call the RPC without an authenticated user', async () => {
    const supabase = client({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      rpc: vi.fn()
    });

    await expect(startAutomationRun(supabase)).rejects.toThrow('AUTH_REQUIRED');
    expect((supabase as any).rpc).not.toHaveBeenCalled();
  });
});
