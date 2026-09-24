import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth_context';
import { useOrgFetch } from './org_context';
import { hub_payload } from './hub_envelope';

/**
 * Shared counter hook for sidebar + top-bar unread badges.
 *
 * Notifications don't have a server-side read/unread column yet, so
 * "unread" here means "notification created after the user last opened
 * the inbox". The inbox route calls `mark_notifications_seen()` on
 * mount, which bumps a timestamp in localStorage and fires a same-tab
 * event so the badge clears immediately (not after the next poll).
 *
 * HUG reviews DO have server-side status, so the pending count comes
 * straight from `/v1/reviews/get?limit=1` (we only need `total`).
 */

const NOTIFICATIONS_SEEN_KEY = 'cliqhub_notifications_last_seen_ms';
const NOTIFICATIONS_SEEN_EVENT = 'cliqhub:notifications-seen';
const POLL_INTERVAL_MS = 10_000;
/** How many recent rows we inspect for the unread badge. */
const UNREAD_SCAN_LIMIT = 100;
/** Cap the visible count so a huge backlog doesn't blow out the badge. */
const BADGE_CAP = 99;

export interface Sidebar_badge_counts {
	unread_notifications: number;
	pending_reviews: number;
}

function read_last_seen(): number {
	if (typeof window === 'undefined') return 0;
	try {
		const raw = window.localStorage.getItem(NOTIFICATIONS_SEEN_KEY);
		if (!raw) return 0;
		const parsed = Number(raw);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	} catch {
		return 0;
	}
}

/** Stamp "seen now" and notify listeners (same tab + other tabs). */
export function mark_notifications_seen(): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(NOTIFICATIONS_SEEN_KEY, String(Date.now()));
	} catch {
		/* localStorage may be blocked — badges just won't clear across
		 * sessions, which is fine. */
	}
	window.dispatchEvent(new Event(NOTIFICATIONS_SEEN_EVENT));
}

/** Render helper — "42" or "99+". */
export function format_badge(count: number): string {
	if (count <= 0) return '';
	if (count > BADGE_CAP) return `${BADGE_CAP}+`;
	return String(count);
}

export function use_sidebar_badges(): Sidebar_badge_counts {
	const { user } = useAuth();
	const auth_fetch = useOrgFetch();
	const [counts, set_counts] = useState<Sidebar_badge_counts>({
		unread_notifications: 0,
		pending_reviews: 0,
	});

	const refresh = useCallback(async () => {
		if (!user) return;
		try {
			const last_seen = read_last_seen();
			const [notif_res, reviews_res] = await Promise.all([
				auth_fetch('/v1/notifications/get', {
					method: 'POST',
					body: JSON.stringify({ limit: UNREAD_SCAN_LIMIT, offset: 0 }),
				}),
				auth_fetch('/v1/reviews/get', {
					method: 'POST',
					body: JSON.stringify({ limit: 1, offset: 0 }),
				}),
			]);
			const notif_data = await notif_res.json().catch(() => ({}));
			const reviews_data = await reviews_res.json().catch(() => ({}));

			let unread = 0;
			const page = hub_payload<{ items?: Array<{ created_at?: number }>; notifications?: Array<{ created_at?: number }> }>(notif_data);
			const notif_items = notif_data?.ok
				? (page?.items ?? page?.notifications ?? [])
				: [];
			if (notif_items.length > 0) {
				for (const n of notif_items) {
					const ts = Number(n?.created_at ?? 0);
					if (Number.isFinite(ts) && ts > last_seen) unread += 1;
				}
				if (unread >= UNREAD_SCAN_LIMIT && notif_items.length >= UNREAD_SCAN_LIMIT) {
					unread = BADGE_CAP + 1;
				}
			}

			let pending = 0;
			if (reviews_data?.ok) {
				pending = Number(reviews_data.total ?? 0) || 0;
			}

			set_counts({ unread_notifications: unread, pending_reviews: pending });
		} catch {
			/* Keep previous counts — a badge is a hint, not a hard requirement. */
		}
	}, [auth_fetch, user]);

	useEffect(() => {
		if (!user) return;
		void refresh();
		const id = window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);

		function on_visibility() {
			if (document.visibilityState === 'visible') void refresh();
		}
		document.addEventListener('visibilitychange', on_visibility);

		// Other tabs stamp localStorage → `storage` fires here.
		function on_storage(e: StorageEvent) {
			if (e.key === NOTIFICATIONS_SEEN_KEY) void refresh();
		}
		window.addEventListener('storage', on_storage);

		// Same tab: inbox calls mark_notifications_seen() → clear now.
		function on_seen() {
			set_counts((prev) => ({ ...prev, unread_notifications: 0 }));
			void refresh();
		}
		window.addEventListener(NOTIFICATIONS_SEEN_EVENT, on_seen);

		return () => {
			window.clearInterval(id);
			document.removeEventListener('visibilitychange', on_visibility);
			window.removeEventListener('storage', on_storage);
			window.removeEventListener(NOTIFICATIONS_SEEN_EVENT, on_seen);
		};
	}, [refresh, user]);

	return counts;
}
