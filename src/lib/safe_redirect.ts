/**
 * Post-login redirect helpers.
 *
 * `?redirect=` is attacker-controllable, so only same-origin, path-absolute
 * targets are honoured. Anything else falls back to the default landing.
 */

export const DEFAULT_POST_LOGIN_PATH = '/home';

/** Returns a safe in-app path for `raw`, or `fallback` when it is unsafe. */
export function safe_redirect(raw: string | null | undefined, fallback: string = DEFAULT_POST_LOGIN_PATH): string {
	if (!raw) return fallback;
	const value = raw.trim();
	if (!value.startsWith('/')) return fallback;
	// Protocol-relative (`//evil.com`) and backslash tricks (`/\evil.com`).
	if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
	// Control characters / whitespace can smuggle a scheme past some parsers.
	if (/[\u0000-\u001f\u007f\s]/.test(value)) return fallback;
	// Never bounce back to the login page itself.
	if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) return fallback;
	return value;
}

export type Invite_kind = 'org' | 'realm';

export interface Invite_target {
	kind: Invite_kind;
	token: string;
}

/**
 * Detects an invitation hand-off (`/invite/:token` or `/realm-invite/:token`)
 * in a redirect path so the sign-in page can show what the user is joining.
 */
export function invite_from_redirect(path: string): Invite_target | null {
	const match = /^\/(invite|realm-invite)\/([^/?#]+)/.exec(path);
	if (!match) return null;
	let token = match[2];
	try {
		token = decodeURIComponent(token);
	} catch {
		return null;
	}
	if (!token) return null;
	return { kind: match[1] === 'invite' ? 'org' : 'realm', token };
}
