/** Realms list + New realm wizard (Graphite). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview } from './fixtures_overview';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [], loading: false, logout: vi.fn(), refresh: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as RealmsPage, slugify } from '@/pages/realms/realms_page';
import { Component as NewRealmPage } from '@/pages/realms/new_realm_page';

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(extra: Record<string, (b: Record<string, unknown>) => unknown> = {}) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (extra[u]) return new Response(JSON.stringify({ ok: true, ...(extra[u](body) as object) }));
		if (u === '/v1/realms/get') return new Response(JSON.stringify({ ok: true, data: realms_page(body) }));
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}
/** Core realms/get (with_stats) over the measureone realms: search, then one page. */
const REALMS = [
	{ id: 'r-prod', slug: 'prod-us', name: 'prod-us', description: 'Production delivery, US', org_slug: 'measureone', created_at: Date.parse('2026-09-12'), updated_at: Date.now() - 7_200_000, member_count: 9, online_daemons: 5, active_runs: 3, teams_missing_agents: 1 },
	{ id: 'r-stage', slug: 'staging', name: 'staging', org_slug: 'measureone', created_at: Date.parse('2026-09-20'), updated_at: Date.now() - 600_000, member_count: 4, online_daemons: 0, active_runs: 0 },
];
function realms_page(body: Record<string, unknown>) {
	const q = String(body.query ?? '');
	const items = REALMS.filter((r) => !q || r.slug.includes(q));
	return { items, total: body.total_override ?? items.length, offset: body.offset ?? 0, limit: body.limit ?? 25 };
}
function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}<output data-testid="state">{JSON.stringify(l.state)}</output></div>; }
function open(path = '/realms') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/realms" element={<RealmsPage />} /><Route path="/realms/new" element={<NewRealmPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
}
afterEach(() => vi.restoreAllMocks());

describe('Realms page', () => {
	it('slugify', () => { expect(slugify('Production US!')).toBe('production-us'); });

	it('a table read from the server: status (Ready / Missing agents / No daemon available), online daemons, runs (+ need you), members, created, updated', async () => {
		const calls = route_fetch();
		open();
		const row = await screen.findByTestId('realm-prod-us');
		const reads = calls.filter((c) => c.url === '/v1/realms/get');
		expect(reads[0].body).toEqual({ org_id: expect.any(String), with_stats: true, limit: 25, offset: 0 });
		const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
		expect(cells[0]).toContain('Production delivery, US');
		expect(cells[1]).toBe('Missing agents');
		expect(cells[2]).toBe('5');
		expect(cells[3]).toContain('3 running');
		expect(cells[3]).toContain('4 need you');
		expect(cells[4]).toBe('9');
		// Status: none online beats everything else.
		expect(within(await screen.findByTestId('realm-staging')).getByTestId('status')).toHaveTextContent('No daemon available');
		expect(screen.getByRole('columnheader', { name: /Created/ })).toBeInTheDocument();
		expect(screen.getByRole('columnheader', { name: /Updated/ })).toBeInTheDocument();
		// Other orgs' realms never show (sandbox is acme-labs').
		expect(screen.queryByTestId('realm-sandbox')).toBeNull();
	});

	it('search, sort and paging are server-side', async () => {
		const calls = route_fetch();
		open();
		await screen.findByTestId('realm-prod-us');
		fireEvent.change(screen.getByLabelText('Search realms'), { target: { value: 'stag' } });
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/realms/get').at(-1)!.body).toMatchObject({ query: 'stag', offset: 0 }));
		expect(await screen.findByTestId('realm-staging')).toBeInTheDocument();
		await waitFor(() => expect(screen.queryByTestId('realm-prod-us')).toBeNull());
		fireEvent.click(screen.getByRole('button', { name: /Members/ }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/realms/get').at(-1)!.body).toMatchObject({ sort_by: 'members', sort_dir: 'desc', query: 'stag' }));
	});

	it('more realms than a page: a pager asks the server for the next page', async () => {
		const calls = route_fetch({ '/v1/realms/get': (b) => ({ data: { items: REALMS, total: 30, offset: b.offset ?? 0, limit: 25 } }) });
		open();
		expect(await screen.findByTestId('realms-pager')).toHaveTextContent('1–25 of 30');
		fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/realms/get').at(-1)!.body).toMatchObject({ offset: 25, limit: 25 }));
	});

	it('New realm is a side panel over the list (the button, ?new=1, or an old /realms/new link)', async () => {
		route_fetch();
		open('/realms');
		fireEvent.click(await screen.findByRole('button', { name: /New realm/ }));
		const panel = await screen.findByRole('dialog', { name: 'New realm' });
		expect(within(panel).getByRole('list', { name: 'Steps' }).textContent).toMatch(/Details.*People.*Enrollment.*Review/);
		expect(screen.getByRole('heading', { name: 'Realms' })).toBeInTheDocument();
		cleanup();
		open('/realms/new');
		expect(await screen.findByRole('dialog', { name: 'New realm' })).toBeInTheDocument();
	});

	it('nothing is saved until Create realm; then one call carries everything and the realm opens with the token', async () => {
		const calls = route_fetch({
			'/v1/users/get': () => ({ data: { users: [{ id: 'u-bob', username: 'bob', display_name: 'Bob Builder', email: 'bob@x.com' }] } }),
			'/v1/realms/create': () => ({ realm: { id: 'r-new', slug: 'prod-us', name: 'Production US', org_slug: 'measureone', qualified_slug: 'measureone.prod-us', description: 'US delivery', members_added: [{ user_id: 'u-bob', role: 'operator' }], invites: [{ email: 'kim@x.com', role: 'member', email_sent: true, invite_url: null }], enroll_token: { id: 't1', name: 'prod-us-enroll', token: 'cliq_rt_abc' } } }),
		});
		open('/realms?new=1');
		// Details
		fireEvent.change(await screen.findByLabelText('Realm name'), { target: { value: 'Production US' } });
		expect(screen.getByLabelText('Realm slug')).toHaveValue('production-us');
		fireEvent.change(screen.getByLabelText('Realm slug'), { target: { value: 'prod-us' } });
		fireEvent.change(screen.getByLabelText('Realm description'), { target: { value: 'US delivery' } });
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		// People: an operator is required
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(screen.getByRole('alert')).toHaveTextContent('at least one operator');
		fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'bob' } });
		fireEvent.click(await screen.findByRole('option', { name: /Bob Builder/ }));
		fireEvent.change(screen.getByLabelText('Role for the next person'), { target: { value: 'member' } });
		fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'kim@x.com' } });
		fireEvent.click(screen.getByRole('option', { name: /Invite kim@x.com/ }));
		expect(within(screen.getByTestId('people')).getAllByRole('row')).toHaveLength(4);
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		// Enrollment
		expect(screen.getByLabelText('Token name')).toHaveValue('prod-us-enroll');
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		// Review — and nothing has been written yet
		expect(screen.getByTestId('review')).toHaveTextContent('Production US');
		expect(screen.getByTestId('review')).toHaveTextContent('@cliq/hello-world');
		expect(calls.some((c) => c.url === '/v1/realms/create' || c.url === '/v1/invitations/create' || c.url === '/v1/auth/generate_token')).toBe(false);
		fireEvent.click(screen.getByRole('button', { name: 'Create realm' }));
		await waitFor(() => expect(calls.filter((c) => c.url === '/v1/realms/create')).toHaveLength(1));
		expect(calls.find((c) => c.url === '/v1/realms/create')!.body).toEqual({
			org_id: expect.any(String), slug: 'prod-us', name: 'Production US', description: 'US delivery',
			members: [{ user_id: 'u-bob', role: 'operator' }], invites: [{ email: 'kim@x.com', role: 'member' }], enroll_token: { name: 'prod-us-enroll' },
		});
		expect(calls.some((c) => c.url === '/v1/invitations/create' || c.url === '/v1/auth/generate_token' || c.url === '/v1/realms/add_team')).toBe(false);
		// The realm's page opens, carrying the token once.
		await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('/o/measureone/realms/prod-us/inbox'));
		expect(screen.getByTestId('state').textContent).toContain('cliq_rt_abc');
	});

	it('Back keeps what was entered; Cancel leaves without saving', async () => {
		const calls = route_fetch();
		open('/realms?new=1');
		fireEvent.change(await screen.findByLabelText('Realm name'), { target: { value: 'QA' } });
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		expect(screen.getByLabelText('Realm name')).toHaveValue('QA');
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New realm' })).toBeNull());
		expect(calls.some((c) => c.url === '/v1/realms/create')).toBe(false);
	});

	it('a failed create says why and goes to the step it’s about; nothing was saved', async () => {
		route_fetch({ '/v1/realms/create': () => ({ ok: false, error: { code: 'conflict', message: "Realm slug 'qa' already exists in this org" } }) });
		const base = (globalThis.fetch as unknown as { getMockImplementation: () => (u: unknown, i?: RequestInit) => Promise<Response> }).getMockImplementation();
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => (String(url) === '/v1/realms/create'
			? new Response(JSON.stringify({ ok: false, error: { code: 'conflict', message: "Realm slug 'qa' already exists in this org" } }), { status: 409 })
			: base(url, init)));
		open('/realms?new=1');
		fireEvent.change(await screen.findByLabelText('Realm name'), { target: { value: 'QA' } });
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'kim@x.com' } });
		fireEvent.click(screen.getByRole('option', { name: /Invite kim@x.com/ }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		fireEvent.click(screen.getByRole('button', { name: 'Create realm' }));
		expect(await screen.findByRole('alert')).toHaveTextContent("Realm slug 'qa' already exists");
		expect(screen.getByLabelText('Realm name')).toHaveValue('QA');
	});
});
