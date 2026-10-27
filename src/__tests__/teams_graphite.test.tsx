/** Build › Teams (Graphite): list + team page — one BFF read per view; writes are single existing routes. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview } from './fixtures_overview';
import { layout_phases, wrap_columns, overlay_state, phase_kind, phase_subtitle, team_href, type Team_list_data, type Team_page_data, type Team_phase, type Team_view } from '@/lib/team_page';

const auth = { scopes: [{ slug: 'sapan' }], user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));
vi.mock('@/components/run_in_realm_dialog', () => ({ Run_in_realm_dialog: ({ scope, slug }: { scope: string; slug: string }) => <div role="dialog" aria-label="Run dialog">{scope}/{slug}</div> }));

import { Component as ListPage } from '@/pages/teams/teams_graphite_page';
import { Component as TeamPage } from '@/pages/teams/team_graphite_page';
import { Workflow_graph } from '@/components/graphite/g_workflow_graph';

const ph = (name: string, type: string, over: Partial<Team_phase> = {}): Team_phase => ({ name, type, agent: type === 'standard' ? 'claude-code' : null, depends_on: [], review: false, reviewers: null, max_iterations: null, commands: [], sources: [], targets: [], team: null, role: null, support: false, ...over });
const PHASES: Team_phase[] = [
	ph('fetch-ticket', 'pull', { sources: ['jira://PROJ'] }),
	ph('architect', 'standard', { depends_on: ['fetch-ticket'], review: true, reviewers: '$(inputs.reviewers)', role: 'You are the architect.\nAsk {{inputs.reviewers}} before coding.' }),
	ph('tests', 'standard', { depends_on: ['architect'], agent: 'cursor' }),
	ph('security-scan', 'standard', { depends_on: ['architect'] }),
	ph('implement', 'standard', { depends_on: ['tests'], agent: 'cursor', role: 'Make tests pass.' }),
	ph('check', 'gate', { depends_on: ['implement', 'security-scan'], commands: ['npm test', 'npm run lint'], max_iterations: 3 }),
	ph('open-pr', 'push', { depends_on: ['check'], targets: ['github://acme/repo'] }),
];
const SUPPORT = [ph('git-resolver', 'standard', { support: true })];

function list_data(over: Partial<Team_list_data> = {}): Team_list_data {
	return {
		items: [
			{ id: 't1', name: 'feature-dev-js', scope: 'measureone', description: 'Ticket to PR', status: 'published', latest_version: '1.4.2', author: 'sapan', phase_types: ['pull', 'standard', 'gate'], installs: [
				{ realm_id: 'r-prod', realm_slug: 'prod-us', realm_name: 'prod-us', org_slug: 'measureone', version: '1.4.2', behind: false, in_team_list: true, installed_count: 5, online_daemon_count: 5, last_run_at: null, missing_agents: [] },
				{ realm_id: 'r-stage', realm_slug: 'staging', realm_name: 'staging', org_slug: 'measureone', version: '1.3.0', behind: true, in_team_list: true, installed_count: 3, online_daemon_count: 3, last_run_at: null, missing_agents: [] },
			] },
			{ id: 't2', name: 'kyc-summary', scope: 'measureone', description: 'KYC', status: 'draft', latest_version: null, author: 'ana', phase_types: null, installs: [] },
		],
		total: 2, offset: 0, limit: 25, counts: { all: 2, published: 1, draft: 1 }, realms_checked: 3, realms_total: 3, partial: false,
		...over,
	};
}

const HEADER = {
	id: 'tid', name: 'feature-dev-js', scope: 'measureone', label: '@measureone/feature-dev-js', description: 'Ticket to reviewed PR', status: 'published' as const,
	latest_version: '1.4.2', version: '1.4.2',
	versions: [{ version: '1.4.2', changelog: 'Parallel security scan', published_at: Date.now() - 86400000, is_latest: true }, { version: '1.3.0', changelog: null, published_at: Date.now() - 5 * 86400000, is_latest: false }],
	author: 'sapan', listed: true, tags: [], can_edit: true, can_delete: true, can_toggle_listing: true,
};
const INSTALLS = list_data().items[0].installs;
const INPUTS = [{ name: 'ticket', description: 'Jira key', required: true, default: null }, { name: 'reviewers', description: 'Who reviews the design', required: false, default: null }];
/** fetch-ticket uses {{inputs.ticket}}; architect's role brief uses {{inputs.reviewers}} (see PHASES). */
const TEAM_YML = [
	'name: feature-dev-js',
	'inputs:',
	'  - name: ticket',
	'  - name: reviewers',
	'phases:',
	'  - name: fetch-ticket',
	'    type: pull',
	'    sources: ["jira://{{inputs.ticket}}"]',
	'  - name: architect',
	'    type: standard',
	'  - name: implement',
	'    type: standard',
].join('\n');
const RUN = { run_id: 'run-1843', run_name: 'PROJ-491', team: '@measureone/feature-dev-js', state: 'running', current_phase: 'implement', daemon_id: 'd1', started_at: Date.now() - 60000, completed_at: null, updated_at: Date.now(), error: null, realm_id: 'r-prod', realm_slug: 'prod-us', org_slug: 'measureone' };

function page_data(view: Team_view, over: Partial<Team_page_data> = {}): Team_page_data {
	const base: Team_page_data = { team: HEADER, counts: { phases: 7, versions: 2, runs: 142 }, view, partial: false };
	const by = ({
		overview: { overview: { phases: PHASES, support: SUPPORT, inputs: INPUTS, agents: ['claude-code', 'cursor'], latest: HEADER.versions[0], installs: INSTALLS }, files: { files: [{ path: 'team.yml', kind: 'yaml' as const, content: TEAM_YML }, { path: 'roles/architect.md', kind: 'md' as const, content: 'You are the architect.' }] } },
		workflow: { workflow: { phases: PHASES, support: SUPPORT, recent_runs: [RUN], overlay: { run: RUN, version: '1.4.2', phases: null, statuses: { 'fetch-ticket': 'completed', architect: 'completed', implement: 'running' } } } },
		files: { files: { files: [{ path: 'team.yml', kind: 'yaml' as const, content: 'name: feature-dev-js\nphases:\n  - name: architect' }], } },
		runs: { runs: { items: [RUN], total: 142, offset: 0, limit: 25, counts: { all: 142, running: 1, awaiting_input: 2, failed_7d: 3 }, realms: [{ id: 'r-prod', slug: 'prod-us', name: 'prod-us', org_slug: 'measureone' }] } },
		installs: { installs: { items: INSTALLS, not_installed: [{ id: 'r-sand', slug: 'sandbox', name: 'sandbox', org_slug: 'acme-labs' }], realms_checked: 3, realms_total: 3 } },
		versions: { versions: { items: HEADER.versions, compare: { from: '1.3.0', to: '1.4.2', changes: [{ kind: 'added' as const, target: 'phase' as const, name: 'security-scan', detail: 'new standard phase after architect' }] } } },
		settings: {},
	} as Record<Team_view, Partial<Team_page_data>>)[view] ?? {};
	return { ...base, ...by, ...over };
}

type Call = { url: string; body: Record<string, unknown> };
/** `install` answers the multi-realm `realms/add_team` (default: everything installed). */
function route_fetch(team_over: (view: Team_view) => Partial<Team_page_data> = () => ({}), install?: (body: Record<string, unknown>) => Response | Promise<Response>) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/team_list/get') return new Response(JSON.stringify({ ok: true, data: list_data() }));
		if (u === '/v1/team_page/get') { const v = (body.view ?? 'overview') as Team_view; return new Response(JSON.stringify({ ok: true, data: page_data(v, team_over(v)) })); }
		if (u === '/v1/realms/add_team' && install && body.realm_ids) return install(body);
		if (u === '/v1/teams/get_by_id') return new Response(JSON.stringify({ ok: true, data: { name: 'feature-dev-js', description: 'x', workflow: { phases: [{ name: 'a', type: 'standard' }] }, roles: [], agents: {} } }));
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}

function Loc() { const l = useLocation(); return <output data-testid="loc">{l.pathname}{l.search}</output>; }
function render_at(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/teams" element={<><ListPage /><Loc /></>} />
				<Route path="/teams/:scope/:name" element={<><TeamPage /><Loc /></>} />
				<Route path="/o/:org/realms/:slug/teams/:scope/:name" element={<><TeamPage /><Loc /></>} />
				<Route path="/o/:org/realms/:slug/teams" element={<Loc />} />
				<Route path="/builder" element={<Loc />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('team page helpers', () => {
	it('lays phases out by longest path; gate loops back to its agent dependency', () => {
		const L = layout_phases(PHASES);
		expect(L.pos['fetch-ticket'].col).toBe(0);
		expect(L.pos.tests.col).toBe(2);
		expect(L.pos['security-scan'].col).toBe(2);
		expect(L.pos.check.col).toBe(4);
		expect(L.pos['open-pr'].col).toBe(5);
		expect(L.cols).toBe(6);
		expect(L.rows).toBe(2);
		expect(L.loops).toEqual([{ from: 'check', to: 'implement', max: 3 }]);
	});
	it('cuts cycles and ignores unknown deps', () => {
		const L = layout_phases([ph('a', 'standard', { depends_on: ['b', 'zzz'] }), ph('b', 'standard', { depends_on: ['a'] })]);
		expect(Object.keys(L.pos).sort()).toEqual(['a', 'b']);
	});
	it('keeps team.yml order within a step (author order is the layout)', () => {
		const a = layout_phases([ph('root', 'standard'), ph('zeta', 'standard', { depends_on: ['root'] }), ph('alpha', 'standard', { depends_on: ['root'] })]);
		expect(a.pos.zeta.row).toBeLessThan(a.pos.alpha.row);
		const b = layout_phases([ph('root', 'standard'), ph('alpha', 'standard', { depends_on: ['root'] }), ph('zeta', 'standard', { depends_on: ['root'] })]);
		expect(b.pos.alpha.row).toBeLessThan(b.pos.zeta.row);
		expect(layout_phases(PHASES).pos.tests.row).toBeLessThan(layout_phases(PHASES).pos['security-scan'].row);
	});
	it('wraps long flows into balanced bands, never breaking inside a route-back', () => {
		const chain = (n: number, over: Record<number, Partial<Team_phase>> = {}) => Array.from({ length: n }, (_, i) => ph(`p${i}`, 'standard', { depends_on: i ? [`p${i - 1}`] : [], ...over[i] }));
		expect(wrap_columns(layout_phases(PHASES)).every((c) => c.band === 0)).toBe(true);
		const seven = wrap_columns(layout_phases(chain(7)));
		expect(seven.map((c) => c.band)).toEqual([0, 0, 0, 0, 1, 1, 1]);
		expect(seven[4].col).toBe(0);
		// p4 is a gate routing back to p3: the break moves so both stay on one band.
		const looped = wrap_columns(layout_phases(chain(7, { 4: { type: 'gate', max_iterations: 2 } })));
		expect(looped[3].band).toBe(looped[4].band);
	});
	it('draws a wrapped flow with a connector between bands', () => {
		const long = Array.from({ length: 9 }, (_, i) => ph(`step-${i}`, 'standard', { depends_on: i ? [`step-${i - 1}`] : [] }));
		const { container } = render(<Workflow_graph phases={long} />);
		expect(container.querySelectorAll('[data-wrap]')).toHaveLength(1);
		expect(container.querySelector('[data-wrap]')?.getAttribute('data-edge')).toBe('step-4->step-5');
		const svg = container.querySelector('svg')!;
		expect(Number.parseFloat(svg.style.minWidth)).toBeGreaterThan(0);
	});
	it('subtitles, overlay states, hrefs', () => {
		expect(phase_subtitle(PHASES[0])).toBe('jira');
		expect(phase_subtitle(PHASES[5])).toBe('2 checks');
		expect(phase_subtitle(PHASES[6])).toBe('github');
		expect(overlay_state('completed')).toBe('done');
		expect(overlay_state('awaiting_input')).toBe('waiting');
		expect(overlay_state('crashed')).toBe('failed');
		expect(overlay_state(undefined)).toBe('idle');
		expect(team_href('measureone', 'x', 'runs')).toBe('/teams/measureone/x?tab=runs');
	});
});

describe('Build › Teams list', () => {
	afterEach(() => vi.restoreAllMocks());

	it('All tab by default: one read; rows show phases and latest, no status, installs or Open', async () => {
		const calls = route_fetch();
		render_at('/teams');
		const row = await screen.findByTestId('team-measureone/feature-dev-js');
		const reads = calls.filter((c) => c.url === '/v1/team_list/get');
		expect(reads).toHaveLength(1);
		expect(reads[0]!.body).toMatchObject({ status: 'all', limit: 25, offset: 0, scope: 'measureone' });
		expect(within(row).getByLabelText(/3 phases/)).toBeInTheDocument();
		expect(within(row).getByText('1.4.2')).toBeInTheDocument();
		expect(within(row).queryByText('Published')).toBeNull();
		expect(within(row).queryByText(/staging/)).toBeNull();
		expect(within(row).queryByRole('link', { name: 'Open' })).toBeNull();
		expect(screen.queryByRole('columnheader', { name: /Status|Installed in/ })).toBeNull();
		// Three tabs, with counts; no filters.
		expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['All2', 'Published1', 'Drafts1']);
		expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
		expect(screen.queryByLabelText('Search teams')).toBeNull();
		// The primary action is on the page, not in the top bar; no Marketplace.
		expect(within(screen.getByRole('main')).getByRole('link', { name: 'New team' })).toHaveAttribute('href', '/builder');
		expect(screen.queryByRole('link', { name: /Marketplace/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
	});

	it('org view scopes the read; Published and Drafts tabs read their status', async () => {
		const calls = route_fetch();
		render_at('/teams?org=measureone');
		await screen.findByTestId('team-measureone/feature-dev-js');
		expect(calls.at(-1)!.body).toMatchObject({ org_id: expect.any(String), scope: 'measureone', status: 'all' });
		fireEvent.click(screen.getByRole('tab', { name: /Published/ }));
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ status: 'published' }));
		fireEvent.click(screen.getByRole('tab', { name: /Drafts/ }));
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ status: 'draft' }));
		expect(screen.getByRole('tab', { name: /Drafts/ })).toHaveAttribute('aria-selected', 'true');
	});

	it('install from the list: realms of the current org only, one request with realm_ids', async () => {
		window.localStorage.setItem('cliqhub.last_org', 'acme-labs');
		const calls = route_fetch();
		render_at('/teams');
		const row = await screen.findByTestId('team-measureone/feature-dev-js');
		fireEvent.click(within(row).getByRole('button', { name: 'Install ▾' }));
		const dlg = screen.getByRole('dialog', { name: 'Install @measureone/feature-dev-js' });
		// Only this org's realms are offered.
		expect(within(dlg).queryByRole('checkbox', { name: /prod-us/ })).toBeNull();
		fireEvent.click(within(dlg).getByRole('checkbox', { name: /sandbox/ }));
		fireEvent.click(within(dlg).getByRole('button', { name: 'Install' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/realms/add_team')?.body).toEqual({ scope: 'measureone', slug: 'feature-dev-js', realm_ids: ['r-sand'] }));
		expect(await screen.findByText(/added to sandbox/)).toBeInTheDocument();
	});
});

describe('Team page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('phase kinds follow the builder model (type + agent)', () => {
		expect(phase_kind(ph('review', 'gate', { agent: 'hug' })).label).toBe('human review');
		expect(phase_kind(ph('check', 'gate', { agent: 'claude-code' })).label).toBe('gate');
		expect(phase_kind(ph('run', 'standard', { agent: 'exec' })).label).toBe('script');
		expect(phase_kind(ph('get', 'standard', { agent: 'curl' })).label).toBe('fetch');
		expect(phase_kind(ph('jira', 'standard', { agent: 'jira' })).label).toBe('connector');
		expect(phase_kind('human').color).not.toBe(phase_kind('gate').color);
		expect(phase_subtitle(ph('review', 'gate', { agent: 'hug', reviewers: '$(inputs.reviewers)' }))).toBe('reviewer · $(inputs.reviewers)');
		expect(phase_subtitle(ph('run', 'standard', { agent: 'exec', commands: ['a', 'b'] }))).toBe('2 commands');
	});

	it('one page, one read: header actions, workflow, inputs, versions, danger zone — no tabs', async () => {
		const calls = route_fetch();
		render_at('/teams/measureone/feature-dev-js');
		await screen.findByRole('group', { name: 'Team workflow' });
		const reads = calls.filter((c) => c.url === '/v1/team_page/get');
		expect(reads).toHaveLength(1);
		expect(reads[0]!.body).toMatchObject({ scope: 'measureone', name: 'feature-dev-js', view: 'overview' });
		expect(screen.queryByRole('navigation', { name: 'Team' })).toBeNull();
		for (const name of [/Fork/, /^Edit$/, /Install ▾/]) expect(screen.getByRole('button', { name })).toBeInTheDocument();
		for (const name of [/^Run/, /View YAML/, /Open in Builder/, /Compare/]) expect(screen.queryByRole('button', { name })).toBeNull();
		expect(screen.getByTestId('inputs')).toHaveTextContent('ticket');
		expect(within(screen.getByTestId('versions')).getByTestId('version-1.4.2')).toHaveTextContent('latest');
		expect(within(screen.getByTestId('danger-zone')).getByRole('button', { name: 'Unpublish…' })).toBeInTheDocument();
		expect(within(screen.getByTestId('danger-zone')).getByRole('button', { name: 'Delete team…' })).toBeInTheDocument();
		// No runs, installs list or rename on this page.
		expect(screen.queryByText(/Runs here|Manage installs|Rename/)).toBeNull();
	});

	it('picking a phase shows a line about it and highlights the inputs it uses', async () => {
		route_fetch();
		render_at('/teams/measureone/feature-dev-js');
		// The first phase is selected to begin with: fetch-ticket uses {{inputs.ticket}}.
		const line = await screen.findByTestId('selected-phase');
		expect(line).toHaveTextContent('fetch-ticket');
		// The phase is described under the diagram; its inputs are highlighted in Run inputs (left).
		expect(within(screen.getByTestId('workflow')).getByTestId('selected-phase')).toBe(line);
		expect(screen.getByTestId('inputs')).toHaveTextContent('fetch-ticket uses 1');
		expect(within(screen.getByTestId('inputs')).getAllByTestId(/^input-/).map((e) => e.dataset.testid)).toEqual(['input-ticket', 'input-reviewers']);
		expect(screen.getByTestId('input-ticket')).toHaveAttribute('data-used', 'true');
		expect(screen.getByTestId('input-reviewers')).not.toHaveAttribute('data-used');
		// architect's role brief uses {{inputs.reviewers}}.
		fireEvent.click(screen.getByRole('button', { name: /architect, agent/ }));
		await waitFor(() => expect(screen.getByTestId('selected-phase')).toHaveTextContent('architect'));
		expect(screen.getByTestId('selected-phase')).toHaveTextContent('You are the architect.');
		expect(screen.getByTestId('input-reviewers')).toHaveAttribute('data-used', 'true');
		expect(screen.getByTestId('input-ticket')).not.toHaveAttribute('data-used');
		expect(screen.getByTestId('inputs')).toHaveTextContent('architect uses 1');
		// Every input stays listed, in the team's order; only the highlight moves.
		expect(within(screen.getByTestId('inputs')).getAllByTestId(/^input-/).map((e) => e.dataset.testid)).toEqual(['input-ticket', 'input-reviewers']);
		expect(screen.getByTestId('loc').textContent).toContain('phase=architect');
	});

	it('Workflow has two modes: YAML shows team.yml at the selected phase; the choice is remembered', async () => {
		localStorage.removeItem('cliqhub.team_workflow_mode');
		route_fetch();
		const first = render_at('/teams/measureone/feature-dev-js?phase=architect');
		fireEvent.click(await screen.findByRole('tab', { name: 'YAML' }));
		const yaml = await screen.findByTestId('yaml-view');
		expect(within(yaml).getByText(/roles\/architect\.md/)).toBeInTheDocument();
		const hl = [...yaml.querySelectorAll('[data-line]')].filter((el) => el.className.includes('g-acc-soft')).map((el) => el.textContent);
		expect(hl.join('\n')).toContain('name: architect');
		expect(screen.getByTestId('selected-phase')).toHaveTextContent('architect');
		expect(localStorage.getItem('cliqhub.team_workflow_mode')).toBe('yaml');
		first.unmount();
		render_at('/teams/measureone/feature-dev-js');
		expect(await screen.findByTestId('yaml-view')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('tab', { name: 'Diagram' }));
		expect(await screen.findByRole('group', { name: 'Team workflow' })).toBeInTheDocument();
		localStorage.removeItem('cliqhub.team_workflow_mode');
	});

	it('old ?tab=files links open the YAML', async () => {
		localStorage.removeItem('cliqhub.team_workflow_mode');
		route_fetch();
		render_at('/teams/measureone/feature-dev-js?tab=files');
		expect(await screen.findByTestId('yaml-view')).toBeInTheDocument();
		localStorage.removeItem('cliqhub.team_workflow_mode');
	});

	it('Fork copies this version into your scope (next free name) and opens the copy', async () => {
		const calls = route_fetch();
		let tries = 0;
		const real = globalThis.fetch as unknown as { getMockImplementation: () => (u: unknown, i?: RequestInit) => Promise<Response> };
		const base = real.getMockImplementation();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			if (String(url) === '/v1/teams/create') {
				calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
				tries += 1;
				return tries === 1
					? new Response(JSON.stringify({ ok: false, error: { code: 'conflict', message: 'exists' } }), { status: 409 })
					: new Response(JSON.stringify({ ok: true, data: { id: 'new', name: 'feature-dev-js-fork-2', scope: 'sapan' } }));
			}
			return base(url, init);
		});
		render_at('/teams/measureone/feature-dev-js');
		fireEvent.click(await screen.findByRole('button', { name: /Fork/ }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams/sapan/feature-dev-js-fork-2'));
		expect(calls.filter((c) => c.url === '/v1/teams/create').map((c) => c.body)).toEqual([
			{ name: 'feature-dev-js-fork', scope: 'sapan', forked_from: { team_id: 'tid', version: '1.4.2' } },
			{ name: 'feature-dev-js-fork-2', scope: 'sapan', forked_from: { team_id: 'tid', version: '1.4.2' } },
		]);
	});

	it('Edit opens the team in the Builder; with unpublished changes it offers Resume or Start again', async () => {
		route_fetch();
		const first = render_at('/teams/measureone/feature-dev-js');
		fireEvent.click(await screen.findByRole('button', { name: /^Edit$/ }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/builder?draft=tid&from=%2Fteams%2Fmeasureone%2Ffeature-dev-js'));
		first.unmount();
		route_fetch(() => ({ team: { ...HEADER, draft_saved_at: new Date(Date.now() - 60_000).toISOString() } }));
		render_at('/teams/measureone/feature-dev-js');
		expect(await screen.findByTestId('unpublished-pill')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
		const dlg = screen.getByRole('dialog', { name: 'Edit' });
		fireEvent.click(within(dlg).getByRole('button', { name: 'Start from v1.4.2' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/builder?draft=tid&fresh=1&from=%2Fteams%2Fmeasureone%2Ffeature-dev-js'));
	});

	it('unpublished changes can be thrown away from the Edit menu (confirmed first)', async () => {
		const calls = route_fetch(() => ({ team: { ...HEADER, draft_saved_at: new Date(Date.now() - 60_000).toISOString() } }));
		render_at('/teams/measureone/feature-dev-js');
		fireEvent.click(await screen.findByRole('button', { name: /^Edit$/ }));
		const dlg = screen.getByRole('dialog', { name: 'Edit' });
		fireEvent.click(within(dlg).getByRole('button', { name: 'Throw away my changes…' }));
		fireEvent.click(within(dlg).getByRole('button', { name: 'Throw them away' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/teams/update')?.body).toEqual({ team_id: 'tid', save_as: 'discard' }));
		expect(await screen.findByText('Unpublished changes thrown away.')).toBeInTheDocument();
	});

	it('Versions: picking an older version reads that version', async () => {
		const calls = route_fetch();
		render_at('/teams/measureone/feature-dev-js');
		fireEvent.click(within(await screen.findByTestId('version-1.3.0')).getByRole('button'));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/team_page/get').at(-1)!.body).toMatchObject({ version: '1.3.0', view: 'overview' }));
	});

	it('Run inputs on the left (required/optional, description, used by — a click picks that phase); no Agents card; Versions under the workflow', async () => {
		route_fetch();
		render_at('/teams/measureone/feature-dev-js?phase=implement');
		const inputs = await screen.findByTestId('inputs');
		expect(screen.queryByTestId('agents')).toBeNull();
		expect(screen.queryByTestId('needs')).toBeNull();
		expect(within(inputs).getByRole('heading', { name: /^Run inputs/ })).toBeTruthy();
		// Left of the workflow.
		expect(inputs.compareDocumentPosition(screen.getByTestId('workflow')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(within(inputs).getByTestId('input-ticket')).toHaveTextContent('ticketrequiredJira keyused by fetch-ticket');
		expect(within(inputs).getByTestId('input-reviewers')).toHaveTextContent('optional');
		expect(within(inputs).getByTestId('input-reviewers')).toHaveTextContent('used by architect');
		fireEvent.click(within(within(inputs).getByTestId('input-reviewers')).getByRole('button', { name: 'architect' }));
		await waitFor(() => expect(screen.getByTestId('selected-phase')).toHaveTextContent('architect'));
		expect(within(inputs).getByTestId('input-reviewers')).toHaveAttribute('data-used', 'true');
		const [wf, ver] = [screen.getByTestId('workflow'), screen.getByTestId('versions')];
		expect(wf.compareDocumentPosition(ver) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		// The danger zone is folded until opened.
		expect(screen.getByTestId('danger-zone')).not.toHaveAttribute('open');
	});

	it('Versions: full release notes behind “more”', async () => {
		const notes = 'Parallel security scan\nFaster checks\nNew reviewer step';
		route_fetch(() => ({ team: { ...HEADER, versions: [{ ...HEADER.versions[0], changelog: notes }, HEADER.versions[1]] } }));
		render_at('/teams/measureone/feature-dev-js');
		const row = await screen.findByTestId('version-1.4.2');
		expect(within(row).queryByTestId('notes-1.4.2')).toBeNull();
		expect(row).toHaveTextContent('Parallel security scan');
		fireEvent.click(within(row).getByRole('button', { name: 'more' }));
		expect(within(row).getByTestId('notes-1.4.2').textContent).toBe(notes);
		fireEvent.click(within(row).getByRole('button', { name: 'less' }));
		expect(within(row).queryByTestId('notes-1.4.2')).toBeNull();
		// No Compare anywhere.
		expect(screen.queryByRole('button', { name: /Compare/ })).toBeNull();
	});

	it('Versions: at most 5 per page, newest first, with a pager', async () => {
		const many = Array.from({ length: 12 }, (_, i) => ({ version: `1.${11 - i}.0`, changelog: null, published_at: Date.now() - i * 86400000, is_latest: i === 0 }));
		route_fetch(() => ({ team: { ...HEADER, latest_version: '1.11.0', version: '1.11.0', versions: many } }));
		render_at('/teams/measureone/feature-dev-js');
		const card = await screen.findByTestId('versions');
		const shown = () => within(card).getAllByTestId(/^version-/).map((e) => e.dataset.testid);
		expect(shown()).toEqual(['version-1.11.0', 'version-1.10.0', 'version-1.9.0', 'version-1.8.0', 'version-1.7.0']);
		expect(within(card).getByTestId('versions-pager')).toHaveTextContent('1–5 of 12');
		fireEvent.click(within(card).getByRole('button', { name: 'Older versions' }));
		fireEvent.click(within(card).getByRole('button', { name: 'Older versions' }));
		expect(shown()).toEqual(['version-1.1.0', 'version-1.0.0']);
		expect(within(card).getByRole('button', { name: 'Older versions' })).toBeDisabled();
	});

	it('Danger zone: Unpublish and Delete are separate, each confirmed first', async () => {
		const calls = route_fetch();
		render_at('/teams/measureone/feature-dev-js');
		const dz = await screen.findByTestId('danger-zone');
		expect(dz).toHaveTextContent('Removes it from every realm that has it');
		fireEvent.click(within(dz).getByRole('button', { name: 'Unpublish…' }));
		fireEvent.click(within(dz).getByRole('button', { name: 'Uninstall everywhere and unpublish' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/teams/unpublish')?.body).toEqual({ name: 'feature-dev-js', scope: 'measureone' }));
		fireEvent.click(within(screen.getByTestId('danger-zone')).getByRole('button', { name: 'Delete team…' }));
		fireEvent.click(within(screen.getByTestId('danger-zone')).getByRole('button', { name: 'Delete feature-dev-js' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/teams/delete')?.body).toEqual({ name: 'feature-dev-js', scope: 'measureone' }));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/teams'));
	});

	it('opened from a realm: the realm header stays on top; the team sits under Teams in the left nav, with a crumb back', async () => {
		route_fetch();
		render_at('/o/measureone/realms/prod-us/teams/measureone/feature-dev-js');
		await screen.findByTestId('workflow');
		expect(screen.getByTestId('realm-header')).toBeInTheDocument();
		const nav = screen.getByTestId('realm-nav');
		expect(within(nav).getByTestId('go-teams')).toHaveAttribute('href', '/o/measureone/realms/prod-us/teams');
		expect(within(nav).getByTestId('nav-item')).toHaveTextContent('feature-dev-js');
		expect(within(nav).getByTestId('nav-item')).toHaveAttribute('aria-current', 'page');
		expect(within(screen.getByRole('navigation', { name: 'Back to teams' })).getByRole('link')).toHaveAttribute('href', '/o/measureone/realms/prod-us/teams');
		expect(screen.getAllByRole('navigation', { name: 'Breadcrumb' })).toHaveLength(1); // the top bar's only
	});

	it('opened from a realm: read-only at the version installed there — one title, no version picker, history, actions or danger zone', async () => {
		route_fetch();
		render_at('/o/measureone/realms/prod-us/teams/measureone/feature-dev-js?v=1.4.2');
		await screen.findByTestId('workflow');
		expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1); // the realm's
		expect(screen.getByTestId('team-title')).toHaveTextContent('feature-dev-js');
		expect(screen.getByTestId('installed-version')).toHaveTextContent('v1.4.2 installed here');
		expect(screen.queryByRole('combobox', { name: 'Version' })).toBeNull();
		for (const name of [/Fork/, /^Download$/, /^Edit$/, /Install/]) expect(screen.queryByRole('button', { name })).toBeNull();
		expect(screen.queryByTestId('versions')).toBeNull();
		expect(screen.queryByTestId('danger-zone')).toBeNull();
	});

	it('opened from a realm: Phases — the graph starts at the Run inputs; the table lists the inputs, then the phases; picking one picks it in both', async () => {
		route_fetch();
		render_at('/o/measureone/realms/prod-us/teams/measureone/feature-dev-js?v=1.4.2');
		const table = await screen.findByTestId('phase-table');
		// No side cards: inputs and agents are in the table.
		expect(screen.queryByTestId('needs')).toBeNull();
		expect(screen.queryByTestId('selected-phase')).toBeNull();
		expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Phases', 'YAML']);
		expect(within(table).getAllByTestId('team-phase-row').map((r) => r.getAttribute('data-team-row'))).toEqual([...PHASES.map((p) => p.name), 'git-resolver']);
		expect(within(table).getByTestId('inputs-row')).toHaveTextContent('2 inputs · 1 required');
		// Nothing open until picked.
		expect(screen.queryByTestId('inputs-open')).toBeNull();
		expect(screen.queryByTestId('phase-open')).toBeNull();

		// The graph's start node → the inputs row opens: each input, and the phases that use it.
		const start = screen.getByRole('button', { name: 'Run inputs: ticket (required), reviewers' });
		fireEvent.click(start);
		const open = await screen.findByTestId('inputs-open');
		expect(within(open).getByTestId('input-ticket')).toHaveTextContent('ticketJira keyyes—fetch-ticket');
		expect(within(open).getByTestId('input-reviewers')).toHaveTextContent('architect');
		expect(start).toHaveAttribute('aria-pressed', 'true');
		expect(screen.getByTestId('loc').textContent).toContain('phase=%40inputs');

		// A row → its node is picked, and the row opens.
		fireEvent.click(within(table).getAllByTestId('team-phase-row').find((r) => r.getAttribute('data-team-row') === 'architect')!);
		await waitFor(() => expect(document.querySelector('[data-phase="architect"]')).toHaveAttribute('aria-pressed', 'true'));
		expect(screen.queryByTestId('inputs-open')).toBeNull();
		const arch = screen.getByTestId('phase-open');
		expect(arch).toHaveTextContent('Runs afterfetch-ticket');
		expect(arch).toHaveTextContent('Uses inputsreviewers');
		expect(within(arch).getByTestId('phase-brief')).toHaveTextContent('You are the architect.');
		// The architect's line reads the input reference in words.
		expect(within(table).getAllByTestId('team-phase-row').find((r) => r.getAttribute('data-team-row') === 'architect')).toHaveTextContent('You are the architect.');

		// A node → its row opens.
		fireEvent.click(document.querySelector('[data-phase="check"]')!);
		await waitFor(() => expect(within(table).getAllByTestId('team-phase-row').find((r) => r.getAttribute('data-team-row') === 'check')).toHaveAttribute('aria-expanded', 'true'));
		expect(screen.getByTestId('phase-open')).toHaveTextContent('npm test');
		expect(screen.getByTestId('phase-open')).toHaveTextContent('up to 3');
	});

	it('opened from a realm: Run… runs it here', async () => {
		route_fetch();
		render_at('/o/measureone/realms/prod-us/teams/measureone/feature-dev-js?v=1.4.2');
		await screen.findByTestId('phase-table');
		fireEvent.click(screen.getByRole('button', { name: 'Run…' }));
		expect(screen.getByRole('dialog', { name: 'Run dialog' })).toHaveTextContent('measureone/feature-dev-js');
	});

	it('opened from a realm: its danger zone uninstalls it from that realm (one write), then back to the realm\'s teams', async () => {
		const calls = route_fetch();
		render_at('/o/measureone/realms/prod-us/teams/measureone/feature-dev-js?v=1.4.2');
		const dz = await screen.findByTestId('realm-danger-zone');
		expect(dz).toHaveTextContent('Uninstall from prod-us');
		fireEvent.click(within(dz).getByRole('button', { name: 'Uninstall…' }));
		fireEvent.click(within(dz).getByRole('button', { name: 'Uninstall feature-dev-js' }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/realms/remove_team').map((c) => c.body)).toEqual([{ realm_id: 'r-prod', scope: 'measureone', slug: 'feature-dev-js' }]));
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/o/measureone/realms/prod-us/teams'));
	});

	it('opened from the Teams list: no realm header', async () => {
		route_fetch();
		render_at('/teams/measureone/feature-dev-js');
		await screen.findByTestId('workflow');
		expect(screen.queryByTestId('realm-header')).toBeNull();
	});

	it('no pencil and no rename on the team page (Edit, in the Builder, covers it)', async () => {
		route_fetch();
		render_at('/teams/measureone/feature-dev-js');
		await screen.findByTestId('workflow');
		expect(screen.queryByRole('button', { name: /Edit team details|Rename/ })).toBeNull();
		expect(screen.getByRole('button', { name: /^Edit$/ })).toBeInTheDocument();
	});

	it('Unpublish refused by Core (a realm you can’t remove it from): the reason shows, nothing else happens', async () => {
		route_fetch();
		const base = (globalThis.fetch as unknown as { getMockImplementation: () => (u: unknown, i?: RequestInit) => Promise<Response> }).getMockImplementation();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => (String(url) === '/v1/teams/unpublish'
			? new Response(JSON.stringify({ ok: false, error: { code: 'unpublish_blocked', message: 'Not unpublished: you can’t remove it from prod-us.' } }), { status: 403 })
			: base(url, init)));
		render_at('/teams/measureone/feature-dev-js');
		const dz = await screen.findByTestId('danger-zone');
		fireEvent.click(within(dz).getByRole('button', { name: 'Unpublish…' }));
		fireEvent.click(within(dz).getByRole('button', { name: 'Uninstall everywhere and unpublish' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Not unpublished: you can’t remove it from prod-us.');
	});

	it('Download fetches the viewed version’s package', async () => {
		const calls = route_fetch();
		const base = (globalThis.fetch as unknown as { getMockImplementation: () => (u: unknown, i?: RequestInit) => Promise<Response> }).getMockImplementation();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			if (String(url) === '/v1/teams/download') {
				calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
				return new Response(JSON.stringify({ ok: true, data: { filename: 'feature-dev-js-1.4.2.zip', data_base64: btoa('zip'), version: '1.4.2' } }));
			}
			return base(url, init);
		});
		const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		render_at('/teams/measureone/feature-dev-js');
		fireEvent.click(await screen.findByRole('button', { name: /^Download$/ }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/teams/download')?.body).toEqual({ name: 'feature-dev-js', scope: 'measureone', version: '1.4.2' }));
		await waitFor(() => expect(create).toHaveBeenCalled());
	});

	it('without edit or delete rights: no Edit and no Danger zone', async () => {
		route_fetch(() => ({ team: { ...HEADER, can_edit: false, can_delete: false } }));
		render_at('/teams/measureone/feature-dev-js');
		await screen.findByTestId('workflow');
		expect(screen.queryByRole('button', { name: /^Edit$/ })).toBeNull();
		expect(screen.queryByTestId('danger-zone')).toBeNull();
		expect(screen.getByRole('button', { name: /Fork/ })).toBeInTheDocument();
	});

	/** The team with no installs yet, so both measureone realms can be picked. */
	const NOT_INSTALLED = (v: Team_view): Partial<Team_page_data> => (v === 'overview' ? { overview: { ...page_data('overview').overview!, installs: [] } } : {});

	it('Install dialog: several realms in one request; the button is busy while it runs', async () => {
		let release!: (r: Response) => void;
		const calls = route_fetch(NOT_INSTALLED, () => new Promise<Response>((res) => { release = res; }));
		render_at('/teams/measureone/feature-dev-js');
		fireEvent.click(await screen.findByRole('button', { name: 'Install ▾' }));
		const dlg = screen.getByRole('dialog', { name: 'Install @measureone/feature-dev-js' });
		fireEvent.click(within(dlg).getByRole('checkbox', { name: /staging/ }));
		fireEvent.click(within(dlg).getByRole('checkbox', { name: /prod-us/ }));
		fireEvent.click(within(dlg).getByRole('button', { name: 'Install in 2 realms' }));
		const busy = await within(dlg).findByRole('button', { name: 'Installing…' });
		expect(busy).toBeDisabled();
		expect(within(dlg).getByRole('checkbox', { name: /staging/ })).toBeDisabled();
		expect(calls.find((c) => c.url === '/v1/realms/add_team')?.body).toEqual({ scope: 'measureone', slug: 'feature-dev-js', realm_ids: ['r-stage', 'r-prod'] });
		release(new Response(JSON.stringify({ ok: true, data: { installed: [{ realm_id: 'r-stage', realm_slug: 'staging' }, { realm_id: 'r-prod', realm_slug: 'prod-us' }] } })));
		expect(await screen.findByText(/added to staging, prod-us/)).toBeInTheDocument();
		expect(screen.queryByRole('dialog', { name: /Install/ })).toBeNull();
	});

	it('Install dialog: a realm without permission blocks the install; it is marked, fixed, and the retry succeeds', async () => {
		let attempt = 0;
		const calls = route_fetch(NOT_INSTALLED, (body) => {
			attempt += 1;
			if (attempt === 1) {
				return new Response(JSON.stringify({ ok: false, error: {
					code: 'install_blocked', message: 'Nothing was installed. Fix this realm and try again — prod-us: You can only view this realm; installing needs operator or admin.',
					details: { failed: [{ realm_id: 'r-prod', realm_slug: 'prod-us', code: 'level_too_low', error: 'You can only view this realm; installing needs operator or admin.' }] },
				} }), { status: 403 });
			}
			return new Response(JSON.stringify({ ok: true, data: { installed: (body.realm_ids as string[]).map((id) => ({ realm_id: id, realm_slug: id })) } }));
		});
		render_at('/teams/measureone/feature-dev-js');
		fireEvent.click(await screen.findByRole('button', { name: 'Install ▾' }));
		const dlg = screen.getByRole('dialog', { name: 'Install @measureone/feature-dev-js' });
		fireEvent.click(within(dlg).getByRole('checkbox', { name: /staging/ }));
		fireEvent.click(within(dlg).getByRole('checkbox', { name: /prod-us/ }));
		fireEvent.click(within(dlg).getByRole('button', { name: 'Install in 2 realms' }));
		expect(await within(dlg).findByRole('alert')).toHaveTextContent(/Nothing was installed.*Untick the marked realms/);
		expect(within(screen.getByTestId('install-realm-prod-us')).getByText(/only view this realm/)).toBeInTheDocument();
		// The selection is kept; untick the failing realm and try again.
		expect(within(dlg).getByRole('checkbox', { name: /staging/ })).toBeChecked();
		fireEvent.click(within(dlg).getByRole('checkbox', { name: /prod-us/ }));
		expect(within(screen.getByTestId('install-realm-prod-us')).queryByText(/only view/)).toBeNull();
		fireEvent.click(within(dlg).getByRole('button', { name: 'Install' }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/realms/add_team').at(-1)?.body).toEqual({ scope: 'measureone', slug: 'feature-dev-js', realm_ids: ['r-stage'] }));
		expect(await screen.findByText(/added to staging/)).toBeInTheDocument();
	});

	it('Install dialog: Core refuses one realm after the check — installed ones are marked, the rest stay to fix', async () => {
		route_fetch(NOT_INSTALLED, () => new Response(JSON.stringify({ ok: false, error: {
			code: 'install_incomplete', message: 'Installed in staging. Installation was not successful on prod-us — prod-us: Realm is archived',
			details: { installed: [{ realm_id: 'r-stage', realm_slug: 'staging' }], failed: [{ realm_id: 'r-prod', realm_slug: 'prod-us', code: 'conflict', error: 'Realm is archived' }] },
		} }), { status: 409 }));
		render_at('/teams/measureone/feature-dev-js');
		fireEvent.click(await screen.findByRole('button', { name: 'Install ▾' }));
		const dlg = screen.getByRole('dialog', { name: 'Install @measureone/feature-dev-js' });
		fireEvent.click(within(dlg).getByRole('checkbox', { name: /staging/ }));
		fireEvent.click(within(dlg).getByRole('checkbox', { name: /prod-us/ }));
		fireEvent.click(within(dlg).getByRole('button', { name: 'Install in 2 realms' }));
		expect(await within(dlg).findByRole('alert')).toHaveTextContent('Installation was not successful on prod-us');
		expect(within(screen.getByTestId('install-realm-staging')).getByText('installed')).toBeInTheDocument();
		expect(within(screen.getByTestId('install-realm-prod-us')).getByText('Realm is archived')).toBeInTheDocument();
		// Closing reports what was added.
		fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
		expect(await screen.findByText(/added to staging\./)).toBeInTheDocument();
	});

	it('404 shows the blocking error', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			const u = String(url);
			if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
			if (u === '/v1/getting_started/get') return gs_response(u)!;
			return new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Team not found' } }), { status: 404 });
		});
		render_at('/teams/measureone/nope');
		expect(await screen.findByRole('alert')).toBeInTheDocument();
	});
});
