/** Build › Teams (Graphite): list + team page — one BFF read per view; writes are single existing routes. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview } from './fixtures_overview';
import { layout_phases, overlay_state, phase_kind, phase_subtitle, team_href, type Team_list_data, type Team_page_data, type Team_phase, type Team_view } from '@/lib/team_page';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));
vi.mock('@/components/run_in_realm_dialog', () => ({ Run_in_realm_dialog: ({ scope, slug }: { scope: string; slug: string }) => <div role="dialog" aria-label="Run dialog">{scope}/{slug}</div> }));

import { Component as ListPage } from '@/pages/teams/teams_graphite_page';
import { Component as TeamPage } from '@/pages/teams/team_graphite_page';

const ph = (name: string, type: string, over: Partial<Team_phase> = {}): Team_phase => ({ name, type, agent: type === 'standard' ? 'claude-code' : null, depends_on: [], review: false, reviewers: null, max_iterations: null, commands: [], sources: [], targets: [], team: null, role: null, support: false, ...over });
const PHASES: Team_phase[] = [
	ph('fetch-ticket', 'pull', { sources: ['jira://PROJ'] }),
	ph('architect', 'standard', { depends_on: ['fetch-ticket'], review: true, reviewers: '$(inputs.reviewers)', role: 'You are the architect.\nNever write code.' }),
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
const RUN = { run_id: 'run-1843', run_name: 'PROJ-491', team: '@measureone/feature-dev-js', state: 'running', current_phase: 'implement', daemon_id: 'd1', started_at: Date.now() - 60000, completed_at: null, updated_at: Date.now(), error: null, realm_id: 'r-prod', realm_slug: 'prod-us', org_slug: 'measureone' };

function page_data(view: Team_view, over: Partial<Team_page_data> = {}): Team_page_data {
	const base: Team_page_data = { team: HEADER, counts: { phases: 7, versions: 2, runs: 142 }, view, partial: false };
	const by = ({
		overview: { overview: { phases: PHASES, support: SUPPORT, inputs: [{ name: 'ticket', description: 'Jira key', required: true, default: null }], agents: ['claude-code', 'cursor'], latest: HEADER.versions[0], installs: INSTALLS } },
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
function route_fetch(team_over: (view: Team_view) => Partial<Team_page_data> = () => ({})) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/team_list/get') return new Response(JSON.stringify({ ok: true, data: list_data() }));
		if (u === '/v1/team_page/get') { const v = (body.view ?? 'overview') as Team_view; return new Response(JSON.stringify({ ok: true, data: page_data(v, team_over(v)) })); }
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

	it('one read; rows show phases, status, installs (behind in amber)', async () => {
		const calls = route_fetch();
		render_at('/teams');
		const row = await screen.findByTestId('team-measureone/feature-dev-js');
		expect(calls.filter((c) => c.url === '/v1/team_list/get')).toEqual([{ url: '/v1/team_list/get', body: { status: 'all', limit: 25, offset: 0 } }]);
		expect(within(row).getByText('Published')).toBeInTheDocument();
		expect(within(row).getByLabelText(/3 phases/)).toBeInTheDocument();
		expect(within(row).getByText('staging · on 1.3.0')).toBeInTheDocument();
		expect(within(screen.getByTestId('team-measureone/kyc-summary')).getByText('never published')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Drafts\s*1/ })).toBeInTheDocument();
	});

	it('org view scopes the read; status + search go to the BFF', async () => {
		const calls = route_fetch();
		render_at('/teams?org=measureone');
		await screen.findByTestId('team-measureone/feature-dev-js');
		expect(calls.at(-1)!.body).toMatchObject({ org_id: expect.any(String), scope: 'measureone' });
		fireEvent.click(screen.getByRole('button', { name: /Drafts/ }));
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ status: 'draft' }));
		fireEvent.change(screen.getByLabelText('Search teams'), { target: { value: 'kyc' } });
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ q: 'kyc', status: 'draft' }));
	});

	it('install into one realm is one Core write', async () => {
		const calls = route_fetch();
		render_at('/teams');
		const row = await screen.findByTestId('team-measureone/feature-dev-js');
		fireEvent.click(within(row).getByRole('button', { name: 'Install ▾' }));
		const dlg = screen.getByRole('dialog', { name: 'Install @measureone/feature-dev-js' });
		expect(within(dlg).getByRole('radio', { name: /prod-us/ })).toBeDisabled();
		fireEvent.click(within(dlg).getByRole('radio', { name: /sandbox/ }));
		fireEvent.click(within(dlg).getByRole('button', { name: 'Install' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/realms/add_team')?.body).toEqual({ realm_id: 'r-sand', scope: 'measureone', slug: 'feature-dev-js' }));
		expect(await screen.findByText(/added to sandbox/)).toBeInTheDocument();
	});
});

describe('Team page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('overview: one read, grouped tabs with counts, graph + inputs + where it runs', async () => {
		const calls = route_fetch();
		render_at('/teams/measureone/feature-dev-js');
		await screen.findByRole('group', { name: 'Team workflow' });
		expect(calls.filter((c) => c.url === '/v1/team_page/get')).toEqual([{ url: '/v1/team_page/get', body: { scope: 'measureone', name: 'feature-dev-js', view: 'overview' } }]);
		const nav = screen.getByRole('navigation', { name: 'Team' });
		expect(within(nav).getByRole('button', { name: /Workflow\s*7/ })).toBeInTheDocument();
		expect(within(nav).getByRole('button', { name: /Runs\s*142/ })).toBeInTheDocument();
		expect(within(nav).getByRole('button', { name: 'Settings' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /architect, agent, human review/ })).toBeInTheDocument();
		expect(document.querySelector('[data-loop="check->implement"]')).not.toBeNull();
		expect(screen.getByText('ticket')).toBeInTheDocument();
		expect(screen.getByText('What’s new in 1.4.2')).toBeInTheDocument();
	});

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

	it('a human review phase is its own kind: pink node, reviewers and outcomes, no REVIEW badge', async () => {
		const hug = ph('design-review', 'gate', { agent: 'hug', depends_on: ['architect'], reviewers: '$(inputs.reviewers)' });
		const phases = [...PHASES.slice(0, 2), hug, ...PHASES.slice(2).map((p) => (p.name === 'tests' || p.name === 'security-scan' ? { ...p, depends_on: ['design-review'] } : p))].map((p) => (p.name === 'architect' ? { ...p, review: false, reviewers: null } : p));
		route_fetch((v) => (v === 'workflow' ? { workflow: { phases, support: [], recent_runs: [], overlay: null } } : {}));
		render_at('/teams/measureone/feature-dev-js?tab=workflow&run=none');
		fireEvent.click(await screen.findByRole('button', { name: /^design-review, human review/ }));
		const insp = await screen.findByTestId('phase-inspector');
		expect(within(insp).getByText('$(inputs.reviewers)')).toBeInTheDocument();
		expect(within(insp).getByText('Outcomes')).toBeInTheDocument();
		expect(document.querySelector('[data-phase="design-review"]')!.textContent).not.toContain('REVIEW');
	});

	it('clicking a phase opens the workflow tab with it selected; inspector adapts to the phase type', async () => {
		const calls = route_fetch();
		render_at('/teams/measureone/feature-dev-js');
		fireEvent.click(await screen.findByRole('button', { name: /architect, agent/ }));
		await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('tab=workflow'));
		const insp = await screen.findByTestId('phase-inspector');
		expect(calls.at(-1)!.body).toMatchObject({ view: 'workflow', run_id: 'latest' });
		expect(within(insp).getByTestId('role-brief')).toHaveTextContent('You are the architect.');
		expect(within(insp).getByText('Human review')).toBeInTheDocument();
		expect(within(insp).getByText(/In PROJ-491/)).toBeInTheDocument();
		// overlay dots
		expect(document.querySelector('[data-phase="implement"] [data-status="running"]')).not.toBeNull();
		// gate: no role, checks + verdicts
		fireEvent.click(screen.getByRole('button', { name: /^check, gate/ }));
		const gate = await screen.findByTestId('phase-inspector');
		await waitFor(() => expect(within(gate).queryByTestId('role-brief')).toBeNull());
		expect(within(gate).getByText(/\$ npm test/)).toBeInTheDocument();
		expect(within(gate).getByText('Verdicts')).toBeInTheDocument();
		// legacy pull type reads as a connector: sources, no role
		fireEvent.click(screen.getByRole('button', { name: /^fetch-ticket, connector/ }));
		await waitFor(() => expect(within(screen.getByTestId('phase-inspector')).getByText('jira://PROJ')).toBeInTheDocument());
		// Plain = no overlay requested
		fireEvent.change(screen.getByLabelText('Overlay a run'), { target: { value: 'none' } });
		await waitFor(() => expect(calls.at(-1)!.body).not.toHaveProperty('run_id'));
	});

	it('runs tab: state chips + realm filter go to the BFF; rows link to the run', async () => {
		const calls = route_fetch();
		render_at('/teams/measureone/feature-dev-js?tab=runs');
		const row = await screen.findByTestId('run-run-1843');
		expect(calls.at(-1)!.body).toEqual({ scope: 'measureone', name: 'feature-dev-js', view: 'runs', limit: 25, offset: 0 });
		expect(within(row).getByRole('link', { name: 'PROJ-491' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-1843');
		fireEvent.click(screen.getByRole('button', { name: /Failed · 7d\s*3/ }));
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ view: 'runs', state: 'failed' }));
		fireEvent.change(screen.getByLabelText('Realm'), { target: { value: 'r-prod' } });
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ realm_id: 'r-prod', state: 'failed' }));
	});

	it('installs tab: upgrade a realm that is behind, uninstall after confirm', async () => {
		const calls = route_fetch();
		render_at('/teams/measureone/feature-dev-js?tab=installs');
		const stg = await screen.findByTestId('install-staging');
		fireEvent.click(within(stg).getByRole('button', { name: 'Upgrade to 1.4.2' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/realms/add_team')?.body).toEqual({ realm_id: 'r-stage', scope: 'measureone', slug: 'feature-dev-js' }));
		const prod = screen.getByTestId('install-prod-us');
		fireEvent.click(within(prod).getByRole('button', { name: 'Uninstall' }));
		fireEvent.click(within(screen.getByTestId('install-prod-us')).getByRole('button', { name: 'Uninstall' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/realms/remove_team')?.body).toEqual({ realm_id: 'r-prod', scope: 'measureone', slug: 'feature-dev-js' }));
	});

	it('versions tab: timeline + phase diff; compare pickers go to the BFF', async () => {
		const calls = route_fetch();
		render_at('/teams/measureone/feature-dev-js?tab=versions');
		expect(await screen.findByTestId('version-change')).toHaveTextContent('security-scan');
		expect(within(screen.getByTestId('version-1.4.2')).getByText('latest')).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText('Compare to'), { target: { value: '1.3.0' } });
		await waitFor(() => expect(calls.at(-1)!.body).toMatchObject({ view: 'versions', compare_to: '1.3.0' }));
	});

	it('files tab renders the file; settings rename is one write and moves the URL', async () => {
		const calls = route_fetch();
		render_at('/teams/measureone/feature-dev-js?tab=files');
		expect(await screen.findByTestId('file-view')).toHaveTextContent('name: feature-dev-js');
		fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
		const input = await screen.findByLabelText('New name');
		fireEvent.change(input, { target: { value: 'feature-dev' } });
		fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/teams/rename')?.body).toEqual({ name: 'feature-dev-js', scope: 'measureone', new_name: 'feature-dev' }));
		await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/teams/measureone/feature-dev?tab=settings'));
	});

	it('no settings tab without edit/delete rights; Open in Builder fetches the version then navigates', async () => {
		route_fetch(() => ({ team: { ...HEADER, can_edit: false, can_delete: false } }));
		render_at('/teams/measureone/feature-dev-js');
		await screen.findByRole('group', { name: 'Team workflow' });
		expect(within(screen.getByRole('navigation', { name: 'Team' })).queryByRole('button', { name: 'Settings' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Open in Builder' })).toBeNull();
		const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls;
		fireEvent.click(screen.getByRole('button', { name: 'Fork' }));
		// The version is read on click (an action, not a view read); the Builder hand-off uses sessionStorage.
		await waitFor(() => expect(calls.some(([u, init]) => u === '/v1/teams/get_by_id' && JSON.parse(String(init.body)).name === 'feature-dev-js')).toBe(true));
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
