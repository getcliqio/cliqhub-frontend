import { describe, it, expect } from 'vitest';
import { safe_redirect, invite_from_redirect, DEFAULT_POST_LOGIN_PATH } from '@/lib/safe_redirect';

describe('safe_redirect', () => {
	it('falls back when missing', () => {
		expect(safe_redirect(null)).toBe(DEFAULT_POST_LOGIN_PATH);
		expect(safe_redirect('')).toBe(DEFAULT_POST_LOGIN_PATH);
	});

	it('keeps in-app paths with query and hash', () => {
		expect(safe_redirect('/o/measureone/realms/prod-us/runs?state=failed#top')).toBe(
			'/o/measureone/realms/prod-us/runs?state=failed#top',
		);
		expect(safe_redirect('/invite/abc123')).toBe('/invite/abc123');
	});

	it.each([
		'https://evil.example',
		'//evil.example',
		'/\\evil.example',
		'javascript:alert(1)',
		'evil.example/home',
		'/home\n//evil',
		' /\t/evil',
	])('rejects unsafe target %j', (raw) => {
		expect(safe_redirect(raw)).toBe(DEFAULT_POST_LOGIN_PATH);
	});

	it('never redirects back to /login', () => {
		expect(safe_redirect('/login')).toBe(DEFAULT_POST_LOGIN_PATH);
		expect(safe_redirect('/login?redirect=/home')).toBe(DEFAULT_POST_LOGIN_PATH);
	});

	it('honours a custom fallback', () => {
		expect(safe_redirect('//x', '/realms')).toBe('/realms');
	});
});

describe('invite_from_redirect', () => {
	it('detects org invites', () => {
		expect(invite_from_redirect('/invite/tok_1')).toEqual({ kind: 'org', token: 'tok_1' });
	});

	it('detects realm invites and decodes the token', () => {
		expect(invite_from_redirect('/realm-invite/a%2Bb?x=1')).toEqual({ kind: 'realm', token: 'a+b' });
	});

	it('ignores other paths and malformed tokens', () => {
		expect(invite_from_redirect('/home')).toBeNull();
		expect(invite_from_redirect('/invite/')).toBeNull();
		expect(invite_from_redirect('/invite/%E0%A4%A')).toBeNull();
	});
});
