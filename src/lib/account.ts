/**
 * Account messages and password rules shared by sign-in, the invite page and
 * the set-password page.
 */

/** Minimum password length Core enforces. */
export const PASSWORD_MIN = 8;

/** The password rules shown next to a new-password field, each with whether it is met. */
export function password_rules(password: string, confirm?: string): Array<{ label: string; ok: boolean }> {
	const rules = [{ label: `At least ${PASSWORD_MIN} characters`, ok: password.length >= PASSWORD_MIN }];
	if (confirm !== undefined) rules.push({ label: 'Both passwords match', ok: password.length > 0 && password === confirm });
	return rules;
}

const ACCOUNT_DELETED_MESSAGE = 'This account was deleted. Contact your admin.';

/**
 * What to tell someone whose sign-in or sign-up was refused: a deleted
 * account (403 `account_deleted`), otherwise the server's message.
 */
export function account_error_message(error: { code?: string | null; message?: string | null } | null | undefined, fallback: string): string {
	if (error?.code === 'account_deleted') return ACCOUNT_DELETED_MESSAGE;
	return error?.message || fallback;
}
