import { SupabaseClient } from '@supabase/supabase-js';

export interface AutomationStartResult {
  ownerId: string;
  runId: string;
  commandSeq: number;
  runState: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function startAutomationRun(client: SupabaseClient): Promise<AutomationStartResult> {
  const { data: userData, error: userError } = await client.auth.getUser();
  const ownerId = userData.user?.id;
  if (userError || !ownerId) throw new Error('AUTH_REQUIRED');

  const { data: control, error: controlError } = await client
    .from('automation_control')
    .select('owner_user_id, command_seq')
    .eq('owner_user_id', ownerId)
    .single();
  if (controlError || !control || control.owner_user_id !== ownerId || !Number.isInteger(control.command_seq)) {
    throw new Error('OWNER_CONTROL_UNAVAILABLE');
  }

  const commandId = crypto.randomUUID();
  const { data, error } = await client.rpc('automation_request_command', {
    p_owner: ownerId,
    p_command_id: commandId,
    p_expected_seq: control.command_seq,
    p_action: 'START',
    p_target_run: null
  });
  if (error) throw error;

  const result = data as Partial<AutomationStartResult> | null;
  if (!result || typeof result.runId !== 'string' || !UUID_PATTERN.test(result.runId) ||
      typeof result.commandSeq !== 'number' || !Number.isInteger(result.commandSeq) ||
      typeof result.runState !== 'string' || result.runState !== 'running') {
    throw new Error('INVALID_START_RESULT');
  }

  return {
    ownerId,
    runId: result.runId,
    commandSeq: result.commandSeq,
    runState: result.runState
  };
}
