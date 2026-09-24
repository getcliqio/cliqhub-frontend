import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router';
import { Map, Pencil, Check, X, Play, Users, Shield, Server, Sliders, Bell, Send, Settings } from 'lucide-react';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { Breadcrumbs, type BreadcrumbItem } from '@/components/ui/breadcrumbs';
import { REALM_PRIMARY_NAV } from '@/lib/realm_primary_nav';
import { realm_qualified_label } from '@/lib/realm_url';

const SECTION_LABELS: Record<string, string> = {
	runs: 'Runs',
	daemons: 'Daemons',
	teams: 'Teams',
	notifications: 'Notifications',
	agents: 'Agents',
	channels: 'Channels',
	settings: 'Settings',
	workspaces: 'Workspaces',
};

/** Realms → name → section → leaf from the current path. */
function build_realm_crumbs(base_path: string, display_name: string, pathname: string): BreadcrumbItem[] {
	const items: BreadcrumbItem[] = [
		{ label: 'Realms', to: '/realms' },
		{ label: display_name, to: base_path },
	];

	if (!pathname.startsWith(base_path)) return items;

	const rest = pathname.slice(base_path.length).replace(/^\//, '');
	if (!rest) return items;

	const parts = rest.split('/').filter(Boolean);
	const section = parts[0];

	if (section === 'settings') {
		items.push({ label: 'Settings', to: `${base_path}/settings/security/members` });
		if (parts.includes('members')) items.push({ label: 'Members' });
		if (parts.includes('tokens')) items.push({ label: 'Tokens' });
		if (parts.includes('bindings')) items.push({ label: 'Alerts' });
		if (parts.includes('a2a')) items.push({ label: 'A2A' });
		return items;
	}

	const section_label = SECTION_LABELS[section];
	if (!section_label) return items;

	if (parts.length === 1) {
		items.push({ label: section_label });
		return items;
	}

	items.push({ label: section_label, to: `${base_path}/${section}` });

	if (section === 'teams' && parts.length >= 3) {
		items.push({ label: `@${parts[1]}/${parts[2]}` });
		return items;
	}

	items.push({ label: decodeURIComponent(parts[1]) });
	return items;
}

export interface Realm_outlet_context {
    realm: {
        id: string;
        slug: string;
        name: string;
    };
    slug: string;
    org_slug: string;
    base_path: string;
}

interface Realm_pulse {
    online: number;
    total_daemons: number;
    active_runs: number;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
    if (typeof data.error === 'string') return data.error;
    return data.error?.message ?? 'Request failed';
}

const ICON_MAP: Record<string, typeof Play> = {
    Play,
    Users,
    Shield,
    Server,
    Sliders,
    Bell,
    Send,
    Settings,
};

/**
 * Compact realm layout: single-row header with icon nav, then child content.
 */
export function RealmLayout() {
    const { slug: slug_param = '', org: org_param = '' } = useParams();
    const slug = slug_param.trim();
    const org_slug = org_param.trim();
    const location = useLocation();
    const auth_fetch = useOrgFetch();
    const [realm, set_realm] = useState<Realm_outlet_context['realm'] | null>(null);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState<string | null>(null);

    const load = useCallback(async () => {
        if (!slug) {
            set_loading(false);
            set_error('No realm selected.');
            set_realm(null);
            return;
        }
        set_loading(true);
        try {
            const res = await auth_fetch('/v1/realms/get_by_id', {
                method: 'POST',
                body: JSON.stringify({ slug, org_slug: org_slug || undefined }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(api_error_message(data));
                set_realm(null);
                return;
            }
            const row = data.realm as { id: string; slug: string; name: string };
            set_realm({ id: row.id, slug: row.slug, name: row.name });
            set_error(null);
        } catch {
            set_error('Failed to load realm');
            set_realm(null);
        } finally {
            set_loading(false);
        }
    }, [auth_fetch, slug, org_slug]);

    useEffect(() => {
        void load();
    }, [load]);

    const base_path = `/o/${org_slug}/realms/${slug}`;
    const context = useMemo<Realm_outlet_context | null>(() => {
        if (!realm) return null;
        return { realm, slug, org_slug, base_path };
    }, [realm, slug, org_slug, base_path]);

    const [editing_name, set_editing_name] = useState(false);
    const [name_draft, set_name_draft] = useState('');
    const [pulse, set_pulse] = useState<Realm_pulse | null>(null);

    useEffect(() => {
        if (!realm) return;
        let cancelled = false;
        (async () => {
            try {
                const [d_res, r_res] = await Promise.all([
                    auth_fetch('/v1/daemons/get', {
                        method: 'POST',
                        body: JSON.stringify({ realm_id: realm.id, limit: 200, offset: 0 }),
                    }),
                    auth_fetch('/v1/runs/get', {
                        method: 'POST',
                        body: JSON.stringify({ realm_id: realm.id, state: 'running', limit: 1, offset: 0 }),
                    }),
                ]);
                if (cancelled) return;
                const d_data = await d_res.json();
                const r_data = await r_res.json();
                const daemons = (d_data.daemons ?? []) as Array<{ status: string }>;
                set_pulse({
                    online: daemons.filter((d) => d.status === 'online').length,
                    total_daemons: daemons.length,
                    active_runs: Number(r_data.total ?? 0),
                });
            } catch {
                /* pulse is optional — don't block on errors */
            }
        })();
        return () => { cancelled = true; };
    }, [auth_fetch, realm]);

    if (loading) {
        return (
            <div>
                <Breadcrumbs items={[{ label: 'Realms', to: '/realms' }, { label: '…' }]} />
                <p className="text-sm text-slate-400">Loading realm…</p>
            </div>
        );
    }

    if (!context) {
        return (
            <div>
                <Breadcrumbs items={[{ label: 'Realms', to: '/realms' }, { label: 'Not found' }]} />
                <ApiErrorBanner error={error} onDismiss={() => set_error(null)} />
                <p className="mt-4 text-sm text-slate-500">
                    <Link to="/realms" className="font-semibold text-indigo-600 hover:underline">← Back to realms</Link>
                </p>
            </div>
        );
    }

    const display_name = context.realm.name || context.realm.slug;
    const crumb_items = build_realm_crumbs(base_path, display_name, location.pathname);

    function start_edit() {
        set_name_draft(display_name);
        set_editing_name(true);
    }

    async function save_name() {
        if (!context) return;
        const trimmed = name_draft.trim();
        if (!trimmed || trimmed === display_name) {
            set_editing_name(false);
            return;
        }
        const res = await auth_fetch('/v1/realms/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ realm_id: context.realm.id, name: trimmed }),
        });
        if (res.ok) {
            set_realm({ ...context.realm, name: trimmed });
        }
        set_editing_name(false);
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <Breadcrumbs items={crumb_items} />

            {/* Realm identity row — matches PageHeader alignment (icon + title + slug) */}
            <div className="mb-4 flex flex-wrap items-start gap-3">
                <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white"
                    aria-hidden
                >
                    <Map className="h-[18px] w-[18px]" strokeWidth={2} />
                </span>

                <div className="min-w-0 flex-1">
                    {editing_name ? (
                        <div className="flex items-center gap-2">
                            <input
                                autoFocus
                                className="rounded-md border border-slate-300 px-2 py-1 text-[22px] font-semibold leading-none tracking-tight text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                                value={name_draft}
                                onChange={(e) => set_name_draft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') void save_name();
                                    if (e.key === 'Escape') set_editing_name(false);
                                }}
                            />
                            <button
                                onClick={() => void save_name()}
                                className="rounded p-1 text-slate-600 hover:bg-slate-100"
                                title="Save"
                            >
                                <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={() => set_editing_name(false)}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100"
                                title="Cancel"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={start_edit}
                            className="group flex items-center gap-1.5"
                            title="Rename realm"
                        >
                            <h1 className="text-xl font-semibold leading-none tracking-tight text-slate-900 sm:text-[22px]">
                                {display_name}
                            </h1>
                            <Pencil className="h-3 w-3 text-slate-300 opacity-0 transition group-hover:opacity-100" />
                        </button>
                    )}
                    <p
                        className="mt-1.5 font-mono text-xs text-slate-500"
                        title={context.realm.id}
                    >
                        {realm_qualified_label(org_slug, context.realm.slug)}
                    </p>
                </div>

                {pulse ? (
                    <div className="ml-auto hidden items-center gap-2 pt-1 sm:flex">
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            {pulse.online}/{pulse.total_daemons} online
                        </span>
                        {pulse.active_runs > 0 ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                {pulse.active_runs} running
                            </span>
                        ) : null}
                    </div>
                ) : null}
            </div>

            {/* Primary tabs: Runs / Teams / Security / Daemons */}
            <nav
                aria-label="Realm sections"
                className="mb-4 flex items-center gap-1 border-b border-slate-200"
            >
                {REALM_PRIMARY_NAV.map((item) => {
                    const Icon = ICON_MAP[item.icon] ?? Play;
                    return (
                        <NavLink
                            key={item.label}
                            to={`${base_path}/${item.to}`}
                            end={item.end}
                            title={item.label}
                            className={({ isActive }) =>
                                `-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                                    isActive
                                        ? 'border-indigo-600 font-semibold text-indigo-700'
                                        : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                                }`
                            }
                        >
                            <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                            <span>{item.label}</span>
                        </NavLink>
                    );
                })}
            </nav>

            <div className="flex min-h-0 flex-1 flex-col">
                <Outlet context={context} />
            </div>
        </div>
    );
}
