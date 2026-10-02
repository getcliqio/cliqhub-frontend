/** Browse (marketplace): the sidebar sorts reach teams/get as Core's sort_by; no dead category filters. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/org_context', () => ({ useOrgFetch: () => stable_fetch }));

import { Component as BrowsePage } from '@/pages/teams/teams_page';
import { BrowseSidebar } from '@/components/browse_sidebar';

function route_fetch() {
	const calls: Array<Record<string, unknown>> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
		calls.push(init?.body ? JSON.parse(String(init.body)) : {});
		return new Response(JSON.stringify({ ok: true, data: { teams: [], total: 0, limit: 20, offset: 0, sortable: ['name', 'install_count', 'created_at', 'updated_at'] } }));
	});
	return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('Browse sort', () => {
	it.each([
		['Recently updated', { sort_by: 'updated_at', sort_dir: 'desc' }],
		['Name A–Z', { sort_by: 'name', sort_dir: 'asc' }],
	])('%s → teams/get sort_by / sort_dir (page 1)', async (label, sort) => {
		const calls = route_fetch();
		render(<MemoryRouter initialEntries={['/browse?offset=20']}><BrowseSidebar /><BrowsePage /></MemoryRouter>);
		await waitFor(() => expect(calls.length).toBeGreaterThan(1));
		expect(calls.at(-1)).not.toHaveProperty('sort_by');
		fireEvent.click(screen.getByRole('button', { name: label }));
		await waitFor(() => expect(calls.at(-1)).toMatchObject({ ...sort, offset: 0 }));
		fireEvent.click(screen.getByRole('button', { name: 'Most popular' }));
		await waitFor(() => expect(calls.at(-1)).not.toHaveProperty('sort_by'));
	});

	it('never sends category or the old sort field, and shows no category filters', async () => {
		const calls = route_fetch();
		render(<MemoryRouter initialEntries={['/browse?cat=devops&sort=recent']}><BrowseSidebar /><BrowsePage /></MemoryRouter>);
		await waitFor(() => expect(calls.length).toBeGreaterThan(1));
		for (const body of calls) {
			expect(body).not.toHaveProperty('category');
			expect(body).not.toHaveProperty('sort');
		}
		expect(screen.queryByRole('navigation', { name: 'Filter by category' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'DevOps' })).toBeNull();
		expect(screen.queryByText('Category')).toBeNull();
	});
});
