/** Taking a marketplace team on: add it to your org (then a realm), or fork it into a scope you own. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview, ORG_A, ORG_B } from './fixtures_overview';
import type { Team_header, Team_org_state, Team_page_data } from '@/lib/team_page';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan', email: 's@x.com', role: 'user' as const, preferences: {} },
	scopes: [{ id: 's1', slug: 'sapan', display_name: 'sapan', visibility: 'public' as const, scope_type: 'user' as const }, { id: 's2', slug: 'measureone', display_name: 'MeasureOne', visibility: 'public' as const, scope_type: 'org' as const }],
	loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as TeamPage } from '@/pages/teams/team_graphite_page';
import { newer } from '@/components/graphite/g_team_get';

const org = (id: string, slug: string, name: string, over: Partial<Team_org_state> = {}): Team_org_state => ({
	org_id: id, org_slug: slug, org_name: name, role: 'admin', in_library: false, own: false, added_at: null, added_by: null, realms: [], ...over,
});
const HEADER: Team_header = {
	id: 'tid', name: 'feature-dev-js', scope: 'cliq', label: '@cliq/feature-dev-js', description: 'Ticket to reviewed PR', status: 'published',
	latest_version: '1.4.2', version: '1.4.2',
	versions: [{ version: '1.4.2', changelog: null, published_at: 1, is_latest: true }, { version: '1.3.0', changelog: null, published_at: 0, is_latest: false }],
	author: 'cliq', listed: true, tags: [], can_edit: false, can_delete: false, can_toggle_listing: false,
	forked_from: null, fork_count: 3, draft_saved_at: null,
	orgs: [org(ORG_A, 'measureone', 'MeasureOne'), org(ORG_B, 'acme-labs', 'Acme Labs', { role: 'member' })],
};

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(header: Team_header = HEADER, writes: Record<string, { status: number; body: unknown }> = {}) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (writes[u]) return new Response(JSON.stringify(writes[u].body), { status: writes[u].status });
		if (u === '/v1/team_page/get') {
			const data: Team_page_data = { team: header, counts: { phases: 2, versions: 2, runs: 0 }, view: 'files', partial: false, files: { files: [] } };
			return new Response(JSON.stringify({ ok: true, data: { ...data, view: body.view ?? 'overview' } }));
		}
		if (u === '/v1/teams/create') return new Response(JSON.stringify({ ok: true, data: { id: 'fork-1' } }));
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}

function Loc() { const l = useLocation(); return <output data-testid="loc">{l.pathname}{l.search}</output>; }
function render_at(path = '/teams/cliq/feature-dev-js?tab=files') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/teams/:scope/:name" element={<><TeamPage /><Loc /></>} />
				<Route path="*" element={<Loc />} />
			</Routes>
		</MemoryRouter>,
	);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('newer', () => {
	it('compares versions numerically', () => {
		expect(newer('1.10.0', '1.9.3')).toBe(true);
		expect(newer('1.4.2', '1.4.2')).toBe(false);
		expect(newer(null, '1.0.0')).toBe(false);
	});
});

describe('a marketplace team you have not taken on', () => {
	it('offers Add to your org first, not Run; the marketplace is the way back', async () => {
		route_fetch();
		render_at();
		expect(await screen.findByRole('button', { name: 'Add to your org' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /^Run…/ })).toBeNull();
		expect(screen.getByRole('button', { name: /Fork to edit/ })).toBeInTheDocument();
		expect(within(screen.getAllByRole('navigation', { name: 'Breadcrumb' }).at(-1)!).getByRole('link', { name: 'Marketplace' })).toHaveAttribute('href', '/marketplace');
	});

	it('adds it to the org, then to a realm of that org, and offers to run it there', async () => {
		const calls = route_fetch();
		render_at();
		fireEvent.click(await screen.findByRole('button', { name: 'Add to your org' }));
		const drawer = screen.getByRole('dialog', { name: 'Add @cliq/feature-dev-js' });
		fireEvent.click(within(drawer).getByRole('radio', { name: /MeasureOne/ }));
		const realms = within(drawer).getByRole('radiogroup', { name: 'Realm' });
		expect(within(realms).getByRole('radio', { name: /just add it to the org/ })).toBeChecked();
		fireEvent.click(within(realms).getByRole('radio', { name: /prod-us/ }));
		fireEvent.click(within(drawer).getByRole('button', { name: 'Add to measureone and prod-us' }));
		expect(await within(drawer).findByText('Ready in prod-us')).toBeInTheDocument();
		const writes = calls.filter((c) => c.url === '/v1/orgs/add_team' || c.url === '/v1/realms/add_team');
		expect(writes).toEqual([
			{ url: '/v1/orgs/add_team', body: { org_id: ORG_A, team_id: 'tid' } },
			{ url: '/v1/realms/add_team', body: { realm_id: 'r-prod', scope: 'cliq', slug: 'feature-dev-js' } },
		]);
		expect(within(drawer).getByRole('button', { name: 'Run in prod-us' })).toBeInTheDocument();
	});

	it('can stop at the org; a refusal says who can add it', async () => {
		const calls = route_fetch(HEADER, { '/v1/orgs/add_team': { status: 403, body: { ok: false, error: 'Permission required', code: 'forbidden' } } });
		render_at();
		fireEvent.click(await screen.findByRole('button', { name: 'Add to your org' }));
		const drawer = screen.getByRole('dialog', { name: 'Add @cliq/feature-dev-js' });
		fireEvent.click(within(drawer).getByRole('radio', { name: /Acme Labs/ }));
		fireEvent.click(within(drawer).getByRole('button', { name: 'Add to acme-labs' }));
		expect(await within(drawer).findByRole('alert')).toHaveTextContent('Ask an org admin or operator');
		expect(calls.some((c) => c.url === '/v1/realms/add_team')).toBe(false);
	});
});

describe('a team already in your org', () => {
	it('in the org but no realm: Add to a realm skips the org step', async () => {
		const calls = route_fetch({ ...HEADER, orgs: [org(ORG_A, 'measureone', 'MeasureOne', { in_library: true })] });
		render_at('/teams/cliq/feature-dev-js');
		expect(await screen.findByTestId('team-where')).toHaveTextContent('In MeasureOne — not in a realm yet');
		fireEvent.click(screen.getByRole('button', { name: 'Add to a realm' }));
		const drawer = screen.getByRole('dialog', { name: 'Add @cliq/feature-dev-js' });
		expect(within(drawer).getByText('in org')).toBeInTheDocument();
		fireEvent.click(within(drawer).getByRole('radio', { name: /staging/ }));
		fireEvent.click(within(drawer).getByRole('button', { name: 'Add to staging' }));
		await within(drawer).findByText('Ready in staging');
		expect(calls.filter((c) => c.url.endsWith('/add_team')).map((c) => c.url)).toEqual(['/v1/realms/add_team']);
	});

	it('in a realm: Run is the main action', async () => {
		route_fetch({ ...HEADER, orgs: [org(ORG_A, 'measureone', 'MeasureOne', { in_library: true, realms: [{ realm_id: 'r-prod', slug: 'prod-us' }] })] });
		render_at('/teams/cliq/feature-dev-js');
		expect(await screen.findByRole('button', { name: /^Run…/ })).toBeInTheDocument();
		expect(screen.getByTestId('team-where')).toHaveTextContent('In MeasureOne (prod-us)');
	});
});

describe('forking', () => {
	it('forks a chosen version into an org scope and opens the copy in the Builder', async () => {
		const calls = route_fetch();
		render_at();
		fireEvent.click(await screen.findByRole('button', { name: /Fork to edit/ }));
		const dialog = screen.getByRole('dialog', { name: 'Fork @cliq/feature-dev-js' });
		expect(within(dialog).getByRole('combobox', { name: 'Scope' })).toHaveValue('measureone');
		expect(within(dialog).getByRole('list', { name: 'What forking does' })).toHaveTextContent('@measureone/feature-dev-js is a new private draft');
		fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Bad Name' } });
		expect(within(dialog).getByRole('button', { name: 'Fork and edit' })).toBeDisabled();
		fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'our-pipeline' } });
		fireEvent.change(within(dialog).getByRole('combobox', { name: 'From version' }), { target: { value: '1.3.0' } });
		fireEvent.click(within(dialog).getByRole('button', { name: 'Fork and edit' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe(`/builder?draft=fork-1&from=${encodeURIComponent('/teams/measureone/our-pipeline')}`));
		expect(calls.find((c) => c.url === '/v1/teams/create')!.body).toEqual({ name: 'our-pipeline', scope: 'measureone', forked_from: { team_id: 'tid', version: '1.3.0' } });
	});

	it('a taken name is shown on the name field', async () => {
		route_fetch(HEADER, { '/v1/teams/create': { status: 409, body: { ok: false, error: 'exists', code: 'conflict' } } });
		render_at();
		fireEvent.click(await screen.findByRole('button', { name: /Fork to edit/ }));
		const dialog = screen.getByRole('dialog', { name: 'Fork @cliq/feature-dev-js' });
		fireEvent.click(within(dialog).getByRole('button', { name: 'Fork only' }));
		expect(await within(dialog).findByRole('alert')).toHaveTextContent('@measureone/feature-dev-js already exists');
	});

	it('a fork links back to its origin and says when the origin has moved on', async () => {
		route_fetch({ ...HEADER, can_edit: true, forked_from: { team_id: 'o', scope: 'cliq', name: 'feature-dev-js', version: '1.3.0', latest_version: '1.4.2' } });
		render_at();
		const strip = await screen.findByTestId('lineage');
		expect(strip).toHaveTextContent('Forked from @cliq/feature-dev-js at v1.3.0');
		expect(within(strip).getByText('v1.4.2 is out')).toBeInTheDocument();
		expect(within(strip).getByRole('link', { name: 'See what changed →' })).toHaveAttribute('href', '/teams/cliq/feature-dev-js?tab=versions&from=1.3.0&to=1.4.2');
	});

	it('owners open the team itself in the Builder', async () => {
		route_fetch({ ...HEADER, can_edit: true, draft_saved_at: new Date(Date.now() - 120_000).toISOString() });
		render_at('/teams/cliq/feature-dev-js');
		expect(await screen.findByText(/Unpublished changes saved/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Open in Builder' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('/builder?draft=tid'));
	});
});
