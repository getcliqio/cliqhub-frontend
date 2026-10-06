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
	ChevronRight,
	type LucideIcon,
	Bot,
	Building2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { avatar_outline } from '@/lib/admin';
import { use_bff_read } from '@/lib/use_bff_read';
import type { Getting_started_data } from '@/lib/getting_started';
import { Cliq_mark } from '@/components/cliq_mark';
import { ImpersonationRibbon } from '@/components/impersonation_ribbon';
import { realm_label, type Overview_data, type Overview_org, type Overview_realm } from '@/lib/overview';
import { realm_path } from '@/lib/realm_url';
import { sidebar_realms, use_view_scope, view_href, write_last_org, type View_scope } from '@/lib/view_scope';
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

/** Org chip: outline avatar keyed on the slug, so an org always gets the same colour. */
export function Org_chip({ org, size = 20 }: { org: Pick<Overview_org, 'slug' | 'display_name'>; size?: number }) {
	return (
		<span
			aria-hidden
			className="grid shrink-0 place-items-center rounded-[5px] font-semibold"
			style={{ width: size, height: size, fontSize: size * 0.45, ...avatar_outline(org.slug, size) }}
		>
			{initials(org.display_name || org.slug)}
		</span>
	);
}

export function Count_badge({ value, tone = 'warn', label }: { value: number; tone?: 'warn' | 'muted'; label?: string }) {
	if (!value) return null;
	const cls = tone === 'warn'
		? 'bg-[var(--g-warn)] text-[var(--g-on-color)]'
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

interface Switcher_props {
	data: Overview_data | null;
	scope: View_scope;
	on_close: () => void;
}

/** Sections that keep their place when you switch org (`/teams` stays `/teams`). */
const ORG_SECTIONS = ['/home', '/inbox', '/teams', '/agents', '/notifications', '/realms'];

/** Where switching to `slug` goes: the same section in the new org, else its overview. */
export function org_switch_href(pathname: string, slug: string): string {
	const section = ORG_SECTIONS.find((p) => pathname === p || pathname.startsWith(`${p}/`));
	return `${section && pathname === section ? section : '/home'}?org=${encodeURIComponent(slug)}`;
}

/**
 * The org switcher: you work in one organization at a time, so it lists
 * organizations only (realms are in the sidebar for the chosen org).
 * Keyboard: ↑↓ move · Enter switch · Esc close.
 */
export function Org_switcher({ data, scope, on_close }: Switcher_props) {
	const navigate = useNavigate();
	const location = useLocation();
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

	const q = query.trim().toLowerCase();
	const orgs = useMemo(() => (data?.orgs ?? []).filter((o) => !q || (o.display_name || '').toLowerCase().includes(q) || o.slug.toLowerCase().includes(q)), [data, q]);
	const current_id = scope.org?.id ?? scope.realm?.org_id ?? null;
	useEffect(() => set_active(0), [q]);

	function open(org: Overview_org) {
		on_close();
		write_last_org(org.slug);
		navigate(org_switch_href(location.pathname, org.slug));
	}

	function on_key(e: React.KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); on_close(); return; }
		if (e.key === 'ArrowDown') { e.preventDefault(); set_active((i) => Math.min(orgs.length - 1, i + 1)); return; }
		if (e.key === 'ArrowUp') { e.preventDefault(); set_active((i) => Math.max(0, i - 1)); return; }
		if (e.key === 'Enter' && orgs[active]) { e.preventDefault(); open(orgs[active]!); }
	}

	return (
		<div
			ref={ref}
			role="dialog"
			aria-label="Switch organization"
			onKeyDown={on_key}
			className="absolute left-0 top-[calc(100%+6px)] z-50 w-[340px] overflow-hidden rounded-xl border border-[#2c2f35] bg-[#17191c] shadow-[0_24px_60px_rgba(0,0,0,.6)]"
		>
			<div className="border-b border-[var(--g-line)] p-2.5">
				<label className="flex h-9 items-center gap-2 rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[13px]">
					<Search aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
					<span className="sr-only">Find an organization</span>
					<input
						ref={input_ref}
						value={query}
						onChange={(e) => set_query(e.target.value)}
						placeholder="Switch organization…"
						className="w-full bg-transparent text-[var(--g-ink)] outline-none placeholder:text-[var(--g-ink-3)]"
						role="combobox"
						aria-expanded
						aria-controls="g-switcher-list"
					/>
				</label>
			</div>
			<div id="g-switcher-list" role="listbox" className="max-h-[400px] overflow-y-auto py-1.5" data-testid="switcher-orgs">
				{orgs.map((org, i) => {
					const current = org.id === current_id;
					return (
						<button key={org.id} type="button" role="option" aria-selected={i === active} aria-current={current ? 'true' : undefined} onMouseEnter={() => set_active(i)} onClick={() => open(org)}
							className={`mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] ${i === active ? 'bg-[var(--g-hover)]' : 'hover:bg-[var(--g-soft)]'}`}
							data-testid={`switch-org-${org.slug}`}>
							<Org_chip org={org} />
							<b className="font-semibold">{highlight(org.display_name || org.slug, q)}</b>
							<span className="truncate text-[11.5px] text-[var(--g-ink-3)]">{org.status === 'error' ? 'couldn’t load' : `${org.role} · ${plural(org.realms.length, 'realm')}`}</span>
							<Count_badge value={org.counts.needs_you} label="waiting on you" />
							{current ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--g-acc)]" /> : null}
						</button>
					);
				})}
				{orgs.length === 0 ? <p className="px-4 py-6 text-center text-[12.5px] text-[var(--g-ink-3)]">{q ? `No organization matches “${query}”.` : 'You’re not in any organization yet.'}</p> : null}
			</div>
			<div className="flex items-center gap-3 border-t border-[var(--g-line)] px-4 py-2.5 text-[11.5px] text-[var(--g-ink-3)]">
				<span><Kbd>↑↓</Kbd> move</span>
				<span><Kbd>↵</Kbd> switch</span>
				<span className="ml-auto">Realms are in the sidebar</span>
			</div>
		</div>
	);
}

/** Org pages with no org chosen yet (several orgs, none remembered): pick one first. */
export function Org_picker({ data }: { data: Overview_data | null }) {
	const navigate = useNavigate();
	const location = useLocation();
	const orgs = data?.orgs ?? [];
	const pick = (org: Overview_org) => { write_last_org(org.slug); navigate(org_switch_href(location.pathname, org.slug)); };
	return (
		<div className="flex max-w-[640px] flex-col gap-4 px-7 py-6" data-testid="org-picker">
			<div>
				<h1 className="text-[22px] font-semibold tracking-tight">Choose an organization</h1>
				<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">You work in one organization at a time. Switch any time from the menu at the top left.</p>
			</div>
			{orgs.map((o) => (
				<button key={o.id} type="button" onClick={() => pick(o)} className="flex items-center gap-3 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] px-4 py-3 text-left hover:border-[var(--g-acc-line)]" data-testid={`pick-org-${o.slug}`}>
					<Org_chip org={o} size={28} />
					<b className="font-semibold">{o.display_name || o.slug}</b>
					<span className="text-[12.5px] text-[var(--g-ink-3)]">{o.role} · {plural(o.realms.length, 'realm')}</span>
					<Count_badge value={o.counts.needs_you} label="waiting on you" />
					<span className="ml-auto text-[var(--g-ink-3)]">→</span>
				</button>
			))}
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

/** What the switcher button says: the organization you are working in. */
function Scope_label({ scope }: { scope: View_scope }) {
	const org = scope.org;
	if (!org) {
		return (
			<>
				<span className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] bg-[var(--g-soft)]"><Building2 className="h-4 w-4 text-[var(--g-ink-3)]" aria-hidden /></span>
				<span className="min-w-0 flex-1">
					<span className="block text-[10px] uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Organization</span>
					<b className="block truncate text-[13px] font-semibold">Choose one</b>
				</span>
			</>
		);
	}
	return (
		<>
			<Org_chip org={org} size={28} />
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[10px] uppercase tracking-[0.08em] text-[var(--g-ink-3)]">{`Organization${org.role ? ` · ${org.role}` : ''}`}</span>
				<b className="block truncate text-[13px] font-semibold">{org.display_name || org.slug}</b>
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

/** Breadcrumb from the organization down; every level is a link. */
function Crumbs({ scope, fallback, title }: { scope: View_scope; fallback: { org: string; slug: string } | null; title: ReactNode }) {
	const items: Array<{ to: string; node: ReactNode }> = [];
	const org = scope.org;
	const realm_slug = scope.kind === 'realm' ? scope.realm.slug : fallback?.slug ?? null;
	const realm_org = scope.kind === 'realm' ? scope.realm.org_slug : fallback?.org ?? null;
	if (org) items.push({ to: `/home?org=${encodeURIComponent(org.slug)}`, node: <><Org_chip org={org} size={14} />{org.display_name || org.slug}</> });
	else if (fallback) items.push({ to: `/home?org=${encodeURIComponent(fallback.org)}`, node: fallback.org });
	if (realm_slug && realm_org) items.push({ to: `${realm_path(realm_org, realm_slug)}/inbox`, node: scope.kind === 'realm' ? realm_label(scope.realm) : realm_slug });
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

/** Pages that belong to one organization (the shell asks for one before showing them). */
const ORG_PAGES = ['/home', '/inbox', '/teams', '/agents', '/notifications', '/realms', '/o/'];

export function Graphite_shell({ children, data, title, actions, current_realm_id = null }: Shell_props) {
	const { user, logout } = useAuth();
	const navigate = useNavigate();
	const location = useLocation();
	const params = useParams();
	const [switcher_open, set_switcher_open] = useState(false);
	const [menu_open, set_menu_open] = useState(false);
	const scope = use_view_scope(data, current_realm_id);
	// Remember the org for the next visit in this browser.
	const scope_org_slug = scope.org?.slug ?? null;
	useEffect(() => { if (scope_org_slug) write_last_org(scope_org_slug); }, [scope_org_slug]);
	const needs_org = Boolean(data && data.orgs.length > 0 && !scope.org
		&& ORG_PAGES.some((p) => (p.endsWith('/') ? location.pathname.startsWith(p) : location.pathname === p || location.pathname.startsWith(`${p}/`))));
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
	const view_org = scope.org;
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
							aria-label={`Switch organization (current: ${scope_text(scope)})`}
							className={`flex w-full items-center gap-2.5 rounded-[10px] border bg-[var(--g-panel)] py-2 pl-2.5 text-left pr-2.5 ${switcher_open ? 'border-[var(--g-acc-line)]' : 'border-[var(--g-line)] hover:border-[#34373e]'}`}
							data-testid="view-switcher"
						>
							<Scope_label scope={scope} />
							<ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 text-[var(--g-ink-3)]" />
						</button>
						{switcher_open ? (
							<Org_switcher data={data} scope={scope} on_close={() => set_switcher_open(false)} />
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
							const current = scope.kind === 'realm' && scope.realm.id === r.id;
							return (
								<Link
									key={r.id}
									to={`${realm_path(r.org_slug, r.slug)}/inbox`}
									aria-current={current ? 'page' : undefined}
									className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-[12.5px] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)] ${current ? 'bg-[var(--g-hover)] text-[var(--g-ink)] shadow-[inset_2px_0_0_var(--g-acc)]' : 'text-[var(--g-ink-3)]'}`}
								>
									<Realm_dot realm={r} />
									<span className="truncate" title={realm_label(r) !== r.slug ? r.slug : undefined}>{realm_label(r)}</span>
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
						{orgs.filter((o) => o.status === 'error' && o.id === view_org?.id).map((o) => (
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
						<Crumbs scope={scope} fallback={scope.kind === 'realm' ? null : route_realm} title={title} />
						<div className="ml-auto flex items-center gap-2">
							<Bell_menu data={data} scope={scope} multi_org={multi_org} />
							{actions}
						</div>
					</header>
					<main className="min-h-0 flex-1 overflow-y-auto">{needs_org ? <Org_picker data={data} /> : children}</main>
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
	if (scope.kind === 'all') return 'no organization chosen';
	if (scope.kind === 'org') return scope.org.display_name || scope.org.slug;
	return `${scope.org?.display_name || scope.realm.org_slug} › ${realm_label(scope.realm)}`;
}
