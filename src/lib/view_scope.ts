/**
 * The app-wide "view": what the switcher says you're looking at.
 *
 *   all   — every org and realm you can access           (/home)
 *   org   — one org                                      (/home?org=<slug>)
 *   realm — one realm (and implicitly its org)           (/o/:org/realms/:slug/…)
 *
 * There is exactly one place that sets it (the switcher, or links that
 * navigate the same way) and it lives in the URL, so refresh and shared
 * links keep it. The same views exist whether you belong to one org or many.
 */
import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { Overview_data, Overview_org, Overview_realm } from '@/lib/overview';

export type View_scope =
	| { kind: 'all'; org: null; realm: null }
	| { kind: 'org'; org: Overview_org; realm: null }
	| { kind: 'realm'; org: Overview_org | null; realm: Overview_realm };

/** Max realms listed in the sidebar in any view. */
export const SIDEBAR_REALM_LIMIT = 10;

export function resolve_view(
	data: Overview_data | null,
	opts: { org_param: string | null; realm_org: string | null; realm_slug: string | null; realm_id?: string | null },
): View_scope {
	const orgs = data?.orgs ?? [];
	const realms = orgs.flatMap((o) => o.realms);

	const realm = (opts.realm_id ? realms.find((r) => r.id === opts.realm_id) : null)
		?? (opts.realm_org && opts.realm_slug ? realms.find((r) => r.org_slug === opts.realm_org && r.slug === opts.realm_slug) : null)
		?? null;
	if (realm) return { kind: 'realm', realm, org: orgs.find((o) => o.id === realm.org_id) ?? null };

	// An org from the URL only counts if the user is a member; otherwise fall back to "all".
	const org = opts.org_param ? orgs.find((o) => o.slug === opts.org_param) ?? null : null;
	if (org) return { kind: 'org', org, realm: null };

	return { kind: 'all', org: null, realm: null };
}

/** Current view from the route (`/o/:org/realms/:slug`) and `?org=`. */
export function use_view_scope(data: Overview_data | null, realm_id?: string | null): View_scope {
	const params = useParams();
	const [search] = useSearchParams();
	const org_param = search.get('org');
	const is_realm_route = Boolean(params.org && params.slug);
	return useMemo(
		() => resolve_view(data, {
			org_param,
			realm_org: is_realm_route ? params.org ?? null : null,
			realm_slug: is_realm_route ? params.slug ?? null : null,
			realm_id: realm_id ?? null,
		}),
		[data, org_param, is_realm_route, params.org, params.slug, realm_id],
	);
}

/** Realms that belong to the view's org, or all realms in the "all" view. */
export function realms_in_view(data: Overview_data | null, scope: View_scope): Overview_realm[] {
	const orgs = data?.orgs ?? [];
	if (scope.kind === 'all') return orgs.flatMap((o) => o.realms);
	const org_id = scope.org?.id ?? scope.realm?.org_id;
	return orgs.filter((o) => o.id === org_id).flatMap((o) => o.realms);
}

/** Waiting on you first, then most recent activity, then name. */
export function sort_realms(realms: Overview_realm[]): Overview_realm[] {
	return [...realms].sort((a, b) =>
		(b.needs_you - a.needs_you)
		|| ((b.last_activity_at ?? 0) - (a.last_activity_at ?? 0))
		|| a.slug.localeCompare(b.slug));
}

/**
 * Sidebar list: at most SIDEBAR_REALM_LIMIT, sorted. The current realm is
 * always included (it replaces the last slot if it would be cut off).
 */
export function sidebar_realms(data: Overview_data | null, scope: View_scope): { shown: Overview_realm[]; total: number } {
	const all = sort_realms(realms_in_view(data, scope));
	const shown = all.slice(0, SIDEBAR_REALM_LIMIT);
	const current = scope.realm;
	if (current && !shown.some((r) => r.id === current.id) && all.some((r) => r.id === current.id)) {
		shown[shown.length - 1] = current;
	}
	return { shown, total: all.length };
}

/** Link to a cross-org page carrying the view (`?org=`); realm views keep their org. */
export function view_href(path: string, scope: View_scope, multi_org: boolean): string {
	const org = scope.kind === 'all' ? null : scope.org?.slug ?? scope.realm?.org_slug ?? null;
	if (!org || !multi_org) return path;
	return `${path}${path.includes('?') ? '&' : '?'}org=${encodeURIComponent(org)}`;
}
