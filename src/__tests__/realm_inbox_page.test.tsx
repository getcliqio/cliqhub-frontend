/**
 * Graphite realm layout — the header and the left nav every realm page sits in (one BFF read,
 * `summary: true`). The realm itself has no overview page: it opens on Teams.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { inbox as base_inbox, overview_for_realm } from './fixtures_realm';
import type { Realm_inbox_data, Realm_summary } from '@/lib/realm_inbox';
import { gs_response } from './fixtures_overview';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} },
	loading: false,
	logout: vi.fn(),
	acting_as: null,
	stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as InboxPage } from '@/pages/realm/realm_inbox_page';
import { Realm_header } from '@/components/graphite/realm_header';

function Where() {
	const loc = useLocation();
	return <div data-testid="where">{loc.pathname}</div>;
}

const SUMMARY: Realm_summary = {
	realm: { description: 'Production delivery for the US', created_at: Date.now() - 86_400_000, updated_at: Date.now() - 3_600_000, created_by_username: 'sapan' },
	teams: { total: 2, missing_agents: 1, offset: 0, limit: 5, items: [] },
	daemons: { online: 2, total: 3, truncated: false, items: [] },
	people: { total: 3, offset: 0, limit: 5, by_role: { admin: 1, operator: 2 }, pending_invites: 1, items: [] },
	you: { role: 'admin', is_admin: true },
};
const inbox = (over: Partial<Realm_inbox_data> = {}, summary: Partial<Realm_summary> = {}) => base_inbox({ summary: { ...SUMMARY, ...summary }, ...over });
const QUIET = { reviews: 0, awaiting_input: 0, failed_24h: 0, running: 0 };

function route_fetch(data: Realm_inbox_data) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/realms/update') return new Response(JSON.stringify({ ok: true, data: {} }));
		if (u === '/v1/realm_inbox/get') return new Response(JSON.stringify({ ok: true, data }));
		throw new Error(`unexpected ${u}`);
	});
}

let n = 0;
/** The layout around a stand-in page; `item` is the open run / team / daemon. */
function render_layout(path = '/o/measureone/realms/prod-us/teams', { state = null, item = null }: { state?: unknown; item?: string | null } = {}) {
	// A fresh realm slug per render keeps the layout's per-realm cache from leaking between tests.
	const slug = `prod-us-${++n}`;
	const at = path.replace('/prod-us', `/${slug}`);
	render(
		<MemoryRouter initialEntries={[{ pathname: at.split('?')[0], search: at.includes('?') ? `?${at.split('?')[1]}` : '', state }]}>
			<Routes>
				<Route path="/o/:org/realms/:slug/*" element={<Realm_header org_slug="measureone" slug={slug} item={item}><p>page</p></Realm_header>} />
			</Routes>
		</MemoryRouter>,
	);
	return slug;
}
const nav = () => screen.getByRole('navigation', { name: 'Realm sections' });

describe('Realm layout', () => {
	afterEach(() => vi.restoreAllMocks());

	it('the realm opens on Teams (no overview page), carrying New realm’s state along', async () => {
		route_fetch(inbox());
		render(
			<MemoryRouter initialEntries={['/o/measureone/realms/prod-us']}>
				<Routes>
					<Route path="/o/:org/realms/:slug" element={<InboxPage />} />
					<Route path="*" element={<Where />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(await screen.findByTestId('where')).toHaveTextContent('/o/measureone/realms/prod-us/teams');
	});

	it('one read with org + realm slug and summary: true; no Core fan-out from the browser', async () => {
		const spy = route_fetch(inbox());
		const slug = render_layout();
		await screen.findByRole('heading', { name: 'Prod US' });
		const calls = spy.mock.calls.filter(([u]) => u === '/v1/realm_inbox/get');
		expect(calls).toHaveLength(1);
		expect(JSON.parse(String((calls[0][1] as RequestInit).body))).toEqual({ org_slug: 'measureone', slug, summary: true });
		expect(spy.mock.calls.map(([u]) => String(u)).filter((u) => u !== '/v1/realm_inbox/get')).toEqual([]);
	});

	it('header: one big title (the realm), description, slug · creator · updated; no status badge', async () => {
		route_fetch(inbox());
		const slug = render_layout();
		await screen.findByRole('heading', { name: 'Prod US' });
		expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
		expect(screen.getByTestId('realm-description')).toHaveTextContent('Production delivery for the US');
		expect(screen.getByTestId('realm-meta')).toHaveTextContent(`measureone.${slug}`);
		expect(screen.getByTestId('realm-meta')).toHaveTextContent('created by sapan');
		expect(screen.queryByTestId('realm-status')).toBeNull();
		expect(screen.getByText('page')).toBeInTheDocument();
	});

	it('left nav, in order: Teams, Runs, Daemons, Settings — signals, never counts', async () => {
		route_fetch(inbox());
		render_layout();
		await screen.findByRole('heading', { name: 'Prod US' });
		expect(within(nav()).getAllByRole('link').map((l) => l.getAttribute('data-testid'))).toEqual(['go-teams', 'go-runs', 'go-daemons', 'go-settings']);
		// A team is missing agent config; a run needs you / failed; daemons are online.
		expect(within(screen.getByTestId('go-teams')).getByTestId('nav-attention')).toHaveAccessibleName('1 team is missing agent config');
		expect(within(screen.getByTestId('go-runs')).getByTestId('nav-attention')).toHaveAccessibleName('2 need you · 1 failed in the last 24h');
		expect(within(screen.getByTestId('go-daemons')).getByTestId('nav-dot-ok')).toHaveAccessibleName('2 online');
		expect(within(screen.getByTestId('go-settings')).queryByTestId('nav-attention')).toBeNull();
		expect(nav()).not.toHaveTextContent(/\d/);
		expect(screen.getByTestId('go-teams')).toHaveAttribute('aria-current', 'page');
	});

	it('quiet realm: runs going → green dot on Runs; no daemon online → grey dot; only member → ⚠ on Settings', async () => {
		route_fetch(inbox({ counts: { ...QUIET, running: 2 } }, { teams: { ...SUMMARY.teams!, missing_agents: 0 }, daemons: { ...SUMMARY.daemons!, online: 0 }, people: { ...SUMMARY.people!, total: 1 } }));
		render_layout();
		await screen.findByRole('heading', { name: 'Prod US' });
		expect(within(screen.getByTestId('go-teams')).queryByTestId('nav-attention')).toBeNull();
		expect(within(screen.getByTestId('go-runs')).getByTestId('nav-dot-ok')).toHaveAccessibleName('2 running');
		expect(within(screen.getByTestId('go-daemons')).getByTestId('nav-dot-off')).toHaveAccessibleName('No daemon online');
		expect(within(screen.getByTestId('go-settings')).getByTestId('nav-attention')).toBeInTheDocument();
		expect(screen.queryByText(/No daemon available/)).toBeNull();
		expect(screen.queryByText(/Connect/)).toBeNull();
	});

	it('Teams list: what needs you sits on top, with a way to fix it', async () => {
		route_fetch(inbox());
		const slug = render_layout();
		const line = await screen.findByTestId('attention');
		expect(line).toHaveTextContent('1 team is missing agent config — an agent it uses isn’t set up in your org.');
		expect(within(line).getByRole('link', { name: 'Set up agents' })).toHaveAttribute('href', `/o/measureone/realms/${slug}/agents`);
	});

	it('the open run is nested under Runs (only while open); the section link goes back to the list', async () => {
		route_fetch(inbox());
		const slug = render_layout('/o/measureone/realms/prod-us/runs/run-77', { item: 'Nightly reconcile' });
		await screen.findByRole('heading', { name: 'Prod US' });
		const links = within(nav()).getAllByRole('link');
		expect(links[1]).toHaveAttribute('href', `/o/measureone/realms/${slug}/runs`);
		expect(links[1]).not.toHaveAttribute('aria-current');
		const item = screen.getByTestId('nav-item');
		expect(item).toHaveTextContent('Nightly reconcile');
		expect(item).toHaveAttribute('aria-current', 'page');
		// Under Runs, before Daemons.
		expect(screen.getByTestId('go-runs').compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(item.compareDocumentPosition(screen.getByTestId('go-daemons')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		// The teams attention line is for the teams list only.
		expect(screen.queryByTestId('attention')).toBeNull();
	});

	it('in Settings, its parts are listed under it; the current one is marked', async () => {
		route_fetch(inbox());
		const slug = render_layout('/o/measureone/realms/prod-us/settings?section=a2a');
		await screen.findByRole('heading', { name: 'Prod US' });
		expect(within(nav()).getAllByRole('link').map((l) => l.textContent)).toEqual(['Teams!', 'Runs!', 'Daemons', 'Settings', 'Members', 'Access tokens', 'A2A', 'Agents', 'Notifications', 'General', 'Danger zone']);
		expect(screen.getByTestId('settings-a2a')).toHaveAttribute('aria-current', 'page');
		expect(screen.getByTestId('settings-members')).toHaveAttribute('href', `/o/measureone/realms/${slug}/settings`);
		expect(screen.getByTestId('settings-agents')).toHaveAttribute('href', `/o/measureone/realms/${slug}/agents`);
	});

	it('Edit realm opens the Realm details side panel: name and description saved together in one realms/update', async () => {
		const spy = route_fetch(inbox());
		render_layout();
		fireEvent.click(await screen.findByRole('button', { name: 'Edit realm' }));
		const panel = screen.getByRole('dialog', { name: 'Realm details' });
		fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: 'Production US' } });
		fireEvent.change(within(panel).getByLabelText('Description'), { target: { value: 'US delivery' } });
		fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Realm details' })).toBeNull());
		const writes = spy.mock.calls.filter(([u]) => u === '/v1/realms/update');
		expect(writes).toHaveLength(1);
		expect(JSON.parse(String((writes[0][1] as RequestInit).body))).toEqual({ realm_id: 'r-prod', name: 'Production US', description: 'US delivery' });
	});

	it('with no description, an admin gets "Add a description" (opens Edit realm)', async () => {
		route_fetch(inbox({}, { realm: { ...SUMMARY.realm, description: null } }));
		render_layout();
		fireEvent.click(await screen.findByTestId('add-description'));
		expect(screen.getByRole('dialog', { name: 'Realm details' })).toBeInTheDocument();
	});

	it('not an admin: no Edit realm, no Add a description', async () => {
		route_fetch(inbox({}, { realm: { ...SUMMARY.realm, description: null }, you: { role: 'member', is_admin: false } }));
		render_layout();
		await screen.findByRole('heading', { name: 'Prod US' });
		expect(screen.queryByRole('button', { name: 'Edit realm' })).toBeNull();
		expect(screen.queryByTestId('add-description')).toBeNull();
	});

	it('right after New realm: what was set up and the enrollment token, shown once', async () => {
		route_fetch(inbox());
		render_layout('/o/measureone/realms/prod-us/teams', { state: { created: { name: 'Production US', token: 'cliq_rt_abc', token_name: 'prod-us-enroll', qualified_slug: 'measureone.prod-us', invites: [{ email: 'kim@x.com', email_sent: true, invite_url: null }], members_added: 1 } } });
		const banner = await screen.findByTestId('realm-created');
		expect(banner).toHaveTextContent('Production US is ready.');
		expect(banner).toHaveTextContent('1 added · 1 invite sent · hello-world installed');
		expect(within(banner).getByTestId('secret-value')).toHaveTextContent('cliq_rt_abc');
		fireEvent.click(within(banner).getByLabelText(/saved this token/));
		fireEvent.click(within(banner).getByRole('button', { name: 'Done' }));
		await waitFor(() => expect(screen.queryByTestId('realm-created')).toBeNull());
	});
});
