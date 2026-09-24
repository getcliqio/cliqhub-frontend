/**
 * Unwrap Hub Core / control-plane JSON bodies.
 *
 * Agents + notifications Controllers use BaseController.ok → `{ ok, data }`.
 * Older flat shapes (`agents`, `channels`, `rules`, …) are accepted as
 * fallbacks so a mixed deploy does not blank the SPA.
 */

export type Hub_ok_body = {
	ok?: boolean;
	data?: unknown;
	error?: { message?: string; code?: string };
	[key: string]: unknown;
};

/** Prefer `data`, then a named flat field (e.g. `agents`). */
export function hub_list<T>(body: Hub_ok_body, flat_key: string): T[] {
	if (Array.isArray(body.data)) return body.data as T[];
	const flat = body[flat_key];
	if (Array.isArray(flat)) return flat as T[];
	return [];
}

/** Prefer `data` object/value, then a named flat field. */
export function hub_payload<T>(body: Hub_ok_body, flat_key?: string): T | undefined {
	if (body.data !== undefined && body.data !== null) return body.data as T;
	if (flat_key !== undefined && body[flat_key] !== undefined) return body[flat_key] as T;
	return undefined;
}

/**
 * Setting source on the wire is `org` | `realm` (SettingsData).
 * Realm Agents UI historically labeled org inheritance as `global`.
 */
export function hub_setting_source(
	raw: string | null | undefined,
): 'realm' | 'org' | null {
	if (raw === 'realm') return 'realm';
	if (raw === 'org' || raw === 'global') return 'org';
	return null;
}
