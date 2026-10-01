/** Manage › Organization and Settings (Graphite). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { gs_response, multi_org_overview } from './fixtures_overview';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan', email: 's@x.com', role: 'user' as const, preferences: {} }, scopes: [], loading: false, logout: vi.fn(), refresh: vi.fn(async () => {}), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as OrgPage, group_permissions } from '@/pages/org/org_page';
import { Component as SettingsPage } from '@/pages/settings/settings_page';

const ROLES = [
	{ id: 'ro-owner', slug: 'owner', name: 'Owner', is_system: true, permissions: ['org.manage', 'realms.create', 'teams.run'] },
	{ id: 'ro-admin', slug: 'admin', name: 'Admin', is_system: true, permissions: ['realms.create', 'teams.run'] },
	{ id: 'ro-member', slug: 'member', name: 'Member', is_system: true, is_default: true, permissions: ['teams.run'] },
	{ id: 'ro-rel', slug: 'release', name: 'Release', is_system: false, permissions: ['teams.run'] },
];
function org_data(my_role = 'owner') {
	return {
		org: {
			id: 'o1', slug: 'measureone', display_name: 'MeasureOne', created_at: '2025-01-01T00:00:00Z', my_role,
			members: [
				{ user_id: 'u1', username: 'sapan', display_name: 'Sapan', email: 's@x.com', role: 'owner', role_id: 'ro-owner' },
				{ user_id: 'u2', username: 'maya', display_name: 'Maya', email: 'm@x.com', role: 'member', role_id: 'ro-member' },
			],
			scopes: [{ id: 's1', slug: 'measureone', display_name: 'MeasureOne', visibility: 'private', member_count: 2, team_count: 3 }, { id: 's2', slug: 'm1-data', display_name: 'm1-data', visibility: 'public', member_count: 0, team_count: 0 }],
			roles: ROLES,
		},
		invites: [{ id: 'i1', email: 'new@x.com', role: 'member', created_at: new Date().toISOString() }],
		permissions: { all: ['org.manage', 'realms.create', 'teams.run'], owner_only: ['org.manage'] },
		partial: false,
	};
}

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(extra: Record<string, (b: Record<string, unknown>) => { ok: boolean; data?: unknown; error?: unknown; status?: number }> = {}) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: multi_org_overview() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (extra[u]) { const r = extra[u](body); return new Response(JSON.stringify(r), { status: r.status ?? (r.ok ? 200 : 400) }); }
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}
function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; }
function open_org(path = '/orgs/o1') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/orgs/:id" element={<OrgPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
}
function open_settings(path = '/settings') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/settings" element={<SettingsPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
}
afterEach(() => vi.restoreAllMocks());

describe('group_permissions', () => {
	it('buckets by prefix and keeps leftovers in Other', () => {
		const g = group_permissions(['org.manage', 'teams.run', 'teams.publish', 'weird.thing']);
		expect(g.map((x) => x.label)).toEqual(['Org', 'Team execution', 'Publishing', 'Other']);
	});
});

describe('Organization page', () => {
	it('members: lists members and pending invites; role change posts update_role', async () => {
		const calls = route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }) });
		open_org();
		expect(await screen.findByRole('heading', { name: 'MeasureOne' })).toBeInTheDocument();
		expect(screen.getByTestId('member-maya')).toBeInTheDocument();
		expect(screen.getByTestId('invite-new@x.com')).toBeInTheDocument();
		// cannot change own role
		expect(screen.queryByLabelText('Role for sapan')).toBeNull();
		fireEvent.change(screen.getByLabelText('Role for maya'), { target: { value: 'ro-admin' } });
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/users/update_role')?.body).toEqual({ org_id: 'o1', user_id: 'u2', role_id: 'ro-admin' }));
	});

	it('add by email falls back to an invite when there is no account', async () => {
		const calls = route_fetch({
			'/v1/org_page/get': () => ({ ok: true, data: org_data() }),
			'/v1/orgs/add_member': () => ({ ok: false, error: { message: 'User not found' }, status: 404 }),
		});
		open_org();
		fireEvent.change(await screen.findByRole('textbox', { name: 'Add or invite' }), { target: { value: 'z@x.com' } });
		fireEvent.change(screen.getByLabelText('Invite as'), { target: { value: 'admin' } });
		fireEvent.click(screen.getByRole('button', { name: /Add or invite/ }));
		expect(await screen.findByText('Invite sent to z@x.com.')).toBeInTheDocument();
		expect(calls.find((c) => c.url === '/v1/invitations/create')?.body).toEqual({ target_type: 'org', org_id: 'o1', email: 'z@x.com', role: 'admin' });
	});

	it('remove needs a confirm; revoke invite posts invitations/revoke', async () => {
		const calls = route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }) });
		open_org();
		const row = await screen.findByTestId('member-maya');
		fireEvent.click(within(row).getByRole('button', { name: 'Remove…' }));
		fireEvent.click(within(row).getByRole('button', { name: 'Remove maya' }));
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/orgs/remove_member' && c.body.user_id === 'u2')).toBe(true));
		fireEvent.click(within(screen.getByTestId('invite-new@x.com')).getByRole('button', { name: 'Revoke' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/invitations/revoke')?.body).toEqual({ target_type: 'org', invite_id: 'i1' }));
	});

	it('roles: system roles locked, custom role toggles and saves; owner-only perms locked', async () => {
		const calls = route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }) });
		open_org('/orgs/o1?tab=roles');
		await screen.findByTestId('roles-grid');
		expect(screen.getByRole('button', { name: 'Admin: realms.create' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Release: org.manage' })).toBeDisabled();
		const cell = screen.getByRole('button', { name: 'Release: realms.create' });
		expect(cell).toHaveAttribute('aria-pressed', 'false');
		fireEvent.click(cell);
		expect(cell).toHaveAttribute('aria-pressed', 'true');
		fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/update_role')?.body).toEqual({ org_id: 'o1', role_id: 'ro-rel', name: 'Release', permissions: ['teams.run', 'realms.create'] }));
	});

	it('roles: copy a system role into a new one without owner-only perms', async () => {
		const calls = route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }) });
		open_org('/orgs/o1?tab=roles');
		await screen.findByTestId('roles-grid');
		fireEvent.click(screen.getAllByRole('button', { name: 'Copy as new' })[0]);
		fireEvent.click(screen.getByRole('button', { name: 'Create role' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/create_role')?.body).toEqual({ org_id: 'o1', slug: 'owner-copy', name: 'Owner (copy)', permissions: ['realms.create', 'teams.run'] }));
	});

	it('scopes: delete hidden when a scope has teams; access given per member', async () => {
		const calls = route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }) });
		open_org('/orgs/o1?tab=scopes');
		const s1 = await screen.findByTestId('scope-measureone');
		expect(within(s1).getByText('has teams')).toBeInTheDocument();
		const s2 = screen.getByTestId('scope-m1-data');
		fireEvent.click(within(s2).getByRole('button', { name: '@m1-data' }));
		fireEvent.click(screen.getByRole('button', { name: 'Give access' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/assign_scope_member')?.body).toEqual({ org_id: 'o1', scope_id: 's2', user_id: 'u2' }));
	});

	it('members see a read-only view', async () => {
		route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data('member') }) });
		open_org();
		expect(await screen.findByText(/owners and admins manage it/)).toBeInTheDocument();
		expect(screen.queryByRole('textbox', { name: 'Add or invite' })).toBeNull();
		expect(screen.queryByLabelText('Role for maya')).toBeNull();
	});

	it('settings: rename posts orgs/update', async () => {
		const calls = route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }) });
		open_org('/orgs/o1?tab=settings');
		fireEvent.change(await screen.findByRole('textbox', { name: 'Organization name' }), { target: { value: 'MeasureOne Inc' } });
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/orgs/update')?.body).toEqual({ org_id: 'o1', display_name: 'MeasureOne Inc' }));
	});
});

describe('Settings page', () => {
	it('profile saves only changed fields and lists orgs', async () => {
		const calls = route_fetch();
		open_settings();
		fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Sapan S' } });
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/users/update_profile')?.body).toEqual({ display_name: 'Sapan S' }));
		expect(await screen.findByTestId('my-org-measureone')).toBeInTheDocument();
		expect(within(screen.getByTestId('my-org-measureone')).getByRole('link', { name: 'Manage' })).toBeInTheDocument();
		expect(within(screen.getByTestId('my-org-acme-labs')).queryByRole('link', { name: 'Manage' })).toBeNull();
	});

	it('password needs a match and 8+ chars', async () => {
		const calls = route_fetch();
		open_settings('/settings?tab=password');
		const btn = await screen.findByRole('button', { name: 'Change password' });
		fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old' } });
		fireEvent.change(screen.getByLabelText('New password (8+ characters)'), { target: { value: 'newpassword' } });
		fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpasswordx' } });
		expect(screen.getByText('Passwords don’t match.')).toBeInTheDocument();
		expect(btn).toBeDisabled();
		fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'newpassword' } });
		fireEvent.click(btn);
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/users/change_password')?.body).toEqual({ current_password: 'old', new_password: 'newpassword' }));
	});

	it('tokens: create shows the secret once; revoke needs a confirm', async () => {
		const calls = route_fetch({
			'/v1/auth/get_tokens': () => ({ ok: true, data: { tokens: [{ id: 't1', name: 'laptop', created_at: '2026-01-01T00:00:00Z', last_used_at: null }] } }),
			'/v1/auth/generate_token': () => ({ ok: true, data: { token: 'cliq_secret_abc' } }),
		});
		open_settings('/settings?tab=tokens');
		expect(await screen.findByTestId('token-laptop')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /New token/ }));
		fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'ci' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
		const reveal = await screen.findByTestId('secret-reveal');
		expect(within(reveal).getByText(/cliq_secret_abc/)).toBeInTheDocument();
		expect(calls.find((c) => c.url === '/v1/auth/generate_token')?.body).toEqual({ type: 'user', name: 'ci' });
		const row = screen.getByTestId('token-laptop');
		fireEvent.click(within(row).getByRole('button', { name: 'Revoke…' }));
		fireEvent.click(within(row).getByRole('button', { name: 'Revoke' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/auth/revoke_token')?.body).toEqual({ type: 'user', token_id: 't1' }));
	});

	it('old tabs redirect', async () => {
		route_fetch();
		open_settings('/settings?tab=roles');
		expect(await screen.findByTestId('where')).toHaveTextContent('/org?tab=roles');
	});
});

import { Component as OrgResolver } from '@/pages/org/org_resolver_page';
describe('/org resolver', () => {
	it('several orgs → chooser keeping ?tab', async () => {
		route_fetch();
		render(<MemoryRouter initialEntries={['/org?tab=roles']}><Routes><Route path="/org" element={<OrgResolver />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
		const pick = await screen.findByTestId('pick-org-measureone');
		expect(pick).toHaveAttribute('href', expect.stringMatching(/^\/orgs\/.+\?tab=roles$/));
		expect(within(screen.getByRole('region', { name: 'You manage' })).getByTestId('pick-org-measureone')).toBeInTheDocument();
		expect(within(screen.getByRole('region', { name: 'Member of' })).getByTestId('pick-org-acme-labs')).toBeInTheDocument();
	});
	it('?org=slug → straight to that org', async () => {
		route_fetch();
		render(<MemoryRouter initialEntries={['/org?org=acme-labs&tab=a2a']}><Routes><Route path="/org" element={<OrgResolver />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
		expect(await screen.findByTestId('where')).toHaveTextContent(/\/orgs\/.+\?tab=a2a/);
	});
});
