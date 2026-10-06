/**
 * Overview — cross-org start page (Graphite).
 *
 * Data: one `POST /v1/overview/get` (BFF composes Core per org).
 * Adapts to the user's tenancy:
 *   - the view (all orgs / one org) comes from the switcher via `?org=`
 *   - one realm → realms panel collapses to a single row, CTA to open it
 *   - no realms → onboarding empty state
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleHelp, RefreshCw, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import {
	item_href,
	relative_time,
	scope_overview,
	use_overview,
	type Overview_data,
	type Overview_item,
	type Overview_org,
	type Overview_realm,
} from '@/lib/overview';
import { realm_path } from '@/lib/realm_url';
import { sort_realms, use_view_scope } from '@/lib/view_scope';
import { KIND_STYLE, KIND_STRIPE, Kind_icon, ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Count_badge, Graphite_shell, Org_chip, Realm_dot } from '@/components/graphite/graphite_shell';

function greeting(now = new Date()): string {
	const h = now.getHours();
	if (h < 12) return 'Good morning';
	if (h < 18) return 'Good afternoon';
	return 'Good evening';
}

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/* ------------------------------------------------------------------ */

type Stat_tone = 'attention' | 'run' | 'failed' | 'ok' | 'warn' | 'muted';

const STAT_STRIPE: Record<Stat_tone, string> = {
	attention: KIND_STRIPE.attention,
	run: KIND_STRIPE.run,
	failed: KIND_STRIPE.failed,
	ok: 'var(--g-ok)',
	warn: 'var(--g-warn)',
	muted: 'var(--g-line)',
};

/** Every tile carries its colour strip, so the row reads as one set. */
function Stat({ label, value, sub, tone, emphasize = false }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone: Stat_tone; emphasize?: boolean }) {
	return (
		<div className="relative overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3.5" data-testid={`stat-${label}`} data-tone={tone}>
			<span aria-hidden className="absolute inset-y-0 left-0 w-[2px]" style={{ background: STAT_STRIPE[tone] }} />
			<div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--g-ink-3)]">{label}</div>
			<div className={`g-mono mt-1 text-[28px] font-medium leading-tight tracking-[-0.02em] ${emphasize ? 'text-[var(--g-warn-text)]' : ''}`}>{value}</div>
			{sub ? <div className="mt-0.5 text-[11.5px] text-[var(--g-ink-3)]">{sub}</div> : null}
		</div>
	);
}

function Where({ item, show_org, org }: { item: Overview_item; show_org: boolean; org?: Overview_org }) {
	if (!item.realm_slug) return null;
	return (
		<span className="g-mono inline-flex items-center gap-1.5 rounded border border-[var(--g-line-2)] bg-[var(--g-soft)] px-1.5 py-px text-[11px] text-[var(--g-ink-2)]" title={`${item.org_slug} › ${item.realm_slug}`}>
			{show_org && org ? <Org_chip org={org} size={13} /> : null}
			{item.realm_slug}
		</span>
	);
}

function Needs_row({ item, show_org, org }: { item: Overview_item; show_org: boolean; org?: Overview_org }) {
	const meta = KIND_STYLE[item.kind];
	return (
		<li className="flex items-center gap-3 border-b border-[var(--g-line-2)] px-4 py-3 last:border-b-0">
			<Kind_icon kind={item.kind} />
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13.5px] font-semibold">
					<span className="sr-only">{meta.label}: </span>
					{item.title}
				</p>
				<div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--g-ink-3)]">
					<Where item={item} show_org={show_org} org={org} />
					{[item.team, item.phase, relative_time(item.at)].filter(Boolean).join(' · ')}
				</div>
			</div>
			<Link to={item_href(item)} className={ROW_ACTION_CLS}>
				{meta.action}
			</Link>
		</li>
	);
}

const REALMS_PANEL_LIMIT = 6;

function Realms_panel({ orgs, realms, total }: { orgs: Overview_org[]; realms: Overview_realm[]; total: number }) {
	const org_by_id = new Map(orgs.map((o) => [o.id, o]));
	const failed_orgs = orgs.filter((o) => o.status === 'error');
	return (
		<section className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-labelledby="realms-h">
			<div className="flex items-center gap-2.5 border-b border-[var(--g-line)] px-4 py-3">
				<h2 id="realms-h" className="text-[15px] font-semibold">Realms</h2>
				<span className="text-[12px] text-[var(--g-ink-3)]">waiting on you first</span>
				<Link to="/realms" className="ml-auto text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">All {total} realms →</Link>
			</div>
			{realms.map((r) => {
				const org = org_by_id.get(r.org_id);
				return (
					<Link
						key={r.id}
						to={`${realm_path(r.org_slug, r.slug)}/inbox`}
						data-testid={`realm-${r.org_slug}-${r.slug}`}
						className="flex items-center gap-3 border-b border-[var(--g-line-2)] px-4 py-2.5 last:border-b-0 hover:bg-[var(--g-soft)]"
					>
						<Realm_dot realm={r} />
						<span className="min-w-0 flex-1">
							<b className="block truncate text-[13.5px] font-semibold">{r.name || r.slug}</b>
							<span className="flex items-center gap-1.5 truncate text-[12px] text-[var(--g-ink-3)]">
								{org ? <Org_chip org={org} size={13} /> : null}
								{org?.display_name || r.org_slug}
								<span aria-hidden>·</span>
								{r.daemons.total === 0 ? 'no daemons' : `${r.daemons.online}/${r.daemons.total} daemons`}
								{r.active_runs ? <><span aria-hidden>·</span>{r.active_runs} running</> : null}
							</span>
						</span>
						{r.needs_you ? (
							<span className="rounded-full bg-[var(--g-warn-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--g-warn-text)]">
								{r.needs_you} need{r.needs_you === 1 ? 's' : ''} you
							</span>
						) : (
							<ArrowRight aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
						)}
					</Link>
				);
			})}
			{total === 0 ? <p className="px-4 py-6 text-[13px] text-[var(--g-ink-3)]">No realms in this view.</p> : null}
			{failed_orgs.map((o) => (
				<p key={o.id} role="status" data-testid={`org-error-${o.slug}`} className="flex items-center gap-2 border-t border-[var(--g-line-2)] px-4 py-2.5 text-[12.5px] text-[var(--g-bad)]">
					<AlertTriangle aria-hidden className="h-3.5 w-3.5" />
					Couldn’t load realms for {o.display_name || o.slug}: {o.error}
				</p>
			))}
		</section>
	);
}

function Skeleton() {
	return (
		<div className="space-y-4" aria-busy="true" aria-label="Loading overview">
			<div className="grid grid-cols-4 gap-3.5">
				{[0, 1, 2, 3].map((i) => <div key={i} className="h-[104px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" />)}
			</div>
			<div className="grid grid-cols-[1.5fr_1fr] gap-3.5">
				<div className="h-[320px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" />
				<div className="h-[320px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" />
			</div>
		</div>
	);
}

function Empty_no_realms() {
	return (
		<div className="mx-auto mt-10 max-w-[520px] rounded-xl border border-[var(--g-line)] bg-[var(--g-panel)] p-8 text-center">
			<CircleHelp aria-hidden className="mx-auto h-8 w-8 text-[var(--g-ink-3)]" />
			<h2 className="mt-3 text-[18px] font-semibold">You don’t have any realms yet</h2>
			<p className="mt-2 text-[13.5px] text-[var(--g-ink-3)]">
				A realm is where your daemons, teams and runs live. Create one, or ask an admin to invite you to theirs.
			</p>
			<div className="mt-5 flex justify-center gap-2">
				<Link to="/realms" className="rounded-lg bg-[var(--g-acc)] px-4 py-2 text-[13px] font-semibold text-[var(--g-on-acc)]">Create a realm</Link>
				<Link to="/getting-started" className="rounded-lg border border-[var(--g-line)] px-4 py-2 text-[13px] font-semibold">Getting started</Link>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */

type Needs_filter = 'all' | 'review' | 'input';

export function Overview_view({ data }: { data: Overview_data }) {
	const { user } = useAuth();
	const [needs_filter, set_needs_filter] = useState<Needs_filter>('all');
	// The view comes from the switcher (URL); this page never filters on its own.
	const scope = use_view_scope(data);
	const view_org = scope.kind === 'org' ? scope.org : null;

	const view = useMemo(() => scope_overview(data, view_org?.id ?? null), [data, view_org]);
	// Same org-aware layout whether you belong to one org or many.
	const multi_org = data.orgs.length > 0;
	const show_org_tags = multi_org && scope.kind === 'all';

	const reviews = view.needs_you.filter((i) => i.kind === 'review').length;
	const inputs = view.needs_you.filter((i) => i.kind === 'input').length;
	const needs_list = needs_filter === 'all' ? view.needs_you : view.needs_you.filter((i) => i.kind === needs_filter);
	const realms_with_activity = new Set(view.live_runs.map((r) => r.realm_id).filter(Boolean)).size;
	const offline = view.totals.daemons_total - view.totals.daemons_online;
	// Same panel in every view: realms, each labelled with its org — no view switching.
	const view_realms = sort_realms(view.orgs.flatMap((o) => o.realms));
	const realms_panel = view_realms.slice(0, REALMS_PANEL_LIMIT);
	const realms_total = view_realms.length;

	if (data.totals.realms === 0 && !data.partial) return <Empty_no_realms />;

	return (
		<div className="flex flex-col gap-[18px]">
			<div>
				{view_org && multi_org ? (
					<>
						<h1 className="flex items-center gap-2.5 text-[24px] font-semibold tracking-[-0.02em]"><Org_chip org={view_org} size={26} />{view_org.display_name || view_org.slug}</h1>
						<p className="mt-1 text-[13.5px] text-[var(--g-ink-3)]">
							<b className="text-[var(--g-ink)]">{plural(view.totals.realms, 'realm')}</b> · you’re {article(view_org.role)} {view_org.role}
						</p>
					</>
				) : (
					<>
						<h1 className="text-[24px] font-semibold tracking-[-0.02em]">
							{greeting()}, {user?.display_name?.split(' ')[0] || user?.username}
						</h1>
						<p className="mt-1 text-[13.5px] text-[var(--g-ink-3)]">
							{show_org_tags ? <>Across <b className="text-[var(--g-ink)]">{plural(data.orgs.length, 'org')}</b> and </> : <>Across </>}
							<b className="text-[var(--g-ink)]">{plural(view.totals.realms, 'realm')}</b> you can access.
						</p>
					</>
				)}
			</div>

			{view.partial ? (
				<div role="status" className="flex items-center gap-2 rounded-[10px] border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] px-3.5 py-2.5 text-[13px]">
					<ShieldAlert aria-hidden className="h-4 w-4 text-[var(--g-bad)]" />
					Some data couldn’t be loaded. Numbers below cover only what loaded.
				</div>
			) : null}

			<div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
				<Stat
					label="Waiting on you"
					tone="attention"
					emphasize={view.totals.needs_you > 0}
					value={view.totals.needs_you}
					sub={`${plural(view.totals.pending_reviews, 'review')} · ${plural(view.totals.awaiting_input, 'input')}`}
				/>
				<Stat
					label="Running now"
					tone="run"
					value={view.totals.active_runs}
					sub={realms_with_activity ? `in ${plural(realms_with_activity, 'realm')}` : 'nothing running'}
				/>
				<Stat
					label="Failed · 24h"
					tone="failed"
					value={view.totals.failed_24h}
					sub={`${view.totals.completed_24h} completed`}
				/>
				<Stat
					label="Daemons"
					tone={view.totals.daemons_total === 0 ? 'muted' : offline ? 'warn' : 'ok'}
					value={<>{view.totals.daemons_online}<span className="text-[16px] text-[var(--g-ink-3)]">/{view.totals.daemons_total}</span></>}
					sub={view.totals.daemons_total === 0 ? 'none enrolled' : offline ? `${offline} offline` : 'all online'}
				/>
			</div>

			<div className="grid gap-3.5 xl:grid-cols-[1.5fr_1fr]">
				<section className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-labelledby="needs-h">
					<div className="flex items-center gap-2.5 border-b border-[var(--g-line)] px-4 py-3">
						<h2 id="needs-h" className="text-[15px] font-semibold">Needs you</h2>
						<span className="text-[12px] text-[var(--g-ink-3)]">{show_org_tags ? 'across every org' : view_org && multi_org ? 'in this org' : 'across your realms'}</span>
						<div className="ml-auto flex gap-1" role="tablist" aria-label="Filter needs">
							<Tab on={needs_filter === 'all'} onClick={() => set_needs_filter('all')}>All {view.needs_you.length}</Tab>
							<Tab on={needs_filter === 'review'} onClick={() => set_needs_filter('review')}>Reviews {reviews}</Tab>
							<Tab on={needs_filter === 'input'} onClick={() => set_needs_filter('input')}>Input {inputs}</Tab>
						</div>
					</div>
					{needs_list.length === 0 ? (
						<div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
							<CheckCircle2 aria-hidden className="h-7 w-7 text-[var(--g-ok)]" />
							<p className="text-[14px] font-semibold">You’re all caught up</p>
							<p className="text-[12.5px] text-[var(--g-ink-3)]">Reviews and input requests will show up here.</p>
						</div>
					) : (
						<ul>{needs_list.map((i) => <Needs_row key={`${i.kind}-${i.id}`} item={i} show_org={show_org_tags} org={data.orgs.find((o) => o.id === i.org_id)} />)}</ul>
					)}
				</section>

				<Realms_panel orgs={view.orgs} realms={realms_panel} total={realms_total} />
			</div>

			<section className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-labelledby="live-h">
				<div className="flex items-center gap-2.5 border-b border-[var(--g-line)] px-4 py-3">
					<h2 id="live-h" className="text-[15px] font-semibold">Running now</h2>
					<span className="inline-flex"><Count_badge value={view.live_runs.length} tone="muted" /></span>
				</div>
				{view.live_runs.length === 0 ? (
					<p className="px-4 py-6 text-[13px] text-[var(--g-ink-3)]">Nothing is running right now.</p>
				) : (
					<ul>
						{view.live_runs.map((r) => (
							<li key={r.id} className="border-b border-[var(--g-line-2)] last:border-b-0">
								<Link to={item_href(r)} className="grid grid-cols-[14px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5 hover:bg-[var(--g-soft)]">
									<span aria-hidden className="h-2 w-2 rounded-full bg-[var(--g-run)] shadow-[0_0_0_4px_var(--g-run-soft)]" />
									<span className="min-w-0 truncate text-[13.5px] font-semibold">{r.title}<span className="ml-2 text-[12px] font-normal text-[var(--g-ink-3)]">{r.team}</span></span>
									<Where item={r} show_org={show_org_tags} org={data.orgs.find((o) => o.id === r.org_id)} />
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

function article(word: string): string {
	return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={on}
			onClick={onClick}
			className={`rounded-full px-2.5 py-0.5 text-[12px] ${on ? 'bg-[var(--g-soft)] font-semibold text-[var(--g-ink)]' : 'text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}
		>
			{children}
		</button>
	);
}

export function Component() {
	const overview = use_overview();
	const data = overview.data;

	return (
		<Graphite_shell
			data={data}
			title="Overview"
			actions={
				<>
					<button
						type="button"
						onClick={() => void overview.reload()}
						className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"
						aria-label="Refresh"
						title="Refresh"
					>
						<RefreshCw className="h-3.5 w-3.5" />
					</button>

				</>
			}
		>
			<div className="px-7 py-6">
				{overview.status === 'error' && data ? (
					<p role="status" className="mb-3 text-[12px] text-[var(--g-warn-text)]">Showing the last loaded data — {overview.error}</p>
				) : null}
				{overview.status === 'loading' ? <Skeleton /> : null}
				{overview.status === 'error' && !data ? (
					<div role="alert" className="mx-auto mt-10 max-w-[460px] rounded-xl border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] p-6 text-center">
						<p className="text-[14px] font-semibold">Couldn’t load your overview</p>
						<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{overview.error}</p>
						<button type="button" onClick={() => void overview.reload()} className="mt-4 rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">
							Try again
						</button>
					</div>
				) : null}
				{data ? <Overview_view data={data} /> : null}
			</div>
		</Graphite_shell>
	);
}
