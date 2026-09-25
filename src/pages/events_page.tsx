/**
 * Unified Events page — three tabs under /events:
 *   HUG (default) — pending review queue
 *   My Runs        — notifications for runs the caller initiated
 *   All Events     — full in-app notification stream
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Bell, BellOff, Zap } from 'lucide-react';
import { PageHeader } from '@/components/ui/page_header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { PAGE_HELP } from '@/lib/page_help';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { useOrgFetch, useOrg } from '@/lib/org_context';
import { mark_notifications_seen } from '@/lib/use_sidebar_badges';
import { Pagination, PAGE_LIMIT } from '@/components/pagination';
import { ReviewsPanel } from '@/pages/reviews_page';
import { hub_payload } from '@/lib/hub_envelope';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventTab = 'hug' | 'my-runs' | 'all';

interface NotificationRow {
    id: string;
    event: string;
    title: string | null;
    message: string | null;
    realm_id: string | null;
    realm_slug: string | null;
    team: string | null;
    run_id: string | null;
    phase: string | null;
    severity: string | null;
    payload?: Record<string, unknown>;
    created_at: number;
}

interface EventAlerts {
    hug?: boolean;
    my_runs?: boolean;
    all?: boolean;
    my_runs_seen_at?: number | null;
    all_seen_at?: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABS: { key: EventTab; label: string }[] = [
    { key: 'hug', label: 'HUGs' },
    { key: 'my-runs', label: 'My Runs' },
    { key: 'all', label: 'All Events' },
];

function resolve_tab(raw: string | null): EventTab {
    if (raw === 'my-runs' || raw === 'all') return raw;
    return 'hug';
}

function format_when(ts: number): string {
    try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

const SEVERITY_COLORS: Record<string, string> = {
    info: 'bg-blue-100 text-blue-700',
    warn: 'bg-amber-100 text-amber-700',
    error: 'bg-red-100 text-red-700',
    critical: 'bg-red-200 text-red-900',
};

function get_event_alerts(prefs: Record<string, unknown>): EventAlerts {
    const ea = (prefs?.event_alerts ?? {}) as EventAlerts;
    return {
        hug: ea.hug ?? true,
        my_runs: ea.my_runs ?? false,
        all: ea.all ?? false,
        my_runs_seen_at: ea.my_runs_seen_at ?? null,
        all_seen_at: ea.all_seen_at ?? null,
    };
}

// ---------------------------------------------------------------------------
// Event table (shared by My Runs + All Events tabs)
// ---------------------------------------------------------------------------

function Event_table({
    initiated_by_me,
}: {
    initiated_by_me?: boolean;
}) {
    const auth_fetch = useOrgFetch();
    const { current_id } = useOrg();
    const [error, set_error] = useState<string | null>(null);
    const [loading, set_loading] = useState(true);
    const [rows, set_rows] = useState<NotificationRow[]>([]);
    const [total, set_total] = useState(0);
    const [offset, set_offset] = useState(0);
    const [q, set_q] = useState('');
    const [q_draft, set_q_draft] = useState('');

    /** Column filters. */
    const [filter_event, set_filter_event] = useState('');
    const [filter_severity, set_filter_severity] = useState('');
    const [filter_team, set_filter_team] = useState('');


    const load = useCallback(async () => {
        // Inbox requires body org_id (NTF-ORG).
        if (!current_id) {
            set_loading(false);
            set_error('No active workspace');
            return;
        }
        set_loading(true);
        try {
            const body: Record<string, unknown> = {
                org_id: current_id,
                limit: PAGE_LIMIT,
                offset,
            };
            if (q.trim()) body.q = q.trim();
            if (initiated_by_me) body.initiated_by_me = true;
            if (filter_event) body.types = [filter_event];
            if (filter_severity) body.severities = [filter_severity];
            if (filter_team) body.teams = [filter_team];

            const res = await auth_fetch('/v1/notifications/get', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(data.error?.message ?? 'Request failed');
                return;
            }
            const page = hub_payload<{ items?: NotificationRow[]; total?: number; notifications?: NotificationRow[] }>(data) ?? data;
            const items = page.items ?? page.notifications ?? [];
            set_rows(items);
            set_total(Number(page.total ?? 0));
            set_error(null);
        } catch {
            set_error('Failed to load events');
        } finally {
            set_loading(false);
        }
    }, [auth_fetch, current_id, offset, q, initiated_by_me, filter_event, filter_severity, filter_team]);

    useEffect(() => { void load(); }, [load]);

    /** Auto-refresh every 15s. */
    useEffect(() => {
        const id = window.setInterval(() => { void load(); }, 15_000);
        return () => window.clearInterval(id);
    }, [load]);

    /** Distinct values for filter dropdowns (from current page). */
    const distinct_events = useMemo(() => [...new Set(rows.map((r) => r.event).filter(Boolean))].sort(), [rows]);
    const distinct_severities = useMemo(() => [...new Set(rows.map((r) => r.severity).filter(Boolean) as string[])].sort(), [rows]);
    const distinct_teams = useMemo(() => [...new Set(rows.map((r) => r.team).filter(Boolean) as string[])].sort(), [rows]);

    return (
        <div className="space-y-3">
            <ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

            {/* Search + filters bar */}
            <div className="flex flex-wrap items-center gap-2">
                <form
                    className="flex-1"
                    onSubmit={(e) => { e.preventDefault(); set_q(q_draft); set_offset(0); }}
                >
                    <input
                        type="text"
                        value={q_draft}
                        onChange={(e) => set_q_draft(e.target.value)}
                        placeholder="Search events…"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                </form>
                <select
                    value={filter_event}
                    onChange={(e) => { set_filter_event(e.target.value); set_offset(0); }}
                    className="rounded-lg border border-slate-200 px-2 py-2 text-xs"
                >
                    <option value="">All events</option>
                    {distinct_events.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
                <select
                    value={filter_severity}
                    onChange={(e) => { set_filter_severity(e.target.value); set_offset(0); }}
                    className="rounded-lg border border-slate-200 px-2 py-2 text-xs"
                >
                    <option value="">All severities</option>
                    {distinct_severities.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                    value={filter_team}
                    onChange={(e) => { set_filter_team(e.target.value); set_offset(0); }}
                    className="rounded-lg border border-slate-200 px-2 py-2 text-xs"
                >
                    <option value="">All teams</option>
                    {distinct_teams.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            <th className="px-4 py-2">When</th>
                            <th className="px-4 py-2">Event</th>
                            <th className="px-4 py-2">Severity</th>
                            <th className="px-4 py-2">Realm</th>
                            <th className="px-4 py-2">Team</th>
                            <th className="px-4 py-2">Run</th>
                            <th className="px-4 py-2">Phase</th>
                            <th className="px-4 py-2">Message</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">No events match these filters.</td></tr>
                        ) : rows.map((row) => {
                            const run_name = typeof row.payload?.run_name === 'string' ? row.payload.run_name : null;
                            const review_id = typeof row.payload?.review_id === 'string' ? row.payload.review_id : null;
                            const sev_class = SEVERITY_COLORS[row.severity ?? ''] ?? 'bg-slate-100 text-slate-500';

                            return (
                                <tr key={row.id}>
                                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                                        {format_when(row.created_at)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <code className="text-xs">{row.event}</code>
                                    </td>
                                    <td className="px-4 py-3">
                                        {row.severity ? (
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${sev_class}`}>
                                                {row.severity}
                                            </span>
                                        ) : <span className="text-xs text-slate-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-600">
                                        {row.realm_slug
                                            ? row.realm_slug
                                            : row.realm_id
                                                ? <span className="text-slate-300" title={row.realm_id}>{row.realm_id.slice(0, 8)}…</span>
                                                : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-600">
                                        {row.team
                                            ? row.team
                                            : row.run_id
                                                ? <span className="italic text-slate-300">local</span>
                                                : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs">
                                        {row.run_id ? (
                                            <Link to={`/runs/${row.run_id}`} className="text-indigo-600 hover:underline">
                                                {run_name || `${row.run_id.slice(0, 8)}…`}
                                            </Link>
                                        ) : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-600">
                                        {row.phase ?? <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="max-w-xs truncate px-4 py-3 text-xs text-slate-600">
                                        {review_id ? (
                                            <Link to={`/reviews/${review_id}`} className="text-indigo-600 hover:underline">
                                                {row.title || row.message || 'Open review'}
                                            </Link>
                                        ) : (row.message || row.title || '—')}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <Pagination total={total} offset={offset} limit={PAGE_LIMIT} on_change={set_offset} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Component() {
    const { user, refresh } = useAuth();
    const auth_fetch = useAuthFetch();
    const [params, set_params] = useSearchParams();
    const tab = resolve_tab(params.get('tab'));

    const org_fetch = useOrgFetch();
    const prefs = user?.preferences ?? {};
    const alerts = get_event_alerts(prefs);

    /** Live pending HUG count for the bell indicator. */
    const [hug_count, set_hug_count] = useState(0);
    useEffect(() => {
        let cancelled = false;
        async function poll() {
            try {
                const res = await org_fetch('/v1/reviews/get', {
                    method: 'POST',
                    body: JSON.stringify({ limit: 1, offset: 0 }),
                });
                const data = await res.json();
                if (!cancelled && data.ok) set_hug_count(Number(data.total ?? 0));
            } catch { /* best-effort */ }
        }
        void poll();
        const id = window.setInterval(poll, 15_000);
        return () => { cancelled = true; window.clearInterval(id); };
    }, [org_fetch]);

    /** Switch tabs via URL. */
    function set_tab(next: EventTab) {
        set_params({ tab: next });
    }

    /** Toggle alert for a tab — optimistic + persist. */
    const [local_alerts, set_local_alerts] = useState<Partial<EventAlerts>>({});
    const effective_alerts = { ...alerts, ...local_alerts };

    async function toggle_alert(key: 'hug' | 'my_runs' | 'all') {
        const current = effective_alerts[key] ?? false;
        const next_val = !current;
        set_local_alerts((prev) => ({ ...prev, [key]: next_val }));
        try {
            const existing = (prefs.event_alerts ?? {}) as Record<string, unknown>;
            await auth_fetch('/v1/users/update', {
                method: 'POST',
                body: JSON.stringify({
                    preferences: {
                        event_alerts: { ...existing, [key]: next_val },
                    },
                }),
            });
            await refresh();
        } catch {
            set_local_alerts((prev) => ({ ...prev, [key]: current }));
        }
    }

    /** Mark tab as seen (for My Runs / All Events badges). */
    useEffect(() => {
        if (tab === 'my-runs' && alerts.my_runs) {
            auth_fetch('/v1/users/update', {
                method: 'POST',
                body: JSON.stringify({
                    preferences: {
                        event_alerts: { ...prefs.event_alerts as object, my_runs_seen_at: Date.now() },
                    },
                }),
            }).then(() => refresh()).catch(() => {});
        }
        if (tab === 'all') {
            /** Clear the bell badge — stamp "last seen" so the unread
             *  count in use_sidebar_badges resets to 0 immediately. */
            mark_notifications_seen();

            if (alerts.all) {
                auth_fetch('/v1/users/update', {
                    method: 'POST',
                    body: JSON.stringify({
                        preferences: {
                            event_alerts: { ...prefs.event_alerts as object, all_seen_at: Date.now() },
                        },
                    }),
                }).then(() => refresh()).catch(() => {});
            }
        }
    }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

    const alert_key_for_tab: Record<EventTab, 'hug' | 'my_runs' | 'all'> = {
        'hug': 'hug',
        'my-runs': 'my_runs',
        'all': 'all',
    };

    return (
        <div>
            <Breadcrumbs items={[{ label: 'HUGs and Events' }]} />
            <PageHeader
                icon={Zap}
                tone="amber"
                title="HUGs and Events"
                description="Live event stream, pending reviews, and run activity."
                help={PAGE_HELP.reviews?.help}
                docs_href={PAGE_HELP.reviews?.docs_href}
            />

            {/* Tab bar */}
            <div className="mt-6 flex items-center gap-1 border-b border-slate-200">
                {TABS.map(({ key, label }) => {
                    const active = key === tab;
                    const alert_key = alert_key_for_tab[key];
                    const alert_on = alerts[alert_key] ?? false;

                    return (
                        <div key={key} className="flex items-center">
                            <button
                                type="button"
                                onClick={() => set_tab(key)}
                                className={`px-4 py-2 text-sm font-semibold transition ${
                                    active
                                        ? 'border-b-2 border-indigo-600 text-indigo-700'
                                        : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                {label}
                            </button>
                            {key === 'hug' && hug_count > 0 ? (
                                <span className="ml-1 flex items-center" title={`${hug_count} pending`}>
                                    <Bell className="h-3.5 w-3.5 fill-red-600 text-red-600" />
                                    <span className="ml-0.5 text-[10px] font-bold text-red-600">{hug_count}</span>
                                </span>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            {/* Tab content */}
            <div className="mt-4">
                <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
                    <label className="flex cursor-pointer items-center gap-2">
                        <span>Home alerts</span>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={!!effective_alerts[alert_key_for_tab[tab]]}
                            onClick={() => void toggle_alert(alert_key_for_tab[tab])}
                            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                                effective_alerts[alert_key_for_tab[tab]]
                                    ? 'bg-indigo-600'
                                    : 'bg-slate-300'
                            }`}
                        >
                            <span
                                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                                    effective_alerts[alert_key_for_tab[tab]]
                                        ? 'translate-x-[1.1rem]'
                                        : 'translate-x-0.5'
                                }`}
                            />
                        </button>
                    </label>
                </div>

                {tab === 'hug' ? (
                    <ReviewsPanel embedded />
                ) : (
                    <Event_table initiated_by_me={tab === 'my-runs' || undefined} />
                )}
            </div>
        </div>
    );
}
