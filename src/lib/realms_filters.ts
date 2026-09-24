/** URL + request helpers for the account Realms list (`/v1/realms/get`). */

export type Realm_owned_filter = '' | 'me' | 'default';

export type Realm_sort_by = 'slug' | 'name' | 'created_at' | 'updated_at' | 'created_by';
export type Realm_sort_dir = 'asc' | 'desc';

export const REALM_SORT_FIELDS: Realm_sort_by[] = [
	'slug',
	'name',
	'created_at',
	'updated_at',
	'created_by',
];

export function build_realms_search_params(opts: {
	q?: string;
	owned?: string;
	sort_by?: string;
	sort_dir?: string;
	offset?: number;
	limit?: number;
	create?: boolean;
}): URLSearchParams {
	const next = new URLSearchParams();
	const q = opts.q?.trim() ?? '';
	const owned = (opts.owned?.trim() ?? '') as Realm_owned_filter;
	const sort_by = normalize_sort_by(opts.sort_by);
	const sort_dir = normalize_sort_dir(opts.sort_dir);
	const offset = Math.max(0, Math.floor(opts.offset ?? 0));
	const limit = normalize_limit(opts.limit);

	if (q) next.set('q', q);
	if (owned === 'me' || owned === 'default') next.set('owned', owned);
	if (sort_by !== 'slug') next.set('sort', sort_by);
	if (sort_dir !== 'asc') next.set('dir', sort_dir);
	if (offset > 0) next.set('offset', String(offset));
	// Only serialize a non-default page size so URLs stay short.
	if (limit !== undefined && limit !== 20) next.set('limit', String(limit));
	if (opts.create) next.set('create', '1');
	return next;
}

/**
 * Coerce a `?limit=` URL param to one of the supported page sizes.
 * Returns `undefined` when the caller didn't specify, so pages can
 * fall back to their default (PAGE_LIMIT).
 */
export function normalize_limit(raw: string | number | null | undefined): number | undefined {
	if (raw === null || raw === undefined || raw === '') return undefined;
	const n = typeof raw === 'number' ? raw : Number(raw);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	const rounded = Math.floor(n);
	const allowed = [10, 20, 50, 100];
	if (allowed.includes(rounded)) return rounded;
	// Snap to closest allowed value so a manually-typed URL still works.
	let closest = allowed[0];
	let best_diff = Math.abs(rounded - closest);
	for (const v of allowed) {
		const diff = Math.abs(rounded - v);
		if (diff < best_diff) { closest = v; best_diff = diff; }
	}
	return closest;
}

export function normalize_owned_filter(raw: string | null | undefined): Realm_owned_filter {
	const v = (raw ?? '').trim().toLowerCase();
	if (v === 'me' || v === 'default') return v;
	return '';
}

export function normalize_sort_by(raw: string | null | undefined): Realm_sort_by {
	const v = (raw ?? '').trim().toLowerCase();
	if ((REALM_SORT_FIELDS as string[]).includes(v)) return v as Realm_sort_by;
	return 'slug';
}

export function normalize_sort_dir(raw: string | null | undefined): Realm_sort_dir {
	const v = (raw ?? '').trim().toLowerCase();
	if (v === 'desc') return 'desc';
	return 'asc';
}

export function normalize_offset(raw: string | null | undefined): number {
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return 0;
	return Math.floor(n);
}

/** Body for POST `/v1/realms/get` (filters + pagination + sort). */
export function build_realms_get_body(opts: {
	q?: string;
	owned?: Realm_owned_filter;
	sort_by?: Realm_sort_by;
	sort_dir?: Realm_sort_dir;
	limit: number;
	offset: number;
	/** Explicit org scope — backend defaults from X-Org-Id header if omitted. */
	org_id?: string;
}): Record<string, unknown> {
	const body: Record<string, unknown> = {
		limit: opts.limit,
		offset: opts.offset,
		sort_by: opts.sort_by ?? 'slug',
		sort_dir: opts.sort_dir ?? 'asc',
	};
	const query = opts.q?.trim() ?? '';
	if (query) body.query = query;
	if (opts.owned === 'me' || opts.owned === 'default') body.owned = opts.owned;
	if (opts.org_id) body.org_id = opts.org_id;
	return body;
}

/** Toggle sort for a column header click. */
export function next_sort_state(
	current_by: Realm_sort_by,
	current_dir: Realm_sort_dir,
	column: Realm_sort_by,
): { sort_by: Realm_sort_by; sort_dir: Realm_sort_dir } {
	if (current_by !== column) return { sort_by: column, sort_dir: 'asc' };
	if (current_dir === 'asc') return { sort_by: column, sort_dir: 'desc' };
	return { sort_by: 'slug', sort_dir: 'asc' };
}
