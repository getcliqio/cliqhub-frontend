/**
 * Graphite run detail — composition read, state-driven actions, control
 * calls (supply / cancel modes / resume), banners, stranded errors, logs,
 * canonical realm redirect, polling cadence.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { run_detail, overview_for_realm, REALM } from './fixtures_realm';
import { gs_response } from './fixtures_overview';
import type { Run_detail_data } from '@/lib/realm_inbox';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} },
	loading: false,
	logout: vi.fn(),
	acting_as: null,
	stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));
vi.mock('@/components/run_in_realm_dialog', () => ({
	Run_in_realm_dialog: (p: { scope: string; slug: string; fixed_realm: { id: string }; prefill_from: { inputs: unknown; run_name: string | null; source_run_id: string } }) => (
		<div role="dialog" aria-label="Run again">
			{p.scope}/{p.slug} in {p.fixed_realm.id} · {JSON.stringify(p.prefill_from)}
		</div>
	),
}));

import { Component as RunPage, LIVE_POLL_MS, IDLE_POLL_MS } from '@/pages/realm/run_detail_page';

function Where() {
	const loc = useLocation();
	return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}

type Handler = (body: Record<string, unknown>) => { status?: number; body: unknown };

function route_fetch(detail: Run_detail_data | (() => Run_detail_data), handlers: Record<string, Handler> = {}) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/run_detail/get') {
			const d = typeof detail === 'function' ? detail() : detail;
			return new Response(JSON.stringify({ ok: true, data: d }));
		}
		if (handlers[u]) {
			const r = handlers[u](body);
			return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
		}
		throw new Error(`unexpected ${u}`);
	});
}

function calls(spy: ReturnType<typeof route_fetch>, path: string) {
	return spy.mock.calls.filter(([u]) => u === path).map(([, i]) => JSON.parse(String((i as RequestInit).body)));
}

function render_page(path = '/o/measureone/realms/prod-us/runs/run-77') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/o/:org/realms/:slug/runs/:run_id" element={<><RunPage /><Where /></>} />
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}

async function ready() {
	return screen.findByRole('heading', { level: 1 });
}

describe('Graphite run detail', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('loads through one composition call with the run id and no Core fan-out', async () => {
		const spy = route_fetch(run_detail());
		render_page();
		expect(await ready()).toHaveTextContent('Nightly reconcile');
		expect(calls(spy, '/v1/run_detail/get')).toEqual([{ run_id: 'run-77' }]);
		const other = spy.mock.calls.map(([u]) => String(u)).filter((u) => !['/v1/run_detail/get', '/v1/run_telemetry/get', '/v1/overview/get', '/v1/getting_started/get'].includes(u));
		expect(other).toEqual([]);
	});

	it('renders phases in workflow order with errors, the run error and details', async () => {
		route_fetch(run_detail());
		render_page();
		await ready();
		const rows = screen.getAllByTestId('phase-row');
		expect(rows.map((r) => r.querySelector('.g-mono')?.textContent)).toEqual(['fetch', 'match']);
		expect(screen.getByText('ledger timeout')).toBeInTheDocument();
		expect(screen.getByTestId('run-error')).toHaveTextContent('Timeout talking to ledger');
		expect(screen.getByRole('link', { name: 'ledger' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/workspaces/ws-1');
		expect(screen.getByRole('link', { name: 'd-1' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/daemons/d-1');
		expect(screen.getByText('month')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /Timeline & DAG/ })).toBeNull();
	});

	it.each([
		['running', ['Cancel']],
		['awaiting_input', ['Provide input', 'Cancel', 'Resume from…']],
		['failed', ['Resume from…', 'Run again']],
		['crashed', ['Resume from…', 'Run again']],
		['completed', ['Run again']],
		['cancelled', []],
	])('state %s shows actions %j', async (state, expected) => {
		route_fetch(run_detail({}, { state, error: null }));
		render_page();
		await ready();
		const group = screen.getByRole('group', { name: 'Run actions' });
		const labels = Array.from(group.querySelectorAll('button')).map((b) => b.textContent);
		expect(labels).toEqual(expected);
	});

	it('hides Run again when team_id is not scope/slug', async () => {
		route_fetch(run_detail({}, { state: 'completed', team_id: 'broken' }));
		render_page();
		await ready();
		expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
	});

	it('supply inputs posts key=value pairs, shows a notice and reloads', async () => {
		const spy = route_fetch(run_detail({}, { state: 'awaiting_input', error: null }), { '/v1/runs/supply_inputs': () => ({ body: { ok: true } }) });
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Provide input' }));
		const send = screen.getByRole('button', { name: 'Send & resume' });
		expect(send).toBeDisabled();
		fireEvent.change(screen.getByLabelText('Inputs'), { target: { value: 'employer_name=Acme Corp\n# skip\nbad line' } });
		fireEvent.click(send);
		expect(await screen.findByText('Inputs sent — the run should resume shortly.')).toBeInTheDocument();
		expect(calls(spy, '/v1/runs/supply_inputs')).toEqual([{ run_id: 'run-77', inputs: { employer_name: 'Acme Corp' } }]);
		expect(calls(spy, '/v1/run_detail/get').length).toBeGreaterThanOrEqual(2);
		expect(screen.queryByTestId('supply-panel')).toBeNull();
	});

	it.each([
		['hub_terminated', /marked cancelled on the Hub/],
		['already_terminal', /already finished/],
		['queued', /Cancel queued/],
	])('cancel mode %s → matching notice', async (mode, text) => {
		const spy = route_fetch(run_detail({}, { state: 'running', error: null }), { '/v1/runs/cancel': () => ({ body: { ok: true, data: { mode } } }) });
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
		expect(await screen.findByText(text)).toBeInTheDocument();
		expect(calls(spy, '/v1/runs/cancel')).toEqual([{ run_id: 'run-77' }]);
	});

	it('resume defaults to the failed phase and posts from_phase', async () => {
		const spy = route_fetch(run_detail(), { '/v1/runs/resume': () => ({ body: { ok: true } }) });
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Resume from…' }));
		expect(screen.getByTestId('resume-select')).toHaveValue('match');
		fireEvent.change(screen.getByTestId('resume-select'), { target: { value: 'fetch' } });
		fireEvent.click(screen.getByRole('button', { name: 'Resume from fetch' }));
		expect(await screen.findByText(/Resume queued from 'fetch'/)).toBeInTheDocument();
		expect(calls(spy, '/v1/runs/resume')).toEqual([{ run_id: 'run-77', from_phase: 'fetch' }]);
	});

	it('stranded control error offers Run again, prefilled from this run', async () => {
		route_fetch(run_detail({}, { state: 'running', error: null }), {
			'/v1/runs/cancel': () => ({ status: 409, body: { ok: false, code: 'run/daemon_stranded', error: { code: 'run/daemon_stranded', message: 'Daemon gone for 2 days' } } }),
		});
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent('Daemon gone for 2 days');
		fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
		const dlg = screen.getByRole('dialog', { name: 'Run again' });
		expect(dlg).toHaveTextContent(`measureone/recon in ${REALM.id}`);
		expect(dlg).toHaveTextContent('"source_run_id":"run-77"');
		expect(dlg).toHaveTextContent('"run_name":"Nightly reconcile (rerun)"');
	});

	it('a plain control error has no Run again shortcut and can be dismissed', async () => {
		route_fetch(run_detail({}, { state: 'running', error: null }), {
			'/v1/runs/cancel': () => ({ status: 403, body: { ok: false, error: { code: 'forbidden', message: 'Viewers cannot cancel' } } }),
		});
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Viewers cannot cancel');
		expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
		expect(screen.queryByText('Viewers cannot cancel')).toBeNull();
	});

	it('pending control disables the matching action and shows the outbox banner', async () => {
		route_fetch(run_detail({}, {
			state: 'running', error: null,
			pending_control: { tx_id: 't', endpoint: '/v1/cancel', enqueued_at: Date.now() - 60_000, attempts: 3, max_attempts: 8, delivered_at: null, last_error: 'ECONNREFUSED', ack_status: null },
		}));
		render_page();
		await ready();
		expect(screen.getByRole('button', { name: 'Cancel pending…' })).toBeDisabled();
		const banner = screen.getByTestId('pending-control-banner');
		expect(banner).toHaveTextContent('Cancel pending on daemon d-1');
		expect(banner).toHaveTextContent('3/8 delivery attempts');
		expect(banner).toHaveTextContent('ECONNREFUSED');
		expect(banner).toHaveTextContent(/isn’t answering/);
	});

	it('lost state: orphan banner wins, Resume hidden, Run again offered', async () => {
		route_fetch(run_detail({}, {
			state: 'failed', state_lost_at: Date.now(),
			pending_control: { tx_id: 't', endpoint: '/v1/resume', enqueued_at: 1, attempts: 0, max_attempts: 8, delivered_at: null, last_error: null, ack_status: null },
		}));
		render_page();
		await ready();
		expect(screen.getByTestId('orphaned-run-banner')).toBeInTheDocument();
		expect(screen.queryByTestId('pending-control-banner')).toBeNull();
		expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();
		expect(screen.getAllByRole('button', { name: 'Run again' }).length).toBeGreaterThan(0);
	});

	it('hub force-terminate banner shows attribution and reason', async () => {
		route_fetch(run_detail({}, {
			state: 'cancelled', error: null,
			force_terminate: { already_terminated: true, terminated_at: Date.now() - 120_000, terminated_by_user_id: 'u-9', terminated_reason: 'daemon offline', eligible: false, trigger: 'daemon_offline', blocker: null },
		}));
		render_page();
		await ready();
		const b = screen.getByTestId('force-terminated-banner');
		expect(b).toHaveTextContent('Cancelled on the Hub by user u-9');
		expect(b).toHaveTextContent('Reason: daemon offline');
	});

	it('pending review on this run links to the review', async () => {
		route_fetch(run_detail({ reviews: [{ id: 'rev-9', title: 'Approve match results', phase: 'gate', requested_at: Date.now() - 60_000, message: null }] }, { state: 'awaiting_input', error: null }));
		render_page();
		await ready();
		expect(screen.getByTestId('run-reviews-banner')).toHaveTextContent('Waiting on a review: Approve match results');
		expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/reviews/rev-9');
	});

	it('partial composition names the missing sections', async () => {
		const d = run_detail({ partial: true });
		d.sections.labels = { status: 'error', error: 'x' };
		route_fetch(d);
		render_page();
		await ready();
		expect(screen.getByText(/Some details couldn’t be loaded \(labels\)/)).toBeInTheDocument();
	});

	it('?tab=logs deep-links to logs, which read get_logs for this run and realm', async () => {
		const spy = route_fetch(run_detail(), {
			'/v1/runs/get_logs': () => ({ body: { ok: true, lines: [{ id: 'l1', created_at: Date.now(), level: 'error', message: 'ledger timeout after 30s' }], total: 1 } }),
		});
		render_page('/o/measureone/realms/prod-us/runs/run-77?tab=logs');
		await ready();
		expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');
		expect(await screen.findByText('ledger timeout after 30s')).toBeInTheDocument();
		expect(calls(spy, '/v1/runs/get_logs')[0]).toMatchObject({ realm_id: REALM.id, run_ids: ['run-77'], offset: 0 });
		fireEvent.click(screen.getByRole('button', { name: 'error' }));
		await waitFor(() => expect(calls(spy, '/v1/runs/get_logs').at(-1)).toMatchObject({ levels: ['error'] }));
		fireEvent.click(screen.getByRole('tab', { name: /Phases/ }));
		expect(screen.getByTestId('where')).not.toHaveTextContent('tab=logs');
	});

	it('redirects to the run’s real realm when opened under another realm URL', async () => {
		route_fetch(run_detail({ realm: { id: 'r-x', slug: 'sandbox', name: 'Sandbox', org_slug: 'acme-labs' } }));
		render_page('/o/measureone/realms/prod-us/runs/run-77');
		await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/o/acme-labs/realms/sandbox/runs/run-77'));
	});

	it('404 → not-found state', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url) === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
			if (String(url) === '/v1/getting_started/get') return gs_response(url)!;
			return new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Run not found' } }), { status: 404 });
		});
		render_page();
		expect(await screen.findByText('This run doesn’t exist')).toBeInTheDocument();
	});

	it('polls every 4s while live and 20s once finished', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		let state = 'running';
		const spy = route_fetch(() => run_detail({}, { state, error: null }));
		render_page();
		await ready();
		const n0 = calls(spy, '/v1/run_detail/get').length;
		await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 10); });
		expect(calls(spy, '/v1/run_detail/get').length).toBe(n0 + 1);
		state = 'completed';
		await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 10); });
		const n1 = calls(spy, '/v1/run_detail/get').length;
		await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2); });
		expect(calls(spy, '/v1/run_detail/get').length).toBe(n1);
		await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS); });
		expect(calls(spy, '/v1/run_detail/get').length).toBe(n1 + 1);
	});
});
