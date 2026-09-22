import { describe, expect, it } from 'vitest';
import { resolveOwnerIdentity } from '../src/services/ownerAuth';

describe('resolveOwnerIdentity', () => {
  it('returns the authenticated user identity from getUser', async () => {
    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'session-id', email: 'session@example.com' } } }, error: null }),
        getUser: async () => ({ data: { user: { id: 'owner-id', email: 'owner@example.com' } }, error: null })
      }
    };

    await expect(resolveOwnerIdentity(client as never)).resolves.toEqual({
      id: 'owner-id',
      email: 'owner@example.com'
    });
  });

  it('returns null when there is no authenticated session', async () => {
    const client = {
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        getUser: async () => ({ data: { user: null }, error: null })
      }
    };

    await expect(resolveOwnerIdentity(client as never)).resolves.toBeNull();
  });
});
