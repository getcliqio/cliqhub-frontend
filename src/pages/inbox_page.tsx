/**
 * Inbox (Graphite) — system events for the org you're in: runs failing,
 * daemons going offline, notifications that couldn't be delivered. Every
 * event looks the same. HUGs (reviews and input requests) are not here:
 * they have their own page.
 *
 * One `POST /v1/inbox/get` per filter; opening the inbox marks everything seen
 * (Core has no read state yet; kept per browser).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_bff_read, api_message } from '@/lib/use_bff_read';
import { use_view_scope, view_href, type View_scope } from '@/lib/view_scope';
import { INBOX_FILTERS, day_label, is_hug_event, mark_inbox_seen, read_inbox_seen, type Inbox_data, type Inbox_item } from '@/lib/inbox';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Inbox_row } from '@/components/graphite/g_inbox_row';

const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const INPUT = 'h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';

/** Event filters without the HUG kinds (those live in HUGs). */
const EVENT_FILTERS = INBOX_FILTERS.filter((f) => f.id !== 'reviews' && f.id !== 'input');

function Events({ scope, seen }: { scope: View_scope; seen: number }) {
	const auth_fetch = useAuthFetch();
	const [only_new, set_only_new] = useState(false);
	const [filter, set_filter] = useState<string | null>(null);
	const [q, set_q] = useState('');
	const [query, set_query] = useState('');
	const [older, set_older] = useState<{ items: Inbox_item[]; next: number | null } | null>(null);
	const [loading_more, set_loading_more] = useState(false);
	const [more_error, set_more_error] = useState<string | null>(null);

	// Debounce search so typing doesn't fire a request per key.
	useEffect(() => { const t = setTimeout(() => set_query(q.trim()), 300); return () => clearTimeout(t); }, [q]);

	const body = useMemo(() => {
		const b: Record<string, unknown> = { limit: 50 };
		if (scope.kind === 'org') b.org_id = scope.org.id;
		if (scope.kind === 'realm') { if (scope.org) b.org_id = scope.org.id; b.realm_id = scope.realm.id; }
		const f = EVENT_FILTERS.find((x) => x.id === filter);
		if (f) b.types = f.types;
		if (query) b.q = query;
		if (only_new && seen) b.since_ms = seen + 1;
		return b;
	}, [scope, filter, query, only_new, seen]);

	const read = use_bff_read<Inbox_data>('/v1/inbox/get', body, { refresh_ms: 60_000, fallback_error: 'Could not load notifications.' });
	useEffect(() => { set_older(null); set_more_error(null); }, [read.data]);

	const items = [...(read.data?.items ?? []), ...(older?.items ?? [])].filter((i) => !is_hug_event(i.event));
	const next = older ? older.next : read.data?.next_until_ms ?? null;

	async function load_more() {
		if (next == null) return;
		set_loading_more(true);
		set_more_error(null);
		try {
			const res = await auth_fetch('/v1/inbox/get', { method: 'POST', body: JSON.stringify({ ...body, until_ms: next }) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) { set_more_error(api_message(payload, 'Could not load more.')); return; }
			const d = payload.data as Inbox_data;
			set_older((cur) => ({ items: [...(cur?.items ?? []), ...d.items], next: d.next_until_ms }));
		} catch {
			set_more_error('Network error — check your connection.');
		} finally {
			set_loading_more(false);
		}
	}

	const failed_orgs = (read.data?.orgs ?? []).filter((o) => o.status === 'error');
	const groups: Array<{ day: string; items: Inbox_item[] }> = [];
	for (const i of items) {
		const d = day_label(i.at);
		if (groups.at(-1)?.day !== d) groups.push({ day: d, items: [] });
		groups.at(-1)!.items.push(i);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" aria-pressed={only_new} onClick={() => set_only_new(true)} className={PILL(only_new)}>New</button>
				<button type="button" aria-pressed={!only_new} onClick={() => set_only_new(false)} className={PILL(!only_new)}>All</button>
				<span className="mx-1 h-5 w-px bg-[var(--g-line)]" aria-hidden />
				<div role="group" aria-label="Kind" className="flex flex-wrap gap-2">
					{EVENT_FILTERS.map((f) => (
						<button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => set_filter((cur) => (cur === f.id ? null : f.id))} className={PILL(filter === f.id)}>{f.label}</button>
					))}
				</div>
				<input aria-label="Search notifications" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Search…" className={`${INPUT} ml-auto w-[200px]`} />
			</div>
			{failed_orgs.length ? (
				<p role="status" className="flex items-center gap-2 text-[12.5px] text-[var(--g-warn-text)]">
					<AlertTriangle aria-hidden className="h-3.5 w-3.5" />
					Couldn’t load notifications for {failed_orgs.map((o) => o.display_name).join(', ')}. What’s shown may be incomplete.
				</p>
			) : null}
			{read.status === 'loading' ? <div className="h-[360px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading notifications" /> : null}
			{read.status === 'error' && !read.data ? (
				<div role="alert" className="max-w-[460px] rounded-xl border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] p-5">
					<p className="text-[14px] font-semibold">Couldn’t load notifications</p>
					<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{read.error}</p>
					<button type="button" onClick={() => void read.reload()} className="mt-3 rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Try again</button>
				</div>
			) : null}
			{read.data ? (
				<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
					{items.length === 0 ? (
						<div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
							<Inbox aria-hidden className="h-6 w-6 text-[var(--g-ink-3)]" />
							<p className="text-[14px] font-semibold">{only_new ? 'You’re all caught up' : 'No notifications here'}</p>
							<p className="text-[12.5px] text-[var(--g-ink-3)]">System events for this org land here. Reviews and input requests are in HUGs.</p>
						</div>
					) : groups.map((g) => (
						<div key={g.day}>
							<div className="border-b border-[var(--g-line-2)] bg-[var(--g-head)] px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{g.day}</div>
							{g.items.map((i) => (
								<Inbox_row key={i.id} item={i} is_new={i.at > seen} show_realm_org={false}
									extra={i.realm_id && i.org_slug && i.event !== 'notification.failed' ? (
										<Link to={`/notifications?${new URLSearchParams({ tab: 'check', org: i.org_slug, realm: i.realm_id, event: i.event })}`} className="mt-1 inline-block text-[11.5px] text-[var(--g-ink-3)] underline decoration-dotted underline-offset-[3px] hover:text-[var(--g-ink)]">
											Why did I get this?
										</Link>
									) : null} />
							))}
						</div>
					))}
				</div>
			) : null}
			{more_error ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{more_error}</p> : null}
			{read.data && next != null ? (
				<button type="button" disabled={loading_more} onClick={() => void load_more()} className="self-center rounded-md border border-[var(--g-line)] px-4 py-1.5 text-[12.5px] font-semibold hover:bg-[var(--g-soft)] disabled:opacity-50">
					{loading_more ? 'Loading…' : 'Show older'}
				</button>
			) : null}
		</div>
	);
}

export function Component() {
	const overview = use_overview();
	const scope = use_view_scope(overview.data);
	const multi_org = (overview.data?.orgs.length ?? 0) > 0;
	// "New" is relative to when you arrived; opening the inbox resets the bell.
	const [seen] = useState(() => read_inbox_seen());
	useEffect(() => { mark_inbox_seen(); }, []);

	return (
		<Graphite_shell
			data={overview.data}
			title="Inbox"
			actions={
				<button type="button" onClick={() => void overview.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			}
		>
			<div className="flex flex-col gap-[18px] px-7 py-6">
				<div className="flex items-end gap-3">
					<div>
						<h1 className="text-[24px] font-semibold tracking-[-0.02em]">Inbox</h1>
						<p className="mt-1 text-[13.5px] text-[var(--g-ink-3)]">What happened in this org. Reviews and input requests are in <Link to="/hugs" className="text-[var(--g-acc)] hover:underline">HUGs</Link>.</p>
					</div>
					<Link to={view_href('/my-notifications', scope, multi_org)} className="mb-1 ml-auto text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">My notifications →</Link>
				</div>
				{/* Wait for the org to resolve so the first request is already scoped. */}
				{overview.status === 'loading' ? <div className="h-[300px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" />
					: <Events scope={scope} seen={seen} />}
			</div>
		</Graphite_shell>
	);
}
