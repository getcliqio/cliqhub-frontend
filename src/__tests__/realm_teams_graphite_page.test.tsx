/** Graphite realm Teams — one BFF read per page; a row is the team, its description and Run (the rest is on the team's page). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { overview_for_realm } from './fixtures_realm';
import { gs_response } from './fixtures_overview';
import type { Realm_teams_data } from '@/lib/realm_teams';
import { coverage_text } from '@/lib/realm_teams';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));
vi.mock('@/components/run_in_realm_dialog', () => ({ Run_in_realm_dialog: ({ scope, slug, fixed_realm }: { scope: string; slug: string; fixed_realm: { slug: string } }) => <div role="dialog" aria-label="Run dialog">{scope}/{slug} in {fixed_realm.slug}</div> }));

import { Component as TeamsPage } from '@/pages/realm/realm_teams_graphite_page';

function teams(over: Partial<Realm_teams_data> = {}): Realm_teams_data {
	return {
		realm: { id: 'r-prod', slug: 'prod-us', name: 'prod-us', org_slug: 'measureone' },
		items: [
			{ team_id: 't-fdj', version_id: 'v-fdj-241', scope: 'cliq', slug: 'feature-dev-js', label: '@cliq/feature-dev-js', version: '2.4.1', latest_version: '2.5.0', update_available: true, origin: 'hub', in_team_list: true, installed_count: 3, online_daemon_count: 3, online_stale: 0, last_run_at: Date.now() - 60_000, missing_agents: [], description: 'Builds JS features', use_when: ['You have a Jira ticket for a JS change', 'A failing JS test to fix'], not_for: ['Python services'], required_inputs: [{ name: 'ticket', description: 'The Jira key' }] },
			{ team_id: 't-recon', version_id: 'v-recon-083', scope: 'measureone', slug: 'recon', label: '@measureone/recon', version: '0.8.3', latest_version: '0.8.3', update_available: false, origin: 'hub', in_team_list: true, installed_count: 1, online_daemon_count: 3, online_stale: 2, sub_team_updates: 2, last_run_at: null, missing_agents: ['matcher'], description: 'Matches ledgers', use_when: [], not_for: [], required_inputs: [] },
			// Published, but only on a daemon (installed with the CLI): not on the realm's list yet.
			{ team_id: 't-scratch', version_id: null, scope: 'sapan', slug: 'scratch', label: '@sapan/scratch', version: null, latest_version: null, update_available: false, origin: 'cli', in_team_list: false, installed_count: 1, online_daemon_count: 3, online_stale: null, last_run_at: null, missing_agents: [], description: null, use_when: [], not_for: [], required_inputs: [] },
		],
		total: 3, offset: 0, limit: 25,
		...over,
	};
}

type Call = { url: string; body: Record<string, unknown> };
function route_fetch() {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/realm_teams/get') return new Response(JSON.stringify({ ok: true, data: teams() }));
		if (u === '/v1/teams/get_versions') return new Response(JSON.stringify({ ok: true, data: { name: body.name, scope: body.scope, version: '2.5.0', versions: [{ id: 'v-fdj-250', version: '2.5.0', changelog: 'Faster PRs', published_at: Date.now() }, { id: 'v-fdj-241', version: '2.4.1', changelog: null, published_at: null }] } }));
		if (u === '/v1/team_list/get') return new Response(JSON.stringify({ ok: true, data: { items: [{ id: 't-hello', name: 'hello-world', scope: 'cliq', description: 'Say hi', latest_version: '1.0.0' }, { id: 't-fdj', name: 'feature-dev-js', scope: 'cliq', description: '', latest_version: '2.5.0' }], total: 2 } }));
		return new Response(JSON.stringify({ ok: true, team_list: [] }));
	});
	return calls;
}

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }
function render_page(path = '/o/measureone/realms/prod-us/teams') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/o/:org/realms/:slug/teams" element={<TeamsPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
}

describe('Realm teams page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one read; rows show the realm\'s version, newer available and warnings — no Online daemons column', async () => {
		const calls = route_fetch();
		render_page();
		const fd = await screen.findByTestId('team-@cliq/feature-dev-js');
		// The realm header's own read aside, one page read.
		expect(calls.filter((c) => c.url !== '/v1/realm_inbox/get')).toEqual([{ url: '/v1/realm_teams/get', body: { org_slug: 'measureone', slug: 'prod-us', limit: 25, offset: 0 } }]);
		expect(within(fd).getByTestId('update-badge')).toHaveTextContent('↑ 2.5.0 available');
		expect(screen.queryByRole('columnheader', { name: /Version/ })).toBeNull();
		expect(screen.queryByRole('columnheader', { name: /Online daemons/ })).toBeNull();
		expect(screen.queryByTestId('online-current')).toBeNull();
		const recon = screen.getByTestId('team-@measureone/recon');
		expect(within(recon).getByTestId('team-version')).toHaveTextContent('· 0.8.3');
		expect(within(recon).getByText(/needs agents: matcher/)).toBeInTheDocument();
		// Sub-team updates (S8): newer versions of sub-teams it calls without a pin; none on a team without.
		expect(within(recon).getByTestId('sub-team-updates-badge')).toHaveTextContent('2 sub-team updates');
		expect(within(fd).queryByTestId('sub-team-updates-badge')).toBeNull();
		expect(within(screen.getByTestId('team-@sapan/scratch')).getByText(/not on the realm’s team list/)).toBeInTheDocument();
		expect(screen.queryByRole('group', { name: 'Coverage' })).toBeNull();
		expect(within(screen.getByRole('navigation', { name: 'Realm sections' })).getByRole('link', { name: /^Teams/ })).toHaveAttribute('aria-current', 'page');
	});

	it('a row shows the description only: when to use it and its inputs are on the team\'s page', async () => {
		route_fetch();
		render_page();
		const fd = await screen.findByTestId('team-@cliq/feature-dev-js');
		expect(within(fd).getByTestId('team-description')).toHaveTextContent('Builds JS features');
		expect(fd).not.toHaveTextContent('You have a Jira ticket');
		expect(fd).not.toHaveTextContent('needs ticket');
		expect(within(fd).queryByTestId('purpose-toggle')).toBeNull();
		expect(within(screen.getByTestId('team-@sapan/scratch')).queryByTestId('team-description')).toBeNull();
	});

	it('a row opens its team (no Open button); Run is its only action', async () => {
		route_fetch();
		render_page();
		const rowel = await screen.findByTestId('team-@measureone/recon');
		const href = '/o/measureone/realms/prod-us/teams/measureone/recon?v=0.8.3'; // the version installed here
		expect(within(rowel).getByRole('link', { name: '@measureone/recon' })).toHaveAttribute('href', href);
		expect(within(rowel).queryByTestId('row-open')).toBeNull();
		expect(within(rowel).getAllByRole('button').map((b) => b.textContent)).toEqual(['Run']);
		for (const name of [/Update/, /Change version/, /More for/]) expect(within(rowel).queryByRole('button', { name })).toBeNull();
		// The update badge is a label, not a button: clicking it opens the team like the rest of the row.
		fireEvent.click(within(rowel).getByTestId('team-version'));
		expect(await screen.findByTestId('where')).toHaveTextContent(href.split('?')[0]);
	});

	it('always the flat list: no Tree view (each team\'s sub-team tree is on its page), even when the BFF sends a tree', async () => {
		route_fetch();
		const fetch_mock = vi.mocked(globalThis.fetch);
		const routed = fetch_mock.getMockImplementation()!;
		const tree = [{ label: '@cliq/feature-dev-js', team_id: 't-fdj', version: '2.4.1', pinned: false, may_call: false, used_by: 0, cycle: false, children: [] }];
		fetch_mock.mockImplementation(async (url, init) => (String(url) === '/v1/realm_teams/get'
			? new Response(JSON.stringify({ ok: true, data: { ...teams(), tree } }))
			: routed(url, init)));
		render_page();
		expect(await screen.findByTestId('team-@cliq/feature-dev-js')).toBeInTheDocument();
		expect(screen.queryByTestId('tree-@cliq/feature-dev-js')).toBeNull();
		expect(screen.queryByRole('button', { name: /^Tree$|^Flat$/ })).toBeNull();
	});

	it('Top-level / All: the default asks for the top-level teams; All asks for every team; the counts from the BFF', async () => {
		const calls = route_fetch();
		const fetch_mock = vi.mocked(globalThis.fetch);
		const routed = fetch_mock.getMockImplementation()!;
		fetch_mock.mockImplementation(async (url, init) => (String(url) === '/v1/realm_teams/get'
			? (calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) }), new Response(JSON.stringify({ ok: true, data: { ...teams(), counts: { teams: 3, all: 9 } } })))
			: routed(url, init)));
		render_page();
		await screen.findByTestId('team-@cliq/feature-dev-js');
		const group = screen.getByRole('group', { name: 'Which teams' });
		expect(within(group).getByRole('button', { name: /Top-level/ })).toHaveAttribute('aria-pressed', 'true');
		expect(within(group).getByRole('button', { name: /Top-level/ })).toHaveAttribute('title', 'Teams no other team in this realm runs');
		expect(within(group).getByRole('button', { name: /All/ })).toHaveTextContent('All 9');
		expect(calls.filter((c) => c.url === '/v1/realm_teams/get')[0].body).not.toHaveProperty('show');
		fireEvent.click(within(group).getByRole('button', { name: /All/ }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/realm_teams/get').at(-1)!.body).toMatchObject({ show: 'all' }));
		// A search covers every team: no switch.
		render_page('/o/measureone/realms/prod-us/teams?q=rec');
		await waitFor(() => expect(screen.getAllByRole('group', { name: 'Which teams' })).toHaveLength(1)); // the first page's only
	});

	it('Recently run first (not repeated), then Everything else; the Sub-team column dots a team another team runs', async () => {
		route_fetch();
		const fetch_mock = vi.mocked(globalThis.fetch);
		const routed = fetch_mock.getMockImplementation()!;
		const [fdj, recon, scratch] = teams().items;
		fetch_mock.mockImplementation(async (url, init) => (String(url) === '/v1/realm_teams/get'
			? new Response(JSON.stringify({ ok: true, data: { ...teams(), recent: [fdj], items: [{ ...recon, used_by: ['@cliq/feature-dev-js'] }, scratch], total: 2 } }))
			: routed(url, init)));
		render_page();
		await screen.findByTestId('team-@cliq/feature-dev-js');
		const rows = screen.getAllByRole('row').map((r) => r.getAttribute('data-testid') ?? r.textContent);
		expect(rows.slice(1)).toEqual(['Recently run', 'team-@cliq/feature-dev-js', 'Everything else', 'team-@measureone/recon', 'team-@sapan/scratch']);
		const dot = within(screen.getByTestId('team-@measureone/recon')).getByTestId('sub-team-dot');
		expect(dot).toHaveAttribute('title', 'Run by @cliq/feature-dev-js');
		expect(within(screen.getByTestId('team-@cliq/feature-dev-js')).queryByTestId('sub-team-dot')).toBeNull();
		expect(screen.getByRole('columnheader', { name: 'Is Sub Team' })).toHaveClass('whitespace-nowrap');
		// No uses / used-by chips under the description any more.
		expect(screen.getByTestId('team-@measureone/recon')).not.toHaveTextContent(/used by/i);
	});

	it('search goes to the BFF', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('team-@cliq/feature-dev-js');
		fireEvent.change(screen.getByLabelText('Search teams'), { target: { value: 'rec' } });
		await waitFor(() => expect(calls.filter((c) => c.url !== '/v1/realm_inbox/get').at(-1)!.body).toMatchObject({ q: 'rec' }));
	});

	it('a team only on a daemon is added with one Core write (no Run until it is on the list)', async () => {
		const calls = route_fetch();
		render_page();
		const scratch = await screen.findByTestId('team-@sapan/scratch');
		expect(within(scratch).queryByRole('button', { name: 'Run' })).toBeNull();
		fireEvent.click(within(scratch).getByRole('button', { name: 'Add to realm' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/add_team', body: { realm_id: 'r-prod', team_id: 't-scratch' } }));
		// No second "install" call from the browser — Core's add_team installs.
		expect(calls.some((c) => c.url === '/v1/teams/install' || c.url === '/v1/teams/uninstall')).toBe(false);
		expect(screen.queryByTestId('where')).toBeNull();
	});

	it('Run opens the run dialog for this realm, without opening the team', async () => {
		route_fetch();
		render_page();
		const fd = await screen.findByTestId('team-@cliq/feature-dev-js');
		fireEvent.click(within(fd).getByRole('button', { name: 'Run' }));
		expect(screen.getByRole('dialog', { name: 'Run dialog' })).toHaveTextContent('cliq/feature-dev-js in prod-us');
		expect(screen.queryByTestId('where')).toBeNull();
	});

	it("install drawer searches the org's Teams list and adds with one write", async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('team-@cliq/feature-dev-js');
		fireEvent.click(screen.getByRole('button', { name: 'Install a team' }));
		const dlg = screen.getByRole('dialog', { name: 'Install a team' });
		expect(await within(dlg).findByText('@cliq/hello-world')).toBeInTheDocument();
		// The realm's org's Teams list (PLAN-team-visibility §3.4): a realm installs only from it.
		expect(calls.find((c) => c.url === '/v1/team_list/get')?.body).toMatchObject({ org_id: expect.any(String), scope: 'measureone', status: 'all', limit: 20, offset: 0 });
		// Already in the realm → no add button.
		expect(within(within(dlg).getByText(/@cliq\/feature-dev-js/).closest('li')!).getByText('In this realm')).toBeInTheDocument();
		fireEvent.click(within(within(dlg).getByText(/@cliq\/hello-world/).closest('li')!).getByRole('button', { name: 'Add to realm' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/add_team', body: { realm_id: 'r-prod', team_id: 't-hello' } }));
		expect(await within(dlg).findByRole('status')).toHaveTextContent('@cliq/hello-world added');
	});

	it('BFF/Core version skew shows an out-of-sync message, not a generic failure', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			const u = String(url);
			if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
			if (u === '/v1/getting_started/get') return gs_response(u)!;
			return new Response(JSON.stringify({ ok: false, error: { code: 'upstream_version_mismatch', message: "Core rejected /v1/teams/get: Unrecognized key(s) in object: 'coverage'." } }), { status: 502 });
		});
		render_page();
		const box = await screen.findByTestId('version-skew');
		expect(box).toHaveTextContent('The app and Core are out of sync');
		expect(box).toHaveTextContent("'coverage'");
	});

	it('other Core errors show Core’s own message', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			const u = String(url);
			if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
			if (u === '/v1/getting_started/get') return gs_response(u)!;
			return new Response(JSON.stringify({ ok: false, error: { code: 'upstream_error', message: 'column "sample_team_id" does not exist' } }), { status: 500 });
		});
		render_page();
		expect(await screen.findByText('column "sample_team_id" does not exist')).toBeTruthy();
		expect(screen.queryByTestId('version-skew')).toBeNull();
	});

	it('coverage text', () => {
		expect(coverage_text({ installed_count: 2, online_daemon_count: 3 })).toBe('2/3');
		expect(coverage_text({ installed_count: 0, online_daemon_count: 0 })).toBe('no daemons online');
	});
});
