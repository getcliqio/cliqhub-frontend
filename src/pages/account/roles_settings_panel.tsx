/**
 * Roles settings panel — CRUD for org roles with permission checklist editor.
 *
 * Features:
 *   - Table of roles with expand-to-edit.
 *   - "Save" (overwrite) and "Save As New Role" (fork) buttons.
 *   - Permission checklist grouped by domain.
 *   - Delete with member-count warning.
 */

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useOrg, useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';

interface RoleRow {
    id: number;
    slug: string;
    name: string;
    permissions: string[];
    is_system: boolean;
    is_default: boolean;
    member_count: number;
}

/** Permission groups for the checklist UI. */
const PERMISSION_GROUPS: Array<{ label: string; prefix: string }> = [
    { label: 'Org Management', prefix: 'org.' },
    { label: 'Realms', prefix: 'realms.' },
    { label: 'Daemons & Infrastructure', prefix: 'daemons.|tokens.|dispatch_keys.' },
    { label: 'Teams & Runs', prefix: 'teams.|runs.' },
    { label: 'Notifications', prefix: 'channels.|rules.|inbox.' },
    { label: 'Agents', prefix: 'agents.' },
    { label: 'HUG Reviews', prefix: 'reviews.' },
];

function perm_matches_group(perm: string, group_prefix: string): boolean {
    return group_prefix.split('|').some(p => perm.startsWith(p));
}

/** Humanize a permission string for display. */
function humanize(perm: string): string {
    return perm
        .replace(/\./g, ' ')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

export default function Roles_settings_panel() {
    const { current_org } = useOrg();
    const org_fetch = useOrgFetch();
    const [roles, set_roles] = useState<RoleRow[]>([]);
    const [all_perms, set_all_perms] = useState<string[]>([]);
    const [owner_only, set_owner_only] = useState<string[]>([]);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState<string | null>(null);
    const [expanded_id, set_expanded_id] = useState<number | null>(null);

    /** Draft state for the expanded role. */
    const [draft_name, set_draft_name] = useState('');
    const [draft_perms, set_draft_perms] = useState<Set<string>>(new Set());

    /** State for "Save As New Role" dialog. */
    const [fork_mode, set_fork_mode] = useState(false);
    const [fork_slug, set_fork_slug] = useState('');
    const [fork_name, set_fork_name] = useState('');

    /** State for new role creation. */
    const [creating, set_creating] = useState(false);
    const [new_slug, set_new_slug] = useState('');
    const [new_name, set_new_name] = useState('');

    const load = useCallback(async () => {
        if (!current_org) return;
        set_loading(true);
        try {
            const [roles_res, perms_res] = await Promise.all([
                org_fetch('/v1/orgs/list_roles', {
                    method: 'POST',
                    body: JSON.stringify({ org_id: current_org.id }),
                }),
                org_fetch('/v1/permissions/list', { method: 'POST', body: '{}' }),
            ]);
            const r_json = await roles_res.json();
            const p_json = await perms_res.json();
            if (r_json.ok) set_roles(r_json.data?.roles ?? []);
            if (p_json.ok) {
                set_all_perms(p_json.data?.permissions ?? []);
                set_owner_only(p_json.data?.owner_only ?? []);
            }
        } catch {
            set_error('Failed to load roles');
        }
        set_loading(false);
    }, [org_fetch, current_org]);

    useEffect(() => { load(); }, [load]);

    /** Expand a role for editing. */
    function start_edit(role: RoleRow) {
        if (expanded_id === role.id) {
            set_expanded_id(null);
            return;
        }
        set_expanded_id(role.id);
        set_draft_name(role.name);
        set_draft_perms(new Set(role.permissions));
        set_fork_mode(false);
    }

    function toggle_perm(perm: string) {
        set_draft_perms(prev => {
            const next = new Set(prev);
            if (next.has(perm)) next.delete(perm);
            else next.add(perm);
            return next;
        });
    }

    function toggle_group(group_prefix: string) {
        const group_perms = all_perms.filter(p => perm_matches_group(p, group_prefix) && !owner_only.includes(p));
        const all_checked = group_perms.every(p => draft_perms.has(p));
        set_draft_perms(prev => {
            const next = new Set(prev);
            group_perms.forEach(p => {
                if (all_checked) next.delete(p);
                else next.add(p);
            });
            return next;
        });
    }

    /** Save (overwrite) the current role. */
    async function handle_save(role: RoleRow) {
        set_error(null);
        try {
            const res = await org_fetch('/v1/orgs/update_role', {
                method: 'POST',
                body: JSON.stringify({
                    org_id: current_org!.id,
                    role_id: role.id,
                    name: draft_name.trim(),
                    permissions: [...draft_perms],
                }),
            });
            const json = await res.json();
            if (!json.ok) { set_error(json.error?.message ?? 'Failed to save'); return; }
            await load();
        } catch {
            set_error('Failed to save role');
        }
    }

    /** Fork: create a new role based on current edits. */
    async function handle_fork() {
        set_error(null);
        if (!fork_slug.trim() || !fork_name.trim()) {
            set_error('Slug and name are required');
            return;
        }
        try {
            const res = await org_fetch('/v1/orgs/create_role', {
                method: 'POST',
                body: JSON.stringify({
                    org_id: current_org!.id,
                    slug: fork_slug.trim(),
                    name: fork_name.trim(),
                    permissions: [...draft_perms],
                }),
            });
            const json = await res.json();
            if (!json.ok) { set_error(json.error?.message ?? 'Failed to create role'); return; }
            set_fork_mode(false);
            set_fork_slug('');
            set_fork_name('');
            set_expanded_id(null);
            await load();
        } catch {
            set_error('Failed to create role');
        }
    }

    /** Create a new empty role. */
    async function handle_create() {
        set_error(null);
        if (!new_slug.trim() || !new_name.trim()) {
            set_error('Slug and name are required');
            return;
        }
        try {
            const res = await org_fetch('/v1/orgs/create_role', {
                method: 'POST',
                body: JSON.stringify({
                    org_id: current_org!.id,
                    slug: new_slug.trim(),
                    name: new_name.trim(),
                    permissions: [],
                }),
            });
            const json = await res.json();
            if (!json.ok) { set_error(json.error?.message ?? 'Failed to create role'); return; }
            set_creating(false);
            set_new_slug('');
            set_new_name('');
            await load();
        } catch {
            set_error('Failed to create role');
        }
    }

    /** Delete a role (blocked by API when members are still assigned). */
    async function handle_delete(role: RoleRow) {
        if (role.member_count > 0) {
            set_error(
                `Cannot delete "${role.name}" — ${role.member_count} member(s) still assigned. Reassign them first.`,
            );
            return;
        }
        if (!window.confirm(`Delete role "${role.name}"?`)) return;
        set_error(null);
        try {
            const res = await org_fetch('/v1/orgs/delete_role', {
                method: 'POST',
                body: JSON.stringify({ org_id: current_org!.id, role_id: role.id }),
            });
            const json = await res.json();
            if (!json.ok) { set_error(json.error?.message ?? 'Failed to delete'); return; }
            if (expanded_id === role.id) set_expanded_id(null);
            await load();
        } catch {
            set_error('Failed to delete role');
        }
    }

    if (!current_org) return null;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Roles</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Manage roles and permissions for {current_org.display_name}.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => set_creating(!creating)}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                    <Plus className="h-4 w-4" />
                    New Role
                </button>
            </div>

            {error && <ApiErrorBanner error={error} />}

            {creating && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                    <div className="flex items-end gap-3">
                        <div className="flex-1">
                            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Slug</label>
                            <input
                                value={new_slug}
                                onChange={e => set_new_slug(e.target.value)}
                                placeholder="my-role"
                                className="w-full rounded border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                        </div>
                        <div className="flex-1">
                            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Name</label>
                            <input
                                value={new_name}
                                onChange={e => set_new_name(e.target.value)}
                                placeholder="My Role"
                                className="w-full rounded border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={handle_create}
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                        >
                            Create
                        </button>
                        <button
                            type="button"
                            onClick={() => set_creating(false)}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <p className="text-sm text-slate-400">Loading roles...</p>
            ) : (
                <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                    {roles.map(role => (
                        <div key={role.id}>
                            <div
                                className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                onClick={() => start_edit(role)}
                            >
                                {expanded_id === role.id
                                    ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                                    : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                                }
                                <span className="font-medium text-slate-900 dark:text-slate-100">{role.name}</span>
                                <span className="text-xs text-slate-400">({role.slug})</span>
                                {role.is_system && (
                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                                        Owner
                                    </span>
                                )}
                                {role.is_default && !role.is_system && (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                                        Default
                                    </span>
                                )}
                                <span className="ml-auto text-xs text-slate-400">
                                    {role.member_count} member{role.member_count !== 1 ? 's' : ''}
                                </span>
                                {!role.is_system && (
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); handle_delete(role); }}
                                        className="text-slate-400 hover:text-red-600"
                                        title="Delete role"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                )}
                            </div>

                            {expanded_id === role.id && !role.is_system && (
                                <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/30">
                                    <div className="mb-4">
                                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Role Name</label>
                                        <input
                                            value={draft_name}
                                            onChange={e => set_draft_name(e.target.value)}
                                            className="w-60 rounded border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                        />
                                    </div>

                                    <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Permissions</p>
                                    <div className="space-y-4">
                                        {PERMISSION_GROUPS.map(group => {
                                            const group_perms = all_perms.filter(
                                                p => perm_matches_group(p, group.prefix) && !owner_only.includes(p),
                                            );
                                            if (group_perms.length === 0) return null;
                                            const all_checked = group_perms.every(p => draft_perms.has(p));
                                            const some_checked = group_perms.some(p => draft_perms.has(p));
                                            return (
                                                <div key={group.label}>
                                                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                                                        <input
                                                            type="checkbox"
                                                            checked={all_checked}
                                                            ref={el => { if (el) el.indeterminate = some_checked && !all_checked; }}
                                                            onChange={() => toggle_group(group.prefix)}
                                                            className="rounded border-slate-300"
                                                        />
                                                        {group.label}
                                                    </label>
                                                    <div className="ml-6 mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                                                        {group_perms.map(perm => (
                                                            <label key={perm} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={draft_perms.has(perm)}
                                                                    onChange={() => toggle_perm(perm)}
                                                                    className="rounded border-slate-300"
                                                                />
                                                                <span className="truncate" title={perm}>{humanize(perm)}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="mt-5 flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={() => handle_save(role)}
                                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                                        >
                                            Save
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => set_fork_mode(!fork_mode)}
                                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                        >
                                            Save As New Role
                                        </button>
                                    </div>

                                    {fork_mode && (
                                        <div className="mt-3 flex items-end gap-3 rounded-lg border border-dashed border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-800/50">
                                            <div className="flex-1">
                                                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">New Slug</label>
                                                <input
                                                    value={fork_slug}
                                                    onChange={e => set_fork_slug(e.target.value)}
                                                    placeholder="custom-role"
                                                    className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">New Name</label>
                                                <input
                                                    value={fork_name}
                                                    onChange={e => set_fork_name(e.target.value)}
                                                    placeholder="Custom Role"
                                                    className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handle_fork}
                                                className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
                                            >
                                                Create
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {expanded_id === role.id && role.is_system && (
                                <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-4 dark:border-slate-800 dark:bg-slate-800/30">
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        The Owner role has all permissions implicitly and cannot be edited.
                                        Ownership is transferred explicitly via org settings.
                                    </p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
