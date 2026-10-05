/** Admin mode (Graphite): one BFF read per view; writes are the existing single routes. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview } from './fixtures_overview';
import type { Admin_home_data, Admin_list_data, Admin_org_row, Admin_user_detail, Org_detail, Org_new_data, Org_role } from '@/lib/admin';
import { audit_summary, owners_of } from '@/lib/admin';

const act_as = vi.fn(async () => null as string | null);
const auth = { user: { id: 'me', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'admin' as const, preferences: {} }, scopes: [], loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(), act_as };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as HomePage } from '@/pages/admin/graphite/admin_home_page';
import { Component as AccountsPage } from '@/pages/admin/graphite/accounts_page';
import { Component as OrgPage } from '@/pages/admin/graphite/org_page';
import { Component as DaemonsPage } from '@/pages/admin/graphite/daemons_page';
import { Component as TeamsPage } from '@/pages/admin/graphite/catalog_teams_page';
import { Component as AuditPage } from '@/pages/admin/graphite/audit_page';
import { Component as RealmsPage } from '@/pages/admin/graphite/realms_page';
import { Component as WorkspacesPage } from '@/pages/admin/graphite/workspaces_page';
import { Component as RunsPage } from '@/pages/admin/graphite/runs_page';
import { Component as LogsPage } from '@/pages/admin/graphite/logs_page';
import { Component as ScopesPage } from '@/pages/admin/graphite/scopes_page';
import { Component as OrgsPage } from '@/pages/admin/graphite/orgs_page';

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(handlers: Record<string, (b: Record<string, unknown>) => unknown>) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		const h = handlers[u];
		const data = h ? h(body) : {};
		return new Response(JSON.stringify({ ok: true, data }));
	});
	return calls;
}

/** Open a type-ahead filter (button `label`), optionally type, and pick the option named `option`. */
async function pick(label: string, option: RegExp | string, type?: string, scope: HTMLElement = document.body) {
	fireEvent.click(within(scope).getByRole('button', { name: label }));
	if (type) fireEvent.change(screen.getByLabelText(`Search ${label.toLowerCase()}`), { target: { value: type } });
	fireEvent.click(await screen.findByRole('option', { name: option }));
}
const list_calls = (calls: Call[]) => calls.filter((c) => c.url === '/v1/admin_list/get');

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; }
function at(path: string, pattern: string, el: React.ReactNode) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path={pattern} element={<>{el}<Where /></>} />
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}

const home = (over: Partial<Admin_home_data> = {}): Admin_home_data => ({
	core: { reachable: true, version: '1.0.0', api_version: 3, started_at: Date.now() - 3 * 3600_000, required_api_version: 2, compatible: true, message: null },
	hub_wide: true,
	counts: { accounts: 184, suspended: 2, admins: 3, orgs: 23, realms: 41, daemons: { online: 57, total: 64, offline: 4 }, runs_24h: { total: 1208, failed: 38 } },
	attention: [{ id: 'daemons_offline', severity: 'error', title: '4 daemons are offline', detail: 'Runs queue.', href: '/admin/daemons?filter=offline', action: 'See daemons' }],
	recent_audit: [{ id: 'a1', admin_id: 'me', admin_username: 'sapan', action: 'user.suspend', target_type: 'user', target_id: 'u-ana', details: { username: 'ana', reason: '8 failed sign-ins' }, created_at: new Date().toISOString() }],
	partial: false,
	...over,
});
function list<T>(kind: Admin_list_data<T>['kind'], items: T[], over: Partial<Admin_list_data<T>> = {}): Admin_list_data<T> {
	return { kind, filter: 'all', items, total: items.length, limit: 25, offset: 0, counts: {}, hub_wide: true, needs_org: false, unsupported: [], ...over };
}

afterEach(() => { vi.restoreAllMocks(); act_as.mockClear(); });

describe('Admin › Home', () => {
	it('shows hub tiles, Core compatibility, attention and recent audit from one read', async () => {
		const calls = route_fetch({ '/v1/admin_home/get': () => home() });
		at('/admin', '/admin', <HomePage />);
		expect(await screen.findByTestId('stat-Accounts')).toHaveTextContent('184');
		expect(screen.getByTestId('stat-Daemons online')).toHaveTextContent('57 / 64');
		expect(screen.getByTestId('core-badge')).toHaveTextContent('BFF ↔ Core compatible');
		expect(within(screen.getByTestId('attn-daemons_offline')).getByRole('link', { name: 'See daemons' })).toHaveAttribute('href', '/admin/daemons?filter=offline');
		expect(screen.getByText('user.suspend')).toBeInTheDocument();
		expect(screen.queryByTestId('hub-scope-note')).toBeNull();
		expect(calls.filter((c) => c.url.startsWith('/v1/')).map((c) => c.url)).toEqual(['/v1/admin_home/get']);
	});

	it('says what it can’t see on an older Core, and flags an out-of-sync Core', async () => {
		route_fetch({ '/v1/admin_home/get': () => home({ hub_wide: false, core: { reachable: true, version: '1.0.0', api_version: 1, started_at: 1, required_api_version: 2, compatible: false, message: 'Core API 1 is older than this BFF needs (2+).' }, counts: { accounts: 9, suspended: null, admins: null, orgs: 2, realms: null, daemons: null, runs_24h: null }, attention: [] }) });
		at('/admin', '/admin', <HomePage />);
		expect(await screen.findByTestId('hub-scope-note')).toBeInTheDocument();
		expect(screen.getByTestId('core-badge')).toHaveTextContent('Out of sync');
		expect(screen.getByRole('alert')).toHaveTextContent('older than this BFF needs');
		expect(screen.getByTestId('stat-Realms')).toHaveTextContent('—');
		expect(screen.getByText('Nothing needs an admin right now.')).toBeInTheDocument();
	});
});

describe('Admin › Accounts', () => {
	const ana = { id: 'u-ana', username: 'ana', display_name: 'Ana Ruiz', email: 'ana@acme.com', role: 'user' as const, status: 'active' as const, suspended_at: null, deleted_at: null, created_at: '2026-03-01T00:00:00Z' };
	const detail = (over: Partial<Admin_user_detail> = {}): Admin_user_detail => ({ ...ana, suspended_reason: '', orgs: [{ id: 'o1', slug: 'acme', display_name: 'Acme Labs', role: 'admin' }], team_count: 1, scope_count: 0, token_count: 3, draft_count: 0, ...over });

	it('hides filters Core can’t apply; a row opens the side panel', async () => {
		const calls = route_fetch({ '/v1/admin_list/get': () => list('accounts', [ana], { counts: { all: 1, admins: null, suspended: null }, unsupported: ['admins', 'suspended'] }), '/v1/users/get_by_id': () => detail() });
		at('/admin/accounts', '/admin/accounts', <AccountsPage />);
		fireEvent.click(await screen.findByTestId('acct-ana'));
		const panel = await screen.findByTestId('account-panel');
		expect(await within(panel).findByText('Acme Labs')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Suspended/ })).toBeNull();
		expect(screen.getByTestId('where')).toHaveTextContent('u=u-ana');
		expect(calls.find((c) => c.url === '/v1/users/get_by_id')?.body).toEqual({ user_id: 'u-ana' });
	});

	it('suspend sends the reason; delete needs the email typed', async () => {
		const calls = route_fetch({ '/v1/admin_list/get': () => list('accounts', [ana], { counts: { all: 1, admins: 0, suspended: 0 } }), '/v1/users/get_by_id': () => detail(), '/v1/users/suspend': () => ({ suspended: true }) });
		at('/admin/accounts?u=u-ana', '/admin/accounts', <AccountsPage />);
		const panel = await screen.findByTestId('account-panel');
		fireEvent.click(await within(panel).findByRole('button', { name: 'Suspend…' }));
		fireEvent.change(within(panel).getByLabelText('Reason'), { target: { value: 'phishing' } });
		fireEvent.click(within(panel).getByRole('button', { name: 'Suspend' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/users/suspend')?.body).toEqual({ user_id: 'u-ana', reason: 'phishing' }));

		fireEvent.click(within(panel).getByRole('button', { name: 'Delete account…' }));
		const del = within(panel).getByRole('button', { name: 'Delete account' });
		expect(del).toBeDisabled();
		fireEvent.change(within(panel).getByLabelText('Confirm email'), { target: { value: 'ana@acme.com' } });
		expect(del).toBeEnabled();
	});

	it('act as switches the session and goes home', async () => {
		route_fetch({ '/v1/admin_list/get': () => list('accounts', [ana]), '/v1/users/get_by_id': () => detail() });
		at('/admin/accounts?u=u-ana', '/admin/accounts', <AccountsPage />);
		fireEvent.click(await screen.findByRole('button', { name: 'Act as ana' }));
		await waitFor(() => expect(act_as).toHaveBeenCalledWith('u-ana'));
		await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/home'));
	});
});

/** A built-in org role as `orgs/get_by_id` sends it. */
const role = (id: string, slug: string, name: string): Org_role => ({ id, org_id: 'o1', slug, name, permissions: [], is_system: true, is_default: slug === 'member', member_count: 0 });
/** The always-present `orgs/get_by_id` fields a fixture doesn't care about. */
const org_extras = { pending_owner_invite: null, my_role: 'site_admin', available_permissions: [], owner_only_permissions: [] };

describe('Admin › Organization', () => {
	const org = (over: Partial<Org_detail> = {}): Org_detail => ({
		id: 'o1', slug: 'acme-labs', display_name: 'Acme Labs', created_at: '2026-01-01T00:00:00Z', status: 'active', owner: null, deleted_at: null, ...org_extras,
		members: [
			{ user_id: 'u-ana', username: 'ana', display_name: 'Ana Ruiz', email: 'ana@acme.com', role: 'admin', role_id: 'r-admin', status: 'active' as const, invited_at: null, joined_at: null, deleted_at: null },
			{ user_id: 'u-tom', username: 'tom', display_name: 'Tom Lee', email: 'tom@acme.com', role: 'member', role_id: 'r-member', status: 'active' as const, invited_at: null, joined_at: null, deleted_at: null },
		],
		scopes: [{ id: 's1', slug: 'acme', display_name: 'Acme', visibility: 'private', member_count: 2, team_count: 4 }],
		roles: [role('r-owner', 'owner', 'Owner'), role('r-admin', 'admin', 'Admin'), role('r-member', 'member', 'Member')],
		...over,
	});

	it('flags an ownerless org and fixes it by making a member an owner', async () => {
		const calls = route_fetch({ '/v1/orgs/get_by_id': () => org(), '/v1/orgs/update': () => ({ updated: true }) });
		at('/admin/orgs/o1', '/admin/orgs/:id', <OrgPage />);
		const banner = await screen.findByTestId('ownerless');
		fireEvent.click(within(banner).getByRole('button', { name: 'Make Ana Ruiz owner' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/update')?.body).toEqual({ org_id: 'o1', owner_id: 'u-ana' }));
		expect(calls.find((c) => c.url === '/v1/users/update_role')).toBeUndefined();
	});

	it('changes a member’s role inline; Realms tab asks Core for all realms', async () => {
		const calls = route_fetch({ '/v1/orgs/get_by_id': () => org({ members: [{ user_id: 'u-kim', username: 'kim', display_name: 'Kim', email: null, role: 'admin', role_id: 'r-owner', status: 'active' as const, invited_at: null, joined_at: null, deleted_at: null }, ...org().members] }), '/v1/users/update_role': () => ({}), '/v1/realms/get': () => ({ items: [{ id: 'r1', slug: 'prod', name: 'Prod', org_slug: 'acme-labs', created_at: 1 }], total: 1 }) });
		at('/admin/orgs/o1', '/admin/orgs/:id', <OrgPage />);
		fireEvent.change(await screen.findByLabelText('Role for tom'), { target: { value: 'r-admin' } });
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/users/update_role')?.body).toEqual({ org_id: 'o1', user_id: 'u-tom', role_id: 'r-admin' }));
		expect(screen.queryByTestId('ownerless')).toBeNull();
		fireEvent.click(screen.getByRole('tab', { name: 'Realms' }));
		expect(await screen.findByRole('link', { name: 'Open realm →' })).toHaveAttribute('href', '/o/acme-labs/realms/prod');
		expect(calls.find((c) => c.url === '/v1/realms/get')?.body).toMatchObject({ org_id: 'o1', all: true });
	});
});

describe('Admin › Daemons / Teams / Audit', () => {
	it('daemons: asks for an org on an older Core', async () => {
		route_fetch({ '/v1/admin_list/get': () => list('daemons', [], { hub_wide: false, needs_org: true, counts: { all: null, online: null, stale: null, offline: null } }) });
		at('/admin/daemons', '/admin/daemons', <DaemonsPage />);
		expect(await screen.findByText('Pick one of your orgs to see its daemons.')).toBeInTheDocument();
		expect(screen.getByTestId('hub-scope-note')).toBeInTheDocument();
	});

	it('daemons: status chip filters through the URL', async () => {
		const calls = route_fetch({ '/v1/admin_list/get': (b) => list('daemons', [{ id: 'd1', name: 'eu-box-1', hostname: null, status: 'offline', last_heartbeat: Date.now() - 7200_000, capacity: 2, realms: [{ id: 'r', slug: 'eu', org_slug: 'm1', name: 'EU' }] }], { filter: String(b.filter), counts: { all: 64, online: 57, stale: 3, offline: 4 } }) });
		at('/admin/daemons', '/admin/daemons', <DaemonsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /Offline/ }));
		await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ kind: 'daemons', filter: 'offline' }));
		fireEvent.click(screen.getByTestId('daemon-d1'));
		expect(screen.getByTestId('where')).toHaveTextContent('/o/m1/realms/eu/daemons/d1');
	});

	it('teams: flags listed-without-version and unlists with one call', async () => {
		const t = { id: 't1', name: 'old-recon', scope: 'acme', description: null, visibility: 'public', listed: true, install_count: 0, version_count: 0, author_username: 'ana', updated_at: null, listed_without_version: true };
		const calls = route_fetch({ '/v1/admin_list/get': () => list('teams', [t], { counts: { listed: 1, unlisted: 0 } }), '/v1/teams/unpublish': () => ({}) });
		at('/admin/teams', '/admin/teams', <TeamsPage />);
		const row = await screen.findByTestId('team-old-recon');
		expect(row).toHaveTextContent('Listed · no version');
		fireEvent.click(within(row).getByRole('button', { name: 'Unlist' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/teams/unpublish')?.body).toEqual({ team_id: 't1' }));
	});

	it('audit: notes unsupported filters; expanded details never show secret values', async () => {
		const e = { id: 'a1', admin_id: 'me', admin_username: 'priya', action: 'agents.update_settings', target_type: 'agent', target_id: 'jira', details: { keys: ['email', 'api_token'], api_token: 'ATATT-real-value' }, created_at: new Date().toISOString() };
		const calls = route_fetch({ '/v1/admin_list/get': (b) => list('audit', [e], { unsupported: b.since_ms != null ? ['since'] : [] }) });
		at('/admin/audit?range=7d', '/admin/audit', <AuditPage />);
		expect(await screen.findByRole('note')).toHaveTextContent('Time range filter needs Core API 3');
		expect(calls[0].body).toMatchObject({ kind: 'audit' });
		fireEvent.click(screen.getByTestId('audit-a1'));
		expect(document.body.textContent).not.toContain('ATATT-real-value');
		expect(document.body.textContent).toContain('"api_token": "set"');
	});
});

describe('Admin › Realms / Workspaces / Runs / Logs / Scopes', () => {
	it('realms: rows open the realm; org type-ahead searches orgs/get and narrows', async () => {
		const calls = route_fetch({
			'/v1/admin_list/get': () => list('realms', [{ id: 'r1', slug: 'prod-us', name: 'Prod US', org_slug: 'm1', created_by_username: 'sapan', created_at: Date.now() - 864e5 }]),
			'/v1/orgs/get': (b) => ({ orgs: String(b.query ?? '').startsWith('mea') || !b.query ? [{ id: 'o1', slug: 'm1', display_name: 'MeasureOne' }] : [], total: 1 }),
			'/v1/orgs/get_by_id': () => ({ id: 'o1', slug: 'm1', display_name: 'MeasureOne' }),
		});
		at('/admin/realms', '/admin/realms', <RealmsPage />);
		await screen.findByTestId('realm-prod-us');
		// Nothing is loaded for the picker until it is opened.
		expect(calls.some((c) => c.url === '/v1/orgs/get')).toBe(false);
		await pick('Organization', /MeasureOne/, 'mea');
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/get' && c.body.query === 'mea')?.body).toMatchObject({ limit: 10 }));
		await waitFor(() => expect(list_calls(calls).at(-1)?.body).toMatchObject({ kind: 'realms', org_id: 'o1' }));
		expect(screen.getByRole('button', { name: 'Organization' })).toHaveTextContent('MeasureOne');
		fireEvent.click(screen.getByTestId('realm-prod-us'));
		expect(screen.getByTestId('where')).toHaveTextContent('/o/m1/realms/prod-us');
	});

	it('workspaces: shows daemon, teams and what is running', async () => {
		route_fetch({ '/v1/admin_list/get': () => list('workspaces', [{ id: 'w1', name: null, path: '/src/ledger', daemon_id: 'd1', daemon_name: 'mac-studio', teams: ['@acme/recon'], active_runs: 2, latest_run: { run_id: 'x', state: 'running', started_at: Date.now() }, updated_at: 1 }]) });
		at('/admin/workspaces', '/admin/workspaces', <WorkspacesPage />);
		const row = await screen.findByTestId('ws-w1');
		expect(row).toHaveTextContent('ledger');
		expect(row).toHaveTextContent('mac-studio');
		expect(row).toHaveTextContent('2 running');
	});

	it('workspaces: org and realm pickers narrow the list; rows show org, realm and every daemon', async () => {
		const calls = route_fetch({
			'/v1/admin_list/get': () => list('workspaces', [{ id: 'w1', name: 'ledger', path: '/src/ledger', daemon_id: null, daemon_name: 'mac', daemons: [{ id: 'd1', name: 'mac' }, { id: 'd2', name: 'linux-box' }], realms: [{ id: 'r1', slug: 'prod', org_slug: 'm1' }], orgs: [{ id: 'o1', slug: 'm1', display_name: 'M1' }], teams: [], active_runs: 0, latest_run: null, updated_at: 1 }]),
			'/v1/orgs/get': () => ({ orgs: [{ id: 'o1', slug: 'm1', display_name: 'M1' }], total: 1 }),
			'/v1/orgs/get_by_id': () => ({ id: 'o1', slug: 'm1', display_name: 'M1' }),
			'/v1/realms/get': () => ({ items: [{ id: 'r1', slug: 'prod', name: 'Prod', org_slug: 'm1' }], total: 1 }),
			'/v1/realms/get_by_id': () => ({ id: 'r1', slug: 'prod', org_slug: 'm1' }),
		});
		at('/admin/workspaces', '/admin/workspaces', <WorkspacesPage />);
		const row = await screen.findByTestId('ws-w1');
		expect(row).toHaveTextContent('m1');
		expect(row).toHaveTextContent('m1.prod');
		expect(row).toHaveTextContent('mac, linux-box');
		await pick('Organization', /M1/);
		await waitFor(() => expect(list_calls(calls).at(-1)?.body).toMatchObject({ kind: 'workspaces', org_id: 'o1' }));
		await pick('Realm', /prod/);
		// Realm search stays inside the picked org.
		expect(calls.find((c) => c.url === '/v1/realms/get')?.body).toMatchObject({ all: true, org_id: 'o1', limit: 10 });
		await waitFor(() => expect(list_calls(calls).at(-1)?.body).toMatchObject({ kind: 'workspaces', org_id: 'o1', realm_id: 'r1' }));
	});

	it('runs: state chips + range go to the BFF; a row opens the run in its realm', async () => {
		const calls = route_fetch({ '/v1/admin_list/get': (b) => list('runs', [{ run_id: 'run-1', run_name: 'PROJ-9', state: 'failed', team_label: '@m1/dev', daemon_id: null, workspace_name: null, started_at: Date.now() - 6e4, last_updated_at: Date.now(), realm: { id: 'r1', slug: 'prod', org_slug: 'm1' } }], { filter: String(b.filter), counts: { all: 10, running: 1, awaiting_input: 0, failed: 2, completed: 7 } }) });
		at('/admin/runs', '/admin/runs', <RunsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /Failed/ }));
		await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ kind: 'runs', filter: 'failed', range: '24h' }));
		fireEvent.change(screen.getByLabelText('Time range'), { target: { value: '7d' } });
		await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ range: '7d' }));
		fireEvent.click(screen.getByTestId('run-run-1'));
		expect(screen.getByTestId('where')).toHaveTextContent('/o/m1/realms/prod/runs/run-1');
	});

	it('logs: level chips and narrowing to one run', async () => {
		const calls = route_fetch({ '/v1/admin_list/get': () => list('logs', [{ id: 'l1', run_id: 'run-7', run_name: 'nightly', created_at: Date.now(), level: 'error', message: 'Timeout talking to ledger', daemon_name: null, team: null, realm: null }], { counts: { all: 40, error: 4, warn: 1, info: 35, debug: 0 } }) });
		at('/admin/logs', '/admin/logs', <LogsPage />);
		expect(await screen.findByTestId('log-l1')).toHaveTextContent('Timeout talking to ledger');
		fireEvent.click(screen.getByRole('button', { name: /Errors/ }));
		await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ kind: 'logs', filter: 'error' }));
		fireEvent.click(screen.getByTitle('Only this run'));
		await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ run_id: 'run-7' }));
	});

	it('scopes: create and edit org scopes; personal scopes are read-only', async () => {
		const orgs = [{ id: '11111111-1111-4111-8111-111111111111', slug: 'acme', display_name: 'Acme' }];
		const rows = [
			{ id: 's1', slug: 'acme', display_name: 'Acme', org_id: orgs[0].id, org_slug: 'acme', owner_username: 'ana', visibility: 'private', scope_type: 'org', team_count: 0, created_at: '2026-01-01T00:00:00Z' },
			{ id: 's2', slug: 'sapan', display_name: 'sapan', org_id: null, org_slug: null, owner_username: 'sapan', visibility: 'public', scope_type: 'user', team_count: 3, created_at: '2026-01-01T00:00:00Z' },
		];
		const calls = route_fetch({ '/v1/admin_list/get': () => list('scopes', rows), '/v1/orgs/get': () => ({ orgs, total: 1 }), '/v1/orgs/get_by_id': () => orgs[0], '/v1/orgs/new_scope': () => ({}), '/v1/orgs/update_scope': () => ({}) });
		at('/admin/scopes', '/admin/scopes', <ScopesPage />);
		fireEvent.click(await screen.findByRole('button', { name: /New scope/ }));
		const form = screen.getByRole('form', { name: 'New scope' });
		await pick('Organization', /Acme/, undefined, form);
		fireEvent.change(within(form).getByLabelText('Slug'), { target: { value: 'acme-data' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Create scope' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/new_scope')?.body).toEqual({ org_id: orgs[0].id, slug: 'acme-data', visibility: 'private' }));
		fireEvent.click(await screen.findByTestId('scope-acme'));
		const panel = await screen.findByTestId('scope-panel');
		fireEvent.change(within(panel).getByLabelText('Visibility'), { target: { value: 'public' } });
		fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/update_scope')?.body).toEqual({ org_id: orgs[0].id, scope_id: 's1', display_name: 'Acme', visibility: 'public' }));
		fireEvent.click(await screen.findByTestId('scope-sapan'));
		expect(await screen.findByText(/Personal scopes belong to one account/)).toBeInTheDocument();
	});
});

describe('admin helpers', () => {
	it('owners_of reads the owner role by id and skips former members', () => {
		expect(owners_of({ id: 'o', slug: 's', display_name: '', created_at: '', status: 'active', owner: null, deleted_at: null, ...org_extras, scopes: [], roles: [role('r1', 'owner', 'Owner')], members: [{ user_id: 'a', username: 'a', display_name: '', email: null, role: 'admin', role_id: 'r1', status: 'active', invited_at: null, joined_at: null, deleted_at: null }, { user_id: 'b', username: 'b', display_name: '', email: null, role: 'member', role_id: null, status: 'active', invited_at: null, joined_at: null, deleted_at: null }, { user_id: 'c', username: 'c', display_name: '', email: null, role: 'admin', role_id: null, status: 'active', invited_at: null, joined_at: null, deleted_at: null }, { user_id: 'd', username: 'd', display_name: '', email: null, role: 'admin', role_id: 'r2', status: 'active', invited_at: null, joined_at: null, deleted_at: null }, { user_id: 'e', username: 'e', display_name: '', email: null, role: 'owner', role_id: 'r1', status: 'deleted', invited_at: null, joined_at: null, deleted_at: '2026-09-01T00:00:00Z' }] }).map((m) => m.user_id)).toEqual(['a', 'c']);
	});
	it('audit_summary masks secret-looking keys', () => {
		expect(audit_summary({ username: 'ana', api_token: 'xyz', reason: '' })).toBe('username: ana · api_token: set');
	});
});

describe('Admin › sortable tables', () => {
	const org = (slug: string) => ({ id: `o-${slug}`, slug, display_name: slug.toUpperCase(), member_count: 1, scope_count: 0, created_at: '2026-01-01T00:00:00Z' });

	it('orgs: a search sends `query`; no sort headers while Core can\'t sort orgs', async () => {
		const calls = route_fetch({ '/v1/orgs/get': () => ({ orgs: [org('acme')], total: 1, limit: 25, offset: 0, sortable: [] }) });
		at('/admin/orgs?q=acme', '/admin/orgs', <OrgsPage />);
		await screen.findByTestId('org-acme');
		expect(calls.find((c) => c.url === '/v1/orgs/get')!.body).toEqual({ limit: 25, offset: 0, query: 'acme' });
		expect(within(screen.getByRole('table')).queryAllByRole('button')).toHaveLength(0);
		expect(screen.getByRole('columnheader', { name: 'Organization' })).not.toHaveAttribute('aria-sort');
	});

	it('orgs: once the BFF says a column is sortable, its header sorts server-side and resets the page', async () => {
		const calls = route_fetch({ '/v1/orgs/get': () => ({ orgs: [org('acme')], total: 60, limit: 25, offset: 25, sortable: ['slug', 'created_at'] }) });
		at('/admin/orgs?offset=25', '/admin/orgs', <OrgsPage />);
		await screen.findByTestId('org-acme');
		expect(screen.getByRole('columnheader', { name: /Created/ })).toHaveAttribute('aria-sort', 'descending');
		expect(screen.queryByRole('button', { name: 'Members' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Organization' }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/orgs/get').at(-1)!.body).toEqual({ limit: 25, offset: 0, sort_by: 'slug', sort_dir: 'asc' }));
		expect(screen.getByTestId('where')).toHaveTextContent('/admin/orgs?sort=slug&dir=asc');
	});

	it('realms: Core-sortable columns toggle through the URL and go to the BFF as sort_by / sort_dir', async () => {
		const row = { id: 'r1', slug: 'prod', name: 'Prod', org_slug: 'acme', created_by_username: 'ana', created_at: Date.now() - 3600_000 };
		const calls = route_fetch({ '/v1/admin_list/get': () => list('realms', [row], { sortable: ['slug', 'name', 'created_at', 'updated_at', 'created_by'] }) });
		at('/admin/realms?q=pro', '/admin/realms', <RealmsPage />);
		await screen.findByTestId('realm-prod');
		expect(screen.queryByRole('button', { name: 'Org' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Created by' }));
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ kind: 'realms', query: 'pro', sort_by: 'created_by', sort_dir: 'asc', offset: 0 }));
		fireEvent.click(await screen.findByRole('button', { name: 'Created by' }));
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ sort_by: 'created_by', sort_dir: 'desc' }));
		expect(screen.getByRole('columnheader', { name: /Created by/ })).toHaveAttribute('aria-sort', 'descending');
	});

	it.each([
		['accounts', '/admin/accounts', AccountsPage, 'Account', 'username', 'asc', ['username', 'role', 'created_at', 'suspended_at']],
		['daemons', '/admin/daemons', DaemonsPage, 'Heartbeat', 'last_heartbeat', 'desc', ['name', 'status', 'last_heartbeat']],
		['teams', '/admin/teams', TeamsPage, 'Installs', 'install_count', 'desc', ['name', 'install_count', 'created_at', 'updated_at']],
		['scopes', '/admin/scopes', ScopesPage, 'Teams', 'team_count', 'desc', ['slug', 'visibility', 'team_count', 'created_at']],
		['workspaces', '/admin/workspaces', WorkspacesPage, 'Workspace', 'name', 'asc', ['name', 'created_at']],
		['audit', '/admin/audit', AuditPage, 'Action', 'action', 'asc', ['created_at', 'action']],
	] as const)('%s: with Core API 6 the headers light up and the click sends sort_by / sort_dir', async (kind, path, Page, label, key, dir, sortable) => {
		const calls = route_fetch({ '/v1/admin_list/get': (b) => list(kind as Admin_list_data<unknown>['kind'], [], { offset: Number(b.offset) || 0, sortable: [...sortable] }) });
		at(`${path}?offset=25`, path, <Page />);
		const button = await screen.findByRole('button', { name: label });
		expect(screen.getByRole('columnheader', { name: new RegExp(label) })).toHaveAttribute('aria-sort');
		fireEvent.click(button);
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/admin_list/get').at(-1)!.body).toMatchObject({ kind, sort_by: key, sort_dir: dir, offset: 0 }));
		expect(screen.getByTestId('where')).toHaveTextContent(`sort=${key}&dir=${dir}`);
		expect(await screen.findByRole('columnheader', { name: new RegExp(label) })).toHaveAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
	});

	it('orgs: with Core API 6 every column sorts (members → member_count desc)', async () => {
		const calls = route_fetch({ '/v1/orgs/get': () => ({ orgs: [org('acme')], total: 1, limit: 25, offset: 0, sortable: ['slug', 'display_name', 'member_count', 'scope_count', 'created_at'] }) });
		at('/admin/orgs', '/admin/orgs', <OrgsPage />);
		await screen.findByTestId('org-acme');
		fireEvent.click(screen.getByRole('button', { name: 'Members' }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/orgs/get').at(-1)!.body).toMatchObject({ sort_by: 'member_count', sort_dir: 'desc', offset: 0 }));
		for (const h of ['Organization', 'Scopes', 'Created']) expect(screen.getByRole('button', { name: h })).toBeInTheDocument();
	});
});


describe('Admin › New org — name conflicts say who holds the name', () => {
	function reply_conflict(error: string, details: Record<string, unknown> | null) {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			const u = String(url);
			if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
			if (u === '/v1/getting_started/get') return gs_response(u)!;
			if (u === '/v1/orgs/new') return new Response(JSON.stringify({ ok: false, error: { code: 'conflict', message: error, ...(details ? { details } : {}) } }), { status: 409 });
			return new Response(JSON.stringify({ ok: true, data: { orgs: [], total: 0, sortable: [] } }));
		});
	}
	async function create(slug: string) {
		at('/admin/orgs', '/admin/orgs', <OrgsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /New org/ }));
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: slug } });
		fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'sapan@measureone.com' } });
		fireEvent.click(await screen.findByRole('button', { name: '+ Invite sapan@measureone.com by email' }));
		fireEvent.click(screen.getByRole('button', { name: 'Create org and invite owner' }));
		return screen.findByRole('alert');
	}

	it('shows the message and a "View scope" link to the scope holding the name', async () => {
		reply_conflict('The name measureone is already taken.', { kind: 'scope', slug: 'measureone', scope_type: 'user', owner_username: 'measureone' });
		const alert = await create('measureone');
		expect(alert).toHaveTextContent('The name measureone is already taken.');
		expect(within(alert).getByRole('link', { name: /View scope/ })).toHaveAttribute('href', '/admin/scopes?q=measureone');
	});

	it('links an org named after a user to the orgs list', async () => {
		reply_conflict('The name measureone is already taken.', { kind: 'org', slug: 'measureone', personal: true, owner_username: 'measureone' });
		const alert = await create('measureone');
		expect(within(alert).getByRole('link', { name: /View org/ })).toHaveAttribute('href', '/admin/orgs?q=measureone');
	});

	it('plain errors show just the message', async () => {
		reply_conflict('Slug must start with a letter.', null);
		const alert = await create('9m');
		expect(alert).toHaveTextContent('Slug must start with a letter.');
		expect(within(alert).queryByRole('link')).toBeNull();
	});
});

const org_created = (over: { email_sent?: boolean; invite_url?: string | null } = {}): Org_new_data => ({
	org: { id: 'o-m1', slug: 'measureone', display_name: 'MeasureOne', status: 'waiting_for_owner', owner: { user_id: 'u-sapan', email: 'sapan@measureone.com', status: 'invited' }, created_at: '2026-10-02T10:12:00Z', reactivated: false },
	owner_invite: { invite_id: 'inv-1', role: 'owner', status: 'pending', expires_at: '2026-10-16T10:12:00Z', email_sent: over.email_sent ?? true, invite_url: over.invite_url ?? null },
});

describe('Admin › New org — owner picker', () => {
	it('searches existing accounts with users/get and creates the org with that owner', async () => {
		const calls = route_fetch({
			'/v1/orgs/get': () => ({ orgs: [], total: 0, sortable: [] }),
			'/v1/users/get': () => ({ users: [{ id: 'u-kru', username: 'krupali', display_name: 'Krupali Patel', email: 'krupali@measureone.com' }], total: 1 }),
			'/v1/orgs/new': () => org_created(),
		});
		at('/admin/orgs', '/admin/orgs', <OrgsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /New org/ }));
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'measureone' } });
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'MeasureOne' } });
		expect(screen.getByRole('button', { name: 'Create org and invite owner' })).toBeDisabled();
		fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'kru' } });
		fireEvent.click(await screen.findByRole('button', { name: /krupali/ }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/users/get')?.body).toEqual({ query: 'kru', limit: 8 }));
		expect(screen.getByRole('textbox', { name: 'Owner' })).toHaveValue('Krupali Patel (@krupali)');
		fireEvent.click(screen.getByRole('button', { name: 'Create org and invite owner' }));
		const done = await screen.findByTestId('org-created');
		expect(calls.find((c) => c.url === '/v1/orgs/new')?.body).toEqual({ slug: 'measureone', display_name: 'MeasureOne', owner: { user_id: 'u-kru' } });
		expect(within(done).getByText('Waiting for owner')).toBeInTheDocument();
		expect(within(done).getByTestId('sent-result')).toHaveTextContent('Owner invite sent to sapan@measureone.com (no account yet).');
		expect(within(done).getByRole('link', { name: 'Open org' })).toHaveAttribute('href', '/admin/orgs/o-m1');
	});

	it('an email that already has an account offers only that account, and the owner gets the invite as an existing account', async () => {
		const calls = route_fetch({
			'/v1/orgs/get': () => ({ orgs: [], total: 0, sortable: [] }),
			'/v1/users/get': () => ({ users: [{ id: 'u-sapan', username: 'sapan', display_name: 'Sapan Shah', email: 'Sapan@measureone.com' }], total: 1 }),
			'/v1/orgs/new': () => ({ ...org_created(), org: { ...org_created().org, owner: { user_id: 'u-sapan', email: 'sapan@measureone.com', status: 'active' } } }),
		});
		at('/admin/orgs', '/admin/orgs', <OrgsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /New org/ }));
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'measureone' } });
		fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'sapan@measureone.com' } });
		const account = await screen.findByRole('button', { name: /has an account with this email/ });
		expect(screen.queryByRole('button', { name: /Invite sapan@measureone.com by email/ })).toBeNull();
		fireEvent.click(account);
		expect(screen.getByText(/They get an email to accept ownership/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Create org and invite owner' }));
		const done = await screen.findByTestId('org-created');
		expect(calls.find((c) => c.url === '/v1/orgs/new')?.body).toEqual({ slug: 'measureone', owner: { user_id: 'u-sapan' } });
		expect(within(done).getByTestId('sent-result')).toHaveTextContent('Owner invite sent to sapan@measureone.com (existing account).');
	});

	it('invites someone new by email with an optional name; without email set up it shows the link to copy', async () => {
		const calls = route_fetch({
			'/v1/orgs/get': () => ({ orgs: [], total: 0, sortable: [] }),
			'/v1/users/get': () => ({ users: [], total: 0 }),
			'/v1/orgs/new': () => org_created({ email_sent: false, invite_url: 'https://app.example.test/invite/7f3c' }),
		});
		at('/admin/orgs', '/admin/orgs', <OrgsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /New org/ }));
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'measureone' } });
		fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'sapan@measureone.com' } });
		fireEvent.click(await screen.findByRole('button', { name: '+ Invite sapan@measureone.com by email' }));
		expect(screen.getByLabelText('Owner email')).toHaveValue('sapan@measureone.com');
		expect(screen.getByTestId('same-user-note')).toHaveTextContent('If this email already has an account, that same user gets the invite — no new account is created.');
		fireEvent.change(screen.getByLabelText('Owner name'), { target: { value: 'Sapan Shah' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create org and invite owner' }));
		const done = await screen.findByTestId('org-created');
		expect(calls.find((c) => c.url === '/v1/orgs/new')?.body).toEqual({ slug: 'measureone', owner: { email: 'sapan@measureone.com', display_name: 'Sapan Shah' } });
		expect(within(done).getByTestId('link-fallback')).toHaveTextContent('Email isn’t set up, so nothing was sent.');
		expect(within(done).getByTestId('fallback-url')).toHaveTextContent('https://app.example.test/invite/7f3c');
		expect(within(done).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
	});
});

describe('Admin › Reactivate a deleted name', () => {
	const deleted_org = { kind: 'org', id: 'o-old', deleted_at: '2026-06-01T00:00:00Z', was_active: true };

	it('a site admin confirms and the same request is sent again with reactivate:true', async () => {
		const bodies: Array<Record<string, unknown>> = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			const u = String(url);
			const body = init?.body ? JSON.parse(String(init.body)) : {};
			if (u === '/v1/orgs/new') {
				bodies.push(body);
				return body.reactivate
					? new Response(JSON.stringify({ ok: true, data: { ...org_created(), org: { ...org_created().org, reactivated: true } } }))
					: new Response(JSON.stringify({ ok: false, error: { code: 'deleted', message: 'deleted', details: deleted_org } }), { status: 409 });
			}
			if (u === '/v1/users/get') return new Response(JSON.stringify({ ok: true, data: { users: [] } }));
			return new Response(JSON.stringify({ ok: true, data: { orgs: [], total: 0, sortable: [] } }));
		});
		at('/admin/orgs', '/admin/orgs', <OrgsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /New org/ }));
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'measureone' } });
		fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'sapan@measureone.com' } });
		fireEvent.click(await screen.findByRole('button', { name: '+ Invite sapan@measureone.com by email' }));
		fireEvent.click(screen.getByRole('button', { name: 'Create org and invite owner' }));
		const prompt = await screen.findByRole('alertdialog', { name: 'Reactivate?' });
		expect(prompt).toHaveTextContent('measureone belongs to a deleted organization');
		fireEvent.click(within(prompt).getByRole('button', { name: 'Reactivate' }));
		expect(await screen.findByTestId('org-created')).toHaveTextContent('The org is back with its history.');
		expect(bodies).toEqual([
			{ slug: 'measureone', owner: { email: 'sapan@measureone.com' } },
			{ slug: 'measureone', owner: { email: 'sapan@measureone.com' }, reactivate: true },
		]);
	});
});

describe('Admin › Organizations list — status', () => {
	const row = (slug: string, over: Partial<Admin_org_row> = {}): Admin_org_row => ({ id: `o-${slug}`, slug, display_name: slug, member_count: 1, scope_count: 0, created_at: '2026-01-01T00:00:00Z', status: 'active', owner: { username: 'ana', status: 'active' }, deleted_at: null, ...over });

	it('shows status pills and owners; the status filter and Include deleted go to orgs/get', async () => {
		const calls = route_fetch({ '/v1/orgs/get': () => ({ orgs: [row('acme'), row('measureone', { status: 'waiting_for_owner', owner: { username: null, status: 'invited' } }), row('m2', { status: 'waiting_for_owner', owner: { username: 'sapan', status: 'invited' } }), row('old', { status: 'deleted', deleted_at: '2026-09-01T00:00:00Z' })], total: 4, sortable: [] }) });
		at('/admin/orgs', '/admin/orgs', <OrgsPage />);
		const waiting = await screen.findByTestId('org-measureone');
		expect(within(waiting).getByText('Waiting for owner')).toBeInTheDocument();
		expect(waiting).toHaveTextContent('Invited');
		expect(screen.getByTestId('org-m2')).toHaveTextContent('sapan · invited');
		expect(within(screen.getByTestId('org-acme')).getByText('Active')).toBeInTheDocument();
		expect(within(screen.getByTestId('org-old')).getByText('Deleted')).toBeInTheDocument();
		fireEvent.click(within(screen.getByRole('group', { name: 'Status' })).getByRole('button', { name: 'Waiting for owner' }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/orgs/get').at(-1)!.body).toMatchObject({ status: 'waiting_for_owner' }));
		fireEvent.click(screen.getByRole('button', { name: 'Include deleted' }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/orgs/get').at(-1)!.body).toMatchObject({ status: 'waiting_for_owner', include_deleted: true }));
	});
});

describe('Admin › Organization — status, banner and Invite', () => {
	const waiting = (): Org_detail => ({
		id: 'o1', slug: 'measureone', display_name: 'MeasureOne', created_at: '2026-10-02T00:00:00Z', status: 'waiting_for_owner', owner: { user_id: 'u-sapan', username: null, status: 'invited' }, deleted_at: null,
		...org_extras, pending_owner_invite: { invite_id: 'inv-1', email: 'sapan@measureone.com', expires_at: '2026-10-16T10:12:00Z' },
		members: [
			{ user_id: 'u-sapan', username: null, display_name: '', email: 'sapan@measureone.com', role: 'owner', role_id: 'r-owner', status: 'pending', invited_at: '2026-10-02T10:12:00Z', joined_at: null, deleted_at: null },
			{ user_id: 'u-old', username: 'old', display_name: 'Old Timer', email: null, role: 'member', role_id: 'r-member', status: 'deleted', invited_at: null, joined_at: '2026-01-01T00:00:00Z', deleted_at: '2026-09-01T00:00:00Z' },
		],
		scopes: [],
		roles: [role('r-owner', 'owner', 'Owner'), role('r-member', 'member', 'Member')],
	});

	it('shows Waiting for owner (who, when the invite expires), member pills, and invites with invitations/create — no Add member', async () => {
		const calls = route_fetch({ '/v1/orgs/get_by_id': () => waiting(), '/v1/invitations/create': (b) => ({ invite_id: 'inv-9', status: 'pending', email: b.email, role: b.role, expires_at: '2026-10-16T10:20:00Z', resent: false, email_sent: true, invite_url: null }) });
		at('/admin/orgs/o1', '/admin/orgs/:id', <OrgPage />);
		expect(await screen.findByTestId('waiting-owner')).toHaveTextContent('sapan@measureone.com was invited to own this org and hasn’t accepted yet. The invite expires 16 Oct.');
		const pending = screen.getByTestId('member-u-sapan');
		expect(within(pending).getByText('Pending')).toBeInTheDocument();
		expect(pending).toHaveTextContent('sapan@measureone.com');
		expect(within(screen.getByTestId('member-old')).getByText('Deleted')).toBeInTheDocument();
		expect(within(screen.getByTestId('member-old')).queryByRole('button', { name: 'Remove' })).toBeNull();
		expect(screen.queryByLabelText('Add member')).toBeNull();
		expect(screen.queryByTestId('ownerless')).toBeNull();
		fireEvent.change(screen.getByLabelText('Email to invite'), { target: { value: 'ana@acme.io' } });
		expect(within(screen.getByLabelText('Invite as')).queryByRole('option', { name: 'Operator' })).toBeNull();
		fireEvent.change(screen.getByLabelText('Invite as'), { target: { value: 'admin' } });
		fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
		expect(await screen.findByTestId('sent-result')).toHaveTextContent('Invite sent to ana@acme.io.');
		expect(calls.find((c) => c.url === '/v1/invitations/create')?.body).toEqual({ target_type: 'org', org_id: 'o1', email: 'ana@acme.io', role: 'admin' });
		expect(calls.some((c) => c.url === '/v1/orgs/add_member')).toBe(false);
	});
});

describe('Admin › Accounts — set-password and reset emails', () => {
	const kim = { id: 'u-kim', username: 'kim', display_name: 'Kim', email: 'kim@acme.com', role: 'user' as const, status: 'invited' as const, suspended_at: null, deleted_at: null, created_at: '2026-10-01T00:00:00Z' };
	const ana = { ...kim, id: 'u-ana', username: 'ana', email: 'ana@acme.com', status: 'active' as const };
	const detail = (over: Partial<Admin_user_detail> = {}): Admin_user_detail => ({ ...ana, suspended_reason: '', orgs: [], team_count: 0, scope_count: 0, token_count: 0, draft_count: 0, ...over });

	it('rows show Invited / Active / Suspended / Deleted', async () => {
		route_fetch({ '/v1/admin_list/get': () => list('accounts', [kim, ana, { ...ana, id: 'u-s', username: 'sus', status: 'suspended' as const, suspended_at: '2026-09-01T00:00:00Z' }, { ...ana, id: 'u-d', username: 'gone', status: 'deleted' as const, deleted_at: '2026-09-01T00:00:00Z' }, { ...kim, id: 'u-new', username: null, display_name: '', email: 'new@acme.com' }], { counts: { all: 5, admins: 0, suspended: 1 } }) });
		at('/admin/accounts', '/admin/accounts', <AccountsPage />);
		expect(within(await screen.findByTestId('acct-kim')).getByText('Invited')).toBeInTheDocument();
		expect(within(screen.getByTestId('acct-ana')).getByText('Active')).toBeInTheDocument();
		expect(within(screen.getByTestId('acct-sus')).getByText('Suspended')).toBeInTheDocument();
		expect(within(screen.getByTestId('acct-gone')).getByText('Deleted')).toBeInTheDocument();
		const fresh = screen.getByTestId('acct-u-new');
		expect(fresh).toHaveTextContent('new@acme.com');
		expect(within(fresh).getAllByText('Invited')).toHaveLength(2);
	});

	it('New account has no password field and says the set-password email was sent', async () => {
		const calls = route_fetch({ '/v1/admin_list/get': () => list('accounts', [], { counts: { all: 0, admins: 0, suspended: 0 } }), '/v1/users/new': () => ({ user: { id: 'u-kim', username: 'kim', email: 'kim@acme.com', status: 'invited' }, setup: { expires_at: '2026-10-09T10:00:00Z', email_sent: true, setup_url: null } }) });
		at('/admin/accounts', '/admin/accounts', <AccountsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /New account/ }));
		const form = screen.getByRole('form', { name: 'New account' });
		expect(within(form).queryByLabelText('password')).toBeNull();
		fireEvent.change(within(form).getByLabelText('username'), { target: { value: 'kim' } });
		fireEvent.change(within(form).getByLabelText('email'), { target: { value: 'kim@acme.com' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Create account' }));
		const done = await screen.findByTestId('account-created');
		expect(within(done).getByTestId('sent-result')).toHaveTextContent('Set-password email sent to kim@acme.com.');
		expect(within(done).getByText('Invited')).toBeInTheDocument();
		expect(calls.find((c) => c.url === '/v1/users/new')?.body).toEqual({ username: 'kim', email: 'kim@acme.com' });
	});

	it('New account without email set up shows the set-password link to copy', async () => {
		route_fetch({ '/v1/admin_list/get': () => list('accounts', []), '/v1/users/new': () => ({ user: { id: 'u-kim', username: 'kim', email: 'kim@acme.com', status: 'invited' }, setup: { expires_at: '2026-10-09T10:00:00Z', email_sent: false, setup_url: 'https://app.example.test/reset/abc' } }) });
		at('/admin/accounts', '/admin/accounts', <AccountsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /New account/ }));
		const form = screen.getByRole('form', { name: 'New account' });
		fireEvent.change(within(form).getByLabelText('username'), { target: { value: 'kim' } });
		fireEvent.change(within(form).getByLabelText('email'), { target: { value: 'kim@acme.com' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Create account' }));
		expect(await screen.findByTestId('fallback-url')).toHaveTextContent('https://app.example.test/reset/abc');
	});

	it('Reactivate with a different username: Core\'s 422 shows on the username field', async () => {
		const message = 'This email belongs to a deleted user with a different username';
		let reactivating = false;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			const u = String(url);
			if (u === '/v1/users/new') {
				const body = { ok: false, error: { code: 'deleted', message: 'deleted', details: { kind: 'user', id: 'u-d', deleted_at: '2026-09-01T00:00:00Z', was_active: true } } };
				const again = { ok: false, error: { code: 'invalid_params', message, details: { field: 'username' } } };
				return new Response(JSON.stringify(reactivating ? again : body), { status: reactivating ? 422 : 409 });
			}
			return new Response(JSON.stringify({ ok: true, data: list('accounts', []) }));
		});
		at('/admin/accounts', '/admin/accounts', <AccountsPage />);
		fireEvent.click(await screen.findByRole('button', { name: /New account/ }));
		const form = screen.getByRole('form', { name: 'New account' });
		fireEvent.change(within(form).getByLabelText('username'), { target: { value: 'other' } });
		fireEvent.change(within(form).getByLabelText('email'), { target: { value: 'gone@acme.com' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Create account' }));
		reactivating = true;
		fireEvent.click(await within(form).findByRole('button', { name: /Reactivate/ }));
		const err = await within(form).findByText(message);
		expect(err).toHaveAttribute('id', 'new-username-error');
		expect(within(form).getByLabelText('username')).toHaveAttribute('aria-invalid', 'true');
		fireEvent.change(within(form).getByLabelText('username'), { target: { value: 'gone' } });
		expect(within(form).queryByText(message)).toBeNull();
	});

	it('the deleted-account panel shows a refused username on its username field', async () => {
		const message = 'This email belongs to a deleted user with a different username';
		const gone = detail({ id: 'u-d', username: 'gone', email: 'gone@acme.com', display_name: 'Gone', status: 'deleted', deleted_at: '2026-09-01T00:00:00Z' });
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			const u = String(url);
			if (u === '/v1/users/new') return new Response(JSON.stringify({ ok: false, error: { code: 'invalid_params', message, details: { field: 'username' } } }), { status: 422 });
			if (u === '/v1/users/get_by_id') return new Response(JSON.stringify({ ok: true, data: gone }));
			return new Response(JSON.stringify({ ok: true, data: list('accounts', []) }));
		});
		at('/admin/accounts?u=u-d', '/admin/accounts', <AccountsPage />);
		const form = await screen.findByRole('form', { name: 'Reactivate account' });
		fireEvent.click(within(form).getByRole('button', { name: 'Reactivate' }));
		expect(await within(form).findByRole('alert')).toHaveTextContent(message);
		expect(within(form).getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
	});

	it('“Send reset email” replaces Set new password and posts only the user id', async () => {
		const calls = route_fetch({ '/v1/admin_list/get': () => list('accounts', [ana]), '/v1/users/get_by_id': () => detail(), '/v1/users/reset_password': () => ({ reset_id: 'rst-1', expires_at: '2026-10-03T10:20:00Z', email_sent: true, reset_url: null }) });
		at('/admin/accounts?u=u-ana', '/admin/accounts', <AccountsPage />);
		const panel = await screen.findByTestId('account-panel');
		expect(within(panel).queryByRole('button', { name: 'Set new password' })).toBeNull();
		fireEvent.click(await within(panel).findByRole('button', { name: 'Send reset email' }));
		expect(await within(panel).findByTestId('sent-result')).toHaveTextContent('Reset email sent to ana@acme.com.');
		expect(calls.find((c) => c.url === '/v1/users/reset_password')?.body).toEqual({ user_id: 'u-ana' });
	});

	it('a suspended user gets “Unsuspend the user first”', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			const u = String(url);
			if (u === '/v1/users/reset_password') return new Response(JSON.stringify({ ok: false, error: { code: 'not_active', message: 'not active', details: { status: 'suspended' } } }), { status: 409 });
			if (u === '/v1/users/get_by_id') return new Response(JSON.stringify({ ok: true, data: detail({ status: 'suspended', suspended_at: '2026-09-01T00:00:00Z' }) }));
			return new Response(JSON.stringify({ ok: true, data: list('accounts', [ana]) }));
		});
		at('/admin/accounts?u=u-ana', '/admin/accounts', <AccountsPage />);
		const panel = await screen.findByTestId('account-panel');
		fireEvent.click(await within(panel).findByRole('button', { name: 'Send reset email' }));
		expect(await within(panel).findByRole('alert')).toHaveTextContent('Unsuspend the user first.');
	});

	it('“Include deleted” sends include_deleted and lists deleted rows with the Deleted pill', async () => {
		const gone = { ...ana, id: 'u-d', username: 'gone', status: 'deleted' as const, deleted_at: '2026-09-01T00:00:00Z' };
		const calls = route_fetch({ '/v1/admin_list/get': (b) => list('accounts', b.include_deleted ? [ana, gone] : [ana]) });
		at('/admin/accounts', '/admin/accounts', <AccountsPage />);
		await screen.findByTestId('acct-ana');
		expect(calls.find((c) => c.url === '/v1/admin_list/get')?.body).not.toHaveProperty('include_deleted');
		const toggle = screen.getByRole('button', { name: 'Include deleted' });
		expect(toggle).toHaveAttribute('aria-pressed', 'false');
		fireEvent.click(toggle);
		expect(within(await screen.findByTestId('acct-gone')).getByText('Deleted')).toBeInTheDocument();
		expect(calls.filter((c) => c.url === '/v1/admin_list/get').at(-1)?.body).toMatchObject({ kind: 'accounts', include_deleted: true });
		expect(screen.getByTestId('where')).toHaveTextContent('deleted=1');
		expect(screen.getByRole('button', { name: 'Include deleted' })).toHaveAttribute('aria-pressed', 'true');
	});

	it('a deleted account offers only Reactivate, which is users/new with reactivate', async () => {
		const gone = detail({ id: 'u-d', username: 'gone', email: 'gone@acme.com', display_name: 'Gone', status: 'deleted', deleted_at: '2026-09-01T00:00:00Z' });
		let restored = false;
		const calls = route_fetch({
			'/v1/admin_list/get': () => list('accounts', []),
			'/v1/users/get_by_id': () => (restored ? { ...gone, status: 'invited', deleted_at: null } : gone),
			'/v1/users/new': () => { restored = true; return { user: { id: 'u-d', username: 'gone', email: 'gone@acme.com', status: 'invited' }, setup: { expires_at: '2026-10-09T10:00:00Z', email_sent: false, setup_url: 'https://app.example.test/reset/xyz' } }; },
		});
		at('/admin/accounts?u=u-d&deleted=1', '/admin/accounts', <AccountsPage />);
		const panel = await screen.findByTestId('account-panel');
		const form = await within(panel).findByRole('form', { name: 'Reactivate account' });
		expect(within(panel).getByText('Deleted')).toBeInTheDocument();
		for (const name of ['Send reset email', 'Suspend…', 'Delete account…', 'Act as gone', 'Edit profile', 'Make site admin', 'Unsuspend']) {
			expect(within(panel).queryByRole('button', { name })).toBeNull();
		}
		expect(within(form).queryByLabelText('Username')).toBeNull();
		fireEvent.click(within(form).getByRole('button', { name: 'Reactivate' }));
		expect(await within(panel).findByText('Invited')).toBeInTheDocument();
		expect(within(panel).queryByRole('form', { name: 'Reactivate account' })).toBeNull();
		expect(within(panel).getByTestId('fallback-url')).toHaveTextContent('https://app.example.test/reset/xyz');
		expect(calls.find((c) => c.url === '/v1/users/new')?.body).toEqual({ username: 'gone', email: 'gone@acme.com', display_name: 'Gone', reactivate: true });
	});

	it('reactivating someone deleted before choosing a username asks for one', async () => {
		const gone = detail({ id: 'u-d', username: null, email: 'new@acme.com', display_name: '', status: 'deleted', deleted_at: '2026-09-01T00:00:00Z' });
		const calls = route_fetch({
			'/v1/admin_list/get': () => list('accounts', []),
			'/v1/users/get_by_id': () => gone,
			'/v1/users/new': () => ({ user: { id: 'u-d', username: 'newbie', email: 'new@acme.com', status: 'invited' }, setup: { expires_at: '2026-10-09T10:00:00Z', email_sent: true, setup_url: null } }),
		});
		at('/admin/accounts?u=u-d', '/admin/accounts', <AccountsPage />);
		const form = await screen.findByRole('form', { name: 'Reactivate account' });
		const go = within(form).getByRole('button', { name: 'Reactivate' });
		expect(go).toBeDisabled();
		fireEvent.change(within(form).getByLabelText('Username'), { target: { value: 'newbie' } });
		fireEvent.click(go);
		expect(await screen.findByTestId('sent-result')).toHaveTextContent('Set-password email sent to new@acme.com.');
		expect(calls.find((c) => c.url === '/v1/users/new')?.body).toEqual({ username: 'newbie', email: 'new@acme.com', reactivate: true });
	});

	it('deleting a user who owns orgs lists them', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			const u = String(url);
			if (u === '/v1/users/delete') return new Response(JSON.stringify({ ok: false, error: { code: 'owns_orgs', message: 'Transfer or delete these orgs first.', details: { orgs: [{ slug: 'measureone' }] } } }), { status: 409 });
			if (u === '/v1/users/get_by_id') return new Response(JSON.stringify({ ok: true, data: detail() }));
			return new Response(JSON.stringify({ ok: true, data: list('accounts', [ana]) }));
		});
		at('/admin/accounts?u=u-ana', '/admin/accounts', <AccountsPage />);
		const panel = await screen.findByTestId('account-panel');
		fireEvent.click(await within(panel).findByRole('button', { name: 'Delete account…' }));
		fireEvent.change(within(panel).getByLabelText('Confirm email'), { target: { value: 'ana@acme.com' } });
		fireEvent.click(within(panel).getByRole('button', { name: 'Delete account' }));
		const alert = await within(panel).findByRole('alert');
		expect(alert).toHaveTextContent('Transfer or delete these orgs first.');
		expect(within(alert).getByRole('link', { name: 'measureone' })).toHaveAttribute('href', '/admin/orgs?q=measureone');
	});
});
