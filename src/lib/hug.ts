/**
 * Hugs — a person is asked for input (PLAN-hug-requests). Every Hug is asked and answered in getHugs
 * (PLAN-gethugs-step8-cutover.md); the Hub links to it (`/hugs/:id` opens its getHugs page).
 */

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

/**
 * Where to open getHugs for a Hug (`hug_id`) or an org's inbox (`org_id`): a link that signs the person in
 * (PLAN-gethugs-step7-sign-in.md), else — the person not there yet, a site admin acting as someone, any error —
 * `fallback`, the plain page (getHugs then asks them to sign in).
 */
export async function gethugs_open_url(auth_fetch: Auth_fetch, body: { hug_id: string } | { org_id: string }, fallback: string): Promise<string> {
	try {
		const res = await auth_fetch('/v1/hugs/create_sign_in_link', { method: 'POST', body: JSON.stringify(body) });
		const d = await res.json().catch(() => null) as { ok?: boolean; data?: { url?: unknown } } | null;
		if (res.ok && d?.ok && typeof d.data?.url === 'string') return d.data.url;
	} catch {
		// The plain page.
	}
	return fallback;
}
