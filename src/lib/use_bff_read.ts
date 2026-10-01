/**
 * One BFF composition read (`POST <path>` → `{ ok, data }`), polled.
 *
 * Used by Graphite pages whose data the BFF assembles from several Core
 * calls (overview, realm inbox, run detail). The browser makes exactly one
 * request per load; it never fans out to Core itself.
 *
 * - Keeps the last good payload on a failed refresh (`status: 'error'`, `data` set).
 * - `http_status` lets pages tell 403 / 404 apart from transient failures.
 * - Polling pauses while the tab is hidden (via `use_poll`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_poll } from '@/lib/use_poll';

export type Bff_read_state<T> =
	| { status: 'loading'; data: null; error: null; http_status: null; code?: null }
	| { status: 'ready'; data: T; error: null; http_status: number; code?: null }
	| { status: 'error'; data: T | null; error: string; http_status: number | null; code?: string | null };

export function api_message(body: unknown, fallback: string): string {
	const err = (body as { error?: unknown } | null)?.error;
	if (typeof err === 'string') return err;
	if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
		return (err as { message: string }).message;
	}
	return fallback;
}

export function api_code(body: unknown): string | null {
	const b = body as { code?: unknown; error?: { code?: unknown } } | null;
	const code = typeof b?.code === 'string' ? b.code : typeof b?.error?.code === 'string' ? b.error.code : null;
	return code && code.length > 0 ? code : null;
}

export function use_bff_read<T>(
	path: string,
	body: Record<string, unknown> | null,
	opts: { refresh_ms?: number; fallback_error?: string } = {},
) {
	const auth_fetch = useAuthFetch();
	const [state, set_state] = useState<Bff_read_state<T>>({ status: 'loading', data: null, error: null, http_status: null });
	const last_good = useRef<T | null>(null);
	// Serialise the body so callers can pass object literals without re-fetching every render.
	const body_json = body ? JSON.stringify(body) : null;
	const fallback = opts.fallback_error ?? 'Could not load this page.';

	const load = useCallback(async () => {
		if (!body_json) return;
		try {
			const res = await auth_fetch(path, { method: 'POST', body: body_json });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) {
				set_state({ status: 'error', data: last_good.current, error: api_message(payload, fallback), http_status: res.status, code: api_code(payload) });
				return;
			}
			last_good.current = payload.data as T;
			set_state({ status: 'ready', data: payload.data as T, error: null, http_status: res.status });
		} catch {
			set_state({ status: 'error', data: last_good.current, error: 'Network error — check your connection.', http_status: null });
		}
	}, [auth_fetch, path, body_json, fallback]);

	// New target (route change) → forget the previous payload and show loading.
	useEffect(() => {
		last_good.current = null;
		set_state({ status: 'loading', data: null, error: null, http_status: null });
		void load();
	}, [load]);

	const refresh_ms = opts.refresh_ms ?? 0;
	use_poll(() => void load(), refresh_ms, refresh_ms > 0 && state.status !== 'loading');

	return { ...state, reload: load };
}
