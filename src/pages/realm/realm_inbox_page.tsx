/**
 * Realm Inbox (Graphite) — the realm's home: everything that needs a person.
 *
 * Data: one `POST /v1/realm_inbox/get { org_slug, slug }` (BFF composes the
 * realm lookup, pending reviews and three run lists). The shell's sidebar
 * uses the shared overview read.
 */
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AlertTriangle, CheckCircle2, Lock, RefreshCw, SearchX, ShieldAlert } from 'lucide-react';
import { use_overview, relative_time } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import { inbox_item_href, run_href, type Inbox_item, type Realm_inbox_data } from '@/lib/realm_inbox';
import { Count_badge, Graphite_shell } from '@/components/graphite/graphite_shell';
import { Realm_nav } from '@/components/graphite/realm_nav';
import { State_pill } from '@/components/graphite/g_status';
import { KIND_STYLE, KIND_STRIPE, Kind_icon, ROW_ACTION_CLS, type G_kind } from '@/components/graphite/g_kinds';
import { ROW_OPENS, use_row_open } from '@/components/graphite/g_row';

export const INBOX_REFRESH_MS = 15_000;

type Filter = 'all' | 'review' | 'input' | 'failed';

function Stat({ label, value, tone, on, onClick }: { label: string; value: number; tone: string; on: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={on}
			data-testid={`inbox-stat-${label}`}
			className={`relative overflow-hidden rounded-[10px] border bg-[var(--g-panel)] px-4 py-3 text-left ${on ? 'border-[var(--g-acc-line)]' : 'border-[var(--g-line)] hover:border-[var(--g-line-strong)]'}`}
		>
			<span aria-hidden className="absolute inset-y-0 left-0 w-[2px]" style={{ background: value ? tone : 'transparent' }} />
			<span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--g-ink-3)]">{label}</span>
			<span className="g-mono mt-1 block text-[26px] font-medium leading-tight">{value}</span>
		</button>
	);
}

function Row({ item, org_slug, slug }: { item: Inbox_item; org_slug: string; slug: string }) {
	const row = use_row_open();
	const kind = item.kind as G_kind;
	const meta = KIND_STYLE[kind];
	return (
		<li {...row({ to: inbox_item_href(item, org_slug, slug) })} className={`flex items-start gap-3 border-b border-[var(--g-line-2)] px-4 py-3 last:border-b-0 ${ROW_OPENS}`} data-testid={`inbox-row-${item.kind}`}>
			<span className="mt-0.5"><Kind_icon kind={kind} /></span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13.5px] font-semibold">
					<span className="sr-only">{meta.label}: </span>
					{item.title}
				</p>
				<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--g-ink-3)]">
					{item.kind === 'failed' ? <State_pill state={item.state} /> : null}
					{[item.team, item.phase ? `phase ${item.phase}` : null, item.artifact_count ? `${item.artifact_count} artifact${item.artifact_count === 1 ? '' : 's'}` : null, relative_time(item.at)]
						.filter(Boolean)
						.join(' · ')}
				</div>
				{item.kind === 'failed' && item.error ? (
					<p className="g-mono mt-1.5 line-clamp-2 text-[11.5px] text-[var(--g-bad)]">{item.error}</p>
				) : null}
				{item.kind === 'review' && item.message ? (
					<p className="mt-1.5 line-clamp-2 text-[12px] text-[var(--g-ink-2)]">{item.message}</p>
				) : null}
			</div>
			<Link
				to={inbox_item_href(item, org_slug, slug)}
				className={ROW_ACTION_CLS}
			>
				{meta.action}
			</Link>
		</li>
	);
}

function Section_errors({ data }: { data: Realm_inbox_data }) {
	const labels: Record<keyof Realm_inbox_data['sections'], string> = {
		reviews: 'Reviews', awaiting_input: 'Runs awaiting input', failed: 'Recent failures', running: 'Running runs',
	};
	const failed = (Object.keys(data.sections) as Array<keyof Realm_inbox_data['sections']>).filter((k) => data.sections[k].status === 'error');
	if (failed.length === 0) return null;
	return (
		<div role="status" className="flex items-start gap-2 rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-3.5 py-2.5 text-[13px]">
			<ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--g-bad)]" />
			<div>
				Some of this inbox couldn’t be loaded:
				<ul className="mt-0.5 text-[12px] text-[var(--g-ink-2)]">
					{failed.map((k) => <li key={k}>{labels[k]} — {data.sections[k].error}</li>)}
				</ul>
			</div>
		</div>
	);
}

export function Inbox_view({ data, org_slug, slug }: { data: Realm_inbox_data; org_slug: string; slug: string }) {
	const [filter, set_filter] = useState<Filter>('all');
	const list = useMemo(() => (filter === 'all' ? data.items : data.items.filter((i) => i.kind === filter)), [data.items, filter]);
	const toggle = (f: Filter) => set_filter((cur) => (cur === f ? 'all' : f));

	return (
		<div className="flex flex-col gap-[18px]">
			<div>
				<h1 className="text-[22px] font-semibold tracking-[-0.02em]">Inbox</h1>
				<p className="mt-1 text-[13.5px] text-[var(--g-ink-3)]">
					What needs a person in <b className="text-[var(--g-ink)]">{data.realm.name || data.realm.slug}</b> — reviews, input requests and failures from the last 24 hours.
				</p>
			</div>

			<Section_errors data={data} />

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Stat label="Reviews" value={data.counts.reviews} tone={KIND_STRIPE.review} on={filter === 'review'} onClick={() => toggle('review')} />
				<Stat label="Needs input" value={data.counts.awaiting_input} tone={KIND_STRIPE.input} on={filter === 'input'} onClick={() => toggle('input')} />
				<Stat label="Failed · 24h" value={data.counts.failed_24h} tone={KIND_STRIPE.failed} on={filter === 'failed'} onClick={() => toggle('failed')} />
				<div className="relative overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3" data-testid="inbox-stat-Running">
					<span aria-hidden className="absolute inset-y-0 left-0 w-[2px]" style={{ background: data.counts.running ? KIND_STRIPE.run : 'transparent' }} />
					<span className="block text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--g-ink-3)]">Running</span>
					<span className="g-mono mt-1 block text-[26px] font-medium leading-tight">{data.counts.running}</span>
				</div>
			</div>

			<section className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-labelledby="inbox-h">
				<div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--g-line)] px-4 py-3">
					<h2 id="inbox-h" className="text-[15px] font-semibold">Needs attention</h2>
					<div className="ml-auto flex gap-1" role="tablist" aria-label="Filter inbox">
						{([['all', 'All', data.items.length], ['review', 'Reviews', data.items.filter((i) => i.kind === 'review').length], ['input', 'Input', data.items.filter((i) => i.kind === 'input').length], ['failed', 'Failed', data.items.filter((i) => i.kind === 'failed').length]] as const).map(([k, label, n]) => (
							<button
								key={k}
								type="button"
								role="tab"
								aria-selected={filter === k}
								onClick={() => set_filter(k)}
								className={`rounded-full px-2.5 py-0.5 text-[12px] ${filter === k ? 'bg-[var(--g-soft)] font-semibold text-[var(--g-ink)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}
							>
								{label} {n}
							</button>
						))}
					</div>
				</div>
				{list.length === 0 ? (
					<div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
						<CheckCircle2 aria-hidden className="h-7 w-7 text-[var(--g-ok)]" />
						<p className="text-[14px] font-semibold">{filter === 'all' ? 'Inbox zero' : 'Nothing here'}</p>
						<p className="text-[12.5px] text-[var(--g-ink-3)]">
							{filter === 'all' ? 'No reviews, input requests or recent failures in this realm.' : 'Nothing of this kind needs you right now.'}
						</p>
					</div>
				) : (
					<ul>{list.map((i) => <Row key={`${i.kind}-${i.id}`} item={i} org_slug={org_slug} slug={slug} />)}</ul>
				)}
			</section>

			<section className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-labelledby="inbox-live-h">
				<div className="flex items-center gap-2.5 border-b border-[var(--g-line)] px-4 py-3">
					<h2 id="inbox-live-h" className="text-[15px] font-semibold">Running now</h2>
					<span className="inline-flex"><Count_badge value={data.counts.running} tone="muted" /></span>
					<Link to={`/o/${org_slug}/realms/${slug}/runs`} className="ml-auto text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">All runs →</Link>
				</div>
				{data.live.length === 0 ? (
					<p className="px-4 py-6 text-[13px] text-[var(--g-ink-3)]">Nothing is running right now.</p>
				) : (
					<ul>
						{data.live.map((r) => (
							<li key={r.id} className="border-b border-[var(--g-line-2)] last:border-b-0">
								<Link to={run_href(org_slug, slug, r.run_id ?? r.id)} className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-[var(--g-soft)]">
									<span aria-hidden className="h-2 w-2 rounded-full bg-[var(--g-run)] shadow-[0_0_0_4px_var(--g-run-soft)]" />
									<span className="min-w-0 truncate text-[13.5px] font-semibold">
										{r.title}
										<span className="ml-2 text-[12px] font-normal text-[var(--g-ink-3)]">{[r.team, r.phase].filter(Boolean).join(' · ')}</span>
									</span>
									<span className="w-[80px] text-right text-[12px] text-[var(--g-ink-3)]">{relative_time(r.at)}</span>
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

/** BFF codes for “the BFF and Core are on different versions”. */
export const VERSION_SKEW_CODES = new Set(['upstream_route_missing', 'upstream_version_mismatch']);

export function Blocking_error({ http_status, error, on_retry, what, code = null }: { http_status: number | null; error: string; on_retry: () => void; what: string; code?: string | null }) {
	if (code && VERSION_SKEW_CODES.has(code)) {
		return (
			<div role="alert" data-testid="version-skew" className="mx-auto mt-10 max-w-[520px] rounded-xl border border-[var(--g-warn-line,var(--g-line))] bg-[var(--g-warn-soft)] p-6 text-center">
				<AlertTriangle aria-hidden className="mx-auto h-6 w-6 text-[var(--g-warn-text)]" />
				<p className="mt-2 text-[14px] font-semibold">The app and Core are out of sync</p>
				<p className="mt-1 text-[13px] text-[var(--g-ink-2)]">This {what} needs a newer Core than the one running. Restart or update Core, then try again.</p>
				<p className="g-mono mt-2 break-words text-[11.5px] text-[var(--g-ink-3)]">{error}</p>
				<button type="button" onClick={on_retry} className="mt-4 rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Try again</button>
			</div>
		);
	}
	if (http_status === 403) {
		return (
			<div role="alert" className="mx-auto mt-10 max-w-[460px] rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)] p-6 text-center">
				<Lock aria-hidden className="mx-auto h-7 w-7 text-[var(--g-ink-3)]" />
				<p className="mt-3 text-[14px] font-semibold">You don’t have access to this {what}</p>
				<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Ask a realm admin to add you, or switch to a realm you’re a member of.</p>
				<Link to="/home" className="mt-4 inline-block rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Back to overview</Link>
			</div>
		);
	}
	if (http_status === 404) {
		return (
			<div role="alert" className="mx-auto mt-10 max-w-[460px] rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)] p-6 text-center">
				<SearchX aria-hidden className="mx-auto h-7 w-7 text-[var(--g-ink-3)]" />
				<p className="mt-3 text-[14px] font-semibold">This {what} doesn’t exist</p>
				<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{error}</p>
				<Link to="/home" className="mt-4 inline-block rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Back to overview</Link>
			</div>
		);
	}
	return (
		<div role="alert" className="mx-auto mt-10 max-w-[460px] rounded-xl border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] p-6 text-center">
			<AlertTriangle aria-hidden className="mx-auto h-6 w-6 text-[var(--g-bad)]" />
			<p className="mt-2 text-[14px] font-semibold">Couldn’t load this {what}</p>
			<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{error}</p>
			<button type="button" onClick={on_retry} className="mt-4 rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Try again</button>
		</div>
	);
}

function Skeleton() {
	return (
		<div className="space-y-4" aria-busy="true" aria-label="Loading inbox">
			<div className="h-10 w-72 animate-pulse rounded bg-[var(--g-panel)]" />
			<div className="grid grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-[84px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" />)}</div>
			<div className="h-[320px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" />
		</div>
	);
}

export function Component() {
	const { org = '', slug = '' } = useParams();
	const overview = use_overview();
	const inbox = use_bff_read<Realm_inbox_data>(
		'/v1/realm_inbox/get',
		org && slug ? { org_slug: org, slug } : null,
		{ refresh_ms: INBOX_REFRESH_MS, fallback_error: 'Could not load this inbox.' },
	);
	const data = inbox.data;
	const realm_id = data?.realm.id ?? null;
	const sidebar_realm = overview.data?.orgs.flatMap((o) => o.realms).find((r) => r.id === realm_id) ?? null;

	return (
		<Graphite_shell
			data={overview.data}
			current_realm_id={realm_id}
			title="Inbox"
			actions={
				<button
					type="button"
					onClick={() => void inbox.reload()}
					className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"
					aria-label="Refresh"
					title="Refresh"
				>
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			}
		>
			<Realm_nav org_slug={org} slug={slug} realm={sidebar_realm} />
			<div className="px-7 py-6">
				{inbox.status === 'loading' ? <Skeleton /> : null}
				{inbox.status === 'error' && data ? (
					<p role="status" className="mb-3 text-[12px] text-[var(--g-warn-text)]">Showing the last loaded data — {inbox.error}</p>
				) : null}
				{inbox.status === 'error' && !data ? (
					<Blocking_error http_status={inbox.http_status} code={inbox.code} error={inbox.error} on_retry={() => void inbox.reload()} what="realm" />
				) : null}
				{data ? <Inbox_view data={data} org_slug={org} slug={slug} /> : null}
			</div>
		</Graphite_shell>
	);
}
