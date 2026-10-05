/**
 * Cross-org overview — one BFF call (`POST /v1/overview/get`).
 *
 * The BFF fans out to Core per org (orgs/get → dashboard/summary +
 * dashboard/realms). The browser never combines Core calls itself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthFetch } from '@/lib/auth_context';
import { INBOX_SEEN_EVENT, read_inbox_seen, type Inbox_summary } from '@/lib/inbox';
import type { Org_status } from '@/lib/admin';

export interface Overview_counts {
	needs_you: number;
	pending_reviews: number;
	awaiting_input: number;
	active_runs: number;
	failed_24h: number;
	completed_24h: number;
	daemons_online: number;
	daemons_total: number;
}

export interface Overview_realm {
	id: string;
	slug: string;
	name: string;
	org_id: string;
	org_slug: string;
	last_activity_at: number | null;
	daemons: { online: number; stale: number; offline: number; total: number };
	active_runs: number;
	awaiting_input: number;
	pending_reviews: number;
	needs_you: number;
}

/** What people call a realm: its name (e.g. "measureone-sdlc"); the slug only when it has none. */
export function realm_label(r: Pick<Overview_realm, 'slug' | 'name'>): string {
	return r.name?.trim() || r.slug;
}

export interface Overview_org {
	id: string;
	slug: string;
	display_name: string;
	role: string;
	/** The org's lifecycle state (`waiting_for_owner` until its owner accepts). */
	org_status: Org_status;
	status: 'ok' | 'error';
	error: string | null;
	counts: Overview_counts;
	realms: Overview_realm[];
}

export interface Overview_item {
	kind: 'review' | 'input' | 'run';
	id: string;
	title: string;
	org_id: string;
	org_slug: string;
	realm_id: string | null;
	realm_slug: string | null;
	run_id: string | null;
	team: string | null;
	phase: string | null;
	state: string | null;
	at: number | null;
}

export interface Overview_data {
	orgs: Overview_org[];
	totals: Overview_counts & { orgs: number; realms: number };
	needs_you: Overview_item[];
	live_runs: Overview_item[];
	partial: boolean;
	/** Bell summary (newest in-app notifications). Absent on older BFFs. */
	inbox?: Inbox_summary;
}

export const OVERVIEW_REFRESH_MS = 30_000;

type State =
	| { status: 'loading'; data: null; error: null }
	| { status: 'ready'; data: Overview_data; error: null }
	| { status: 'error'; data: Overview_data | null; error: string };

function message_of(body: unknown, fallback: string): string {
	const err = (body as { error?: unknown } | null)?.error;
	if (typeof err === 'string') return err;
	if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
		return (err as { message: string }).message;
	}
	return fallback;
}

/**
 * Loads the overview and refreshes it in the background. A failed refresh
 * keeps the last good data on screen and exposes the error.
 */
export function use_overview(refresh_ms: number = OVERVIEW_REFRESH_MS) {
	const auth_fetch = useAuthFetch();
	const [state, set_state] = useState<State>({ status: 'loading', data: null, error: null });
	const last_good = useRef<Overview_data | null>(null);

	const load = useCallback(async () => {
		try {
			const seen = read_inbox_seen();
			const res = await auth_fetch('/v1/overview/get', { method: 'POST', body: JSON.stringify(seen ? { inbox_seen_ms: seen } : {}) });
			const body = await res.json().catch(() => null);
			if (!res.ok || !body?.ok) {
				set_state({ status: 'error', data: last_good.current, error: message_of(body, 'Could not load your overview.') });
				return;
			}
			last_good.current = body.data as Overview_data;
			set_state({ status: 'ready', data: body.data as Overview_data, error: null });
		} catch {
			set_state({ status: 'error', data: last_good.current, error: 'Network error — check your connection.' });
		}
	}, [auth_fetch]);

	useEffect(() => {
		void load();
		// Opening the inbox or the bell resets the count — refresh right away.
		const on_seen = () => void load();
		window.addEventListener(INBOX_SEEN_EVENT, on_seen);
		const t = refresh_ms > 0 ? setInterval(() => void load(), refresh_ms) : null;
		return () => {
			window.removeEventListener(INBOX_SEEN_EVENT, on_seen);
			if (t) clearInterval(t);
		};
	}, [load, refresh_ms]);

	return { ...state, reload: load };
}

/** Filter the overview to one org without another request (all data is already loaded). */
export function scope_overview(data: Overview_data, org_id: string | null): Overview_data {
	if (!org_id) return data;
	const orgs = data.orgs.filter((o) => o.id === org_id);
	const ok = orgs.filter((o) => o.status === 'ok');
	const c = ok[0]?.counts;
	return {
		orgs,
		totals: {
			needs_you: c?.needs_you ?? 0,
			pending_reviews: c?.pending_reviews ?? 0,
			awaiting_input: c?.awaiting_input ?? 0,
			active_runs: c?.active_runs ?? 0,
			failed_24h: c?.failed_24h ?? 0,
			completed_24h: c?.completed_24h ?? 0,
			daemons_online: c?.daemons_online ?? 0,
			daemons_total: c?.daemons_total ?? 0,
			orgs: orgs.length,
			realms: ok.reduce((n, o) => n + o.realms.length, 0),
		},
		needs_you: data.needs_you.filter((i) => i.org_id === org_id),
		live_runs: data.live_runs.filter((i) => i.org_id === org_id),
		inbox: data.inbox,
		partial: orgs.some((o) => o.status === 'error'),
	};
}

/** In-app link for an overview item. */
export function item_href(item: Overview_item): string {
	if (item.kind === 'review') return `/reviews/${encodeURIComponent(item.id)}`;
	const run_id = encodeURIComponent(item.run_id ?? item.id);
	if (item.realm_slug) return `/o/${item.org_slug}/realms/${item.realm_slug}/runs/${run_id}`;
	return `/runs/${run_id}`;
}

export function relative_time(ms: number | null, now: number = Date.now()): string {
	if (!ms) return '';
	const s = Math.max(0, Math.round((now - ms) / 1000));
	if (s < 60) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h ago`;
	return `${Math.round(h / 24)}d ago`;
}
