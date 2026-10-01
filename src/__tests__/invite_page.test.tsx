/** Accept an invitation (Graphite): org + realm, signed in / out. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const auth = { user: null as null | { id: string; username: string; email: string }, loading: false, refresh: vi.fn(async () => {}) };
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth }));

import { Component as InvitePage } from '@/pages/invite_page';
import { Component as SignupPage } from '@/pages/signup_page';

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
function open(path: string) {
	return render(<MemoryRouter initialEntries={[path]}><Routes>
		<Route path="/invite/:token" element={<InvitePage />} />
		<Route path="/realm-invite/:token" element={<InvitePage />} />
		<Route path="/signup" element={<SignupPage />} />
		<Route path="*" element={<Where />} />
	</Routes></MemoryRouter>);
}
type Call = { url: string; body: Record<string, unknown> };
function route_fetch(preview: Record<string, unknown> | null, accept: { ok: boolean; data?: unknown; error?: string } = { ok: true, data: {} }) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/invitations/get_by_token') return new Response(JSON.stringify(preview ? { ok: true, data: preview } : { ok: false, error: { message: 'Invite not found' } }), { status: preview ? 200 : 404 });
		if (u === '/v1/invitations/accept') return new Response(JSON.stringify(accept), { status: accept.ok ? 200 : 400 });
		return new Response('{}');
	});
	return calls;
}
const ORG = { target_type: 'org', email: 'kim@x.com', role: 'member', org_slug: 'm1', org_display_name: 'MeasureOne' };
const REALM = { target_type: 'realm', email: 'kim@x.com', role: 'operator', realm_id: 'r1', realm_slug: 'prod-us', realm_name: 'Prod US' };
afterEach(() => { vi.restoreAllMocks(); auth.user = null; });

describe('Invite page', () => {
	it('org, signed out: create account & join', async () => {
		const calls = route_fetch(ORG);
		open('/invite/tok1');
		expect(await screen.findByTestId('invite-summary')).toHaveTextContent('MeasureOne');
		const btn = screen.getByRole('button', { name: 'Create account & join' });
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: '9kim' } });
		expect(screen.getByText(/Start with a letter/)).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Kim' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longpassword' } });
		expect(btn).toBeEnabled();
		fireEvent.click(btn);
		expect(await screen.findByTestId('where')).toHaveTextContent('/home');
		expect(calls.find((c) => c.url === '/v1/invitations/accept')?.body).toEqual({ token: 'tok1', username: 'kim', password: 'longpassword' });
		expect(auth.refresh).toHaveBeenCalled();
	});

	it('org, signed in with the invited email: one-click accept', async () => {
		auth.user = { id: 'u1', username: 'kim', email: 'KIM@x.com' };
		const calls = route_fetch(ORG);
		open('/invite/tok1');
		fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/home');
		expect(calls.find((c) => c.url === '/v1/invitations/accept')?.body).toEqual({ token: 'tok1' });
	});

	it('signed in with another email: explains, no accept button', async () => {
		auth.user = { id: 'u2', username: 'bob', email: 'bob@x.com' };
		route_fetch(ORG);
		open('/invite/tok1');
		expect(await screen.findByText(/this invitation is for/)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
	});

	it('realm, signed out: create the account and join (#15)', async () => {
		const calls = route_fetch(REALM, { ok: true, data: { target_type: 'realm', realm_slug: 'prod-us', username: 'kim' } });
		open('/realm-invite/tok2');
		expect(await screen.findByTestId('invite-summary')).toHaveTextContent('Prod US');
		expect(screen.queryByText(/can’t create one/)).toBeNull();
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Kim' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create account & join' }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/realms?joined=prod-us');
		expect(calls.find((c) => c.url === '/v1/invitations/accept')?.body).toEqual({ token: 'tok2', username: 'kim', password: 'password123' });
	});

	it('realm, signed out: existing users can still sign in instead', async () => {
		route_fetch(REALM);
		open('/realm-invite/tok2');
		expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/login?redirect=${encodeURIComponent('/realm-invite/tok2')}`);
	});

	it('realm, signed in: accept → realms with joined banner', async () => {
		auth.user = { id: 'u1', username: 'kim', email: 'kim@x.com' };
		route_fetch(REALM, { ok: true, data: { realm_slug: 'prod-us' } });
		open('/realm-invite/tok2');
		fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/realms?joined=prod-us');
	});

	it('bad token and accept errors are shown', async () => {
		route_fetch(null);
		const { unmount } = open('/invite/nope');
		expect(await screen.findByRole('heading', { name: 'Invitation unavailable' })).toBeInTheDocument();
		expect(screen.getByText(/Invite not found/)).toBeInTheDocument();
		unmount();
		vi.restoreAllMocks();
		auth.user = { id: 'u1', username: 'kim', email: 'kim@x.com' };
		route_fetch(ORG, { ok: false, error: 'Invite expired' });
		open('/invite/tok1');
		fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Invite expired');
	});

	it('signup explains invite-only and keeps the redirect for sign-in', () => {
		open('/signup?redirect=%2Frealm-invite%2Ftok2');
		expect(screen.getByRole('heading', { name: 'Invite only' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /sign in/ })).toHaveAttribute('href', `/login?redirect=${encodeURIComponent('/realm-invite/tok2')}`);
	});
});
