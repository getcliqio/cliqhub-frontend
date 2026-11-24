/**
 * Hugs — a person is asked for input (PLAN-hug-requests). Every Hug is asked and answered in getHugs
 * (PLAN-gethugs-step8-cutover.md); the Hub links to it (`/hugs/:id` opens its getHugs page).
 */

import { useEffect } from 'react';
import { use_bff_read } from '@/lib/use_bff_read';

export type Hug_status = 'open' | 'closed' | 'expired' | 'cancelled';

/** A Hug as Core sends it (`POST /v1/hugs/get_by_id`) — the parts the Hub reads. */
export interface Hug {
	id: string;
	/** Its getHugs page. */
	hug_url: string;
	run_id: string;
	phase: string;
	realm_id: string;
	org_slug: string | null;
	title: string;
	status: Hug_status;
	outcome: string | null;
}

/** The Hub's link to a Hug (it opens the Hug in getHugs). */
export function hug_href(hug_id: string): string {
	return `/hugs/${encodeURIComponent(hug_id)}`;
}

type Auth_fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Where the CliqHub page a person opens getHugs from is kept (this tab only). */
const RETURN_KEY = 'cliq.gethugs.return_to';

/**
 * Remember the CliqHub page the person is on, so getHugs can offer a way back to it (PLAN-gethugs-partner-ux.md §3).
 * The HUGs pages that only open getHugs (`/hugs…`) are skipped: the way back is the page before them.
 */
export function remember_page(location: Pick<Location, 'pathname' | 'href'> = window.location): void {
	if (location.pathname === '/hugs' || location.pathname.startsWith('/hugs/') || /\/hugs\/?$/.test(location.pathname)) return;
	try { sessionStorage.setItem(RETURN_KEY, location.href); } catch { /* private mode: the dashboard is the way back */ }
}

/** The CliqHub page to go back to from getHugs: the last one remembered, else the dashboard. */
export function return_page(): string {
	try {
		const kept = sessionStorage.getItem(RETURN_KEY);
		if (kept) return kept;
	} catch { /* no storage */ }
	return `${window.location.origin}/home`;
}

/**
 * Where to open getHugs for a Hug (`hug_id`) or an org's inbox (`org_id`): a link that signs the person in
 * (PLAN-gethugs-step7-sign-in.md) with the way back to the CliqHub page they came from (`return_url`,
 * PLAN-gethugs-partner-ux.md §3), else — the person not there yet, a site admin acting as someone, any error —
 * `fallback`, the plain page (getHugs then asks them to sign in).
 */
export async function gethugs_open_url(auth_fetch: Auth_fetch, body: { hug_id: string } | { org_id: string }, fallback: string): Promise<string> {
	try {
		const res = await auth_fetch('/v1/hugs/create_sign_in_link', { method: 'POST', body: JSON.stringify({ ...body, return_url: return_page() }) });
		const d = await res.json().catch(() => null) as { ok?: boolean; data?: { url?: unknown } } | null;
		if (res.ok && d?.ok && typeof d.data?.url === 'string') return d.data.url;
	} catch {
		// The plain page.
	}
	return fallback;
}

/**
 * The address of getHugs' embed for a Hug (`hug_id`) or the person's Hugs in an org (`org_id`), signed in by a
 * statement (PLAN-gethugs-partner-ux.md §4), or null when Core can't give one (not in getHugs yet, getHugs down…).
 */
export async function gethugs_embed_url(auth_fetch: Auth_fetch, body: { hug_id: string } | { org_id: string }): Promise<string | null> {
	try {
		const res = await auth_fetch('/v1/hugs/create_sign_in_link', { method: 'POST', body: JSON.stringify({ ...body, embed: true }) });
		const d = await res.json().catch(() => null) as { ok?: boolean; data?: { url?: unknown } } | null;
		return res.ok && d?.ok && typeof d.data?.url === 'string' ? d.data.url : null;
	} catch {
		return null;
	}
}

/** The event that asks the HUGs badge again (someone just answered in getHugs' embed). */
const HUGS_CHANGED = 'cliq:hugs-changed';
export function notify_hugs_changed(): void {
	window.dispatchEvent(new Event(HUGS_CHANGED));
}

/** The last count seen per org, shown while a page's new read is on its way (no flicker between pages). */
const last_count = new Map<string, number>();

/**
 * How many Hugs wait on the signed-in person in the org `org_id` — the HUGs badge (PLAN-gethugs-partner-ux.md §1).
 * Asked of Core (which asks getHugs, cached) when a page opens and every minute while the tab is visible; null while
 * unknown (no org, getHugs not reachable and nothing known yet).
 */
export function use_unanswered_hugs(org_id: string | null): number | null {
	const read = use_bff_read<{ total: number | null }>('/v1/hugs/get', org_id ? { unanswered: true, org_id, limit: 1 } : null, { refresh_ms: 60_000 });
	// Someone answered in the embed: ask again now, not at the next minute.
	const reload = read.reload;
	useEffect(() => {
		const on_change = () => void reload();
		window.addEventListener(HUGS_CHANGED, on_change);
		return () => window.removeEventListener(HUGS_CHANGED, on_change);
	}, [reload]);
	const total = read.data?.total;
	if (org_id && typeof total === 'number') last_count.set(org_id, total);
	if (!org_id) return null;
	return typeof total === 'number' ? total : last_count.get(org_id) ?? null;
}
