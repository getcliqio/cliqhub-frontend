/**
 * HUGs (Graphite) — everything in the org waiting on a person: human reviews
 * and agents asking for input. Its own app, not part of the inbox.
 *
 *   Waiting — reviews + input requests, from the overview the shell already
 *             loads (no extra call), oldest first.
 *   Done    — answered, resolved or expired HUGs: the org's `hug.*` and
 *             `phase.inputs_supplied` events from `POST /v1/inbox/get`.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Hand, RefreshCw } from 'lucide-react';
import { use_overview, type Overview_item } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { use_view_scope, type View_scope } from '@/lib/view_scope';
import { day_label, type Inbox_data, type Inbox_item } from '@/lib/inbox';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Inbox_row } from '@/components/graphite/g_inbox_row';

type Tab = 'waiting' | 'done';

const PILL = (on: boolean) => `inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[12.5px] ${on ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`;
const INPUT = 'h-8 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';

/** HUG events that mean "settled" (the Done list). */
export const HUG_DONE_TYPES = ['hug.review_responded', 'hug.review_resolved', 'hug.review_expired', 'phase.inputs_supplied'];

/** Overview "needs you" item → the shared row shape (same row, same actions). */
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
	if (scope.kind === 'all') return false;
	if (scope.kind === 'org') return i.org_id === scope.org.id;
	return i.realm_id === scope.realm.id;
}

function Empty({ title, body }: { title: string; body: string }) {
	return (
		<div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
			<Hand aria-hidden className="h-6 w-6 text-[var(--g-ink-3)]" />
			<p className="text-[14px] font-semibold">{title}</p>
			<p className="text-[12.5px] text-[var(--g-ink-3)]">{body}</p>
		</div>
	);
}

function Waiting({ items, total, scope }: { items: Overview_item[]; total: number; scope: View_scope }) {
	const [kind, set_kind] = useState<'all' | 'review' | 'input'>('all');
	const [q, set_q] = useState('');
	const mine = items.filter((i) => (i.kind === 'review' || i.kind === 'input') && in_view(i, scope));
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
				<input aria-label="Search HUGs" value={q} onChange={(e) => set_q(e.target.value)} placeholder="Search…" className={`${INPUT} ml-auto w-[220px]`} />
			</div>
			<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
				{shown.length ? (
					<>
						<div className="border-b border-[var(--g-line-2)] bg-[var(--g-head)] px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Oldest waiting first</div>
						{shown.map((i) => <Inbox_row key={`${i.kind}-${i.id}`} item={needs_to_item(i)} is_new={false} show_realm_org={false} />)}
						{total > mine.length && kind === 'all' && !q.trim() ? (
							<p className="border-t border-[var(--g-line-2)] px-4 py-2.5 text-[12px] text-[var(--g-ink-3)]" data-testid="needs-more">
								Showing the {mine.length} most recent of {total}. Open a realm to see the rest.
							</p>
						) : null}
					</>
				) : <Empty title="Nothing is waiting on you" body="Reviews, and agents asking a question, show up here." />}
			</div>
		</div>
	);
}

function Done({ scope }: { scope: View_scope }) {
	const body = useMemo(() => {
		const b: Record<string, unknown> = { limit: 50, types: HUG_DONE_TYPES };
		if (scope.org) b.org_id = scope.org.id;
		if (scope.kind === 'realm') b.realm_id = scope.realm.id;
		return b;
	}, [scope]);
	const read = use_bff_read<Inbox_data>('/v1/inbox/get', body, { refresh_ms: 60_000, fallback_error: 'Could not load past HUGs.' });
	const items = (read.data?.items ?? []).filter((i) => in_view(i, scope));
	const groups: Array<{ day: string; items: Inbox_item[] }> = [];
	for (const i of items) {
		const d = day_label(i.at);
		if (groups.at(-1)?.day !== d) groups.push({ day: d, items: [] });
		groups.at(-1)!.items.push(i);
	}
	if (read.status === 'loading') return <div className="h-[300px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" />;
	if (read.status === 'error' && !read.data) return <p role="alert" className="text-[13px] text-[var(--g-bad)]">{read.error}</p>;
	return (
		<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
			{items.length ? groups.map((g) => (
				<div key={g.day}>
					<div className="border-b border-[var(--g-line-2)] bg-[var(--g-head)] px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{g.day}</div>
					{g.items.map((i) => <Inbox_row key={i.id} item={i} is_new={false} show_realm_org={false} />)}
				</div>
			)) : <Empty title="No past HUGs yet" body="Answered reviews and supplied inputs show up here." />}
		</div>
	);
}

export function Component() {
	const overview = use_overview();
	const scope = use_view_scope(overview.data);
	const [search, set_search] = useSearchParams();
	const tab: Tab = search.get('tab') === 'done' ? 'done' : 'waiting';
	const waiting_total = scope.kind === 'realm' ? scope.realm.needs_you : scope.org ? scope.org.counts.needs_you : 0;
	const on_tab = (t: Tab) => set_search((prev) => { const p = new URLSearchParams(prev); if (t === 'waiting') p.delete('tab'); else p.set('tab', t); return p; }, { replace: true });

	return (
		<Graphite_shell
			data={overview.data}
			title="HUGs"
			actions={
				<button type="button" onClick={() => void overview.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			}
		>
			<div className="flex flex-col gap-[18px] px-7 py-6">
				<div>
					<h1 className="text-[24px] font-semibold tracking-[-0.02em]">HUGs</h1>
					<p className="mt-1 text-[13.5px] text-[var(--g-ink-3)]">Human reviews, and agents asking a question: the runs waiting on a person.</p>
				</div>
				<div role="tablist" aria-label="HUGs" className="flex gap-1 border-b border-[var(--g-line)]">
					{([['waiting', 'Waiting', waiting_total], ['done', 'Done', 0]] as const).map(([id, label, n]) => (
						<button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => on_tab(id)} className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium ${tab === id ? 'border-[var(--g-acc)] text-[var(--g-ink)]' : 'border-transparent text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>
							{label}
							{n ? <span className="rounded-full bg-[var(--g-warn)] px-1.5 text-[10.5px] font-bold leading-[17px] text-[var(--g-on-color)]">{n}</span> : null}
						</button>
					))}
				</div>
				{overview.status === 'loading' ? <div className="h-[300px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading" />
					: overview.status === 'error' && !overview.data ? <p role="alert" className="text-[13px] text-[var(--g-bad)]">{overview.error}</p>
						: tab === 'waiting' ? <Waiting items={overview.data?.needs_you ?? []} total={waiting_total} scope={scope} /> : <Done scope={scope} />}
			</div>
		</Graphite_shell>
	);
}
