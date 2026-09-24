/**
 * Pure client-side sort for the tokens page (slice 5.5).
 *
 * The backend `/v1/auth/get_tokens` endpoint doesn't expose a
 * sort-by parameter yet — sort happens in the browser over the
 * current page's rows. This is fine for personal PATs (users
 * typically have <20 tokens; the default page is 50) and it lets
 * the UI ship without a backend touch.
 *
 * The three orderings match the design (5.5):
 *   • newest              — most recent mint first (default)
 *   • oldest              — oldest mint first (fossil hunt)
 *   • least_recently_used — never-used tokens first, then oldest
 *                           last_used_at first. Pairs with the
 *                           freshness badges (5.4) as the "which
 *                           tokens should I revoke?" flow.
 */

export type Token_sort_option = 'newest' | 'oldest' | 'least_recently_used';

export const TOKEN_SORT_OPTIONS: ReadonlyArray<{ id: Token_sort_option; label: string }> = [
	{ id: 'newest', label: 'Newest' },
	{ id: 'oldest', label: 'Oldest' },
	{ id: 'least_recently_used', label: 'Least recently used' },
];

export function is_token_sort_option(v: string | null | undefined): v is Token_sort_option {
	return v === 'newest' || v === 'oldest' || v === 'least_recently_used';
}

function to_epoch(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? null : t;
}

/**
 * Return a new array (does not mutate). Uses a stable secondary
 * key on `created_at` so tokens with the same primary value keep
 * a deterministic order (matters for the least-recently-used
 * bucket where many tokens might share `null` last_used_at).
 */
export function sort_tokens<T extends { created_at: string; last_used_at: string | null }>(
	tokens: readonly T[],
	sort_by: Token_sort_option,
): T[] {
	const out = [...tokens];

	if (sort_by === 'newest') {
		out.sort((a, b) => (to_epoch(b.created_at) ?? 0) - (to_epoch(a.created_at) ?? 0));
		return out;
	}
	if (sort_by === 'oldest') {
		out.sort((a, b) => (to_epoch(a.created_at) ?? 0) - (to_epoch(b.created_at) ?? 0));
		return out;
	}

	// least_recently_used: null (never-used) tokens first, then
	// oldest last_used_at first. Same-value ties broken by oldest
	// created_at first (a never-used token minted 90 days ago is
	// more likely a revoke candidate than one minted yesterday).
	out.sort((a, b) => {
		const a_last = to_epoch(a.last_used_at);
		const b_last = to_epoch(b.last_used_at);
		if (a_last === null && b_last === null) {
			return (to_epoch(a.created_at) ?? 0) - (to_epoch(b.created_at) ?? 0);
		}
		if (a_last === null) return -1;
		if (b_last === null) return 1;
		if (a_last !== b_last) return a_last - b_last;
		return (to_epoch(a.created_at) ?? 0) - (to_epoch(b.created_at) ?? 0);
	});
	return out;
}
