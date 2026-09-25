import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import {
    ChevronDown, ChevronRight, X, Rocket, CircleHelp,
    Map as MapIcon, Play, ArrowRight,
    Activity,
} from 'lucide-react';
import { useAuth} from '@/lib/auth_context';
import { useOrg, useOrgFetch } from '@/lib/org_context';
import { useHubActivity } from '@/lib/hub_activity_context';
import { GettingStartedPanel } from '@/components/getting_started_panel';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { use_poll } from '@/lib/use_poll';
import { realm_qualified_label } from '@/lib/realm_url';

const GS_DISMISSED_KEY = 'cliqhub:getting-started-dismissed';

interface RealmStatus {
    id: string;
    slug: string;
    org_slug: string | null;
    name: string;
    last_activity_at: number;
    daemons: { online: number; stale: number; offline: number; total: number };
    runs: { active: number; awaiting_input: number };
    pending_reviews: number;
    recent_notifications: number;
}

interface Totals {
    realms_active: number;
    daemons_online: number;
    runs_active: number;
}

interface DashboardData {
    realms: RealmStatus[];
    totals: Totals;
}

/** Derive the status light state for a realm. */
function realm_signal(r: RealmStatus): 'active' | 'attention' | 'offline' {
    if (r.daemons.online === 0) return 'offline';
    if (r.pending_reviews > 0 || r.runs.awaiting_input > 0) return 'attention';
    return 'active';
}

function format_relative(ts: number): string {
    const age_s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (age_s < 60) return 'just now';
    if (age_s < 3600) return `${Math.floor(age_s / 60)}m ago`;
    if (age_s < 86400) return `${Math.floor(age_s / 3600)}h ago`;
    return `${Math.floor(age_s / 86400)}d ago`;
}

function greeting_for(hour: number): string {
    if (hour < 5) return 'Burning the midnight oil';
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}

/** Pick a cheeky subtitle based on fleet state. */
function fleet_tagline(totals: Totals, realm_count: number): string {
    if (realm_count === 0) {
        return "Empty console, empty inbox — the calm before your first daemon.";
    }
    if (totals.runs_active > 0) {
        if (totals.runs_active === 1) {
            return "One run in flight. Try not to hover — the agents can feel it.";
        }
        return `${totals.runs_active} runs in flight. The agents have this. Probably.`;
    }
    if (totals.daemons_online === 0) {
        return "All daemons are ghosting you. Poke one back to life?";
    }
    if (totals.daemons_online === 1) {
        return "One daemon standing. Loyal little thing.";
    }
    return `${totals.daemons_online} daemons idle and looking suspiciously well-rested.`;
}

function Status_light({ signal }: { signal: 'active' | 'attention' | 'offline' }) {
    if (signal === 'active') {
        return (
            <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
        );
    }
    if (signal === 'attention') {
        return (
            <span className="relative flex h-3 w-3">
                <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-400" />
            </span>
        );
    }
    return (
        <span className="relative flex h-3 w-3">
            <span className="relative inline-flex h-3 w-3 rounded-full bg-slate-300" />
        </span>
    );
}

/** Attention badge — shows combined count of reviews + awaiting input. */
function Attention_badge({ realm }: { realm: RealmStatus }) {
    const count = realm.pending_reviews + realm.runs.awaiting_input;
    if (count === 0) return null;
    return (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
            {count} needs you
        </span>
    );
}

/** A realm is considered "active" if it has online daemons, live runs, or pending reviews. */
function is_realm_active(r: RealmStatus): boolean {
    return r.daemons.online > 0 || r.runs.active > 0 || r.pending_reviews > 0;
}

/** Pill-style toggle switch. */
function Toggle({ enabled, on_toggle, label }: { enabled: boolean; on_toggle: () => void; label: string }) {
    return (
        <button
            type="button"
            onClick={on_toggle}
            className="flex items-center gap-2"
        >
            <span
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
                    enabled ? 'bg-indigo-600' : 'bg-slate-200'
                }`}
            >
                <span
                    className={`inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
                        enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                    }`}
                />
            </span>
            <span className="text-xs font-medium text-slate-500">{label}</span>
        </button>
    );
}

/** Multi-realm table — Open goes into the realm (tabs: Runs / Teams / Security / Daemons). */
function Realm_table({ realms }: { realms: RealmStatus[] }) {
    const navigate = useNavigate();
    const [show_inactive, set_show_inactive] = useState(false);

    const active_realms = useMemo(() => realms.filter(is_realm_active), [realms]);
    const inactive_count = realms.length - active_realms.length;
    const visible_realms = show_inactive ? realms : active_realms;

    return (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {inactive_count > 0 ? (
                <div className="flex items-center justify-end border-b border-slate-100 px-4 py-2.5">
                    <Toggle
                        enabled={show_inactive}
                        on_toggle={() => set_show_inactive(!show_inactive)}
                        label="Show inactive"
                    />
                </div>
            ) : null}

            <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                    <col className="w-[4%]" />
                    <col className="w-[28%]" />
                    <col className="w-[16%]" />
                    <col className="w-[12%]" />
                    <col className="w-[18%]" />
                    <col className="w-[14%]" />
                    <col className="w-[8%]" />
                </colgroup>
                <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                        <th className="py-3 pl-4 pr-2" />
                        <th className="py-3 pr-4 font-semibold text-slate-500">Realm</th>
                        <th className="py-3 pr-4 font-semibold text-slate-500">Daemons</th>
                        <th className="py-3 pr-4 font-semibold text-slate-500">Runs</th>
                        <th className="py-3 pr-4 font-semibold text-slate-500">Status</th>
                        <th className="py-3 pr-4 font-semibold text-slate-500">Last activity</th>
                        <th className="py-3 pr-4 text-right font-semibold text-slate-500">Open</th>
                    </tr>
                </thead>
                <tbody>
                    {visible_realms.length === 0 ? (
                        <tr>
                            <td colSpan={7} className="px-6 py-10 text-center">
                                <p className="text-sm font-medium text-slate-600">No active realms</p>
                                {inactive_count > 0 ? (
                                    <button
                                        type="button"
                                        onClick={() => set_show_inactive(true)}
                                        className="mt-2 text-xs font-medium text-indigo-700 hover:underline"
                                    >
                                        Show {inactive_count} inactive
                                    </button>
                                ) : null}
                            </td>
                        </tr>
                    ) : (
                        realms.map((r) => {
                            const is_active = is_realm_active(r);
                            if (!show_inactive && !is_active) return null;
                            const signal = realm_signal(r);
                            const open_href = `/o/${r.org_slug ?? 'unknown'}/realms/${r.slug}`;
                            return (
                                <tr
                                    key={r.id}
                                    className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50/80 first:border-t-0"
                                    onClick={() => navigate(open_href)}
                                >
                                    <td className="py-3.5 pl-4 pr-2">
                                        <Status_light signal={signal} />
                                    </td>
                                    <td className="truncate py-3.5 pr-4">
                                        <span className="font-semibold text-slate-900">
                                            {r.name || r.slug}
                                        </span>
                                        <span className="ml-2 font-mono text-xs text-slate-400">{realm_qualified_label(r.org_slug, r.slug)}</span>
                                    </td>
                                    <td className="py-3.5 pr-4 font-mono text-xs text-slate-600">
                                        {r.daemons.online > 0 ? (
                                            <span className="text-emerald-700">{r.daemons.online} online</span>
                                        ) : (
                                            <span className="text-slate-400">0 online</span>
                                        )}
                                        {r.daemons.total > r.daemons.online ? (
                                            <span className="text-slate-400"> / {r.daemons.total}</span>
                                        ) : null}
                                    </td>
                                    <td className="py-3.5 pr-4 font-mono text-xs text-slate-600">
                                        {r.runs.active > 0 ? (
                                            <span className="text-sky-700">{r.runs.active} live</span>
                                        ) : (
                                            <span className="text-slate-400">—</span>
                                        )}
                                    </td>
                                    <td className="py-3.5 pr-4">
                                        <Attention_badge realm={r} />
                                        {signal === 'active' && r.recent_notifications > 0 ? (
                                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                                {r.recent_notifications} notif
                                            </span>
                                        ) : null}
                                    </td>
                                    <td className="py-3.5 pr-4 text-xs text-slate-400">
                                        {format_relative(r.last_activity_at)}
                                    </td>
                                    <td className="py-3.5 pr-4 text-right">
                                        <Link
                                            to={open_href}
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-xs font-semibold text-indigo-600 hover:underline"
                                        >
                                            Open →
                                        </Link>
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}

/** Single-realm summary — Open enters the realm tabbed view. */
function Single_realm_view({ realm }: { realm: RealmStatus }) {
    const signal = realm_signal(realm);
    const open_href = `/o/${realm.org_slug ?? 'unknown'}/realms/${realm.slug}`;
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
                <Status_light signal={signal} />
                <div className="min-w-0 flex-1">
                    <Link
                        to={open_href}
                        className="text-lg font-bold text-slate-900 hover:text-indigo-700"
                    >
                        {realm.name || realm.slug}
                    </Link>
                    <span className="ml-2 font-mono text-sm text-slate-400">{realm_qualified_label(realm.org_slug, realm.slug)}</span>
                </div>
                <Attention_badge realm={realm} />
                <Link
                    to={open_href}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                    Open →
                </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-100 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Daemons</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">
                        {realm.daemons.online}
                        <span className="text-sm font-normal text-slate-400"> / {realm.daemons.total}</span>
                    </p>
                </div>
                <div className="rounded-lg border border-slate-100 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Active runs</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{realm.runs.active}</p>
                </div>
                <div className="rounded-lg border border-slate-100 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Reviews</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900">{realm.pending_reviews}</p>
                </div>
            </div>

            <p className="mt-3 text-right text-xs text-slate-400">
                Last activity {format_relative(realm.last_activity_at)} · use realm tabs for Runs, Teams, Security, Daemons
            </p>
        </div>
    );
}

/** Empty state when no realms or daemons are enrolled. */
function Empty_state({ on_help }: { on_help: () => void }) {
    return (
        <div className="w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
            <p className="text-sm font-semibold text-slate-700">No active fleet</p>
            <p className="mt-1 text-xs text-slate-500">
                Enroll the CLI and start a daemon to see real-time fleet status here.
            </p>
            <button
                type="button"
                onClick={on_help}
                className="mt-4 inline-flex rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
            >
                Connect your first machine
            </button>
        </div>
    );
}

/** Collapsible, dismissible getting-started card shown to new users on the dashboard. */
function Getting_started_card({ force_open, on_close_force }: {
    force_open: boolean;
    on_close_force: () => void;
}) {
    const { is_getting_started, loading } = useHubActivity();
    const [dismissed, set_dismissed] = useState(() => {
        return localStorage.getItem(GS_DISMISSED_KEY) === '1';
    });
    const [collapsed, set_collapsed] = useState(false);

    useEffect(() => {
        if (!force_open) return;
        /** Expand when force-opened, but do NOT clear the dismissed flag —
         *  force_open already overrides visibility. Clearing dismissed
         *  would cause the card to stick around after "Close" is clicked. */
        set_collapsed(false);
    }, [force_open]);

    if (!force_open && (loading || !is_getting_started || dismissed)) return null;

    function dismiss() {
        localStorage.setItem(GS_DISMISSED_KEY, '1');
        set_dismissed(true);
        on_close_force();
    }

    const Chevron = collapsed ? ChevronRight : ChevronDown;

    return (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 shadow-sm dark:border-indigo-500/30 dark:bg-indigo-500/10">
            <div className="flex items-center justify-between px-5 py-4">
                <button
                    type="button"
                    onClick={() => set_collapsed(!collapsed)}
                    className="flex items-center gap-2.5"
                >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
                        <Rocket className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    </span>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Getting started</h2>
                    <Chevron className="h-4 w-4 text-slate-400" aria-hidden />
                </button>
                <div className="flex items-center gap-1">
                    {force_open ? (
                        <button
                            type="button"
                            onClick={on_close_force}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            title="Close"
                        >
                            Close
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={dismiss}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        title="Don't show this again"
                    >
                        <X className="h-3.5 w-3.5" aria-hidden />
                        Don&apos;t show again
                    </button>
                </div>
            </div>
            {!collapsed && (
                <div className="px-5 pb-5">
                    <GettingStartedPanel hide_header />
                </div>
            )}
        </div>
    );
}

interface Recent_run {
    run_id: string;
    run_name: string | null;
    team_label: string | null;
    state: string;
    started_at: number | null;
    completed_at: number | null;
    last_updated_at: number | null;
    realm_id: string | null;
}

/** Color/style hints for run rows and dots keyed on state. */
function run_row_style(state: string): { dot: string; border: string; label: string } {
    if (state === 'awaiting_input') {
        return {
            dot: 'bg-amber-500',
            border: 'border-l-amber-400',
            label: 'text-amber-700 dark:text-amber-400',
        };
    }
    if (state === 'failed' || state === 'crashed') {
        return {
            dot: 'bg-rose-500',
            border: 'border-l-rose-400',
            label: 'text-rose-700 dark:text-rose-400',
        };
    }
    if (state === 'running') {
        return {
            dot: 'bg-sky-500 animate-pulse',
            border: 'border-l-sky-400',
            label: 'text-sky-700 dark:text-sky-400',
        };
    }
    if (state === 'succeeded' || state === 'completed') {
        return {
            dot: 'bg-emerald-500',
            border: 'border-l-transparent',
            label: 'text-slate-500 dark:text-slate-400',
        };
    }
    return {
        dot: 'bg-slate-300',
        border: 'border-l-transparent',
        label: 'text-slate-500 dark:text-slate-400',
    };
}

/**
 * Compact section shell used by every dashboard block. Fills its column,
 * so `lg:col-span-2` cards stretch alongside `lg:col-span-1` ones without
 * ugly height jumps.
 */
function Block_shell({
    icon: Icon,
    title,
    header_meta,
    view_all_href,
    view_all_label = 'View all',
    tint,
    children,
    loading,
    empty,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    header_meta?: React.ReactNode;
    view_all_href: string;
    view_all_label?: string;
    tint: 'indigo' | 'sky' | 'amber' | 'emerald' | 'rose';
    children: React.ReactNode;
    loading?: boolean;
    empty?: string;
}) {
    const tint_classes: Record<typeof tint, string> = {
        indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
        sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
        amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
        emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
        rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
    };
    return (
        <section className="flex h-full min-h-[18rem] flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div className="flex min-w-0 items-center gap-2">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tint_classes[tint]}`}>
                        <Icon className="h-3.5 w-3.5" />
                    </span>
                    <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {title}
                    </h2>
                    {header_meta ? (
                        <span className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            {header_meta}
                        </span>
                    ) : null}
                </div>
                <Link
                    to={view_all_href}
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
                >
                    {view_all_label}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden">
                {loading ? (
                    <p className="px-4 py-6 text-xs text-slate-400 dark:text-slate-500">Loading…</p>
                ) : empty ? (
                    <p className="px-4 py-6 text-xs text-slate-400 dark:text-slate-500">{empty}</p>
                ) : (
                    children
                )}
            </div>
        </section>
    );
}

/** Runs block — simple time-ordered table, most recent first. */
function Runs_block({
    runs,
    loading,
    default_realm_slug,
    default_org_slug,
    realm_slug_by_id,
    realm_org_slug_by_id,
}: {
    runs: Recent_run[];
    loading: boolean;
    default_realm_slug: string | null;
    default_org_slug: string | null;
    realm_slug_by_id: Map<string, string>;
    realm_org_slug_by_id: Map<string, string>;
}) {
    const runs_base = (default_realm_slug && default_org_slug)
        ? `/o/${default_org_slug}/realms/${default_realm_slug}/runs`
        : '/realms';
    const link_for_state = (state_param: string) => {
        if (!default_realm_slug) return runs_base;
        return `${runs_base}?state=${encodeURIComponent(state_param)}`;
    };

    /** Simple time-based sort — most recent first. */
    const sorted = useMemo(() => {
        const copy = [...runs];
        copy.sort((a, b) => {
            const ta = a.last_updated_at ?? a.started_at ?? 0;
            const tb = b.last_updated_at ?? b.started_at ?? 0;
            return tb - ta;
        });
        return copy.slice(0, 8);
    }, [runs]);

    const visible = sorted.slice(0, 8);

    return (
        <Block_shell
            icon={Play}
            title="Runs"
            view_all_href={runs_base}
            tint="sky"
            loading={loading && runs.length === 0}
            empty={!loading && runs.length === 0 ? 'No runs yet.' : undefined}
        >
            <table className="w-full text-left text-sm">
                <thead>
                    <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                        <th className="px-4 py-2">Time</th>
                        <th className="px-4 py-2">Name</th>
                        <th className="px-4 py-2">Realm</th>
                        <th className="px-4 py-2">Status</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {visible.map((r) => {
                        const slug = r.realm_id ? realm_slug_by_id.get(r.realm_id) : null;
                        const org = r.realm_id ? realm_org_slug_by_id.get(r.realm_id) : null;
                        const href = (slug && org)
                            ? `/o/${org}/realms/${slug}/runs/${encodeURIComponent(r.run_id)}`
                            : '/realms';
                        const ts = r.last_updated_at ?? r.started_at ?? Date.now();
                        const style = run_row_style(r.state);
                        return (
                            <tr key={r.run_id}>
                                <td className="px-4 py-2.5">
                                    <Link to={href} className="whitespace-nowrap text-xs text-slate-500 hover:text-indigo-600">
                                        {format_relative(ts)}
                                    </Link>
                                </td>
                                <td className="max-w-[14rem] px-4 py-2.5">
                                    <Link to={href} className="block truncate font-semibold text-slate-900 hover:text-indigo-600 dark:text-slate-100">
                                        {r.run_name || r.run_id.slice(0, 12)}
                                    </Link>
                                    <p className="truncate text-[11px] text-slate-400">{r.team_label ?? '—'}</p>
                                </td>
                                <td className="px-4 py-2.5">
                                    <Link to={href} className="text-xs text-slate-600 hover:text-indigo-600 dark:text-slate-300">
                                        {slug ?? '—'}
                                    </Link>
                                </td>
                                <td className="px-4 py-2.5">
                                    <Link to={href} className={`text-xs font-semibold ${style.label}`}>
                                        <span className="flex items-center gap-1.5">
                                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                                            {r.state}
                                        </span>
                                    </Link>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </Block_shell>
    );
}

/** Compact realms list — same shape as before, minus the count line. */
function Realms_block({ realms }: { realms: RealmStatus[] }) {
    const visible = realms.slice(0, 8);
    return (
        <Block_shell
            icon={MapIcon}
            title="Realms"
            view_all_href="/realms"
            tint="indigo"
            empty={realms.length === 0 ? 'No realms yet.' : undefined}
        >
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.map((r) => {
                    const signal = realm_signal(r);
                    return (
                        <li key={r.id}>
                            <Link
                                to={`/o/${r.org_slug ?? 'unknown'}/realms/${r.slug}`}
                                className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                            >
                                <Status_light signal={signal} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                        {r.name || r.slug}
                                        <span className="ml-1.5 font-mono text-[11px] font-normal text-slate-400">{realm_qualified_label(r.org_slug, r.slug)}</span>
                                    </p>
                                    <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                                        {r.daemons.online}/{r.daemons.total} online · {r.runs.active} live
                                    </p>
                                </div>
                                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                    {format_relative(r.last_activity_at)}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </Block_shell>
    );
}

// ─── Telemetry (fleet-wide OTEL rollup) ────────────────────────────

interface Telemetry_totals {
    runs: number;
    agent_invocations: number;
    failures: number;
    duration_ms: number;
    cost_usd: number;
    tokens_in: number;
    tokens_out: number;
}
interface Telemetry_day_row {
    date: string;
    runs: number;
    invocations: number;
    duration_ms: number;
    cost_usd: number;
    failures: number;
}
interface Telemetry_team_row {
    team_label: string;
    runs: number;
    invocations: number;
    duration_ms: number;
    cost_usd: number;
    /**
     * Failed agent invocations for this team in the window. Populated
     * by the backend rollup and consumed by the dashboard's
     * "team X had N failures — investigate" insight.
     */
    failures: number;
}
interface Telemetry_kind_row {
    kind: string;
    invocations: number;
    duration_ms: number;
    cost_usd: number;
    failures: number;
}
interface Telemetry_summary {
    window: { from_ms: number; to_ms: number; days: number };
    totals: Telemetry_totals;
    by_day: Telemetry_day_row[];
    /** Fixed-length 24 hour buckets from the backend. Not rendered on
     *  the dashboard today — kept in the type only to document the
     *  API contract for consumers that may want it later. */
    by_hour?: unknown;
    by_team: Telemetry_team_row[];
    by_agent_kind: Telemetry_kind_row[];
}

function _fmt_int(n: number): string {
    return Math.round(n).toLocaleString();
}

/**
 * Format a duration for the KPI strip.
 * < 1s → "Xms", < 1m → "Xs", < 1h → "Xm Ys", else "Xh Ym".
 * Keeps the tile readable across LLM latency (~2s) and long HUG waits (~hours).
 */
function _fmt_duration(ms: number): string {
    if (!ms || ms < 0) return '0';
    if (ms < 1_000) return `${Math.round(ms)}ms`;
    const s = Math.round(ms / 1_000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem_s = s % 60;
    if (m < 60) return rem_s > 0 ? `${m}m ${rem_s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const rem_m = m % 60;
    return rem_m > 0 ? `${h}h ${rem_m}m` : `${h}h`;
}

function _fmt_cost(usd: number): string {
    if (!Number.isFinite(usd) || usd <= 0) return '$0';
    if (usd < 0.01) return '<$0.01';
    return `$${usd.toFixed(2)}`;
}

/**
 * Inline area sparkline for the daily runs series. Pure SVG so the
 * block stays self-contained and doesn't drag a chart lib into the
 * dashboard bundle. The line + soft area fill makes the trend
 * readable at a glance without any axis labels.
 */
function Sparkline({ points, height = 56 }: { points: number[]; height?: number }) {
    if (points.length === 0) {
        return (
            <div className="flex items-center justify-center text-[11px] text-slate-400 dark:text-slate-500" style={{ height }}>
                no data
            </div>
        );
    }
    const w = 300;
    const h = height;
    const max = Math.max(1, ...points);
    const step = points.length > 1 ? w / (points.length - 1) : 0;
    // Zero-crossing for the area path — use full max so a flat series
    // still gets a visible ribbon, otherwise everything collapses to
    // the baseline.
    const line_d = points.map((v, i) => {
        const x = i * step;
        const y = h - (v / max) * (h - 6) - 3;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    const area_d = `${line_d} L ${(w).toFixed(1)} ${h} L 0 ${h} Z`;
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
            <path d={area_d} className="fill-indigo-500/10 dark:fill-indigo-400/15" />
            <path d={line_d} fill="none" strokeWidth="1.75" className="stroke-indigo-500 dark:stroke-indigo-400" />
        </svg>
    );
}

/**
 * Actionable insight row for the Telemetry band. Each insight tells
 * the user WHAT to do, not just a number to look at. Severity drives
 * the dot colour, `href` is the primary CTA. Kept intentionally
 * compact — a list of these must scan faster than a chart.
 */
type Insight_severity = 'high' | 'medium' | 'info';

interface Insight {
    id: string;
    severity: Insight_severity;
    headline: string;
    detail?: string;
    href: string;
    cta_label: string;
}

function Insight_row({ insight }: { insight: Insight }) {
    // Rose = "needs a human now" (failures, stuck runs, pending reviews).
    // Amber = "watch this" (regressions, cost warnings).
    // Sky   = "informational" (e.g. new features / trends worth clicking into).
    const dot: Record<Insight_severity, string> = {
        high: 'bg-rose-500',
        medium: 'bg-amber-500',
        info: 'bg-sky-500',
    };
    return (
        <li className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5 first:border-t-0 dark:border-slate-800">
            <span
                className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dot[insight.severity]}`}
                aria-hidden
            />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {insight.headline}
                </p>
                {insight.detail ? (
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {insight.detail}
                    </p>
                ) : null}
            </div>
            <Link
                to={insight.href}
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-slate-800"
            >
                {insight.cta_label}
                <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
        </li>
    );
}

/** Small labelled KPI card. Read-only — no click behaviour, no state. */
function Kpi_card({
    label, value, hint,
}: {
    label: string;
    value: string;
    hint?: string;
}) {
    return (
        <div className="flex flex-1 flex-col rounded-lg bg-slate-50/60 px-3 py-2 ring-1 ring-slate-200/70 dark:bg-slate-800/50 dark:ring-slate-700">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {label}
            </span>
            <span className="mt-0.5 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {value}
            </span>
            {hint ? (
                <span className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</span>
            ) : null}
        </div>
    );
}

const TELEMETRY_WINDOWS = [
    { days: 1, label: '24h' },
    { days: 7, label: '7d' },
    { days: 30, label: '30d' },
] as const;

/**
 * Fleet-wide dashboard band — reoriented around INSIGHTS + CTAs, not
 * dumps of raw metrics. The previous version showed agent-activity
 * bars, top-team tables and per-kind tables that were "interesting"
 * but never told the user what to do about anything. Now:
 *
 *   Compact headline strip:  Runs · Success · Cost
 *   ↓
 *   "Needs your attention" list — each row is a specific problem
 *   (stuck runs, team hotspot, kind regression, pending reviews)
 *   with a link to fix / investigate it. Empty state is explicit
 *   ("All quiet") so the block doesn't just vanish.
 *   ↓
 *   Small trend sparkline for context, unlabelled — the user has
 *   already read the numbers above.
 *
 * All insights are derived from data we already fetch:
 *   • `runs` (last 50, from Bands) → stuck / recent-fail insights
 *   • `realms` (from parent) → pending HUG reviews
 *   • `telemetry.by_team` → team failure hotspots
 *   • `telemetry.by_agent_kind` → agent-kind success regressions
 *
 * We deliberately do NOT surface tokens or per-invocation-avg or
 * per-kind cost here — those are dashboard debris, not actions.
 * Anyone who wants that depth clicks into a run or team page.
 */
function Telemetry_block({
    runs,
    realms,
    default_realm_slug,
    default_org_slug,
}: {
    runs: Recent_run[];
    realms: RealmStatus[];
    default_realm_slug: string | null;
    default_org_slug: string | null;
}) {
    const auth_fetch = useOrgFetch();
    const [data, set_data] = useState<Telemetry_summary | null>(null);
    const [loading, set_loading] = useState(true);
    const [window_days, set_window_days] = useState<number>(7);

    const load = useCallback(async () => {
        try {
            const res = await auth_fetch('/v1/runs/get_telemetry', {
                method: 'POST',
                body: JSON.stringify({ kind: 'summary', window_days }),
            });
            const json = await res.json();
            if (json.ok) set_data(json as Telemetry_summary);
        } catch {
            /* keep stale */
        } finally {
            set_loading(false);
        }
    }, [auth_fetch, window_days]);

    useEffect(() => { void load(); }, [load]);
    // Slow poll — telemetry aggregates don't move minute-to-minute.
    use_poll(() => void load(), 60_000, true);

    const totals = data?.totals;
    const show_cost = !!totals && totals.cost_usd > 0;
    const day_points = useMemo(
        () => (data?.by_day ?? []).map((d) => d.runs),
        [data],
    );
    // Success-rate over invocations, not runs — a single failed
    // agent call inside an otherwise successful run shouldn't make
    // the whole run count as a "failure". Undefined when there were
    // no invocations at all (fresh fleet).
    const success_rate = totals && totals.agent_invocations > 0
        ? 1 - (totals.failures / totals.agent_invocations)
        : null;

    const runs_href = (default_realm_slug && default_org_slug)
        ? `/o/${default_org_slug}/realms/${default_realm_slug}/runs`
        : '/realms';
    const insights = useMemo(
        () => _compute_insights({ runs, realms, telemetry: data, runs_href, default_realm_slug, default_org_slug }),
        [runs, realms, data, runs_href, default_realm_slug, default_org_slug],
    );

    const window_selector = (
        <span className="ml-2 inline-flex overflow-hidden rounded-md ring-1 ring-slate-200 dark:ring-slate-700">
            {TELEMETRY_WINDOWS.map((w) => (
                <button
                    key={w.days}
                    type="button"
                    onClick={() => set_window_days(w.days)}
                    className={`px-2 py-0.5 text-[10px] font-semibold transition ${
                        w.days === window_days
                            ? 'bg-indigo-600 text-white'
                            : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                >
                    {w.label}
                </button>
            ))}
        </span>
    );

    return (
        <Block_shell
            icon={Activity}
            title="Telemetry"
            header_meta={window_selector}
            view_all_href="/realms"
            view_all_label={`window: ${window_days}d`}
            tint="indigo"
            loading={loading && !data}
            empty={
                !loading && totals && totals.runs === 0
                    ? 'No runs in this window.'
                    : undefined
            }
        >
            {totals ? (
                <div className="flex flex-col">
                    {/* Compact headline strip — three numbers that fit a
                        single glance: activity volume, health, spend.
                        Everything else migrated into the insights list
                        below because "what should I do?" beats "here
                        are 6 metrics I have to interpret". */}
                    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                        <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                                {_fmt_int(totals.runs)}
                            </span>
                            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                runs
                            </span>
                        </div>
                        <div className="flex items-baseline gap-2">
                            <span className={`text-2xl font-bold tabular-nums ${
                                success_rate !== null && success_rate < 0.9
                                    ? 'text-rose-700 dark:text-rose-300'
                                    : 'text-slate-900 dark:text-slate-100'
                            }`}>
                                {success_rate === null ? '—' : `${(success_rate * 100).toFixed(0)}%`}
                            </span>
                            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                success
                            </span>
                        </div>
                        {show_cost ? (
                            <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                                    {_fmt_cost(totals.cost_usd)}
                                </span>
                                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    spent
                                </span>
                            </div>
                        ) : null}
                    </div>

                    {/* Needs your attention — the whole point of this
                        block. Each row is a specific problem with a
                        link to fix it. If there's nothing, we say so
                        explicitly instead of hiding the section (a
                        blank slate feels broken, "all quiet" reassures). */}
                    <div className="border-b border-slate-100 dark:border-slate-800">
                        <div className="flex items-baseline justify-between px-4 pt-3 pb-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Needs your attention
                            </span>
                            {insights.length > 0 ? (
                                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                    {insights.length} item{insights.length === 1 ? '' : 's'}
                                </span>
                            ) : null}
                        </div>
                        {insights.length === 0 ? (
                            <p className="px-4 pb-3 text-[13px] text-slate-500 dark:text-slate-400">
                                All quiet — nothing needs your attention right now.
                            </p>
                        ) : (
                            <ul className="pb-1">
                                {insights.map((ins) => (
                                    <Insight_row key={ins.id} insight={ins} />
                                ))}
                            </ul>
                        )}
                    </div>

                    {/* Small unlabelled trend — context, not a chart to
                        interpret. The headline number above already
                        told the whole story; this just shows shape. */}
                    <div className="px-4 py-3">
                        <div className="mb-1 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            <span>Trend · runs per day</span>
                            <span className="text-[10px] font-normal normal-case text-slate-400">
                                {data?.by_day.length ?? 0} day{(data?.by_day.length ?? 0) === 1 ? '' : 's'}
                            </span>
                        </div>
                        <Sparkline points={day_points} height={40} />
                    </div>
                </div>
            ) : null}
        </Block_shell>
    );
}

// ─── Insight computation ─────────────────────────────────────────────
//
// All insights derive from data we already fetched. No extra roundtrips.
// Rules are ordered by severity so the most urgent items land at the
// top of the list.

const STUCK_AWAITING_MIN_MS = 60 * 60 * 1000;       // 1h
const STUCK_RUNNING_MIN_MS = 30 * 60 * 1000;        // 30m
const RECENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const KIND_MIN_INVOCATIONS_FOR_ALERT = 10;
const KIND_SUCCESS_ALERT_THRESHOLD = 0.80;
const TEAM_MIN_FAILURES_FOR_HOTSPOT = 3;

function _compute_insights(args: {
    runs: Recent_run[];
    realms: RealmStatus[];
    telemetry: Telemetry_summary | null;
    runs_href: string;
    default_realm_slug: string | null;
    default_org_slug: string | null;
}): Insight[] {
    const { runs, realms, telemetry, runs_href, default_realm_slug, default_org_slug } = args;
    const now = Date.now();
    const out: Insight[] = [];

    // 1. HUG reviews pending someone's decision. Rose because a human
    //    is literally waiting to unblock a workflow.
    const total_pending_reviews = realms.reduce((s, r) => s + (r.pending_reviews ?? 0), 0);
    if (total_pending_reviews > 0) {
        out.push({
            id: 'pending-reviews',
            severity: 'high',
            headline: `${total_pending_reviews} human review${total_pending_reviews === 1 ? '' : 's'} pending your decision`,
            detail: 'Runs are paused at a gate agent, waiting on approve/reject.',
            href: (default_realm_slug && default_org_slug)
                ? `/o/${default_org_slug}/realms/${default_realm_slug}/reviews`
                : '/realms',
            cta_label: 'Review',
        });
    }

    // 2. Runs awaiting input for > 1h. Same urgency shape as reviews —
    //    something's stopped and needs a person.
    const stuck_awaiting = runs.filter((r) => {
        if (r.state !== 'awaiting_input') return false;
        const ts = r.last_updated_at ?? r.started_at ?? 0;
        return ts > 0 && (now - ts) > STUCK_AWAITING_MIN_MS;
    });
    if (stuck_awaiting.length > 0) {
        out.push({
            id: 'stuck-awaiting',
            severity: 'high',
            headline: `${stuck_awaiting.length} run${stuck_awaiting.length === 1 ? '' : 's'} awaiting input for over 1h`,
            detail: 'Provide the missing input or cancel the run to unblock the queue.',
            href: `${runs_href}?state=awaiting_input`,
            cta_label: 'Open',
        });
    }

    // 3. Failed / crashed runs in the last 24h. Rose — every failure
    //    is a "why did this break" investigation.
    const recent_failures = runs.filter((r) => {
        if (r.state !== 'failed' && r.state !== 'crashed') return false;
        const ts = r.last_updated_at ?? r.completed_at ?? r.started_at ?? 0;
        return ts > 0 && (now - ts) < RECENT_FAILURE_WINDOW_MS;
    });
    if (recent_failures.length > 0) {
        out.push({
            id: 'recent-failures',
            severity: 'high',
            headline: `${recent_failures.length} run${recent_failures.length === 1 ? '' : 's'} failed in the last 24h`,
            detail: 'Open the failed list to see the error and start a new run once fixed.',
            href: `${runs_href}?state=${encodeURIComponent('failed,crashed')}`,
            cta_label: 'Open failures',
        });
    }

    // 4. Team failure hotspots — pinpoints the specific team so the user
    //    knows where to start. Amber because it's a pattern, not a
    //    single break.
    const team_hotspot = (telemetry?.by_team ?? [])
        .filter((t) => (t.failures ?? 0) >= TEAM_MIN_FAILURES_FOR_HOTSPOT)
        .sort((a, b) => (b.failures ?? 0) - (a.failures ?? 0))[0];
    if (team_hotspot) {
        out.push({
            id: 'team-hotspot',
            severity: 'medium',
            headline: `${team_hotspot.team_label} had ${_fmt_int(team_hotspot.failures)} failed agent call${team_hotspot.failures === 1 ? '' : 's'}`,
            detail: `Across ${_fmt_int(team_hotspot.runs)} run${team_hotspot.runs === 1 ? '' : 's'} in this window — check the team for a flaky step.`,
            href: `${runs_href}?query=${encodeURIComponent(team_hotspot.team_label)}`,
            cta_label: 'Investigate',
        });
    }

    // 5. Agent-kind regression — one specific kind failing at a rate
    //    that suggests infra rot (API keys, quota, tool config).
    //    Amber; needs the operator, not the user.
    const kind_regression = (telemetry?.by_agent_kind ?? [])
        .filter((k) => k.invocations >= KIND_MIN_INVOCATIONS_FOR_ALERT)
        .map((k) => ({
            kind: k.kind,
            success: k.invocations > 0 ? 1 - k.failures / k.invocations : 1,
            failures: k.failures,
            invocations: k.invocations,
        }))
        .filter((k) => k.success < KIND_SUCCESS_ALERT_THRESHOLD)
        .sort((a, b) => a.success - b.success)[0];
    if (kind_regression) {
        out.push({
            id: 'kind-regression',
            severity: 'medium',
            headline: `${kind_regression.kind} agent success dropped to ${(kind_regression.success * 100).toFixed(0)}%`,
            detail: `${_fmt_int(kind_regression.failures)} of ${_fmt_int(kind_regression.invocations)} calls failed — check credentials, quota or tool config for this agent.`,
            href: `${runs_href}?state=${encodeURIComponent('failed,crashed')}`,
            cta_label: 'Open failures',
        });
    }

    // 6. Long-running runs. Amber — could be legitimate long work or a
    //    hang; the operator has to look. Cap at first 5 items overall
    //    so the list stays scannable.
    if (out.length < 5) {
        const stuck_running = runs.filter((r) => {
            if (r.state !== 'running') return false;
            const ts = r.started_at ?? r.last_updated_at ?? 0;
            return ts > 0 && (now - ts) > STUCK_RUNNING_MIN_MS;
        });
        if (stuck_running.length > 0) {
            out.push({
                id: 'stuck-running',
                severity: 'medium',
                headline: `${stuck_running.length} run${stuck_running.length === 1 ? '' : 's'} still running after 30m`,
                detail: 'Could be legitimate long work — worth checking for a hang.',
                href: `${runs_href}?state=running`,
                cta_label: 'Open',
            });
        }
    }

    return out.slice(0, 5);
}

/** Two-band asymmetric dashboard body. */
function Bands({
    realms,
    default_realm_slug,
    default_org_slug,
}: {
    realms: RealmStatus[];
    default_realm_slug: string | null;
    default_org_slug: string | null;
}) {
    const auth_fetch = useOrgFetch();
    const { current_id } = useOrg();
    const [runs, set_runs] = useState<Recent_run[]>([]);
    const [runs_loading, set_runs_loading] = useState(true);

    const realm_slug_by_id = useMemo(() => {
        const m = new Map<string, string>();
        for (const r of realms) m.set(r.id, r.slug);
        return m;
    }, [realms]);

    /** Map realm id → org_slug for URL generation. */
    const realm_org_slug_by_id = useMemo(() => {
        const m = new Map<string, string>();
        for (const r of realms) {
            if (r.org_slug) m.set(r.id, r.org_slug);
        }
        return m;
    }, [realms]);

    const load_runs = useCallback(async () => {
        // Body org_id is invent SoT — skip until org context is ready.
        if (!current_id) {
            set_runs_loading(false);
            return;
        }
        try {
            const res = await auth_fetch('/v1/runs/get', {
                method: 'POST',
                body: JSON.stringify({
                    org_id: current_id,
                    limit: 50,
                    sort_by: 'last_updated_at',
                    sort_dir: 'desc',
                }),
            });
            const data = await res.json();
            if (data.ok) set_runs((data.runs ?? []) as Recent_run[]);
        } catch {
            /* keep stale */
        } finally {
            set_runs_loading(false);
        }
    }, [auth_fetch, current_id]);

    useEffect(() => { void load_runs(); }, [load_runs]);
    use_poll(() => void load_runs(), 20_000, true);

    return (
        <div className="space-y-4">
            {/* Band 1: Realms */}
            <Realms_block realms={realms} />

            {/* Band 2: Telemetry — hero band. Insight-first rewrite:
                a compact KPI line, then "Needs your attention" with
                per-item CTAs. The earlier version drowned the user
                in agent-activity bars, top-teams tables and per-kind
                cost tables that "looked useful" but never told anyone
                what to do. If nothing needs attention, we say so
                explicitly rather than hide the block. */}
            <Telemetry_block
                runs={runs}
                realms={realms}
                default_realm_slug={default_realm_slug}
                default_org_slug={default_org_slug}
            />

            {/* Band 3: Runs — full width, always-visible list with the
                count strip on top. */}
            <Runs_block
                runs={runs}
                loading={runs_loading}
                default_realm_slug={default_realm_slug}
                default_org_slug={default_org_slug}
                realm_slug_by_id={realm_slug_by_id}
                realm_org_slug_by_id={realm_org_slug_by_id}
            />
        </div>
    );
}

function Dashboard_view() {
    const { user } = useAuth();
    const { default_realm_slug, default_org_slug } = useHubActivity();
    const auth_fetch = useOrgFetch();
    const [data, set_data] = useState<DashboardData | null>(null);
    const [loading, set_loading] = useState(true);
    const [help_open, set_help_open] = useState(false);

    const load = useCallback(async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) set_loading(true);
        try {
            const res = await auth_fetch('/v1/dashboard/realms', {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const json = await res.json();
            if (json.ok) {
                set_data({ realms: json.realms, totals: json.totals });
            }
        } catch {
            /* keep stale data */
        } finally {
            if (!opts?.silent) set_loading(false);
        }
    }, [auth_fetch]);

    useEffect(() => {
        void load();
    }, [load]);

    const has_live = (data?.totals.runs_active ?? 0) > 0;
    use_poll(() => void load({ silent: true }), has_live ? 5_000 : 15_000, !loading);

    const totals = data?.totals ?? { realms_active: 0, daemons_online: 0, runs_active: 0 };
    const realms = data?.realms ?? [];
    const display_name = user?.display_name || user?.username || 'there';
    const first_name = display_name.split(' ')[0];
    const hour = new Date().getHours();

    function open_help() {
        set_help_open((prev) => !prev);
    }

    const body = useMemo(() => {
        if (!data && loading) return null;
        if (realms.length === 0) return <Empty_state on_help={open_help} />;
        return (
            <Bands
                realms={realms}
                default_realm_slug={default_realm_slug}
                default_org_slug={default_org_slug}
            />
        );
    }, [data, loading, realms, default_realm_slug]);

    return (
        <div className="w-full space-y-5 py-6">
            <Breadcrumbs items={[{ label: 'Home' }]} />
            <div className="flex items-start justify-between gap-4 rounded-2xl bg-slate-950 px-6 py-6 sm:px-8">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold tracking-tight text-white">
                        {greeting_for(hour)}, {first_name}.
                    </h1>
                    <p className="mt-1 text-sm text-slate-400">
                        {loading && !data
                            ? 'Checking in with your fleet…'
                            : fleet_tagline(totals, realms.length)}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={open_help}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/15"
                    title="Getting started"
                >
                    <CircleHelp className="h-3.5 w-3.5" aria-hidden />
                    Getting started
                </button>
            </div>
            <Getting_started_card
                force_open={help_open}
                on_close_force={() => set_help_open(false)}
            />
            {body}
        </div>
    );
}

export function Component() {
    return <Dashboard_view />;
}
