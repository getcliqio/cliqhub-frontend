import { describe, it, expect } from 'vitest';
import {
	build_agents_list_params,
	filter_agents_by_query,
	page_agents,
} from '@/lib/agents_list_filters';

describe('agents_list_filters', () => {
	const agents = [
		{ name: 'exec', description: 'Shell runner' },
		{ name: 'hug', description: 'Human review gate' },
		{ name: 'cursor', description: null },
	];

	it('filter_agents_by_query matches name display and description', () => {
		expect(filter_agents_by_query(agents, '', (n) => n).map((a) => a.name)).toEqual([
			'exec', 'hug', 'cursor',
		]);
		expect(filter_agents_by_query(agents, 'hug', (n) => n).map((a) => a.name)).toEqual(['hug']);
		expect(filter_agents_by_query(agents, 'shell', (n) => n).map((a) => a.name)).toEqual(['exec']);
		expect(filter_agents_by_query(agents, 'CURSOR', (n) => `X-${n}`).map((a) => a.name)).toEqual([
			'cursor',
		]);
	});

	it('page_agents slices by offset/limit', () => {
		expect(page_agents(agents, 0, 2).map((a) => a.name)).toEqual(['exec', 'hug']);
		expect(page_agents(agents, 2, 2).map((a) => a.name)).toEqual(['cursor']);
	});

	it('build_agents_list_params omits defaults and keeps keys', () => {
		const base = new URLSearchParams('tab=agents&agent=exec');
		expect(build_agents_list_params({ base, keep: ['tab'], q: 'hug' }).toString()).toBe(
			'tab=agents&q=hug',
		);
		expect(
			build_agents_list_params({ q: '', offset: 20, limit: 50 }).toString(),
		).toBe('offset=20&limit=50');
	});
});
