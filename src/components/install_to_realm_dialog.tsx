import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { Install_team_wizard } from '@/components/install_team_wizard';
import { realm_qualified_label } from '@/lib/realm_url';

interface RealmOption {
    id: string;
    slug: string;
    org_slug: string | null;
    name: string;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
    if (typeof data.error === 'string') return data.error;
    return data.error?.message ?? 'Request failed';
}

/**
 * Two-step dialog: pick a realm, then run the agent-check wizard
 * before installing the team.
 */
export function InstallToRealmDialog({
    scope,
    slug,
    version,
    on_close,
}: {
    scope: string;
    slug: string;
    /** When set, install this specific version instead of latest. */
    version?: string;
    on_close: () => void;
}) {
    const auth_fetch = useOrgFetch();
    const [realms, set_realms] = useState<RealmOption[]>([]);
    const [loading, set_loading] = useState(true);
    const [selected, set_selected] = useState('');
    const [filter, set_filter] = useState('');
    const [error, set_error] = useState<string | null>(null);
    const [done_slug, set_done_slug] = useState<string | null>(null);
    const [done_org_slug, set_done_org_slug] = useState<string | null>(null);

    /** The realm chosen by the user — triggers the wizard step. */
    const [chosen_realm, set_chosen_realm] = useState<RealmOption | null>(null);

    const load = useCallback(async () => {
        set_loading(true);
        try {
            const res = await auth_fetch('/v1/realms/get', {
                method: 'POST',
                body: JSON.stringify({ limit: 100, offset: 0 }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(api_error_message(data));
                return;
            }
            const rows = (data.realms ?? []) as RealmOption[];
            set_realms(rows);
            if (rows[0]) set_selected(rows[0].id);
        } catch {
            set_error('Failed to load realms');
        } finally {
            set_loading(false);
        }
    }, [auth_fetch]);

    useEffect(() => {
        void load();
    }, [load]);

    const filtered = filter.trim()
        ? realms.filter((r) => {
            const q = filter.toLowerCase();
            return r.slug.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
        })
        : realms;

    function handle_next() {
        if (!selected) return;
        const realm = realms.find((r) => r.id === selected);
        if (!realm) return;
        set_chosen_realm(realm);
    }

    /** Wizard finished successfully — show done state. */
    function handle_wizard_done() {
        if (chosen_realm) {
            set_done_slug(chosen_realm.slug);
            set_done_org_slug(chosen_realm.org_slug ?? null);
        }
        set_chosen_realm(null);
    }

    /** If we're in the wizard step, render it. */
    if (chosen_realm && !done_slug) {
        return (
            <Install_team_wizard
                scope={scope}
                slug={slug}
                version={version}
                realm_id={chosen_realm.id}
                auth_fetch={auth_fetch}
                on_done={handle_wizard_done}
                on_cancel={on_close}
                on_back={() => set_chosen_realm(null)}
				header_title={`Install to ${realm_qualified_label(chosen_realm.org_slug, chosen_realm.slug)}`}
            />
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                            Install to realm
                        </h2>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Choose a realm to install{' '}
                            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800 dark:text-slate-200">@{scope}/{slug}</code> into.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={on_close}
                        className="text-xs font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                        Close
                    </button>
                </div>

                {done_slug ? (
                    <div className="space-y-3">
                        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                            Installed. Daemons in the realm will pick it up shortly.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <Link
                                to={`/o/${encodeURIComponent(done_org_slug ?? 'unknown')}/realms/${encodeURIComponent(done_slug)}/teams`}
                                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                            >
                                Open realm teams
                            </Link>
                            <button
                                type="button"
                                onClick={on_close}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {loading ? (
                            <p className="text-sm text-slate-400">Loading realms…</p>
                        ) : realms.length === 0 ? (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                No realms yet.{' '}
                                <Link to="/realms?create=1" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-400">
                                    Create one
                                </Link>
                            </p>
                        ) : (
                            <>
                                <input
                                    value={filter}
                                    onChange={(e) => set_filter(e.target.value)}
                                    placeholder="Filter realms…"
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                />
                                <select
                                    value={selected}
                                    onChange={(e) => set_selected(e.target.value)}
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                >
                                    {filtered.map((r) => (
                                        <option key={r.id} value={r.id}>
                                            {r.name} ({realm_qualified_label(r.org_slug, r.slug)})
                                        </option>
                                    ))}
                                </select>
                            </>
                        )}

                        {error ? (
                            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
                                {error}
                            </p>
                        ) : null}

                        <div className="flex justify-end gap-2 pt-1">
                            <button
                                type="button"
                                onClick={on_close}
                                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!selected || loading}
                                onClick={handle_next}
                                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
