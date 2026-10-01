/**
 * In-app inbox — types for `POST /v1/inbox/get` and the bell summary that
 * rides on `POST /v1/overview/get`, plus pure helpers (kind, action, filters).
 *
 * Core has no read/unread state yet: "new" means newer than the last time
 * you opened the inbox or the bell, kept per browser.
 */
export interface Inbox_item {
	id: string;
	event: string;
	title: string | null;
	message: string | null;
	severity: string | null;
	org_id: string | null;
	org_slug: string | null;
	realm_id: string | null;
	realm_slug: string | null;
	team: string | null;
	run_id: string | null;
	phase: string | null;
	review_id: string | null;
	channel_id: string | null;
	original_event: string | null;
	at: number;
}

export interface Inbox_data {
	items: Inbox_item[];
	next_until_ms: number | null;
	orgs: Array<{ id: string; slug: string; display_name: string; status: 'ok' | 'error'; error: string | null }>;
	partial: boolean;
}

export interface Inbox_summary {
	new_count: number;
	capped: boolean;
	latest: Inbox_item[];
	status: 'ok' | 'partial' | 'error';
}

export const INBOX_SEEN_KEY = 'cliq.inbox_seen_ms';
export const INBOX_SEEN_EVENT = 'cliq:inbox-seen';

export function read_inbox_seen(): number {
	try {
		const v = Number(window.localStorage.getItem(INBOX_SEEN_KEY));
		return Number.isFinite(v) && v > 0 ? v : 0;
	} catch {
		return 0;
	}
}

/** Remember "seen up to now" and tell the shell to refresh its count. */
export function mark_inbox_seen(at: number = Date.now()): void {
	try { window.localStorage.setItem(INBOX_SEEN_KEY, String(at)); } catch { /* storage unavailable */ }
	try { window.dispatchEvent(new CustomEvent(INBOX_SEEN_EVENT)); } catch { /* no window */ }
}

export type Inbox_kind = 'failed' | 'input' | 'review' | 'delivery' | 'daemon' | 'done' | 'timeout' | 'info';

export function inbox_kind(e: string): Inbox_kind {
	if (e === 'notification.failed') return 'delivery';
	if (e === 'run.failed' || e === 'run.crashed' || e === 'phase.failed') return 'failed';
	if (e === 'phase.input_required') return 'input';
	if (e.startsWith('hug.')) return 'review';
	if (e.startsWith('daemon.')) return 'daemon';
	if (e === 'run.completed' || e === 'phase.completed') return 'done';
	if (e === 'phase.timed_out' || e === 'phase.idle') return 'timeout';
	return 'info';
}

const realm_base = (i: Inbox_item) => (i.org_slug && i.realm_slug ? `/o/${i.org_slug}/realms/${i.realm_slug}` : null);

/** The one action a row offers, or null when there is nothing to open. */
export function inbox_action(i: Inbox_item): { label: string; href: string } | null {
	const kind = inbox_kind(i.event);
	const realm = realm_base(i);
	const run = realm && i.run_id ? `${realm}/runs/${encodeURIComponent(i.run_id)}` : null;
	if (kind === 'delivery') {
		const q = new URLSearchParams({ tab: 'channels' });
		if (i.channel_id) q.set('channel', i.channel_id);
		if (i.org_slug) q.set('org', i.org_slug);
		return { label: 'Fix channel', href: `/notifications?${q}` };
	}
	if (kind === 'review') {
		if (i.review_id && i.event === 'hug.review_requested') return { label: 'Review', href: `/reviews/${encodeURIComponent(i.review_id)}` };
		return run ? { label: 'Open run', href: run } : null;
	}
	if (kind === 'input') return run ? { label: 'Provide input', href: run } : null;
	if (kind === 'failed') return run ? { label: 'Investigate', href: run } : null;
	if (kind === 'daemon') return realm ? { label: 'Open realm', href: `${realm}/inbox` } : null;
	return run ? { label: 'Open run', href: run } : realm ? { label: 'Open realm', href: `${realm}/inbox` } : null;
}

/** Filter chips → exact Core event types. */
export const INBOX_FILTERS: Array<{ id: string; label: string; types: string[] }> = [
	{ id: 'failures', label: 'Failures', types: ['run.failed', 'run.crashed', 'phase.failed', 'phase.timed_out'] },
	{ id: 'reviews', label: 'Reviews', types: ['hug.review_requested', 'hug.review_reminded', 'hug.review_responded', 'hug.review_resolved', 'hug.review_expired', 'hug.routing_requested'] },
	{ id: 'input', label: 'Input', types: ['phase.input_required', 'phase.inputs_supplied'] },
	{ id: 'runs', label: 'Runs', types: ['run.started', 'run.resumed', 'run.completed', 'run.cancelled'] },
	{ id: 'daemons', label: 'Daemons', types: ['daemon.enrolled', 'daemon.removed', 'daemon.online', 'daemon.offline', 'daemon.outbox.dead', 'daemon.outbox.recovered'] },
	{ id: 'delivery', label: 'Delivery problems', types: ['notification.failed'] },
];

export function day_label(ms: number, now: number = Date.now()): string {
	const d = new Date(ms);
	const t = new Date(now);
	const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const diff = Math.round((start(t) - start(d)) / 86_400_000);
	if (diff <= 0) return 'Today';
	if (diff === 1) return 'Yesterday';
	return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
