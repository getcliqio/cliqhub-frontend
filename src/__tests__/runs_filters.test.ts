import { describe, it, expect } from 'vitest';
import {
	build_runs_search_params,
	display_run_name,
	run_matches_team_filter,
} from '@/lib/runs_filters';

describe('display_run_name', () => {
	it('prefers run_name', () => {
		expect(display_run_name({ run_id: 'run_abc123456789', run_name: 'Claim CLM-1' })).toBe('Claim CLM-1');
	});

	it('falls back to shortened run_id', () => {
		expect(display_run_name({ run_id: 'run_abc123456789', run_name: null })).toBe('run_abc1…');
	});
});

describe('run_matches_team_filter', () => {
	it('matches @scope/slug against scope/slug', () => {
		expect(run_matches_team_filter('@acme/claims-intake', 'acme/claims-intake')).toBe(true);
	});

	it('rejects other teams', () => {
		expect(run_matches_team_filter('@cliq/smoke', 'acme/claims-intake')).toBe(false);
	});

	it('empty filter matches all', () => {
		expect(run_matches_team_filter('@cliq/smoke', '')).toBe(true);
	});
});

describe('build_runs_search_params', () => {
	it('omits empty fields', () => {
		const p = build_runs_search_params({ team: 'acme/x', state: '', q: '  ' });
		expect(p.get('team')).toBe('acme/x');
		expect(p.has('state')).toBe(false);
		expect(p.has('q')).toBe(false);
	});
});
