export interface OwnerIdentity {
  id: string;
  email: string | null;
}

interface OwnerAuthClient {
  auth: {
    getSession: () => Promise<{ data: { session: unknown | null }; error: unknown | null }>;
    getUser: () => Promise<{ data: { user: { id: string; email?: string | null } | null }; error: unknown | null }>;
  };
}

export async function resolveOwnerIdentity(client: OwnerAuthClient): Promise<OwnerIdentity | null> {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData.session) return null;

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user?.id) return null;

  return {
    id: userData.user.id,
    email: userData.user.email ?? null
  };
}
