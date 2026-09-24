/**
 * Pure classifier for personal-access-token freshness.
 *
 * Buckets a token by how recently it was actually used so the
 * tokens page can render a badge next to the "Last used" column.
 * The buckets exist to answer "which of these tokens should I
 * revoke?" — never-used tokens are prime revoke candidates, and
 * unused-in-a-month tokens are usually forgotten CI credentials.
 *
 * Kept pure (takes an explicit `now`) so tests don't need to mock
 * Date and so the badge component can reuse it in a memoiser.
 */

/** Token freshness bucket — displayed as a badge. */
export type Token_freshness = 'unused' | 'active' | 'stale' | 'inactive';

/**
 * A token that was minted more than this many ms ago and has never
 * been used is 'unused' rather than just 'new — waiting to be
 * used'. Under a day it looks green ('active') so a just-minted
 * token doesn't shame the user immediately after they mint it.
 */
export const UNUSED_GRACE_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const STALE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function parse_iso(v: string | null | undefined): number | null {
	if (!v) return null;
	const t = Date.parse(v);
	if (Number.isNaN(t)) return null;
	return t;
}

/**
 * Classify a token as one of the four freshness buckets.
 *
 * Rules (in order — earliest match wins):
 *   • last_used_at within ACTIVE_WINDOW_MS → 'active'
 *   • last_used_at within STALE_WINDOW_MS  → 'stale'
 *   • last_used_at older than STALE_WINDOW_MS → 'inactive'
 *   • never used AND minted more than UNUSED_GRACE_MS ago → 'unused'
 *   • never used AND minted within the grace window → 'active' (fresh)
 */
export function classify_token_freshness(
	token: { created_at: string; last_used_at: string | null },
	now: number = Date.now(),
): Token_freshness {
	const last = parse_iso(token.last_used_at);
	if (last !== null) {
		const age = now - last;
		if (age <= ACTIVE_WINDOW_MS) return 'active';
		if (age <= STALE_WINDOW_MS) return 'stale';
		return 'inactive';
	}
	const created = parse_iso(token.created_at);
	if (created === null) return 'unused';
	return now - created <= UNUSED_GRACE_MS ? 'active' : 'unused';
}

/**
 * Human-readable label + tailwind classes for each bucket. Kept
 * next to the classifier so the two lists can't drift.
 */
export function token_freshness_meta(
	bucket: Token_freshness,
): { label: string; description: string; class_name: string } {
	if (bucket === 'active') {
		return {
			label: 'active',
			description: 'Used within the last 7 days.',
			class_name: 'bg-emerald-50 text-emerald-700',
		};
	}
	if (bucket === 'stale') {
		return {
			label: 'stale',
			description: 'Used 7-30 days ago.',
			class_name: 'bg-amber-50 text-amber-800',
		};
	}
	if (bucket === 'inactive') {
		return {
			label: 'inactive',
			description: 'Not used in the last 30 days.',
			class_name: 'bg-slate-100 text-slate-600',
		};
	}
	return {
		label: 'unused',
		description: 'Minted but never used — consider revoking.',
		class_name: 'bg-rose-50 text-rose-700',
	};
}
