import { useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import { useOrgFetch } from '@/lib/org_context';
import { Realm_settings_nav } from '@/components/realm_settings_nav';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import { realm_qualified_label } from '@/lib/realm_url';

function api_error_message(data: { error?: string | { message?: string } }): string {
    if (typeof data.error === 'string') return data.error;
    return data.error?.message ?? 'Request failed';
}

export function Component() {
    const { realm, org_slug } = useOutletContext<Realm_outlet_context>();
    const auth_fetch = useOrgFetch();
    const navigate = useNavigate();

    const [confirm_text, set_confirm_text] = useState('');
    const [deleting, set_deleting] = useState(false);
    const [error, set_error] = useState<string | null>(null);

    const qualified = realm_qualified_label(org_slug, realm.slug);
    const can_delete = confirm_text === qualified;

    async function handle_delete() {
        if (!can_delete) return;
        set_deleting(true);
        set_error(null);
        try {
            const res = await auth_fetch('/v1/realms/delete', {
                method: 'POST',
                body: JSON.stringify({ realm_id: realm.id }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(api_error_message(data) || 'Failed to delete realm');
                set_deleting(false);
                return;
            }
            navigate('/realms');
        } catch {
            set_error('Network error');
            set_deleting(false);
        }
    }

    const base_path = `/o/${org_slug}/realms/${realm.slug}`;

    return (
        <div className="flex flex-col gap-5 md:flex-row md:gap-6">
            <Realm_settings_nav base_path={base_path} />
            <div className="min-w-0 flex-1">
                <div className="rounded-xl border-2 border-red-200 bg-red-50/30 p-6 dark:border-red-900/50 dark:bg-red-950/20">
                    <h2 className="text-lg font-bold text-red-700 dark:text-red-400">Delete realm</h2>
                    <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
                        Permanently removes{' '}
                        <span className="font-mono font-semibold">{qualified}</span>
                        {' '}— members, enroll tokens, and notification rules for this realm.
                        Daemons enrolled here lose Hub access and stop authenticating heartbeats.
                        Past runs are kept for history but will no longer appear under this realm.
                    </p>
                    <p className="mt-2 text-sm font-medium text-red-800 dark:text-red-300">
                        You cannot delete while runs are in progress (running or awaiting input).
                        This cannot be undone.
                    </p>
                    <div className="mt-4">
                        <label className="mb-1.5 block text-sm text-slate-600 dark:text-slate-400">
                            Type <span className="font-mono font-semibold">{qualified}</span> to confirm
                        </label>
                        <input
                            type="text"
                            value={confirm_text}
                            onChange={(e) => set_confirm_text(e.target.value)}
                            placeholder={qualified}
                            className="w-full max-w-sm rounded-lg border border-red-300 px-3 py-2 font-mono text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 dark:border-red-800 dark:bg-slate-900 dark:text-slate-100"
                        />
                    </div>
                    {error ? (
                        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => void handle_delete()}
                        disabled={!can_delete || deleting}
                        className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {deleting ? 'Deleting…' : 'Delete this realm'}
                    </button>
                </div>
            </div>
        </div>
    );
}
