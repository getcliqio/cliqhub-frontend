/**
 * A phase's state as the run page shows it: once the run has ended, no phase can still be
 * waiting on people or running. A phase left "awaiting_input" (or "running" in a cancelled or
 * completed run) shows as stopped; a phase left "running" in a failed / crashed run shows as
 * failed / crashed (the step that was in flight when the run died).
 */
const ENDED = new Set(['failed', 'crashed', 'cancelled', 'completed', 'done']);

export function phase_state_in_run(phase_status: string, run_state?: string | null): string {
	const s = (phase_status || '').trim().toLowerCase();
	const r = (run_state || '').trim().toLowerCase();
	if (!ENDED.has(r)) return phase_status;
	if (s === 'awaiting_input' || s === 'pending_input') return 'stopped';
	if (s === 'running') return r === 'failed' || r === 'crashed' ? r : 'stopped';
	return phase_status;
}
