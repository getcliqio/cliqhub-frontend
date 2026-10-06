/** Review packet page: markdown brief, form fields, artifact viewer, verdicts. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview } from './fixtures_overview';
import type { Review_data } from '@/lib/review_packet';
import { coerce_fields, is_missing, normalize_value, parse_checks, parse_csv, artifact_bucket, my_notification_id } from '@/lib/review_packet';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [], loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as ReviewPage } from '@/pages/reviews/review_page';

function review(over: Partial<Review_data> = {}): Review_data {
	return {
		id: 'rv1', run_id: 'run-1', run_name: 'PROJ-482', realm_id: 'r1', realm_name: 'prod-us', realm_slug: 'prod-us', org_slug: 'm1', team: 'measureone/feature-dev-js', phase: 'design-review',
		payload: { upstream_text: '## Approach\n\n- backoff with **jitter**\n\n| Risk | Fix |\n|---|---|\n| dup | idempotency |', iteration: 2, max_iterations: 3, check_results: ['PASS: Design doc present', 'FAIL: No new external deps — adds Redis'], context: [{ role: 'agent', content: 'Iteration 1 was rejected.' }] },
		verdict: null, status: 'pending', route_targets: ['architects'], created_at: new Date(Date.now() - 12 * 60e3).toISOString(), timeout_at: new Date(Date.now() + 36e5).toISOString(), completed_at: null, claimed_by: null, claimed_at: null, message_count: 0,
		artifacts: [
			{ id: 1, phase: 'design-review', kind: 'design', name: 'design.md', mime_type: 'text/markdown', content: '# Payment retry\n\nUse a **queue**.', content_preview: null, sequence: 1 },
			{ id: 2, phase: 'design-review', kind: 'handoff', name: 'plan.json', mime_type: 'application/json', content: '{"attempts":6,"backend":"redis"}', content_preview: null, sequence: 2 },
			{ id: 3, phase: null, kind: 'output', name: 'rows.csv', mime_type: 'text/csv', content: 'id,amount\n1,"1,200"\n2,50', content_preview: null, sequence: 3 },
		],
		notification_groups: [{ group_idx: 0, policy: 'any', channels: ['sapan'], satisfied: false, notifications: [{ id: 'n1', user_id: 'u1', channel_target: 'sapan', responded_at: null }] }],
		...over,
	};
}

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(r: Review_data, extra: Record<string, (b: Record<string, unknown>) => unknown> = {}, phase_outputs?: unknown[]) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/review_page/get') return new Response(JSON.stringify({ ok: true, data: { review: r, org_id: null, ...(phase_outputs ? { phase_outputs } : {}) } }));
		if (extra[u]) return new Response(JSON.stringify({ ok: true, data: extra[u](body) }));
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}
function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }
function open(path = '/reviews/rv1') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/reviews/:review_id" element={<ReviewPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
}
afterEach(() => vi.restoreAllMocks());

describe('Review page', () => {
	it('renders the markdown brief, checks, context and the markdown artifact', async () => {
		route_fetch(review());
		open();
		expect(await screen.findByRole('heading', { name: 'Approach' })).toBeInTheDocument();
		expect(screen.getByText('jitter').tagName).toBe('STRONG');
		expect(screen.getByRole('table')).toBeInTheDocument();
		expect(screen.getByText('1 of 2 passed')).toBeInTheDocument();
		expect(screen.getByText('adds Redis')).toBeInTheDocument();
		expect(screen.getByText('Iteration 1 was rejected.')).toBeInTheDocument();
		const viewer = screen.getByTestId('artifact-viewer');
		expect(within(viewer).getByRole('heading', { name: 'Payment retry' })).toBeInTheDocument();
		expect(screen.getByText(/iteration 2 of 3/)).toBeInTheDocument();
	});

	it('shows earlier phases\' outputs per phase (formatted, with Raw) and keeps files to review in the viewer', async () => {
		const r = review({ artifacts: [
			{ id: 1, phase: 'design-review', kind: 'design', name: 'design.md', mime_type: 'text/markdown', content: '# Payment retry', content_preview: null, sequence: 1 },
			{ id: 4, source: 'record', phase: 'draft', kind: 'output', name: 'phase_output', mime_type: 'application/json', content: '{"text":"Drafted."}', content_preview: null, sequence: 2 },
		] as Review_data['artifacts'] });
		route_fetch(r, {}, [{
			artifact_id: '4', phase: 'draft', created_at: null, raw: '{"text":"Drafted the plan."}', complete: true,
			view: { kind: 'agent', summary: 'Drafted the plan.', body_markdown: 'Drafted the **plan**.', steps: ["I'll read the brief."], verdict: null, commands: null, sources: [], sub_run: null },
		}]);
		open();
		const viewer = await screen.findByTestId('artifact-viewer');
		expect(within(viewer).queryByRole('button', { name: /phase_output/ })).toBeNull();
		const earlier = screen.getByTestId('earlier-phases');
		expect(earlier).toHaveTextContent('Drafted the plan.');
		fireEvent.click(within(earlier).getByRole('button', { name: 'Show output of draft' }));
		expect(within(earlier).getByText('plan').tagName).toBe('STRONG');
		fireEvent.click(within(earlier).getByRole('button', { name: 'Raw' }));
		expect(within(earlier).getByTestId('output-raw')).toHaveTextContent('"text": "Drafted the plan."');
	});

	it('artifact viewer: JSON pretty-prints, Source toggle, CSV as a table', async () => {
		route_fetch(review());
		open();
		const viewer = await screen.findByTestId('artifact-viewer');
		fireEvent.click(within(viewer).getByRole('button', { name: /plan\.json/ }));
		expect(within(viewer).getByText(/"attempts": 6/)).toBeInTheDocument();
		fireEvent.click(within(viewer).getByRole('button', { name: /design\.md/ }));
		fireEvent.click(within(viewer).getByRole('button', { name: 'Source' }));
		expect(within(viewer).getByText('# Payment retry')).toBeInTheDocument();
		fireEvent.click(within(viewer).getByRole('button', { name: /rows\.csv/ }));
		expect(within(viewer).getByRole('columnheader', { name: 'amount' })).toBeInTheDocument();
		expect(within(viewer).getByRole('cell', { name: '1,200' })).toBeInTheDocument();
	});

	it('a file an earlier phase stored is listed and downloads through artifacts/get_by_id', async () => {
		const win = vi.spyOn(window, 'open').mockReturnValue(null);
		const r = review();
		r.artifacts = [...r.artifacts, { id: 'file:a9', source: 'file', artifact_id: 'a9', size_bytes: 4096, phase: 'build', kind: 'file', name: 'app.zip', mime_type: 'application/zip', content: '', content_preview: '', sequence: 1_000_000 }];
		const calls = route_fetch(r, { '/v1/artifacts/get_by_id': () => ({ download_url: 'https://r2.example/app.zip?sig' }) });
		open();
		const viewer = await screen.findByTestId('artifact-viewer');
		fireEvent.click(within(viewer).getByRole('button', { name: /app\.zip/ }));
		expect(within(viewer).getByTestId('artifact-file')).toHaveTextContent('A file the build phase stored (4.0 KB)');
		expect(within(viewer).queryByRole('button', { name: 'Copy' })).toBeNull();
		fireEvent.click(within(viewer).getByRole('button', { name: 'Download' }));
		await waitFor(() => expect(win).toHaveBeenCalledWith('https://r2.example/app.zip?sig', '_blank', 'noopener'));
		expect(calls.filter((c) => c.url === '/v1/artifacts/get_by_id').map((c) => c.body)).toEqual([{ artifact_id: 'a9' }]);
	});

	it('verdict: approve / reject / route send the notification id and comment; then back to the inbox', async () => {
		const calls = route_fetch(review(), { '/v1/reviews/verdict': () => ({}) });
		open();
		fireEvent.change(await screen.findByLabelText('Comment'), { target: { value: 'add a DLQ alert' } });
		fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/reviews/verdict')?.body).toEqual({ review_id: 'rv1', action: 'PASS', fields: { comment: 'add a DLQ alert' }, notification_id: 'n1' }));
		await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/inbox'));
	});

	it('packet form: SDK fields (enum/number/boolean/text); required blocks approve; values go with the verdict', async () => {
		const r = review({ payload: { message: 'Pick a backend', fields: [
			{ name: 'backend', label: 'Queue backend', type: 'enum', options: ['Redis', 'SQS', 'Postgres'], required: true },
			{ name: 'attempts', label: 'Max attempts', type: 'number', default: 6 },
			{ name: 'alert', label: 'Notify on-call', type: 'boolean' },
			{ name: 'notes', label: 'Notes', type: 'text' },
		] } });
		const calls = route_fetch(r, { '/v1/reviews/verdict': () => ({}) });
		open();
		const decision = await screen.findByTestId('decision');
		fireEvent.click(within(decision).getByRole('button', { name: /Approve with these values/ }));
		expect(await within(decision).findByRole('alert')).toHaveTextContent('Queue backend');
		expect(calls.some((c) => c.url === '/v1/reviews/verdict')).toBe(false);
		fireEvent.click(within(decision).getByRole('radio', { name: 'SQS' }));
		fireEvent.click(within(decision).getByRole('switch'));
		fireEvent.change(within(decision).getByLabelText('Notes'), { target: { value: 'we run SQS' } });
		fireEvent.click(within(decision).getByRole('button', { name: /Approve with these values/ }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/reviews/verdict')?.body).toMatchObject({ action: 'PASS', fields: { values: { backend: 'SQS', attempts: 6, alert: true, notes: 'we run SQS' } } }));
	});

	it('input pause: Continue only (no reject/route/comment)', async () => {
		route_fetch(review({ payload: { mode: 'input_pause', summary: 'Need the employer name', fields: [{ name: 'employer_name', type: 'text', required: true }] } }));
		open();
		const decision = await screen.findByTestId('decision');
		expect(within(decision).getByRole('button', { name: /Continue with these values/ })).toBeInTheDocument();
		expect(within(decision).queryByRole('button', { name: /Reject/ })).toBeNull();
		expect(within(decision).queryByLabelText('Comment')).toBeNull();
		expect(screen.getByText('Why the agent paused')).toBeInTheDocument();
	});

	it('decided reviews show the verdict; non-reviewers can look but not decide', async () => {
		route_fetch(review({ status: 'decided', verdict: { action: 'PASS', reviewer_name: 'priya', comment: 'LGTM' } }));
		const { unmount } = open();
		expect(await screen.findByText('Decided: PASS')).toBeInTheDocument();
		expect(screen.queryByTestId('decision')).toBeNull();
		unmount();
		vi.restoreAllMocks();
		route_fetch(review({ notification_groups: [] }));
		open();
		expect(await screen.findByText(/aren’t one of its reviewers/)).toBeInTheDocument();
	});
});

describe('review_packet helpers', () => {
	it('coerce_fields reads both spellings', () => {
		expect(coerce_fields({ inputs_schema: [{ name: 'a', type: 'select', choices: ['x'] }] })[0]).toMatchObject({ type: 'select', choices: ['x'] });
		expect(coerce_fields({ fields: [{ name: 'b', type: 'enum', options: ['y'] }] })[0]).toMatchObject({ type: 'select', choices: ['y'] });
		expect(coerce_fields({ fields: [{ name: 'c', type: 'weird' }, { nope: 1 }] })).toEqual([expect.objectContaining({ name: 'c', type: 'text' })]);
	});
	it('normalize_value / is_missing', () => {
		expect(normalize_value({ name: 'n', type: 'number' }, '7')).toBe(7);
		expect(normalize_value({ name: 'c', type: 'channel' }, 'a, b')).toEqual(['a', 'b']);
		expect(is_missing({ name: 'n', type: 'number', required: true }, 'x')).toBe(true);
		expect(is_missing({ name: 'b', type: 'boolean', required: true }, false)).toBe(false);
	});
	it('parse_checks handles strings and objects', () => {
		expect(parse_checks(['PASS: a', 'FAIL: b — why', { check: 'c', passed: true }])).toEqual([{ name: 'a', ok: true, detail: null }, { name: 'b', ok: false, detail: 'why' }, { name: 'c', ok: true, detail: null }]);
	});
	it('parse_csv handles quotes; buckets by mime and name', () => {
		expect(parse_csv('a,b\n"x, y","z ""q"""')).toEqual([['a', 'b'], ['x, y', 'z "q"']]);
		expect(artifact_bucket('application/octet-stream', 'notes.md')).toBe('markdown');
		expect(artifact_bucket('image/png', 'x')).toBe('image');
	});
	it('my_notification_id prefers an unanswered row', () => {
		const r = { notification_groups: [{ group_idx: 0, policy: 'any', channels: [], satisfied: false, notifications: [{ id: 'old', user_id: 'u', channel_target: 'x', responded_at: 'y' }, { id: 'new', user_id: 'u', channel_target: 'x', responded_at: null }] }] } as unknown as Review_data;
		expect(my_notification_id(r, 'u')).toBe('new');
		expect(my_notification_id(r, 'other')).toBeNull();
	});
});
