/**
 * Hug page (/hugs/:hug_id): what a person is asked and its context, answering (checked before
 * sending; Core's problems shown per input), changing an answer, files (streamed upload with
 * progress and retry), and a Hug that has ended.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { single_org_overview, gs_response } from './fixtures_overview';
import type { Hug } from '@/lib/hug';

const auth = {
	user: { id: 'u1', username: 'ann', display_name: 'Ann', email: 'a@x.com', role: 'user' as const, preferences: {} },
	loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as HugPage } from '@/pages/hugs/hug_page';

const soon = () => new Date(Date.now() + 3_600_000).toISOString();

function hug(over: Partial<Hug> = {}): Hug {
	return {
		id: 'h-1', hug_url: 'https://hub/hugs/h-1', run_id: 'run-1841', run_name: 'quiet-amber-heron', team: '@cliq/feature-dev-js', phase: 'approve', iteration: 0,
		realm_id: 'r-prod', realm_name: 'Prod US', realm_slug: 'prod-us', org_slug: 'measureone',
		title: 'Review: approve', prompt: 'Please review the **plan**.',
		context: [
			{ type: 'markdown', text: 'The plan, ready for review.' },
			{ type: 'checks', results: [{ name: 'npm test', ok: true, summary: '412 passed' }, { name: 'lint', ok: false }] },
			{ type: 'artifact', artifact_id: 'a-1', label: 'design.md' },
		],
		requested_inputs: [
			{ name: 'decision', type: 'enum', label: 'Decision', required: true, ui: { display: 'buttons' }, choices: [{ value: 'approve', label: 'Approve' }, { value: 'route:draft', label: 'Send back to draft' }, { value: 'reject', label: 'Reject' }] },
			{ name: 'risk', type: 'number', min: 1, max: 5 },
			{ name: 'comment', type: 'text', label: 'Comment', multiline: true, required: false },
		],
		channels: ['legal', 'ops'], ui: { kind: 'gate' }, status: 'open', outcome: null,
		expires_at: soon(), created_at: new Date(Date.now() - 600_000).toISOString(), closed_at: null, last_reminded_at: null,
		not_sent_to: [], responses: [],
		...over,
	};
}

type Handler = (body: Record<string, unknown>) => { status?: number; body: unknown };

function route_fetch(h: Hug, extra: Record<string, Handler> = {}) {
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : {};
		calls.push({ url: u, body });
		if (extra[u]) { const r = extra[u](body); return new Response(JSON.stringify(r.body), { status: r.status ?? 200 }); }
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: single_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/hug_page/get') return new Response(JSON.stringify({ ok: true, data: { hug: h } }));
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
		expect(screen.getByRole('region', { name: 'Question' })).toHaveTextContent('Please review the plan.');
		expect(screen.getByRole('region', { name: 'Checks' })).toHaveTextContent('1 of 2 passed');
		const file = await screen.findByRole('region', { name: 'File design.md' });
		expect(await within(file).findByRole('heading', { name: 'Design' })).toBeInTheDocument();
		expect(within(file).getByRole('link', { name: 'Download' })).toHaveAttribute('href', '/v1/artifacts/download?artifact_id=a-1');
		expect(screen.getByRole('link', { name: 'quiet-amber-heron' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-1841');
	});

	it('says when people were last reminded', async () => {
		route_fetch(hug({ last_reminded_at: new Date(Date.now() - 120_000).toISOString() }));
		render_page();
		expect(await screen.findByText(/reminded 2m ago/)).toBeInTheDocument();
	});

	it('checks before sending, then sends the answer (the comment is an input, so no extra comment box)', async () => {
		const calls = route_fetch(hug(), { '/v1/hugs/respond': () => ({ body: { ok: true, data: { response_id: 'r1', seq: 1 } } }) });
		render_page();
		const form = await screen.findByRole('form', { name: 'Your answer' });
		expect(within(form).getAllByRole('textbox')).toHaveLength(1); // the Comment input only
		fireEvent.click(within(form).getByRole('button', { name: 'Send answer' }));
		expect(await within(form).findAllByText('required')).toHaveLength(2); // decision and risk
		expect(calls.some((c) => c.url === '/v1/hugs/respond')).toBe(false);

		fireEvent.click(within(form).getByRole('radio', { name: 'Send back to draft' }));
		fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '9' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Send answer' }));
		expect(await within(form).findByText('must be at most 5')).toBeInTheDocument();

		fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '2' } });
		fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'needs more tests' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Send answer' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/hugs/respond')?.body).toEqual({
			hug_id: 'h-1', values: { decision: 'route:draft', risk: 2, comment: 'needs more tests' },
		}));
		expect(await screen.findByRole('status')).toHaveTextContent('Sent.');
	});

	it("shows Core's refusal next to the input it is about", async () => {
		route_fetch(hug(), { '/v1/hugs/respond': () => ({ status: 422, body: { ok: false, error: { code: 'invalid_values', message: 'decision: \'maybe\' is not one of the choices' } } }) });
		render_page();
		const form = await screen.findByRole('form', { name: 'Your answer' });
		fireEvent.click(within(form).getByRole('radio', { name: 'Approve' }));
		fireEvent.change(within(form).getByRole('spinbutton'), { target: { value: '1' } });
		fireEvent.click(within(form).getByRole('button', { name: 'Send answer' }));
		expect(await within(form).findByText("'maybe' is not one of the choices")).toBeInTheDocument();
	});

	it('my earlier answer fills the form and can be changed; answers so far are listed', async () => {
		const mine = { response_id: 'r1', responder: { user_id: 'u1', name: 'Ann' }, via: ['legal'], values: { decision: 'approve', risk: 3, comment: 'LGTM' }, comment: null, responded_at: new Date().toISOString() };
		route_fetch(hug({ responses: [mine] }));
		render_page();
		const form = await screen.findByRole('form', { name: 'Your answer' });
		expect(within(form).getByRole('radio', { name: 'Approve' })).toHaveAttribute('aria-checked', 'true');
		expect(within(form).getByRole('spinbutton')).toHaveValue(3);
		expect(within(form).getByRole('button', { name: 'Update answer' })).toBeInTheDocument();
		const answer = screen.getByTestId('hug-response');
		expect(answer).toHaveTextContent('Ann (you)');
		expect(answer).toHaveTextContent('via legal');
		expect(answer).toHaveTextContent('DecisionApprove');
		expect(answer).toHaveTextContent('LGTM');
	});

	it('an ended Hug shows how it ended and takes no answers; people it was not sent to are named', async () => {
		route_fetch(hug({ status: 'closed', outcome: 'Approved', closed_at: new Date().toISOString(), not_sent_to: [{ name: 'kai', channel: 'legal' }] }));
		render_page();
		expect(await screen.findByRole('region', { name: 'Outcome' })).toHaveTextContent('Approved');
		expect(screen.queryByRole('form', { name: 'Your answer' })).toBeNull();
		expect(screen.getByTestId('not-sent')).toHaveTextContent('Not sent to kai (legal)');
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
		const calls = route_fetch(hug({ requested_inputs: [{ name: 'contract', type: 'file', label: 'Signed contract', accept: ['application/pdf'] }] }), {
			'/v1/hugs/respond': () => ({ body: { ok: true, data: {} } }),
		});
		render_page();
		const form = await screen.findByRole('form', { name: 'Your answer' });
		const picker = within(form).getByLabelText('Choose a file');

		fireEvent.change(picker, { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } });
		expect(await within(form).findByText("photo.png isn't one of: application/pdf")).toBeInTheDocument();
		expect(Fake_xhr.all).toHaveLength(0);
		fireEvent.click(within(form).getByRole('button', { name: 'Dismiss' }));

		fireEvent.change(within(form).getByLabelText('Choose a file'), { target: { files: [new File(['%PDF'], 'msa.pdf', { type: 'application/pdf' })] } });
		await waitFor(() => expect(Fake_xhr.all).toHaveLength(1));
		expect(Fake_xhr.all[0]!.url).toBe('/v1/artifacts/upload?hug_id=h-1&requested_input=contract&name=msa.pdf');
		expect(within(form).getByRole('button', { name: 'Send answer' })).toBeDisabled();
		Fake_xhr.all[0]!.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 4 });
		expect(await within(form).findByLabelText('Uploading msa.pdf')).toHaveAttribute('value', '0.25');
		Fake_xhr.all[0]!.reply(413, { ok: false, error: { message: 'File is larger than the 50 MB limit' } });
		expect(await within(form).findByText('File is larger than the 50 MB limit')).toBeInTheDocument();

		fireEvent.click(within(form).getByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(Fake_xhr.all).toHaveLength(2));
		Fake_xhr.all[1]!.reply(201, { ok: true, data: { artifact_id: 'f-9', name: 'msa.pdf', size: 4, content_type: 'application/pdf' } });
		await waitFor(() => expect(within(form).queryByTestId('upload-row')).toBeNull());
		expect(within(form).getByRole('list', { name: 'contract files' })).toHaveTextContent('msa.pdf');
		fireEvent.click(within(form).getByRole('button', { name: 'Send answer' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/hugs/respond')?.body).toEqual({ hug_id: 'h-1', values: { contract: { artifact_id: 'f-9' } } }));
	});
});
