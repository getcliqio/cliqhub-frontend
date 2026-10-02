/**
 * Sign-in page (Graphite).
 *
 * Covers: rendering, credential normalisation, error surfacing, submit
 * gating, safe post-login redirect, and the invitation hand-off card.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const auth = {
	user: null as null | { id: string; username: string },
	loading: false,
	login: vi.fn<(u: string, p: string) => Promise<string | null>>(),
};

vi.mock('@/lib/auth_context', () => ({
	useAuth: () => auth,
}));

import { Component as LoginPage } from '@/pages/login_page';

function Where() {
	const loc = useLocation();
	return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function render_at(url: string) {
	return render(
		<MemoryRouter initialEntries={[url]}>
			<Routes>
				<Route path="/login" element={<LoginPage />} />
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Login page', () => {
	let fetch_spy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		auth.user = null;
		auth.loading = false;
		auth.login = vi.fn().mockResolvedValue(null);
		fetch_spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ ok: false }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('renders the sign-in form and the brand panel', () => {
		render_at('/login');
		expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
		expect(screen.getByLabelText('Username')).toBeInTheDocument();
		expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
		expect(screen.getByLabelText('Example team')).toBeInTheDocument();
		expect(screen.getByText(/Need access\? Ask a CliqHub admin/)).toBeInTheDocument();
		expect(fetch_spy).not.toHaveBeenCalled();
	});

	it('keeps submit disabled until both fields are filled', () => {
		render_at('/login');
		const submit = screen.getByRole('button', { name: 'Sign in' });
		expect(submit).toBeDisabled();
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: '  ' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
		expect(submit).toBeDisabled();
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sapan' } });
		expect(submit).toBeEnabled();
	});

	it('trims and lowercases the username before calling login', async () => {
		render_at('/login');
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: '  Sapan ' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret#1' } });
		fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		await waitFor(() => expect(auth.login).toHaveBeenCalledWith('sapan', 'Secret#1'));
	});

	it('shows the server error and re-enables submit', async () => {
		auth.login = vi.fn().mockResolvedValue('Invalid username or password');
		render_at('/login');
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sapan' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
		fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password');
		expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
		expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
	});

	it('shows a busy state and ignores double submits', async () => {
		let resolve!: (v: string | null) => void;
		auth.login = vi.fn().mockReturnValue(new Promise<string | null>((r) => { resolve = r; }));
		render_at('/login');
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'sapan' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
		fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		const busy = await screen.findByRole('button', { name: 'Signing in…' });
		expect(busy).toBeDisabled();
		fireEvent.submit(busy.closest('form')!);
		expect(auth.login).toHaveBeenCalledTimes(1);
		resolve('Account suspended');
		expect(await screen.findByRole('alert')).toHaveTextContent('Account suspended');
	});

	it('toggles password visibility', () => {
		render_at('/login');
		const pw = screen.getByLabelText('Password');
		fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
		expect(pw).toHaveAttribute('type', 'text');
		fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
		expect(pw).toHaveAttribute('type', 'password');
	});

	it('warns when Caps Lock is on', () => {
		render_at('/login');
		const pw = screen.getByLabelText('Password');
		const ev = new KeyboardEvent('keydown', { key: 'A', bubbles: true });
		Object.defineProperty(ev, 'getModifierState', { value: (k: string) => k === 'CapsLock' });
		fireEvent(pw, ev);
		expect(screen.getByText('Caps Lock is on.')).toBeInTheDocument();
	});

	it('redirects an already signed-in user to /home by default', async () => {
		auth.user = { id: '1', username: 'sapan' };
		render_at('/login');
		expect(await screen.findByTestId('where')).toHaveTextContent('/home');
	});

	it('honours a safe ?redirect= target', async () => {
		auth.user = { id: '1', username: 'sapan' };
		render_at('/login?redirect=' + encodeURIComponent('/o/measureone/realms/prod-us/runs?state=failed'));
		expect(await screen.findByTestId('where')).toHaveTextContent('/o/measureone/realms/prod-us/runs?state=failed');
	});

	it('ignores an off-site ?redirect= target', async () => {
		auth.user = { id: '1', username: 'sapan' };
		render_at('/login?redirect=' + encodeURIComponent('//evil.example/steal'));
		expect(await screen.findByTestId('where')).toHaveTextContent('/home');
	});

	it('shows the org invitation being accepted', async () => {
		fetch_spy.mockResolvedValue(
			json({ ok: true, data: { invite_id: 'i1', kind: 'org', status: 'pending', org: { slug: 'measureone', display_name: 'MeasureOne' }, realm: null, role: 'member', inviter: { display_name: 'Sapan Shah' }, invitee_email: 'jo@acme.com', account_exists: true, expires_at: '2026-10-16T10:20:00Z' } }),
		);
		render_at('/login?redirect=' + encodeURIComponent('/invite/tok_1'));
		const card = await screen.findByText(/You're invited to/);
		expect(card).toHaveTextContent('MeasureOne');
		expect(card).toHaveTextContent('member');
		expect(screen.getByText(/sent to jo@acme.com/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sign in & accept invite' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/invite/tok_1');

		const [url, init] = fetch_spy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/v1/invitations/get_by_token');
		expect(JSON.parse(String(init.body))).toEqual({ token: 'tok_1' });
	});

	it('shows the realm invitation with its org', async () => {
		fetch_spy.mockResolvedValue(
			json({ ok: true, data: { invite_id: 'i2', kind: 'realm', status: 'pending', org: { slug: 'measureone', display_name: 'MeasureOne' }, realm: { slug: 'prod-us', display_name: 'prod-us' }, role: 'operator', inviter: null, invitee_email: 'jo@acme.com', account_exists: true, expires_at: '2026-10-16T10:20:00Z' } }),
		);
		render_at('/login?redirect=' + encodeURIComponent('/realm-invite/tok_2'));
		const card = await screen.findByText(/You're invited to/);
		expect(card).toHaveTextContent('measureone / prod-us');
		expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
			'href',
			'/realm-invite/tok_2', // #15: realm invites create the account on the invite page
		);
	});

	it('still allows sign-in when the invitation is invalid', async () => {
		fetch_spy.mockResolvedValue(json({ ok: false, error: { code: 'not_found', message: 'Invitation expired.' } }, 404));
		render_at('/login?redirect=' + encodeURIComponent('/invite/old'));
		await screen.findByText(/Invitation unavailable\./);
		expect(screen.getByTestId('invite-card')).toHaveTextContent('Invitation expired.');
		expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
	});

	it('offers “Forgot password?”', () => {
		render_at('/login');
		expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
	});

	it('shows the deleted-account message the sign-in returns', async () => {
		auth.login = vi.fn().mockResolvedValue('This account was deleted. Contact your admin.');
		render_at('/login');
		fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'gone' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever1' } });
		fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('This account was deleted. Contact your admin.');
	});

	it('handles a network failure when loading the invitation', async () => {
		fetch_spy.mockRejectedValue(new Error('offline'));
		render_at('/login?redirect=' + encodeURIComponent('/invite/x'));
		expect(await screen.findByText(/Could not load the invitation/)).toBeInTheDocument();
	});
});
