/**
 * Graphite app shell — dark sidebar with the view switcher.
 *
 * Adopted route by route: pages rendered inside this shell use the
 * `.theme-graphite` tokens; pages still on the legacy shell are unaffected.
 * The sidebar tree and the switcher both read the single BFF overview
 * payload, so there are no per-org calls from the browser.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate, useParams } from 'react-router';
import {
	BookOpen,
	Rocket,
	Check,
	ChevronsUpDown,
	CircleDot,
	Bell,
	Inbox,
	LogOut,
	Search,
	Settings,
	Shield,
	Store,
	UsersRound,
	UserRound,
	KeyRound,
	MoreHorizontal,
	X,
	ChevronRight,
	type LucideIcon,
	Bot,
	Building2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { use_bff_read } from '@/lib/use_bff_read';
import type { Getting_started_data } from '@/lib/getting_started';
import { Cliq_mark } from '@/components/cliq_mark';
import { ImpersonationRibbon } from '@/components/impersonation_ribbon';
import type { Overview_data, Overview_org, Overview_realm } from '@/lib/overview';
import { realm_path } from '@/lib/realm_url';
import { sidebar_realms, sort_realms, use_view_scope, view_href, type View_scope } from '@/lib/view_scope';
import { mark_inbox_seen, read_inbox_seen, type Inbox_item } from '@/lib/inbox';
import { Inbox_row } from '@/components/graphite/g_inbox_row';
import '@/styles/graphite.css';

/* ------------------------------------------------------------------ */

function initials(label: string): string {
	const clean = label.replace(/[^a-z0-9 ]/gi, ' ').trim();
	const parts = clean.split(/\s+/).filter(Boolean);
	if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
	return clean.slice(0, 2).toUpperCase() || '··';
}

/** Stable hue per org slug so the same org always gets the same chip colour. */
export function org_hue(slug: string): number {
	let h = 0;
	for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 360;
	return h;
}

export function Org_chip({ org, size = 20 }: { org: Pick<Overview_org, 'slug' | 'display_name'>; size?: number }) {
	return (
		<span
			aria-hidden
			className="grid shrink-0 place-items-center rounded-[5px] font-bold text-white"
			style={{ width: size, height: size, fontSize: size * 0.45, background: `hsl(${org_hue(org.slug)} 62% 52%)` }}
		>
			{initials(org.display_name || org.slug)}
		</span>
	);
}

export function Count_badge({ value, tone = 'warn', label }: { value: number; tone?: 'warn' | 'muted'; label?: string }) {
	if (!value) return null;
	const cls = tone === 'warn'
		? 'bg-[var(--g-warn)] text-[var(--g-on-acc)]'
		: 'border border-[var(--g-line)] bg-[var(--g-soft)] text-[var(--g-ink-3)]';
	return (
		<span className={`ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-5 ${cls}`} aria-label={label}>
			{value > 99 ? '99+' : value}
		</span>
	);
}

export function Realm_dot({ realm }: { realm: Overview_realm }) {
	const { online, total } = realm.daemons;
	const tone = total === 0 ? 'var(--g-line)' : online === 0 ? 'var(--g-bad)' : online < total ? 'var(--g-warn)' : 'var(--g-ok)';
	const title = total === 0 ? 'No daemons' : `${online} of ${total} daemons online`;
	return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} title={title} aria-label={title} role="img" />;
}

/* ------------------------------------------------------------------ */
/* Switcher                                                           */
/* ------------------------------------------------------------------ */

/** Max realms listed per org while browsing/searching the switcher. */
export const SWITCHER_PER_ORG = 8;

type Switcher_entry =
	| { kind: 'all' }
	| { kind: 'org'; org: Overview_org }
	| { kind: 'realm'; org: Overview_org; realm: Overview_realm };

interface Switcher_props {
	data: Overview_data | null;
	scope: View_scope;
	on_close: () => void;
}

/**
 * The one control that sets the view. Picking a view (all / an org)
 * re-scopes the whole app; picking a realm opens that realm.
 * Keyboard: ↑↓ move · Enter open · ⌘/Ctrl+Enter on a realm views its org.
 */
export function Org_realm_switcher({ data, scope, on_close }: Switcher_props) {
	const navigate = useNavigate();
	const [query, set_query] = useState('');
	const [active, set_active] = useState(0);
	const ref = useRef<HTMLDivElement>(null);
	const input_ref = useRef<HTMLInputElement>(null);

	useEffect(() => {
		input_ref.current?.focus();
		const on_click = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) on_close();
		};
		document.addEventListener('mousedown', on_click);
		return () => document.removeEventListener('mousedown', on_click);
	}, [on_close]);

	const orgs = data?.orgs ?? [];
	// Same org-aware layout whether you belong to one org or many.
	const multi_org = orgs.length > 0;
	const q = query.trim().toLowerCase();

	// "All my work" is always offered first, so there is always a way back to everything.
	const view_entries: Switcher_entry[] = useMemo(() => {
		const list: Switcher_entry[] = [{ kind: 'all' }, ...(multi_org ? orgs.map((org) => ({ kind: 'org' as const, org })) : [])];
		if (!q) return list;
		return list.filter((e) => e.kind === 'org' && ((e.org.display_name || '').toLowerCase().includes(q) || e.org.slug.toLowerCase().includes(q)));
	}, [orgs, multi_org, q]);

	const groups = useMemo(() => orgs.map((org) => {
		const matches = sort_realms(org.realms.filter((r) => !q || r.slug.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)));
		return { org, matches, shown: matches.slice(0, SWITCHER_PER_ORG) };
	}).filter((g) => g.matches.length > 0 || (!q && g.org.status === 'error')), [orgs, q]);

	const entries: Switcher_entry[] = useMemo(() => [
		...view_entries,
		...groups.flatMap((g) => g.shown.map((realm) => ({ kind: 'realm' as const, org: g.org, realm }))),
	], [view_entries, groups]);

	useEffect(() => set_active(0), [q]);

	function open(entry: Switcher_entry, view_org = false) {
		on_close();
		if (entry.kind === 'all') navigate('/home');
		else if (entry.kind === 'org' || view_org) navigate(`/home?org=${encodeURIComponent(entry.org.slug)}`);
		else navigate(`${realm_path(entry.realm.org_slug, entry.realm.slug)}/inbox`);
	}

	function on_key(e: React.KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); on_close(); return; }
		if (e.key === 'ArrowDown') { e.preventDefault(); set_active((i) => Math.min(entries.length - 1, i + 1)); return; }
		if (e.key === 'ArrowUp') { e.preventDefault(); set_active((i) => Math.max(0, i - 1)); return; }
		if (e.key === 'Enter' && entries[active]) { e.preventDefault(); open(entries[active], e.metaKey || e.ctrlKey); }
	}

	const is_current = (e: Switcher_entry) =>
		(e.kind === 'all' && (scope.kind === 'all' || (!multi_org && scope.kind === 'org')))
		|| (e.kind === 'org' && scope.kind === 'org' && scope.org.id === e.org.id)
		|| (e.kind === 'realm' && scope.kind === 'realm' && scope.realm.id === e.realm.id);

	let idx = -1;
	const row_cls = (i: number, current: boolean) =>
		`mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${i === active ? 'bg-[var(--g-hover)]' : 'hover:bg-[var(--g-soft)]'} ${current ? 'shadow-[inset_2px_0_0_var(--g-acc)]' : ''}`;

	return (
		<div
			ref={ref}
			role="dialog"
			aria-label="Switch view"
			onKeyDown={on_key}
			className="absolute left-0 top-[calc(100%+6px)] z-50 w-[380px] overflow-hidden rounded-xl border border-[#2c2f35] bg-[#17191c] shadow-[0_24px_60px_rgba(0,0,0,.6)]"
		>
			<div className="border-b border-[var(--g-line)] p-2.5">
				<label className="flex h-9 items-center gap-2 rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[13px]">
					<Search aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
					<span className="sr-only">Find an org or realm</span>
					<input
						ref={input_ref}
						value={query}
						onChange={(e) => set_query(e.target.value)}
						placeholder={multi_org ? 'Find an org or realm…' : 'Find a realm…'}
						className="w-full bg-transparent text-[var(--g-ink)] outline-none placeholder:text-[var(--g-ink-3)]"
						role="combobox"
						aria-expanded
						aria-controls="g-switcher-list"
					/>
				</label>
			</div>

			<div id="g-switcher-list" role="listbox" className="max-h-[440px] overflow-y-auto py-1.5">
				{view_entries.length ? (
					<div data-testid="switcher-views">
						{multi_org ? <div className="px-4 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">Views</div> : null}
						{view_entries.map((e) => {
							idx += 1;
							const i = idx;
							const current = is_current(e);
							return (
								<button key={e.kind === 'all' ? 'all' : e.org.id} type="button" role="option" aria-selected={i === active} aria-current={current ? 'true' : undefined} onMouseEnter={() => set_active(i)} onClick={() => open(e)} className={row_cls(i, current)}>
									{e.kind === 'all'
										? <span className="grid h-5 w-5 place-items-center rounded-[5px] border border-[var(--g-line)]"><CircleDot className="h-3 w-3 text-[var(--g-acc)]" aria-hidden /></span>
										: <Org_chip org={e.org} />}
									<b className="font-semibold">{e.kind === 'all' ? 'All my work' : e.org.display_name || e.org.slug}</b>
									<span className="truncate text-[11.5px] text-[var(--g-ink-3)]">
										{e.kind === 'all'
											? `${multi_org ? `${orgs.length} orgs · ` : 'Overview · '}${plural(data?.totals.realms ?? 0, 'realm')}`
											: e.org.status === 'error' ? 'couldn’t load' : `${e.org.role} · ${plural(e.org.realms.length, 'realm')}`}
									</span>
									<Count_badge value={e.kind === 'all' ? data?.totals.needs_you ?? 0 : e.org.counts.needs_you} label="waiting on you" />
									{current ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--g-acc)]" /> : null}
								</button>
							);
						})}
					</div>
				) : null}

				{groups.map(({ org, matches, shown }) => (
					<div key={org.id} className="mt-1 border-t border-[var(--g-line-2)] pt-1 first:mt-0 first:border-t-0" data-testid={`switcher-group-${org.slug}`}>
						{multi_org ? (
							<div className="flex items-center gap-2 px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
								<Org_chip org={org} size={14} />
								{org.display_name || org.slug}
								<span className="ml-auto font-medium normal-case tracking-normal">
									{q ? `${matches.length} of ${org.realms.length} match` : plural(org.realms.length, 'realm')}
								</span>
							</div>
						) : null}
						{org.status === 'error' ? <p className="px-4 py-1.5 text-[12px] text-[var(--g-bad)]">{org.error}</p> : null}
						{shown.map((r) => {
							idx += 1;
							const i = idx;
							const e: Switcher_entry = { kind: 'realm', org, realm: r };
							const current = is_current(e);
							return (
								<button key={r.id} type="button" role="option" aria-selected={i === active} aria-current={current ? 'true' : undefined} onMouseEnter={() => set_active(i)} onClick={(ev) => open(e, ev.metaKey || ev.ctrlKey)} className={row_cls(i, current)}>
									<Realm_dot realm={r} />
									<b className="font-semibold">{highlight(r.slug, q)}</b>
									<span className="truncate text-[11.5px] text-[var(--g-ink-3)]">
										{r.daemons.total === 0 ? 'no daemons' : `${r.daemons.online}/${r.daemons.total} daemons`}{r.active_runs ? ` · ${r.active_runs} running` : ''}
									</span>
									<Count_badge value={r.needs_you} label={`${r.needs_you} waiting on you`} />
									{current ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--g-acc)]" /> : null}
								</button>
							);
						})}
						{matches.length > shown.length ? (
							<p className="px-4 py-1 text-[11.5px] text-[var(--g-ink-3)]">+{matches.length - shown.length} more — keep typing, or see all realms</p>
						) : null}
					</div>
				))}

				{entries.length === 0 ? (
					<p className="px-4 py-6 text-center text-[12.5px] text-[var(--g-ink-3)]">Nothing matches “{query}”.</p>
				) : null}
			</div>

			<div className="flex items-center gap-3 border-t border-[var(--g-line)] px-4 py-2.5 text-[11.5px] text-[var(--g-ink-3)]">
				<span><Kbd>↑↓</Kbd> move</span>
				<span><Kbd>↵</Kbd> open</span>
				{multi_org ? <span><Kbd>⌘↵</Kbd> view its org</span> : null}
				<button type="button" onClick={() => { on_close(); navigate('/realms'); }} className="ml-auto font-medium text-[var(--g-acc)] hover:underline">
					All realms
				</button>
			</div>
		</div>
	);
}

function Kbd({ children }: { children: ReactNode }) {
	return <kbd className="g-mono rounded border border-[var(--g-line)] px-1 text-[10.5px]">{children}</kbd>;
}

function plural(n: number, one: string): string {
	return `${n} ${one}${n === 1 ? '' : 's'}`;
}

function highlight(text: string, q: string): ReactNode {
	if (!q) return text;
	const i = text.toLowerCase().indexOf(q);
	if (i < 0) return text;
	return <>{text.slice(0, i)}<mark className="bg-transparent text-[var(--g-acc)]">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

/** What the switcher button says: always where you are. */
function Scope_label({ scope }: { scope: View_scope }) {
	if (scope.kind === 'all') {
		return (
			<>
				<span className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] bg-[var(--g-soft)]"><CircleDot className="h-4 w-4 text-[var(--g-acc)]" aria-hidden /></span>
				<span className="min-w-0 flex-1">
					<span className="block text-[10px] uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Viewing</span>
					<b className="block truncate text-[13px] font-semibold">All my work</b>
				</span>
			</>
		);
	}
	const org = scope.org;
	return (
		<>
			{org ? <Org_chip org={org} size={28} /> : null}
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[10px] uppercase tracking-[0.08em] text-[var(--g-ink-3)]">
					{scope.kind === 'realm' ? 'Viewing realm' : `Viewing org${org?.role ? ` · ${org.role}` : ''}`}
				</span>
				<b className="block truncate text-[13px] font-semibold">
					{scope.kind === 'realm'
						? `${org?.display_name || scope.realm.org_slug} › ${scope.realm.slug}`
						: org?.display_name || org?.slug}
				</b>
			</span>
		</>
	);
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                            */
/* ------------------------------------------------------------------ */

const SECTION_CLS = 'px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]';

interface Nav_item {
	to: string;
	label: string;
	icon: LucideIcon;
	end?: boolean;
	badge?: number;
}

function Side_link({ item }: { item: Nav_item }) {
	const Icon = item.icon;
	return (
		<NavLink
			to={item.to}
			end={item.end}
			className={({ isActive }) =>
				`flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium transition ${isActive
					? 'bg-[var(--g-hover)] text-white shadow-[inset_2px_0_0_var(--g-acc)]'
					: 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)]'}`}
		>
			{({ isActive }) => (
				<>
					<Icon aria-hidden className={`h-4 w-4 shrink-0 ${isActive ? 'text-[var(--g-acc)]' : 'opacity-70'}`} strokeWidth={1.8} />
					<span className="truncate">{item.label}</span>
					{item.badge ? <Count_badge value={item.badge} /> : null}
				</>
			)}
		</NavLink>
	);
}

/** In a view, only show notifications that belong to it (account-wide ones always show). */
function in_view_item(i: Inbox_item, scope: View_scope): boolean {
	if (scope.kind === 'all' || !i.org_id) return true;
	if (scope.kind === 'org') return i.org_id === scope.org.id;
	return i.org_id === scope.realm.org_id && (!i.realm_id || i.realm_id === scope.realm.id);
}

function Bell_menu({ data, scope, multi_org }: { data: Overview_data | null; scope: View_scope; multi_org: boolean }) {
	const [open, set_open] = useState(false);
	const [seen_at_open, set_seen_at_open] = useState(0);
	const ref = useRef<HTMLDivElement | null>(null);
	const summary = data?.inbox;
	const count = summary?.new_count ?? 0;
	const orgs = new Map((data?.orgs ?? []).map((o) => [o.id, o]));
	const latest = (summary?.latest ?? []).filter((i) => in_view_item(i, scope));

	useEffect(() => {
		if (!open) return;
		const on_down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) set_open(false); };
		const on_key = (e: KeyboardEvent) => { if (e.key === 'Escape') set_open(false); };
		document.addEventListener('mousedown', on_down);
		document.addEventListener('keydown', on_key);
		return () => { document.removeEventListener('mousedown', on_down); document.removeEventListener('keydown', on_key); };
	}, [open]);

	function toggle() {
		if (!open) {
			// Keep the dots for this look, then reset the count.
			set_seen_at_open(read_inbox_seen());
			if (count > 0) mark_inbox_seen();
		}
		set_open((v) => !v);
	}

	const label = count ? `Notifications (${summary?.capped ? `${count}+` : count} new)` : 'Notifications';
	return (
		<div className="relative" ref={ref}>
			<button type="button" onClick={toggle} aria-label={label} title={label} aria-expanded={open} data-testid="bell"
				className={`relative grid h-8 w-8 place-items-center rounded-lg border text-[var(--g-ink-2)] hover:text-[var(--g-ink)] ${open ? 'border-[var(--g-acc-line)] bg-[var(--g-soft)]' : 'border-[var(--g-line)]'}`}>
				<Bell className="h-3.5 w-3.5" aria-hidden />
				{count ? (
					<span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full border-2 border-[var(--g-bg)] bg-[var(--g-acc)] px-1 text-center text-[10px] font-bold leading-[14px] text-[var(--g-on-acc)]" data-testid="bell-count">
						{summary?.capped ? `${count}+` : count}
					</span>
				) : null}
			</button>
			{open ? (
				<div role="dialog" aria-label="Latest notifications" className="absolute right-0 top-10 z-50 w-[440px] overflow-hidden rounded-xl border border-[#33363c] bg-[#16171a] shadow-[0_24px_70px_rgba(0,0,0,.65)]">
					<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-3.5 py-3">
						<b className="text-[14px] font-semibold">Notifications</b>
						{count ? <span className="text-[12px] text-[var(--g-ink-3)]">{count}{summary?.capped ? '+' : ''} new</span> : null}
					</div>
					{latest.length ? latest.map((i) => (
						<Inbox_row key={i.id} item={i} compact is_new={i.at > seen_at_open} show_realm_org={multi_org && scope.kind === 'all'}
							org_chip={i.org_id && orgs.get(i.org_id) ? <Org_chip org={orgs.get(i.org_id)!} size={13} /> : null}
							on_open={() => set_open(false)} />
					)) : (
						<p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">{summary?.status === 'error' ? 'Couldn’t load notifications.' : 'Nothing yet.'}</p>
					)}
					<div className="flex justify-between border-t border-[var(--g-line)] px-3.5 py-2.5 text-[12.5px]">
						<Link to={view_href('/inbox?tab=all', scope, multi_org)} onClick={() => set_open(false)} className="font-semibold text-[var(--g-acc)] hover:underline">Open inbox →</Link>
						<Link to={view_href('/notifications', scope, multi_org)} onClick={() => set_open(false)} className="text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">Rules &amp; channels</Link>
					</div>
				</div>
			) : null}
		</div>
	);
}

interface Shell_props {
	children: ReactNode;
	data: Overview_data | null;
	/** Page name — the last breadcrumb segment (the view path is added by the shell). */
	title: ReactNode;
	actions?: ReactNode;
	current_realm_id?: string | null;
}

/** Where "up" goes from the current view: realm → its org (multi-org) → all. */
export function step_up_href(scope: View_scope, multi_org: boolean): string | null {
	if (scope.kind === 'realm') return multi_org && scope.org ? `/home?org=${encodeURIComponent(scope.org.slug)}` : '/home';
	if (scope.kind === 'org' && multi_org) return '/home';
	return null;
}

/** Breadcrumb that always starts at "All my work"; every level is a link. */
function Crumbs({ scope, multi_org, fallback, title }: { scope: View_scope; multi_org: boolean; fallback: { org: string; slug: string } | null; title: ReactNode }) {
	const items: Array<{ to: string; node: ReactNode }> = [{ to: '/home', node: <><CircleDot aria-hidden className="h-3 w-3" />All my work</> }];
	const org = scope.kind === 'all' ? null : scope.org;
	const realm_slug = scope.kind === 'realm' ? scope.realm.slug : fallback?.slug ?? null;
	const realm_org = scope.kind === 'realm' ? scope.realm.org_slug : fallback?.org ?? null;
	if (multi_org && org) items.push({ to: `/home?org=${encodeURIComponent(org.slug)}`, node: <><Org_chip org={org} size={14} />{org.display_name || org.slug}</> });
	else if (multi_org && !org && fallback) items.push({ to: `/home?org=${encodeURIComponent(fallback.org)}`, node: fallback.org });
	if (realm_slug && realm_org) items.push({ to: `${realm_path(realm_org, realm_slug)}/inbox`, node: realm_slug });
	return (
		<nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px]">
			{items.map((c, i) => (
				<span key={i} className="flex min-w-0 items-center gap-1.5">
					<Link to={c.to} className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">{c.node}</Link>
					<ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-[#4a4d55]" />
				</span>
			))}
			<span className="min-w-0 truncate font-semibold" aria-current="page">{title}</span>
		</nav>
	);
}

export function Graphite_shell({ children, data, title, actions, current_realm_id = null }: Shell_props) {
	const { user, logout } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();
	const params = useParams();
	const [switcher_open, set_switcher_open] = useState(false);
	const [menu_open, set_menu_open] = useState(false);
	const scope = use_view_scope(data, current_realm_id);
	const progress = use_bff_read<Getting_started_data>('/v1/getting_started/get', {}, { refresh_ms: 120_000 });

	// ⌘J / Ctrl+J opens the switcher from anywhere.
	useEffect(() => {
		const on_key = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
				e.preventDefault();
				set_switcher_open((v) => !v);
			}
		};
		document.addEventListener('keydown', on_key);
		return () => document.removeEventListener('keydown', on_key);
	}, []);

	const orgs = data?.orgs ?? [];
	// Same org-aware layout whether you belong to one org or many.
	const multi_org = orgs.length > 0;
	const is_site_admin = user?.role === 'admin';
	const { shown, total } = sidebar_realms(data, scope);
	const org_by_id = new Map(orgs.map((o) => [o.id, o]));
	// Badges only where realms of several orgs sit together.
	const show_badges = multi_org && scope.kind === 'all';
	const view_org = scope.kind === 'all' ? null : scope.org;
	const up = step_up_href(scope, multi_org);
	const route_realm = params.org && params.slug ? { org: params.org, slug: params.slug } : null;
	const gs = progress.data;
	const gs_done = Boolean(gs && gs.done_count >= gs.total);

	const scope_waiting = view_org ? view_org.counts.needs_you : data?.totals.needs_you;
	// Work: what you do every day. Build: teams. Manage: setup owned by org / realm admins (one place, every level).
	const nav: Nav_item[] = [
		{ to: view_href('/home', scope, multi_org), label: 'Overview', icon: CircleDot, end: true },
		{ to: view_href('/inbox', scope, multi_org), label: 'Inbox', icon: Inbox, badge: scope_waiting },
	];
	// Build: teams you and your orgs author, and the public catalog.
	const build: Nav_item[] = [
		{ to: view_href('/teams', scope, multi_org), label: 'Teams', icon: UsersRound },
		{ to: '/browse', label: 'Marketplace', icon: Store },
	];
	const manage: Nav_item[] = [
		{ to: view_href('/notifications', scope, multi_org), label: 'Notifications', icon: Bell },
		{ to: view_href('/agents', scope, multi_org), label: 'Agents', icon: Bot },
		// Members, roles, scopes, A2A of the org in view (or a chooser).
		{ to: view_org ? `/orgs/${view_org.id}` : '/org', label: 'Organization', icon: Building2 },
	];

	function enter_admin() {
		// Remember where to come back to ("Back to my work").
		try { sessionStorage.setItem(ADMIN_RETURN_KEY, location.pathname + location.search); } catch { /* storage unavailable */ }
		navigate('/admin');
	}

	return (
		<div className="theme-graphite flex h-screen flex-col overflow-hidden">
			<ImpersonationRibbon />
			<div className="grid min-h-0 flex-1 grid-cols-[252px_minmax(0,1fr)]">
				<aside className="flex min-h-0 flex-col border-r border-[var(--g-line)] bg-[var(--g-side)] px-3 py-4" aria-label="Primary">
					<Link to="/home" className="mb-4 flex items-center gap-2.5 px-2 text-[14.5px] font-semibold tracking-tight">
						<Cliq_mark class_name="h-6 w-6" title="CliqHub" />
						CliqHub
					</Link>

					<div className="relative mb-3">
						<button
							type="button"
							onClick={() => set_switcher_open((v) => !v)}
							aria-haspopup="dialog"
							aria-expanded={switcher_open}
							aria-label={`Switch view (current: ${scope_text(scope)})`}
							className={`flex w-full items-center gap-2.5 rounded-[10px] border bg-[var(--g-panel)] py-2 pl-2.5 text-left ${up ? 'pr-9' : 'pr-2.5'} ${switcher_open ? 'border-[var(--g-acc-line)]' : 'border-[var(--g-line)] hover:border-[#34373e]'}`}
							data-testid="view-switcher"
						>
							<Scope_label scope={scope} />
							<ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 text-[var(--g-ink-3)]" />
						</button>
						{up ? (
							<Link
								to={up}
								aria-label={scope.kind === 'realm' && multi_org ? 'Leave realm (view its org)' : 'Back to all my work'}
								title={scope.kind === 'realm' && multi_org ? 'Up to the org' : 'Back to all my work'}
								className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border border-[var(--g-line)] bg-[var(--g-soft)] text-[var(--g-ink-2)] hover:text-[var(--g-ink)]"
								data-testid="view-step-up"
							>
								<X className="h-3.5 w-3.5" aria-hidden />
							</Link>
						) : null}
						{switcher_open ? (
							<Org_realm_switcher data={data} scope={scope} on_close={() => set_switcher_open(false)} />
						) : null}
					</div>

					<nav aria-label="Main">
						<div className={SECTION_CLS}>Work</div>
						<div className="space-y-0.5">{nav.map((item) => <Side_link key={item.label} item={item} />)}</div>
						<div className={`${SECTION_CLS} mt-4`}>Build</div>
						<div className="space-y-0.5">{build.map((item) => <Side_link key={item.label} item={item} />)}</div>
						<div className={`${SECTION_CLS} mt-4`}>Manage</div>
						<div className="space-y-0.5">{manage.map((item) => <Side_link key={item.label} item={item} />)}</div>
					</nav>

					<div className="mt-5 min-h-0 flex-1 overflow-y-auto" data-testid="sidebar-realms">
						<div className="flex items-center px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">
							Realms
							{total ? <span className="ml-auto font-medium normal-case tracking-normal">{total}</span> : null}
						</div>
						{shown.map((r) => {
							const org = org_by_id.get(r.org_id);
							const current = scope.kind === 'realm' && scope.realm.id === r.id;
							return (
								<Link
									key={r.id}
									to={`${realm_path(r.org_slug, r.slug)}/inbox`}
									aria-current={current ? 'page' : undefined}
									className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-[12.5px] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)] ${current ? 'bg-[var(--g-hover)] text-[var(--g-ink)] shadow-[inset_2px_0_0_var(--g-acc)]' : 'text-[var(--g-ink-3)]'}`}
								>
									<Realm_dot realm={r} />
									{show_badges && org ? <Org_chip org={org} size={16} /> : null}
									<span className="truncate">{r.slug}</span>
									<Count_badge value={r.needs_you} label={`${r.needs_you} waiting on you`} />
								</Link>
							);
						})}
						{total === 0 && data ? (
							<p className="px-2.5 py-1 text-[12px] text-[var(--g-ink-3)]">No realms yet.</p>
						) : null}
						{total > shown.length ? (
							<Link to="/realms" className="block px-2.5 py-1.5 text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">
								All {total} realms →
							</Link>
						) : null}
						{orgs.filter((o) => o.status === 'error' && (scope.kind === 'all' || o.id === view_org?.id)).map((o) => (
							<p key={o.id} className="px-2.5 py-1 text-[11.5px] text-[var(--g-bad)]">Couldn’t load {o.display_name || o.slug}</p>
						))}
					</div>

					<div className="mt-2 space-y-0.5 border-t border-[var(--g-line)] pt-2.5" data-testid="sidebar-footer">
						{!gs_done ? (
							<NavLink
								to="/getting-started"
								className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium ${isActive ? 'bg-[var(--g-hover)] text-white shadow-[inset_2px_0_0_var(--g-acc)]' : 'text-[var(--g-ink-2)] hover:bg-[var(--g-soft)]'}`}
							>
								<Rocket aria-hidden className="h-4 w-4 opacity-70" strokeWidth={1.8} />
								Getting started
								{gs ? <span className="ml-auto text-[11px] font-semibold text-[var(--g-acc)]" aria-label={`${gs.done_count} of ${gs.total} done`}>{gs.done_count} / {gs.total}</span> : null}
							</NavLink>
						) : null}
						<a
							href="https://docs.getcliq.io"
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-medium text-[var(--g-ink-2)] hover:bg-[var(--g-soft)]"
						>
							<BookOpen aria-hidden className="h-4 w-4 opacity-70" strokeWidth={1.8} />
							Docs
							<span aria-hidden className="text-[11px] opacity-60">↗</span>
						</a>
						{is_site_admin ? (
							<button
								type="button"
								onClick={enter_admin}
								className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] font-medium text-[var(--g-ink-2)] hover:bg-[var(--g-soft)]"
							>
								<Shield aria-hidden className="h-4 w-4 opacity-70" strokeWidth={1.8} />
								Admin
								<span className="ml-auto rounded border border-[rgba(255,159,90,.45)] px-1.5 text-[10px] font-bold tracking-[0.06em] text-[#ff9f5a]">SITE</span>
							</button>
						) : null}

						<div className="relative pt-1.5">
							{menu_open ? (
								<Account_menu
									on_close={() => set_menu_open(false)}
									gs_done={gs_done}
									on_sign_out={() => void logout()}
								/>
							) : null}
							<button
								type="button"
								onClick={() => set_menu_open((v) => !v)}
								aria-haspopup="menu"
								aria-expanded={menu_open}
								className="flex w-full items-center gap-2.5 rounded-lg border border-[var(--g-line-2)] px-2 py-2 text-left hover:bg-[var(--g-soft)]"
								data-testid="account-button"
							>
								<span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--g-line)] bg-[var(--g-soft)] text-[11px] font-bold">
									{initials(user?.display_name || user?.username || '')}
								</span>
								<span className="min-w-0 flex-1">
									<b className="block truncate text-[12.5px] font-semibold">{user?.display_name || user?.username}</b>
									<span className="block truncate text-[11px] text-[var(--g-ink-3)]">@{user?.username}{is_site_admin ? ' · site admin' : ''}</span>
								</span>
								<MoreHorizontal aria-hidden className="h-4 w-4 text-[var(--g-ink-3)]" />
							</button>
						</div>
					</div>
				</aside>

				<div className="flex min-h-0 flex-col">
					<header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--g-line)] px-7">
						<Crumbs scope={scope} multi_org={multi_org} fallback={scope.kind === 'realm' ? null : route_realm} title={title} />
						<div className="ml-auto flex items-center gap-2">
							<Bell_menu data={data} scope={scope} multi_org={multi_org} />
							{actions}
						</div>
					</header>
					<main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
				</div>
			</div>
		</div>
	);
}

export const ADMIN_RETURN_KEY = 'cliq.admin_return';

/** Account menu: personal settings live here, not in the main nav. */
function Account_menu({ on_close, gs_done, on_sign_out }: { on_close: () => void; gs_done: boolean; on_sign_out: () => void }) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const on_click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) on_close(); };
		const on_key = (e: KeyboardEvent) => { if (e.key === 'Escape') on_close(); };
		document.addEventListener('mousedown', on_click);
		document.addEventListener('keydown', on_key);
		return () => { document.removeEventListener('mousedown', on_click); document.removeEventListener('keydown', on_key); };
	}, [on_close]);
	const item = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-[var(--g-ink-2)] hover:bg-[var(--g-hover)] hover:text-[var(--g-ink)]';
	return (
		<div ref={ref} role="menu" aria-label="Account" className="absolute bottom-[calc(100%+4px)] left-0 z-50 w-full rounded-xl border border-[#2c2f35] bg-[#17191c] p-1.5 shadow-[0_18px_50px_rgba(0,0,0,.6)]">
			<Link role="menuitem" to="/settings?tab=profile" onClick={on_close} className={item}><UserRound aria-hidden className="h-4 w-4 opacity-70" />Profile &amp; security</Link>
			<Link role="menuitem" to="/settings?tab=tokens" onClick={on_close} className={item}><KeyRound aria-hidden className="h-4 w-4 opacity-70" />API tokens</Link>
			<Link role="menuitem" to="/settings" onClick={on_close} className={item}><Settings aria-hidden className="h-4 w-4 opacity-70" />All settings</Link>
			{gs_done ? <Link role="menuitem" to="/getting-started" onClick={on_close} className={item}><Rocket aria-hidden className="h-4 w-4 opacity-70" />Getting started</Link> : null}
			<div className="my-1 border-t border-[var(--g-line)]" />
			<button role="menuitem" type="button" onClick={() => { on_close(); on_sign_out(); }} className={item}><LogOut aria-hidden className="h-4 w-4 opacity-70" />Sign out</button>
		</div>
	);
}

function scope_text(scope: View_scope): string {
	if (scope.kind === 'all') return 'All my work';
	if (scope.kind === 'org') return scope.org.display_name || scope.org.slug;
	return `${scope.org?.display_name || scope.realm.org_slug} › ${scope.realm.slug}`;
}
