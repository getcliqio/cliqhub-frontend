/** Graphite builder: start screen, canvas edits, keyboard, AI preview, YAML sync, autosave, publish. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { EditorView } from '@codemirror/view';
import { gs_response, multi_org_overview } from './fixtures_overview';
import type { GeneratedTeam } from '@/lib/builder/store';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [{ slug: 'measureone', scope_type: 'org' }], loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));
vi.mock('@/lib/org_context', () => ({ useOrgFetch: () => stable_fetch }));

import { Component as BuilderPage } from '@/pages/builder/builder_graphite_page';
import { import_text, template_team, with_starter_roles } from '@/components/gbuilder/gb_start';
import { preview_actions, to_preview } from '@/components/gbuilder/gb_ai_panel';
import { version_clash } from '@/components/gbuilder/gb_publish';
import { cancel_target } from '@/components/gbuilder/gb_app';
import { BUILDER_SESSION_KEYS } from '@/lib/builder/session_restore';

type Call = { url: string; body: Record<string, unknown> };
type Handler = (body: Record<string, unknown>, calls: Call[]) => { status?: number; body: unknown } | undefined;

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

function route_fetch(handlers: Record<string, Handler> = {}) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		const key = u === '/v1/teams/build' ? `build:${body.action}` : u;
		const h = handlers[key]?.(body, calls);
		if (h) return new Response(JSON.stringify(h.body), { status: h.status ?? 200 });
		if (u === '/v1/team_list/get') return new Response(JSON.stringify({ ok: true, data: { items: [{ id: 'd1', name: 'loan-review', scope: 'measureone', description: '', status: 'draft', latest_version: null, author: 'sapan', phase_types: ['standard', 'gate'], installs: [] }], total: 1, offset: 0, limit: 5, counts: { all: 1, published: 0, draft: 1 }, realms_checked: 0, realms_total: 0, partial: false } }));
		if (key === 'build:validate') return new Response(JSON.stringify({ ok: true, data: { valid: true, errors: [], warnings: [] } }));
		if (u === '/v1/teams/create') return new Response(JSON.stringify({ ok: true, data: { id: 'draft-9' } }));
		if (u === '/v1/teams/update') return new Response(JSON.stringify({ ok: true, data: { id: body.team_id } }));
		if (u === '/v1/teams/get_by_id') return new Response(JSON.stringify({ ok: true, data: { team_json: JSON.stringify(TEAM) } }));
		if (u === '/v1/team_page/get') return new Response(JSON.stringify({ ok: false, error: { message: 'Team not found' } }), { status: 404 });
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
const outline = () => within(screen.getByTestId('outline')).queryAllByRole('button').map((b) => b.textContent);
async function open_draft() {
	const calls = route_fetch();
	render_at('/builder?draft=d1');
	await screen.findByTestId('outline');
	return calls;
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
		expect('team' in ok && ok.team.name).toBe('my-team');
		const bad = import_text('name: x\nphases:\n  - name: a\n   type: standard\n');
		expect('error' in bad && bad.error).toMatch(/^Line \d+/);
		const json = import_text(JSON.stringify(TEAM));
		expect('team' in json && json.team.phases.length).toBe(3);
		expect('error' in import_text('name: x\nphases: []')).toBe(true);
	});
});

describe('Graphite builder — start screen', () => {
	it('shows the composer, templates and drafts (one team_list read, status draft)', async () => {
		const calls = route_fetch();
		render_at();
		expect(await screen.findByRole('heading', { name: 'What should your team do?' })).toBeTruthy();
		expect(screen.getAllByTestId('template').length).toBeGreaterThan(3);
		expect(await screen.findByText('loan-review')).toBeTruthy();
		const reads = calls.filter((c) => c.url === '/v1/team_list/get');
		expect(reads).toHaveLength(1);
		expect(reads[0].body).toMatchObject({ status: 'draft' });
		expect(screen.getByTestId('draft-row').getAttribute('href')).toBe('/builder?draft=d1');
	});

	it('blank canvas → add phases by clicking palette tiles (after the selected phase)', async () => {
		route_fetch();
		render_at();
		fireEvent.click(await screen.findByText('Blank canvas'));
		expect(await screen.findByText('+ Add the first phase')).toBeTruthy();
		fireEvent.click(screen.getByTestId('tile-agent'));
		expect(outline()).toEqual(['agent']);
		fireEvent.click(screen.getByTestId('tile-gate'));
		expect(outline()).toEqual(['agent', 'check']);
		// the gate was added after the selected agent phase
		expect(within(screen.getByRole('region', { name: 'Runs after' })).getByText('agent')).toBeTruthy();
	});

	it('unnamed blank teams do not autosave until named', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch();
		render_at();
		fireEvent.click(await screen.findByText('Blank canvas'));
		fireEvent.click(screen.getByTestId('tile-agent'));
		await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
		expect(calls.some((c) => c.url === '/v1/teams/create')).toBe(false);
		expect(screen.getByText('name it to save')).toBeTruthy();
	});

	it('template → canvas; autosave creates the draft then updates it', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch();
		render_at();
		fireEvent.click((await screen.findAllByTestId('template'))[2]);
		await screen.findByTestId('outline');
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/teams/create')).toBe(true));
		const create = calls.find((c) => c.url === '/v1/teams/create')!;
		expect(create.body).toMatchObject({ name: 'linear-pipeline', scope: 'measureone' });
		// created without a manifest (no version), then saved as the working copy
		expect(create.body).not.toHaveProperty('team_json');
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/teams/update')).toBe(true));
		const first = calls.find((c) => c.url === '/v1/teams/update')!;
		expect(first.body).toMatchObject({ team_id: 'draft-9', save_as: 'draft' });
		expect(JSON.parse(String(first.body.team_json)).phases.length).toBeGreaterThan(1);
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('draft=draft-9'));
		expect(screen.getByText(/draft · saved/)).toBeTruthy();
		// next edit updates the same draft
		fireEvent.click(screen.getByTestId('tile-script'));
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/teams/update').length).toBe(2));
		expect(calls.filter((c) => c.url === '/v1/teams/update')[1].body).toMatchObject({ team_id: 'draft-9', save_as: 'draft' });
		expect(calls.filter((c) => c.url === '/v1/teams/create')).toHaveLength(1);
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
		await screen.findByTestId('outline');
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
		await screen.findByTestId('outline');
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
	it('loads a draft by id and autosaves edits with teams/update', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = await open_draft();
		expect(outline()).toEqual(['design', 'build', 'check']);
		fireEvent.click(within(screen.getByTestId('outline')).getByText('build'));
		expect(screen.getByLabelText('Phase name')).toHaveProperty('value', 'build');
		fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/teams/update')).toBe(true));
		const up = calls.find((c) => c.url === '/v1/teams/update')!;
		expect(up.body.team_id).toBe('d1');
		expect(up.body.save_as).toBe('draft');
		expect(JSON.parse(String(up.body.team_json)).phases[1].model).toBe('opus');
		expect(calls.some((c) => c.url === '/v1/teams/create')).toBe(false);
	});

	it('keyboard: Delete bridges the gap, ⌘Z undoes, ⌘D duplicates, Esc deselects', async () => {
		await open_draft();
		fireEvent.click(within(screen.getByTestId('outline')).getByText('build'));
		fireEvent.keyDown(window, { key: 'Delete' });
		expect(outline()).toEqual(['design', 'check']);
		// check now runs after design (bridged)
		fireEvent.click(within(screen.getByTestId('outline')).getByText('check'));
		expect(within(screen.getByRole('region', { name: 'Runs after' })).getByText('design')).toBeTruthy();
		fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(outline()).toEqual(['design', 'build', 'check']);
		fireEvent.click(within(screen.getByTestId('outline')).getByText('design'));
		fireEvent.keyDown(window, { key: 'd', metaKey: true });
		expect(outline()).toHaveLength(4);
		fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.getByTestId('team-panel')).toBeTruthy();
	});

	it('typing in a field does not trigger delete', async () => {
		await open_draft();
		fireEvent.click(within(screen.getByTestId('outline')).getByText('build'));
		fireEvent.keyDown(screen.getByLabelText('Model'), { key: 'Backspace' });
		expect(outline()).toEqual(['design', 'build', 'check']);
	});

	it('shows local problems instantly and Core-only errors when local checks pass', async () => {
		route_fetch({ 'build:validate': () => ({ body: { ok: true, data: { valid: false, errors: ['agent "claude-code" is not installed in any realm'], warnings: [] } } }) });
		vi.useFakeTimers({ shouldAdvanceTime: true });
		render_at('/builder?draft=d1');
		await screen.findByTestId('outline');
		expect(within(screen.getByTestId('status-pills')).getByText('✓ Valid workflow')).toBeTruthy();
		await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
		await waitFor(() => expect(within(screen.getByTestId('status-pills')).getByText('✕ 1 problem')).toBeTruthy());
		expect(screen.getByText(/not installed in any realm/)).toBeTruthy();
	});

	it('a local problem (gate with no checks) shows on the pill and the node', async () => {
		await open_draft();
		fireEvent.click(within(screen.getByTestId('outline')).getByText('check'));
		fireEvent.click(screen.getByLabelText('Remove command 1'));
		expect(within(screen.getByTestId('status-pills')).getByText(/✕ \d+ problem/)).toBeTruthy();
		expect(screen.getByTestId('problem-check')).toBeTruthy();
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
		await screen.findByTestId('outline');
		fireEvent.click(screen.getByRole('tab', { name: '✦ AI' }));
		fireEvent.change(screen.getByLabelText('Ask AI'), { target: { value: 'add a security scan' } });
		fireEvent.click(screen.getByText('Send'));
		expect(await screen.findByText('Added a security scan after design.')).toBeTruthy();
		expect(screen.getByTestId('preview-banner').textContent).toContain('+1');
		fireEvent.click(screen.getByText('Apply all'));
		expect(screen.queryByTestId('preview-banner')).toBeNull();
		fireEvent.click(screen.getByRole('tab', { name: 'Build' }));
		expect(outline()).toContain('security-scan');
		fireEvent.keyDown(window, { key: 'z', metaKey: true });
		expect(outline()).not.toContain('security-scan');
	});

	it('AI chat: Discard leaves the team untouched', async () => {
		route_fetch({ 'build:chat': () => ({ body: { ok: true, data: { reply: 'Plan ready.', actions: [{ type: 'REMOVE_PHASE', name: 'check' }] } } }) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('outline');
		fireEvent.click(screen.getByRole('tab', { name: '✦ AI' }));
		fireEvent.change(screen.getByLabelText('Ask AI'), { target: { value: 'remove the gate' } });
		fireEvent.click(screen.getByText('Send'));
		await screen.findByText('Plan ready.');
		fireEvent.click(screen.getByText('Discard'));
		expect(screen.getByText('Discarded.')).toBeTruthy();
		fireEvent.click(screen.getByRole('tab', { name: 'Build' }));
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
		expect(outline()).toContain('verify');
		act(() => { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'phases:\n  - name: a\n   bad: [' }, userEvent: 'input.type' }); });
		await act(async () => { await vi.advanceTimersByTimeAsync(500); });
		expect(screen.getByTestId('yaml-status').textContent).toMatch(/Can’t read this YAML/);
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
		fireEvent.click(screen.getByText('↓ Export'));
		expect(create).toHaveBeenCalled();
		expect(click).toHaveBeenCalled();
	});
});

describe('Graphite builder — publish', () => {
	it('first publish: 1.0.0 with the package, then the done screen', async () => {
		const calls = route_fetch({ '/v1/teams/publish': () => ({ body: { ok: true, data: { version: '1.0.0' } } }) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('outline');
		fireEvent.click(screen.getByText('Publish…'));
		const dlg = await screen.findByRole('dialog', { name: 'Publish team' });
		expect(await within(dlg).findByText('Publish 1.0.0')).toBeTruthy();
		expect(calls.filter((c) => c.url === '/v1/team_page/get')).toHaveLength(1);
		expect(calls.find((c) => c.url === '/v1/team_page/get')!.body).toMatchObject({ scope: 'measureone', name: 'feature-dev', view: 'installs' });
		fireEvent.click(within(dlg).getByText('Publish 1.0.0'));
		expect(await screen.findByTestId('publish-done')).toBeTruthy();
		const body = calls.find((c) => c.url === '/v1/teams/publish')!.body;
		expect(body).toMatchObject({ name: 'feature-dev', scope: 'measureone', version: '1.0.0', visibility: 'public' });
		const pkg = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(String(body.data_base64)), (c) => c.charCodeAt(0))));
		expect(pkg['team.yml']).toContain('name: feature-dev');
		expect(pkg.roles.map((r: { name: string }) => r.name)).toEqual(['design', 'build']);
	});

	it('next version: suggested bump, notes, private toggle, then upgrades ticked realms', async () => {
		const installs = [
			{ realm_id: 'r1', realm_slug: 'prod-us', realm_name: 'prod-us', org_slug: 'measureone', version: '1.0.0', behind: false, in_team_list: true, installed_count: 1, online_daemon_count: 1, last_run_at: null, missing_agents: [] },
			{ realm_id: 'r2', realm_slug: 'staging', realm_name: 'staging', org_slug: 'measureone', version: '1.0.0', behind: false, in_team_list: true, installed_count: 1, online_daemon_count: 1, last_run_at: null, missing_agents: [] },
		];
		const calls = route_fetch({
			'/v1/team_page/get': () => ({ body: { ok: true, data: { team: { latest_version: '1.0.0', status: 'published', listed: true }, installs: { items: installs, not_installed: [], realms_checked: 2, realms_total: 2 }, counts: {}, view: 'installs', partial: false } } }),
			'/v1/teams/publish': () => ({ body: { ok: true, data: { version: '1.1.0' } } }),
			'/v1/realms/add_team': () => ({ body: { ok: true, data: {} } }),
		});
		render_at('/builder?draft=d1');
		await screen.findByTestId('outline');
		fireEvent.click(screen.getByTestId('tile-agent'));
		fireEvent.click(screen.getByText('Publish…'));
		const dlg = await screen.findByRole('dialog', { name: 'Publish team' });
		await within(dlg).findByText('Publish 1.1.0'); // new phase → minor suggested
		expect((within(dlg).getByLabelText('Release notes') as HTMLTextAreaElement).value).toMatch(/agent/);
		fireEvent.click(within(dlg).getByRole('radio', { name: /Patch/ }));
		expect(within(dlg).getByText('Publish 1.0.1')).toBeTruthy();
		fireEvent.click(within(dlg).getByRole('radio', { name: /Minor/ }));
		fireEvent.click(within(dlg).getByLabelText(/Listed in Marketplace/));
		fireEvent.click(within(dlg).getByRole('checkbox', { name: /staging/ }));
		fireEvent.click(within(dlg).getByText('Publish 1.1.0'));
		await screen.findByTestId('publish-done');
		expect(calls.find((c) => c.url === '/v1/teams/publish')!.body).toMatchObject({ bump: 'minor', visibility: 'private' });
		const adds = calls.filter((c) => c.url === '/v1/realms/add_team');
		expect(adds.map((a) => a.body.realm_id)).toEqual(['r1']);
		expect(adds[0].body).toMatchObject({ scope: 'measureone', slug: 'feature-dev' });
		expect(screen.getByText('Upgraded prod-us.')).toBeTruthy();
	});

	it('version clash: shows Core’s message and re-bases the bump on the taken version', async () => {
		let n = 0;
		const calls = route_fetch({ '/v1/teams/publish': () => (++n === 1 ? { status: 409, body: { ok: false, error: { code: 'conflict', message: 'Version 1.0.0 already exists' } } } : { body: { ok: true, data: { version: '1.0.1' } } }) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('outline');
		fireEvent.click(screen.getByText('Publish…'));
		const dlg = await screen.findByRole('dialog', { name: 'Publish team' });
		fireEvent.click(await within(dlg).findByText('Publish 1.0.0'));
		expect((await within(dlg).findByRole('alert')).textContent).toMatch(/Version 1\.0\.0 already exists.*next version/);
		expect(within(dlg).getByRole('radio', { name: /Patch/ })).toHaveAttribute('aria-checked', 'true');
		fireEvent.click(within(dlg).getByText('Publish 1.0.1'));
		await screen.findByTestId('publish-done');
		const bodies = calls.filter((c) => c.url === '/v1/teams/publish').map((c) => c.body);
		expect(bodies[0]).toMatchObject({ version: '1.0.0' });
		expect(bodies[1]).toMatchObject({ bump: 'patch' });
		expect(bodies[1].version).toBeUndefined();
	});

	it('version_clash reads both Core messages', () => {
		expect(version_clash('Version 1.4.2 already exists')).toBe('1.4.2');
		expect(version_clash('Version 1.0.0 is older than the current latest (2.1.0). Publish a version >= 2.1.0.')).toBe('2.1.0');
		expect(version_clash('Package too large')).toBeNull();
	});

	it('errors block publishing', async () => {
		route_fetch();
		render_at('/builder?draft=d1');
		await screen.findByTestId('outline');
		fireEvent.click(within(screen.getByTestId('outline')).getByText('check'));
		fireEvent.click(screen.getByLabelText('Remove command 1'));
		fireEvent.click(screen.getByText('Publish…'));
		const dlg = await screen.findByRole('dialog', { name: 'Publish team' });
		const btn = await within(dlg).findByText('Publish 1.0.0');
		expect((btn as HTMLButtonElement).disabled).toBe(true);
		expect(within(dlg).getByText('Fix the errors above to publish.')).toBeTruthy();
	});
});

describe('Graphite builder — cancel', () => {
	const writes = (calls: Call[]) => calls.filter((c) => ['/v1/teams/create', '/v1/teams/update', '/v1/teams/delete'].includes(c.url));

	it('saved team with no working copy at open: Discard drops the copy this session made', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = await open_draft();
		fireEvent.click(within(screen.getByTestId('outline')).getByText('build'));
		fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'opus' } });
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/teams/update')).toBe(true));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(within(screen.getByTestId('cancel-confirm')).getByText('Discard your changes?')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams'));
		expect(calls.filter((c) => c.url === '/v1/teams/update').at(-1)!.body).toEqual({ team_id: 'd1', save_as: 'discard' });
		expect(calls.some((c) => c.url === '/v1/teams/delete')).toBe(false);
	});

	it('edits that never reached the server: Discard sends nothing', async () => {
		const calls = await open_draft();
		fireEvent.click(screen.getByTestId('tile-script'));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams'));
		expect(writes(calls)).toEqual([]);
	});

	it('new team that autosaved: Discard deletes that draft by id', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch();
		render_at();
		fireEvent.click((await screen.findAllByTestId('template'))[2]);
		await screen.findByTestId('outline');
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('draft=draft-9'));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.getByText('Discard this new team?')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams'));
		expect(calls.find((c) => c.url === '/v1/teams/delete')?.body).toEqual({ team_id: 'draft-9' });
	});

	it('published team (view mode): Discard sends nothing and goes back where it came from', async () => {
		sessionStorage.setItem(BUILDER_SESSION_KEYS.view, JSON.stringify(TEAM));
		const calls = route_fetch();
		render_at('/builder?view=1&from=%2Fteams%2Fmeasureone%2Ffeature-dev');
		await screen.findByTestId('outline');
		fireEvent.click(screen.getByTestId('tile-script'));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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
		await screen.findByTestId('outline');
		fireEvent.click(screen.getByTestId('tile-script'));
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(screen.getByTestId('loc').textContent).not.toContain('fork=1'));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.getByText('Discard this new team?')).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/browse'));
		expect(calls.find((c) => c.url === '/v1/teams/delete')?.body).toEqual({ team_id: 'draft-9' });
	});

	it('no changes: Cancel leaves at once, without asking or saving', async () => {
		const calls = await open_draft();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams'));
		expect(writes(calls)).toEqual([]);
	});

	it('Keep editing closes the prompt and keeps the edits', async () => {
		await open_draft();
		fireEvent.click(screen.getByTestId('tile-script'));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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
		await screen.findByTestId('outline');
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/teams/create')).toBe(true));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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

describe('Graphite builder — working copy', () => {
	const COPY = { ...TEAM, phases: [...TEAM.phases, { name: 'ship', type: 'standard' as const, agent: 'claude-code', depends_on: ['check'] }] };
	const detail = (extra: Record<string, unknown>) => () => ({ body: { ok: true, data: { id: 'd1', name: 'feature-dev', scope: 'measureone', status: 'published', visibility: 'public', latest_version: '1.2.0', team_json: JSON.stringify(TEAM), ...extra } } });

	it('opens the working copy when there is one, and says "unpublished changes" on a published team', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const calls = route_fetch({ '/v1/teams/get_by_id': detail({ draft: { manifest: JSON.stringify(COPY), description: null, saved_at: '2026-10-05T09:00:00.000Z' } }) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('outline');
		expect(outline()).toEqual(['design', 'build', 'check', 'ship']);
		fireEvent.click(screen.getByTestId('tile-script'));
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(screen.getByText(/unpublished changes · saved/)).toBeTruthy());
		expect(calls.find((c) => c.url === '/v1/teams/update')!.body).toMatchObject({ team_id: 'd1', save_as: 'draft' });
	});

	it('?fresh=1 starts from the published version; Cancel puts the old working copy back', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const copy = { manifest: JSON.stringify(COPY), description: 'wip', saved_at: '2026-10-05T09:00:00.000Z' };
		const calls = route_fetch({ '/v1/teams/get_by_id': detail({ draft: copy }) });
		render_at('/builder?draft=d1&fresh=1&from=%2Fteams%2Fmeasureone%2Ffeature-dev');
		await screen.findByTestId('outline');
		expect(outline()).toEqual(['design', 'build', 'check']);
		fireEvent.click(screen.getByTestId('tile-script'));
		await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/teams/update')).toBe(true));
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams/measureone/feature-dev'));
		expect(calls.filter((c) => c.url === '/v1/teams/update').at(-1)!.body).toEqual({ team_id: 'd1', description: 'wip', team_json: copy.manifest, save_as: 'draft' });
	});

	it('a published team whose manifest is YAML opens from its version detail (roles kept)', async () => {
		route_fetch({ '/v1/teams/get_by_id': detail({
			team_json: 'name: feature-dev\nphases: []', draft: null,
			workflow: { phases: TEAM.phases },
			roles: [{ name: 'design', content_md: '# design\nWrite the design.' }],
			agents: {},
		}) });
		render_at('/builder?draft=d1');
		await screen.findByTestId('outline');
		expect(outline()).toEqual(['design', 'build', 'check']);
	});
});
