/**
 * End to end against a mocked BFF: a site admin creates an org for someone
 * new, copies the invite link (email isn't set up), and the new owner opens
 * it, creates their account and accepts — the org then lists as Active.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const admin = { id: 'u-admin', username: 'root', display_name: 'Site Admin', email: 'root@x.com', role: 'admin' as const, preferences: {} };
const auth = { user: admin as typeof admin | null, scopes: [], loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn(), act_as: vi.fn(), refresh: vi.fn(async () => {}) };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));

import { Component as OrgsPage } from '@/pages/admin/graphite/orgs_page';
import { Component as InvitePage } from '@/pages/invite_page';

/** A tiny in-memory BFF holding one org and its owner invite. */
function fake_bff() {
	const state = {
		org: null as null | { id: string; slug: string; display_name: string; status: 'waiting_for_owner' | 'active'; owner_email: string; owner_name: string | null; owner_username: string | null },
		invite: null as null | { token: string; status: 'pending' | 'accepted' },
		calls: [] as Array<{ url: string; body: Record<string, unknown> }>,
	};
	const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		state.calls.push({ url: u, body });
		if (u === '/v1/users/get') return ok({ users: [], total: 0 });
		if (u === '/v1/orgs/new') {
			const owner = body.owner as { email: string; display_name?: string };
			state.org = { id: 'o-m1', slug: String(body.slug), display_name: String(body.display_name ?? body.slug), status: 'waiting_for_owner', owner_email: owner.email, owner_name: owner.display_name ?? null, owner_username: null };
			state.invite = { token: 'q7Zk', status: 'pending' };
			return ok({
				org: { id: state.org.id, slug: state.org.slug, display_name: state.org.display_name, status: 'waiting_for_owner', owner: { user_id: 'u-new', email: owner.email, status: 'invited' }, created_at: '2026-10-02T10:12:00Z', reactivated: false },
				owner_invite: { invite_id: 'inv-1', role: 'owner', status: 'pending', expires_at: '2026-10-16T10:12:00Z', email_sent: false, invite_url: `https://app.example.test/invite/${state.invite.token}` },
			});
		}
		if (u === '/v1/orgs/get') {
			const o = state.org;
			return ok({ orgs: o ? [{ id: o.id, slug: o.slug, display_name: o.display_name, member_count: o.status === 'active' ? 1 : 0, scope_count: 0, created_at: '2026-10-02T10:12:00Z', status: o.status, owner: { username: o.owner_username, status: o.status === 'active' ? 'active' : 'invited' }, deleted_at: null }] : [], total: o ? 1 : 0, sortable: [] });
		}
		if (u === '/v1/invitations/get_by_token') {
			if (!state.org || !state.invite || body.token !== state.invite.token) return new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'not found' } }), { status: 404 });
			return ok({ invite_id: 'inv-1', kind: 'owner', status: state.invite.status, org: { slug: state.org.slug, display_name: state.org.display_name }, realm: null, role: 'owner', inviter: { display_name: admin.display_name }, invitee_email: state.org.owner_email, account_exists: false, expires_at: '2026-10-16T10:12:00Z' });
		}
		if (u === '/v1/invitations/accept') {
			if (!state.org || !state.invite || body.token !== state.invite.token) return new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'not found' } }), { status: 404 });
			state.invite.status = 'accepted';
			state.org.status = 'active';
			state.org.owner_username = String(body.username);
			return ok({ decision: 'accept', user: { id: 'u-new', username: body.username, status: 'active', created: true }, org: { id: state.org.id, slug: state.org.slug }, realm: null, membership: { role: 'owner', status: 'active' } });
		}
		return ok({});
	});
	return state;
}

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }
function at(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/admin/orgs" element={<OrgsPage />} />
				<Route path="/invite/:token" element={<InvitePage />} />
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}
afterEach(() => { vi.restoreAllMocks(); auth.user = admin; });

describe('Create org → accept (mocked BFF)', () => {
	it('site admin creates measureone for a new owner; the owner accepts from the link; the org becomes Active', async () => {
		const bff = fake_bff();

		at('/admin/orgs');
		fireEvent.click(await screen.findByRole('button', { name: /New org/ }));
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'measureone' } });
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'MeasureOne' } });
		fireEvent.change(screen.getByRole('combobox', { name: 'Owner' }), { target: { value: 'sapan@measureone.com' } });
		fireEvent.click(await screen.findByRole('button', { name: '+ Invite sapan@measureone.com by email' }));
		fireEvent.change(screen.getByLabelText('Owner name'), { target: { value: 'Sapan Shah' } });
		fireEvent.click(screen.getByRole('button', { name: 'Send owner invite' }));
		const done = await screen.findByTestId('org-created');
		expect(within(done).getByText('Waiting for owner')).toBeInTheDocument();
		const link = within(done).getByTestId('fallback-url').textContent ?? '';
		const waiting = await screen.findByTestId('org-measureone');
		expect(within(waiting).getByText('Waiting for owner')).toBeInTheDocument();
		expect(waiting).toHaveTextContent('Invited');
		cleanup();

		auth.user = null;
		at(new URL(link).pathname);
		expect(await screen.findByTestId('invite-summary')).toHaveTextContent('You’re invited to own MeasureOne');
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sapan' } });
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Sapan Shah' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create account & accept' }));
		expect(await screen.findByTestId('joined')).toHaveTextContent('Your username is @sapan');
		fireEvent.click(screen.getByRole('link', { name: 'Continue' }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/home');
		expect(auth.refresh).toHaveBeenCalled();
		cleanup();

		auth.user = admin;
		at('/admin/orgs');
		const row = await screen.findByTestId('org-measureone');
		expect(within(row).getByText('Active')).toBeInTheDocument();
		expect(row).toHaveTextContent('sapan');

		expect(bff.calls.filter((c) => c.url !== '/v1/orgs/get' && c.url !== '/v1/users/get').map((c) => [c.url, c.body])).toEqual([
			['/v1/orgs/new', { slug: 'measureone', display_name: 'MeasureOne', owner: { email: 'sapan@measureone.com', display_name: 'Sapan Shah' } }],
			['/v1/invitations/get_by_token', { token: 'q7Zk' }],
			['/v1/invitations/accept', { token: 'q7Zk', decision: 'accept', username: 'sapan', password: 'correct-horse', display_name: 'Sapan Shah' }],
		]);
	});
});
