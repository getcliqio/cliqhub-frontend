/** Manage › Agents + Realm › Agents: one BFF read per view; writes are single Core routes. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview, ORG_A } from './fixtures_overview';
import type { Agent_field, Agent_list_data, Agent_page_data } from '@/lib/agents';
import { agent_kind, settings_patch } from '@/lib/agents';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [], loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as AgentsPage, matches } from '@/pages/agents/agents_page';
import { Component as AgentPage } from '@/pages/agents/agent_page';
import { Component as RealmAgentsPage } from '@/pages/realm/realm_agents_page';
import { parse_manifest } from '@/components/graphite/g_agents';

const JIRA = '22222222-2222-4222-8222-222222222222';
const row = (over: Partial<Agent_list_data['items'][number]>) => ({ id: `${over.name}-id`, name: 'x', version: '1.0.0', versions: ['1.0.0'], description: '', agent_type: 'connector', is_system: true, setup: { has_settings: true, required_total: 1, required_configured: 1, ready: true }, overrides: [], used_by: [], used_count: 0, ...over });

function list(over: Partial<Agent_list_data> = {}): Agent_list_data {
	return {
		org_id: ORG_A, realm: null,
		items: [
			row({ id: 'cursor-id', name: 'cursor', agent_type: 'llm', setup: { has_settings: true, required_total: 1, required_configured: 0, ready: false }, used_count: 1, used_by: [{ scope: 'measureone', name: 'triage', version: '1.0.0', realms: [{ id: 'r-prod', slug: 'prod-us' }] }] }),
			row({ id: JIRA, name: 'jira', version: '1.2.0', versions: ['1.2.0', '1.1.0'], description: 'Jira connector', setup: { has_settings: true, required_total: 3, required_configured: 1, ready: false }, overrides: [{ realm_id: 'r-prod', realm_slug: 'prod-us', keys: ['email', 'api_token'] }], used_count: 2 }),
			row({ name: 'git', used_count: 3 }),
			row({ name: 'matcher', agent_type: 'exec', is_system: false, used_count: 1 }),
			row({ name: 'exec', agent_type: 'exec', setup: { has_settings: false, required_total: 0, required_configured: 0, ready: true } }),
		],
		counts: { all: 5, needs_setup: 2, in_use: 4, custom: 1, builtin: 4 },
		attention: { agents: ['cursor', 'jira'], teams: 3 },
		realms_checked: 2, realms_total: 2, partial: false,
		...over,
	};
}

const field = (over: Partial<Agent_field>): Agent_field => ({ key: 'k', description: null, default: null, when: null, required: true, secret: false, value: null, set: false, source: null, org_value: null, ...over });
function page(over: Partial<Agent_page_data> = {}, realm = false): Agent_page_data {
	return {
		org_id: ORG_A,
		agent: { id: JIRA, name: 'jira', version: '1.2.0', description: 'Jira connector', agent_type: 'connector', is_system: true, versions: [{ id: JIRA, version: '1.2.0', created_at: Date.now() - 86400000, newest: true }, { id: 'old', version: '1.1.0', created_at: Date.now() - 5 * 86400000, newest: false }] },
		used_by: [{ scope: 'measureone', name: 'triage', version: '1.0.0', realms: [{ id: 'r-prod', slug: 'prod-us' }] }, { scope: 'measureone', name: 'digest', version: '2.0.0', realms: [] }],
		settings: realm ? {
			scope: 'realm', realm: { id: 'r-prod', slug: 'prod-us', name: 'prod-us' },
			fields: [
				field({ key: 'base_url', value: 'https://m1.atlassian.net', set: true, source: 'org', org_value: 'https://m1.atlassian.net' }),
				field({ key: 'email', value: 'prod@m1.com', set: true, source: 'realm' }),
				field({ key: 'api_token', secret: true, value: '••••x7Qa', set: true, source: 'realm' }),
			],
			required_total: 3, required_configured: 3, ready: true,
		} : {
			scope: 'org', realm: null,
			fields: [
				field({ key: 'base_url', value: 'https://m1.atlassian.net', set: true, source: 'org', description: 'Jira URL' }),
				field({ key: 'email' }),
				field({ key: 'api_token', secret: true }),
				field({ key: 'webhook', secret: true, required: false, value: '••••', set: true, source: 'org' }),
			],
			required_total: 3, required_configured: 1, ready: false,
		},
		overrides: realm ? null : [{ realm_id: 'r-prod', realm_slug: 'prod-us', keys: ['email', 'api_token'] }],
		realms: null, required_keys: ['base_url', 'email', 'api_token'], manifest: null, partial: false,
		...over,
	};
}

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(handlers: Record<string, (b: Record<string, unknown>) => unknown> = {}) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		const h = handlers[u];
		if (h) { const r = h(body) as { status?: number; body: unknown }; return new Response(JSON.stringify(r.body), { status: r.status ?? 200 }); }
		if (u === '/v1/agent_list/get') return new Response(JSON.stringify({ ok: true, data: body.realm ? list({ realm: { id: 'r-prod', slug: 'prod-us', name: 'prod-us' }, attention: { agents: ['cursor'], teams: 1 } }) : list() }));
		if (u === '/v1/agent_page/get') {
			const d = body.view === 'realms'
				? page({ realms: [
					{ realm: { id: 'r-stage', slug: 'staging', name: 'staging' }, ready: false, keys: { base_url: 'org', email: 'missing', api_token: 'missing' }, used_here: ['measureone/digest'] },
					{ realm: { id: 'r-prod', slug: 'prod-us', name: 'prod-us' }, ready: true, keys: { base_url: 'org', email: 'realm', api_token: 'realm' }, used_here: [] },
				] })
				: body.view === 'manifest' ? page({ manifest: { name: 'jira', version: '1.2.0' } }) : page({}, Boolean(body.realm));
			return new Response(JSON.stringify({ ok: true, data: d }));
		}
		return new Response(JSON.stringify({ ok: true, data: true }));
	});
	return calls;
}

function Loc() { const l = useLocation(); return <output data-testid="loc">{l.pathname}{l.search}</output>; }
function render_at(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/agents" element={<><AgentsPage /><Loc /></>} />
				<Route path="/agents/:id" element={<><AgentPage /><Loc /></>} />
				<Route path="/o/:org/realms/:slug/agents" element={<><RealmAgentsPage /><Loc /></>} />
				<Route path="/o/:org/realms/:slug/agents/:id" element={<><RealmAgentsPage /><Loc /></>} />
				<Route path="*" element={<Loc />} />
			</Routes>
		</MemoryRouter>,
	);
}
afterEach(() => vi.restoreAllMocks());

describe('helpers', () => {
	it('agent_kind uses builder colours; hug/curl special-cased', () => {
		expect(agent_kind('llm').label).toBe('LLM');
		expect(agent_kind('gate', 'hug').label).toBe('Human review');
		expect(agent_kind('connector', 'curl').id).toBe('fetch');
		expect(agent_kind('notify').label).toBe('Notify');
	});
	it('settings_patch: org mode sends changes and clears emptied keys', () => {
		const f = [field({ key: 'a', value: 'x', set: true, source: 'org' }), field({ key: 'b' }), field({ key: 'c', value: 'y', set: true, source: 'org' })];
		expect(settings_patch(f, { a: 'x', b: ' new ', c: '' }, new Set(), 'org')).toEqual({ values: { b: 'new' }, clear: ['c'] });
	});
	it('settings_patch: realm mode never clears an inherited org value', () => {
		const f = [field({ key: 'a', value: 'x', set: true, source: 'org', org_value: 'x' }), field({ key: 'b', value: 'r', set: true, source: 'realm' })];
		expect(settings_patch(f, { a: '' }, new Set(['b']), 'realm')).toEqual({ values: {}, clear: ['b'] });
		expect(settings_patch(f, { a: 'override' }, new Set(), 'realm')).toEqual({ values: { a: 'override' }, clear: [] });
	});
	it('list filters', () => {
		const d = list();
		expect(d.items.filter((r) => matches(r, 'needs_setup', '', '')).map((r) => r.name)).toEqual(['cursor', 'jira']);
		expect(d.items.filter((r) => matches(r, 'custom', '', '')).map((r) => r.name)).toEqual(['matcher']);
		expect(d.items.filter((r) => matches(r, 'all', 'jir', '')).map((r) => r.name)).toEqual(['jira']);
		expect(d.items.filter((r) => matches(r, 'all', '', 'script')).map((r) => r.name)).toEqual(['matcher', 'exec']);
	});
	it('parse_manifest', () => {
		const ok = parse_manifest('name: ledger-matcher\nversion: 0.4.0\nagent_type: exec\nsettings:\n  required:\n    - key: bank_api_key\n  optional: [tolerance]');
		expect(ok).toMatchObject({ ok: true, name: 'ledger-matcher', version: '0.4.0', agent_type: 'exec', required: ['bank_api_key'], optional: ['tolerance'] });
		expect(parse_manifest('name: Bad Name')).toMatchObject({ ok: false });
		expect(parse_manifest('name: [')).toMatchObject({ ok: false });
		expect(parse_manifest('')).toMatchObject({ ok: false, error: 'Paste a manifest.' });
	});
});

describe('Manage › Agents list', () => {
	it('one read for the view org; attention banner; rows; Fix now opens the first blocking agent', async () => {
		const calls = route_fetch();
		render_at('/agents?org=measureone');
		const jira = await screen.findByTestId('agent-jira');
		expect(calls.filter((c) => c.url === '/v1/agent_list/get')).toEqual([{ url: '/v1/agent_list/get', body: { org_id: ORG_A } }]);
		expect(screen.getByTestId('attention')).toHaveTextContent('2 agents in use are missing keys');
		expect(screen.getByTestId('attention')).toHaveTextContent('3 teams affected');
		expect(within(jira).getByText('! 2 of 3 keys missing')).toBeInTheDocument();
		expect(within(jira).getByText('prod-us')).toBeInTheDocument();
		expect(within(jira).getByText('2 teams')).toBeInTheDocument();
		expect(within(screen.getByTestId('agent-exec')).getByText('No settings')).toBeInTheDocument();
		fireEvent.click(screen.getByText('Fix now'));
		expect(screen.getByTestId('loc')).toHaveTextContent('/agents/cursor-id?org=measureone');
	});

	it('filter chips and search narrow the table', async () => {
		route_fetch();
		render_at('/agents');
		await screen.findByTestId('agent-jira');
		fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
		await waitFor(() => expect(screen.queryByTestId('agent-jira')).toBeNull());
		expect(screen.getByTestId('agent-matcher')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /^All/ }));
		fireEvent.change(screen.getByLabelText('Search agents'), { target: { value: 'git' } });
		expect(await screen.findByTestId('agent-git')).toBeInTheDocument();
		expect(screen.queryByTestId('agent-matcher')).toBeNull();
	});

	it('register a custom agent: live preview, one register call, lands on it', async () => {
		const calls = route_fetch({ '/v1/agents/register': () => ({ body: { ok: true, data: { id: 'new-id', name: 'ledger-matcher' } } }) });
		render_at('/agents?org=measureone');
		await screen.findByTestId('agent-jira');
		fireEvent.click(screen.getByText('Register custom agent'));
		const dlg = screen.getByRole('dialog', { name: 'Register a custom agent' });
		fireEvent.change(within(dlg).getByLabelText('Agent manifest'), { target: { value: 'name: ledger-matcher\nversion: 0.4.0\nagent_type: exec\ndescription: Match ledger\nsettings:\n  required:\n    - key: bank_api_key' } });
		expect(within(dlg).getByTestId('manifest-preview')).toHaveTextContent('bank_api_key');
		fireEvent.click(within(dlg).getByText('Register ledger-matcher 0.4.0'));
		await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/agents/new-id'));
		expect(calls.find((c) => c.url === '/v1/agents/register')!.body).toMatchObject({ org_id: ORG_A, name: 'ledger-matcher', version: '0.4.0', agent_type: 'exec', description: 'Match ledger', manifest: { name: 'ledger-matcher' } });
	});

	it('registering an existing version needs an explicit replace', async () => {
		const calls = route_fetch();
		render_at('/agents');
		await screen.findByTestId('agent-jira');
		fireEvent.click(screen.getByText('Register custom agent'));
		const dlg = screen.getByRole('dialog');
		fireEvent.change(within(dlg).getByLabelText('Agent manifest'), { target: { value: 'name: matcher\nversion: 1.0.0' } });
		expect(within(dlg).getByText('1.0.0 is already registered')).toBeInTheDocument();
		const btn = within(dlg).getByText('Register matcher 1.0.0') as HTMLButtonElement;
		expect(btn.disabled).toBe(true);
		fireEvent.click(within(dlg).getByLabelText('Replace it'));
		fireEvent.click(btn);
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/agents/register')).toBe(true));
		expect(calls.find((c) => c.url === '/v1/agents/register')!.body.force).toBe(true);
	});
});

describe('Agent page (org)', () => {
	it('settings: org defaults, fill missing keys, replace a secret, save sends only changes', async () => {
		const calls = route_fetch();
		render_at(`/agents/${JIRA}?org=measureone`);
		const form = await screen.findByTestId('settings-form');
		expect(calls.find((c) => c.url === '/v1/agent_page/get')!.body).toEqual({ org_id: ORG_A, id: JIRA });
		expect(within(form).getByText('2 required keys still missing')).toBeInTheDocument();
		fireEvent.change(within(form).getByLabelText('email'), { target: { value: 'bot@m1.com' } });
		fireEvent.change(within(form).getByLabelText('api_token'), { target: { value: 'ATATT-secret-value-123' } });
		expect((within(form).getByLabelText('api_token') as HTMLInputElement).type).toBe('password');
		fireEvent.click(within(form).getByText('Save for org'));
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/agents/update_settings')).toBe(true));
		expect(calls.find((c) => c.url === '/v1/agents/update_settings')!.body).toEqual({ org_id: ORG_A, id: JIRA, settings: { values: { email: 'bot@m1.com', api_token: 'ATATT-secret-value-123' } } });
		expect(await screen.findByText('Saved for the org.')).toBeInTheDocument();
	});

	it('secret already set shows masked + Replace; optional section folds', async () => {
		route_fetch();
		render_at(`/agents/${JIRA}`);
		const form = await screen.findByTestId('settings-form');
		fireEvent.click(within(form).getByText(/Optional settings/));
		expect(within(screen.getByTestId('field-webhook')).getByLabelText('webhook is set')).toHaveTextContent('••••');
		fireEvent.click(within(screen.getByTestId('field-webhook')).getByText('Replace'));
		expect(within(screen.getByTestId('field-webhook')).getByLabelText('webhook')).toBeInTheDocument();
	});

	it('Core permission errors surface on save', async () => {
		route_fetch({ '/v1/agents/update_settings': () => ({ status: 403, body: { ok: false, error: { code: 'forbidden', message: "Permission 'agents.manage' is required" } } }) });
		render_at(`/agents/${JIRA}`);
		const form = await screen.findByTestId('settings-form');
		fireEvent.change(within(form).getByLabelText('email'), { target: { value: 'x@y.z' } });
		fireEvent.click(within(form).getByText('Save for org'));
		expect(await within(form).findByRole('alert')).toHaveTextContent("Permission 'agents.manage' is required");
	});

	it('overrides card and used-by card; realm link goes to the realm page', async () => {
		route_fetch();
		render_at(`/agents/${JIRA}?org=measureone`);
		const card = await screen.findByTestId('overrides-card');
		expect(card).toHaveTextContent('prod-us');
		expect(card).toHaveTextContent('overrides email, api_token');
		expect(screen.getByTestId('used-card')).toHaveTextContent('@measureone/triage');
		fireEvent.click(within(card).getByText('Open →'));
		expect(screen.getByTestId('loc')).toHaveTextContent(`/o/measureone/realms/prod-us/agents/${JIRA}`);
	});

	it('realms tab: every realm, key sources, open in realm', async () => {
		const calls = route_fetch();
		render_at(`/agents/${JIRA}?org=measureone&tab=realms`);
		const grid = await screen.findByTestId('realms-grid');
		expect(calls.find((c) => c.url === '/v1/agent_page/get')!.body).toMatchObject({ view: 'realms' });
		const staging = within(grid).getByTestId('realm-staging');
		expect(staging).toHaveTextContent('1 team');
		expect(staging).toHaveTextContent('! Not ready — runs will stop');
		expect(within(grid).getByTestId('realm-prod-us')).toHaveTextContent('● override');
		fireEvent.click(within(grid).getByText('Open in staging →'));
		expect(screen.getByTestId('loc')).toHaveTextContent('/o/measureone/realms/staging/agents/');
	});

	it('versions: built-in agents have no remove; manifest tab renders YAML', async () => {
		route_fetch();
		render_at(`/agents/${JIRA}?tab=versions`);
		expect(await screen.findByText('Built-in agents can’t be removed — only their settings changed.')).toBeInTheDocument();
		expect(screen.queryByText('Remove')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Manifest' }));
		expect(await screen.findByTestId('manifest')).toHaveTextContent('name: jira');
	});

	it('custom agent remove: confirm, deregister by version id; in-use conflict names the way out', async () => {
		const calls = route_fetch({
			'/v1/agent_page/get': () => ({ body: { ok: true, data: page({ agent: { ...page().agent, is_system: false } }) } }),
			'/v1/agents/deregister': () => ({ status: 409, body: { ok: false, error: { code: 'agent/in_use', message: "cannot deregister agent 'jira': still referenced by team(s) @measureone/triage" } } }),
		});
		render_at(`/agents/${JIRA}?tab=versions`);
		fireEvent.click((await screen.findAllByText('Remove'))[1]);
		fireEvent.click(screen.getAllByText('Remove').at(-1)!);
		const box = await screen.findByTestId('in-use');
		expect(calls.find((c) => c.url === '/v1/agents/deregister')!.body).toEqual({ org_id: ORG_A, id: 'old' });
		expect(box).toHaveTextContent('Can’t remove jira yet');
		expect(within(box).getByText('Open triage')).toBeInTheDocument();
	});
});

describe('Realm › Agents', () => {
	it('list: one realm-scoped read, used-here filter by default, attention, overrides', async () => {
		const calls = route_fetch();
		render_at('/o/measureone/realms/prod-us/agents');
		await screen.findByTestId('ragent-jira');
		expect(calls.find((c) => c.url === '/v1/agent_list/get')!.body).toEqual({ org_id: ORG_A, realm: { org_slug: 'measureone', slug: 'prod-us' } });
		expect(screen.queryByTestId('ragent-exec')).toBeNull(); // unused → hidden under "Used in prod-us"
		expect(screen.getByTestId('ragent-jira')).toHaveTextContent('overrides email, api_token');
		expect(screen.getByTestId('attention')).toHaveTextContent('cursor is missing keys here');
		fireEvent.click(screen.getByRole('button', { name: /All agents/ }));
		expect(await screen.findByTestId('ragent-exec')).toBeInTheDocument();
		expect(screen.getByRole('navigation', { name: 'Realm sections' })).toHaveTextContent('Agents');
	});

	it('agent in realm: inherited keys dashed + Override here; Use org value clears the override', async () => {
		const calls = route_fetch();
		render_at(`/o/measureone/realms/prod-us/agents/${JIRA}`);
		const form = await screen.findByTestId('settings-form');
		expect(calls.find((c) => c.url === '/v1/agent_page/get')!.body).toEqual({ org_id: ORG_A, id: JIRA, realm: { org_slug: 'measureone', slug: 'prod-us' } });
		expect(within(form).getByText('Values in prod-us')).toBeInTheDocument();
		expect(within(form).getByTestId('inherited-base_url')).toHaveTextContent('https://m1.atlassian.net');
		fireEvent.click(within(screen.getByTestId('field-base_url')).getByText('Override here'));
		fireEvent.change(within(screen.getByTestId('field-base_url')).getByLabelText('base_url'), { target: { value: 'https://prod.atlassian.net' } });
		fireEvent.click(within(screen.getByTestId('field-api_token')).getByText('Use org value'));
		fireEvent.click(within(form).getByText('Save for prod-us'));
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/agents/update_settings')).toBe(true));
		expect(calls.find((c) => c.url === '/v1/agents/update_settings')!.body).toEqual({ org_id: ORG_A, id: JIRA, realm_id: 'r-prod', settings: { values: { base_url: 'https://prod.atlassian.net' }, clear: ['api_token'] } });
		expect(screen.getByText(`Org settings for jira →`)).toBeInTheDocument();
		expect(screen.getByTestId('used-card')).toHaveTextContent('Used in prod-us');
	});
});

describe('Agent page — MCP servers', () => {
	const MCP = {
		transports: ['http', 'stdio'] as Array<'http' | 'stdio'>, allow_custom: true,
		presets: [{ name: 'linear', label: 'Linear', transport: 'http' as const, url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer ${LINEAR_API_KEY}' }, secrets: [{ key: 'LINEAR_API_KEY', description: 'Linear personal API key' }] }],
	};
	const mcp_page = (fields: Agent_field[]) => page({
		agent: { id: JIRA, name: 'claude-api', version: '1.0.0', description: 'Claude API', agent_type: 'llm', is_system: true, versions: [{ id: JIRA, version: '1.0.0', created_at: Date.now(), newest: true }] },
		settings: { scope: 'org', realm: null, fields, required_total: 1, required_configured: 1, ready: true, mcp: MCP },
	});
	const base_fields = [
		field({ key: 'api_key', secret: true, type: 'secret', value: '••••abcd', set: true, source: 'org' }),
		field({ key: 'mcp.servers', type: 'mcp_servers', required: false }),
	];

	it('adds a preset, asks for its secret, saves the list and the secret', async () => {
		const calls = route_fetch({ '/v1/agent_page/get': () => ({ body: { ok: true, data: mcp_page(base_fields) } }) });
		render_at(`/agents/${JIRA}?org=measureone`);
		const section = await screen.findByTestId('mcp-section');
		expect(within(section).getByText('No MCP servers yet.')).toBeInTheDocument();
		fireEvent.click(within(section).getByText('+ Add server ▾'));
		fireEvent.click(within(section).getByRole('menuitem', { name: /Linear/ }));
		expect(within(section).getByTestId('mcp-server-linear')).toHaveTextContent('LINEAR_API_KEY missing');
		expect(within(section).getByText('Linear personal API key')).toBeInTheDocument();
		fireEvent.change(within(section).getByLabelText('mcp.secrets.LINEAR_API_KEY'), { target: { value: 'lin_api_123' } });
		expect(within(section).getByTestId('mcp-server-linear')).toHaveTextContent('secrets set');
		fireEvent.click(screen.getByText('Save for org'));
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/agents/update_settings')).toBe(true));
		const values = (calls.find((c) => c.url === '/v1/agents/update_settings')!.body.settings as { values: Record<string, string> }).values;
		expect(JSON.parse(values['mcp.servers']!)).toEqual({ linear: { url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer ${LINEAR_API_KEY}' } } });
		expect(values['mcp.secrets.LINEAR_API_KEY']).toBe('lin_api_123');
	});

	it('custom server form, and pasted { mcpServers } JSON', async () => {
		route_fetch({ '/v1/agent_page/get': () => ({ body: { ok: true, data: mcp_page(base_fields) } }) });
		render_at(`/agents/${JIRA}?org=measureone`);
		const section = await screen.findByTestId('mcp-section');
		fireEvent.click(within(section).getByText('+ Add server ▾'));
		fireEvent.click(within(section).getByRole('menuitem', { name: /Custom server/ }));
		const draft = within(section).getByTestId('mcp-draft');
		fireEvent.change(within(draft).getByLabelText('Server name'), { target: { value: 'docs' } });
		fireEvent.change(within(draft).getByLabelText('Server URL'), { target: { value: 'not a url' } });
		expect(within(draft).getByRole('alert')).toHaveTextContent('URL is not valid');
		fireEvent.change(within(draft).getByLabelText('Server URL'), { target: { value: 'https://docs.example.com/mcp' } });
		fireEvent.click(within(draft).getByText('Add server'));
		expect(within(section).getByTestId('mcp-server-docs')).toHaveTextContent('https://docs.example.com/mcp');

		fireEvent.click(within(section).getByText('Paste / edit JSON'));
		fireEvent.change(within(section).getByLabelText('MCP servers JSON'), { target: { value: JSON.stringify({ mcpServers: { gh: { command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } } } }) } });
		fireEvent.click(within(section).getByText('Apply'));
		expect(within(section).getByTestId('mcp-server-gh')).toHaveTextContent('npx -y server-github');
		expect(within(section).getByTestId('mcp-secret-GITHUB_TOKEN')).toBeInTheDocument();
	});
});
