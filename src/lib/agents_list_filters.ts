/** Client-side list helpers for Hub agent tables. */

import { normalize_limit, normalize_offset } from '@/lib/realms_filters';

export function filter_agents_by_query<T extends {
	name: string;
	description: string | null;
}>(
	agents: T[],
	q: string,
	display_name: (name: string) => string,
): T[] {
	const needle = q.trim().toLowerCase();
	if (!needle) return agents;
	return agents.filter((a) => (
		a.name.toLowerCase().includes(needle)
		|| display_name(a.name).toLowerCase().includes(needle)
		|| (a.description ?? '').toLowerCase().includes(needle)
	));
}

export function page_agents<T>(agents: T[], offset: number, limit: number): T[] {
	return agents.slice(offset, offset + limit);
}

export function build_agents_list_params(opts: {
	base?: URLSearchParams;
	q?: string;
	offset?: number;
	limit?: number;
	/** Keys to preserve (e.g. tab, agent). */
	keep?: string[];
}): URLSearchParams {
	const next = new URLSearchParams();
	const keep = opts.keep ?? [];
	if (opts.base) {
		for (const key of keep) {
			const v = opts.base.get(key);
			if (v != null && v !== '') next.set(key, v);
		}
	}
	const q = opts.q?.trim() ?? '';
	const offset = Math.max(0, Math.floor(opts.offset ?? 0));
	const limit = normalize_limit(opts.limit);
	if (q) next.set('q', q);
	if (offset > 0) next.set('offset', String(offset));
	if (limit !== undefined && limit !== 20) next.set('limit', String(limit));
	return next;
}

export { normalize_offset as normalize_agents_offset, normalize_limit as normalize_agents_limit };
