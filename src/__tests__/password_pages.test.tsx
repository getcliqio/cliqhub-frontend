/** Set a password from an email link (/reset/:token) and Forgot password (/forgot-password). */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const auth = { user: null, loading: false, refresh: vi.fn(async () => {}) };
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth }));

import { Component as ResetPage } from '@/pages/reset_page';
import { Component as ForgotPage } from '@/pages/forgot_password_page';

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div>; }
function open(path: string) {
	return render(<MemoryRouter initialEntries={[path]}><Routes>
		<Route path="/reset/:token" element={<ResetPage />} />
		<Route path="/forgot-password" element={<ForgotPage />} />
		<Route path="*" element={<Where />} />
	</Routes></MemoryRouter>);
}
type Call = { url: string; body: Record<string, unknown> };
function reply(status: number, body: unknown) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
		return new Response(JSON.stringify(body), { status });
	});
	return calls;
}
const fail = (status: number, code: string) => reply(status, { ok: false, error: { code, message: code } });
afterEach(() => { vi.restoreAllMocks(); auth.refresh.mockClear(); });

function fill(pw: string, confirm: string) {
	fireEvent.change(screen.getByLabelText('New password'), { target: { value: pw } });
	fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
}

describe('Set your password (/reset/:token)', () => {
	it('shows the rules, enables Save only when they are met, then signs in', async () => {
		const calls = reply(200, { ok: true, data: { user: { id: 'u1', username: 'kim', status: 'active' }, sessions_revoked: 1 } });
		open('/reset/Hk3p');
		expect(screen.getByRole('heading', { name: 'Set your password' })).toBeInTheDocument();
		const save = screen.getByRole('button', { name: 'Save password and sign in' });
		const rules = screen.getByRole('list', { name: 'Password rules' });
		fill('short', 'short');
		expect(within(rules).getByText('At least 8 characters').closest('li')).toHaveAttribute('data-ok', 'false');
		expect(save).toBeDisabled();
		fill('longpassword', 'longpassworx');
		expect(within(rules).getByText('Both passwords match').closest('li')).toHaveAttribute('data-ok', 'false');
		expect(save).toBeDisabled();
		fill('longpassword', 'longpassword');
		expect(save).toBeEnabled();
		fireEvent.click(save);
		expect(await screen.findByTestId('where')).toHaveTextContent('/home');
		expect(calls[0]).toEqual({ url: '/v1/users/change_password', body: { reset_token: 'Hk3p', new_password: 'longpassword' } });
		expect(auth.refresh).toHaveBeenCalled();
	});

	it.each([
		[410, 'expired', 'This link has expired'],
		[409, 'not_pending', 'This link was already used'],
		[404, 'not_found', 'This link isn’t valid'],
	] as const)('%s %s → “%s” with a way to get a new link', async (status, code, title) => {
		fail(status, code);
		open('/reset/old');
		fill('longpassword', 'longpassword');
		fireEvent.click(screen.getByRole('button', { name: 'Save password and sign in' }));
		expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Send me a new link' })).toHaveAttribute('href', '/forgot-password');
	});

	it('a password-rule error stays on the form', async () => {
		reply(400, { ok: false, error: { code: 'validation', message: 'Password is too common.' } });
		open('/reset/t');
		fill('password123', 'password123');
		fireEvent.click(screen.getByRole('button', { name: 'Save password and sign in' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Password is too common.');
		expect(auth.refresh).not.toHaveBeenCalled();
	});
});

describe('Forgot password (/forgot-password)', () => {
	it('always answers with the same message', async () => {
		const calls = reply(200, { ok: true, data: { requested: true } });
		open('/forgot-password');
		const send = screen.getByRole('button', { name: 'Send reset link' });
		expect(send).toBeDisabled();
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'priya@measureone.com' } });
		fireEvent.click(send);
		expect(await screen.findByRole('status')).toHaveTextContent('If that email has an account, a reset link is on its way.');
		expect(calls[0]).toEqual({ url: '/v1/users/reset_password', body: { email: 'priya@measureone.com' } });
	});

	it('429 rate_limited asks to wait', async () => {
		fail(429, 'rate_limited');
		open('/forgot-password');
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'priya@measureone.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Too many reset requests. Wait an hour and try again.');
		expect(screen.queryByRole('status')).toBeNull();
	});
});
