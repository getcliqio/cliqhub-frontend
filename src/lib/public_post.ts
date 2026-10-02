/**
 * POST to a public BFF route (no session needed): invite preview and accept,
 * forgot password, and setting a password from an email link. The session
 * cookie is still sent so a signed-in caller is recognised.
 */
import { api_code, api_message } from '@/lib/use_bff_read';

type Public_result<T> =
	| { ok: true; data: T; status: number }
	| { ok: false; status: number | null; error: string; code: string | null; details: Record<string, unknown> | null };

/** Sends `body` as JSON and unwraps `{ ok, data }` / `{ ok:false, error:{ code, message, details } }`. Never throws. */
export async function public_post<T>(path: string, body: Record<string, unknown>, fallback = 'Request failed'): Promise<Public_result<T>> {
	try {
		const res = await fetch(path, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
			body: JSON.stringify(body),
		});
		const payload = await res.json().catch(() => null);
		if (res.ok && payload?.ok) return { ok: true, data: payload.data as T, status: res.status };
		const details = payload?.error?.details;
		return {
			ok: false,
			status: res.status,
			error: api_message(payload, fallback),
			code: api_code(payload),
			details: details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : null,
		};
	} catch {
		return { ok: false, status: null, error: 'Network error — check your connection.', code: null, details: null };
	}
}
