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

const ROLE = { org_id: 'o1', is_default: false, member_count: 0 };
const ROLES = [
	{ ...ROLE, id: 'ro-owner', slug: 'owner', name: 'Owner', is_system: true, permissions: ['org.manage', 'realms.create', 'teams.run'], member_count: 1 },
	{ ...ROLE, id: 'ro-admin', slug: 'admin', name: 'Admin', is_system: true, permissions: ['realms.create', 'teams.run'] },
	{ ...ROLE, id: 'ro-member', slug: 'member', name: 'Member', is_system: true, is_default: true, permissions: ['teams.run'], member_count: 1 },
	{ ...ROLE, id: 'ro-rel', slug: 'release', name: 'Release', is_system: false, permissions: ['teams.run'] },
];
const M = { invited_at: null, joined_at: '2025-01-01T00:00:00Z', deleted_at: null };
function org_data(my_role = 'owner', over: Record<string, unknown> = {}) {
	return {
		org: {
			id: 'o1', slug: 'measureone', display_name: 'MeasureOne', created_at: '2025-01-01T00:00:00Z', my_role,
			status: 'active', owner: { user_id: 'u1', username: 'sapan', status: 'active' }, deleted_at: null,
			members: [
				{ user_id: 'u1', username: 'sapan', display_name: 'Sapan', email: 's@x.com', role: 'owner', role_id: 'ro-owner', status: 'active', ...M },
				{ user_id: 'u2', username: 'maya', display_name: 'Maya', email: 'm@x.com', role: 'member', role_id: 'ro-member', status: 'active', ...M },
				{ user_id: 'u3', username: 'gone', display_name: 'Gone Person', email: 'g@x.com', role: 'member', role_id: 'ro-member', status: 'deleted', invited_at: null, joined_at: '2025-01-01T00:00:00Z', deleted_at: '2026-09-01T00:00:00Z' },
				{ user_id: 'u4', username: null, display_name: '', email: 'new@x.com', role: 'member', role_id: 'ro-member', status: 'pending', invited_at: '2026-10-01T00:00:00Z', joined_at: null, deleted_at: null },
			],
			scopes: [{ id: 's1', slug: 'measureone', display_name: 'MeasureOne', visibility: 'private', member_count: 2, team_count: 3 }, { id: 's2', slug: 'm1-data', display_name: 'm1-data', visibility: 'public', member_count: 0, team_count: 0 }],
			roles: ROLES,
			pending_owner_invite: null,
			available_permissions: ['realms.create', 'teams.run'],
			owner_only_permissions: ['org.manage'],
			...over,
		},
		invites: [{ invite_id: 'i1', email: 'new@x.com', role: 'member', kind: 'org', status: 'pending', inviter: { id: 'u1', display_name: 'Sapan' }, send_count: 1, last_sent_at: new Date().toISOString(), expires_at: '2026-10-15T00:00:00Z', created_at: new Date().toISOString() }],
		permissions: { all: ['org.manage', 'realms.create', 'teams.run'], owner_only: ['org.manage'] },
		partial: false,
	};
}

type Call = { url: string; body: Record<string, unknown> };
function route_fetch(extra: Record<string, (b: Record<string, unknown>) => { ok: boolean; data?: unknown; error?: unknown; status?: number }> = {}, overview = multi_org_overview) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview() }));
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

	const created = (b: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ ok: true, data: { invite_id: 'i9', status: 'pending', email: b.email, role: b.role, expires_at: '2026-10-16T10:20:00Z', resent: false, email_sent: true, invite_url: null, ...over } });

	it('Invite (no Add member): any email gets an invite with the chosen role', async () => {
		const calls = route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }), '/v1/invitations/create': (b) => created(b) });
		open_org();
		expect(await screen.findByRole('form', { name: 'Invite' })).toBeInTheDocument();
		expect(screen.queryByRole('textbox', { name: 'Add or invite' })).toBeNull();
		const roles = within(screen.getByLabelText('Invite as')).getAllByRole('option').map((o) => o.textContent);
		expect(roles).toEqual(['Member', 'Admin', 'Owner']);
		fireEvent.change(screen.getByLabelText('Email to invite'), { target: { value: 'z@x.com' } });
		fireEvent.change(screen.getByLabelText('Invite as'), { target: { value: 'admin' } });
		fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
		expect(await screen.findByTestId('sent-result')).toHaveTextContent('Invite sent to z@x.com.');
		expect(calls.find((c) => c.url === '/v1/invitations/create')?.body).toEqual({ target_type: 'org', org_id: 'o1', email: 'z@x.com', role: 'admin' });
		expect(calls.some((c) => c.url === '/v1/orgs/add_member')).toBe(false);
	});

	it('Invite without email set up shows the link to copy; an existing member says so', async () => {
		let n = 0;
		route_fetch({
			'/v1/org_page/get': () => ({ ok: true, data: org_data() }),
			'/v1/invitations/create': (b) => (n++ === 0 ? created(b, { email_sent: false, invite_url: 'https://app.example.test/invite/q7Zk' }) : { ok: false, error: { code: 'already_member', message: 'conflict', details: { user_id: 'u2' } }, status: 409 }),
		});
		open_org();
		fireEvent.change(await screen.findByLabelText('Email to invite'), { target: { value: 'z@x.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
		expect(await screen.findByTestId('fallback-url')).toHaveTextContent('https://app.example.test/invite/q7Zk');
		fireEvent.change(screen.getByLabelText('Email to invite'), { target: { value: 'm@x.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('m@x.com is already a member.');
	});

	it('admins can’t invite owners', async () => {
		route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data('admin') }) });
		open_org();
		const roles = within(await screen.findByLabelText('Invite as')).getAllByRole('option').map((o) => o.textContent);
		expect(roles).not.toContain('Owner');
	});

	it('rows show Active / Pending / Deleted; pending rows have Send again (same create call) and Revoke', async () => {
		const calls = route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }), '/v1/invitations/create': (b) => created(b, { resent: true }) });
		open_org();
		expect(within(await screen.findByTestId('member-maya')).getByText('Active')).toBeInTheDocument();
		const gone = screen.getByTestId('member-gone');
		expect(within(gone).getByText('Deleted')).toBeInTheDocument();
		expect(within(gone).queryByRole('button', { name: 'Remove…' })).toBeNull();
		expect(screen.queryByTestId('member-new')).toBeNull();
		const pending = screen.getByTestId('invite-new@x.com');
		expect(within(pending).getByText('Pending')).toBeInTheDocument();
		expect(pending).toHaveTextContent('expires 15 Oct');
		fireEvent.click(within(pending).getByRole('button', { name: 'Send again' }));
		expect(await screen.findByTestId('sent-result')).toHaveTextContent('Invite sent again to new@x.com.');
		expect(calls.find((c) => c.url === '/v1/invitations/create')?.body).toEqual({ target_type: 'org', org_id: 'o1', email: 'new@x.com', role: 'member' });
	});

	it('the Deleted chip lists former members', async () => {
		route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }) });
		open_org();
		fireEvent.click(await screen.findByRole('button', { name: /Deleted/ }));
		expect(screen.getByTestId('member-gone')).toBeInTheDocument();
		expect(screen.queryByTestId('member-maya')).toBeNull();
	});

	it('Waiting for owner: the header banner names who was invited and when the invite expires', async () => {
		const data = org_data('site_admin', { status: 'waiting_for_owner', owner: { user_id: 'u9', username: null, status: 'invited' }, pending_owner_invite: { invite_id: 'i-own', email: 'owner@x.com', expires_at: '2026-10-15T00:00:00Z' } });
		route_fetch({ '/v1/org_page/get': () => ({ ok: true, data }) });
		open_org();
		expect(await screen.findByTestId('waiting-owner')).toHaveTextContent('owner@x.com was invited to own this org and hasn’t accepted yet. The invite expires 15 Oct.');
	});

	it('without the invite list, a pending member invited by email shows their email and Invited', async () => {
		route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: { ...org_data(), invites: null } }) });
		open_org();
		const row = await screen.findByTestId('member-u4');
		expect(row).toHaveTextContent('new@x.com');
		expect(within(row).getByText('Pending')).toBeInTheDocument();
	});

	it('roles: without the permission catalogue the grid uses the org’s own permission lists', async () => {
		route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: { ...org_data(), permissions: null } }) });
		open_org('/orgs/o1?tab=roles');
		await screen.findByTestId('roles-grid');
		expect(screen.getByRole('button', { name: 'Release: org.manage' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Release: realms.create' })).toBeEnabled();
	});

	it('a deleted account’s email: non-site-admins are told to contact their admin', async () => {
		route_fetch({
			'/v1/org_page/get': () => ({ ok: true, data: org_data() }),
			'/v1/invitations/create': () => ({ ok: false, error: { code: 'deleted', message: 'deleted', details: { kind: 'user', id: 'u-x', deleted_at: '2026-06-01T00:00:00Z', was_active: true } }, status: 409 }),
		});
		open_org();
		fireEvent.change(await screen.findByLabelText('Email to invite'), { target: { value: 'gone@x.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
		const notice = await screen.findByTestId('deleted-notice');
		expect(notice).toHaveTextContent('gone@x.com belongs to a deleted account. Contact your admin.');
		expect(within(notice).queryByRole('button', { name: 'Reactivate' })).toBeNull();
	});

	it('remove needs a confirm; revoke invite posts invitations/revoke', async () => {
		const calls = route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }) });
		open_org();
		const row = await screen.findByTestId('member-maya');
		fireEvent.click(within(row).getByRole('button', { name: 'Remove…' }));
		fireEvent.click(within(row).getByRole('button', { name: 'Remove maya' }));
		await waitFor(() => expect(calls.some((c) => c.url === '/v1/orgs/remove_member' && c.body.user_id === 'u2')).toBe(true));
		fireEvent.click(within(screen.getByTestId('invite-new@x.com')).getByRole('button', { name: 'Revoke' }));
		await waitFor(() => expect(calls.find((c) => c.url === '/v1/invitations/revoke')?.body).toEqual({ invite_id: 'i1' }));
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
		expect(screen.queryByRole('form', { name: 'Invite' })).toBeNull();
		expect(screen.queryByLabelText('Role for maya')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
	});

	it('a plain member sees active members without emails (Core leaves them out)', async () => {
		const data = org_data('member');
		const members = data.org.members.filter((m) => m.status === 'active').map((m) => ({ ...m, email: null }));
		route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: { ...data, org: { ...data.org, members }, invites: null } }) });
		open_org();
		const maya = await screen.findByTestId('member-maya');
		expect(maya).toHaveTextContent('@maya');
		expect(maya).not.toHaveTextContent('m@x.com');
		expect(screen.queryByTestId('member-gone')).toBeNull();
		expect(screen.queryByTestId('member-u4')).toBeNull();
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
	it('an org waiting for its owner shows the Waiting for owner pill in the org list', async () => {
		route_fetch({}, () => {
			const o = multi_org_overview();
			o.orgs = o.orgs.map((x) => (x.slug === 'acme-labs' ? { ...x, org_status: 'waiting_for_owner' as const } : x));
			return o;
		});
		open_settings();
		expect(within(await screen.findByTestId('my-org-acme-labs')).getByText('Waiting for owner')).toBeInTheDocument();
		expect(within(screen.getByTestId('my-org-measureone')).queryByText('Active')).toBeNull();
	});

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

	it('my scopes: shows orgs/get_scopes `items` (it used to read `scopes` and showed none) and sorts them in the page', async () => {
		route_fetch({ '/v1/orgs/get_scopes': () => ({ ok: true, data: { items: [
			{ id: 's1', slug: 'zeta', visibility: 'public', scope_type: 'org', org_id: 'o1', team_count: 1 },
			{ id: 's2', slug: 'alpha', visibility: 'private', scope_type: 'user', org_id: null, team_count: 7 },
		], total: 2, offset: 0, limit: 100 } }) });
		open_settings('/settings?tab=scopes');
		expect(await screen.findByText('@zeta')).toBeInTheDocument();
		const order = () => screen.getAllByText(/^@(zeta|alpha)$/).map((n) => n.textContent);
		expect(order()).toEqual(['@zeta', '@alpha']);
		fireEvent.click(screen.getByRole('button', { name: 'Scope' }));
		expect(order()).toEqual(['@alpha', '@zeta']);
		expect(screen.getByRole('columnheader', { name: /Scope/ })).toHaveAttribute('aria-sort', 'ascending');
		fireEvent.click(screen.getByRole('button', { name: 'Teams' }));
		expect(order()).toEqual(['@alpha', '@zeta']);
		expect(screen.getByRole('columnheader', { name: /Teams/ })).toHaveAttribute('aria-sort', 'descending');
	});

	it('org members sort in the page (whole member list is loaded)', async () => {
		route_fetch({ '/v1/org_page/get': () => ({ ok: true, data: org_data() }) });
		open_org('/orgs/o1');
		await screen.findByTestId('member-sapan');
		const order = () => screen.getAllByTestId(/^member-/).map((r) => r.getAttribute('data-testid'));
		expect(order()).toEqual(['member-sapan', 'member-maya', 'member-gone']);
		fireEvent.click(screen.getByRole('button', { name: 'Member' }));
		expect(order()).toEqual(['member-gone', 'member-maya', 'member-sapan']);
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
