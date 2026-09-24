import { describe, it, expect } from 'vitest';
import {
	build_realms_get_body,
	build_realms_search_params,
	next_sort_state,
	normalize_offset,
	normalize_owned_filter,
	normalize_sort_by,
	normalize_sort_dir,
} from '@/lib/realms_filters';

describe('realms_filters', () => {
	it('build_realms_search_params omits defaults and sets create', () => {
		expect(build_realms_search_params({}).toString()).toBe('');
		expect(build_realms_search_params({ q: '  prod  ', owned: 'me' }).toString()).toBe(
			'q=prod&owned=me',
		);
		expect(build_realms_search_params({ create: true, q: 'x' }).toString()).toBe(
			'q=x&create=1',
		);
		expect(
			build_realms_search_params({
				sort_by: 'created_at',
				sort_dir: 'desc',
				offset: 20,
			}).toString(),
		).toBe('sort=created_at&dir=desc&offset=20');
	});

	it('normalize_owned_filter only allows me|default', () => {
		expect(normalize_owned_filter('me')).toBe('me');
		expect(normalize_owned_filter('DEFAULT')).toBe('default');
		expect(normalize_owned_filter('other')).toBe('');
		expect(normalize_owned_filter(null)).toBe('');
	});

	it('normalize_sort_by / sort_dir / offset', () => {
		expect(normalize_sort_by('name')).toBe('name');
		expect(normalize_sort_by('nope')).toBe('slug');
		expect(normalize_sort_dir('DESC')).toBe('desc');
		expect(normalize_sort_dir('asc')).toBe('asc');
		expect(normalize_offset('40')).toBe(40);
		expect(normalize_offset('-1')).toBe(0);
	});

	it('build_realms_get_body sends server filters', () => {
		expect(
			build_realms_get_body({
				q: 'acme',
				owned: 'me',
				sort_by: 'name',
				sort_dir: 'desc',
				limit: 20,
				offset: 20,
			}),
		).toEqual({
			query: 'acme',
			owned: 'me',
			sort_by: 'name',
			sort_dir: 'desc',
			limit: 20,
			offset: 20,
		});
	});

	it('next_sort_state toggles then resets', () => {
		expect(next_sort_state('slug', 'asc', 'name')).toEqual({ sort_by: 'name', sort_dir: 'asc' });
		expect(next_sort_state('name', 'asc', 'name')).toEqual({ sort_by: 'name', sort_dir: 'desc' });
		expect(next_sort_state('name', 'desc', 'name')).toEqual({ sort_by: 'slug', sort_dir: 'asc' });
	});
});
