/**
 * Graphite realm page — one BFF composition call (`summary: true`), no tabs: header with status,
 * the Runs / Teams / Daemons / Members buttons, setup list, cards, Realm details panel, access errors.
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

function Where() {
	const loc = useLocation();
	return <div data-testid="where">{loc.pathname}</div>;
}

type Reply = { status?: number; body: unknown };

const SUMMARY: Realm_summary = {
	realm: { description: 'Production delivery for the US', created_at: Date.now() - 86_400_000, updated_at: Date.now() - 3_600_000, created_by_username: 'sapan' },
	teams: { total: 2, missing_agents: 1, items: [
		{ scope: 'cliq', slug: 'hello-world', label: '@cliq/hello-world', version: '1.0.0', missing_agents: [] },
		{ scope: 'measureone', slug: 'income-verify', label: '@measureone/income-verify', version: '2.1.0', missing_agents: ['codex'] },
	] },
	daemons: { online: 2, total: 3, truncated: false, items: [{ id: 'd1', name: 'mac-1', status: 'online' }, { id: 'd2', name: 'mac-2', status: 'online' }, { id: 'd3', name: 'old', status: 'offline' }] },
	people: { total: 3, by_role: { admin: 1, operator: 2 }, pending_invites: 1, items: [
		{ member_id: 'u1', username: 'sapan', role: 'admin', is_you: true }, { member_id: 'u2', username: 'lena', role: 'operator', is_you: false }, { member_id: 'u3', username: 'bo', role: 'operator', is_you: false },
	] },
	you: { role: 'admin', is_admin: true },
};
const inbox = (over: Partial<Realm_inbox_data> = {}, summary: Partial<Realm_summary> = {}) => base_inbox({ summary: { ...SUMMARY, ...summary }, ...over });

function route_fetch(inbox_reply: Reply | (() => Reply)) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/realms/update') return new Response(JSON.stringify({ ok: true, data: {} }));
		if (u === '/v1/realm_inbox/get') {
			const r = typeof inbox_reply === 'function' ? inbox_reply() : inbox_reply;
			return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
		}
		throw new Error(`unexpected ${u}`);
	});
}

function render_page(path = '/o/measureone/realms/prod-us/inbox', state: unknown = null) {
	return render(
		<MemoryRouter initialEntries={[{ pathname: path, state }]}>
			<Routes>
				<Route path="/o/:org/realms/:slug/inbox" element={<InboxPage />} />
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('Realm inbox page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('right after New realm: what was set up and the enrollment token, shown once', async () => {
		route_fetch({ body: { ok: true, data: inbox() } });
		render_page('/o/measureone/realms/prod-us/inbox', { created: { name: 'Production US', token: 'cliq_rt_abc', token_name: 'prod-us-enroll', qualified_slug: 'measureone.prod-us', invites: [{ email: 'kim@x.com', email_sent: true, invite_url: null }], members_added: 1 } });
		const banner = await screen.findByTestId('realm-created');
		expect(banner).toHaveTextContent('Production US is ready.');
		expect(banner).toHaveTextContent('1 added · 1 invite sent · hello-world installed');
		expect(within(banner).getByTestId('secret-value')).toHaveTextContent('cliq_rt_abc');
		expect(banner).toHaveTextContent('CLIQ_DAEMON_TOKEN');
		fireEvent.click(within(banner).getByLabelText(/saved this token/));
		fireEvent.click(within(banner).getByRole('button', { name: 'Done' }));
		await waitFor(() => expect(screen.queryByTestId('realm-created')).toBeNull());
	});

	it('one call with org + realm slug and summary: true (plus the shared sidebar read); no Core fan-out from the browser', async () => {
		const spy = route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		await screen.findByRole('heading', { name: 'Prod US' });
		const calls = spy.mock.calls.filter(([u]) => u === '/v1/realm_inbox/get');
		expect(calls).toHaveLength(1);
		expect(JSON.parse(String((calls[0][1] as RequestInit).body))).toEqual({ org_slug: 'measureone', slug: 'prod-us', summary: true });
		const others = spy.mock.calls.map(([u]) => String(u)).filter((u) => u !== '/v1/realm_inbox/get' && u !== '/v1/overview/get' && u !== '/v1/getting_started/get');
		expect(others).toEqual([]);
	});

	it('header: name, status, description, slug · creator · updated; no tabs; no Needs attention or Running now', async () => {
		route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		await screen.findByRole('heading', { name: 'Prod US' });
		expect(screen.getByTestId('realm-status')).toHaveTextContent('Missing agents');
		expect(screen.getByText('Production delivery for the US')).toBeInTheDocument();
		expect(screen.getByTestId('realm-meta')).toHaveTextContent('measureone.prod-us');
		expect(screen.getByTestId('realm-meta')).toHaveTextContent('created by sapan');
		expect(screen.queryByRole('navigation', { name: 'Realm sections' })).toBeNull();
		expect(screen.queryByText('Needs attention')).toBeNull();
		expect(screen.queryByText('Running now')).toBeNull();
	});

	it.each([
		[{ daemons: { ...SUMMARY.daemons!, online: 0 } }, 'No daemon available'],
		[{ teams: { ...SUMMARY.teams!, missing_agents: 0 } }, 'Ready'],
	] as const)('status follows daemons online, then missing agents (%#)', async (over, label) => {
		route_fetch({ body: { ok: true, data: inbox({}, over as Partial<Realm_summary>) } });
		render_page();
		expect(await screen.findByTestId('realm-status')).toHaveTextContent(label);
	});

	it('the four buttons: Runs (running · need you), Teams (· missing agent), Daemons (N online, count only), Members', async () => {
		route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		const runs = await screen.findByTestId('go-runs');
		expect(runs).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs');
		expect(runs).toHaveTextContent('1running2 need you');
		expect(screen.getByTestId('go-teams')).toHaveTextContent('21 missing agent');
		expect(screen.getByTestId('go-daemons')).toHaveTextContent('2online');
		expect(screen.getByTestId('go-daemons')).not.toHaveTextContent('/');
		expect(screen.getByTestId('go-members')).toHaveTextContent('31 pending');
	});

	it('cards: team chips with Ready / Missing agent, daemon lights, people by role; setup list only for what’s missing', async () => {
		route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		expect(await screen.findByTestId('team-hello-world')).toHaveTextContent('Ready');
		expect(screen.getByTestId('team-income-verify')).toHaveTextContent('Missing agent');
		expect(within(screen.getByTestId('daemons-card')).getAllByRole('link', { name: /online|offline/ })).toHaveLength(3);
		expect(screen.getByTestId('roles')).toHaveTextContent('1 admin · 2 operators · 1 invite pending');
		const setup = screen.getByTestId('setup');
		expect(setup).toHaveTextContent('1 team uses an agent your org hasn’t registered.');
		expect(setup).not.toHaveTextContent('daemon');
		expect(screen.getByRole('link', { name: /Install a team/ })).toHaveAttribute('href', '/o/measureone/realms/prod-us/teams?install=1');
	});

	it('More ▾ lists the rest of the realm; Run… lists teams, a team missing an agent can’t be picked', async () => {
		route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		await screen.findByRole('heading', { name: 'Prod US' });
		fireEvent.click(screen.getByRole('button', { name: /More/ }));
		expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Agents', 'Notifications', 'A2A & mesh', 'Access tokens', 'Settings']);
		fireEvent.click(screen.getByRole('button', { name: /Run…/ }));
		expect(screen.getByRole('menuitem', { name: '@cliq/hello-world' })).toBeEnabled();
		expect(screen.getByRole('menuitem', { name: /income-verify/ })).toBeDisabled();
	});

	it('Run… is off when no daemon is online', async () => {
		route_fetch({ body: { ok: true, data: inbox({}, { daemons: { ...SUMMARY.daemons!, online: 0 } }) } });
		render_page();
		expect(await screen.findByRole('button', { name: /Run…/ })).toBeDisabled();
		expect(screen.getByTestId('setup')).toHaveTextContent('No daemon is online');
	});

	it('✎ opens the Realm details panel: name and description saved together in one realms/update', async () => {
		const spy = route_fetch({ body: { ok: true, data: inbox() } });
		render_page();
		fireEvent.click(await screen.findByRole('button', { name: 'Edit realm details' }));
		const panel = screen.getByRole('dialog', { name: 'Realm details' });
		fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: 'Production US' } });
		fireEvent.change(within(panel).getByLabelText('Description'), { target: { value: 'US delivery' } });
		fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Realm details' })).toBeNull());
		const writes = spy.mock.calls.filter(([u]) => u === '/v1/realms/update');
		expect(writes).toHaveLength(1);
		expect(JSON.parse(String((writes[0][1] as RequestInit).body))).toEqual({ realm_id: 'r-prod', name: 'Production US', description: 'US delivery' });
	});

	it('not an admin: no ✎, no Invite, no Danger zone', async () => {
		route_fetch({ body: { ok: true, data: inbox({}, { you: { role: 'member', is_admin: false } }) } });
		render_page();
		await screen.findByRole('heading', { name: 'Prod US' });
		expect(screen.queryByRole('button', { name: 'Edit realm details' })).toBeNull();
		expect(screen.queryByTestId('danger-zone')).toBeNull();
		expect(within(screen.getByTestId('members-card')).queryByRole('link', { name: 'Invite' })).toBeNull();
	});

	it('403 → no-access state (no retry loop)', async () => {
		route_fetch({ status: 403, body: { ok: false, error: { code: 'forbidden', message: 'Not a realm member' } } });
		render_page();
		expect(await screen.findByText('You don’t have access to this realm')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
	});

	it('404 → not-found state', async () => {
		route_fetch({ status: 404, body: { ok: false, error: { code: 'not_found', message: "Realm 'nope' not found" } } });
		render_page('/o/measureone/realms/nope/inbox');
		expect(await screen.findByText('This realm doesn’t exist')).toBeInTheDocument();
	});

	it('5xx → retry recovers', async () => {
		let n = 0;
		route_fetch(() => (n++ === 0 ? { status: 502, body: { ok: false, error: { code: 'upstream', message: 'Core unreachable' } } } : { body: { ok: true, data: inbox() } }));
		render_page();
		expect(await screen.findByRole('alert')).toHaveTextContent('Core unreachable');
		fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(await screen.findByRole('heading', { name: 'Prod US' })).toBeInTheDocument();
	});
});
