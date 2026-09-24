import { describe, it, expect } from 'vitest';
import {
	aggregate_realm_teams,
	parse_run_inputs_text,
	team_filter_param,
} from '@/lib/realm_teams_coverage';

describe('aggregate_realm_teams', () => {
	const daemons = [
		{ id: 'd1', status: 'online' as const, name: 'mac-lab' },
		{ id: 'd2', status: 'online' as const, name: 'gpu-01' },
		{ id: 'd3', status: 'stale' as const, name: 'edge' },
	];

	it('aggregates installs across realm daemons', () => {
		const rows = aggregate_realm_teams(daemons, [
			{ scope: 'acme', slug: 'claims', daemon_id: 'd1', version: '1.0.0', id: 't1' },
			{ scope: 'acme', slug: 'claims', daemon_id: 'd2', version: '1.0.0', id: 't2' },
			{ scope: 'cliq', slug: 'smoke', daemon_id: 'd1', id: 't3' },
			{ scope: 'other', slug: 'x', daemon_id: 'outside', id: 't4' },
		]);
		expect(rows).toHaveLength(2);
		const claims = rows.find((r) => r.slug === 'claims');
		expect(claims?.installed_count).toBe(2);
		expect(claims?.online_daemon_count).toBe(2);
		expect(claims?.coverage_label).toBe('2/2 online');
		expect(claims?.label).toBe('@acme/claims');
		expect(rows.find((r) => r.slug === 'smoke')?.installed_count).toBe(1);
	});

	it('ignores teams with no daemon_id', () => {
		const rows = aggregate_realm_teams(daemons, [
			{ scope: 'acme', slug: 'claims', daemon_id: null },
		]);
		expect(rows).toHaveLength(0);
	});

	it('tags origin as published when in published_set', () => {
		const published = new Set(['acme/claims']);
		const rows = aggregate_realm_teams(daemons, [
			{ scope: 'acme', slug: 'claims', daemon_id: 'd1', id: 't1' },
			{ scope: 'cliq', slug: 'hello-world', daemon_id: 'd1', id: 't2' },
		], published);
		const claims = rows.find((r) => r.slug === 'claims');
		const hello = rows.find((r) => r.slug === 'hello-world');
		expect(claims?.origin).toBe('published');
		expect(hello?.origin).toBe('local');
	});

	it('defaults to local when no published_set provided', () => {
		const rows = aggregate_realm_teams(daemons, [
			{ scope: 'acme', slug: 'claims', daemon_id: 'd1', id: 't1' },
		]);
		expect(rows[0]?.origin).toBe('local');
	});
});

describe('parse_run_inputs_text', () => {
	it('parses key=value lines', () => {
		expect(parse_run_inputs_text('claim_id=CLM-1\nregion=us-west\n')).toEqual({
			claim_id: 'CLM-1',
			region: 'us-west',
		});
	});

	it('skips blanks and comments', () => {
		expect(parse_run_inputs_text('# note\n\nfoo=bar')).toEqual({ foo: 'bar' });
	});
});

describe('team_filter_param', () => {
	it('builds scope/slug for Runs filter', () => {
		expect(team_filter_param('acme', 'claims-intake')).toBe('acme/claims-intake');
	});
});
