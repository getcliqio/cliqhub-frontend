import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CheckCircle2, GitPullRequest } from 'lucide-react';
import { PageHeader } from '@/components/ui/page_header';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { PAGE_HELP } from '@/lib/page_help';
import { useOrg, useOrgFetch } from '@/lib/org_context';
import { Pagination, PAGE_LIMIT } from '@/components/pagination';
import { use_poll } from '@/lib/use_poll';
import { realm_qualified_label } from '@/lib/realm_url';

// ── Types ────────────────────────────────────────────────────────────

interface ReviewRow {
    review_id: string;
    realm_id: string;
    realm_name: string | null;
    realm_slug: string | null;
    org_slug: string | null;
    run_id: string | null;
    run_name: string | null;
    phase: string | null;
    team: string | null;
    title: string | null;
    message: string | null;
    review_url: string | null;
    event: string;
    requested_at: number;
    notification_id: string;
    status: string;
    artifact_count?: number;
    resolved_at?: number | null;
    last_reminded_at?: number | null;
}

// ── Status filter definitions ────────────────────────────────────────

interface StatusPreset {
    label: string;
    statuses: string[];
}

const STATUS_PRESETS: Record<string, StatusPreset> = {
    pending: { label: 'Pending', statuses: ['pending'] },
    completed: { label: 'Completed', statuses: ['decided', 'completed'] },
    expired: { label: 'Expired', statuses: ['expired'] },
    all: { label: 'All', statuses: ['pending', 'decided', 'completed', 'expired'] },
};

const PRESET_ORDER = ['pending', 'completed', 'expired', 'all'] as const;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Pending', cls: 'bg-amber-100 text-amber-800' },
    decided: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-800' },
    completed: { label: 'Completed', cls: 'bg-emerald-100 text-emerald-800' },
    expired: { label: 'Expired', cls: 'bg-red-100 text-red-800' },
};

// ── Helpers ──────────────────────────────────────────────────────────

function api_error_message(data: { error?: string | { message?: string } }): string {
    if (typeof data.error === 'string') return data.error;
    return data.error?.message ?? 'Request failed';
}

function format_age(ts: number): string {
    const ms = Date.now() - ts;
    if (ms < 60_000) return 'just now';
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function is_urgent(ts: number, minutes = 15): boolean {
    return Date.now() - ts > minutes * 60_000;
}

function review_app_path(row: ReviewRow): string {
    return `/reviews/${encodeURIComponent(row.review_id)}`;
}

function review_slug(id: string): string {
    return id.length > 8 ? id.slice(0, 8) : id;
}

// ── Main panel ───────────────────────────────────────────────────────

/** HUG reviews — single table with status filter. */
export function ReviewsPanel({ embedded = false }: { embedded?: boolean }) {
    const auth_fetch = useOrgFetch();
    const { current_id } = useOrg();
    const navigate = useNavigate();

    const [error, set_error] = useState<string | null>(null);
    const [loading, set_loading] = useState(true);
    const [rows, set_rows] = useState<ReviewRow[]>([]);
    const [total, set_total] = useState(0);
    const [offset, set_offset] = useState(0);
    const [active_preset, set_active_preset] = useState<string>('pending');

    const preset = STATUS_PRESETS[active_preset] ?? STATUS_PRESETS.pending;

    const load = useCallback(async (opts?: { silent?: boolean }) => {
        // Body org_id is invent SoT — skip until org context is ready.
        if (!current_id) {
            if (!opts?.silent) set_loading(false);
            return;
        }
        if (!opts?.silent) set_loading(true);
        try {
            const res = await auth_fetch('/v1/reviews/get', {
                method: 'POST',
                body: JSON.stringify({
                    org_id: current_id,
                    statuses: preset.statuses,
                    limit: PAGE_LIMIT,
                    offset,
                }),
            });
            const data = await res.json();
            if (!data.ok) { if (!opts?.silent) set_error(api_error_message(data)); return; }
            set_rows(data.reviews ?? []);
            set_total(Number(data.total ?? 0));
            set_error(null);
        } catch { if (!opts?.silent) set_error('Failed to load reviews'); }
        finally { if (!opts?.silent) set_loading(false); }
    }, [auth_fetch, current_id, offset, preset.statuses]);

    useEffect(() => { void load(); }, [load]);

    /** Poll for updates — faster when viewing unresolved. */
    use_poll(
        () => void load({ silent: true }),
        active_preset === 'pending' ? 8_000 : 30_000,
        !loading,
    );

    /** Reset offset when switching presets. */
    function switch_preset(key: string) {
        set_active_preset(key);
        set_offset(0);
    }

    const sorted = useMemo(
        () => [...rows].sort((a, b) => b.requested_at - a.requested_at),
        [rows],
    );

    function on_click(row: ReviewRow) {
        navigate(review_app_path(row));
    }

    // ── Render ────────────────────────────────────────────────────────

    const actions = (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={() => void load({ silent: true })}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
                Refresh
            </button>
        </div>
    );

    return (
        <div>
            {!embedded ? (
                <>
                    <Breadcrumbs items={[{ label: 'HUG Reviews' }]} />
                    <PageHeader
                        icon={GitPullRequest}
                        tone="amber"
                        title="HUG Reviews"
                        description="Gates waiting on a person — approve, reject, or route without leaving Hub."
                        help={PAGE_HELP.reviews?.help}
                        docs_href={PAGE_HELP.reviews?.docs_href}
                        actions={actions}
                    />
                </>
            ) : (
                <div className="mb-4 flex justify-end">{actions}</div>
            )}

            <ApiErrorBanner error={error} onDismiss={() => set_error(null)} className={embedded ? '' : 'mt-4'} />

            {/* ── Status filter toggle ─────────────────────────────── */}
            <div className={`flex gap-1 rounded-lg bg-slate-100 p-1 ${embedded ? '' : 'mt-4'}`}>
                {PRESET_ORDER.map((key) => {
                    const p = STATUS_PRESETS[key];
                    const is_active = key === active_preset;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => switch_preset(key)}
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                                is_active
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {p.label}
                        </button>
                    );
                })}
            </div>

            {/* ── Table ────────────────────────────────────────────── */}
            <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                {loading ? (
                    <p className="px-5 py-10 text-center text-sm text-slate-400">Loading…</p>
                ) : sorted.length === 0 ? (
                    active_preset === 'pending' ? (
                        <div className="flex items-center gap-4 px-5 py-6">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                <CheckCircle2 className="h-5 w-5" />
                            </span>
                            <div>
                                <p className="text-sm font-bold text-emerald-950">All clear</p>
                                <p className="mt-0.5 text-sm text-emerald-800/80">No open HUG reviews right now.</p>
                            </div>
                        </div>
                    ) : (
                        <p className="px-5 py-8 text-center text-sm text-slate-400">None.</p>
                    )
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:border-slate-800">
                                <th className="px-4 py-2">Review</th>
                                <th className="px-4 py-2">Status</th>
                                <th className="px-4 py-2">Team</th>
                                <th className="px-4 py-2">Run</th>
                                <th className="px-4 py-2">Realm</th>
                                <th className="px-4 py-2">Age</th>
                                <th className="px-4 py-2">Last Reminder</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                            {sorted.map((row) => {
                                const urgent = is_urgent(row.requested_at);
                                const realm_label = row.realm_slug
                                    ? realm_qualified_label(row.org_slug, row.realm_slug)
                                    : (row.realm_id ? `${row.realm_id.slice(0, 8)}…` : '—');
                                const badge = STATUS_BADGE[row.status] ?? STATUS_BADGE.pending;

                                return (
                                    <tr
                                        key={`${row.review_id}-${row.notification_id}`}
                                        className="cursor-pointer transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                                        onClick={() => on_click(row)}
                                    >
                                        <td className="max-w-[14rem] px-4 py-3">
                                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                                                {row.title || row.phase || 'Human review'}
                                            </p>
                                            <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                                                {review_slug(row.review_id)}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${badge.cls}`}>
                                                {badge.label}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {row.team ? (
                                                <span className="font-mono text-xs font-medium text-slate-700 dark:text-slate-200">
                                                    {row.team}
                                                </span>
                                            ) : <span className="text-xs text-slate-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            {row.run_id ? (
                                                <div className="min-w-[10rem]">
                                                    <p className="font-medium text-slate-800 dark:text-slate-200">
                                                        {row.run_name || '—'}
                                                    </p>
                                                    <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">
                                                        {row.run_id.slice(0, 12)}…
                                                    </p>
                                                </div>
                                            ) : <span className="text-xs text-slate-300">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                            {row.realm_slug ? (
                                                <Link
                                                    to={`/o/${encodeURIComponent(row.org_slug ?? 'unknown')}/realms/${encodeURIComponent(row.realm_slug)}`}
                                                    className="text-xs font-medium text-indigo-700 hover:underline"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    {realm_label}
                                                </Link>
                                            ) : (
                                                <span className="text-xs text-slate-500">{realm_label}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-500">
                                            <span className={urgent && row.status === 'pending' ? 'font-semibold text-amber-800' : ''}>
                                                {format_age(row.requested_at)}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-500">
                                            {row.last_reminded_at ? format_age(row.last_reminded_at) : '—'}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
                <Pagination
                    total={total}
                    offset={offset}
                    limit={PAGE_LIMIT}
                    on_change={set_offset}
                    label="reviews"
                />
            </div>
        </div>
    );
}

export function Component() {
    return <ReviewsPanel />;
}
