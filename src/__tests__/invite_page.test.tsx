/** Accept or decline an invitation (Graphite): new person, existing account, signed in, and every closed state. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { Invite_preview } from '@/lib/invites';

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
type Reply = { status?: number; body: unknown };
function route_fetch(preview: Invite_preview | null, accept: Reply = { body: { ok: true, data: { decision: 'accept', user: { id: 'u9', username: 'kim', status: 'active', created: true }, org: { id: 'o1', slug: 'm1' }, realm: null, membership: { role: 'member', status: 'active' } } } }) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/invitations/get_by_token') {
			return preview
				? new Response(JSON.stringify({ ok: true, data: preview }))
				: new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Invite not found' } }), { status: 404 });
		}
		if (u === '/v1/invitations/accept') return new Response(JSON.stringify(accept.body), { status: accept.status ?? 200 });
		return new Response('{}');
	});
	return calls;
}
const fail = (status: number, code: string, message: string, details?: Record<string, unknown>): Reply => ({ status, body: { ok: false, error: { code, message, ...(details ? { details } : {}) } } });

const ORG: Invite_preview = {
	invite_id: 'i1', kind: 'org', status: 'pending', org: { slug: 'm1', display_name: 'MeasureOne' }, realm: null, role: 'member',
	inviter: { display_name: 'Krupali Patel' }, invitee_email: 'kim@x.com', account_exists: false, expires_at: '2026-10-16T10:20:00Z',
};
const OWNER: Invite_preview = { ...ORG, kind: 'owner', role: 'owner', inviter: { display_name: 'Sapan Shah' } };
const REALM: Invite_preview = { ...ORG, kind: 'realm', role: 'operator', realm: { slug: 'prod-us', display_name: 'Prod US' } };
afterEach(() => { vi.restoreAllMocks(); auth.user = null; auth.refresh.mockClear(); });

describe('Invite page · pending', () => {
	it('new person: preview card, then username / display name / password → account + accept → their username → /home', async () => {
		const calls = route_fetch(OWNER);
		open('/invite/tok1');
		const card = await screen.findByTestId('invite-summary');
		expect(card).toHaveTextContent('You’re invited to own MeasureOne');
		expect(card).toHaveTextContent('as Owner · invited by Sapan Shah · expires 16 Oct');
		const btn = screen.getByRole('button', { name: 'Create account & accept' });
		expect(btn).toBeDisabled();
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: '9kim' } });
		expect(screen.getByText(/Start with a letter/)).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Kim' } });
		fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Kim Lee' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longpassword' } });
		fireEvent.click(btn);
		expect(await screen.findByTestId('joined')).toHaveTextContent('You joined MeasureOne. Your username is @kim; sign in with it or your email.');
		expect(calls.find((c) => c.url === '/v1/invitations/accept')?.body).toEqual({ token: 'tok1', decision: 'accept', username: 'kim', password: 'longpassword', display_name: 'Kim Lee' });
		expect(auth.refresh).toHaveBeenCalled();
		fireEvent.click(screen.getByRole('link', { name: 'Continue' }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/home');
	});

	it('a reactivated invitee keeps their username: the page shows the one Core kept, not the one typed', async () => {
		route_fetch(ORG, { body: { ok: true, data: { decision: 'accept', user: { id: 'u7', username: 'kimlee', status: 'active', created: true }, org: { id: 'o1', slug: 'm1' }, realm: null, membership: { role: 'member', status: 'active' } } } });
		open('/invite/tok1');
		fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'kim' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longpassword' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create account & accept' }));
		expect(await screen.findByTestId('joined')).toHaveTextContent('Your username is @kimlee');
	});

	it('new person: a taken username shows next to the field', async () => {
		route_fetch(ORG, fail(409, 'conflict', 'Username kim is taken.'));
		open('/invite/tok1');
		fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'kim' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longpassword' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create account & accept' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Username kim is taken.');
		expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
	});

	it('existing account, signed out: sign in, then come back to this link', async () => {
		route_fetch({ ...ORG, account_exists: true });
		open('/invite/tok1');
		expect(await screen.findByText('This email already has a CliqHub account. Sign in to accept.')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Sign in to accept' })).toHaveAttribute('href', `/login?redirect=${encodeURIComponent('/invite/tok1')}`);
		expect(screen.queryByLabelText('Password')).toBeNull();
	});

	it('signed in as the invited email: Accept sends decision accept', async () => {
		auth.user = { id: 'u1', username: 'kim', email: 'KIM@x.com' };
		const calls = route_fetch({ ...ORG, account_exists: true }, { body: { ok: true, data: { decision: 'accept', user: { id: 'u1', username: 'kim', status: 'active', created: false }, org: { id: 'o1', slug: 'm1' }, realm: null, membership: { role: 'member', status: 'active' } } } });
		open('/invite/tok1');
		fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/home');
		expect(calls.find((c) => c.url === '/v1/invitations/accept')?.body).toEqual({ token: 'tok1', decision: 'accept' });
	});

	it('Decline sends decision decline and says so, without signing in', async () => {
		auth.user = { id: 'u1', username: 'kim', email: 'kim@x.com' };
		const calls = route_fetch({ ...ORG, account_exists: true }, { body: { ok: true, data: { decision: 'decline' } } });
		open('/invite/tok1');
		fireEvent.click(await screen.findByRole('button', { name: 'Decline' }));
		expect(await screen.findByRole('heading', { name: 'Invite declined' })).toBeInTheDocument();
		expect(calls.find((c) => c.url === '/v1/invitations/accept')?.body).toEqual({ token: 'tok1', decision: 'decline' });
		expect(auth.refresh).not.toHaveBeenCalled();
	});

	it('signed in with another email: explains, no Accept', async () => {
		auth.user = { id: 'u2', username: 'bob', email: 'bob@x.com' };
		route_fetch(ORG);
		open('/invite/tok1');
		expect(await screen.findByTestId('email-mismatch')).toHaveTextContent('This invite is for kim@x.com. Sign out and sign in with that address.');
		expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
	});

	it('realm invite: accept goes to the realms page with the joined realm', async () => {
		auth.user = { id: 'u1', username: 'kim', email: 'kim@x.com' };
		route_fetch(REALM, { body: { ok: true, data: { decision: 'accept', user: { id: 'u1', username: 'kim', status: 'active', created: false }, org: { id: 'o1', slug: 'm1' }, realm: { id: 'r1', slug: 'prod-us' }, membership: { role: 'operator', status: 'active' } } } });
		open('/realm-invite/tok2');
		expect(await screen.findByTestId('invite-summary')).toHaveTextContent('You’re invited to join Prod US');
		fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
		expect(await screen.findByTestId('where')).toHaveTextContent('/realms?joined=prod-us');
	});

	it('accepting after expiry switches to the expired state', async () => {
		auth.user = { id: 'u1', username: 'kim', email: 'kim@x.com' };
		route_fetch(ORG, fail(410, 'expired', 'expired', { expired_at: '2026-10-01T00:00:00Z' }));
		open('/invite/tok1');
		fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
		expect(await screen.findByRole('heading', { name: 'This invite has expired' })).toBeInTheDocument();
		expect(screen.getByText('Ask Krupali Patel to send it again.')).toBeInTheDocument();
	});

	it('a deleted account trying to sign up is told to contact the admin', async () => {
		route_fetch(ORG, fail(403, 'account_deleted', 'forbidden'));
		open('/invite/tok1');
		fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'kim' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'longpassword' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create account & accept' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('This account was deleted. Contact your admin.');
	});
});

describe('Invite page · closed links', () => {
	it.each([
		['expired', 'This invite has expired', 'Ask Krupali Patel to send it again.'],
		['revoked', 'This invite is no longer valid', 'Ask Krupali Patel for a new one.'],
		['accepted', 'This invite was already accepted', 'Sign in to CliqHub to continue.'],
		['declined', 'This invite was declined', 'If that was a mistake, ask Krupali Patel to send it again.'],
	] as const)('%s', async (status, title, body) => {
		route_fetch({ ...ORG, status });
		open('/invite/tok1');
		expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
		expect(screen.getByText(body)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
	});

	it('an unknown token says the link isn’t valid', async () => {
		route_fetch(null);
		open('/invite/nope');
		expect(await screen.findByRole('heading', { name: 'This invite link isn’t valid' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
	});

	it('signup explains invite-only and keeps the redirect for sign-in', () => {
		open('/signup?redirect=%2Frealm-invite%2Ftok2');
		expect(screen.getByRole('heading', { name: 'Invite only' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /sign in/ })).toHaveAttribute('href', `/login?redirect=${encodeURIComponent('/realm-invite/tok2')}`);
	});
});
