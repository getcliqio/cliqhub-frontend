/**
 * Members settings panel — org member management within the Settings page.
 * Delegates to the existing org detail member UI scoped to the current org.
 */

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { useOrg, useOrgFetch } from '@/lib/org_context';
import { useAuth } from '@/lib/auth_context';
import { ApiErrorBanner } from '@/components/ui/api_error';

interface MemberRow {
    user_id: string;
    username: string;
    display_name: string;
    email: string;
    role: string;
    role_id?: string;
}

interface RoleOption {
    id: string;
    slug: string;
    name: string;
}

export default function Members_settings_panel() {
    const { current_org } = useOrg();
    const { user } = useAuth();
    const org_fetch = useOrgFetch();
    const [members, set_members] = useState<MemberRow[]>([]);
    const [roles, set_roles] = useState<RoleOption[]>([]);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState<string | null>(null);
    const [invite_email, set_invite_email] = useState('');
    const [invite_loading, set_invite_loading] = useState(false);

    const org_id = current_org?.id;

    const load = useCallback(async () => {
        if (!org_id) return;
        set_loading(true);
        try {
            const [members_res, roles_res] = await Promise.all([
                org_fetch('/v1/orgs/get_by_id', {
                    method: 'POST',
                    body: JSON.stringify({ org_id }),
                }),
                org_fetch('/v1/orgs/list_roles', {
                    method: 'POST',
                    body: JSON.stringify({ org_id }),
                }),
            ]);
            const m_json = await members_res.json();
            const r_json = await roles_res.json();
            if (m_json.ok) set_members(m_json.data?.members ?? []);
            if (r_json.ok) set_roles(
                (r_json.data?.roles ?? [])
                    .filter((r: any) => !r.is_system)
                    .map((r: any) => ({ id: String(r.id), slug: r.slug, name: r.name })),
            );
        } catch {
            set_error('Failed to load members');
        }
        set_loading(false);
    }, [org_id, org_fetch]);

    useEffect(() => { load(); }, [load]);

    async function handle_set_role(user_id: string, role_id: string) {
        set_error(null);
        const role = roles.find(r => r.id === role_id);
        if (!role) return;
        try {
            const res = await org_fetch('/v1/users/update_role', {
                method: 'POST',
                body: JSON.stringify({
                    org_id,
                    user_id,
                    role_id,
                }),
            });
            const json = await res.json();
            if (!json.ok) { set_error(json.error?.message ?? 'Failed to update role'); return; }
            await load();
        } catch {
            set_error('Failed to update role');
        }
    }

    async function handle_remove(user_id: string) {
        set_error(null);
        try {
            const res = await org_fetch('/v1/orgs/remove_member', {
                method: 'POST',
                body: JSON.stringify({ org_id, user_id }),
            });
            const json = await res.json();
            if (!json.ok) { set_error(json.error?.message ?? 'Failed to remove member'); return; }
            await load();
        } catch {
            set_error('Failed to remove member');
        }
    }

    async function handle_invite(e: FormEvent) {
        e.preventDefault();
        if (!invite_email.trim()) return;
        set_invite_loading(true);
        set_error(null);
        try {
            const res = await org_fetch('/v1/invitations/create', {
                method: 'POST',
                body: JSON.stringify({ target_type: 'org', org_id, email: invite_email.trim() }),
            });
            const json = await res.json();
            if (!json.ok) { set_error(json.error?.message ?? 'Failed to invite'); return; }
            set_invite_email('');
            await load();
        } catch {
            set_error('Failed to send invite');
        } finally {
            set_invite_loading(false);
        }
    }

    if (!current_org) return null;

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Members</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    Manage who has access to {current_org.display_name}.
                </p>
            </div>

            {error && <ApiErrorBanner error={error} />}

            <form onSubmit={handle_invite} className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                    type="email"
                    value={invite_email}
                    onChange={(e) => set_invite_email(e.target.value)}
                    placeholder="Invite by email..."
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <button
                    type="submit"
                    disabled={invite_loading || !invite_email.trim()}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                    Invite
                </button>
            </form>

            {loading ? (
                <p className="text-sm text-slate-400">Loading members...</p>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                            <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500">User</th>
                            <th className="px-3 py-2 text-left text-xs font-bold uppercase text-slate-500">Role</th>
                            <th className="px-3 py-2 text-right text-xs font-bold uppercase text-slate-500" />
                        </tr>
                    </thead>
                    <tbody>
                        {members.map(m => (
                            <tr key={m.user_id} className="border-b border-slate-100 dark:border-slate-800">
                                <td className="px-3 py-2">
                                    <span className="font-medium text-slate-900 dark:text-slate-100">{m.display_name || m.username}</span>
                                    <span className="ml-2 text-xs text-slate-400">@{m.username}</span>
                                </td>
                                <td className="px-3 py-2">
                                    <select
                                        value={m.role_id ?? ''}
                                        onChange={(e) => handle_set_role(m.user_id, e.target.value)}
                                        disabled={m.user_id === user?.id}
                                        className="rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                    >
                                        {m.role === 'owner' || (m as any).role_slug === 'owner' ? (
                                            <option value="">Owner</option>
                                        ) : null}
                                        {roles.map(r => (
                                            <option key={r.id} value={r.id}>{r.name}</option>
                                        ))}
                                    </select>
                                </td>
                                <td className="px-3 py-2 text-right">
                                    {m.user_id !== user?.id && (
                                        <button
                                            type="button"
                                            onClick={() => handle_remove(m.user_id)}
                                            className="text-slate-400 hover:text-red-600"
                                            title="Remove member"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
