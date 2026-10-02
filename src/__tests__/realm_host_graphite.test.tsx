/** Realm › Daemon and Realm › Workspace (Graphite). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview } from './fixtures_overview';
import { parse_inputs, run_id_of } from '@/components/graphite/g_host';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [], loading: false, logout: vi.fn(), refresh: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as DaemonPage } from '@/pages/realm/daemon_graphite_page';
import { Component as WorkspacePage } from '@/pages/realm/workspace_graphite_page';

const realm = { id: 'r-prod', slug: 'prod-us', name: 'prod-us', org_slug: 'measureone' };
function daemon_data(over: Record<string, unknown> = {}) {
	return {
		realm,
		daemon: { id: 'd1', name: 'mac-studio', hostname: 'mac.local', status: 'online', last_heartbeat: Date.now() - 5000, capacity: 4, user_email: 's@x.com' },
		installed: [{ team_id: 't1', scope: 'measureone', slug: 'feature-dev', version: '1.2.0' }],
		installable: [{ team_id: 't2', scope: 'measureone', slug: 'docs', version: '0.3.0' }],
		workspaces: [{ id: 'w1', name: 'api', path: '/src/api', teams: ['@measureone/feature-dev'], active_runs: 1, last_run_state: 'running', last_run_at: Date.now() - 60000 }],
		runs: [{ run_id: 'run-1', run_name: 'PROJ-1', state: 'running', team: '@measureone/feature-dev', phase: 'build', started_at: Date.now() - 60000, completed_at: null, last_updated_at: Date.now() - 1000 }],
		runs_total: 1,
		partial: false,
		...over,
	};
}
type Call = { url: string; body: Record<string, unknown> };
function route_fetch(extra: Record<string, (b: Record<string, unknown>) => unknown>) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (extra[u]) return new Response(JSON.stringify({ ok: true, data: extra[u](body) }));
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}
function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }
function open(path: string) {
	return render(<MemoryRouter initialEntries={[path]}><Routes>
		<Route path="/o/:org/realms/:slug/daemons/:daemon_id" element={<DaemonPage />} />
		<Route path="/o/:org/realms/:slug/workspaces/:workspace_id" element={<WorkspacePage />} />
		<Route path="*" element={<Where />} />
	</Routes></MemoryRouter>);
}
afterEach(() => vi.restoreAllMocks());

describe('host helpers', () => {
	it('parse_inputs and run_id_of', () => {
		expect(parse_inputs('a=1\n\n b = two=2 ')).toEqual({ ok: true, inputs: { a: '1', b: 'two=2' } });
		expect(parse_inputs('a=1\nnope')).toEqual({ ok: false, line: 2 });
		expect(run_id_of({ payload: { data: { run_id: 'r9' } } })).toBeNull(); // no daemon envelope since cliq-sdk 2.0
		expect(run_id_of({ run_id: 'r1' })).toBe('r1');
		expect(run_id_of(null)).toBeNull();
	});
});

describe('Daemon page', () => {
	it('shows facts, teams, workspaces and runs from one BFF read', async () => {
		const calls = route_fetch({ '/v1/daemon_page/get': () => daemon_data() });
		open('/o/measureone/realms/prod-us/daemons/d1');
		expect(await screen.findByRole('heading', { name: 'mac-studio' })).toBeInTheDocument();
		expect(screen.getByText('mac.local')).toBeInTheDocument();
		expect(screen.getByTestId('installed-feature-dev')).toBeInTheDocument();
		expect(screen.getByTestId('workspace-w1')).toBeInTheDocument();
		expect(screen.getByTestId('run-run-1')).toBeInTheDocument();
		expect(calls.find((c) => c.url === '/v1/daemon_page/get')?.body).toEqual({ org_slug: 'measureone', slug: 'prod-us', daemon_id: 'd1' });
		expect(calls.filter((c) => !c.url.startsWith('/v1/daemon_page')).length).toBe(0);
	});

	it('install / uninstall send the Core calls', async () => {
		const calls = route_fetch({ '/v1/daemon_page/get': () => daemon_data() });
		open('/o/measureone/realms/prod-us/daemons/d1');
		fireEvent.change(await screen.findByLabelText('Team to install'), { target: { value: 't2' } });
		fireEvent.click(screen.getByRole('button', { name: 'Install' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/teams/install')?.body).toEqual({ team_id: 't2', daemon_ids: ['d1'] }));
		const row = screen.getByTestId('installed-feature-dev');
		fireEvent.click(within(row).getByRole('button', { name: 'Uninstall…' }));
		fireEvent.click(within(row).getByRole('button', { name: 'Uninstall' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/teams/uninstall')?.body).toEqual({ daemon_id: 'd1', scope: 'measureone', slug: 'feature-dev' }));
	});

	it('run here enqueues on the daemon + workspace; cancel needs a confirm', async () => {
		const calls = route_fetch({ '/v1/daemon_page/get': () => daemon_data(), '/v1/runs/enqueue': () => ({ run_id: 'run-9', daemon_id: 'd1', accepted: true }) });
		open('/o/measureone/realms/prod-us/daemons/d1');
		fireEvent.click(within(await screen.findByTestId('workspace-w1')).getByRole('button', { name: 'Run here' }));
		fireEvent.change(screen.getByLabelText('Inputs'), { target: { value: 'ticket=PROJ-9' } });
		fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
		expect(await screen.findByRole('link', { name: /Open run/ })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-9');
		expect(calls.find((c) => c.url === '/v1/runs/enqueue')?.body).toEqual({ daemon_id: 'd1', workspace_id: 'w1', workspace_path: '/src/api', team_id: 't1', inputs: { ticket: 'PROJ-9' } });
		const run = screen.getByTestId('run-run-1');
		fireEvent.click(within(run).getByRole('button', { name: 'Cancel…' }));
		fireEvent.click(within(run).getByRole('button', { name: 'Cancel run' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/runs/cancel')?.body).toEqual({ run_id: 'run-1' }));
	});

	it('offline daemon: no live team list, install disabled', async () => {
		route_fetch({ '/v1/daemon_page/get': () => daemon_data({ daemon: { id: 'd1', name: 'mac-studio', status: 'offline' }, installed: null, partial: true }) });
		open('/o/measureone/realms/prod-us/daemons/d1');
		expect(await screen.findByText(/daemon is offline/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled();
	});

	it('remove goes back to the daemons list', async () => {
		const calls = route_fetch({ '/v1/daemon_page/get': () => daemon_data() });
		open('/o/measureone/realms/prod-us/daemons/d1');
		fireEvent.click(await screen.findByRole('button', { name: 'Remove…' }));
		fireEvent.click(screen.getByRole('button', { name: 'Remove daemon' }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/o/measureone/realms/prod-us/daemons');
		expect(calls.find((c) => c.url === '/v1/daemons/remove')?.body).toEqual({ daemon_id: 'd1' });
	});
});

describe('Workspace page', () => {
	it('shows teams and runs; runs a team with the workspace path', async () => {
		const calls = route_fetch({
			'/v1/workspace_page/get': () => ({ realm, workspace: { id: 'w1', name: 'api', path: '/src/api', daemon_id: 'd1', daemon_hostname: 'mac.local' }, teams: [{ team_id: 't1', scope: 'measureone', slug: 'feature-dev', version: null }], runs: [], runs_total: 0, partial: false }),
		});
		open('/o/measureone/realms/prod-us/workspaces/w1');
		expect(await screen.findByRole('heading', { name: 'api' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'mac.local' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/daemons/d1');
		expect(screen.getByText('No runs in this workspace yet.')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Run a team here' }));
		fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'try' } });
		fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/runs/enqueue')?.body).toEqual({ daemon_id: 'd1', workspace_id: 'w1', workspace_path: '/src/api', team_id: 't1', run_name: 'try' }));
	});
});
