import { describe, expect, it } from 'vitest';
import {
	all_group_selectors,
	event_groups_for_scope,
	group_check_state,
	leaf_checked,
	partition_event_selectors,
	summarize_selectors,
	toggle_group,
	toggle_leaf,
} from '@/lib/notification_event_catalog';

const run_group = {
	value: 'run.*',
	label: 'All runs',
	children: [
		{ value: 'run.started', label: 'Run started' },
		{ value: 'run.failed', label: 'Run failed' },
		{ value: 'run.crashed', label: 'Run crashed' },
	],
};

describe('notification_event_catalog', () => {
	it('selecting all runs stores only the group wildcard', () => {
		expect(toggle_group([], run_group, true)).toEqual(['run.*']);
	});

	it('unchecking a child under all-runs expands to siblings', () => {
		const next = toggle_leaf(['run.*'], run_group, 'run.failed', false);
		expect(next.sort()).toEqual(['run.crashed', 'run.started']);
		expect(group_check_state(next, run_group)).toBe('indeterminate');
	});

	it('checking every child collapses to the group', () => {
		const next = toggle_leaf(
			['run.started', 'run.failed'],
			run_group,
			'run.crashed',
			true,
		);
		expect(next).toEqual(['run.*']);
		expect(leaf_checked(next, run_group, 'run.failed')).toBe(true);
	});

	it('summarizes multi-select for the trigger', () => {
		expect(summarize_selectors([], 'realm')).toBe('Select events…');
		expect(summarize_selectors(['run.*'], 'realm')).toBe('All runs');
		expect(summarize_selectors(['run.*', 'phase.*', 'hug.*'], 'realm')).toBe(
			'All runs, All phases +1',
		);
	});

	it('all scope includes realm and account families', () => {
		const groups = event_groups_for_scope('all').map((g) => g.value);
		expect(groups).toEqual(expect.arrayContaining(['run.*', 'team.*', 'auth.*']));
		expect(all_group_selectors('all').length).toBeGreaterThan(all_group_selectors('account').length);

		const parts = partition_event_selectors(['run.*', 'team.*', 'notification.test']);
		expect(parts.account.sort()).toEqual(['notification.test', 'team.*']);
		expect(parts.realm).toEqual(['run.*']);
	});
});
