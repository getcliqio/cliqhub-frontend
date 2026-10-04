/** Graphite realm Teams — one BFF read per page; add/update/remove are single Core writes. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
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
			{ scope: 'cliq', slug: 'feature-dev-js', label: '@cliq/feature-dev-js', version: '2.4.1', latest_version: '2.5.0', update_available: true, origin: 'published', in_team_list: true, installed_count: 3, online_daemon_count: 3, last_run_at: Date.now() - 60_000, missing_agents: [] },
			{ scope: 'measureone', slug: 'recon', label: '@measureone/recon', version: '0.8.3', latest_version: '0.8.3', update_available: false, origin: 'published', in_team_list: true, installed_count: 1, online_daemon_count: 3, last_run_at: null, missing_agents: ['matcher'] },
			{ scope: 'sapan', slug: 'scratch', label: '@sapan/scratch', version: null, latest_version: null, update_available: false, origin: 'local', in_team_list: false, installed_count: 1, online_daemon_count: 3, last_run_at: null, missing_agents: [] },
		],
		total: 3, offset: 0, limit: 25,
		counts: { all: 3, full: 1, partial: 2, none: 0 },
		partial: false,
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
		if (u === '/v1/teams/get') return new Response(JSON.stringify({ ok: true, data: { teams: [{ name: 'hello-world', scope: 'cliq', description: 'Say hi', latest_version: '1.0.0' }, { name: 'feature-dev-js', scope: 'cliq', description: '', latest_version: '2.5.0' }], total: 2 } }));
		return new Response(JSON.stringify({ ok: true, team_list: [] }));
	});
	return calls;
}

function render_page(path = '/o/measureone/realms/prod-us/teams') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/o/:org/realms/:slug/teams" element={<TeamsPage />} /></Routes></MemoryRouter>);
}

describe('Realm teams page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one read; rows show version, update, coverage, warnings', async () => {
		const calls = route_fetch();
		render_page();
		const fd = await screen.findByTestId('team-@cliq/feature-dev-js');
		expect(calls).toEqual([{ url: '/v1/realm_teams/get', body: { org_slug: 'measureone', slug: 'prod-us', limit: 25, offset: 0 } }]);
		expect(within(fd).getByTestId('update-badge')).toHaveTextContent('↑ 2.5.0');
		expect(within(fd).getByText('3/3')).toBeInTheDocument();
		const recon = screen.getByTestId('team-@measureone/recon');
		expect(within(recon).getByText('1/3')).toBeInTheDocument();
		expect(within(recon).getByText(/needs agents: matcher/)).toBeInTheDocument();
		expect(within(screen.getByTestId('team-@sapan/scratch')).getByText(/not on the realm’s team list/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /On some daemons\s*2/ })).toBeInTheDocument();
		expect(within(screen.getByRole('navigation', { name: 'Realm sections' })).getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page');
	});

	it('coverage chip and search go to the BFF', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('team-@cliq/feature-dev-js');
		fireEvent.click(screen.getByRole('button', { name: /On some daemons/ }));
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ coverage: 'partial' }));
		fireEvent.change(screen.getByLabelText('Search teams'), { target: { value: 'rec' } });
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ q: 'rec', coverage: 'partial' }));
	});

	it('update, remove (confirmed) and add are single Core writes', async () => {
		const calls = route_fetch();
		render_page();
		const fd = await screen.findByTestId('team-@cliq/feature-dev-js');
		fireEvent.click(within(fd).getByRole('button', { name: 'Update' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/add_team', body: { realm_id: 'r-prod', scope: 'cliq', slug: 'feature-dev-js' } }));
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
		expect(screen.getByRole('menuitem', { name: 'View team' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/teams/cliq/feature-dev-js');
	});

	it('install drawer searches the catalog and adds with one write', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('team-@cliq/feature-dev-js');
		fireEvent.click(screen.getByRole('button', { name: 'Install a team' }));
		const dlg = screen.getByRole('dialog', { name: 'Install a team' });
		expect(await within(dlg).findByText('@cliq/hello-world')).toBeInTheDocument();
		// Published teams only (drafts can't be installed).
		expect(calls.find((c) => c.url === '/v1/teams/get')?.body).toEqual({ status: 'published', limit: 20, offset: 0 });
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
