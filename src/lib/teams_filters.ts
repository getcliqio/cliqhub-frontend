/** URL helpers for the account Teams list (`/teams`). */

import { normalize_limit, normalize_offset } from '@/lib/realms_filters';

export function build_teams_search_params(opts: {
	q?: string;
	scopes?: string[];
	offset?: number;
	limit?: number;
}): URLSearchParams {
	const next = new URLSearchParams();
	const q = opts.q?.trim() ?? '';
	const scopes = (opts.scopes ?? []).map((s) => s.trim()).filter(Boolean);
	const offset = Math.max(0, Math.floor(opts.offset ?? 0));
	const limit = normalize_limit(opts.limit);

	if (q) next.set('q', q);
	if (scopes.length > 0) next.set('scope', scopes.join(','));
	if (offset > 0) next.set('offset', String(offset));
	if (limit !== undefined && limit !== 20) next.set('limit', String(limit));
	return next;
}

export function parse_scope_filter(raw: string | null | undefined): string[] {
	if (!raw?.trim()) return [];
	return [...new Set(
		raw.split(',')
			.map((s) => s.trim().replace(/^@/, ''))
			.filter(Boolean),
	)];
}

export function normalize_teams_offset(raw: string | null | undefined): number {
	return normalize_offset(raw);
}

export { normalize_limit as normalize_teams_limit };
