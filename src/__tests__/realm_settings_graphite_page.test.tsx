/** Graphite realm Settings — one BFF read; each write is one existing route. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { overview_for_realm } from './fixtures_realm';
import { gs_response } from './fixtures_overview';
import type { Realm_settings_data } from '@/lib/realm_settings';
import type { Invite_create_data } from '@/lib/invites';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} }, loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as SettingsPage } from '@/pages/realm/realm_settings_graphite_page';

function settings(over: Partial<Realm_settings_data> = {}): Realm_settings_data {
	return {
		realm: { id: 'r-prod', slug: 'prod-us', name: 'Production US', org_slug: 'measureone' },
		you: { role: 'admin', is_admin: true },
		members: [
			{ member_type: 'user', member_id: 'u1', username: 'sapan', role: 'admin', is_you: true },
			{ member_type: 'user', member_id: 'u2', username: 'lena', role: 'member', is_you: false },
		],
		invites: [{ invite_id: 'i1', email: 'new@x.com', role: 'operator', expires_at: '2026-10-10T00:00:00Z' }],
		tokens: [{ id: '7', name: 'ci-runners', created_at: '2026-09-01T00:00:00Z', last_used_at: null }],
		sections: { members: { status: 'ok', error: null }, invites: { status: 'ok', error: null }, tokens: { status: 'ok', error: null } },
		partial: false,
		...over,
	};
}

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div>; }

type Call = { url: string; body: Record<string, unknown> };
const invite_created = (over: Partial<Invite_create_data> = {}): Invite_create_data => ({
	invite_id: 'inv-9', status: 'pending', email: 'newbie@x.com', role: 'member', expires_at: '2026-10-16T00:00:00Z', resent: false, email_sent: true, invite_url: null, ...over,
});

function route_fetch(data: () => Realm_settings_data = () => settings(), org_role = 'member', invite: Invite_create_data = invite_created()) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		if (u === '/v1/overview/get') { const o = overview_for_realm(); o.orgs = o.orgs.map((x) => ({ ...x, role: org_role })); return new Response(JSON.stringify({ ok: true, data: o })); }
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/realm_settings/get') return new Response(JSON.stringify({ ok: true, data: data() }));
		if (u === '/v1/users/get' && String(body.query).includes('@')) return new Response(JSON.stringify({ ok: true, data: { users: [] } }));
		if (u === '/v1/users/get') return new Response(JSON.stringify({ ok: true, data: { users: [{ id: 'u9', username: 'priya', display_name: 'Priya Nair', email: 'p@x.com' }] } }));
		if (u === '/v1/invitations/create') return new Response(JSON.stringify({ ok: true, data: invite }));
		if (u === '/v1/auth/generate_token') return new Response(JSON.stringify({ ok: true, data: { token: 'cliq_dt_secret', name: 'x' } }));
		return new Response(JSON.stringify({ ok: true }));
	});
	return calls;
}

function render_page(path = '/o/measureone/realms/prod-us/settings') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/o/:org/realms/:slug/settings" element={<SettingsPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
}

describe('Realm settings page', () => {
	afterEach(() => vi.restoreAllMocks());

	it('one read; members by default; role change, remove and invite revoke are single writes', async () => {
		const calls = route_fetch();
		render_page();
		const lena = await screen.findByTestId('member-u2');
		expect(calls[0]).toEqual({ url: '/v1/realm_settings/get', body: { org_slug: 'measureone', slug: 'prod-us' } });
		expect(within(screen.getByTestId('member-u1')).getByText('you')).toBeInTheDocument();
		fireEvent.change(within(lena).getByLabelText('Role for lena'), { target: { value: 'operator' } });
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/add_member', body: { realm_id: 'r-prod', member_type: 'user', member_id: 'u2', role: 'operator' } }));
		fireEvent.click(within(lena).getByRole('button', { name: 'Remove lena' }));
		fireEvent.click(within(lena).getByRole('button', { name: 'Remove' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/remove_member', body: { realm_id: 'r-prod', member_type: 'user', member_id: 'u2' } }));
		fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/invitations/revoke', body: { invite_id: 'i1' } }));
		const nav = screen.getByRole('navigation', { name: 'Settings sections' });
		expect(within(nav).getByRole('link', { name: /Notifications/ })).toHaveAttribute('href', '/notifications?org=measureone');
	});

	it('add member searches people and adds with a role', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('member-u2');
		fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'pri' } });
		fireEvent.mouseDown(await screen.findByRole('option', { name: /Priya Nair/ }));
		fireEvent.change(screen.getByLabelText('Role for new member'), { target: { value: 'admin' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/add_member', body: { realm_id: 'r-prod', member_type: 'user', member_id: 'u9', role: 'admin' } }));
	});

	it('no account yet: invite by email with the chosen role', async () => {
		const calls = route_fetch();
		render_page();
		await screen.findByTestId('member-u2');
		fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'newbie@x.com' } });
		fireEvent.change(screen.getByLabelText('Role for new member'), { target: { value: 'member' } });
		fireEvent.click(await screen.findByRole('button', { name: 'Invite by email' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/invitations/create', body: { target_type: 'realm', realm_id: 'r-prod', email: 'newbie@x.com', role: 'member' } }));
		expect(await screen.findByTestId('sent-result')).toHaveTextContent('Invite sent to newbie@x.com.');
		expect(screen.getByLabelText('Find a person')).toHaveValue('');
	});

	it('invite outcome: sent again, and the copy-link fallback when email is not set up', async () => {
		route_fetch(undefined, undefined, invite_created({ resent: true }));
		const first = render_page();
		await screen.findByTestId('member-u2');
		fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'newbie@x.com' } });
		fireEvent.click(await screen.findByRole('button', { name: 'Invite by email' }));
		expect(await screen.findByTestId('sent-result')).toHaveTextContent('Invite sent again to newbie@x.com.');
		first.unmount();
		vi.restoreAllMocks();

		route_fetch(undefined, undefined, invite_created({ email_sent: false, invite_url: 'https://app.example.test/invite/abc' }));
		render_page();
		await screen.findByTestId('member-u2');
		fireEvent.change(screen.getByLabelText('Find a person'), { target: { value: 'newbie@x.com' } });
		fireEvent.click(await screen.findByRole('button', { name: 'Invite by email' }));
		expect(await screen.findByTestId('fallback-url')).toHaveTextContent('https://app.example.test/invite/abc');
		expect(screen.queryByTestId('sent-result')).toBeNull();
	});

	it('A2A section renders the realm A2A panel in place', async () => {
		const calls = route_fetch();
		render_page('/o/measureone/realms/prod-us/settings?section=a2a');
		expect(await screen.findByTestId('realm-a2a')).toBeInTheDocument();
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/a2a', body: { action: 'get', realm_id: 'r-prod' } }));
	});

	it('tokens: create shows the value once; revoke is confirmed', async () => {
		const calls = route_fetch();
		render_page('/o/measureone/realms/prod-us/settings?section=tokens');
		await screen.findByTestId('token-7');
		fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'gpu' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
		expect(await screen.findByTestId('new-token')).toHaveTextContent('cliq_dt_secret');
		expect(calls).toContainEqual({ url: '/v1/auth/generate_token', body: { type: 'realm', realm_ids: ['r-prod'], name: 'gpu' } });
		fireEvent.click(screen.getByRole('button', { name: 'Revoke ci-runners' }));
		fireEvent.click(within(screen.getByTestId('token-7')).getByRole('button', { name: 'Revoke' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/auth/revoke_token', body: { type: 'realm', realm_id: 'r-prod', token_id: '7' } }));
	});

	it('general rename; danger zone needs the slug typed', async () => {
		const calls = route_fetch();
		const { unmount } = render_page('/o/measureone/realms/prod-us/settings?section=general');
		fireEvent.change(await screen.findByLabelText('Display name'), { target: { value: 'Prod US' } });
		fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/update', body: { realm_id: 'r-prod', name: 'Prod US' } }));
		unmount();
		render_page('/o/measureone/realms/prod-us/settings?section=danger');
		const del = await screen.findByRole('button', { name: 'Delete realm' });
		expect(del).toBeDisabled();
		fireEvent.change(screen.getByLabelText('Type the realm slug to confirm'), { target: { value: 'prod-us' } });
		fireEvent.click(del);
		await waitFor(() => expect(calls).toContainEqual({ url: '/v1/realms/delete', body: { realm_id: 'r-prod' } }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/home');
	});

	it('non-admins see it read-only; org admins can edit', async () => {
		route_fetch(() => settings({ you: { role: 'member', is_admin: false } }));
		const { unmount } = render_page();
		await screen.findByTestId('member-u2');
		expect(screen.getByTestId('read-only')).toBeInTheDocument();
		expect(screen.queryByLabelText('Role for lena')).toBeNull();
		unmount();
		vi.restoreAllMocks();
		route_fetch(() => settings({ you: { role: null, is_admin: false } }), 'owner');
		render_page();
		expect(await screen.findByLabelText('Role for lena')).toBeInTheDocument();
	});
});
