/** Browse (marketplace): sort pills reach teams/get as Core's sort_by; tags filter; no dead category filters; cards link by sign-in state. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/org_context', () => ({ useOrgFetch: () => stable_fetch }));
const auth = vi.hoisted(() => ({ user: null as null | { username: string } }));
vi.mock('@/lib/auth_context', async (orig) => ({ ...(await orig<object>()), useAuth: () => ({ user: auth.user, loading: false, scopes: [] }) }));

import { Component as BrowsePage } from '@/pages/teams/teams_page';

const TEAM = { name: 'hello-world', scope: 'cliq', description: 'Says hi', author: null, latest_version: '2.0.0', install_count: 3, tags: [] };

function route_fetch(teams: unknown[] = []) {
	const calls: Array<Record<string, unknown>> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
		calls.push(init?.body ? JSON.parse(String(init.body)) : {});
		return new Response(JSON.stringify({ ok: true, data: { teams, total: teams.length, limit: 24, offset: 0 } }));
	});
	return calls;
}

afterEach(() => { vi.restoreAllMocks(); auth.user = null; });

describe('Browse sort', () => {
	it.each([
		['Recently updated', { sort_by: 'updated_at', sort_dir: 'desc' }],
		['Name A–Z', { sort_by: 'name', sort_dir: 'asc' }],
	])('%s → teams/get sort_by / sort_dir (page 1)', async (label, sort) => {
		const calls = route_fetch();
		render(<MemoryRouter initialEntries={['/browse?offset=24']}><BrowsePage /></MemoryRouter>);
		await waitFor(() => expect(calls.length).toBeGreaterThan(0));
		expect(calls.at(-1)).not.toHaveProperty('sort_by');
		fireEvent.click(screen.getByRole('button', { name: label }));
		await waitFor(() => expect(calls.at(-1)).toMatchObject({ ...sort, offset: 0 }));
		fireEvent.click(screen.getByRole('button', { name: 'Most popular' }));
		await waitFor(() => expect(calls.at(-1)).not.toHaveProperty('sort_by'));
	});

	it('a tag filters, and clicking it again clears it', async () => {
		const calls = route_fetch();
		render(<MemoryRouter initialEntries={['/browse']}><BrowsePage /></MemoryRouter>);
		await waitFor(() => expect(calls.length).toBeGreaterThan(0));
		fireEvent.click(screen.getByRole('button', { name: 'devops' }));
		await waitFor(() => expect(calls.at(-1)).toMatchObject({ tag: 'devops', offset: 0 }));
		fireEvent.click(screen.getByRole('button', { name: 'devops' }));
		await waitFor(() => expect(calls.at(-1)).not.toHaveProperty('tag'));
	});

	it('never sends category or the old sort field, and shows no category filters', async () => {
		const calls = route_fetch();
		render(<MemoryRouter initialEntries={['/browse?cat=devops&sort=recent']}><BrowsePage /></MemoryRouter>);
		await waitFor(() => expect(calls.length).toBeGreaterThan(0));
		for (const body of calls) {
			expect(body).not.toHaveProperty('category');
			expect(body).not.toHaveProperty('sort');
		}
		expect(screen.queryByRole('navigation', { name: 'Filter by category' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'DevOps' })).toBeNull();
		expect(screen.queryByText('Category')).toBeNull();
	});
});

describe('Browse cards', () => {
	it('signed out: a card opens the public detail page', async () => {
		route_fetch([TEAM]);
		render(<MemoryRouter initialEntries={['/browse']}><BrowsePage /></MemoryRouter>);
		expect(await screen.findByTestId('market-cliq/hello-world')).toHaveAttribute('href', '/browse/cliq/hello-world');
	});

	it('signed in: a card opens the Graphite team page', async () => {
		auth.user = { username: 'sapan' };
		route_fetch([TEAM]);
		render(<MemoryRouter initialEntries={['/browse']}><BrowsePage /></MemoryRouter>);
		expect(await screen.findByTestId('market-cliq/hello-world')).toHaveAttribute('href', '/teams/cliq/hello-world');
	});
});
