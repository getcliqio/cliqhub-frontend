import { useState, useEffect, useCallback, useMemo } from 'react';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import {
    destination_type_meta,
    destination_fields,
    USER_DESTINATION_TYPES,
    type DestinationType,
    type DestinationTypeMeta,
} from '@/lib/channel_providers';
import {
    ChevronDown,
    ChevronRight,
    Plus,
    Trash2,
    X,
    Zap,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelRow {
    id: string;
    name: string;
    destinations: string;
    /** Set for personal channels — owning user ID. */
    user_id?: string | null;
    enabled: number;
    rule_count?: number;
}

interface Destination {
    type: string;
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse_destinations(raw: string | undefined): Destination[] {
    if (!raw) return [];
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr as Destination[];
    } catch {
        return [];
    }
}

function api_error_message(data: { error?: string | { message?: string } }): string {
    if (typeof data.error === 'string') return data.error;
    return data.error?.message ?? 'Request failed';
}

/** Shorten a URL for display — show host + truncated path. */
function shorten_url(url: string, max_len = 40): string {
    try {
        const u = new URL(url);
        const short = u.host + u.pathname;
        if (short.length <= max_len) return short;
        return short.slice(0, max_len - 1) + '…';
    } catch {
        if (url.length <= max_len) return url;
        return url.slice(0, max_len - 1) + '…';
    }
}

/** Extract a human-readable detail string for a destination row. */
function destination_detail_summary(dest: Destination): string | null {
    switch (dest.type) {
        case 'email': {
            const addr = typeof dest.address === 'string' ? dest.address : null;
            if (addr) return addr;
            return null;
        }
        case 'slack': {
            const url = typeof dest.webhook_url === 'string' ? dest.webhook_url : null;
            const channel = typeof dest.channel === 'string' ? dest.channel : null;
            if (channel) return channel;
            if (url) return shorten_url(url);
            return null;
        }
        case 'webhook':
        case 'http': {
            const url = typeof dest.url === 'string' ? dest.url
                : typeof dest.webhook_url === 'string' ? dest.webhook_url
                : null;
            if (url) return shorten_url(url);
            return null;
        }
        case 'jira': {
            const project = typeof dest.project_key === 'string' ? dest.project_key : null;
            const site = typeof dest.site === 'string' ? dest.site : null;
            if (project && site) return `${site} / ${project}`;
            if (project) return project;
            if (site) return site;
            return null;
        }
        case 'channel_ref': {
            const name = typeof dest.name === 'string' ? dest.name : null;
            if (name) return `→ ${name}`;
            return null;
        }
        case 'cliqhub':
            return 'Notification inbox';
        default:
            return null;
    }
}

/** Summarize a destination list for the table row. */
function destinations_summary(dests: Destination[]): { icon: React.ComponentType<{ className?: string }>; label: string }[] {
    return dests.map((d) => {
        const meta = destination_type_meta(d.type);
        if (d.type === 'channel_ref') {
            return { icon: meta.icon, label: `→ ${String(d.name ?? '')}` };
        }
        return { icon: meta.icon, label: meta.label };
    });
}

/** Build an empty destination object for a type. */
function empty_destination(type: DestinationType): Destination {
    const fields = destination_fields(type);
    const dest: Destination = { type };
    for (const f of fields) {
        if (f.type === 'key_value') {
            dest[f.key] = {};
        } else if (f.type === 'select') {
            dest[f.key] = f.options?.[0] ?? '';
        } else {
            dest[f.key] = '';
        }
    }
    return dest;
}

// ---------------------------------------------------------------------------
// Main export — tabs shell
// ---------------------------------------------------------------------------

/** @deprecated Use Channels_tab / Rules_tab directly — kept for legacy re-exports. */
export function Component() {
    return <Channels_tab />;
}

// ---------------------------------------------------------------------------
// Event groups for the rules UI (system events only at global tier)
// ---------------------------------------------------------------------------

interface EventLeaf { value: string; label: string }
interface EventGroup { value: string; label: string; children: EventLeaf[] }

const RULE_EVENT_GROUPS: EventGroup[] = [
    {
        value: 'run.*', label: 'Runs',
        children: [
            { value: 'run.started', label: 'Run started' },
            { value: 'run.resumed', label: 'Run resumed' },
            { value: 'run.completed', label: 'Run completed' },
            { value: 'run.failed', label: 'Run failed' },
            { value: 'run.crashed', label: 'Run crashed' },
            { value: 'run.cancelled', label: 'Run cancelled' },
        ],
    },
    {
        value: 'phase.*', label: 'Phases',
        children: [
            { value: 'phase.started', label: 'Phase started' },
            { value: 'phase.completed', label: 'Phase completed' },
            { value: 'phase.failed', label: 'Phase failed' },
            { value: 'phase.skipped', label: 'Phase skipped' },
            { value: 'phase.escalated', label: 'Phase escalated' },
            { value: 'phase.input_required', label: 'Input required' },
            { value: 'phase.inputs_supplied', label: 'Inputs supplied' },
            { value: 'phase.timed_out', label: 'Phase timed out' },
            { value: 'phase.idle', label: 'Phase idle' },
        ],
    },
    {
        value: 'hug.*', label: 'HUG Reviews',
        children: [
            { value: 'hug.review_requested', label: 'Review requested' },
            { value: 'hug.review_reminded', label: 'Review reminded' },
            { value: 'hug.review_responded', label: 'Review responded' },
            { value: 'hug.routing_requested', label: 'Routing requested' },
            { value: 'hug.review_expired', label: 'Review expired' },
        ],
    },
    {
        value: 'daemon.*', label: 'Daemons',
        children: [
            { value: 'daemon.enrolled', label: 'Daemon enrolled' },
            { value: 'daemon.removed', label: 'Daemon removed' },
            { value: 'daemon.online', label: 'Daemon online' },
            { value: 'daemon.offline', label: 'Daemon offline' },
        ],
    },
    {
        value: 'realm.*', label: 'Realm',
        children: [
            { value: 'realm.created', label: 'Realm created' },
            { value: 'realm.deleted', label: 'Realm deleted' },
            { value: 'realm.member_added', label: 'Member added' },
            { value: 'realm.member_removed', label: 'Member removed' },
            { value: 'realm.member_role_changed', label: 'Member role changed' },
            { value: 'realm.token_created', label: 'Token created' },
            { value: 'realm.token_revoked', label: 'Token revoked' },
            { value: 'realm.key_rotated', label: 'Key rotated' },
        ],
    },
    {
        value: 'team.*', label: 'Teams',
        children: [
            { value: 'team.published', label: 'Team published' },
            { value: 'team.visibility_changed', label: 'Visibility changed' },
        ],
    },
    {
        value: 'auth.*', label: 'Auth',
        children: [
            { value: 'auth.api_key_created', label: 'API key created' },
            { value: 'auth.api_key_revoked', label: 'API key revoked' },
        ],
    },
    {
        value: 'notification.*', label: 'Notifications',
        children: [
            { value: 'notification.test', label: 'Test' },
            { value: 'notification.failed', label: 'Delivery failed' },
        ],
    },
    {
        value: 'custom.*', label: 'All custom events',
        children: [],
    },
];

// ---------------------------------------------------------------------------
// Rules tab
// ---------------------------------------------------------------------------

interface RuleRow {
    id: number;
    realm_id: string | null;
    team_slug: string | null;
    event: string;
    channel_id: string;
}

interface CustomEventRow {
    id: number;
    event_type: string;
    source: string;
    realm_id: string | null;
    team_slug: string | null;
    label: string | null;
}

export function Rules_tab({ realm_id, team_slug }: { realm_id?: string; team_slug?: string } = {}) {
    const auth_fetch = useOrgFetch();

    const [error, set_error] = useState<string | null>(null);
    const [loading, set_loading] = useState(true);
    const [channels, set_channels] = useState<ChannelRow[]>([]);
    const [rules, set_rules] = useState<RuleRow[]>([]);
    const [custom_events, set_custom_events] = useState<CustomEventRow[]>([]);
    const [saving, set_saving] = useState(false);
    const [creating_event, set_creating_event] = useState(false);
    const [new_event_name, set_new_event_name] = useState('');
    const [new_event_label, set_new_event_label] = useState('');
    const [create_event_busy, set_create_event_busy] = useState(false);
    const [filter, set_filter] = useState('');

    const load = useCallback(async () => {
        set_loading(true);
        try {
            const rules_path = realm_id
                ? '/v1/realms/get_notification_rules'
                : '/v1/orgs/get_notification_rules';
            const fetches: Promise<Response>[] = [
                auth_fetch('/v1/notification_channels/get', {
                    method: 'POST',
                    body: JSON.stringify(realm_id ? { realm_id } : { account: true }),
                }),
                auth_fetch(rules_path, {
                    method: 'POST',
                    body: JSON.stringify({
                        ...(realm_id ? { realm_id } : {}),
                        ...(team_slug ? { team_slug } : {}),
                    }),
                }),
            ];

            if (realm_id) {
                fetches.push(
                    auth_fetch('/v1/events/custom/list', {
                        method: 'POST',
                        body: JSON.stringify({ realm_id }),
                    }),
                );
            }

            const responses = await Promise.all(fetches);
            const ch_data = await responses[0].json();
            const rules_data = await responses[1].json();

            if (!ch_data.ok) { set_error(api_error_message(ch_data)); return; }
            if (!rules_data.ok) { set_error(api_error_message(rules_data)); return; }

            set_channels((ch_data.channels ?? []) as ChannelRow[]);
            set_rules((rules_data.rules ?? []) as RuleRow[]);

            if (realm_id && responses[2]) {
                const custom_data = await responses[2].json();
                if (custom_data.ok) {
                    set_custom_events((custom_data.events ?? []) as CustomEventRow[]);
                }
            }

            set_error(null);
        } catch {
            set_error('Failed to load rules');
        } finally {
            set_loading(false);
        }
    }, [auth_fetch, realm_id, team_slug]);

    useEffect(() => { void load(); }, [load]);

    /** Merge system event groups with custom events for realm views. */
    const event_groups: EventGroup[] = useMemo(() => {
        if (!realm_id || custom_events.length === 0) return RULE_EVENT_GROUPS;

        const custom_by_family = new Map<string, EventLeaf[]>();
        for (const ce of custom_events) {
            const parts = ce.event_type.split('.');
            const family = parts.length >= 3 ? `custom.${parts[1]}` : 'custom';
            const leaves = custom_by_family.get(family) ?? [];
            leaves.push({
                value: ce.event_type,
                label: ce.label || ce.event_type.split('.').slice(1).join('.'),
            });
            custom_by_family.set(family, leaves);
        }

        const custom_groups: EventGroup[] = [];
        for (const [family, leaves] of custom_by_family) {
            custom_groups.push({
                value: `${family}.*`,
                label: family === 'custom' ? 'Custom events' : family,
                children: leaves,
            });
        }

        const base = RULE_EVENT_GROUPS.filter((g) => g.value !== 'custom.*');
        return [...base, ...custom_groups];
    }, [realm_id, custom_events]);

    const channel_map = new Map(channels.map((c) => [c.id, c]));

    function rules_for_event(event: string): RuleRow[] {
        return rules.filter((r) => r.event === event);
    }

    function channel_name(id: string): string {
        return channel_map.get(id)?.name ?? id.slice(0, 8);
    }

    /** Channels not yet assigned to this event (or its parent wildcard). */
    function available_channels_for(event: string, parent_event?: string): ChannelRow[] {
        const assigned = new Set(rules_for_event(event).map((r) => r.channel_id));
        if (parent_event) {
            for (const r of rules_for_event(parent_event)) assigned.add(r.channel_id);
        }
        return channels.filter((c) => !assigned.has(c.id));
    }

    async function add_rule(event: string, channel_id: string) {
        set_saving(true);
        set_error(null);
        try {
            const rules_set_path = realm_id
                ? '/v1/realms/set_notification_rule'
                : '/v1/orgs/set_notification_rule';
            const res = await auth_fetch(rules_set_path, {
                method: 'POST',
                body: JSON.stringify({
                    event,
                    channel_id,
                    ...(realm_id ? { realm_id } : {}),
                    ...(team_slug ? { team_slug } : {}),
                }),
            });
            const data = await res.json();
            if (!data.ok) { set_error(api_error_message(data)); return; }
            set_rules((prev) => [...prev, data.rule as RuleRow]);
        } catch {
            set_error('Failed to add rule');
        } finally {
            set_saving(false);
        }
    }

    async function remove_rule(rule_id: number) {
        set_saving(true);
        set_error(null);
        try {
            const rules_remove_path = realm_id
                ? '/v1/realms/remove_notification_rule'
                : '/v1/orgs/remove_notification_rule';
            const res = await auth_fetch(rules_remove_path, {
                method: 'POST',
                body: JSON.stringify({ id: rule_id }),
            });
            const data = await res.json();
            if (!data.ok) { set_error(api_error_message(data)); return; }
            set_rules((prev) => prev.filter((r) => r.id !== rule_id));
        } catch {
            set_error('Failed to remove rule');
        } finally {
            set_saving(false);
        }
    }



    if (loading) {
        return <p className="text-sm text-slate-400">Loading…</p>;
    }

    if (channels.length === 0) {
        return (
            <div className="rounded-xl border-2 border-dashed border-slate-200 py-10 text-center dark:border-slate-800">
                <p className="text-slate-400 dark:text-slate-500">
                    Create a channel first under Settings → Notifications.
                </p>
            </div>
        );
    }

    async function handle_create_event() {
        const event_type = new_event_name.trim().startsWith('custom.')
            ? new_event_name.trim()
            : `custom.${new_event_name.trim()}`;
        if (!event_type || event_type === 'custom.') return;

        set_create_event_busy(true);
        set_error(null);
        try {
            const res = await auth_fetch('/v1/events/custom/create', {
                method: 'POST',
                body: JSON.stringify({
                    event_type,
                    realm_id,
                    ...(new_event_label.trim() ? { label: new_event_label.trim() } : {}),
                }),
            });
            const data = await res.json();
            if (!data.ok) { set_error(api_error_message(data)); return; }
            set_creating_event(false);
            set_new_event_name('');
            set_new_event_label('');
            await load();
        } catch {
            set_error('Failed to create custom event');
        } finally {
            set_create_event_busy(false);
        }
    }

    async function handle_remove_event(ce: CustomEventRow) {
        if (!window.confirm(`Remove custom event "${ce.event_type}"? Any rules mapping to it will stop working.`)) return;
        set_error(null);
        try {
            const res = await auth_fetch('/v1/events/custom/remove', {
                method: 'POST',
                body: JSON.stringify({ id: ce.id }),
            });
            const data = await res.json();
            if (!data.ok) { set_error(api_error_message(data)); return; }
            await load();
        } catch {
            set_error('Failed to remove custom event');
        }
    }

    return (
        <div>
            <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Notifications</h2>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Bind channels to events. Multiple channels per event are fine — add them as pills.
                        {team_slug
                            ? ' These rules override realm defaults for this team.'
                            : realm_id
                                ? ' These rules apply to this realm only.'
                                : ' These are global defaults. Realms can override per-realm.'}
                    </p>
                </div>
                {realm_id ? (
                    <button
                        type="button"
                        onClick={() => { set_creating_event(true); set_new_event_name(''); set_new_event_label(''); }}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                        <Plus className="h-4 w-4" />
                        Custom Event
                    </button>
                ) : null}
            </div>

            <ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

            {creating_event ? (
                <div className="mb-4 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">New custom event</p>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">custom.</span>
                        <input
                            value={new_event_name}
                            onChange={(e) => set_new_event_name(e.target.value.replace(/\s/g, ''))}
                            placeholder="family.event_name"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') void handle_create_event();
                                if (e.key === 'Escape') set_creating_event(false);
                            }}
                            className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        />
                    </div>
                    <input
                        value={new_event_label}
                        onChange={(e) => set_new_event_label(e.target.value)}
                        placeholder="Optional display label"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void handle_create_event();
                            if (e.key === 'Escape') set_creating_event(false);
                        }}
                        className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handle_create_event()}
                            disabled={create_event_busy || !new_event_name.trim()}
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {create_event_busy ? 'Creating…' : 'Create'}
                        </button>
                        <button
                            type="button"
                            onClick={() => set_creating_event(false)}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : null}

            <div className="mb-3">
                <input
                    value={filter}
                    onChange={(e) => set_filter(e.target.value)}
                    placeholder="Filter events…"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                {event_groups.map((group) => {
                    const wildcard_rules = rules_for_event(group.value);
                    const q = filter.trim().toLowerCase();
                    const visible_children = group.children.filter((leaf) => {
                        if (!q) return true;
                        return (
                            leaf.label.toLowerCase().includes(q)
                            || leaf.value.toLowerCase().includes(q)
                            || group.label.toLowerCase().includes(q)
                            || group.value.toLowerCase().includes(q)
                        );
                    });
                    const group_matches = !q
                        || group.label.toLowerCase().includes(q)
                        || group.value.toLowerCase().includes(q);
                    const show_wildcard = !q || group_matches;
                    const leaves_to_show = group_matches ? group.children : visible_children;
                    if (!show_wildcard && leaves_to_show.length === 0) return null;

                    return (
                        <div key={group.value} className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
                            <div className="bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                                {group.label}
                            </div>

                            {/* Wildcard row */}
                            {show_wildcard ? (
                                <div className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50/80 dark:hover:bg-slate-900/40">
                                    <span className="w-56 shrink-0 text-xs font-semibold text-slate-700 dark:text-slate-200">
                                        All {group.label.toLowerCase()}
                                        <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">({group.value})</span>
                                    </span>
                                    <div className="flex flex-1 flex-wrap items-center gap-1">
                                        {wildcard_rules.map((r) => (
                                            <button
                                                key={r.id}
                                                type="button"
                                                disabled={saving}
                                                onClick={() => void remove_rule(r.id)}
                                                className="inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-200 disabled:opacity-50 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                                            >
                                                {channel_name(r.channel_id)}
                                                <X className="h-2.5 w-2.5" />
                                            </button>
                                        ))}
                                        <Channel_add_dropdown
                                            available={available_channels_for(group.value)}
                                            disabled={saving}
                                            on_select={(ch_id) => void add_rule(group.value, ch_id)}
                                        />
                                    </div>
                                </div>
                            ) : null}

                            {leaves_to_show.map((leaf) => {
                                const leaf_rules = rules_for_event(leaf.value);
                                return (
                                    <div
                                        key={leaf.value}
                                        className="flex items-center gap-2 border-t border-slate-100 px-3 py-1.5 hover:bg-slate-50/60 dark:border-slate-800/80 dark:hover:bg-slate-900/20"
                                    >
                                        <span className="w-56 shrink-0 text-xs text-slate-600 dark:text-slate-400">
                                            {leaf.label}
                                            <span className="ml-1 text-slate-400 dark:text-slate-500">({leaf.value})</span>
                                        </span>
                                        <div className="flex flex-1 flex-wrap items-center gap-1">
                                            {wildcard_rules
                                                .filter((r) => !leaf_rules.some((lr) => lr.channel_id === r.channel_id))
                                                .map((r) => (
                                                    <span
                                                        key={`inherited-${r.id}`}
                                                        className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                                                        title={`Inherited from ${group.value}`}
                                                    >
                                                        {channel_name(r.channel_id)}
                                                    </span>
                                                ))}
                                            {leaf_rules.map((r) => (
                                                <button
                                                    key={r.id}
                                                    type="button"
                                                    disabled={saving}
                                                    onClick={() => void remove_rule(r.id)}
                                                    className="inline-flex items-center gap-0.5 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-200 disabled:opacity-50 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                                                >
                                                    {channel_name(r.channel_id)}
                                                    <X className="h-2.5 w-2.5" />
                                                </button>
                                            ))}
                                            <Channel_add_dropdown
                                                available={available_channels_for(leaf.value, group.value)}
                                                disabled={saving}
                                                on_select={(ch_id) => void add_rule(leaf.value, ch_id)}
                                            />
                                        </div>
                                        {leaf.value.startsWith('custom.') ? (() => {
                                            const ce = custom_events.find((e) => e.event_type === leaf.value);
                                            if (!ce) return null;
                                            return (
                                                <button
                                                    type="button"
                                                    onClick={() => void handle_remove_event(ce)}
                                                    className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                                                    title="Remove custom event"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            );
                                        })() : null}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}


// ---------------------------------------------------------------------------
// Inline channel add dropdown
// ---------------------------------------------------------------------------

function Channel_add_dropdown({
    available,
    disabled,
    on_select,
}: {
    available: ChannelRow[];
    disabled: boolean;
    on_select: (channel_id: string) => void;
}) {
    const [open, set_open] = useState(false);

    if (available.length === 0) return null;

    if (!open) {
        return (
            <button
                type="button"
                disabled={disabled}
                onClick={() => set_open(true)}
                className="inline-flex items-center gap-0.5 rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50 dark:border-slate-600 dark:hover:border-indigo-600 dark:hover:text-indigo-400"
            >
                <Plus className="h-2.5 w-2.5" />
            </button>
        );
    }

    return (
        <select
            autoFocus
            className="rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-700 outline-none dark:border-indigo-700 dark:bg-slate-800 dark:text-slate-200"
            value=""
            onChange={(e) => {
                if (e.target.value) on_select(e.target.value);
                set_open(false);
            }}
            onBlur={() => set_open(false)}
        >
            <option value="">Select channel…</option>
            {available.map((ch) => (
                <option key={ch.id} value={ch.id}>{ch.name}</option>
            ))}
        </select>
    );
}

// ---------------------------------------------------------------------------
// Channels tab
// ---------------------------------------------------------------------------

export function Channels_tab({ realm_id }: { realm_id?: string } = {}) {
    const auth_fetch = useOrgFetch();

    const [error, set_error] = useState<string | null>(null);
    const [loading, set_loading] = useState(true);
    const [channels, set_channels] = useState<ChannelRow[]>([]);
    const [expanded_id, set_expanded_id] = useState<string | null>(null);
    const [creating, set_creating] = useState(false);
    const [create_name, set_create_name] = useState('');
    const [create_type, set_create_type] = useState<DestinationType>('slack');
    const [create_dest, set_create_dest] = useState<Destination>(() => empty_destination('slack'));
    const [create_busy, set_create_busy] = useState(false);
    const [testing_id, set_testing_id] = useState<string | null>(null);
    const [test_result, set_test_result] = useState<{ channel_id: string; ok: boolean; message: string } | null>(null);

    const load = useCallback(async () => {
        set_loading(true);
        try {
            const res = await auth_fetch('/v1/notification_channels/get', {
                method: 'POST',
                body: JSON.stringify(realm_id ? { realm_id } : { account: true }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(api_error_message(data));
                return;
            }
            set_channels((data.channels ?? []) as ChannelRow[]);
            set_error(null);
        } catch {
            set_error('Failed to load channels');
        } finally {
            set_loading(false);
        }
    }, [auth_fetch, realm_id]);

    useEffect(() => {
        void load();
    }, [load]);

    function reset_create_form() {
        set_creating(false);
        set_create_name('');
        set_create_type('slack');
        set_create_dest(empty_destination('slack'));
    }

    function switch_create_type(type: DestinationType) {
        set_create_type(type);
        set_create_dest(empty_destination(type));
    }

    async function handle_create() {
        const name = create_name.trim();
        if (!name) return;

        set_create_busy(true);
        set_error(null);
        try {
            const res = await auth_fetch('/v1/notification_channels/create', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    destinations: [create_dest],
                    ...(realm_id ? { realm_id } : {}),
                }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(api_error_message(data));
                return;
            }
            reset_create_form();
            await load();
        } catch {
            set_error('Failed to create channel');
        } finally {
            set_create_busy(false);
        }
    }

    async function handle_delete(ch: ChannelRow) {
        const rule_count = ch.rule_count ?? 0;
        if (rule_count > 0) {
            const confirmed = window.confirm(
                `"${ch.name}" has ${rule_count} rule${rule_count === 1 ? '' : 's'} pointing to it. Those rules will stop working. Delete anyway?`,
            );
            if (!confirmed) return;
        }

        set_error(null);
        try {
            const res = await auth_fetch('/v1/notification_channels/remove', {
                method: 'POST',
                body: JSON.stringify({ id: ch.id }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(api_error_message(data));
                return;
            }
            if (expanded_id === ch.id) set_expanded_id(null);
            await load();
        } catch {
            set_error('Failed to remove channel');
        }
    }

    async function handle_test(ch: ChannelRow) {
        set_testing_id(ch.id);
        set_test_result(null);
        try {
            const res = await auth_fetch('/v1/notification_channels/test', {
                method: 'POST',
                body: JSON.stringify({ id: ch.id }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_test_result({ channel_id: ch.id, ok: false, message: api_error_message(data) });
                return;
            }
            const delivered = (data.delivered ?? 0) as number;
            const errors = (data.errors ?? []) as string[];
            if (errors.length > 0) {
                set_test_result({ channel_id: ch.id, ok: false, message: errors.join('; ') });
                return;
            }
            set_test_result({
                channel_id: ch.id,
                ok: true,
                message: `Test delivered to ${delivered} destination${delivered === 1 ? '' : 's'}`,
            });
        } catch {
            set_test_result({ channel_id: ch.id, ok: false, message: 'Test request failed' });
        } finally {
            set_testing_id(null);
        }
    }

    function toggle_expand(id: string) {
        set_expanded_id((prev) => (prev === id ? null : id));
        set_test_result(null);
    }

    const channel_names = channels.map((c) => c.name);

    return (
        <div>
            <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Channels</h2>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        Named delivery targets — Slack, email, webhooks, and more.
                        Map events to channels under the Rules tab.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => { reset_create_form(); set_creating(true); }}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                    <Plus className="h-4 w-4" />
                    Channel
                </button>
            </div>

            <ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

            {creating ? (
                <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center gap-3">
                        <label className="block flex-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                            Channel name
                            <input
                                value={create_name}
                                onChange={(e) => set_create_name(e.target.value)}
                                placeholder="e.g. ops-alerts"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Escape') reset_create_form(); }}
                                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            />
                        </label>
                        <label className="block w-48 shrink-0 text-xs font-medium text-slate-600 dark:text-slate-300">
                            Destination
                            <select
                                value={create_type}
                                onChange={(e) => switch_create_type(e.target.value as DestinationType)}
                                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            >
                                {USER_DESTINATION_TYPES.map((m: DestinationTypeMeta) => (
                                    <option key={m.id} value={m.id}>{m.label}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <Destination_fields
                        dest={create_dest}
                        channel_names={channels.map(c => c.name)}
                        on_change={set_create_dest}
                    />

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => void handle_create()}
                            disabled={create_busy || !create_name.trim()}
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {create_busy ? 'Creating…' : 'Create'}
                        </button>
                        <button
                            type="button"
                            onClick={reset_create_form}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : null}

            {loading ? (
                <p className="text-sm text-slate-400">Loading…</p>
            ) : channels.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-slate-200 py-10 text-center dark:border-slate-800">
                    <p className="text-slate-400 dark:text-slate-500">
                        No channels yet. Add a channel to start routing notifications.
                    </p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                                <th className="px-3 py-2 font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Name
                                </th>
                                <th className="px-3 py-2 font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                    Destinations
                                </th>
                                <th className="w-24 px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {channels.map((ch) => {
                                const dests = parse_destinations(ch.destinations);
                                const summaries = destinations_summary(dests);
                                const is_expanded = expanded_id === ch.id;
                                return (
                                    <Channel_row
                                        key={ch.id}
                                        channel={ch}
                                        dests={dests}
                                        summaries={summaries}
                                        is_expanded={is_expanded}
                                        testing={testing_id === ch.id}
                                        test_result={test_result?.channel_id === ch.id ? test_result : null}
                                        channel_names={channel_names}
                                        on_toggle_expand={() => toggle_expand(ch.id)}
                                        on_test={() => void handle_test(ch)}
                                        on_delete={() => void handle_delete(ch)}
                                        on_saved={() => void load()}
                                        auth_fetch={auth_fetch}
                                    />
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Channel row + inline editor
// ---------------------------------------------------------------------------

interface ChannelRowProps {
    channel: ChannelRow;
    dests: Destination[];
    summaries: { icon: React.ComponentType<{ className?: string }>; label: string }[];
    is_expanded: boolean;
    testing: boolean;
    test_result: { ok: boolean; message: string } | null;
    channel_names: string[];
    on_toggle_expand: () => void;
    on_test: () => void;
    on_delete: () => void;
    on_saved: () => void;
    auth_fetch: ReturnType<typeof useOrgFetch>;
}

function Channel_row({
    channel,
    dests,
    summaries,
    is_expanded,
    testing,
    test_result,
    channel_names,
    on_toggle_expand,
    on_test,
    on_delete,
    on_saved,
    auth_fetch,
}: ChannelRowProps) {
    const is_personal = channel.user_id != null;

    return (
        <>
            <tr
                className={`cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-900/40 ${is_expanded ? 'bg-slate-50/80 dark:bg-slate-900/40' : ''}`}
                onClick={on_toggle_expand}
            >
                <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                        {is_expanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                            : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                        <span className="font-semibold text-indigo-700 dark:text-indigo-300">{channel.name}</span>
                        {is_personal ? (
                            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                                Personal
                            </span>
                        ) : null}
                    </div>
                </td>
                <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {summaries.length === 0 ? (
                            <span className="text-slate-400 dark:text-slate-500">No destinations</span>
                        ) : (
                            summaries.map((s, i) => {
                                const Icon = s.icon;
                                return (
                                    <span
                                        key={i}
                                        className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                    >
                                        <Icon className="h-3 w-3" />
                                        {s.label}
                                    </span>
                                );
                            })
                        )}
                    </div>
                </td>
                <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            onClick={on_test}
                            disabled={testing}
                            className="rounded p-1 text-slate-400 hover:bg-yellow-50 hover:text-yellow-600 disabled:opacity-50 dark:hover:bg-yellow-900/30"
                        >
                            <span title="Test channel"><Zap className="h-3.5 w-3.5" /></span>
                        </button>
                        <button
                            type="button"
                            onClick={on_delete}
                            disabled={is_personal}
                            className={`rounded p-1 ${is_personal ? 'cursor-not-allowed text-slate-200 dark:text-slate-700' : 'text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30'}`}
                        >
                            <span title={is_personal ? 'Personal channels cannot be deleted' : 'Delete channel'}><Trash2 className="h-3.5 w-3.5" /></span>
                        </button>
                    </div>
                </td>
            </tr>

            {test_result ? (
                <tr>
                    <td colSpan={4} className="border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                        <p className={`font-medium ${test_result.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {test_result.message}
                        </p>
                    </td>
                </tr>
            ) : null}

            {is_expanded ? (
                <tr>
                    <td colSpan={4} className="border-t border-slate-200 bg-slate-50 px-3 py-4 dark:border-slate-800 dark:bg-slate-900/60">
                        <Destination_editor
                            channel={channel}
                            initial_destinations={dests}
                            channel_names={channel_names.filter((n) => n !== channel.name)}
                            auth_fetch={auth_fetch}
                            on_saved={on_saved}
                        />
                    </td>
                </tr>
            ) : null}
        </>
    );
}

// ---------------------------------------------------------------------------
// Destination fields — reusable config fields for a single destination
// ---------------------------------------------------------------------------

function Destination_fields({
    dest,
    channel_names,
    on_change,
}: {
    dest: Destination;
    channel_names: string[];
    on_change: (updated: Destination) => void;
}) {
    const fields = destination_fields(dest.type as DestinationType);
    if (fields.length === 0) return null;

    return (
        <div className="space-y-2">
            {fields.map((field) => {
                if (field.type === 'key_value') {
                    return (
                        <Key_value_editor
                            key={field.key}
                            label={field.label}
                            value={(dest[field.key] as Record<string, string>) ?? {}}
                            on_change={(v) => on_change({ ...dest, [field.key]: v })}
                        />
                    );
                }

                if (field.type === 'select') {
                    return (
                        <label key={field.key} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                            {field.label}
                            <select
                                value={String(dest[field.key] ?? field.options?.[0] ?? '')}
                                onChange={(e) => on_change({ ...dest, [field.key]: e.target.value })}
                                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            >
                                {(field.options ?? []).map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        </label>
                    );
                }

                if (dest.type === 'channel_ref' && field.key === 'name') {
                    return (
                        <label key={field.key} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                            {field.label}
                            <select
                                value={String(dest[field.key] ?? '')}
                                onChange={(e) => on_change({ ...dest, [field.key]: e.target.value })}
                                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                            >
                                <option value="">Select channel…</option>
                                {channel_names.map((n) => (
                                    <option key={n} value={n}>{n}</option>
                                ))}
                            </select>
                        </label>
                    );
                }

                return (
                    <label key={field.key} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                        {field.label}{!field.required ? <span className="ml-1 text-slate-300">(optional)</span> : null}
                        <input
                            type={field.type === 'url' ? 'url' : 'text'}
                            value={String(dest[field.key] ?? '')}
                            onChange={(e) => on_change({ ...dest, [field.key]: e.target.value })}
                            placeholder={field.placeholder}
                            className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        />
                    </label>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Destination editor (inline, inside expanded row)
// ---------------------------------------------------------------------------

interface DestinationEditorProps {
    channel: ChannelRow;
    initial_destinations: Destination[];
    channel_names: string[];
    auth_fetch: ReturnType<typeof useOrgFetch>;
    on_saved: () => void;
}

function Destination_editor({
    channel,
    initial_destinations,
    channel_names,
    auth_fetch,
    on_saved,
}: DestinationEditorProps) {
    const [dests, set_dests] = useState<Destination[]>(() =>
        initial_destinations.length > 0 ? [...initial_destinations] : [],
    );
    const [busy, set_busy] = useState(false);
    const [error, set_error] = useState<string | null>(null);

    /** Whether the inline "add destination" form is open. */
    const [adding, set_adding] = useState(false);
    const [new_dest, set_new_dest] = useState<Destination>(() => empty_destination('slack'));

    const is_personal = channel.user_id != null;

    /** Persist the full destination list to the backend. */
    async function persist(next_dests: Destination[]) {
        set_busy(true);
        set_error(null);
        try {
            const res = await auth_fetch('/v1/notification_channels/update', {
                method: 'POST',
                body: JSON.stringify({ id: channel.id, destinations: next_dests }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(api_error_message(data));
                return;
            }
            set_dests(next_dests);
            on_saved();
        } catch {
            set_error('Failed to save');
        } finally {
            set_busy(false);
        }
    }

    /** Remove a single destination. */
    async function handle_remove(idx: number) {
        const next = dests.filter((_, i) => i !== idx);
        await persist(next);
    }

    /** Save the new destination from the add form. */
    async function handle_add_save() {
        const next = [...dests, new_dest];
        await persist(next);
        set_adding(false);
        set_new_dest(empty_destination('slack'));
    }

    function handle_add_cancel() {
        set_adding(false);
        set_new_dest(empty_destination('slack'));
    }

    /** Index of the destination being edited inline, or null. */
    const [editing_idx, set_editing_idx] = useState<number | null>(null);
    const [edit_dest, set_edit_dest] = useState<Destination | null>(null);

    /** Per-destination test state. */
    const [testing_dest_idx, set_testing_dest_idx] = useState<number | null>(null);
    const [dest_test_result, set_dest_test_result] = useState<{ idx: number; ok: boolean; message: string } | null>(null);

    function open_edit(idx: number) {
        set_editing_idx(idx);
        set_edit_dest({ ...dests[idx] });
        set_adding(false);
    }

    function close_edit() {
        set_editing_idx(null);
        set_edit_dest(null);
    }

    /** Test a single destination by index. */
    async function handle_test_dest(idx: number) {
        set_testing_dest_idx(idx);
        set_dest_test_result(null);
        try {
            const res = await auth_fetch('/v1/notification_channels/test', {
                method: 'POST',
                body: JSON.stringify({ id: channel.id, destination_index: idx }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_dest_test_result({ idx, ok: false, message: api_error_message(data) });
                return;
            }
            const errors: string[] = data.errors ?? [];
            if (errors.length > 0) {
                set_dest_test_result({ idx, ok: false, message: errors.join('; ') });
                return;
            }
            set_dest_test_result({ idx, ok: true, message: 'Test delivered' });
        } catch {
            set_dest_test_result({ idx, ok: false, message: 'Test request failed' });
        } finally {
            set_testing_dest_idx(null);
        }
    }

    /** Save an edited destination back to the list. */
    async function handle_edit_save() {
        if (editing_idx === null || !edit_dest) return;
        const next = dests.map((d, i) => i === editing_idx ? edit_dest : d);
        await persist(next);
        close_edit();
    }

    return (
        <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Destinations
            </p>

            {dests.length === 0 ? (
                <p className="text-xs text-slate-400">No destinations configured.</p>
            ) : (
                <div className="space-y-1">
                    {dests.map((dest, idx) => {
                        const meta = destination_type_meta(dest.type);
                        const Icon = meta.icon;
                        const is_inapp = dest.type === 'cliqhub';
                        const can_delete = !(is_personal && is_inapp);
                        const detail = destination_detail_summary(dest);
                        const is_editing = editing_idx === idx;

                        return (
                            <div key={idx}>
                                <div
                                    className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                    onClick={() => is_editing ? close_edit() : open_edit(idx)}
                                >
                                    <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                    <span className="w-24 shrink-0 text-xs font-medium text-slate-700 dark:text-slate-300">
                                        {meta.label}
                                    </span>
                                    <span className="flex-1 truncate text-xs font-medium text-slate-600 dark:text-slate-400">
                                        {detail ?? '—'}
                                        {dest_test_result?.idx === idx ? (
                                            <span className={`ml-2 text-[10px] font-semibold ${dest_test_result.ok ? 'text-green-600' : 'text-red-500'}`}>
                                                {dest_test_result.message}
                                            </span>
                                        ) : null}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); void handle_test_dest(idx); }}
                                        disabled={testing_dest_idx != null || busy}
                                        className="shrink-0 rounded p-1 text-slate-400 hover:bg-yellow-50 hover:text-yellow-600 disabled:opacity-50 dark:hover:bg-yellow-900/30"
                                        title="Test destination"
                                    >
                                        <Zap className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); void handle_remove(idx); }}
                                        disabled={!can_delete || busy}
                                        className={`shrink-0 rounded p-1 ${can_delete ? 'text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30' : 'cursor-not-allowed text-slate-200 dark:text-slate-700'}`}
                                        title={can_delete ? 'Remove destination' : 'In-app cannot be removed'}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>

                                {is_editing && edit_dest ? (
                                    <div className="mt-1 ml-5 space-y-2 rounded-lg border border-indigo-200 bg-white p-3 dark:border-indigo-800 dark:bg-slate-900">
                                        <Destination_fields
                                            dest={edit_dest}
                                            channel_names={channel_names}
                                            on_change={set_edit_dest}
                                        />
                                        <div className="flex gap-2 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => void handle_edit_save()}
                                                disabled={busy}
                                                className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                                            >
                                                {busy ? 'Saving…' : 'Save'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={close_edit}
                                                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            )}

            {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null}

            {adding ? (
                <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                        Type
                        <select
                            value={new_dest.type}
                            onChange={(e) => set_new_dest(empty_destination(e.target.value as DestinationType))}
                            className="mt-1 w-48 rounded-md border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                            {USER_DESTINATION_TYPES.map((m: DestinationTypeMeta) => (
                                <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                            <option value="cliqhub">In-app</option>
                        </select>
                    </label>

                    <Destination_fields
                        dest={new_dest}
                        channel_names={channel_names}
                        on_change={set_new_dest}
                    />

                    <div className="flex gap-2 pt-1">
                        <button
                            type="button"
                            onClick={() => void handle_add_save()}
                            disabled={busy}
                            className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                            type="button"
                            onClick={handle_add_cancel}
                            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => { set_adding(true); close_edit(); }}
                    disabled={busy}
                    className="mt-1 rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-600 dark:text-slate-400"
                >
                    + Add destination
                </button>
            )}
        </div>
    );
}


// ---------------------------------------------------------------------------
// Key-value editor (for headers)
// ---------------------------------------------------------------------------

function Key_value_editor({
    label,
    value,
    on_change,
}: {
    label: string;
    value: Record<string, string>;
    on_change: (next: Record<string, string>) => void;
}) {
    const entries = Object.entries(value);

    function set_entry(old_key: string, new_key: string, val: string) {
        const next = { ...value };
        if (old_key !== new_key) delete next[old_key];
        next[new_key] = val;
        on_change(next);
    }

    function remove_entry(key: string) {
        const next = { ...value };
        delete next[key];
        on_change(next);
    }

    function add_entry() {
        on_change({ ...value, '': '' });
    }

    return (
        <div>
            <p className="text-xs text-slate-500">{label} <span className="text-slate-300">(optional)</span></p>
            <div className="mt-1 space-y-1">
                {entries.map(([k, v], i) => (
                    <div key={i} className="flex items-center gap-1.5">
                        <input
                            value={k}
                            onChange={(e) => set_entry(k, e.target.value, v)}
                            placeholder="Key"
                            className="w-1/3 rounded border border-slate-200 px-2 py-1 text-xs"
                        />
                        <input
                            value={v}
                            onChange={(e) => set_entry(k, k, e.target.value)}
                            placeholder="Value"
                            className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs"
                        />
                        <button type="button" onClick={() => remove_entry(k)} className="text-slate-400 hover:text-red-500">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ))}
            </div>
            <button
                type="button"
                onClick={add_entry}
                className="mt-1 text-[10px] font-medium text-indigo-600 hover:underline"
            >
                + Add header
            </button>
        </div>
    );
}
