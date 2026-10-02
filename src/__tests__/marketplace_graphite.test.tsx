/** Marketplace (Graphite): one team_list/get { source: 'catalog' } per view; filters live in the URL. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview } from './fixtures_overview';
import type { Team_list_data, Team_list_row } from '@/lib/team_page';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as Marketplace, ago } from '@/pages/marketplace_page';

const install = (over: Partial<Team_list_row['installs'][number]> = {}) => ({
	realm_id: 'r-prod', realm_slug: 'prod-us', realm_name: 'prod-us', org_slug: 'measureone', version: '1.4.2', behind: false,
	in_team_list: true, installed_count: 3, online_daemon_count: 3, last_run_at: null, missing_agents: [], ...over,
});
const row = (name: string, scope: string, over: Partial<Team_list_row> = {}, catalog: Partial<NonNullable<Team_list_row['catalog']>> = {}): Team_list_row => ({
	id: `id-${name}`, name, scope, description: `${name} does things`, status: 'published', latest_version: '1.4.2', author: scope,
	phase_types: ['standard', 'gate'], phase_kinds: ['agent', 'human', 'gate'], installs: [],
	catalog: { tags: ['engineering'], install_count: 40, version_count: 12, fork_count: 3, verified: true, updated_at: Date.now() - 6 * 86400000, has: ['human', 'gate'], runnable: false, ...catalog },
	...over,
});

function catalog(over: Partial<Team_list_data> = {}): Team_list_data {
	return {
		items: [
			row('feature-dev-js', 'cliq', { installs: [install()] }, { runnable: true }),
			row('content-review', 'cliq', { latest_version: '1.5.0', installs: [install({ version: '1.4.0', behind: true })] }),
			row('incident-response', 'opsguild', {}, { verified: false, fork_count: 0, has: ['connector'] }),
		],
		total: 3, offset: 0, limit: 24, counts: { all: 486, published: 486, draft: 0 }, realms_checked: 1, realms_total: 1, partial: false,
		sortable: ['popular', 'newest', 'updated', 'name'],
		facets: {
			tags: [{ tag: 'engineering', count: 212 }, { tag: 'content', count: 74 }],
			publishers: [{ scope: 'cliq', count: 63, verified: true }, { scope: 'opsguild', count: 4, verified: false }],
			has: { human: 118, gate: 150, team: 33, connector: 20 }, verified: 63, installed: 12, runnable: 9,
		},
		...over,
	};
}

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(data: (body: Record<string, unknown>) => Team_list_data = () => catalog()) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/team_list/get') return new Response(JSON.stringify({ ok: true, data: data(body) }));
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}

function Loc() { const l = useLocation(); return <output data-testid="loc">{l.pathname}{l.search}</output>; }
function render_at(path = '/marketplace') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/marketplace" element={<><Marketplace /><Loc /></>} />
				<Route path="/teams/:scope/:name" element={<Loc />} />
			</Routes>
		</MemoryRouter>,
	);
}
const last_list = (calls: Call[]) => calls.filter((c) => c.url === '/v1/team_list/get').at(-1)!.body;

afterEach(() => { vi.restoreAllMocks(); });

describe('ago', () => {
	it('says how long ago in words', () => {
		const now = 1_000_000_000_000;
		expect(ago(null, now)).toBeNull();
		expect(ago(now - 20_000, now)).toBe('just now');
		expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
		expect(ago(now - 86_400_000, now)).toBe('1 day ago');
		expect(ago(now - 6 * 86_400_000, now)).toBe('6 days ago');
	});
});

describe('Marketplace', () => {
	it('reads the catalog once with the realm for install state, and shows cards with their facts', async () => {
		const calls = route_fetch();
		render_at();
		const card = await screen.findByTestId('market-cliq/feature-dev-js');
		expect(last_list(calls)).toEqual({ source: 'catalog', sort_by: 'popular', limit: 24, offset: 0, realm_id: 'r-prod' });
		expect(within(card).getByText('verified')).toBeInTheDocument();
		expect(within(card).getByText('In prod-us')).toBeInTheDocument();
		expect(within(card).getByRole('img', { name: /3 phases/ })).toBeInTheDocument();
		expect(within(card).getByText(/12 versions · 40 installs/)).toBeInTheDocument();
		expect(card).toHaveAttribute('href', '/teams/cliq/feature-dev-js');
		expect(within(screen.getByTestId('market-cliq/content-review')).getByText('1.5.0 available')).toBeInTheDocument();
		expect(within(screen.getByTestId('market-opsguild/incident-response')).queryByText('verified')).toBeNull();
		expect(screen.getByRole('searchbox', { name: 'Search teams' })).toHaveAttribute('placeholder', expect.stringContaining('486 teams'));
		expect(screen.getByText('3 teams')).toBeInTheDocument();
	});

	it('facets filter the read and show as removable chips; Clear all resets', async () => {
		const calls = route_fetch();
		render_at();
		await screen.findByTestId('market-cliq/feature-dev-js');
		const filters = screen.getByRole('complementary', { name: 'Filters' });
		fireEvent.click(within(filters).getByRole('checkbox', { name: /engineering/ }));
		await waitFor(() => expect(last_list(calls)).toMatchObject({ tags: ['engineering'] }));
		fireEvent.click(within(filters).getByRole('checkbox', { name: /Human review/ }));
		fireEvent.click(within(filters).getByRole('checkbox', { name: /Verified only/ }));
		fireEvent.click(within(filters).getByRole('checkbox', { name: /Only teams I can run now/ }));
		await waitFor(() => expect(last_list(calls)).toMatchObject({ tags: ['engineering'], has: ['human'], verified: true, runnable: true, realm_id: 'r-prod' }));
		expect(screen.getByTestId('loc').textContent).toContain('tags=engineering');
		fireEvent.click(screen.getByRole('button', { name: 'Remove filter Human review' }));
		await waitFor(() => expect(last_list(calls).has).toBeUndefined());
		fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
		await waitFor(() => expect(last_list(calls)).toEqual({ source: 'catalog', sort_by: 'popular', limit: 24, offset: 0, realm_id: 'r-prod' }));
	});

	it('sorts, searches after typing stops, and picks the realm for install state', async () => {
		const calls = route_fetch();
		render_at();
		await screen.findByTestId('market-cliq/feature-dev-js');
		fireEvent.click(screen.getByRole('button', { name: 'Recently updated' }));
		await waitFor(() => expect(last_list(calls).sort_by).toBe('updated'));
		fireEvent.change(screen.getByRole('searchbox', { name: 'Search teams' }), { target: { value: 'jira' } });
		await waitFor(() => expect(last_list(calls).q).toBe('jira'), { timeout: 2000 });
		fireEvent.change(screen.getByRole('combobox', { name: 'Realm for install state' }), { target: { value: 'r-sand' } });
		await waitFor(() => expect(last_list(calls).realm_id).toBe('r-sand'));
	});

	it('empty states: no matches offers to clear; an empty catalog offers to build', async () => {
		route_fetch(() => catalog({ items: [], total: 0 }));
		const { unmount } = render_at('/marketplace?verified=1');
		expect(await screen.findByText('No teams match these filters')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
		unmount();
		vi.restoreAllMocks();
		route_fetch(() => catalog({ items: [], total: 0 }));
		render_at();
		expect(await screen.findByText('Nothing published yet')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Build a team' })).toHaveAttribute('href', '/builder');
	});

	it('pages through results', async () => {
		const calls = route_fetch(() => catalog({ total: 60 }));
		render_at();
		await screen.findByTestId('market-cliq/feature-dev-js');
		fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
		await waitFor(() => expect(last_list(calls).offset).toBe(24));
	});
});
