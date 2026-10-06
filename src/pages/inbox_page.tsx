/**
 * Inbox (Graphite) — what's waiting on you, and everything you've been told.
 *
 *   Needs me          — reviews + input requests, from the overview the shell
 *                       already loads (no extra call).
 *   All notifications — in-app notifications across your orgs: one
 *                       `POST /v1/inbox/get` per view (the BFF fans out per org).
 *
 * Follows the view switcher. Opening "All notifications" marks everything
 * seen (Core has no read state yet; kept per browser).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview, type Overview_item } from '@/lib/overview';
import { use_bff_read, api_message } from '@/lib/use_bff_read';
import { use_view_scope, view_href, type View_scope } from '@/lib/view_scope';
import { INBOX_FILTERS, day_label, mark_inbox_seen, read_inbox_seen, type Inbox_data, type Inbox_item } from '@/lib/inbox';
import { Graphite_shell, Org_chip } from '@/components/graphite/graphite_shell';
import { Inbox_row } from '@/components/graphite/g_inbox_row';

type Tab = 'needs' | 'all';

const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const INPUT = 'h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';

/** Overview "needs you" item → inbox row shape (same row, same actions). */
export function needs_to_item(i: Overview_item): Inbox_item {
	return {
		id: `${i.kind}-${i.id}`,
		event: i.kind === 'review' ? 'hug.review_requested' : 'phase.input_required',
		title: i.title,
		message: i.phase ? `${i.kind === 'review' ? 'Review gate' : 'Waiting for input'} · ${i.phase}` : null,
		severity: null,
		org_id: i.org_id,
		org_slug: i.org_slug,
		realm_id: i.realm_id,
		realm_slug: i.realm_slug,
		team: i.team,
		run_id: i.run_id,
		phase: i.phase,
		review_id: i.kind === 'review' ? i.id : null,
		channel_id: null,
		original_event: null,
		at: i.at ?? 0,
	};
}

function in_view(i: { org_id: string | null; realm_id: string | null }, scope: View_scope): boolean {
	if (scope.kind === 'all') return true;
	if (scope.kind === 'org') return i.org_id === scope.org.id;
	return i.realm_id === scope.realm.id;
}

function Needs_tab({ items, total, scope, multi_org, org_chip }: { items: Overview_item[]; total: number; scope: View_scope; multi_org: boolean; org_chip: (id: string | null) => React.ReactNode }) {
	const [kind, set_kind] = useState<'all' | 'review' | 'input'>('all');
	const [q, set_q] = useState('');
	const mine = items.filter((i) => in_view(i, scope));
	const shown = mine
		.filter((i) => kind === 'all' || i.kind === kind)
		.filter((i) => !q.trim() || `${i.title} ${i.team ?? ''} ${i.realm_slug ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
		// Oldest waiting first: the longest wait is the most urgent.
		.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
	const n = (k: 'review' | 'input') => mine.filter((i) => i.kind === k).length;
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<button type="button" aria-pressed={kind === 'all'} onClick={() => set_kind('all')} className={PILL(kind === 'all')}>All <span className="g-mono text-[11px] text-[var(--g-ink-3)]">{mine.length}</span></button>
				<button type="button" aria-pressed={kind === 'review'} onClick={() => set_kind('review')} className={PILL(kind === 'review')}>Reviews <span className="g-mono text-[11px] text-[var(--g-ink-3)]">{n('review')}</span></button>
				<button type="button" aria-pressed={kind === 'input'} onClick={() => set_kind('input')} className={PILL(kind === 'input')}>Input <span className="g-mono text-[11px] text-[var(--g-ink-3)]">{n('input')}</span></button>
				<input aria-label="Search waiting items" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Search…" className={`${INPUT} ml-auto w-[220px]`} />
			</div>
			<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
				{shown.length ? (
					<>
						<div className="border-b border-[var(--g-line-2)] bg-[#121316] px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Oldest waiting first</div>
						{shown.map((i) => <Inbox_row key={`${i.kind}-${i.id}`} item={needs_to_item(i)} is_new={false} show_realm_org={multi_org && scope.kind === 'all'} org_chip={org_chip(i.org_id)} />)}
						{total > mine.length && kind === 'all' && !q.trim() ? (
							<p className="border-t border-[var(--g-line-2)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]" data-testid="needs-more">
								Showing the {mine.length} most recent of {total}. Open a realm to see the rest.
							</p>
						) : null}
					</>
				) : (
					<div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
						<Inbox aria-hidden className="h-6 w-6 text-[var(--g-ink-3)]" />
						<p className="text-[14px] font-semibold">Nothing is waiting on you</p>
						<p className="text-[12.5px] text-[var(--g-ink-3)]">Reviews and input requests show up here.</p>
					</div>
				)}
			</div>
		</div>
	);
}

function All_tab({ scope, multi_org, org_chip, seen }: { scope: View_scope; multi_org: boolean; org_chip: (id: string | null) => React.ReactNode; seen: number }) {
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
		const f = INBOX_FILTERS.find((x) => x.id === filter);
		if (f) b.types = f.types;
		if (query) b.q = query;
		if (only_new && seen) b.since_ms = seen + 1;
		return b;
	}, [scope, filter, query, only_new, seen]);

	const read = use_bff_read<Inbox_data>('/v1/inbox/get', body, { refresh_ms: 60_000, fallback_error: 'Could not load notifications.' });
	useEffect(() => { set_older(null); set_more_error(null); }, [read.data]);

	const items = [...(read.data?.items ?? []), ...(older?.items ?? [])];
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
					{INBOX_FILTERS.map((f) => (
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
							<p className="text-[12.5px] text-[var(--g-ink-3)]">In-app notifications land here. Slack, email and webhooks are set up in Notifications.</p>
						</div>
					) : groups.map((g) => (
						<div key={g.day}>
							<div className="border-b border-[var(--g-line-2)] bg-[#121316] px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{g.day}</div>
							{g.items.map((i) => (
								<Inbox_row key={i.id} item={i} is_new={i.at > seen} show_realm_org={multi_org && scope.kind === 'all'} org_chip={org_chip(i.org_id)}
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
	const [search, set_search] = useSearchParams();
	const tab: Tab = search.get('tab') === 'all' ? 'all' : 'needs';
	const multi_org = (overview.data?.orgs.length ?? 0) > 0;
	const orgs = new Map((overview.data?.orgs ?? []).map((o) => [o.id, o]));
	const org_chip = (id: string | null) => (id && orgs.get(id) ? <Org_chip org={orgs.get(id)!} size={13} /> : null);
	// "New" is relative to when you arrived; opening the list resets the bell.
	const [seen] = useState(() => read_inbox_seen());
	useEffect(() => { if (tab === 'all') mark_inbox_seen(); }, [tab]);

	const needs = overview.data?.needs_you ?? [];
	// Same number as the sidebar badge: Core's totals (the list itself is capped by the BFF).
	const view_org = scope.kind === 'all' ? null : scope.org;
	const needs_total = scope.kind === 'realm' ? scope.realm.needs_you : view_org ? view_org.counts.needs_you : overview.data?.totals.needs_you ?? 0;
	const needs_count = needs_total;
	const new_count = overview.data?.inbox?.new_count ?? 0;
	const on_tab = (t: Tab) => set_search((prev) => { const p = new URLSearchParams(prev); if (t === 'needs') p.delete('tab'); else p.set('tab', t); return p; }, { replace: true });

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
				<div>
					<h1 className="text-[24px] font-semibold tracking-[-0.02em]">Inbox</h1>
					<p className="mt-1 text-[13.5px] text-[var(--g-ink-3)]">What’s waiting on you, and everything you’ve been told.</p>
				</div>
				<div className="flex items-end gap-1 border-b border-[var(--g-line)]">
					<div role="tablist" aria-label="Inbox" className="flex gap-1">
						{([['needs', 'Needs me', needs_count, 'var(--g-warn)'], ['all', 'All notifications', tab === 'all' ? 0 : new_count, 'var(--g-acc)']] as const).map(([id, label, n, bg]) => (
							<button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => on_tab(id)} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium ${tab === id ? 'border-[var(--g-acc)] text-[var(--g-ink)]' : 'border-transparent text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>
								{label}
								{n ? <span className="rounded-full px-1.5 text-[10.5px] font-bold leading-[17px] text-[var(--g-on-color)]" style={{ background: bg }}>{n}</span> : null}
							</button>
						))}
					</div>
					<Link to={view_href('/notifications', scope, multi_org)} className="mb-2 ml-auto text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">Notification settings →</Link>
				</div>
				{tab === 'needs' ? (
					overview.status === 'loading' ? <div className="h-[300px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" /> : (
						overview.status === 'error' && !overview.data
							? <p role="alert" className="text-[13px] text-[var(--g-bad)]">{overview.error}</p>
							: <Needs_tab items={needs} total={needs_total} scope={scope} multi_org={multi_org} org_chip={org_chip} />
					)
				) : (
					// Wait for the view to resolve so the first request is already scoped.
					overview.status === 'loading' ? <div className="h-[300px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" />
						: <All_tab scope={scope} multi_org={multi_org} org_chip={org_chip} seen={seen} />
				)}
			</div>
		</Graphite_shell>
	);
}
