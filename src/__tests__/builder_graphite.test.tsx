/** Graphite builder: start screen, canvas edits, keyboard, AI preview, YAML sync, autosave, publish. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { EditorView } from '@codemirror/view';
import { ORG_A, gs_response, multi_org_overview } from './fixtures_overview';
import type { GeneratedTeam } from '@/lib/builder/store';
import { team_files } from '@/lib/builder/publish';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [{ slug: 'measureone', scope_type: 'org' }], loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));
vi.mock('@/lib/org_context', () => ({ useOrgFetch: () => stable_fetch, useOrgOptional: () => null }));

import { Component as BuilderPage } from '@/pages/builder/builder_graphite_page';
import { import_text, template_team, with_starter_roles } from '@/components/gbuilder/gb_start';
import { preview_actions, to_preview } from '@/components/gbuilder/gb_ai_panel';
import { version_clash } from '@/components/gbuilder/gb_publish';
import { cancel_target } from '@/components/gbuilder/gb_app';
import { BUILDER_SESSION_KEYS } from '@/lib/builder/session_restore';

type Call = { url: string; body: Record<string, unknown> };
type Handler = (body: Record<string, unknown>, calls: Call[]) => { status?: number; body: unknown } | undefined;

/** get_by_id's view of a team: its team.yml and role briefs (PLAN-team-bundle S1.5: no canvas JSON). */
const detail_of = (t: GeneratedTeam) => ({ raw_manifest: team_files(t)['team.yml'], roles: t.roles.map((r) => ({ name: r.name, content_md: r.content })) });

const TEAM: GeneratedTeam = {
	name: 'feature-dev', description: 'Ticket to PR', version: '1.0.0',
	phases: [
		{ name: 'design', type: 'standard', agent: 'claude-code', depends_on: [] },
		{ name: 'build', type: 'standard', agent: 'claude-code', depends_on: ['design'] },
		{ name: 'check', type: 'gate', agent: 'claude-code', depends_on: ['build'], commands: [{ name: 'test', run: 'npm test' }], max_iterations: 3 },
	],
	roles: [{ name: 'design', content: '# design\nWrite the design.' }, { name: 'build', content: '# build\nImplement it.' }],
	agents: [],
};

async function read_form(form: FormData) {
	const files: Record<string, string> = {};
	for (const f of form.getAll('files') as File[]) files[f.name] = await f.text();
	return { form, payload: JSON.parse(await (form.get('payload') as Blob).text()), files };
}
/** The uploads made, in order: their payload and files. */
const uploads = (calls: Call[]) => calls.filter((c) => c.url === '/v1/teams/files/upload').map((c) => c.body as { payload: Record<string, unknown>; files: Record<string, string> });

function route_fetch(handlers: Record<string, Handler> = {}) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		// A team-files upload is multipart (PLAN-team-bundle S1.3b): keep its FormData, and read its payload and files.
		const body = init?.body instanceof FormData ? await read_form(init.body) : init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		const key = u === '/v1/teams/build' ? `build:${body.action}` : u;
		const h = handlers[key]?.(body, calls);
		if (h) return new Response(JSON.stringify(h.body), { status: h.status ?? 200 });
		if (u === '/v1/team_list/get') return new Response(JSON.stringify({ ok: true, data: { items: [{ id: 'd1', name: 'loan-review', scope: 'measureone', description: '', status: 'draft', latest_version: null, author: 'sapan', phase_types: ['standard', 'gate'], installs: [] }], total: 1, offset: 0, limit: 5, counts: { all: 1, published: 0, draft: 1 }, realms_checked: 0, realms_total: 0, partial: false } }));
		if (key === 'build:validate') return new Response(JSON.stringify({ ok: true, data: { valid: true, errors: [], warnings: [] } }));
		if (u === '/v1/teams/create') return new Response(JSON.stringify({ ok: true, data: { id: 'draft-9', version_id: 'v-seed' } }));
		if (u === '/v1/teams/files/upload') return new Response(JSON.stringify({ ok: true, data: { version_id: (body.payload as { version_id?: string }).version_id ?? 'v-draft', files: [] } }), { status: 201 });
		if (u === '/v1/teams/update') return new Response(JSON.stringify({ ok: true, data: { id: body.team_id } }));
		if (u === '/v1/teams/get_by_id') return new Response(JSON.stringify({ ok: true, data: { name: 'feature-dev', ...detail_of(TEAM) } }));
		if (u === '/v1/team_page/get') return new Response(JSON.stringify({ ok: false, error: { message: 'Team not found' } }), { status: 404 });
		if (u === '/v1/teams/get_versions') return new Response(JSON.stringify({ ok: false, error: { message: 'Team not found' } }), { status: 404 });
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}

function Loc() { const l = useLocation(); return <output data-testid="loc">{l.pathname}{l.search}</output>; }
function render_at(path = '/builder') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/builder" element={<><BuilderPage /><Loc /></>} />
				<Route path="*" element={<Loc />} />
			</Routes>
		</MemoryRouter>,
	);
}
/** Phases in the flow, in team.yml order, as drawn on the canvas. */
const outline = () => [...screen.getByTestId('canvas').querySelectorAll<HTMLElement>('div[data-node]')].map((n) => n.dataset.node);
/** Click a phase on the canvas (opens the inspector for it). */
const open_phase = (name: string) => fireEvent.click(screen.getByTestId('canvas').querySelector<HTMLElement>(`div[data-node="${name}"]`)!);
async function open_draft() {
	const calls = route_fetch();
	render_at('/builder?draft=d1');
	await screen.findByTestId('canvas');
	return calls;
}

/** The identity step (PLAN-team-bundle S3): pick the scope, set the name when given, wait for the name check, make the team. */
async function confirm_identity(name?: string) {
	const dlg = await screen.findByRole('dialog', { name: 'Make the team' });
	fireEvent.change(within(dlg).getByLabelText('Scope'), { target: { value: 'measureone' } });
	if (name !== undefined) fireEvent.change(within(dlg).getByLabelText('Name'), { target: { value: name } });
	await within(dlg).findByText(/is free\./);
	fireEvent.click(within(dlg).getByRole('button', { name: /^Make @/ }));
	await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Make the team' })).toBeNull());
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('start helpers', () => {
	it('templates open with their own name (scope dropped) and starter roles', () => {
		const t = template_team(2)!;
		expect(t.name).toBe('linear-pipeline');
		expect(t.phases.length).toBeGreaterThan(1);
	});
	it('with_starter_roles only fills agent phases that lack a brief', () => {
		const t = with_starter_roles({ ...TEAM, roles: [] });
		expect(t.roles.map((r) => r.name)).toEqual(['design', 'build']);
	});
	it('import_text reads YAML (with line errors) and builder JSON', () => {
		const ok = import_text('name: "@acme/my-team"\nphases:\n  - name: a\n    type: standard\n');
		// the scope is kept: the identity step offers it (PLAN-team-bundle S3)
		expect('team' in ok && ok.team.name).toBe('@acme/my-team');
		const bad = import_text('name: x\nphases:\n  - name: a\n   type: standard\n');
		expect('error' in bad && bad.error).toMatch(/^Line \d+/);
		const json = import_text(JSON.stringify(TEAM));
		expect('team' in json && json.team.phases.length).toBe(3);
		expect('error' in import_text('name: x\nphases: []')).toBe(true);
	});
});

describe('Graphite builder — start screen', () => {
	it('shows the composer, templates and drafts (one team_list read, status draft, for the org in view)', async () => {
		const calls = route_fetch();
		render_at();
		expect(await screen.findByRole('heading', { name: 'What should your team do?' })).toBeTruthy();
		expect(screen.getAllByTestId('template').length).toBeGreaterThan(3);
		expect(await screen.findByText('loan-review')).toBeTruthy();
		const reads = calls.filter((c) => c.url === '/v1/team_list/get');
		expect(reads).toHaveLength(1);
		// the BFF requires the org (422 "org_id: Required" without it)
		expect(reads[0].body).toMatchObject({ status: 'draft', org_id: ORG_A, scope: 'measureone' });
		expect(screen.getByTestId('draft-row').getAttribute('href')).toBe('/builder?draft=d1');
		expect(screen.getByTestId('draft-row').textContent).toContain('2 phases');
	});

	it("a team never published (no phases read yet) says 'draft', not '0 phases'", async () => {
		route_fetch({ '/v1/team_list/get': () => ({ body: { ok: true, data: { items: [{ id: 'd2', name: 'new-team', scope: 'measureone', description: '', status: 'draft', latest_version: null, author: 'sapan', phase_types: [], installs: [] }], total: 1, offset: 0, limit: 5, counts: { all: 1, published: 0, draft: 1 }, realms_checked: 0, realms_total: 0, partial: false } } }) });
		render_at();
		const row = await screen.findByTestId('draft-row');
		expect(row.textContent).toContain('draft');
		expect(row.textContent).not.toContain('0 phases');
	});

	it('blank canvas → add phases by clicking palette tiles (after the selected phase)', async () => {
		route_fetch();
		render_at();
		fireEvent.click(await screen.findByText('Blank canvas'));
		await confirm_identity('blank-team');
		expect(await screen.findByText('+ Add the first phase')).toBeTruthy();
		fireEvent.click(screen.getByTestId('tile-agent'));
		expect(outline()).toEqual(['agent']);
		fireEvent.click(screen.getByTestId('tile-gate'));
		expect(outline()).toEqual(['agent', 'check']);
		// the gate was added after the selected agent phase
		expect(within(screen.getByRole('region', { name: 'Runs after' })).getByText('agent')).toBeTruthy();
	});

	it('a new team needs a scope and a free name before it is made (no silent default scope)', async () => {
		const calls = route_fetch({ '/v1/teams/get_versions': (b) => (b.name === 'taken' ? { body: { ok: true, data: { version: '1.0.0' } } } : undefined) });
		render_at();
		fireEvent.click(await screen.findByText('Blank canvas'));
		const dlg = await screen.findByRole('dialog', { name: 'Make the team' });
		const make = () => within(dlg).getByRole('button', { name: /^Make @/ }) as HTMLButtonElement;
		expect((within(dlg).getByLabelText('Scope') as HTMLSelectElement).value).toBe('');
		fireEvent.change(within(dlg).getByLabelText('Name'), { target: { value: 'taken' } });
		expect(make().disabled).toBe(true);
		fireEvent.change(within(dlg).getByLabelText('Scope'), { target: { value: 'measureone' } });
		expect(await within(dlg).findByText('@measureone/taken is taken.')).toBeTruthy();
		expect(make().disabled).toBe(true);
		fireEvent.change(within(dlg).getByLabelText('Name'), { target: { value: 'fresh' } });
		await within(dlg).findByText('@measureone/fresh is free.');
		expect((within(dlg).getByLabelText('First version') as HTMLInputElement).value).toBe('0.1.0');
		fireEvent.click(make());
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/teams/create')).toBe(true));
		expect(calls.find((c) => c.url === '/v1/teams/create')!.body).toMatchObject({ name: 'fresh', scope: 'measureone', visibility: 'private' });
	});

	it('template → canvas; autosave creates the team (with its draft), then uploads only what changed', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch();
		render_at();
		fireEvent.click((await screen.findAllByTestId('template'))[2]);
		await confirm_identity();
		await screen.findByTestId('canvas');
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/teams/create')).toBe(true));
		const create = calls.find((c) => c.url === '/v1/teams/create')!;
		expect(create.body).toMatchObject({ name: 'linear-pipeline', scope: 'measureone' });
		// Core creates the team with its first draft (seeded); the builder's files go into that draft
		expect(create.body).not.toHaveProperty('team_json');
		await waitFor(() => expect(uploads(calls)).toHaveLength(1));
		const first = uploads(calls)[0];
		expect(first.payload).toEqual({ team_id: 'draft-9', version_id: 'v-seed' });
		expect(first.files['team.yml']).toMatch(/phases:/);
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('draft=draft-9'));
		expect(screen.getByText(/draft · saved/)).toBeTruthy();
		// next edit uploads only team.yml, into the same draft
		fireEvent.click(screen.getByTestId('tile-script'));
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(uploads(calls)).toHaveLength(2));
		expect(uploads(calls)[1].payload).toEqual({ team_id: 'draft-9', version_id: 'v-seed' });
		expect(Object.keys(uploads(calls)[1].files)).toEqual(['team.yml']);
		expect(calls.filter((c) => c.url === '/v1/teams/create')).toHaveLength(1);
		expect(calls.some((c) => c.url === '/v1/teams/update')).toBe(false);
	});

	it('import by paste: errors show the line; valid YAML opens the canvas', async () => {
		route_fetch();
		render_at();
		fireEvent.click(await screen.findByText('Paste YAML'));
		const box = screen.getByLabelText('Paste team.yml');
		fireEvent.change(box, { target: { value: 'name: x\nphases:\n  - name: a\n   type: gate\n' } });
		fireEvent.click(screen.getByText('Open in builder'));
		expect(screen.getByRole('alert').textContent).toMatch(/Line \d+/);
		fireEvent.change(box, { target: { value: 'name: imported\nphases:\n  - name: one\n    type: standard\n  - name: two\n    type: standard\n    depends_on: [one]\n' } });
		fireEvent.click(screen.getByText('Open in builder'));
		await confirm_identity();
		await screen.findByTestId('canvas');
		expect(outline()).toEqual(['one', 'two']);
	});

	it('generate: shows stages, then opens the generated team', async () => {
		let polls = 0;
		const calls = route_fetch({
			'build:generate': () => ({ body: { ok: true, data: { job_id: 'j1', stage: 'designing' } } }),
			'build:status': () => { polls += 1; return { body: { ok: true, data: polls < 2 ? { status: 'running', stage: 'filling_roles' } : { status: 'done', team: TEAM } } }; },
		});
		vi.useFakeTimers({ shouldAdvanceTime: true });
		render_at();
		fireEvent.change(await screen.findByLabelText('Describe your team'), { target: { value: 'Ticket to PR' } });
		fireEvent.click(screen.getByText('✦ Generate team'));
		expect(await screen.findByTestId('generating')).toBeTruthy();
		expect(screen.getByText('Designing phases')).toBeTruthy();
		await act(async () => { await vi.advanceTimersByTimeAsync(3200); });
		await confirm_identity();
		await screen.findByTestId('canvas');
		expect(outline()).toEqual(['design', 'build', 'check']);
		expect(calls.find((c) => c.body.action === 'generate')!.body.intent).toBe('Ticket to PR');
	});

	it('generate errors are shown and the composer stays', async () => {
		route_fetch({ 'build:generate': () => ({ status: 500, body: { ok: false, error: { message: 'Builder is down' } } }) });
		render_at();
		fireEvent.change(await screen.findByLabelText('Describe your team'), { target: { value: 'x' } });
		fireEvent.click(screen.getByText('✦ Generate team'));
		expect((await screen.findByRole('alert')).textContent).toBe('Builder is down');
		expect(screen.getByLabelText('Describe your team')).toBeTruthy();
	});
});

describe('Graphite builder — workspace', () => {
	it('loads a saved team by id; the first edit starts a draft with all its files, the next sends only changes', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = await open_draft();
		expect(outline()).toEqual(['design', 'build', 'check']);
		open_phase('build');
		expect(screen.getByLabelText('Phase name')).toHaveProperty('value', 'build');
		fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(uploads(calls)).toHaveLength(1));
		const up = uploads(calls)[0];
		expect(up.payload).toEqual({ team_id: 'd1' });
		expect(Object.keys(up.files).sort()).toEqual(['roles/build.md', 'roles/design.md', 'team.yml']);
		expect(up.files['team.yml']).toMatch(/model: opus/);
		// the next edit goes into the draft just started, team.yml only
		fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'sonnet' } });
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(uploads(calls)).toHaveLength(2));
		expect(uploads(calls)[1].payload).toEqual({ team_id: 'd1', version_id: 'v-draft' });
		expect(Object.keys(uploads(calls)[1].files)).toEqual(['team.yml']);
		expect(calls.some((c) => c.url === '/v1/teams/create' || c.url === '/v1/teams/update')).toBe(false);
	});

	it('keyboard: Delete bridges the gap, ⌘Z undoes, ⌘D duplicates, Esc deselects', async () => {
		await open_draft();
		open_phase('build');
		fireEvent.keyDown(window, { key: 'Delete' });
		expect(outline()).toEqual(['design', 'check']);
		// check now runs after design (bridged)
		open_phase('check');
		expect(within(screen.getByRole('region', { name: 'Runs after' })).getByText('design')).toBeTruthy();
		fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(outline()).toEqual(['design', 'build', 'check']);
		open_phase('design');
		fireEvent.keyDown(window, { key: 'd', metaKey: true });
		expect(outline()).toHaveLength(4);
		expect(screen.getByTestId('phase-panel')).toBeTruthy();
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByTestId('inspector')).toBeNull();
	});

	it('typing in a field does not trigger delete', async () => {
		await open_draft();
		open_phase('build');
		fireEvent.keyDown(screen.getByLabelText('Model'), { key: 'Backspace' });
		expect(outline()).toEqual(['design', 'build', 'check']);
	});

	it('shows local problems instantly and Core-only errors when local checks pass', async () => {
		route_fetch({ 'build:validate': () => ({ body: { ok: true, data: { valid: false, errors: ['agent "claude-code" is not installed in any realm'], warnings: [] } } }) });
		vi.useFakeTimers({ shouldAdvanceTime: true });
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		expect(within(screen.getByTestId('problems')).getByText('✓ Valid workflow')).toBeTruthy();
		await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
		await waitFor(() => expect(within(screen.getByTestId('problems-count')).getByText('1 error')).toBeTruthy());
		expect(within(screen.getByTestId('problems')).getByText(/not installed in any realm/)).toBeTruthy();
		// a team-wide problem opens the team details
		fireEvent.click(within(screen.getByTestId('problems')).getByTitle('Open team details'));
		expect(screen.getByTestId('team-panel')).toBeTruthy();
	});

	it('a local problem (gate with no checks) shows once in the Problems list, plus a dot on the node', async () => {
		await open_draft();
		open_phase('check');
		fireEvent.click(screen.getByLabelText('Remove command 1'));
		expect(within(screen.getByTestId('problems-count')).getByText(/\d+ errors?/)).toBeTruthy();
		expect(screen.getByTestId('problem-check')).toBeTruthy();
		// no duplicates: not on the toolbar, not in the inspector
		expect(screen.queryByTestId('status-pills')).toBeNull();
		expect(screen.queryByTestId('panel-problems')).toBeNull();
		expect(within(screen.getByTestId('canvas-toolbar')).queryByText(/problem/)).toBeNull();
		// clicking the row selects the phase it is about
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByTestId('inspector')).toBeNull();
		fireEvent.click(within(screen.getByTestId('problems')).getAllByTitle('Open check')[0]);
		expect(screen.getByLabelText('Phase name')).toHaveProperty('value', 'check');
	});

	it('drop a palette tile on empty canvas adds a new root phase', async () => {
		await open_draft();
		const target = screen.getByRole('application', { name: 'Workflow canvas' });
		const data: Record<string, string> = { [String('application/x-cliq-kind')]: 'human' };
		const dt = { types: Object.keys(data), getData: (k: string) => data[k] ?? '', setData: vi.fn(), dropEffect: 'copy', effectAllowed: 'copy' };
		fireEvent.dragOver(target, { dataTransfer: dt, clientX: 50, clientY: 700 });
		fireEvent.drop(target, { dataTransfer: dt, clientX: 50, clientY: 700 });
		await waitFor(() => expect(outline()).toContain('review'));
	});

	it('Changes view lists edits since opening and can revert them', async () => {
		await open_draft();
		fireEvent.click(screen.getByTestId('tile-script'));
		fireEvent.click(screen.getByRole('tab', { name: 'Changes' }));
		const view = screen.getByTestId('changes-view');
		expect(within(view).getByText('script')).toBeTruthy();
		fireEvent.click(within(view).getByText('Revert all'));
		expect(within(screen.getByTestId('changes-view')).getByText('No changes yet.')).toBeTruthy();
	});

	it('AI chat: actions preview on the canvas; Apply all commits them in one undo', async () => {
		route_fetch({
			'build:chat': () => ({ body: { ok: true, data: { reply: 'Added a security scan after design.', actions: [{ type: 'ADD_PHASE', phase: { name: 'security-scan', type: 'standard', agent: 'claude-code', depends_on: ['design'] } }, { type: 'ADD_ROLE', role: { name: 'security-scan', content: 'Scan.' } }, { type: 'SET_VIEW', view: 'spark' }] } } }),
		});
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByTestId('ai-item'));
		fireEvent.change(screen.getByLabelText('Ask AI'), { target: { value: 'add a security scan' } });
		fireEvent.click(screen.getByText('Send'));
		expect(await screen.findByText('Added a security scan after design.')).toBeTruthy();
		expect(screen.getByTestId('preview-banner').textContent).toContain('+1');
		fireEvent.click(screen.getByText('Apply all'));
		expect(screen.queryByTestId('preview-banner')).toBeNull();
		expect(outline()).toContain('security-scan');
		fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(outline()).not.toContain('security-scan');
	});

	it('AI chat: Discard leaves the team untouched', async () => {
		route_fetch({ 'build:chat': () => ({ body: { ok: true, data: { reply: 'Plan ready.', actions: [{ type: 'REMOVE_PHASE', name: 'check' }] } } }) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByTestId('ai-item'));
		fireEvent.change(screen.getByLabelText('Ask AI'), { target: { value: 'remove the gate' } });
		fireEvent.click(screen.getByText('Send'));
		await screen.findByText('Plan ready.');
		fireEvent.click(within(screen.getByTestId('ai-drawer')).getByText('Discard'));
		expect(screen.getByText('Discarded.')).toBeTruthy();
		expect(outline()).toEqual(['design', 'build', 'check']);
	});

	it('preview helpers ignore pending flags and mark added/changed/removed', () => {
		const next = preview_actions(TEAM, [{ type: 'ADD_PHASE', phase: { name: 'x', type: 'standard', depends_on: ['check'] } }, { type: 'REMOVE_PHASE', name: 'build' }]);
		expect(next.phases.find((p) => p.name === 'x')!.pending).toBeUndefined();
		const p = to_preview(TEAM, next);
		expect([...p.added]).toEqual(['x']);
		expect(p.removed).toEqual(['build']);
	});

	it('YAML view: edits sync to the canvas; broken YAML keeps the last good team', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		await open_draft();
		fireEvent.click(screen.getByRole('tab', { name: 'YAML' }));
		const content = document.querySelector('.cm-content') as HTMLElement;
		expect(content).toBeTruthy();
		const view = EditorView.findFromDOM(content)!;
		expect(view.state.doc.toString()).toContain('- name: design');
		expect(screen.getByTestId('yaml-status').textContent).toContain('in sync');
		const text = view.state.doc.toString().replace('- name: check', '- name: verify').replace('depends_on: [build]', 'depends_on: [build]');
		act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: 'input.type' }); });
		await act(async () => { await vi.advanceTimersByTimeAsync(500); });
		act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'phases:\n  - name: a\n   bad: [' }, userEvent: 'input.type' }); });
		await act(async () => { await vi.advanceTimersByTimeAsync(500); });
		expect(screen.getByTestId('yaml-status').textContent).toMatch(/Can’t read this YAML/);
		fireEvent.click(screen.getByRole('tab', { name: 'Canvas' }));
		expect(outline()).toContain('verify');
	});

	it('YAML view: Format rewrites to canonical team.yml; comments are kept as written', async () => {
		await open_draft();
		fireEvent.click(screen.getByRole('tab', { name: 'YAML' }));
		const view = EditorView.findFromDOM(document.querySelector('.cm-content') as HTMLElement)!;
		const canonical = view.state.doc.toString();
		const messy = 'name: feature-dev\ndescription: Ticket to PR\nphases: [{name: design, type: standard, agent: claude-code}, {name: build, type: standard, agent: claude-code, depends_on: [design]}, {name: check, type: gate, agent: claude-code, depends_on: [build], max_iterations: 3, commands: [{name: test, run: npm test}]}]\n';
		act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: messy } }); });
		fireEvent.click(screen.getByText('Format'));
		expect(view.state.doc.toString().trim()).toBe(canonical.trim());
		expect(screen.getByText('Formatted')).toBeTruthy();
		act(() => { view.dispatch({ changes: { from: 0, to: 0, insert: '# my notes\n' } }); });
		fireEvent.click(screen.getByText('Format'));
		expect(view.state.doc.toString().startsWith('# my notes')).toBe(true);
	});

	it('Export downloads team.yml', async () => {
		await open_draft();
		const create = vi.fn(() => 'blob:x');
		Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		fireEvent.click(screen.getByRole('button', { name: 'Download' }));
		expect(create).toHaveBeenCalled();
		expect(click).toHaveBeenCalled();
	});
});

describe('Graphite builder — layout', () => {
	it('left nav: Back, Team details, Phases (palette inline), AI, then Problems; team actions top right; views on the canvas', async () => {
		await open_draft();
		const nav = screen.getByRole('navigation', { name: 'Builder' });
		expect(within(nav).getAllByRole('button').map((b) => b.textContent?.replace(/⌘K|[▾▸]/g, '').trim())).toEqual(expect.arrayContaining(['Team details', 'Phases', 'AI']));
		const order = within(nav).getAllByRole('button').map((b) => b.dataset.testid).filter((id) => ['team-details', 'phases-item', 'ai-item'].includes(id ?? ''));
		expect(order).toEqual(['team-details', 'phases-item', 'ai-item']);
		expect(screen.getByTestId('build-panel')).toBeTruthy();
		fireEvent.click(screen.getByTestId('phases-item'));
		expect(screen.queryByTestId('build-panel')).toBeNull();
		// Problems is last in the left nav.
		const aside = screen.getByRole('complementary', { name: 'Build tools' });
		expect(aside.lastElementChild!.contains(screen.getByTestId('problems'))).toBe(true);
		// Views live on the canvas toolbar, not in the header.
		expect(within(screen.getByTestId('canvas-toolbar')).getByRole('tab', { name: 'YAML' })).toBeTruthy();
		// The team header (as on the team page) carries the team actions on its row.
		const head = screen.getByTestId('team-header');
		expect(within(head).getByRole('heading', { level: 1 })).toBeTruthy();
		expect(within(head).getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Edit');
		for (const name of ['Discard', 'Download', 'Publish…']) expect(within(head).getByRole('button', { name })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
		expect(screen.queryByText(/Ask AI to change anything/)).toBeNull();
		// AI opens on the right and keeps its conversation when closed and reopened.
		fireEvent.click(screen.getByTestId('ai-item'));
		expect(screen.getByLabelText('Ask AI')).toBeTruthy();
		fireEvent.change(screen.getByLabelText('Ask AI'), { target: { value: 'draft text' } });
		fireEvent.click(screen.getByRole('button', { name: 'Close AI' }));
		fireEvent.click(screen.getByTestId('ai-item'));
		expect((screen.getByLabelText('Ask AI') as HTMLTextAreaElement).value).toBe('draft text');
	});

	it('has no outline, a shape palette, and one Problems list in the left panel', async () => {
		await open_draft();
		expect(screen.queryByTestId('outline')).toBeNull();
		expect(screen.queryByText('Outline')).toBeNull();
		const left = screen.getByRole('complementary', { name: 'Build tools' });
		expect(within(left).getByTestId('palette')).toBeTruthy();
		expect(within(left).getByTestId('problems')).toBeTruthy();
		// tiles show the kind name only; the description is the tooltip
		expect(screen.getByTestId('tile-agent').textContent).not.toContain('role brief');
		expect(screen.getByTestId('tile-agent').getAttribute('title')).toContain('an AI agent with a role brief');
		// the Problems list stays in the left panel on the AI tab too
		fireEvent.click(screen.getByTestId('ai-item'));
		expect(within(left).getByTestId('problems')).toBeTruthy();
	});

	it('opens on Team details; a phase takes the panel; empty canvas, the close button and Esc close it', async () => {
		await open_draft();
		expect(screen.getByRole('complementary', { name: 'Team details' })).toBeTruthy();
		expect(screen.getByTestId('team-details').getAttribute('aria-expanded')).toBe('true');
		open_phase('build');
		const panel = screen.getByRole('complementary', { name: 'Phase details: build' });
		expect(within(panel).getByLabelText('Phase name')).toHaveProperty('value', 'build');
		fireEvent.click(screen.getByRole('application', { name: 'Workflow canvas' }));
		expect(screen.queryByTestId('inspector')).toBeNull();
		open_phase('design');
		fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
		expect(screen.queryByTestId('inspector')).toBeNull();
		// Esc closes it even while typing in one of its fields
		open_phase('design');
		const name = screen.getByLabelText('Phase name');
		name.focus();
		fireEvent.keyDown(name, { key: 'Escape' });
		expect(screen.queryByTestId('inspector')).toBeNull();
	});

	it('Team details is open at first; it toggles (focus moves in) and returns focus when closed', async () => {
		await open_draft();
		const btn = screen.getByTestId('team-details');
		expect(btn.getAttribute('aria-expanded')).toBe('true');
		fireEvent.click(btn);
		expect(screen.queryByTestId('inspector')).toBeNull();
		expect(btn.getAttribute('aria-expanded')).toBe('false');
		btn.focus();
		fireEvent.click(btn);
		expect(screen.getByRole('complementary', { name: 'Team details' })).toBeTruthy();
		expect(screen.getByTestId('team-panel')).toBeTruthy();
		expect(btn.getAttribute('aria-expanded')).toBe('true');
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close details' }));
		fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
		expect(screen.queryByTestId('inspector')).toBeNull();
		expect(document.activeElement).toBe(btn);
		// the button toggles
		fireEvent.click(btn);
		fireEvent.click(btn);
		expect(screen.queryByTestId('inspector')).toBeNull();
	});

	it('the Run inputs node opens the team details at the inputs', async () => {
		await open_draft();
		fireEvent.click(screen.getByTestId('inputs-node'));
		expect(screen.getByTestId('team-panel')).toBeTruthy();
	});

	it('the app sidebar is collapsed in the builder', async () => {
		await open_draft();
		expect(screen.getByTestId('sidebar').dataset.collapsed).toBe('true');
		expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy();
	});
});

describe('Graphite builder — publish', () => {
	it('first publish: creates the team (with its draft), uploads the files into that draft, publishes it as 0.1.0', async () => {
		const calls = route_fetch({ '/v1/teams/publish': () => ({ body: { ok: true, data: { version: '0.1.0' } } }) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByText('Publish…'));
		const dlg = await screen.findByRole('dialog', { name: 'Publish team' });
		expect(await within(dlg).findByText('Publish 0.1.0')).toBeTruthy();
		expect(calls.filter((c) => c.url === '/v1/team_page/get')).toHaveLength(1);
		expect(calls.find((c) => c.url === '/v1/team_page/get')!.body).toMatchObject({ scope: 'measureone', name: 'feature-dev', view: 'installs' });
		fireEvent.click(within(dlg).getByText('Publish 0.1.0'));
		expect(await screen.findByTestId('publish-done')).toBeTruthy();
		const steps = ['/v1/teams/create', '/v1/teams/files/upload', '/v1/teams/publish'];
		expect(calls.map((c) => c.url).filter((u) => steps.includes(u))).toEqual(steps);
		const up = uploads(calls)[0];
		expect(up.payload).toEqual({ team_id: 'draft-9', version_id: 'v-seed' });
		expect(Object.keys(up.files)).toEqual(['team.yml', 'roles/design.md', 'roles/build.md']);
		expect(up.files['team.yml']).toContain('name: feature-dev');
		const body = calls.find((c) => c.url === '/v1/teams/publish')!.body;
		// A new team starts private (PLAN-team-visibility §3.3); publish names the draft Core created with the team.
		expect(body).toMatchObject({ name: 'feature-dev', scope: 'measureone', version: '0.1.0', visibility: 'private', version_id: 'v-seed' });
		expect(body.files).toBeUndefined();
	});

	it('next version: suggested bump, notes, public toggle (starts at the current visibility), then upgrades ticked realms', async () => {
		const installs = [
			{ realm_id: 'r1', realm_slug: 'prod-us', realm_name: 'prod-us', org_slug: 'measureone', version: '1.0.0', behind: false, in_team_list: true, installed_count: 1, online_daemon_count: 1, last_run_at: null, missing_agents: [] },
			{ realm_id: 'r2', realm_slug: 'staging', realm_name: 'staging', org_slug: 'measureone', version: '1.0.0', behind: false, in_team_list: true, installed_count: 1, online_daemon_count: 1, last_run_at: null, missing_agents: [] },
		];
		const calls = route_fetch({
			'/v1/team_page/get': () => ({ body: { ok: true, data: { team: { id: 'd1', latest_version: '1.0.0', status: 'published', listed: true, visibility: 'public' }, installs: { items: installs, not_installed: [], realms_checked: 2, realms_total: 2 }, counts: {}, view: 'installs', partial: false } } }),
			'/v1/teams/publish': () => ({ body: { ok: true, data: { version: '1.1.0' } } }),
			'/v1/realms/add_team': () => ({ body: { ok: true, data: {} } }),
		});
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByTestId('tile-agent'));
		fireEvent.click(screen.getByText('Publish…'));
		const dlg = await screen.findByRole('dialog', { name: 'Publish team' });
		await within(dlg).findByText('Publish 1.1.0'); // new phase → minor suggested
		expect((within(dlg).getByLabelText('Release notes') as HTMLTextAreaElement).value).toMatch(/agent/);
		fireEvent.click(within(dlg).getByRole('radio', { name: /Patch/ }));
		expect(within(dlg).getByText('Publish 1.0.1')).toBeTruthy();
		fireEvent.click(within(dlg).getByRole('radio', { name: /Minor/ }));
		expect((within(dlg).getByLabelText(/Public \(on the marketplace\)/) as HTMLInputElement).checked).toBe(true);
		fireEvent.click(within(dlg).getByLabelText(/Public \(on the marketplace\)/));
		fireEvent.click(within(dlg).getByRole('checkbox', { name: /staging/ }));
		fireEvent.click(within(dlg).getByText('Publish 1.1.0'));
		await screen.findByTestId('publish-done');
		// the builder's team: its edits go into a new draft, and that draft is published
		expect(calls.some((c) => c.url === '/v1/teams/create')).toBe(false);
		expect(uploads(calls).at(-1)!.payload).toEqual({ team_id: 'd1' });
		expect(calls.find((c) => c.url === '/v1/teams/publish')!.body).toMatchObject({ version: '1.1.0', visibility: 'private', version_id: 'v-draft' });
		const adds = calls.filter((c) => c.url === '/v1/realms/add_team');
		expect(adds.map((a) => a.body.realm_id)).toEqual(['r1']);
		expect(adds[0].body).toMatchObject({ scope: 'measureone', slug: 'feature-dev', version: '1.1.0' });
		expect(screen.getByText('Upgraded prod-us.')).toBeTruthy();
	});

	it('version clash: shows Core’s message and re-bases the bump on the taken version', async () => {
		let n = 0;
		const calls = route_fetch({ '/v1/teams/publish': () => (++n === 1 ? { status: 409, body: { ok: false, error: { code: 'conflict', message: 'Version 1.0.0 already exists' } } } : { body: { ok: true, data: { version: '1.0.1' } } }) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByText('Publish…'));
		const dlg = await screen.findByRole('dialog', { name: 'Publish team' });
		fireEvent.click(await within(dlg).findByText('Publish 0.1.0'));
		expect((await within(dlg).findByRole('alert')).textContent).toMatch(/Version 1\.0\.0 already exists.*next version/);
		expect(within(dlg).getByRole('radio', { name: /Patch/ })).toHaveAttribute('aria-checked', 'true');
		fireEvent.click(within(dlg).getByText('Publish 1.0.1'));
		await screen.findByTestId('publish-done');
		const bodies = calls.filter((c) => c.url === '/v1/teams/publish').map((c) => c.body);
		expect(bodies[0]).toMatchObject({ version: '0.1.0' });
		// every publish names its version (PLAN-team-bundle S2)
		expect(bodies[1]).toMatchObject({ version: '1.0.1' });
		expect(bodies[1]).not.toHaveProperty('bump');
	});

	it('the version is a field: typed or filled by patch / minor / major, and it must be higher (PLAN-team-bundle S3)', async () => {
		route_fetch({ '/v1/team_page/get': () => ({ body: { ok: true, data: { team: { id: 'd1', latest_version: '1.2.0', status: 'published', listed: true, visibility: 'private' }, installs: { items: [], not_installed: [], realms_checked: 0, realms_total: 0 }, counts: {}, view: 'installs', partial: false } } }) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByText('Publish…'));
		const dlg = await screen.findByRole('dialog', { name: 'Publish team' });
		const field = await within(dlg).findByLabelText('Version') as HTMLInputElement;
		fireEvent.click(within(dlg).getByRole('radio', { name: /Major/ }));
		expect(field.value).toBe('2.0.0');
		fireEvent.change(field, { target: { value: '1.2.0' } });
		expect(within(dlg).getByText('Higher than 1.2.0.')).toBeTruthy();
		expect((within(dlg).getByText('Publish 1.2.0') as HTMLButtonElement).disabled).toBe(true);
		fireEvent.change(field, { target: { value: '1.5.0' } });
		expect((within(dlg).getByText('Publish 1.5.0') as HTMLButtonElement).disabled).toBe(false);
		// no scope picker: the team's scope is fixed
		expect(within(dlg).queryByLabelText('Scope')).toBeNull();
	});

	it('version_clash reads both Core messages', () => {
		expect(version_clash('Version 1.4.2 already exists')).toBe('1.4.2');
		expect(version_clash('Version 1.0.0 is older than 2.1.0, the highest version so far (withdrawn ones count): publish a higher version (cliq team publish <dir> --version x.y.z)')).toBe('2.1.0');
		expect(version_clash('Package too large')).toBeNull();
	});

	it('errors block publishing', async () => {
		route_fetch();
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		open_phase('check');
		fireEvent.click(screen.getByLabelText('Remove command 1'));
		fireEvent.click(screen.getByText('Publish…'));
		const dlg = await screen.findByRole('dialog', { name: 'Publish team' });
		const btn = await within(dlg).findByText('Publish 0.1.0');
		expect((btn as HTMLButtonElement).disabled).toBe(true);
		expect(within(dlg).getByText('Fix the errors above to publish.')).toBeTruthy();
	});
});

describe('Graphite builder — cancel', () => {
	const writes = (calls: Call[]) => calls.filter((c) => ['/v1/teams/create', '/v1/teams/update', '/v1/teams/delete', '/v1/teams/files/upload', '/v1/teams/files/remove'].includes(c.url));

	it('saved team with no draft at open: Discard deletes the draft this session started', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = await open_draft();
		open_phase('build');
		fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(uploads(calls)).toHaveLength(1));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		expect(within(screen.getByTestId('cancel-confirm')).getByText('Discard your changes?')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams'));
		expect(calls.filter((c) => c.url === '/v1/teams/update').at(-1)!.body).toEqual({ team_id: 'd1', save_as: 'discard', version_id: 'v-draft' });
		expect(calls.some((c) => c.url === '/v1/teams/delete')).toBe(false);
	});

	it('edits that never reached the server: Discard sends nothing', async () => {
		const calls = await open_draft();
		fireEvent.click(screen.getByTestId('tile-script'));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams'));
		expect(writes(calls)).toEqual([]);
	});

	it('new team that autosaved: Discard deletes that draft by id', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch();
		render_at();
		fireEvent.click((await screen.findAllByTestId('template'))[2]);
		await confirm_identity();
		await screen.findByTestId('canvas');
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('draft=draft-9'));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		expect(screen.getByText('Discard this new team?')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams'));
		expect(calls.find((c) => c.url === '/v1/teams/delete')?.body).toEqual({ team_id: 'draft-9' });
	});

	it('published team (view mode): Discard sends nothing and goes back where it came from', async () => {
		sessionStorage.setItem(BUILDER_SESSION_KEYS.view, JSON.stringify(TEAM));
		const calls = route_fetch();
		render_at('/builder?view=1&from=%2Fteams%2Fmeasureone%2Ffeature-dev');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByTestId('tile-script'));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams/measureone/feature-dev'));
		expect(writes(calls)).toEqual([]);
		expect(sessionStorage.getItem(BUILDER_SESSION_KEYS.view)).toBeNull();
	});

	it('fork: its draft is deleted on Discard even after autosave drops ?fork=1', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		sessionStorage.setItem(BUILDER_SESSION_KEYS.fork, JSON.stringify({ ...TEAM, name: 'feature-dev-fork' }));
		const calls = route_fetch();
		render_at('/builder?fork=1&from=%2Fbrowse');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByTestId('tile-script'));
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(screen.getByTestId('loc').textContent).not.toContain('fork=1'));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		expect(screen.getByText('Discard this new team?')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/browse'));
		expect(calls.find((c) => c.url === '/v1/teams/delete')?.body).toEqual({ team_id: 'draft-9' });
	});

	it('no changes: Cancel leaves at once, without asking or saving', async () => {
		const calls = await open_draft();
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams'));
		expect(writes(calls)).toEqual([]);
	});

	it('Keep editing closes the prompt and keeps the edits', async () => {
		await open_draft();
		fireEvent.click(screen.getByTestId('tile-script'));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
		expect(screen.queryByTestId('cancel-confirm')).toBeNull();
		expect(outline()).toHaveLength(4);
		expect(screen.getByTestId('loc').textContent).toContain('/builder');
	});

	it('a failed discard shows why and stays in the builder', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch({ '/v1/teams/delete': () => ({ status: 500, body: { ok: false, error: { message: 'Core is down' } } }) });
		render_at();
		fireEvent.click((await screen.findAllByTestId('template'))[2]);
		await confirm_identity();
		await screen.findByTestId('canvas');
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/teams/create')).toBe(true));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Core is down');
		expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
		expect(screen.getByTestId('loc').textContent).toContain('/builder');
	});

	it('cancel_target only follows in-app paths', () => {
		expect(cancel_target('/teams/x/y')).toBe('/teams/x/y');
		expect(cancel_target(null)).toBe('/teams');
		expect(cancel_target('https://evil.example')).toBe('/teams');
		expect(cancel_target('//evil.example')).toBe('/teams');
		expect(cancel_target('/builder?draft=1')).toBe('/teams');
	});
});

describe('Graphite builder — files the builder does not edit (S1.4c)', () => {
	const PUB = { 'team.yml': 'name: feature-dev\nphases: []\n', 'README.md': '# feature-dev', 'dependencies.yml': '- name: jq\n', 'roles/design.md': 'old' };
	const published = () => ({ body: { ok: true, data: { id: 'd1', name: 'feature-dev', scope: 'measureone', status: 'published', visibility: 'public', latest_version: '1.2.0', ...detail_of(TEAM), version_id: 'v-pub', draft: null } } });
	const files_of = (files: Record<string, string>) => () => ({ body: { ok: true, data: { files: Object.entries(files).map(([path, content]) => ({ path, content })) } } });

	it('a new draft from a published team starts from its version: README.md and dependencies.yml are kept', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch({ '/v1/teams/get_by_id': published, '/v1/teams/files/get': files_of(PUB) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByTestId('tile-script'));
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(uploads(calls)).toHaveLength(1));
		expect(calls.find((c) => c.url === '/v1/teams/files/get')!.body).toEqual({ team_id: 'd1', version_id: 'v-pub', content: true });
		const up = uploads(calls)[0];
		expect(up.payload).toEqual({ team_id: 'd1', based_on_version_id: 'v-pub' });
		expect(Object.keys(up.files).sort()).toEqual(['README.md', 'dependencies.yml', 'roles/build.md', 'roles/design.md', 'team.yml']);
		expect(up.files['README.md']).toBe('# feature-dev');
		expect(up.files['dependencies.yml']).toBe('- name: jq\n');
		// the builder's own files win over the version's
		expect(up.files['roles/design.md']).toBe(TEAM.roles[0].content);
	});

	it("after a publish, the next draft starts from the version just published", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch({
			'/v1/teams/get_by_id': published,
			'/v1/teams/files/get': files_of(PUB),
			'/v1/team_page/get': () => ({ body: { ok: true, data: { team: { id: 'd1', latest_version: '1.2.0', status: 'published', listed: true, visibility: 'public' }, installs: { items: [], not_installed: [], realms_checked: 0, realms_total: 0 }, counts: {}, view: 'installs', partial: false } } }),
			'/v1/teams/publish': () => ({ body: { ok: true, data: { version: '1.3.0' } } }),
		});
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByTestId('tile-agent'));
		fireEvent.click(screen.getByText('Publish…'));
		const dlg = await screen.findByRole('dialog', { name: 'Publish team' });
		fireEvent.click(await within(dlg).findByText(/^Publish \d/));
		await screen.findByTestId('publish-done');
		fireEvent.click(screen.getByText('Keep editing'));
		fireEvent.click(screen.getByTestId('tile-script'));
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(uploads(calls)).toHaveLength(2));
		// the draft published was v-draft: the next one reads its files to start from
		expect(calls.filter((c) => c.url === '/v1/teams/files/get').at(-1)!.body).toEqual({ team_id: 'd1', version_id: 'v-draft', content: true });
		expect(uploads(calls)[1].payload).toEqual({ team_id: 'd1', based_on_version_id: 'v-draft' });
		expect(Object.keys(uploads(calls)[1].files)).toEqual(expect.arrayContaining(['README.md', 'dependencies.yml', 'team.yml']));
	});
});

describe('Graphite builder — open draft', () => {
	const COPY = { ...TEAM, phases: [...TEAM.phases, { name: 'ship', type: 'standard' as const, agent: 'claude-code', depends_on: ['check'] }] };
	const detail = (extra: Record<string, unknown>) => () => ({ body: { ok: true, data: { id: 'd1', name: 'feature-dev', scope: 'measureone', status: 'published', visibility: 'public', latest_version: '1.2.0', ...detail_of(TEAM), ...extra } } });
	const DRAFT = { version_id: 'v-open', saved_at: '2026-10-05T09:00:00.000Z' };
	// The open draft's files, as files/get returns them with content.
	const draft_files = () => ({ body: { ok: true, data: { files: Object.entries({ ...team_files(COPY), 'README.md': '# feature-dev' }).map(([path, content]) => ({ path, content })) } } });

	it('opens the draft from its files, saves into it (only what changed), and says "unpublished changes" on a published team', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch({ '/v1/teams/get_by_id': detail({ draft: DRAFT }), '/v1/teams/files/get': draft_files });
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		expect(calls.find((c) => c.url === '/v1/teams/files/get')!.body).toEqual({ team_id: 'd1', version_id: 'v-open', content: true });
		expect(outline()).toEqual(['design', 'build', 'check', 'ship']);
		fireEvent.click(screen.getByTestId('tile-script'));
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(screen.getByText(/unpublished changes · saved/)).toBeTruthy());
		expect(uploads(calls)).toHaveLength(1);
		expect(uploads(calls)[0].payload).toEqual({ team_id: 'd1', version_id: 'v-open' });
		expect(Object.keys(uploads(calls)[0].files)).toEqual(['team.yml']);
		// loaded once, though the restorer's effect re-runs while the load is in flight
		expect(calls.filter((c) => c.url === '/v1/teams/get_by_id')).toHaveLength(1);
		expect(calls.filter((c) => c.url === '/v1/teams/files/get')).toHaveLength(1);
	});

	it('a role taken out of the team is removed from the draft', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch({ '/v1/teams/get_by_id': detail({ draft: DRAFT }), '/v1/teams/files/get': draft_files });
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		open_phase('design');
		fireEvent.keyDown(window, { key: 'Delete' });
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/teams/files/remove')).toBe(true));
		expect(calls.find((c) => c.url === '/v1/teams/files/remove')!.body).toEqual({ team_id: 'd1', version_id: 'v-open', paths: ['roles/design.md'] });
	});

	it('?fresh=1 starts a new draft from the published version; Discard deletes only that one', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch({ '/v1/teams/get_by_id': detail({ draft: DRAFT }), '/v1/teams/files/get': draft_files });
		render_at('/builder?draft=d1&fresh=1&from=%2Fteams%2Fmeasureone%2Ffeature-dev');
		await screen.findByTestId('canvas');
		expect(outline()).toEqual(['design', 'build', 'check']);
		expect(calls.some((c) => c.url === '/v1/teams/files/get')).toBe(false);
		fireEvent.click(screen.getByTestId('tile-script'));
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(uploads(calls)).toHaveLength(1));
		expect(uploads(calls)[0].payload).toEqual({ team_id: 'd1' });
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		expect(screen.getByTestId('cancel-confirm').textContent).toContain('Discard your changes?');
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams/measureone/feature-dev'));
		expect(calls.filter((c) => c.url === '/v1/teams/update').map((c) => c.body)).toEqual([{ team_id: 'd1', save_as: 'discard', version_id: 'v-draft' }]);
	});

	it('an open draft with no edits this session: Discard still asks, then deletes it', async () => {
		const calls = route_fetch({ '/v1/teams/get_by_id': detail({ draft: DRAFT }), '/v1/teams/files/get': draft_files });
		render_at('/builder?draft=d1&from=%2Fteams%2Fmeasureone%2Ffeature-dev');
		await screen.findByTestId('canvas');
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		expect(screen.getByTestId('cancel-confirm').textContent).toContain('including earlier ones');
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams/measureone/feature-dev'));
		expect(calls.filter((c) => c.url === '/v1/teams/update').map((c) => c.body)).toEqual([{ team_id: 'd1', save_as: 'discard', version_id: 'v-open' }]);
		expect(uploads(calls)).toEqual([]);
	});

	it('a team without a team.yml yet opens from its phase list (roles kept)', async () => {
		route_fetch({ '/v1/teams/get_by_id': detail({
			raw_manifest: null, draft: null,
			workflow: { phases: TEAM.phases },
			roles: [{ name: 'design', content_md: '# design\nWrite the design.' }],
			agents: {},
		}) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('canvas');
		expect(outline()).toEqual(['design', 'build', 'check']);
	});
});
