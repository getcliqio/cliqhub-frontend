/** Graphite realm Teams — one BFF read per page; add/update/remove are single Core writes. */
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
			{ scope: 'cliq', slug: 'feature-dev-js', label: '@cliq/feature-dev-js', version: '2.4.1', latest_version: '2.5.0', update_available: true, origin: 'hub', in_team_list: true, installed_count: 3, online_daemon_count: 3, online_stale: 0, last_run_at: Date.now() - 60_000, missing_agents: [], description: 'Builds JS features', use_when: ['You have a Jira ticket for a JS change', 'A failing JS test to fix'], not_for: ['Python services'], required_inputs: [{ name: 'ticket', description: 'The Jira key' }] },
			{ scope: 'measureone', slug: 'recon', label: '@measureone/recon', version: '0.8.3', latest_version: '0.8.3', update_available: false, origin: 'hub', in_team_list: true, installed_count: 1, online_daemon_count: 3, online_stale: 2, last_run_at: null, missing_agents: ['matcher'], description: 'Matches ledgers', use_when: [], not_for: [], required_inputs: [] },
			{ scope: 'sapan', slug: 'scratch', label: '@sapan/scratch', version: null, latest_version: null, update_available: false, origin: 'cli', in_team_list: false, installed_count: 1, online_daemon_count: 3, online_stale: null, last_run_at: null, missing_agents: [], description: null, use_when: [], not_for: [], required_inputs: [] },
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
		if (u === '/v1/teams/get_versions') return new Response(JSON.stringify({ ok: true, data: { name: body.name, scope: body.scope, version: '2.5.0', versions: [{ version: '2.5.0', changelog: 'Faster PRs', published_at: Date.now() }, { version: '2.4.1', changelog: null, published_at: null }] } }));
		if (u === '/v1/team_list/get') return new Response(JSON.stringify({ ok: true, data: { items: [{ name: 'hello-world', scope: 'cliq', description: 'Say hi', latest_version: '1.0.0' }, { name: 'feature-dev-js', scope: 'cliq', description: '', latest_version: '2.5.0' }], total: 2 } }));
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

	it('one read; rows show the realm\'s version, newer available, online daemons current or not, warnings', async () => {
		const calls = route_fetch();
		render_page();
		const fd = await screen.findByTestId('team-@cliq/feature-dev-js');
		// The realm header's own read aside, one page read.
		expect(calls.filter((c) => c.url !== '/v1/realm_inbox/get')).toEqual([{ url: '/v1/realm_teams/get', body: { org_slug: 'measureone', slug: 'prod-us', limit: 25, offset: 0 } }]);
		expect(within(fd).getByTestId('update-badge')).toHaveTextContent('↑ 2.5.0 available');
		expect(screen.queryByRole('columnheader', { name: /Version/ })).toBeNull();
		expect(within(screen.getByTestId('team-@measureone/recon')).getByTestId('team-version')).toHaveTextContent('· 0.8.3');
		expect(within(fd).getByTestId('online-current')).toHaveTextContent('Online daemons are current');
		const recon = screen.getByTestId('team-@measureone/recon');
		expect(within(recon).getByTestId('online-stale')).toHaveTextContent('2 online daemons aren’t on 0.8.3');
		// A team only daemons report (not on the realm's list): what they have.
		expect(within(screen.getByTestId('team-@sapan/scratch')).getByText('1/3')).toBeInTheDocument();
		expect(within(recon).getByText(/needs agents: matcher/)).toBeInTheDocument();
		expect(within(screen.getByTestId('team-@sapan/scratch')).getByText(/not on the realm’s team list/)).toBeInTheDocument();
		// No coverage chips: the Online daemons column says what matters.
		expect(screen.queryByRole('group', { name: 'Coverage' })).toBeNull();
		expect(within(screen.getByRole('navigation', { name: 'Realm sections' })).getByRole('link', { name: /^Teams/ })).toHaveAttribute('aria-current', 'page');
	});

	it('each row says when to use the team: first use_when (else the description), the inputs it needs, the rest on a toggle', async () => {
		route_fetch();
		render_page();
		const fd = await screen.findByTestId('team-@cliq/feature-dev-js');
		const line = within(fd).getByTestId('team-purpose-line');
		expect(line).toHaveTextContent('You have a Jira ticket for a JS change');
		expect(line).toHaveTextContent('needs ticket');
		expect(within(fd).queryByTestId('team-purpose')).toBeNull();
		fireEvent.click(within(fd).getByTestId('purpose-toggle'));
		const lists = within(fd).getByTestId('team-purpose');
		expect(lists).toHaveTextContent('A failing JS test to fix');
		expect(lists).toHaveTextContent('Python services');
		// The toggle doesn't open the team.
		expect(screen.queryByTestId('where')).toBeNull();
		// No use_when: the description; nothing known (a local install): no line.
		expect(within(screen.getByTestId('team-@measureone/recon')).getByTestId('team-purpose-line')).toHaveTextContent('Matches ledgers');
		expect(within(screen.getByTestId('team-@sapan/scratch')).queryByTestId('team-purpose-line')).toBeNull();
	});

	it('a row opens its team: the name is the link, Open leads the row\'s buttons, other buttons do only their own thing', async () => {
		route_fetch();
		render_page();
		const rowel = await screen.findByTestId('team-@measureone/recon');
		const href = '/o/measureone/realms/prod-us/teams/measureone/recon?v=0.8.3'; // the version installed here
		expect(within(rowel).getByRole('link', { name: '@measureone/recon' })).toHaveAttribute('href', href);
		expect(within(rowel).getByTestId('row-open')).toHaveAttribute('href', href);
		fireEvent.click(within(rowel).getByRole('button', { name: /More for/ }));
		expect(screen.queryByTestId('where')).toBeNull();
		fireEvent.click(within(rowel).getByTestId('team-version')); // the version now sits with the team name
		expect(await screen.findByTestId('where')).toHaveTextContent(href.split('?')[0]);
	});

	it('search goes to the BFF', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('team-@cliq/feature-dev-js');
		fireEvent.change(screen.getByLabelText('Search teams'), { target: { value: 'rec' } });
		await waitFor(() => expect(calls.filter((c) => c.url !== '/v1/realm_inbox/get').at(-1)!.body).toMatchObject({ q: 'rec' }));
	});

	it('Update… picks a version (latest by default) and moves the realm to it; Update them re-installs the realm\'s version', async () => {
		const calls = route_fetch();
		render_page();
		const fd = await screen.findByTestId('team-@cliq/feature-dev-js');
		fireEvent.click(within(fd).getByRole('button', { name: 'Update…' }));
		const drawer = await screen.findByRole('dialog', { name: 'Version of @cliq/feature-dev-js' });
		expect(within(drawer).getByRole('radio', { name: /2\.5\.0/ })).toBeChecked();
		expect(within(drawer).getByText('Faster PRs')).toBeInTheDocument();
		fireEvent.click(within(drawer).getByRole('button', { name: 'Update realm to 2.5.0' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/add_team', body: { realm_id: 'r-prod', scope: 'cliq', slug: 'feature-dev-js', version: '2.5.0' } }));
		// The newer badge opens the same picker.
		fireEvent.click(await within(screen.getByTestId('team-@cliq/feature-dev-js')).findByTestId('update-badge'));
		expect(await screen.findByRole('dialog', { name: 'Version of @cliq/feature-dev-js' })).toBeInTheDocument();
		fireEvent.click(within(screen.getByRole('dialog', { name: 'Version of @cliq/feature-dev-js' })).getByRole('button', { name: 'Cancel' }));
		// Up to date: Change version… ; daemons not on it: Update them.
		const recon = screen.getByTestId('team-@measureone/recon');
		expect(within(recon).getByRole('button', { name: 'Change version…' })).toBeInTheDocument();
		fireEvent.click(within(recon).getByRole('button', { name: 'Update them' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/add_team', body: { realm_id: 'r-prod', scope: 'measureone', slug: 'recon', version: '0.8.3' } }));
	});

	it('remove (confirmed) and add are single Core writes', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('team-@cliq/feature-dev-js');
		fireEvent.click(within(screen.getByTestId('team-@measureone/recon')).getByRole('button', { name: 'More for @measureone/recon' }));
		fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from realm…' }));
		fireEvent.click(within(screen.getByTestId('team-@measureone/recon')).getByRole('button', { name: 'Remove' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/remove_team', body: { realm_id: 'r-prod', scope: 'measureone', slug: 'recon' } }));
		fireEvent.click(within(screen.getByTestId('team-@sapan/scratch')).getByRole('button', { name: 'Add to realm' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/add_team', body: { realm_id: 'r-prod', scope: 'sapan', slug: 'scratch' } }));
		// No second "install" call from the browser — Core's add_team installs.
		expect(calls.some((c) => c.url === '/v1/teams/install' || c.url === '/v1/teams/uninstall')).toBe(false);
	});

	it('Run opens the run dialog for this realm; ⋯ links to runs and the team', async () => {
		route_fetch();
		render_page();
		const fd = await screen.findByTestId('team-@cliq/feature-dev-js');
		fireEvent.click(within(fd).getByRole('button', { name: 'Run' }));
		expect(screen.getByRole('dialog', { name: 'Run dialog' })).toHaveTextContent('cliq/feature-dev-js in prod-us');
		fireEvent.click(within(fd).getByRole('button', { name: 'More for @cliq/feature-dev-js' }));
		expect(screen.getByRole('menuitem', { name: 'Runs of this team' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs?team=cliq%2Ffeature-dev-js');
		expect(screen.getByRole('menuitem', { name: 'View team' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/teams/cliq/feature-dev-js?v=2.4.1');
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
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/add_team', body: { realm_id: 'r-prod', scope: 'cliq', slug: 'hello-world' } }));
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
