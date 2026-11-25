/** A finished run never shows a phase as waiting on people or running (lib/phase_state.ts). */
import { describe, it, expect } from 'vitest';
import { phase_state_in_run } from '@/lib/phase_state';

describe('phase_state_in_run', () => {
	it('a phase left waiting on people in an ended run is stopped', () => {
		for (const run of ['failed', 'crashed', 'cancelled', 'completed']) expect(phase_state_in_run('awaiting_input', run)).toBe('stopped');
	});
	it('the step in flight when the run failed / crashed shows that; in a cancelled run it is stopped', () => {
		expect(phase_state_in_run('running', 'failed')).toBe('failed');
		expect(phase_state_in_run('running', 'crashed')).toBe('crashed');
		expect(phase_state_in_run('running', 'cancelled')).toBe('stopped');
	});
	it('a live run, and finished phases, are shown as they are', () => {
		expect(phase_state_in_run('awaiting_input', 'running')).toBe('awaiting_input');
		expect(phase_state_in_run('awaiting_input', 'awaiting_input')).toBe('awaiting_input');
		expect(phase_state_in_run('completed', 'failed')).toBe('completed');
		expect(phase_state_in_run('pending', 'failed')).toBe('pending');
	});
});
