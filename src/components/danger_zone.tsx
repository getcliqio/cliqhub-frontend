import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';

interface Props {
    scope: string | null;
    name: string;
    author_id: string;
}

/**
 * "Danger Zone" panel shown at the bottom of a team detail page.
 * Renders for the team owner or any admin. Requires typing the team name to confirm.
 * After deletion, redirects to the parent teams list based on the current route.
 */
export function DangerZone({ scope, name, author_id }: Props) {
    const { user } = useAuth();
    const authFetch = useOrgFetch();
    const navigate = useNavigate();
    const { pathname } = useLocation();

    const [confirm_text, setConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState(false);

    const is_owner = user && user.id === author_id;
    const is_admin = user && user.role === 'admin';

    if (!is_owner && !is_admin) {
        return null;
    }

    const full_name = scope ? `@${scope}/${name}` : name;
    const can_confirm = confirm_text === full_name;

    function redirect_target(): string {
        if (pathname.startsWith('/admin/')) return '/admin/teams';
        if (pathname.startsWith('/teams')) return '/teams';
        if (pathname.startsWith('/browse')) return '/browse';
        return '/teams';
    }

    async function handle_delete() {
        if (!can_confirm) return;
        setDeleting(true);
        setError('');

        try {
            const res = await authFetch('/v1/teams/delete', {
                method: 'POST',
                body: JSON.stringify({ name, scope: scope || undefined }),
            });
            const data = await res.json();

            if (!data.ok) {
                setError(data.error?.message || 'Failed to delete team');
                setDeleting(false);
                return;
            }

            navigate(redirect_target());
        } catch {
            setError('Network error');
            setDeleting(false);
        }
    }

    return (
        <section className="mt-12 mb-10">
            <div className="rounded-xl border-2 border-red-200 bg-red-50/30">
                <div className="flex items-center justify-between px-6 py-4">
                    <h2 className="text-sm font-bold text-red-700">Danger Zone</h2>
                    {!expanded ? (
                        <button
                            type="button"
                            onClick={() => setExpanded(true)}
                            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                            Delete team…
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setExpanded(false)}
                            className="text-xs font-medium text-red-500 hover:text-red-700"
                        >
                            Cancel
                        </button>
                    )}
                </div>

                {expanded ? (
                    <div className="border-t border-red-200 px-6 py-5">
                        <p className="text-sm text-slate-700">
                            Permanently delete <span className="font-mono font-semibold">{full_name}</span> and all its versions.
                            This action cannot be undone.
                        </p>
                        <div className="mt-4">
                            <label className="mb-1.5 block text-sm text-slate-600">
                                Type <span className="font-mono font-semibold">{full_name}</span> to confirm
                            </label>
                            <input
                                type="text"
                                value={confirm_text}
                                onChange={(e) => setConfirmText(e.target.value)}
                                placeholder={full_name}
                                className="w-full max-w-sm rounded-lg border border-red-300 px-3 py-2 font-mono text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                            />
                        </div>
                        {error && (
                            <p className="mt-2 text-sm text-red-600">{error}</p>
                        )}
                        <button
                            type="button"
                            onClick={handle_delete}
                            disabled={!can_confirm || deleting}
                            className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {deleting ? 'Deleting...' : 'Delete this team'}
                        </button>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
