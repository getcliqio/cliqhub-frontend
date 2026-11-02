/**
 * Hug page (/hugs/:hug_id), top to bottom: the review card (one metadata line, title, prompt), the
 * run's workflow graph (team and version; a phase opens its output), the context, and the response,
 * rendered by the Hug's template (PLAN-hug-templates §3): `approval` — Approve (Required then
 * Optional, a comment) or Reject (a reason and a choice, no inputs required); `form` — the inputs, or
 * Can't answer with a reason. Checked before sending, Core's problems per key; changing a response,
 * others' responses, files (streamed upload with progress and retry), a Hug that has ended, and a
 * template the page doesn't know.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { single_org_overview, gs_response } from './fixtures_overview';
import type { Hug, Hug_run } from '@/lib/hug';
import { OVERVIEW_STALE_EVENT } from '@/lib/overview';

const auth = {
	user: { id: 'u1', username: 'ann', display_name: 'Ann', email: 'a@x.com', role: 'user' as const, preferences: {} },
	loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as HugPage } from '@/pages/hugs/hug_page';

const soon = () => new Date(Date.now() + 3_600_000).toISOString();

const PARAMS = {
	prompt: 'Please review the **plan**.',
	context: [
		{ type: 'markdown', text: 'The plan, ready for review.' },
		{ type: 'checks', results: [{ name: 'npm test', ok: true, summary: '412 passed' }, { name: 'lint', ok: false }] },
		{ type: 'artifact', artifact_id: 'a-1', label: 'design.md' },
	],
	inputs: [{ name: 'risk', type: 'number', min: 1, max: 5 }],
	reject_choices: [{ value: 'draft', label: 'Send back to draft' }],
};

/** An `approval` Hug (the gate's), `params` merged over the defaults. */
function hug(over: Partial<Hug> = {}, params: Record<string, unknown> = {}): Hug {
	return {
		id: 'h-1', hug_url: 'https://hub/hugs/h-1', run_id: 'run-1841', run_name: 'quiet-amber-heron', team: '@cliq/feature-dev-js', phase: 'approve', iteration: 0,
		realm_id: 'r-prod', realm_name: 'Prod US', realm_slug: 'prod-us', org_slug: 'measureone',
		title: 'Review: approve', template: 'approval', template_version: 1, params: { ...PARAMS, ...params },
		channels: ['legal', 'ops'], status: 'open', outcome: null,
		expires_at: soon(), created_at: new Date(Date.now() - 600_000).toISOString(), closed_at: null, last_reminded_at: null,
		not_sent_to: [], responses: [],
		...over,
	};
}

type Handler = (body: Record<string, unknown>) => { status?: number; body: unknown };

const RUN: Hug_run = {
	run_id: 'run-1841', run_name: 'quiet-amber-heron', state: 'awaiting_input', team_label: '@cliq/feature-dev-js', team_version: '1.4.0',
	phases: [
		{ name: 'draft', type: 'standard', agent: 'claude-code', status: 'completed', depends_on: [] },
		{ name: 'approve', type: 'gate', agent: 'hug', status: 'awaiting_input', depends_on: ['draft'] },
		{ name: 'ship', type: 'standard', agent: 'exec', status: 'pending', depends_on: ['approve'] },
	],
};

function route_fetch(h: Hug, extra: Record<string, Handler> = {}, run_of: Hug_run | null = null) {
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
		calls.push({ url: u, body });
		if (extra[u]) { const r = extra[u](body); return new Response(JSON.stringify(r.body), { status: r.status ?? 200 }); }
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: single_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/hug_page/get') return new Response(JSON.stringify({ ok: true, data: { hug: h, run: run_of ?? null } }));
		if (u === '/v1/artifacts/get_by_id') return new Response(JSON.stringify({ ok: true, data: { name: 'design.md', mime_type: 'text/markdown', size_bytes: 20 } }));
		if (u === '/v1/artifacts/download?artifact_id=a-1') return new Response('# Design\n\nQueues.');
		throw new Error(`unexpected ${u}`);
	});
	return calls;
}

function render_page(id = 'h-1') {
	return render(<MemoryRouter initialEntries={[`/hugs/${id}`]}><Routes><Route path="/hugs/:hug_id" element={<HugPage />} /></Routes></MemoryRouter>);
}

describe('Hug page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('shows the question and its context: markdown, checks, and a file previewed inline with a download link', async () => {
		const calls = route_fetch(hug());
		render_page();
		expect(await screen.findByRole('heading', { level: 1, name: 'Review: approve' })).toBeInTheDocument();
		expect(calls.find((c) => c.url === '/v1/hug_page/get')?.body).toEqual({ hug_id: 'h-1' });
		expect(screen.getByRole('region', { name: 'Review' })).toHaveTextContent('Please review the plan.');
		const context = screen.getByRole('region', { name: 'Context' });
		expect(within(context).getByRole('region', { name: 'Checks' })).toHaveTextContent('1 of 2 passed');
		// Files are listed, not previewed — a single one too; nothing is downloaded yet.
		const file = await within(within(context).getByRole('region', { name: 'Files' })).findByRole('listitem', { name: 'File design.md' });
		expect(await within(file).findByRole('button', { name: 'Preview' })).toHaveAttribute('aria-haspopup', 'dialog');
		expect(within(file).getByRole('link', { name: 'Download design.md' })).toHaveAttribute('href', '/v1/artifacts/download?artifact_id=a-1');
		expect(within(file).getByRole('button', { name: 'Open design.md in a new tab' })).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Design' })).toBeNull();
		expect(calls.some((c) => c.url.startsWith('/v1/artifacts/download'))).toBe(false);
		// Without the run (an older BFF, or it couldn't be read) the graph is left out.
		expect(screen.queryByRole('region', { name: 'Workflow' })).toBeNull();
	});

	it('several files: one compact list; Preview opens a dialog — ‹ › step through, Esc closes; a file is fetched only when shown', async () => {
		const calls = route_fetch(hug({}, { context: [
			{ type: 'artifact', artifact_id: 'a-1', label: 'design.md' },
			{ type: 'markdown', text: 'Not attached: missing.pdf (no matching file)' },
			{ type: 'artifact', artifact_id: 'a-2', label: 'notes.md' },
		] }), { '/v1/artifacts/download?artifact_id=a-2': () => ({ body: '# Notes' }) });
		render_page();
		const files = await screen.findByRole('region', { name: 'Files' });
		const rows = within(files).getAllByRole('listitem');
		expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['File design.md', 'File notes.md']);
		// The list sits where the first file was, before the note.
		expect(files.compareDocumentPosition(screen.getByRole('region', { name: 'Note' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		fireEvent.click(await within(rows[0]!).findByRole('button', { name: 'Preview' }));
		const dialog = screen.getByRole('dialog', { name: 'Preview design.md' });
		expect(await within(dialog).findByRole('heading', { name: 'Design' })).toBeInTheDocument();
		expect(within(dialog).getByText('1 of 2')).toBeInTheDocument();
		expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
		expect(calls.filter((c) => c.url.startsWith('/v1/artifacts/download')).map((c) => c.url)).toEqual(['/v1/artifacts/download?artifact_id=a-1']);
		fireEvent.click(within(dialog).getByRole('button', { name: 'Next file' }));
		const next = screen.getByRole('dialog', { name: 'Preview notes.md' });
		await waitFor(() => expect(next).toHaveTextContent('# Notes'));
		fireEvent.keyDown(window, { key: 'ArrowLeft' });
		expect(screen.getByRole('dialog', { name: 'Preview design.md' })).toBeInTheDocument();
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('a PDF is shown from an in-memory copy (Core sends files as attachments, which a frame would download)', async () => {
		const create = vi.fn(() => 'blob:hub/pdf-1');
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
		route_fetch(hug({}, { context: [{ type: 'artifact', artifact_id: 'a-1', label: 'MSA.pdf' }] }), {
			'/v1/artifacts/get_by_id': () => ({ body: { ok: true, data: { name: 'MSA.pdf', mime_type: 'application/pdf', size_bytes: 4 } } }),
			'/v1/artifacts/download?artifact_id=a-1': () => ({ body: '%PDF' }),
		});
		render_page();
		fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
		const frame = await within(screen.getByRole('dialog')).findByTitle('MSA.pdf');
		expect(frame).toHaveAttribute('src', 'blob:hub/pdf-1');
		expect((create.mock.calls[0] as unknown as [Blob])[0].type).toBe('application/pdf');
		vi.unstubAllGlobals();
	});

	it('Open in new tab: the tab opens on the click and shows an in-memory copy, text as plain text; never for SVG or HTML', async () => {
		vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:hub/txt-1'), revokeObjectURL: vi.fn() }));
		const tab = { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
		const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
		const metas: Record<string, { name: string; mime_type: string }> = {
			'a-1': { name: 'review.txt', mime_type: 'text/plain' }, 'a-2': { name: 'logo.svg', mime_type: 'image/svg+xml' }, 'a-3': { name: 'page.html', mime_type: 'text/html' },
		};
		route_fetch(hug({}, { context: Object.keys(metas).map((id) => ({ type: 'artifact' as const, artifact_id: id })) }), {
			'/v1/artifacts/get_by_id': (b) => ({ body: { ok: true, data: { ...metas[String(b.artifact_id)], size_bytes: 10 } } }),
			'/v1/artifacts/download?artifact_id=a-1': () => ({ body: 'Hi Ada' }),
		});
		render_page();
		const files = await screen.findByRole('region', { name: 'Files' });
		await within(files).findAllByRole('button', { name: 'Preview' }).then((b) => expect(b).toHaveLength(3));
		expect(within(files).queryByRole('button', { name: 'Open logo.svg in a new tab' })).toBeNull();
		expect(within(files).queryByRole('button', { name: 'Open page.html in a new tab' })).toBeNull();
		fireEvent.click(within(files).getByRole('button', { name: 'Open review.txt in a new tab' }));
		expect(open).toHaveBeenCalledWith('', '_blank');
		await waitFor(() => expect(tab.location.href).toBe('blob:hub/txt-1'));
		expect(tab.opener).toBeNull();
		expect(((URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [Blob])[0].type).toBe('text/plain;charset=utf-8');
		vi.unstubAllGlobals();
	});

	it('top to bottom: review card, workflow, context, then the response — Submit response last', async () => {
		route_fetch(hug(), {}, RUN);
		render_page();
		await screen.findByRole('region', { name: 'Workflow' });
		const order = ['Review', 'Workflow', 'Context', 'Your response'].map((n) => screen.getByRole('region', { name: n }));
		for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		const buttons = within(screen.getByRole('region', { name: 'Your response' })).getAllByRole('button');
		expect(buttons.at(-1)).toHaveTextContent('Submit response');
	});

	it('one metadata line: target channel, opened, expires and the HUG ID; "not sent to" only when it happened', async () => {
		route_fetch(hug());
		render_page();
		const meta = await screen.findByTestId('hug-meta');
		expect(meta).toHaveTextContent('Target channel legal, ops');
		expect(meta).toHaveTextContent(/Opened .*, 10m ago/);
		expect(meta).toHaveTextContent(/Expires .*, in 1h 0m|in 59m/);
		expect(meta).toHaveTextContent('HUG ID h-1');
		expect(within(meta).getByRole('button', { name: 'Copy HUG ID' })).toBeInTheDocument();
		expect(screen.queryByTestId('not-sent')).toBeNull();
	});

	it("the workflow: the team and version, the Hug's phase highlighted, a phase opens its output", async () => {
		const calls = route_fetch(hug(), {
			'/v1/run_detail/get': () => ({ body: { ok: true, data: { phase_outputs: [{ artifact_id: 'o1', phase: 'draft', created_at: null, raw: 'Plan drafted', complete: true,
				view: { kind: 'text', summary: 'Plan drafted', body_markdown: 'Plan drafted for **review**', steps: [], verdict: null, commands: null, sources: [], sub_run: null } }] } } }),
		}, RUN);
		render_page();
		const wf = await screen.findByRole('region', { name: 'Workflow' });
		expect(within(wf).getByTestId('hug-team')).toHaveTextContent('@cliq/feature-dev-js v1.4.0');
		expect(within(wf).getByRole('link', { name: 'Open run' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-1841');
		expect(within(wf).getByRole('button', { name: /^approve,/ })).toHaveAttribute('aria-label', expect.stringContaining('waiting'));
		expect(calls.some((c) => c.url === '/v1/run_detail/get')).toBe(false);
		fireEvent.click(within(wf).getByRole('button', { name: /^draft,/ }));
		expect(await within(wf).findByTestId('phase-output')).toHaveTextContent('Plan drafted for review');
		expect(calls.find((c) => c.url === '/v1/run_detail/get')?.body).toEqual({ run_id: 'run-1841' });
	});

	it('approval: Approve or Reject first; Approve shows the inputs Required then Optional, with a comment', async () => {
		route_fetch(hug());
		render_page();
		const form = await screen.findByRole('form', { name: 'Your response' });
		const decision = within(form).getByRole('radiogroup', { name: 'Decision' });
		expect(within(decision).getByRole('radio', { name: 'Approve' })).toBeChecked();
		expect(within(decision).getByRole('radio', { name: 'Reject' })).not.toBeChecked();
		const required = within(form).getByRole('group', { name: 'Required' });
		const optional = within(form).getByRole('group', { name: 'Optional' });
		expect(within(required).getByRole('spinbutton')).toBeInTheDocument();
		expect(within(optional).getByRole('textbox', { name: /Comment/ })).toBeInTheDocument();
		expect(within(form).getByTestId('response-hint')).toHaveTextContent('1 required left');
	});

	it("approval's options: its own labels, and no comment box with show_comment: false", async () => {
		route_fetch(hug({}, { approve_label: 'Ship it', reject_label: 'Hold', show_comment: false }));
		render_page();
		const form = await screen.findByRole('form', { name: 'Your response' });
		expect(within(form).getByRole('radio', { name: 'Ship it' })).toBeInTheDocument();
		expect(within(form).getByRole('radio', { name: 'Hold' })).toBeInTheDocument();
		expect(within(form).queryByRole('textbox', { name: /Comment/ })).toBeNull();
	});

	it('Reject asks no inputs: a reason (required) and a choice, and sends only those', async () => {
		const calls = route_fetch(hug(), { '/v1/hugs/respond': () => ({ body: { ok: true, data: { response_id: 'r1', seq: 1 } } }) });
		render_page();
		const form = await screen.findByRole('form', { name: 'Your response' });
		fireEvent.click(within(form).getByRole('radio', { name: 'Reject' }));
		expect(within(form).queryByRole('spinbutton')).toBeNull();
		fireEvent.click(within(form).getByRole('button', { name: 'Submit response' }));
		expect(await within(form).findByText('required')).toBeInTheDocument();
		expect(calls.some((c) => c.url === '/v1/hugs/respond')).toBe(false);
		fireEvent.click(within(form).getByRole('radio', { name: 'Send back to draft' }));
		fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: 'p99 regression' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Submit response' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/hugs/respond')?.body).toEqual({
			hug_id: 'h-1', values: { decision: 'reject', reason: 'p99 regression', choice: 'draft' },
		}));
	});

	it('checks before sending, then sends the approval with its inputs and comment', async () => {
		const calls = route_fetch(hug(), { '/v1/hugs/respond': () => ({ body: { ok: true, data: { response_id: 'r1', seq: 1 } } }) });
		const stale = vi.fn();
		window.addEventListener(OVERVIEW_STALE_EVENT, stale);
		render_page();
		const form = await screen.findByRole('form', { name: 'Your response' });
		expect(within(form).getAllByRole('textbox')).toHaveLength(1); // the comment box only
		fireEvent.click(within(form).getByRole('button', { name: 'Submit response' }));
		expect(await within(form).findAllByText('required')).toHaveLength(1); // risk
		expect(calls.some((c) => c.url === '/v1/hugs/respond')).toBe(false);

		fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '9' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Submit response' }));
		expect(await within(form).findByText('must be at most 5')).toBeInTheDocument();

		fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '2' } });
		fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'needs more tests' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Submit response' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/hugs/respond')?.body).toEqual({
			hug_id: 'h-1', values: { decision: 'approve', risk: 2, comment: 'needs more tests' },
		}));
		// Sent: the nav's HUG count reloads (only after Core accepted it).
		await waitFor(() => expect(stale).toHaveBeenCalledTimes(1));
		window.removeEventListener(OVERVIEW_STALE_EVENT, stale);
		expect(await screen.findByRole('status')).toHaveTextContent('Response submitted.');
		// Then a way back: the run first, or the other Hugs.
		const next = screen.getByTestId('hug-next');
		expect(within(next).getByRole('link', { name: 'Back to the run' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-1841');
		expect(within(next).getByRole('link', { name: /^All HUGs/ })).toHaveAttribute('href', '/hugs');
	});

	it("shows Core's refusal next to the input it is about", async () => {
		route_fetch(hug(), { '/v1/hugs/respond': () => ({ status: 422, body: { ok: false, error: { code: 'invalid_values', message: 'risk: must be even' } } }) });
		render_page();
		const form = await screen.findByRole('form', { name: 'Your response' });
		fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '1' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Submit response' }));
		expect(await within(form).findByText('must be even')).toBeInTheDocument();
	});

	it('my earlier response fills the form and can be changed; others who responded show in one line', async () => {
		const mine = { response_id: 'r1', responder: { user_id: 'u1', name: 'Ann' }, via: ['legal'], values: { decision: 'approve', risk: 3, comment: 'LGTM' }, responded_at: new Date().toISOString() };
		route_fetch(hug({ responses: [mine] }));
		render_page();
		const form = await screen.findByRole('form', { name: 'Your response' });
		expect(within(form).getByRole('radio', { name: 'Approve' })).toBeChecked();
		expect(within(form).getByRole('spinbutton')).toHaveValue(3);
		expect(within(form).getByRole('textbox', { name: /Comment/ })).toHaveValue('LGTM');
		expect(within(form).getByRole('button', { name: 'Update response' })).toBeInTheDocument();
		expect(screen.queryByTestId('others-responded')).toBeNull(); // only my own so far
	});

	it('others who already responded: one quiet line above the form', async () => {
		const bo = { response_id: 'r2', responder: { user_id: 'u2', name: 'Bo' }, via: ['ops'], values: { decision: 'reject', reason: 'Not yet', choice: 'draft' }, responded_at: new Date(Date.now() - 300_000).toISOString() };
		route_fetch(hug({ responses: [bo] }));
		render_page();
		expect(await screen.findByTestId('others-responded')).toHaveTextContent('Bo responded: Rejected — Send back to draft, 5m ago');
	});

	it("a form Hug: no decision; Can't answer sends only a reason", async () => {
		const calls = route_fetch(hug({ template: 'form' }, { reject_choices: undefined }), { '/v1/hugs/respond': () => ({ body: { ok: true, data: {} } }) });
		render_page();
		const form = await screen.findByRole('form', { name: 'Your response' });
		expect(within(form).queryByRole('radiogroup', { name: 'Decision' })).toBeNull();
		fireEvent.click(within(form).getByRole('button', { name: 'Can’t answer' }));
		fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Not my area' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Submit response' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/hugs/respond')?.body).toEqual({ hug_id: 'h-1', values: { declined: 'Not my area' } }));
	});

	it('a template the page does not know is shown as such; nothing can be sent', async () => {
		route_fetch(hug({ template: 'survey', template_version: 3 }));
		render_page();
		expect(await screen.findByRole('alert')).toHaveTextContent('This Hug uses a template this page can’t show (survey@3).');
		expect(screen.queryByRole('button', { name: 'Submit response' })).toBeNull();
	});

	it('an ended Hug shows each response with its decision and words', async () => {
		const bo = { response_id: 'r2', responder: { user_id: 'u2', name: 'Bo' }, via: ['ops'], values: { decision: 'reject', reason: 'p99 regression', choice: 'draft' }, responded_at: new Date().toISOString() };
		route_fetch(hug({ status: 'closed', outcome: 'Rejected', closed_at: new Date().toISOString(), responses: [bo] }));
		render_page();
		const r = await screen.findByTestId('hug-response');
		expect(within(r).getByTestId('hug-decision')).toHaveTextContent('Rejected — Send back to draft');
		expect(r).toHaveTextContent('p99 regression');
	});

	it('an ended Hug shows how it ended and takes no answers; people it was not sent to are named', async () => {
		route_fetch(hug({ status: 'closed', outcome: 'Approved', closed_at: new Date().toISOString(), not_sent_to: [{ name: 'kai', channel: 'legal' }] }));
		render_page();
		expect(await screen.findByRole('region', { name: 'Outcome' })).toHaveTextContent('Approved');
		expect(screen.queryByRole('form', { name: 'Your response' })).toBeNull();
		expect(screen.getByTestId('not-sent')).toHaveTextContent('Not sent to kai (via legal)');
		expect(screen.getByTestId('hug-meta')).toHaveTextContent(/Ended .*ago/);
		expect(within(screen.getByRole('region', { name: 'Outcome' })).getByRole('link', { name: 'Back to the run' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-1841');
	});
});

/** A fake XMLHttpRequest the test drives (uploads). */
class Fake_xhr {
	static all: Fake_xhr[] = [];
	upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	onabort: (() => void) | null = null;
	status = 0;
	responseText = '';
	url = '';
	withCredentials = false;
	constructor() { Fake_xhr.all.push(this); }
	open(_m: string, url: string) { this.url = url; }
	setRequestHeader() {}
	send() {}
	abort() { this.onabort?.(); }
	reply(status: number, body: unknown) { this.status = status; this.responseText = JSON.stringify(body); this.onload?.(); }
}

describe('Hug page — files', () => {
	afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Fake_xhr.all = []; });

	it('a picked file streams up with progress; a refused upload says why and can be retried; the answer carries the file', async () => {
		vi.stubGlobal('XMLHttpRequest', Fake_xhr);
		const calls = route_fetch(hug({ template: 'form' }, { reject_choices: undefined, inputs: [{ name: 'contract', type: 'file', label: 'Signed contract', accept: ['application/pdf'] }] }), {
			'/v1/hugs/respond': () => ({ body: { ok: true, data: {} } }),
		});
		render_page();
		const form = await screen.findByRole('form', { name: 'Your response' });
		const picker = within(form).getByLabelText('Choose a file');

		fireEvent.change(picker, { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } });
		expect(await within(form).findByText("photo.png isn't one of: application/pdf")).toBeInTheDocument();
		expect(Fake_xhr.all).toHaveLength(0);
		fireEvent.click(within(form).getByRole('button', { name: 'Dismiss' }));

		fireEvent.change(within(form).getByLabelText('Choose a file'), { target: { files: [new File(['%PDF'], 'msa.pdf', { type: 'application/pdf' })] } });
		await waitFor(() => expect(Fake_xhr.all).toHaveLength(1));
		expect(Fake_xhr.all[0]!.url).toBe('/v1/artifacts/upload?hug_id=h-1&requested_input=contract&name=msa.pdf');
		expect(within(form).getByRole('button', { name: 'Submit response' })).toBeDisabled();
		Fake_xhr.all[0]!.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 4 });
		expect(await within(form).findByLabelText('Uploading msa.pdf')).toHaveAttribute('value', '0.25');
		Fake_xhr.all[0]!.reply(413, { ok: false, error: { message: 'File is larger than the 50 MB limit' } });
		expect(await within(form).findByText('File is larger than the 50 MB limit')).toBeInTheDocument();

		fireEvent.click(within(form).getByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(Fake_xhr.all).toHaveLength(2));
		Fake_xhr.all[1]!.reply(201, { ok: true, data: { artifact_id: 'f-9', name: 'msa.pdf', size: 4, content_type: 'application/pdf' } });
		await waitFor(() => expect(within(form).queryByTestId('upload-row')).toBeNull());
		expect(within(form).getByRole('list', { name: 'contract files' })).toHaveTextContent('msa.pdf');
		fireEvent.click(within(form).getByRole('button', { name: 'Submit response' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/hugs/respond')?.body).toEqual({ hug_id: 'h-1', values: { contract: { artifact_id: 'f-9' } } }));
	});
});
