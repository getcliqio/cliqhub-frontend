/** New run drawer: one team_page/get { view: 'run' } read, one runs/enqueue write. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { Team_page_data, Team_run_form } from '@/lib/team_page';

const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'sapan' }, scopes: [] }), useAuthFetch: () => stable_fetch }));

import { New_run_drawer, cli_command, type New_run_prefill } from '@/components/graphite/g_new_run';

const install = (realm_id: string, realm_slug: string, installed = 4) => ({
	realm_id, realm_slug, realm_name: realm_slug, org_slug: 'measureone', version: '1.4.2', behind: false, in_team_list: true,
	installed_count: installed, online_daemon_count: 5, last_run_at: null, missing_agents: [],
});
const FORM: Team_run_form = {
	realms: [install('r-prod', 'prod-us'), install('r-stage', 'staging', 0)], realm_id: 'r-prod',
	inputs: [{ name: 'ticket', description: 'Jira issue key', required: true, default: null }, { name: 'base_branch', description: null, required: false, default: 'main' }],
	human_phases: [{ name: 'design-review', default_reviewers: 'priya' }],
	people: [{ username: 'priya', role: 'operator' }, { username: 'sapan', role: 'owner' }],
	channels: [{ name: 'payments-eng', enabled: true, types: ['slack'] }, { name: 'off', enabled: false, types: [] }],
};

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(form: Team_run_form = FORM, enqueue: { status: number; body: unknown } = { status: 200, body: { ok: true, data: { item: { status: 'claimed', run_id: 'run-77' } } } }) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/team_page/get') {
			const data = { team: { label: `@${body.scope}/${body.name}`, latest_version: '1.4.2' }, view: 'run', counts: { phases: 1, versions: 1, runs: 0 }, partial: false, run: form } as unknown as Team_page_data;
			return new Response(JSON.stringify({ ok: true, data }));
		}
		if (u === '/v1/realm_teams/get') return new Response(JSON.stringify({ ok: true, data: { items: [{ scope: 'cliq', slug: 'feature-dev-js', label: '@cliq/feature-dev-js', version: '1.4.2', in_team_list: true, installed_count: 4, online_daemon_count: 5 }, { scope: null, slug: 'local', label: 'local', version: null, in_team_list: false, installed_count: 1, online_daemon_count: 5 }] } }));
		if (u === '/v1/runs/enqueue') return new Response(JSON.stringify(enqueue.body), { status: enqueue.status });
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}

function Loc() { const l = useLocation(); return <output data-testid="loc">{l.pathname}</output>; }
function show(props: Partial<Parameters<typeof New_run_drawer>[0]> = {}) {
	const on_close = vi.fn();
	render(
		<MemoryRouter initialEntries={['/x']}>
			<Routes><Route path="*" element={<><New_run_drawer team={{ scope: 'cliq', slug: 'feature-dev-js' }} on_close={on_close} {...props} /><Loc /></>} /></Routes>
		</MemoryRouter>,
	);
	return on_close;
}
const drawer = () => screen.getByRole('dialog', { name: 'New run' });

afterEach(() => { vi.restoreAllMocks(); });

describe('cli_command', () => {
	it('quotes values that need it and skips blanks', () => {
		expect(cli_command('@cliq/x', { ticket: 'PROJ-1', note: "it's here", empty: ' ' }, '')).toBe("cliq run -t @cliq/x -i ticket=PROJ-1 -i 'note=it'\\''s here'");
		expect(cli_command('@cliq/x', {}, 'nightly')).toBe('cliq run -t @cliq/x --name nightly');
	});
});

describe('New run drawer', () => {
	it('shows the team with daemon coverage, its inputs with defaults, and the CLI equivalent', async () => {
		const calls = route_fetch();
		show();
		expect(await within(drawer()).findByText('4/5 daemons')).toBeInTheDocument();
		expect(calls[0]).toEqual({ url: '/v1/team_page/get', body: { scope: 'cliq', name: 'feature-dev-js', view: 'run' } });
		await waitFor(() => expect(within(drawer()).getByRole('textbox', { name: 'base_branch' })).toHaveValue('main'));
		expect(within(drawer()).getByRole('button', { name: /Start run/ })).toBeDisabled();
		fireEvent.change(within(drawer()).getByRole('textbox', { name: 'ticket' }), { target: { value: 'PROJ-491' } });
		expect(screen.getByTestId('cli-preview')).toHaveTextContent('$ cliq run -t @cliq/feature-dev-js -i ticket=PROJ-491 -i base_branch=main');
		expect(within(drawer()).getByText('1 human review on the way')).toBeInTheDocument();
		expect(within(drawer()).getByRole('combobox', { name: 'Realm' })).toHaveValue('r-prod');
	});

	it('starts with reviewers, a channel override and a workspace; ⌘↵ submits and opens the run', async () => {
		const calls = route_fetch();
		const on_close = show();
		const d = drawer();
		fireEvent.change(await within(d).findByRole('textbox', { name: 'ticket' }), { target: { value: 'PROJ-491' } });
		const rev = within(d).getByRole('group', { name: 'Reviewers for design-review' });
		expect(rev).toHaveTextContent('Team default: priya');
		fireEvent.click(within(rev).getByRole('button', { name: 'add' }));
		fireEvent.change(within(rev).getByRole('combobox', { name: 'Add to Reviewers for design-review' }), { target: { value: 'sapan' } });
		fireEvent.click(within(d).getByRole('radio', { name: /In a folder on the daemon/ }));
		fireEvent.change(within(d).getByRole('textbox', { name: 'Workspace path' }), { target: { value: '~/src/payments-api' } });
		fireEvent.click(within(d).getByRole('button', { name: /More options/ }));
		const notify = within(d).getByRole('group', { name: 'Notify channels' });
		fireEvent.click(within(notify).getByRole('button', { name: 'add' }));
		const pick = within(notify).getByRole('combobox');
		expect(within(pick).queryByRole('option', { name: 'off' })).toBeNull();
		fireEvent.change(pick, { target: { value: 'payments-eng' } });
		fireEvent.change(within(d).getByRole('textbox', { name: 'Extra inputs' }), { target: { value: 'region=us-west' } });
		fireEvent.keyDown(document, { key: 'Enter', metaKey: true });
		await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/o/measureone/realms/prod-us/runs/run-77'));
		expect(calls.find((c) => c.url === '/v1/runs/enqueue')!.body).toEqual({
			realm_id: 'r-prod',
			payload: { team_id: 'cliq/feature-dev-js', inputs: { ticket: 'PROJ-491', base_branch: 'main', region: 'us-west' }, workspace_path: '~/src/payments-api' },
			reviewers: { 'design-review': ['sapan'] },
			notify_channels: ['payments-eng'],
		});
		expect(on_close).toHaveBeenCalled();
	});

	it('names reviewers Core could not find', async () => {
		route_fetch(FORM, { status: 422, body: { ok: false, error: 'Unknown reviewers: ghost', code: 'invalid_params', details: { field: 'reviewers', unknown: ['ghost'] } } });
		show();
		fireEvent.change(await within(drawer()).findByRole('textbox', { name: 'ticket' }), { target: { value: 'X-1' } });
		fireEvent.click(within(drawer()).getByRole('button', { name: /Start run/ }));
		expect(await within(drawer()).findByRole('alert')).toHaveTextContent('Reviewers not found: ghost');
	});

	it('a queued run that no daemon took is reported, not hidden', async () => {
		route_fetch(FORM, { status: 200, body: { ok: true, data: { item: { status: 'queued' } } } });
		show();
		fireEvent.change(await within(drawer()).findByRole('textbox', { name: 'ticket' }), { target: { value: 'X-1' } });
		fireEvent.click(within(drawer()).getByRole('button', { name: /Start run/ }));
		expect(await within(drawer()).findByRole('alert')).toHaveTextContent('no daemon has picked it up yet');
	});

	it('when no realm has the team, offers to add it to one', async () => {
		route_fetch({ ...FORM, realms: [], realm_id: null });
		const on_add = vi.fn();
		show({ on_add_to_realm: on_add });
		fireEvent.click(await within(drawer()).findByRole('button', { name: 'Add to a realm' }));
		expect(on_add).toHaveBeenCalled();
	});

	it('Run again: prefilled inputs and name, extras opened, fixed realm, Esc closes', async () => {
		const calls = route_fetch();
		const prefill: New_run_prefill = { inputs: { ticket: 'PROJ-9', region: 'eu' }, run_name: 'PROJ-9 (rerun)', source_run_id: 'run-1234567890' };
		const on_close = show({ prefill, realm: { id: 'r-prod', slug: 'prod-us', org_slug: 'measureone' } });
		await within(drawer()).findByRole('textbox', { name: 'ticket' });
		await waitFor(() => expect(within(drawer()).getByRole('textbox', { name: 'ticket' })).toHaveValue('PROJ-9'));
		expect(calls[0].body).toMatchObject({ realm_id: 'r-prod' });
		expect(within(drawer()).getByTestId('prefill-source-hint')).toHaveTextContent('run-1234');
		expect(within(drawer()).getByRole('textbox', { name: 'Extra inputs' })).toHaveValue('region=eu');
		expect(within(drawer()).getByRole('textbox', { name: 'Run name' })).toHaveValue('PROJ-9 (rerun)');
		expect(within(drawer()).queryByRole('combobox', { name: 'Realm' })).toBeNull();
		fireEvent.keyDown(document, { key: 'Escape' });
		expect(on_close).toHaveBeenCalled();
	});

	it("from a realm's Runs: pick one of the realm's teams first", async () => {
		const calls = route_fetch();
		show({ team: null, realm: { id: 'r-prod', slug: 'prod-us', org_slug: 'measureone' } });
		const select = await within(drawer()).findByRole('combobox', { name: 'Team' });
		await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(2));
		fireEvent.change(select, { target: { value: 'cliq/feature-dev-js' } });
		expect(await within(drawer()).findByRole('textbox', { name: 'ticket' })).toBeInTheDocument();
		expect(calls.find((c) => c.url === '/v1/realm_teams/get')!.body).toEqual({ org_slug: 'measureone', slug: 'prod-us', limit: 100 });
	});
});
