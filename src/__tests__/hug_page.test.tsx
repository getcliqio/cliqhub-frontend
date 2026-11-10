/**
 * Hug page (/hugs/:hug_id), PLAN-hug-widgets §6.4 / §11.2: the review card (one metadata line, the title, the Hug's
 * summary), the run's workflow, and the response — the Hug's hug in a frame (`Hug_host` over `host_hug`, faked here:
 * the bridge itself is tested in @getcliqio/hug-frontend) in five states: (1) answering, Submit with the hug's label
 * and tone, enabled only when valid; (2) the answer as sent, "Change answer"; (3) changing it, Cancel; (4) a Hug not
 * sent to you; (5) ended, every answer in its own view frame. Without a frame (no hug, or its bundle gone) the
 * answers are key-values. Drafts are kept per viewer and Hug.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { single_org_overview, gs_response } from './fixtures_overview';
import type { Hug, Hug_response, Hug_run } from '@/lib/hug';
import { OVERVIEW_STALE_EVENT } from '@/lib/overview';

const auth = {
	user: { id: 'u1', username: 'ann', display_name: 'Ann', email: 'a@x.com', role: 'user' as const, preferences: {} },
	loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

/** One fake host per frame the page makes: its options, and what the test drives. */
interface Fake_host {
	opts: any;
	mode: 'answer' | 'view';
	modes: Array<{ mode: string; viewing?: unknown }>;
	destroyed: boolean;
	submitted: unknown[];
	/** Push an answer state, as the frame would (on_state). */
	state(s: { values: Record<string, unknown>; valid: boolean; problems?: Array<{ message: string }>; submit?: { label: string; tone: 'primary' | 'danger' }; summary?: string }): void;
}
const hosts: Fake_host[] = [];
vi.mock('@getcliqio/hug-frontend/host', () => ({
	host_hug: (opts: any) => {
		let last: any = null;
		const h: Fake_host = {
			opts, mode: opts.init.mode, modes: [], destroyed: false, submitted: [],
			state: (s) => {
				last = { problems: [], submit: { label: 'Submit', tone: 'primary' }, ...s };
				opts.on_state?.(last);
			},
		};
		hosts.push(h);
		const frame = document.createElement('iframe');
		frame.setAttribute('sandbox', 'allow-scripts');
		frame.src = opts.src;
		opts.container.append(frame);
		return {
			frame,
			state: () => last,
			mode: () => h.mode,
			set_mode: (mode: 'answer' | 'view', viewing?: unknown) => { h.mode = mode; h.modes.push({ mode, viewing }); },
			close: vi.fn(),
			update: vi.fn(),
			destroy: () => { h.destroyed = true; frame.remove(); },
			submit: async (send: (v: unknown, s: unknown) => Promise<any>) => {
				const out = await send(last.values, last.summary);
				h.submitted.push(out);
				if (out.ok) h.mode = 'view';
				return out;
			},
		};
	},
}));

import { Component as HugPage } from '@/pages/hugs/hug_page';

const SHA = 'f'.repeat(64);
const CONTENT = `https://content.test/hb/${SHA}/index.html`;
const soon = () => new Date(Date.now() + 3_600_000).toISOString();

/** An `approval` Hug, as Core returns it now. */
function hug(over: Partial<Hug> = {}): Hug {
	return {
		id: 'h-1', hug_url: 'https://hub/hugs/h-1', run_id: 'run-1841', run_name: 'quiet-amber-heron', team: '@cliq/feature-dev-js', phase: 'approve', iteration: 0,
		realm_id: 'r-prod', realm_name: 'Prod US', realm_slug: 'prod-us', org_slug: 'measureone',
		title: 'Review: approve', hug: { name: 'approval', sha256: SHA }, summary: 'Approve the plan before it ships.',
		params: { prompt: 'Please review the **plan**.', reject_choices: [{ value: 'draft' }] },
		files: [{ name: 'evidence', accept: ['application/pdf'] }], attachments: [{ artifact_id: 'a-1', name: 'design.md', size: 20, content_type: 'text/markdown', sha256: 'abc' }],
		channels: ['legal', 'ops'], status: 'open', outcome: null,
		expires_at: soon(), created_at: new Date(Date.now() - 600_000).toISOString(), closed_at: null, last_reminded_at: null,
		not_sent_to: [], responses: [], viewer: { can_answer: true, via: ['ops'] },
		...over,
	};
}

const response = (over: Partial<Hug_response> = {}): Hug_response => ({
	response_id: 'r1', responder: { user_id: 'u1', name: 'Ann' }, via: ['ops'], values: { decision: 'approve' }, summary: 'Approved',
	responded_at: new Date(Date.now() - 120_000).toISOString(), ...over,
});

type Handler = (body: Record<string, unknown>) => { status?: number; body: unknown };

const RUN: Hug_run = {
	run_id: 'run-1841', run_name: 'quiet-amber-heron', state: 'awaiting_input', team_label: '@cliq/feature-dev-js', team_version: '1.4.0',
	phases: [
		{ name: 'draft', type: 'standard', agent: 'claude-code', status: 'completed', depends_on: [] },
		{ name: 'approve', type: 'gate', agent: 'hug', status: 'awaiting_input', depends_on: ['draft'] },
	],
};

function route_fetch(h: Hug | (() => Hug), extra: Record<string, Handler> = {}, opts: { run?: Hug_run | null; content_url?: string | null } = {}) {
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
		calls.push({ url: u, body });
		if (extra[u]) { const r = extra[u](body); return new Response(JSON.stringify(r.body), { status: r.status ?? 200 }); }
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: single_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/hug_page/get') {
			const data = { hug: typeof h === 'function' ? h() : h, content_url: opts.content_url === undefined ? CONTENT : opts.content_url, run: opts.run ?? null };
			return new Response(JSON.stringify({ ok: true, data }));
		}
		throw new Error(`unexpected ${u}`);
	});
	return calls;
}

function render_page(id = 'h-1') {
	return render(<MemoryRouter initialEntries={[`/hugs/${id}`]}><Routes><Route path="/hugs/:hug_id" element={<HugPage />} /></Routes></MemoryRouter>);
}

beforeEach(() => { hosts.length = 0; localStorage.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('Hug page', () => {
	it('the review card: one metadata line, the title and the Hug\'s summary — no context section (the hug draws its own)', async () => {
		const calls = route_fetch(hug());
		render_page();
		expect(await screen.findByRole('heading', { level: 1, name: 'Review: approve' })).toBeInTheDocument();
		expect(calls.find((c) => c.url === '/v1/hug_page/get')?.body).toEqual({ hug_id: 'h-1' });
		expect(screen.getByTestId('hug-summary')).toHaveTextContent('Approve the plan before it ships.');
		expect(screen.queryByRole('region', { name: 'Context' })).toBeNull();
		const meta = screen.getByTestId('hug-meta');
		expect(meta).toHaveTextContent('Target channel legal, ops');
		expect(meta).toHaveTextContent(/Opened .*, 10m ago/);
		expect(meta).toHaveTextContent('HUG ID h-1');
		expect(screen.queryByTestId('not-sent')).toBeNull();
	});

	it("the workflow: the team and version, the Hug's phase highlighted, a phase opens its output", async () => {
		const calls = route_fetch(hug(), {
			'/v1/run_detail/get': () => ({ body: { ok: true, data: { phase_outputs: [{ artifact_id: 'o1', phase: 'draft', created_at: null, raw: 'Plan drafted', complete: true,
				view: { kind: 'text', summary: 'Plan drafted', body_markdown: 'Plan drafted for **review**', steps: [], verdict: null, commands: null, sources: [], sub_run: null } }] } } }),
		}, { run: RUN });
		render_page();
		const wf = await screen.findByRole('region', { name: 'Workflow' });
		expect(within(wf).getByTestId('hug-team')).toHaveTextContent('@cliq/feature-dev-js v1.4.0');
		expect(within(wf).getByRole('button', { name: /^approve,/ })).toHaveAttribute('aria-label', expect.stringContaining('waiting'));
		fireEvent.click(within(wf).getByRole('button', { name: /^draft,/ }));
		expect(await within(wf).findByTestId('phase-output')).toHaveTextContent('Plan drafted for review');
		expect(calls.find((c) => c.url === '/v1/run_detail/get')?.body).toEqual({ run_id: 'run-1841' });
	});

	it('state 1 — answering: one sandboxed frame from the content origin, given the Hug, its params, slots and attachments', async () => {
		route_fetch(hug());
		render_page();
		const answer = await screen.findByRole('region', { name: 'Your response' });
		const frame = within(answer).getByTestId('hug-frame').querySelector('iframe')!;
		expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
		expect(frame).toHaveAttribute('src', CONTENT);
		expect(hosts).toHaveLength(1);
		const init = hosts[0]!.opts.init;
		expect(init).toMatchObject({
			mode: 'answer', mine: null, viewing: null, draft: null,
			hug: { id: 'h-1', name: 'approval', title: 'Review: approve', summary: 'Approve the plan before it ships.', status: 'open', run: { id: 'run-1841', name: 'quiet-amber-heron' } },
			params: hug().params, files: hug().files, attachments: hug().attachments, viewer: { name: 'Ann', via: ['ops'] },
		});
		expect(init.theme).toMatchObject({ scheme: expect.stringMatching(/light|dark/) });
	});

	it("Submit is the Hub's: the hug's label and tone, enabled only when valid, a problem count; it sends the values and summary", async () => {
		let stale = 0;
		window.addEventListener(OVERVIEW_STALE_EVENT, () => { stale += 1; });
		const calls = route_fetch(hug(), { '/v1/hugs/respond': () => ({ body: { ok: true, data: { response_id: 'r1', seq: 1 } } }) });
		render_page();
		await screen.findByRole('region', { name: 'Your response' });
		const submit = screen.getByTestId('hug-submit');
		expect(submit).toBeDisabled();
		act(() => hosts[0]!.state({ values: { decision: 'reject' }, valid: false, problems: [{ message: 'Say why' }], submit: { label: 'Reject', tone: 'danger' } }));
		expect(submit).toHaveTextContent('Reject');
		expect(submit).toBeDisabled();
		expect(screen.getByTestId('hug-problems')).toHaveTextContent('1 problem');
		act(() => hosts[0]!.state({ values: { decision: 'reject', reason: 'too risky' }, valid: true, submit: { label: 'Reject', tone: 'danger' }, summary: 'Rejected' }));
		expect(submit).toBeEnabled();
		fireEvent.click(submit);
		expect(await screen.findByTestId('hug-sent')).toHaveTextContent('Response submitted. You can change it while the Hug is open.');
		expect(calls.find((c) => c.url === '/v1/hugs/respond')?.body).toEqual({ hug_id: 'h-1', values: { decision: 'reject', reason: 'too risky' }, summary: 'Rejected' });
		expect(stale).toBeGreaterThan(0);
		// State 2 right after Submit: the answer as sent, Change answer, the next steps.
		expect(screen.getByTestId('hug-change')).toBeInTheDocument();
		expect(screen.queryByTestId('hug-submit')).toBeNull();
		expect(screen.getByTestId('hug-next')).toBeInTheDocument();
	});

	it("Core's refusal is shown by Submit; the answer stays to fix", async () => {
		route_fetch(hug(), { '/v1/hugs/respond': () => ({ status: 422, body: { ok: false, error: { code: 'HUG_FILE_INVALID', message: 'evidence: file f-1 was not uploaded by you' } } }) });
		render_page();
		await screen.findByRole('region', { name: 'Your response' });
		act(() => hosts[0]!.state({ values: { decision: 'approve' }, valid: true }));
		fireEvent.click(screen.getByTestId('hug-submit'));
		expect(await screen.findByTestId('hug-error')).toHaveTextContent('evidence: file f-1 was not uploaded by you');
		expect(screen.getByTestId('hug-submit')).toBeInTheDocument();
	});

	it('states 2 and 3: my answer is shown as sent; Change answer edits it from mine; Cancel goes back — one frame, one mode message each', async () => {
		const mine = response();
		route_fetch(hug({ responses: [mine] }));
		render_page();
		await screen.findByRole('region', { name: 'Your response' });
		expect(hosts[0]!.opts.init).toMatchObject({ mode: 'view', mine: { values: { decision: 'approve' }, summary: 'Approved' }, viewing: { values: { decision: 'approve' } } });
		expect(screen.getByTestId('hug-bar')).toHaveTextContent(/Submitted .*Change answer/);
		fireEvent.click(screen.getByTestId('hug-change'));
		expect(hosts[0]!.modes.at(-1)).toEqual({ mode: 'answer', viewing: undefined });
		expect(screen.getByTestId('hug-submit')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(hosts[0]!.modes.at(-1)).toMatchObject({ mode: 'view', viewing: { values: { decision: 'approve' } } });
		expect(hosts).toHaveLength(1);
	});

	it("others who responded: one quiet line built from their answers' summaries", async () => {
		route_fetch(hug({ responses: [response({ response_id: 'r2', responder: { user_id: 'u2', name: 'Bo' }, summary: 'Rejected' }), response({ response_id: 'r3', responder: { user_id: 'u3', name: 'Cy' }, summary: undefined })] }));
		render_page();
		expect(await screen.findByTestId('others-responded')).toHaveTextContent(/Bo responded: Rejected, 2m ago · Cy responded, 2m ago/);
	});

	it('a draft is kept per viewer and Hug while answering, given back on return, and dropped after Submit', async () => {
		route_fetch(hug(), { '/v1/hugs/respond': () => ({ body: { ok: true, data: { response_id: 'r1' } } }) });
		const first = render_page();
		await screen.findByRole('region', { name: 'Your response' });
		act(() => hosts[0]!.state({ values: { decision: 'approve', note: 'half' }, valid: true }));
		first.unmount();
		hosts.length = 0;
		render_page();
		await screen.findByRole('region', { name: 'Your response' });
		expect(hosts[0]!.opts.init.draft).toEqual({ decision: 'approve', note: 'half' });
		act(() => hosts[0]!.state({ values: { decision: 'approve' }, valid: true }));
		fireEvent.click(screen.getByTestId('hug-submit'));
		await screen.findByTestId('hug-sent');
		expect(localStorage.getItem('hug-draft:u1:h-1')).toBeNull();
	});

	it("state 4 — a Hug that wasn't sent to me (viewer.can_answer false): read-only from the start — no answer frame, no Submit", async () => {
		const calls = route_fetch(hug({ viewer: { can_answer: false, via: [] }, responses: [response({ response_id: 'r2', responder: { user_id: 'u2', name: 'Bo' } })] }));
		render_page();
		const four = await screen.findByTestId('not-for-you');
		expect(four).toHaveTextContent('Only people this Hug was sent to can answer it (legal, ops).');
		expect(screen.queryByRole('region', { name: 'Your response' })).toBeNull();
		expect(screen.queryByTestId('hug-submit')).toBeNull();
		expect(screen.queryByTestId('hug-change')).toBeNull();
		expect(hosts.map((h) => h.opts.init.mode)).toEqual(['view']);
		expect(calls.some((c) => c.url === '/v1/hugs/respond')).toBe(false);
	});

	it('state 4 with no answers yet says so', async () => {
		route_fetch(hug({ viewer: { can_answer: false, via: [] } }));
		render_page();
		expect(await screen.findByTestId('not-for-you')).toHaveTextContent('No answers yet.');
		expect(hosts).toHaveLength(0);
	});

	it("Core still refusing at Submit (its view changed while the page was open) switches to read-only", async () => {
		route_fetch(hug({ responses: [response({ response_id: 'r2', responder: { user_id: 'u2', name: 'Bo' } })] }), {
			'/v1/hugs/respond': () => ({ status: 403, body: { ok: false, error: { code: 'forbidden', message: 'This Hug was not sent to you' } } }),
		});
		render_page();
		await screen.findByRole('region', { name: 'Your response' });
		act(() => hosts[0]!.state({ values: { decision: 'approve' }, valid: true }));
		fireEvent.click(screen.getByTestId('hug-submit'));
		const four = await screen.findByTestId('not-for-you');
		expect(four).toHaveTextContent('Only people this Hug was sent to can answer it (legal, ops).');
		expect(within(four).getAllByTestId('hug-response')).toHaveLength(1);
		expect(hosts.at(-1)!.opts.init).toMatchObject({ mode: 'view', viewing: { responder: { name: 'Bo' } } });
	});

	it('state 5 — ended: how, and every answer (mine first) in its own view frame, loaded as it scrolls into view; nothing to submit', async () => {
		const bo = response({ response_id: 'r2', responder: { user_id: 'u2', name: 'Bo' }, summary: 'Rejected', values: { decision: 'reject', reason: 'p99' } });
		route_fetch(hug({ status: 'closed', outcome: 'Rejected', closed_at: new Date().toISOString(), responses: [bo, response()], not_sent_to: [{ name: 'kai', channel: 'legal' }] }));
		render_page();
		const outcome = await screen.findByRole('region', { name: 'Outcome' });
		expect(outcome).toHaveTextContent('Rejected · This Hug no longer takes responses.');
		const rows = within(outcome).getAllByTestId('hug-response');
		expect(rows[0]).toHaveTextContent('Ann (you)');
		expect(within(rows[1]!).getByTestId('hug-decision')).toHaveTextContent('Rejected');
		expect(hosts.map((h) => [h.opts.init.mode, h.opts.init.viewing.responder.name, h.opts.loading])).toEqual([['view', 'Ann', 'lazy'], ['view', 'Bo', 'lazy']]);
		expect(screen.queryByTestId('hug-submit')).toBeNull();
		expect(screen.getByTestId('not-sent')).toHaveTextContent('Not sent to kai (via legal)');
		expect(within(outcome).getByRole('link', { name: 'Back to the run' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-1841');
	});

	it('the fallback view — no frame (a Hug opened before hugs, or its bundle is gone): answers as key-values, nothing to answer', async () => {
		const old = response({ values: { release: 'autumn', contract: { artifact_id: 'a-9', name: 'MSA.pdf', size: 1, content_type: 'application/pdf' } }, summary: undefined });
		route_fetch(hug({ hug: null, responses: [old] }), {}, { content_url: null });
		render_page();
		const fb = await screen.findByTestId('hug-fallback');
		expect(fb).toHaveTextContent("This Hug’s page is no longer available.");
		const values = within(fb).getByTestId('hug-values');
		expect(values).toHaveTextContent('releaseautumn');
		expect(within(values).getByRole('link', { name: 'MSA.pdf' })).toHaveAttribute('href', expect.stringContaining('a-9'));
		expect(hosts).toHaveLength(0);
		expect(screen.queryByRole('region', { name: 'Your response' })).toBeNull();
	});

	it("the frame's requests go through the Hub: a read is a download with the viewer's permissions; a link not in the params is confirmed first", async () => {
		const calls = route_fetch(hug(), { '/v1/artifacts/download': () => ({ body: 'file bytes' }) });
		render_page();
		await screen.findByRole('region', { name: 'Your response' });
		const blob = await hosts[0]!.opts.read({ artifact_id: 'a-1', name: 'design.md' });
		expect(blob).toBeInstanceOf(Blob);
		expect(calls.find((c) => c.url === '/v1/artifacts/download')?.body).toEqual({ artifact_id: 'a-1' });
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
		hosts[0]!.opts.open_link('https://listed.example/x', true);
		hosts[0]!.opts.open_link('https://evil.example/y', false);
		expect(confirm).toHaveBeenCalledWith(expect.stringContaining('https://evil.example/y'));
		expect(open.mock.calls.map((c) => c[0])).toEqual(['https://listed.example/x']);
	});

	it("the frame gets the Hub's colours from where Graphite defines them (.theme-graphite), as the kit's tokens", async () => {
		const { hub_theme } = await import('@/components/hug/hug_host');
		const shell = document.createElement('div');
		shell.className = 'theme-graphite';
		shell.style.setProperty('--g-line', '#26282d');
		shell.style.setProperty('--g-ink-2', '#a2a2ad');
		const inside = document.createElement('div');
		shell.append(inside);
		document.body.append(shell);
		expect(hub_theme(inside).tokens).toMatchObject({ '--cliq-line': '#26282d', '--cliq-ink-2': '#a2a2ad' });
		expect(hub_theme(document.documentElement).tokens).not.toHaveProperty('--cliq-line');
		shell.remove();
	});

	it('a refused read is read_denied', async () => {
		route_fetch(hug(), { '/v1/artifacts/download': () => ({ status: 403, body: { ok: false } }) });
		render_page();
		await screen.findByRole('region', { name: 'Your response' });
		await waitFor(async () => expect(await hosts[0]!.opts.read({ artifact_id: 'a-2', name: 'x' })).toBe('read_denied'));
	});
});
