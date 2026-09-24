import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthFetch } from '@/lib/auth_context';
import { validate_slug } from '@/lib/validation';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

interface AdminScope {
    id: number;
    slug: string;
    display_name: string;
    owner_id: string;
    owner_username: string;
    visibility: string;
    scope_type: string;
    team_count: number;
    created_at: string;
}

type OwnerLookupStatus = 'idle' | 'checking' | 'found' | 'not_found' | 'error';

export function Component() {
    const auth_fetch = useAuthFetch();
    const [scopes, set_scopes] = useState<AdminScope[]>([]);
    const [total, set_total] = useState(0);
    const [offset, set_offset] = useState(0);
    const [filter_draft, set_filter_draft] = useState('');
    const [active_query, set_active_query] = useState('');
    const [loading, set_loading] = useState(true);

    const [detail, set_detail] = useState<AdminScope | null>(null);
    const [edit_vis, set_edit_vis] = useState<'public' | 'private'>('public');
    const [edit_display, set_edit_display] = useState('');

    const [confirm_delete, set_confirm_delete] = useState(false);
    const [delete_text, set_delete_text] = useState('');

    const [creating, set_creating] = useState(false);
    const [new_slug, set_new_slug] = useState('');
    const [new_display, set_new_display] = useState('');
    const [new_owner_username, set_new_owner_username] = useState('');
    const [new_vis, set_new_vis] = useState<'public' | 'private'>('public');
    const [new_type, set_new_type] = useState<'user' | 'org'>('user');

    const [new_org_slug, set_new_org_slug] = useState('');
    const [org_lookup_status, set_org_lookup_status] = useState<OwnerLookupStatus>('idle');
    const [org_found_display, set_org_found_display] = useState('');
    const org_lookup_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [owner_lookup_status, set_owner_lookup_status] = useState<OwnerLookupStatus>('idle');
    const [owner_found_display, set_owner_found_display] = useState('');
    const lookup_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [field_errors, set_field_errors] = useState<Record<string, string | null>>({});
    const [touched, set_touched] = useState<Record<string, boolean>>({});
    const [action_error, set_action_error] = useState('');

    const LIMIT = 20;

    const load = useCallback(async () => {
        set_loading(true);
        try {
            const body: Record<string, unknown> = { limit: LIMIT, offset };
            const query = active_query.trim();
            if (query) body.query = query;
            const res = await auth_fetch('/v1/scopes/get', { method: 'POST', body: JSON.stringify(body) });
            const data = await res.json();
            if (data.ok) { set_scopes(data.data.scopes); set_total(data.data.total); }
            if (!data.ok) { set_action_error(data.error?.message || 'Failed to load scopes'); }
        } catch (err) {
            set_action_error(err instanceof Error ? err.message : 'Failed to load scopes');
        }
        set_loading(false);
    }, [auth_fetch, offset, active_query]);

    useEffect(() => { load(); }, [load]);

    function apply_filter(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const form = event.currentTarget;
        const raw = new FormData(form).get('query');
        const query = typeof raw === 'string' ? raw.trim() : filter_draft.trim();
        set_filter_draft(query);
        set_active_query(query);
        set_offset(0);
    }

    // ── Owner lookup (debounced exact match) ──

    function lookup_owner(username: string) {
        if (lookup_timer.current) clearTimeout(lookup_timer.current);

        if (!username || username.length < 2) {
            set_owner_lookup_status('idle');
            set_owner_found_display('');
            return;
        }

        set_owner_lookup_status('checking');
        lookup_timer.current = setTimeout(async () => {
            try {
                const res = await auth_fetch('/v1/users/get', {
                    method: 'POST',
                    body: JSON.stringify({ query: username, limit: 1, offset: 0 }),
                });
                const data = await res.json();
                if (!data.ok) { set_owner_lookup_status('error'); return; }
                const users = data.data.users as { username: string; email: string; display_name: string }[];
                const exact = users.length > 0 && users[0].username === username ? users[0] : null;
                if (exact) {
                    set_owner_lookup_status('found');
                    set_owner_found_display(`${exact.display_name} (${exact.email})`);
                    return;
                }
                set_owner_lookup_status('not_found');
                set_owner_found_display('');
            } catch {
                set_owner_lookup_status('error');
            }
        }, 400);
    }

    function handle_owner_change(value: string) {
        const lower = value.toLowerCase();
        set_new_owner_username(lower);
        lookup_owner(lower);
        if (touched.owner_username) {
            set_field_errors((prev) => ({ ...prev, owner_username: validate_slug(lower) }));
        }
    }

    // ── Org lookup (debounced exact match) ──

    function lookup_org(slug: string) {
        if (org_lookup_timer.current) clearTimeout(org_lookup_timer.current);

        if (!slug || slug.length < 2) {
            set_org_lookup_status('idle');
            set_org_found_display('');
            return;
        }

        set_org_lookup_status('checking');
        org_lookup_timer.current = setTimeout(async () => {
            try {
                const res = await auth_fetch('/v1/orgs/get', {
                    method: 'POST',
                    body: JSON.stringify({ query: slug, limit: 1, offset: 0 }),
                });
                const data = await res.json();
                if (!data.ok) { set_org_lookup_status('error'); return; }
                const orgs = data.data.orgs as { slug: string; display_name: string }[];
                const exact = orgs.length > 0 && orgs[0].slug === slug ? orgs[0] : null;
                if (exact) {
                    set_org_lookup_status('found');
                    set_org_found_display(exact.display_name);
                    return;
                }
                set_org_lookup_status('not_found');
                set_org_found_display('');
            } catch {
                set_org_lookup_status('error');
            }
        }, 400);
    }

    function handle_org_slug_change(value: string) {
        const lower = value.toLowerCase();
        set_new_org_slug(lower);
        lookup_org(lower);
        if (touched.org_slug) {
            set_field_errors((prev) => ({ ...prev, org_slug: validate_slug(lower) }));
        }
    }

    // ── Field validation helpers ──

    function validate_field(field: string, value: string): string | null {
        if (field === 'scope_slug') return validate_slug(value);
        if (field === 'owner_username') return validate_slug(value);
        if (field === 'org_slug') return validate_slug(value);
        return null;
    }

    function handle_field_blur(field: string, value: string) {
        set_touched((prev) => ({ ...prev, [field]: true }));
        set_field_errors((prev) => ({ ...prev, [field]: validate_field(field, value) }));
    }

    function input_class(field: string): string {
        const has_error = touched[field] && field_errors[field];
        return `w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${has_error ? 'border-red-400 focus:border-red-500' : 'border-slate-300 focus:border-indigo-500'}`;
    }

    // ── Detail panel ──

    function open_detail(scope: AdminScope) {
        set_detail(scope);
        set_edit_display(scope.display_name);
        set_edit_vis(scope.visibility as 'public' | 'private');
        set_confirm_delete(false);
        set_delete_text('');
        set_action_error('');
    }

    function close_detail() {
        set_detail(null);
        set_confirm_delete(false);
        set_delete_text('');
        set_action_error('');
    }

    function reset_create_form() {
        set_creating(false);
        set_new_slug('');
        set_new_display('');
        set_new_owner_username('');
        set_new_vis('public');
        set_new_type('user');
        set_new_org_slug('');
        set_owner_lookup_status('idle');
        set_owner_found_display('');
        set_org_lookup_status('idle');
        set_org_found_display('');
        set_field_errors({});
        set_touched({});
    }

    // ── Create ──

    async function handle_create() {
        set_action_error('');
        const is_org = new_type === 'org';
        const all_touched: Record<string, boolean> = { scope_slug: true, owner_username: true };
        if (is_org) all_touched.org_slug = true;
        set_touched((prev) => ({ ...prev, ...all_touched }));

        const errors: Record<string, string | null> = {
            scope_slug: validate_slug(new_slug),
            owner_username: validate_slug(new_owner_username),
        };
        if (is_org) errors.org_slug = validate_slug(new_org_slug);
        set_field_errors((prev) => ({ ...prev, ...errors }));

        if (Object.values(errors).some((e) => e !== null)) return;

        if (owner_lookup_status === 'checking' || (is_org && org_lookup_status === 'checking')) {
            set_action_error('Still verifying — please wait');
            return;
        }
        if (owner_lookup_status === 'not_found') {
            set_action_error(`User '${new_owner_username}' does not exist. Create the user first.`);
            return;
        }
        if (owner_lookup_status === 'idle') {
            set_action_error('Enter an owner username');
            return;
        }
        if (is_org && org_lookup_status === 'not_found') {
            set_action_error(`Org '${new_org_slug}' does not exist. Create the org first.`);
            return;
        }
        if (is_org && org_lookup_status === 'idle') {
            set_action_error('Enter an org slug');
            return;
        }

        const body: Record<string, unknown> = {
            slug: new_slug,
            display_name: new_display || undefined,
            owner_username: new_owner_username,
            visibility: new_vis,
            scope_type: new_type,
        };
        if (is_org) body.org_slug = new_org_slug;

        try {
            const res = await auth_fetch('/v1/scopes/new', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!data.ok) { set_action_error(data.error?.message || 'Failed'); return; }
            reset_create_form();
            load();
        } catch {
            set_action_error('Network error');
        }
    }

    // ── Update ──

    async function handle_update() {
        if (!detail) return;
        set_action_error('');
        try {
            const res = await auth_fetch('/v1/scopes/update', {
                method: 'POST',
                body: JSON.stringify({ scope_id: detail.id, visibility: edit_vis, display_name: edit_display }),
            });
            const data = await res.json();
            if (!data.ok) { set_action_error(data.error?.message || 'Failed'); return; }
            const updated = { ...detail, display_name: edit_display, visibility: edit_vis };
            set_detail(updated);
            load();
        } catch {
            set_action_error('Network error');
        }
    }

    // ── Delete ──

    async function handle_delete() {
        if (!detail || delete_text !== `@${detail.slug}`) return;
        set_action_error('');
        try {
            const res = await auth_fetch('/v1/scopes/delete', {
                method: 'POST',
                body: JSON.stringify({ scope_id: detail.id }),
            });
            const data = await res.json();
            if (!data.ok) { set_action_error(data.error?.message || 'Failed'); return; }
            close_detail();
            load();
        } catch {
            set_action_error('Network error');
        }
    }

    const total_pages = Math.ceil(total / LIMIT);
    const current_page = Math.floor(offset / LIMIT) + 1;

    return (
        <div>
        <Breadcrumbs items={[{ label: 'Admin', to: '/admin' }, { label: 'Scopes' }]} />
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Admin · Scopes</h1>
                    <p className="mt-1 mb-4 text-sm text-slate-500">All package scopes · {total} total</p>
                </div>
                <button onClick={() => { set_creating(true); set_action_error(''); set_field_errors({}); set_touched({}); }} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                    Create scope
                </button>
            </div>

            <form
                onSubmit={apply_filter}
                className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
            >
                <label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-600">
                    Filter
                    <input
                        name="query"
                        type="text"
                        placeholder="scope slug"
                        value={filter_draft}
                        onChange={(e) => set_filter_draft(e.target.value)}
                        aria-label="Filter scopes"
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    />
                </label>
                <button
                    type="submit"
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                    Apply
                </button>
                {active_query && (
                    <button
                        type="button"
                        onClick={() => { set_filter_draft(''); set_active_query(''); set_offset(0); }}
                        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                        Clear
                    </button>
                )}
            </form>

            {action_error && !creating && !detail && <p className="mb-3 text-xs text-red-500">{action_error}</p>}

            {creating && (
                <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
                    <p className="mb-1 text-sm font-semibold text-slate-800">New Scope</p>
                    <p className="mb-4 text-xs text-slate-500">Create a scope and assign it to a user as owner.</p>

                    <div className="mb-4 grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Slug</label>
                            <input
                                placeholder="e.g. acme-tools" value={new_slug}
                                onChange={(e) => {
                                    const v = e.target.value.toLowerCase();
                                    set_new_slug(v);
                                    if (touched.scope_slug) set_field_errors((prev) => ({ ...prev, scope_slug: validate_slug(v) }));
                                }}
                                onBlur={() => handle_field_blur('scope_slug', new_slug)}
                                className={input_class('scope_slug')}
                            />
                            {touched.scope_slug && field_errors.scope_slug && (
                                <p className="mt-1 text-xs text-red-500">{field_errors.scope_slug}</p>
                            )}
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Display Name</label>
                            <input
                                placeholder="Acme Tools" value={new_display}
                                onChange={(e) => set_new_display(e.target.value)}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Scope Type</label>
                            <select value={new_type} onChange={(e) => {
                                const val = e.target.value as 'user' | 'org';
                                set_new_type(val);
                                if (val === 'user') set_new_vis('public');
                            }} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                                <option value="user">User</option>
                                <option value="org">Org</option>
                            </select>
                        </div>
                        {new_type === 'org' ? (
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Visibility</label>
                                <select value={new_vis} onChange={(e) => set_new_vis(e.target.value as 'public' | 'private')} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                                    <option value="public">Public</option>
                                    <option value="private">Private</option>
                                </select>
                            </div>
                        ) : (
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Visibility</label>
                                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">Public (user scopes are always public)</p>
                            </div>
                        )}
                    </div>

                    {/* Org lookup — only when scope_type is org */}
                    {new_type === 'org' && (
                        <div className="mb-4 rounded-lg border border-slate-200 bg-white/60 p-3">
                            <p className="mb-2 text-xs font-semibold text-slate-700">Organization</p>
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Org Slug</label>
                                <input
                                    placeholder="e.g. acme" value={new_org_slug}
                                    onChange={(e) => handle_org_slug_change(e.target.value)}
                                    onBlur={() => handle_field_blur('org_slug', new_org_slug)}
                                    className={input_class('org_slug')}
                                />
                                {touched.org_slug && field_errors.org_slug && (
                                    <p className="mt-1 text-xs text-red-500">{field_errors.org_slug}</p>
                                )}
                                {org_lookup_status === 'checking' && (
                                    <p className="mt-1 text-xs text-slate-400">Checking...</p>
                                )}
                                {org_lookup_status === 'found' && (
                                    <p className="mt-1 text-xs text-emerald-600">
                                        Org found: <span className="font-semibold">@{new_org_slug}</span> &mdash; {org_found_display}
                                    </p>
                                )}
                                {org_lookup_status === 'not_found' && !field_errors.org_slug && (
                                    <p className="mt-1 text-xs text-red-500">
                                        No org with slug &ldquo;{new_org_slug}&rdquo; found. Create the org first.
                                    </p>
                                )}
                                {org_lookup_status === 'error' && (
                                    <p className="mt-1 text-xs text-red-500">Could not verify org. Try again.</p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Owner lookup */}
                    <div className="rounded-lg border border-slate-200 bg-white/60 p-3">
                        <p className="mb-2 text-xs font-semibold text-slate-700">Owner</p>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Username</label>
                            <input
                                placeholder="e.g. sapan" value={new_owner_username}
                                onChange={(e) => handle_owner_change(e.target.value)}
                                onBlur={() => handle_field_blur('owner_username', new_owner_username)}
                                className={input_class('owner_username')}
                            />
                            {touched.owner_username && field_errors.owner_username && (
                                <p className="mt-1 text-xs text-red-500">{field_errors.owner_username}</p>
                            )}
                            {owner_lookup_status === 'checking' && (
                                <p className="mt-1 text-xs text-slate-400">Checking...</p>
                            )}
                            {owner_lookup_status === 'found' && (
                                <p className="mt-1 text-xs text-emerald-600">
                                    User found: <span className="font-semibold">@{new_owner_username}</span> &mdash; {owner_found_display}
                                </p>
                            )}
                            {owner_lookup_status === 'not_found' && !field_errors.owner_username && (
                                <p className="mt-1 text-xs text-red-500">
                                    No user with username &ldquo;{new_owner_username}&rdquo; found. Create the user first.
                                </p>
                            )}
                            {owner_lookup_status === 'error' && (
                                <p className="mt-1 text-xs text-red-500">Could not verify username. Try again.</p>
                            )}
                        </div>
                    </div>

                    {action_error && !detail && <p className="mt-3 text-xs text-red-500">{action_error}</p>}
                    <div className="mt-3 flex gap-2">
                        <button onClick={handle_create} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Create</button>
                        <button onClick={() => { reset_create_form(); set_action_error(''); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                    </div>
                </div>
            )}

            {/* Detail panel */}
            {detail && (
                <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-bold text-slate-900">@{detail.slug}</p>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${detail.scope_type === 'org' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                                    {detail.scope_type}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${detail.visibility === 'public' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                    {detail.visibility}
                                </span>
                            </div>
                            <p className="mt-1 text-xs text-slate-700">
                                Owner: @{detail.owner_username} · {detail.team_count} team(s) · Created {new Date(detail.created_at).toLocaleDateString()}
                            </p>
                        </div>
                        <button onClick={close_detail} className="text-xs text-slate-500 hover:text-slate-700">✕</button>
                    </div>

                    <div className="mt-4 space-y-3">
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Display Name</label>
                            <input value={edit_display} onChange={(e) => set_edit_display(e.target.value)} className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none" />
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Visibility</label>
                            {detail.scope_type === 'org' ? (
                                <select value={edit_vis} onChange={(e) => set_edit_vis(e.target.value as 'public' | 'private')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
                                    <option value="public">Public</option>
                                    <option value="private">Private</option>
                                </select>
                            ) : (
                                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500">Public (user scopes are always public)</p>
                            )}
                        </div>
                        {action_error && <p className="text-xs text-red-500">{action_error}</p>}
                        <div className="flex gap-2 pt-1">
                            <button onClick={handle_update} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">Save</button>
                        </div>
                    </div>

                    <div className="mt-5 rounded-lg border border-red-200 bg-red-50/50 p-4">
                        {!confirm_delete ? (
                            <button
                                onClick={() => { set_confirm_delete(true); set_delete_text(''); }}
                                className="text-sm font-medium text-red-600 hover:text-red-800"
                            >
                                Delete this scope...
                            </button>
                        ) : (
                            <div>
                                <p className="text-sm font-medium text-red-800">Delete scope @{detail.slug}? This cannot be undone.</p>
                                <div className="mt-2">
                                    <label className="mb-1 block text-xs text-slate-600">
                                        Type <span className="font-mono font-semibold">@{detail.slug}</span> to confirm
                                    </label>
                                    <input
                                        type="text"
                                        value={delete_text}
                                        onChange={(e) => set_delete_text(e.target.value)}
                                        placeholder={`@${detail.slug}`}
                                        className="w-full max-w-sm rounded-lg border border-red-300 px-3 py-2 font-mono text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                                    />
                                </div>
                                {action_error && <p className="mt-2 text-xs text-red-500">{action_error}</p>}
                                <div className="mt-3 flex gap-2">
                                    <button
                                        onClick={handle_delete}
                                        disabled={delete_text !== `@${detail.slug}`}
                                        className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Delete
                                    </button>
                                    <button onClick={() => set_confirm_delete(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-600">
                        <tr>
                            <th className="px-4 py-3">Scope</th>
                            <th className="px-4 py-3">Owner</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Visibility</th>
                            <th className="px-4 py-3">Teams</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">Loading...</td></tr>}
                        {!loading && scopes.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-600">No scopes found</td></tr>}
                        {!loading && scopes.map((s) => (
                            <tr key={s.id} onClick={() => open_detail(s)} className="cursor-pointer hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <span className="font-medium text-slate-900">@{s.slug}</span>
                                    {s.display_name !== s.slug && <span className="ml-1 text-xs text-slate-600">({s.display_name})</span>}
                                </td>
                                <td className="px-4 py-3 text-slate-700">@{s.owner_username}</td>
                                <td className="px-4 py-3">
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.scope_type === 'org' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>
                                        {s.scope_type}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.visibility === 'public' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {s.visibility}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-slate-700">{s.team_count}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {total_pages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm">
                    <button onClick={() => set_offset(Math.max(0, offset - LIMIT))} disabled={offset === 0} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">← Prev</button>
                    <span className="text-xs text-slate-600">Page {current_page} of {total_pages}</span>
                    <button onClick={() => set_offset(offset + LIMIT)} disabled={current_page >= total_pages} className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next →</button>
                </div>
            )}
        </div>
    );
}
