/**
 * The app-wide "view". You work in one organization at a time:
 *
 *   org   — one org                                      (/home?org=<slug>)
 *   realm — one realm (and implicitly its org)           (/o/:org/realms/:slug/…)
 *   all   — no org chosen yet (several orgs, nothing remembered): the shell
 *           asks you to pick one before showing org pages
 *
 * The org comes from the URL first (so refresh and shared links keep it),
 * then the last org used in this browser, then the org of your default
 * realm, then your only org.
 */
import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useAuth } from '@/lib/auth_context';
import type { Overview_data, Overview_org, Overview_realm } from '@/lib/overview';

export type View_scope =
	| { kind: 'all'; org: null; realm: null }
	| { kind: 'org'; org: Overview_org; realm: null }
	| { kind: 'realm'; org: Overview_org | null; realm: Overview_realm };

/** Max realms listed in the sidebar in any view. */
export const SIDEBAR_REALM_LIMIT = 10;

/** Browser key for the last org the user worked in. */
export const LAST_ORG_KEY = 'cliqhub.last_org';

/** The last org slug used in this browser, or null (storage may be unavailable). */
export function read_last_org(): string | null {
	try { return window.localStorage.getItem(LAST_ORG_KEY); } catch { return null; }
}

/** Remember the org for next time (best effort). */
export function write_last_org(slug: string): void {
	try { window.localStorage.setItem(LAST_ORG_KEY, slug); } catch { /* storage unavailable: the URL still carries the org */ }
}

export function resolve_view(
	data: Overview_data | null,
	opts: {
		org_param: string | null; realm_org: string | null; realm_slug: string | null; realm_id?: string | null;
		last_org?: string | null; default_realm_id?: string | null;
	},
): View_scope {
	const orgs = data?.orgs ?? [];
	const realms = orgs.flatMap((o) => o.realms);

	const realm = (opts.realm_id ? realms.find((r) => r.id === opts.realm_id) : null)
		?? (opts.realm_org && opts.realm_slug ? realms.find((r) => r.org_slug === opts.realm_org && r.slug === opts.realm_slug) : null)
		?? null;
	if (realm) return { kind: 'realm', realm, org: orgs.find((o) => o.id === realm.org_id) ?? null };

	// An org only counts if the user is a member: the URL's, the remembered one, the default realm's, the only one.
	const member = (slug: string | null | undefined) => (slug ? orgs.find((o) => o.slug === slug) ?? null : null);
	const default_org = opts.default_realm_id ? orgs.find((o) => o.realms.some((r) => r.id === opts.default_realm_id)) ?? null : null;
	const org = member(opts.org_param) ?? member(opts.last_org) ?? default_org ?? (orgs.length === 1 ? orgs[0]! : null);
	if (org) return { kind: 'org', org, realm: null };

	return { kind: 'all', org: null, realm: null };
}

/** Current view from the route (`/o/:org/realms/:slug`) and `?org=`. */
export function use_view_scope(data: Overview_data | null, realm_id?: string | null): View_scope {
	const { default_realm_id } = useAuth();
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
			last_org: read_last_org(),
			default_realm_id,
		}),
		[data, org_param, is_realm_route, params.org, params.slug, realm_id, default_realm_id],
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
	// No org chosen yet: realms appear once you pick one.
	if (scope.kind === 'all') return { shown: [], total: 0 };
	const all = sort_realms(realms_in_view(data, scope));
	const shown = all.slice(0, SIDEBAR_REALM_LIMIT);
	const current = scope.realm;
	if (current && !shown.some((r) => r.id === current.id) && all.some((r) => r.id === current.id)) {
		shown[shown.length - 1] = current;
	}
	return { shown, total: all.length };
}

/** Link to an org page carrying the org (`?org=`); realm views keep their org. */
export function view_href(path: string, scope: View_scope, multi_org: boolean): string {
	const org = scope.kind === 'all' ? null : scope.org?.slug ?? scope.realm?.org_slug ?? null;
	if (!org || !multi_org) return path;
	return `${path}${path.includes('?') ? '&' : '?'}org=${encodeURIComponent(org)}`;
}
