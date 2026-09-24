import { describe, it, expect } from 'vitest';
import {
	build_teams_search_params,
	parse_scope_filter,
	normalize_teams_offset,
	normalize_teams_limit,
} from '@/lib/teams_filters';

describe('teams_filters', () => {
	it('build_teams_search_params omits defaults', () => {
		expect(build_teams_search_params({}).toString()).toBe('');
		expect(build_teams_search_params({ q: '  hug  ', scopes: ['acme'] }).toString()).toBe(
			'q=hug&scope=acme',
		);
		expect(
			build_teams_search_params({
				scopes: ['a', 'b'],
				offset: 20,
				limit: 50,
			}).toString(),
		).toBe('scope=a%2Cb&offset=20&limit=50');
		expect(build_teams_search_params({ limit: 20, offset: 0 }).toString()).toBe('');
	});

	it('parse_scope_filter splits, strips @, dedupes', () => {
		expect(parse_scope_filter(null)).toEqual([]);
		expect(parse_scope_filter('')).toEqual([]);
		expect(parse_scope_filter('@acme, beta, @acme')).toEqual(['acme', 'beta']);
	});

	it('normalize_teams_offset / limit', () => {
		expect(normalize_teams_offset('40')).toBe(40);
		expect(normalize_teams_offset('-1')).toBe(0);
		expect(normalize_teams_limit(50)).toBe(50);
		expect(normalize_teams_limit(undefined)).toBeUndefined();
	});
});
