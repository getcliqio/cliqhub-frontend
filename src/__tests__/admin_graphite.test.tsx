/** Admin mode (Graphite): one BFF read per view; writes are the existing single routes. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview } from './fixtures_overview';
import type { Admin_home_data, Admin_list_data, Admin_org_detail, Admin_user_detail } from '@/lib/admin';
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
	const ana = { id: 'u-ana', username: 'ana', display_name: 'Ana Ruiz', email: 'ana@acme.com', role: 'user' as const, suspended_at: null, created_at: '2026-03-01T00:00:00Z' };
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

describe('Admin › Organization', () => {
	const org = (over: Partial<Admin_org_detail> = {}): Admin_org_detail => ({
		id: 'o1', slug: 'acme-labs', display_name: 'Acme Labs', created_at: '2026-01-01T00:00:00Z',
		members: [
			{ user_id: 'u-ana', username: 'ana', display_name: 'Ana Ruiz', email: 'ana@acme.com', role: 'admin', role_id: 'r-admin' },
			{ user_id: 'u-tom', username: 'tom', display_name: 'Tom Lee', email: 'tom@acme.com', role: 'member', role_id: 'r-member' },
		],
		scopes: [{ id: 's1', slug: 'acme', display_name: 'Acme', visibility: 'private', member_count: '2', team_count: '4' }],
		roles: [{ id: 'r-owner', slug: 'owner', name: 'Owner', is_system: true }, { id: 'r-admin', slug: 'admin', name: 'Admin', is_system: true }, { id: 'r-member', slug: 'member', name: 'Member', is_system: true }],
		...over,
	});

	it('flags an ownerless org and fixes it with one role change', async () => {
		const calls = route_fetch({ '/v1/orgs/get_by_id': () => org(), '/v1/users/update_role': () => ({ updated: true }) });
		at('/admin/orgs/o1', '/admin/orgs/:id', <OrgPage />);
		const banner = await screen.findByTestId('ownerless');
		fireEvent.click(within(banner).getByRole('button', { name: 'Make Ana Ruiz owner' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/users/update_role')?.body).toEqual({ org_id: 'o1', user_id: 'u-ana', role_id: 'r-owner' }));
	});

	it('changes a member’s role inline; Realms tab asks Core for all realms', async () => {
		const calls = route_fetch({ '/v1/orgs/get_by_id': () => org({ members: [{ user_id: 'u-kim', username: 'kim', display_name: 'Kim', role: 'admin', role_id: 'r-owner' }, ...org().members] }), '/v1/users/update_role': () => ({}), '/v1/realms/get': () => ({ items: [{ id: 'r1', slug: 'prod', name: 'Prod', org_slug: 'acme-labs', created_at: 1 }], total: 1 }) });
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
	it('realms: rows open the realm; org picker narrows', async () => {
		const calls = route_fetch({ '/v1/admin_list/get': () => list('realms', [{ id: 'r1', slug: 'prod-us', name: 'Prod US', org_slug: 'm1', created_by_username: 'sapan', created_at: Date.now() - 864e5 }], { org_options: [{ id: 'o1', slug: 'm1', display_name: 'MeasureOne' }] }) });
		at('/admin/realms', '/admin/realms', <RealmsPage />);
		fireEvent.change(await screen.findByLabelText('Organization'), { target: { value: 'o1' } });
		await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({ kind: 'realms', org_id: 'o1' }));
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
		const calls = route_fetch({ '/v1/admin_list/get': () => list('scopes', rows, { org_options: orgs }), '/v1/orgs/new_scope': () => ({}), '/v1/orgs/update_scope': () => ({}) });
		at('/admin/scopes', '/admin/scopes', <ScopesPage />);
		fireEvent.click(await screen.findByRole('button', { name: /New scope/ }));
		const form = screen.getByRole('form', { name: 'New scope' });
		fireEvent.change(within(form).getByLabelText('Organization'), { target: { value: orgs[0].id } });
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
	it('owners_of reads the owner role by id', () => {
		expect(owners_of({ id: 'o', slug: 's', display_name: '', created_at: '', scopes: [], roles: [{ id: 'r1', slug: 'owner', name: 'Owner' }], members: [{ user_id: 'a', username: 'a', display_name: '', role: 'admin', role_id: 'r1' }, { user_id: 'b', username: 'b', display_name: '', role: 'member', role_id: null }, { user_id: 'c', username: 'c', display_name: '', role: 'admin', role_id: null }, { user_id: 'd', username: 'd', display_name: '', role: 'admin', role_id: 'r2' }] }).map((m) => m.user_id)).toEqual(['a', 'c']);
	});
	it('audit_summary masks secret-looking keys', () => {
		expect(audit_summary({ username: 'ana', api_token: 'xyz', reason: '' })).toBe('username: ana · api_token: set');
	});
});
