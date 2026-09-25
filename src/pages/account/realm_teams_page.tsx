import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import {
    AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight,
    Play, Plus, RefreshCw, Search as SearchIcon, Trash2, X,
} from 'lucide-react';
import yaml from 'js-yaml';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { ChannelUserPicker } from '@/components/channel_user_picker';
import { Pagination } from '@/components/pagination';
import type { Realm_outlet_context } from '@/layouts/realm_layout';
import {
    parse_run_inputs_text,
    team_filter_param,
    type Realm_team_coverage,
} from '@/lib/realm_teams_coverage';
import { Install_team_wizard } from '@/components/install_team_wizard';
import { hub_payload } from '@/lib/hub_envelope';

type Sort_col = 'team' | 'coverage';
type Sort_dir = 'asc' | 'desc';
type Origin_filter = '' | 'published' | 'local';
type Coverage_filter = '' | 'full' | 'partial' | 'none';

// Page sizes offered in the Pagination selector; must stay in sync
// with `PAGE_SIZE_OPTIONS` in components/pagination.tsx so URL-driven
// values validate correctly.
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const PAGE_SIZE_DEFAULT = 50;

interface Team_input_spec {
    name: string;
    description?: string;
    required?: boolean;
    type?: string;
    label?: string;
    help?: string;
}

/**
 * Heuristic: some manifest inputs (schemas, prompts, YAML/JSON blobs)
 * are long enough that a single-line input truncates them mid-word. Use
 * a textarea for anything whose name looks like it holds prose/structured
 * content. Cheap and predictable — no need to actually inspect the value.
 */
const _MULTILINE_INPUT_TOKENS = [
    'schema', 'description', 'body', 'config', 'yaml', 'json',
    'sql', 'query', 'template', 'prompt', 'text', 'markdown',
    'instructions', 'rules', 'context', 'notes',
] as const;

function _is_multiline_input(spec: Team_input_spec): boolean {
    const name = spec.name.toLowerCase();
    if (_MULTILINE_INPUT_TOKENS.some((t) => name.includes(t))) return true;
    const desc = (spec.description ?? '').trim();
    return desc.length > 140;
}

interface Daemon_info {
    id: string;
    name: string | null;
    hostname: string | null;
    status: 'online' | 'stale' | 'offline' | string;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
    if (typeof data.error === 'string') return data.error;
    return data.error?.message ?? 'Request failed';
}

/**
 * Coerce an arbitrary shape into a Team_input_spec list. Manifests
 * declare inputs as either `{ inputs: [{ name, description }] }` or
 * (older) a plain object keyed by input name — we tolerate both.
 */
function _normalize_inputs(raw: unknown): Team_input_spec[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
        return raw
            .filter((i: unknown): i is Team_input_spec =>
                !!i
                && typeof i === 'object'
                && typeof (i as { name?: unknown }).name === 'string'
                && !!(i as { name: string }).name.trim(),
            )
            .map((i: Team_input_spec) => ({
                name: i.name.trim(),
                description: typeof i.description === 'string' ? i.description : undefined,
                required: !!(i as { required?: unknown }).required,
                type: typeof (i as { type?: unknown }).type === 'string' ? (i as { type: string }).type : undefined,
                label: typeof (i as { label?: unknown }).label === 'string' ? (i as { label: string }).label : undefined,
                help: typeof (i as { help?: unknown }).help === 'string' ? (i as { help: string }).help : undefined,
            }));
    }
    if (typeof raw === 'object') {
        return Object.entries(raw as Record<string, unknown>).map(([name, meta]) => ({
            name,
            description: typeof (meta as { description?: unknown })?.description === 'string'
                ? (meta as { description: string }).description
                : undefined,
            required: !!(meta as { required?: unknown })?.required,
        }));
    }
    return [];
}

/**
 * Team authors often reference `{{inputs.field_name}}` (or `$(inputs.x)`)
 * from phase commands / templates without declaring a top-level `inputs:`
 * block. The registry only surfaces the declared block, so the run modal
 * ended up empty for the majority of parser teams. Scan every string in
 * the manifest for these patterns as a second source of truth.
 */
const _INPUT_REFERENCE_PATTERNS = [
    /\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    /\$\(\s*inputs\.([A-Za-z_][A-Za-z0-9_]*)\s*\)/g,
    /\$inputs\.([A-Za-z_][A-Za-z0-9_]*)/g,
];

function _discover_input_refs(node: unknown, out: Set<string>): void {
    if (!node) return;
    if (typeof node === 'string') {
        for (const re of _INPUT_REFERENCE_PATTERNS) {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(node)) !== null) {
                const name = m[1]?.trim();
                if (name) out.add(name);
            }
        }
        return;
    }
    if (Array.isArray(node)) {
        for (const item of node) _discover_input_refs(item, out);
        return;
    }
    if (typeof node === 'object') {
        for (const v of Object.values(node as Record<string, unknown>)) {
            _discover_input_refs(v, out);
        }
    }
}

/** Merge two input lists, dedup by name, declared entries win for description. */
function _merge_inputs(declared: Team_input_spec[], discovered: string[]): Team_input_spec[] {
    const by_name = new Map<string, Team_input_spec>();
    for (const spec of declared) by_name.set(spec.name, spec);
    for (const name of discovered) {
        if (!by_name.has(name)) by_name.set(name, { name });
    }
    return [...by_name.values()];
}

async function _fetch_declared_inputs_registry(
    auth_fetch: (path: string, init: RequestInit) => Promise<Response>,
    scope: string,
    slug: string,
): Promise<Team_input_spec[]> {
    const res = await auth_fetch('/v1/teams/get_by_id', {
        method: 'POST',
        body: JSON.stringify({ name: slug, scope }),
    });
    const data = await res.json();
    if (!data.ok) return [];
    const declared = _normalize_inputs(data.data?.inputs);
    const refs = new Set<string>();
    _discover_input_refs(data.data?.workflow, refs);
    _discover_input_refs(data.data?.agents, refs);
    return _merge_inputs(declared, [...refs]);
}

async function _fetch_declared_inputs_control_plane(
    auth_fetch: (path: string, init: RequestInit) => Promise<Response>,
    team_id: string,
): Promise<Team_input_spec[]> {
    const res = await auth_fetch('/v1/teams/get_by_id', {
        method: 'POST',
        body: JSON.stringify({ team_id }),
    });
    const data = await res.json();
    if (!data.ok) return [];
    const team = data.data ?? {};
    const manifest_raw = (team as { raw_manifest?: unknown; team_json?: unknown }).raw_manifest
        ?? (team as { team_json?: unknown }).team_json;
    let declared: Team_input_spec[] = [];
    let doc: unknown = null;
    if (typeof manifest_raw === 'string') {
        try {
            doc = yaml.load(manifest_raw);
            if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
                declared = _normalize_inputs((doc as { inputs?: unknown }).inputs);
            }
        } catch {
            /* fall through — declared stays empty, discovery may still find refs */
        }
    }
    if (declared.length === 0) {
        declared = _normalize_inputs((team as { inputs?: unknown }).inputs);
    }
    const refs = new Set<string>();
    _discover_input_refs(doc, refs);
    _discover_input_refs(team, refs);
    return _merge_inputs(declared, [...refs]);
}

function coverage_classes(row: Realm_team_coverage): string {
    if (row.online_daemon_count === 0) return 'bg-slate-100 text-slate-500';
    if (row.installed_count >= row.online_daemon_count) return 'bg-emerald-100 text-emerald-800';
    if (row.installed_count > 0) return 'bg-amber-100 text-amber-800';
    return 'bg-slate-100 text-slate-500';
}

/** Format a unix-ms timestamp into a relative or short date string. */
function format_last_run(ts: number | null): string | null {
    if (!ts) return null;
    const now = Date.now();
    const age_s = Math.max(0, Math.floor((now - ts) / 1000));
    if (age_s < 60) return 'just now';
    if (age_s < 3600) return `${Math.floor(age_s / 60)}m ago`;
    if (age_s < 86400) return `${Math.floor(age_s / 3600)}h ago`;
    if (age_s < 604800) return `${Math.floor(age_s / 86400)}d ago`;
    return new Date(ts).toLocaleDateString();
}

/** Status indicator for a daemon in the expandable row. */
function daemon_status_dot(status: string): string {
    if (status === 'online') return 'bg-emerald-500';
    if (status === 'stale') return 'bg-amber-400';
    return 'bg-slate-300';
}

function Sort_th({
    label, col, sort_by, sort_dir, on_sort, class_name = '',
}: {
    label: string;
    col: Sort_col;
    sort_by: Sort_col;
    sort_dir: Sort_dir;
    on_sort: (c: Sort_col) => void;
    class_name?: string;
}) {
    const active = sort_by === col;
    const Icon = !active ? ArrowUpDown : sort_dir === 'asc' ? ArrowUp : ArrowDown;
    return (
        <th className={`px-4 py-2.5 ${class_name}`}>
            <button
                type="button"
                onClick={() => on_sort(col)}
                className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider hover:text-slate-700 ${
                    active ? 'text-indigo-600' : ''
                }`}
                aria-sort={!active ? 'none' : sort_dir === 'asc' ? 'ascending' : 'descending'}
            >
                <span>{label}</span>
                <Icon className="h-3 w-3" strokeWidth={2.4} />
            </button>
        </th>
    );
}

/**
 * Expandable row showing per-daemon install status.
 *
 * Non-realm teams: only shows daemons that have the team installed (static view).
 * Realm teams: shows ALL daemons with installed/pending status.
 */
function Daemon_expand_row({
    row,
    daemons,
    base_path,
}: {
    row: Realm_team_coverage;
    daemons: Daemon_info[];
    base_path: string;
}) {
    const installed_set = new Set(row.installed_daemon_ids);
    // Local teams live only on the daemon that authored them — nothing
    // to install elsewhere until they're published. Fall back to the
    // "installed on" view even if the realm has them mis-listed, so we
    // never render a nonsensical "pending install" for a local team.
    const is_local = row.origin === 'local';
    const is_realm = !is_local && Boolean(row.in_team_list);

    /* For non-realm (or local) teams, only show daemons where it's actually installed. */
    const visible_daemons = is_realm
        ? daemons
        : daemons.filter((d) => installed_set.has(d.id));

    return (
        <tr>
            <td colSpan={6} className="px-4 pb-3 pt-0">
                <div className="ml-6 rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        {is_realm ? 'Daemon sync status' : 'Installed on'}
                    </p>
                    <div className="space-y-1.5">
                        {visible_daemons.map((d) => {
                            const installed = installed_set.has(d.id);
                            const display = d.name || d.hostname || d.id.slice(0, 8);
                            return (
                                <div key={d.id} className="flex items-center gap-2 text-xs">
                                    <span
                                        className={`h-2 w-2 shrink-0 rounded-full ${daemon_status_dot(d.status)}`}
                                        title={d.status}
                                    />
                                    <Link
                                        to={`${base_path}/daemons/${d.id}`}
                                        className="font-medium text-slate-700 hover:text-indigo-700 hover:underline dark:text-slate-200 dark:hover:text-indigo-300"
                                    >
                                        {display}
                                    </Link>
                                    {installed ? (
                                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                            installed
                                        </span>
                                    ) : (
                                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                            pending install
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                        {visible_daemons.length === 0 ? (
                            <p className="text-[11px] text-slate-400 dark:text-slate-500">
                                {is_realm ? 'No daemons in this realm.' : 'Not installed on any daemon.'}
                            </p>
                        ) : null}
                    </div>
                </div>
            </td>
        </tr>
    );
}

/**
 * Realm Teams — unified team management surface.
 *
 * Columns: Team (with Local tag) | Realm (checkbox) | Coverage (expandable) | Actions
 * The "Realm" checkbox toggles whether a team is on the realm's declarative
 * list and triggers install/uninstall across all daemons.
 */
export function Component() {
    const { realm, base_path } = useOutletContext<Realm_outlet_context>();
    const auth_fetch = useOrgFetch();
    const [search_params, set_search_params] = useSearchParams();
    const [rows, set_rows] = useState<Realm_team_coverage[]>([]);
    const [total, set_total] = useState(0);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState<string | null>(null);

    const q_filter = search_params.get('q') ?? '';
    const origin_filter = (search_params.get('origin') ?? '') as Origin_filter;
    const coverage_filter = (search_params.get('coverage') ?? '') as Coverage_filter;
    const raw_sort_by = search_params.get('sort_by') ?? '';
    const sort_by: Sort_col = raw_sort_by === 'coverage' ? 'coverage' : 'team';
    const sort_dir: Sort_dir = (search_params.get('sort_dir') ?? '').toLowerCase() === 'desc'
        ? 'desc'
        : 'asc';
    const offset = Math.max(0, Number(search_params.get('offset') ?? '0') || 0);
    const limit_raw = Number(search_params.get('limit') ?? '');
    const page_size = (PAGE_SIZE_OPTIONS as readonly number[]).includes(limit_raw)
        ? limit_raw
        : PAGE_SIZE_DEFAULT;

    const [q_draft, set_q_draft] = useState(q_filter);
    useEffect(() => { set_q_draft(q_filter); }, [q_filter]);

    // Debounced search-as-you-type — fire URL param update 300ms after
    // keystrokes settle. Skip when draft already matches the URL (e.g.
    // hydration / back-nav) so we don't churn history.
    useEffect(() => {
        if (q_draft === q_filter) return;
        const t = window.setTimeout(() => {
            const next = new URLSearchParams(search_params);
            if (q_draft) next.set('q', q_draft);
            if (!q_draft) next.delete('q');
            next.delete('offset');
            set_search_params(next, { replace: true });
        }, 300);
        return () => window.clearTimeout(t);
    }, [q_draft, q_filter, search_params, set_search_params]);

    /* Per-row expansion tracking */
    const [expanded, set_expanded] = useState<Set<string>>(new Set());
    /* Realm daemons list for expansion */
    const [daemons, set_daemons] = useState<Daemon_info[]>([]);

    const [panel_team, set_panel_team] = useState<Realm_team_coverage | null>(null);
    const [panel_inputs_spec, set_panel_inputs_spec] = useState<Team_input_spec[] | null>(null);
    const [panel_inputs_loading, set_panel_inputs_loading] = useState(false);
    const [panel_input_values, set_panel_input_values] = useState<Record<string, string>>({});
    /** Channel-type inputs store arrays of selected values. */
    const [panel_channel_values, set_panel_channel_values] = useState<Record<string, string[]>>({});
    const [task_text, set_task_text] = useState('');
    const [run_name, set_run_name] = useState('');
    const [workspace_path, set_workspace_path] = useState('');
    const [extra_inputs_text, set_extra_inputs_text] = useState('');
    const [scheduling, set_scheduling] = useState(false);
    const [schedule_toast, set_schedule_toast] = useState<string | null>(null);
    const [schedule_ok, set_schedule_ok] = useState(true);

    /* Tracks which rows are mid-toggle for the realm checkbox. */
    const [toggling_realm, set_toggling_realm] = useState<Set<string>>(new Set());
    const [deleting, set_deleting] = useState<string | null>(null);
    const [syncing, set_syncing] = useState<string | null>(null);
    /* Which row has the inline danger-zone confirmation expanded. */
    const [confirm_delete, set_confirm_delete] = useState<string | null>(null);

    /* Add-team picker + wizard state */
    type Wizard_step = 'pick' | 'configure';
    const [wizard_open, set_wizard_open] = useState(false);
    const [wizard_step, set_wizard_step] = useState<Wizard_step>('pick');
    const [picker_search, set_picker_search] = useState('');
    const [picker_results, set_picker_results] = useState<{ scope: string; slug: string }[]>([]);
    const [picker_loading, set_picker_loading] = useState(false);
    const [wizard_team, set_wizard_team] = useState<{ scope: string; slug: string } | null>(null);
    const picker_ref = useRef<HTMLDivElement>(null);

    /* Load realm daemons for the expand panels. */
    const load_daemons = useCallback(async () => {
        try {
            const res = await auth_fetch('/v1/daemons/get', {
                method: 'POST',
                body: JSON.stringify({ realm_id: realm.id, limit: 200, offset: 0 }),
            });
            const data = await res.json();
            if (data.ok) {
                set_daemons(
                    ((data.daemons ?? []) as Daemon_info[])
                        .filter((d) => d.status === 'online' || d.status === 'stale'),
                );
            }
        } catch {
            /* non-critical */
        }
    }, [auth_fetch, realm.id]);

    /**
     * Fetch the current realm-teams page.
     *
     * `silent` skips the "Loading teams…" fallback so background
     * refreshes (post-install, post-uninstall, post-add) don't blank
     * the table on every mutation.
     */
    const load = useCallback(async (opts: { silent?: boolean } = {}) => {
        if (!opts.silent) set_loading(true);
        try {
            const body: Record<string, unknown> = {
                realm_id: realm.id,
                limit: page_size,
                offset,
                sort_by,
                sort_dir,
            };
            if (q_filter.trim()) body.query = q_filter.trim();
            if (origin_filter) body.origin = origin_filter;
            if (coverage_filter) body.coverage = coverage_filter;

            const res = await auth_fetch('/v1/teams/get', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(api_error_message(data));
                return;
            }
            const payload = data.data ?? data;
            const coverage_rows = (payload.rows ?? payload.teams ?? []) as Realm_team_coverage[];
            set_rows(coverage_rows);
            set_total(Number(payload.total ?? data.total ?? 0));
            set_error(null);
        } catch {
            set_error('Failed to load realm teams');
        } finally {
            if (!opts.silent) set_loading(false);
        }
    }, [
        auth_fetch, realm.id, offset, page_size, q_filter, origin_filter,
        coverage_filter, sort_by, sort_dir,
    ]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        void load_daemons();
    }, [load_daemons]);

    /* Close picker on outside click (only in pick step before modal opens) */
    useEffect(() => {
        function handle_click(e: MouseEvent) {
            if (wizard_step === 'pick' && picker_ref.current && !picker_ref.current.contains(e.target as Node)) {
                set_wizard_open(false);
            }
        }
        document.addEventListener('mousedown', handle_click);
        return () => document.removeEventListener('mousedown', handle_click);
    }, [wizard_step]);

    /**
     * Load published teams from the registry only. Local/daemon-only teams
     * shouldn't appear here — they can't be meaningfully added to a realm.
     */
    const load_picker_options = useCallback(async () => {
        set_picker_loading(true);
        try {
            const res = await auth_fetch('/v1/teams/get', {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const json = await res.json();
            if (!json.ok) {
                set_picker_results([]);
                return;
            }

            /* BFF wraps in { ok, data: { teams, total, ... } } */
            const payload = json.data ?? json;
            const raw_teams = (payload.teams ?? []) as Array<{ scope?: string | null; name?: string; slug?: string }>;

            const seen = new Set<string>();
            const teams: { scope: string; slug: string }[] = [];
            for (const t of raw_teams) {
                const scope = (t.scope ?? '').trim();
                const slug = (t.name ?? t.slug ?? '').trim();
                if (!scope || !slug) continue;
                const key = `${scope}/${slug}`;
                if (seen.has(key)) continue;
                seen.add(key);
                teams.push({ scope, slug });
            }

            teams.sort((a, b) => `${a.scope}/${a.slug}`.localeCompare(`${b.scope}/${b.slug}`));
            set_picker_results(teams);
        } catch {
            set_picker_results([]);
        } finally {
            set_picker_loading(false);
        }
    }, [auth_fetch]);

    const existing_team_keys = useMemo(
        () => new Set(rows.map((r) => `${r.scope}/${r.slug}`)),
        [rows],
    );

    /** Client-side filter — strips leading @ for convenience. */
    const filtered_picker = useMemo(() => {
        const q = picker_search.trim().replace(/^@/, '').toLowerCase();
        return picker_results.filter((t) => {
            const key = `${t.scope}/${t.slug}`;
            if (existing_team_keys.has(key)) return false;
            if (!q) return true;
            return key.toLowerCase().includes(q);
        });
    }, [picker_results, existing_team_keys, picker_search]);

    function open_picker() {
        set_wizard_open(true);
        set_wizard_step('pick');
        set_picker_search('');
        set_wizard_team(null);
        void load_picker_options();
    }

    /** After picking a team from the dropdown, switch to the configure wizard. */
    function handle_picker_select(entry: { scope: string; slug: string }) {
        set_wizard_team(entry);
        set_wizard_step('configure');
    }

    const panel_open = Boolean(panel_team);

    const runs_href = useMemo(() => {
        if (!panel_team) return `${base_path}/runs`;
        const team = team_filter_param(panel_team.scope, panel_team.slug);
        return `${base_path}/runs?team=${encodeURIComponent(team)}`;
    }, [base_path, panel_team]);

    function update_params(patch: Record<string, string | null>) {
        const next = new URLSearchParams(search_params);
        for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === '') next.delete(k);
            else next.set(k, v);
        }
        if ('q' in patch || 'origin' in patch || 'coverage' in patch
            || 'sort_by' in patch || 'sort_dir' in patch) {
            next.delete('offset');
        }
        set_search_params(next, { replace: true });
    }

    function toggle_sort(col: Sort_col) {
        if (sort_by === col) {
            const next_dir = sort_dir === 'asc' ? 'desc' : 'asc';
            update_params({
                sort_by: col === 'team' ? null : col,
                sort_dir: next_dir === 'asc' ? null : 'desc',
            });
            return;
        }
        update_params({
            sort_by: col === 'team' ? null : col,
            sort_dir: col === 'coverage' ? 'desc' : null,
        });
    }

    function set_offset(next_offset: number) {
        update_params({ offset: next_offset > 0 ? String(next_offset) : null });
    }

    function set_page_size(next_size: number) {
        update_params({
            limit: next_size === PAGE_SIZE_DEFAULT ? null : String(next_size),
            offset: null,
        });
    }

    function toggle_expand(label: string) {
        set_expanded((prev) => {
            const next = new Set(prev);
            if (next.has(label)) next.delete(label);
            else next.add(label);
            return next;
        });
    }

    const has_filters = Boolean(q_filter || origin_filter || coverage_filter);

    /**
     * Toggle realm membership for a team.
     * Checking → add to list + dispatch install.
     * Unchecking → remove from list + dispatch uninstall.
     * Auto-expands the row so you see daemons transition to "pending install".
     */
    async function toggle_realm_membership(row: Realm_team_coverage) {
        const key = row.label;
        set_toggling_realm((prev) => new Set([...prev, key]));

        const is_currently_realm = Boolean(row.in_team_list);

        try {
            if (is_currently_realm) {
                const res = await auth_fetch('/v1/realms/remove_team', {
                    method: 'POST',
                    body: JSON.stringify({ realm_id: realm.id, scope: row.scope, slug: row.slug }),
                });
                const data = await res.json();
                if (!data.ok) {
                    set_error(api_error_message(data));
                    return;
                }
                void auth_fetch('/v1/teams/uninstall', {
                    method: 'POST',
                    body: JSON.stringify({ scope: row.scope, slug: row.slug, realm_id: realm.id }),
                }).catch(() => {});
            } else {
                const res = await auth_fetch('/v1/realms/add_team', {
                    method: 'POST',
                    body: JSON.stringify({ realm_id: realm.id, scope: row.scope, slug: row.slug }),
                });
                const data = await res.json();
                if (!data.ok) {
                    set_error(api_error_message(data));
                    return;
                }
                void auth_fetch('/v1/teams/install', {
                    method: 'POST',
                    body: JSON.stringify({
                        team_id: `${row.scope}/${row.slug}`,
                        realm_id: realm.id,
                    }),
                }).catch(() => {});

                /* Auto-expand so the user sees "pending install" on missing daemons. */
                set_expanded((prev) => new Set([...prev, key]));
            }
            // Optimistic — flip the checkbox instantly so the UI responds
            // even before the coverage counts refresh.
            set_rows((prev) => prev.map((r) => r.label === key
                ? { ...r, in_team_list: !is_currently_realm }
                : r,
            ));
            // Silent refresh — pull the authoritative coverage counts
            // from the server without blanking the table.
            void load({ silent: true });
        } catch {
            set_error('Failed to update realm membership');
        } finally {
            set_toggling_realm((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    }

    /**
     * Delete/uninstall a team.
     * Realm teams: remove from realm list + uninstall from all daemons.
     * Non-realm teams: uninstall only from the daemons that have it.
     */
    async function handle_delete(row: Realm_team_coverage) {
        const label = row.label;
        const is_on_realm = Boolean(row.in_team_list);
        set_deleting(label);
        try {
            if (is_on_realm) {
                const res = await auth_fetch('/v1/realms/remove_team', {
                    method: 'POST',
                    body: JSON.stringify({ realm_id: realm.id, scope: row.scope, slug: row.slug }),
                });
                const data = await res.json();
                if (!data.ok) {
                    set_error(api_error_message(data));
                    return;
                }
            }
            /* Daemon uninstall is fire-and-forget — the realm list
               removal is the authoritative action; daemon sync catches up. */
            void auth_fetch('/v1/teams/uninstall', {
                method: 'POST',
                body: JSON.stringify({ scope: row.scope, slug: row.slug, realm_id: realm.id }),
            }).catch(() => {});
            set_rows((prev) => prev.filter((r) => r.label !== label));
            set_confirm_delete(null);
        } catch {
            set_error(`Failed to remove ${label}`);
        } finally {
            set_deleting(null);
        }
    }

    /**
     * Force-sync: overwrite the team on every online realm daemon with
     * Hub's latest version (and push effective agent settings).
     */
    async function handle_force_sync(row: Realm_team_coverage) {
        const label = row.label;
        if (!window.confirm(
            `Force sync ${label}?\n\nThis overwrites the installed copy on every online daemon with Hub's latest version.`,
        )) return;

        set_syncing(label);
        set_error(null);
        try {
            const res = await auth_fetch('/v1/realms/add_team', {
                method: 'POST',
                body: JSON.stringify({
                    realm_id: realm.id,
                    scope: row.scope,
                    slug: row.slug,
                }),
            });
            const data = await res.json() as {
                ok?: boolean;
                error?: string | { message?: string };
                install?: {
                    daemon_results?: Array<{ daemon_id: string; ok: boolean; error?: string }>;
                };
                result?: {
                    daemon_results?: Array<{ daemon_id: string; ok: boolean; error?: string }>;
                };
            };
            if (!data.ok) {
                set_error(api_error_message(data));
                return;
            }
            const results = data.install?.daemon_results ?? data.result?.daemon_results ?? [];
            const failed = results.filter((r) => !r.ok);
            if (failed.length > 0 && failed.length === results.length) {
                set_error(
                    `Force sync failed for ${label}: `
                    + failed.map((r) => r.error ?? r.daemon_id).join('; '),
                );
                return;
            }
            if (failed.length > 0) {
                set_error(
                    `Force sync partial for ${label}: `
                    + failed.map((r) => `${r.daemon_id}: ${r.error ?? 'failed'}`).join('; '),
                );
            }
            void load({ silent: true });
        } catch {
            set_error(`Failed to force sync ${label}`);
        } finally {
            set_syncing(null);
        }
    }

    async function open_run_panel(row: Realm_team_coverage) {
        set_panel_team(row);
        set_task_text('');
        set_run_name('');
        set_workspace_path('');
        set_extra_inputs_text('');
        set_panel_input_values({});
        set_panel_channel_values({});
        set_panel_inputs_spec(null);
        set_schedule_toast(null);
        set_schedule_ok(true);
        set_panel_inputs_loading(true);
        try {
            // Prefer the registry (hub-parsed inputs + workflow refs).
            // Fall back to the daemon's control-plane manifest copy if
            // the registry returns nothing — some published teams have
            // a stale/thin registry entry but the daemon has the full
            // YAML manifest with declared inputs + phase command refs.
            let spec: Team_input_spec[] = [];
            if (row.origin === 'published') {
                spec = await _fetch_declared_inputs_registry(auth_fetch, row.scope, row.slug);
            }
            if (spec.length === 0 && row.sample_team_id) {
                spec = await _fetch_declared_inputs_control_plane(auth_fetch, row.sample_team_id);
            }
            set_panel_inputs_spec(spec);
            set_panel_input_values(Object.fromEntries(spec.filter((s) => s.type !== 'channel').map((s) => [s.name, ''])));
            set_panel_channel_values(Object.fromEntries(spec.filter((s) => s.type === 'channel').map((s) => [s.name, []])));
        } catch {
            set_panel_inputs_spec([]);
        } finally {
            set_panel_inputs_loading(false);
        }
    }

    function close_run_panel() {
        set_panel_team(null);
    }

    async function schedule_run() {
        if (!panel_team) return;
        set_scheduling(true);
        set_schedule_toast(null);
        set_schedule_ok(true);
        try {
            /** Block submission when any required input is blank. */
            const missing = (panel_inputs_spec ?? [])
                .filter((s) => {
                    if (!s.required) return false;
                    if (s.type === 'channel') return (panel_channel_values[s.name] ?? []).length === 0;
                    return !(panel_input_values[s.name] ?? '').trim();
                })
                .map((s) => s.name);
            if (missing.length > 0) {
                set_schedule_ok(false);
                set_schedule_toast(`Required input${missing.length > 1 ? 's' : ''} missing: ${missing.join(', ')}`);
                set_scheduling(false);
                return;
            }

            const declared: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(panel_input_values)) {
                const val = v.trim();
                if (val) declared[k] = val;
            }
            /** Include channel selections as arrays. */
            for (const [k, vals] of Object.entries(panel_channel_values)) {
                if (vals.length > 0) declared[k] = vals;
            }
            const extras = parse_run_inputs_text(extra_inputs_text);
            // Only include `task` when the team actually declares it as an input
            // (the top textarea is only shown in that case now). Otherwise we'd
            // inject a stray `task` key that the team doesn't expect.
            const declares_task = (panel_inputs_spec ?? []).some((s) => s.name === 'task');
            const task = declares_task ? task_text.trim() : '';
            const inputs = { ...(task ? { task } : {}), ...declared, ...extras };
            const team_id = `${panel_team.scope}/${panel_team.slug}`;
            const payload: Record<string, unknown> = { team_id, inputs };
            const name = run_name.trim();
            if (name) payload.run_name = name;
            const path = workspace_path.trim();
            if (path) payload.workspace_path = path;

            const res = await auth_fetch('/v1/runs/enqueue', {
                method: 'POST',
                body: JSON.stringify({ realm_id: realm.id, payload }),
            });
            const data = await res.json() as {
                ok?: boolean;
                error?: string | { message?: string; code?: string };
            };
            if (!data.ok) {
                set_schedule_ok(false);
                set_schedule_toast(api_error_message(data));
                return;
            }

            const item = hub_payload<{ item?: { status?: string; error?: string | null; run_id?: string | null } }>(data)?.item;
            if (item?.status === 'failed') {
                set_schedule_ok(false);
                set_schedule_toast(item.error?.trim() || 'Run failed to start on any daemon');
                return;
            }

            if (item?.status === 'queued' || item?.status === 'offered') {
                set_schedule_ok(false);
                set_schedule_toast(
                    'Run was queued but no daemon claimed it — check that a daemon is online in this realm',
                );
                return;
            }

            close_run_panel();
        } catch {
            set_schedule_ok(false);
            set_schedule_toast('Failed to schedule run');
        } finally {
            set_scheduling(false);
        }
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <ApiErrorBanner error={error} onDismiss={() => set_error(null)} />

            {/* Toolbar: search + filters + add team */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[14rem] flex-1 sm:flex-none sm:basis-72">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={q_draft}
                        onChange={(e) => set_q_draft(e.target.value)}
                        placeholder="Search @scope/team…"
                        aria-label="Search teams"
                        className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-6 text-xs text-slate-700 outline-none focus:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    />
                    {q_draft ? (
                        <button
                            type="button"
                            onClick={() => { set_q_draft(''); update_params({ q: null }); }}
                            aria-label="Clear search"
                            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    ) : null}
                </div>
                <select
                    value={origin_filter}
                    onChange={(e) => update_params({ origin: e.target.value || null })}
                    aria-label="Filter by origin"
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                    <option value="">All origins</option>
                    <option value="published">Published</option>
                    <option value="local">Local</option>
                </select>
                <select
                    value={coverage_filter}
                    onChange={(e) => update_params({ coverage: e.target.value || null })}
                    aria-label="Filter by coverage"
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                    <option value="">All coverage</option>
                    <option value="full">Fully covered</option>
                    <option value="partial">Partial</option>
                    <option value="none">None</option>
                </select>
                {has_filters ? (
                    <button
                        type="button"
                        onClick={() => update_params({ q: null, origin: null, coverage: null })}
                        className="text-[11px] font-semibold text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
                    >
                        Clear
                    </button>
                ) : null}
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    {loading ? '…' : `${rows.length}${has_filters ? '' : `/${total}`}`}
                </span>

                {/* Add team button */}
                <div ref={picker_ref} className="relative ml-auto">
                    <button
                        type="button"
                        onClick={() => wizard_open ? set_wizard_open(false) : open_picker()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-indigo-600 dark:hover:bg-indigo-900/30"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add team
                    </button>
                    {wizard_open && wizard_step === 'pick' ? (
                        <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                            <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                                <input
                                    type="text"
                                    value={picker_search}
                                    onChange={(e) => set_picker_search(e.target.value)}
                                    placeholder="Search @scope/team…"
                                    autoFocus
                                    className="w-full border-0 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
                                />
                            </div>
                            <div className="max-h-60 overflow-y-auto">
                                {picker_loading ? (
                                    <p className="px-3 py-3 text-xs text-slate-400">Searching…</p>
                                ) : filtered_picker.length === 0 ? (
                                    <p className="px-3 py-3 text-xs text-slate-400">
                                        {picker_search.trim() ? 'No matching teams' : 'All available teams are already added'}
                                    </p>
                                ) : (
                                    filtered_picker.slice(0, 20).map((t) => (
                                        <button
                                            key={`${t.scope}/${t.slug}`}
                                            type="button"
                                            onClick={() => void handle_picker_select(t)}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                                        >
                                            <Plus className="h-3 w-3 shrink-0 text-slate-400" />
                                            <span className="font-mono text-slate-700 dark:text-slate-200">
                                                @{t.scope}/{t.slug}
                                            </span>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            {loading ? (
                <p className="text-sm text-slate-400">Loading teams…</p>
            ) : rows.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center dark:border-slate-800">
                    <p className="text-slate-400 dark:text-slate-500">
                        {has_filters
                            ? 'No teams match these filters.'
                            : 'No teams installed on daemons in this realm yet.'}
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                    <table className="w-full min-w-[40rem] text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-slate-400 dark:border-slate-800">
                                <Sort_th label="Team" col="team" sort_by={sort_by} sort_dir={sort_dir} on_sort={toggle_sort} />
                                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-center">All Realm</th>
                                <Sort_th label="Coverage" col="coverage" sort_by={sort_by} sort_dir={sort_dir} on_sort={toggle_sort} />
                                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider">Last Run</th>
                                <th className="px-4 py-2.5" />
                                <th className="w-10 px-4 py-2.5" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                            {rows.map((row) => {
                                const team_q = team_filter_param(row.scope, row.slug);
                                const runs_link = `${base_path}/runs?team=${encodeURIComponent(team_q)}`;
                                const detail_link = `${base_path}/teams/${encodeURIComponent(row.scope)}/${encodeURIComponent(row.slug)}`;
                                const is_expanded = expanded.has(row.label);
                                const is_realm_team = Boolean(row.in_team_list);
                                const is_local = row.origin === 'local';
                                const is_toggling = toggling_realm.has(row.label);

                                return (
                                    <React_fragment key={row.label}>
                                        <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <Link
                                                        to={detail_link}
                                                        className="font-mono text-sm font-semibold text-slate-900 hover:text-indigo-700 hover:underline dark:text-slate-100 dark:hover:text-indigo-300"
                                                    >
                                                        {row.label}
                                                    </Link>
                                                    {is_local ? (
                                                        <span className="rounded-md border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                                            Local
                                                        </span>
                                                    ) : null}
                                                    {(row.missing_agents?.length ?? 0) > 0 ? (
                                                        <span
                                                            title={`Unregistered agent${row.missing_agents!.length > 1 ? 's' : ''}: ${row.missing_agents!.join(', ')}`}
                                                            className="inline-flex items-center text-red-500 dark:text-red-400"
                                                        >
                                                            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.2} />
                                                        </span>
                                                    ) : null}
                                                </div>
                                                {row.version ? (
                                                    <p className="mt-0.5 text-[11px] text-slate-400">v{row.version}</p>
                                                ) : null}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {is_local ? (
                                                    <span className="text-slate-300 dark:text-slate-600">—</span>
                                                ) : (
                                                    <input
                                                        type="checkbox"
                                                        checked={is_realm_team}
                                                        disabled={is_toggling}
                                                        onChange={() => void toggle_realm_membership(row)}
                                                        title={is_realm_team ? 'Remove from realm (uninstall from all daemons)' : 'Add to realm (install on all daemons)'}
                                                        className="h-4 w-4 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-wait disabled:opacity-50"
                                                    />
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <button
                                                    type="button"
                                                    onClick={() => toggle_expand(row.label)}
                                                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold transition hover:ring-1 hover:ring-slate-300 ${coverage_classes(row)}`}
                                                    title={`${row.installed_count} of ${row.online_daemon_count} online daemons — click to expand`}
                                                >
                                                    {row.coverage_label}
                                                    {is_expanded
                                                        ? <ChevronDown className="h-2.5 w-2.5" />
                                                        : <ChevronRight className="h-2.5 w-2.5" />
                                                    }
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                                                {row.last_run_at ? (
                                                    <Link
                                                        to={runs_link}
                                                        title="View run history"
                                                        className="hover:text-indigo-600 hover:underline dark:hover:text-indigo-400"
                                                    >
                                                        {format_last_run(row.last_run_at)}
                                                    </Link>
                                                ) : (
                                                    <span className="italic text-slate-400 dark:text-slate-500">No runs yet</span>
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-right">
                                                <div className="inline-flex items-center gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => void open_run_panel(row)}
                                                        title="Run on realm"
                                                        className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
                                                    >
                                                        Run
                                                    </button>
                                                    {is_realm_team ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => void handle_force_sync(row)}
                                                            disabled={syncing === row.label}
                                                            aria-label={syncing === row.label ? 'Syncing team' : 'Force sync'}
                                                            title="Force sync — overwrite with Hub's latest version"
                                                            className="rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50 dark:hover:bg-amber-900/30 dark:hover:text-amber-300"
                                                        >
                                                            <RefreshCw
                                                                className={`h-3.5 w-3.5 ${syncing === row.label ? 'animate-spin' : ''}`}
                                                                strokeWidth={2}
                                                            />
                                                        </button>
                                                    ) : null}
                                                </div>
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-center">
                                                <button
                                                    type="button"
                                                    onClick={() => set_confirm_delete(
                                                        confirm_delete === row.label ? null : row.label,
                                                    )}
                                                    disabled={deleting === row.label}
                                                    title={is_realm_team ? 'Remove from realm and uninstall' : 'Uninstall from daemons'}
                                                    className={`rounded p-1.5 disabled:opacity-50 ${
                                                        confirm_delete === row.label
                                                            ? 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                                                            : 'text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400'
                                                    }`}
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                                                </button>
                                            </td>
                                        </tr>
                                        {confirm_delete === row.label ? (
                                            <tr>
                                                <td colSpan={6} className="px-4 pb-3 pt-0">
                                                    <div className="ml-6 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
                                                        <p className="text-xs text-red-800 dark:text-red-300">
                                                            {is_realm_team
                                                                ? <>Remove <span className="font-mono font-semibold">{row.label}</span> from the realm and uninstall from all daemons?</>
                                                                : <>Uninstall <span className="font-mono font-semibold">{row.label}</span> from its daemons?</>
                                                            }
                                                        </p>
                                                        <div className="ml-auto flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => set_confirm_delete(null)}
                                                                className="rounded-md px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
                                                            >
                                                                Cancel
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={deleting === row.label}
                                                                onClick={() => void handle_delete(row)}
                                                                className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                                                            >
                                                                {deleting === row.label ? 'Removing…' : 'Confirm remove'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : null}
                                        {is_expanded ? (
                                            <Daemon_expand_row
                                                row={row}
                                                daemons={daemons}
                                                base_path={base_path}
                                            />
                                        ) : null}
                                    </React_fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {total > 0 ? (
                <div className="mt-3 flex justify-end">
                    <Pagination
                        offset={offset}
                        limit={page_size}
                        total={total}
                        on_change={(next) => set_offset(next)}
                        on_limit_change={set_page_size}
                        label="teams"
                    />
                </div>
            ) : null}

            {/* Add Team wizard — configure step (shared component) */}
            {wizard_open && wizard_step === 'configure' && wizard_team ? (
                <Install_team_wizard
                    scope={wizard_team.scope}
                    slug={wizard_team.slug}
                    realm_id={realm.id}
                    auth_fetch={auth_fetch}
                    header_title="Add team to realm"
                    on_done={() => {
                        set_wizard_open(false);
                        void load({ silent: true });
                    }}
                    on_cancel={() => set_wizard_open(false)}
                    on_back={() => { set_wizard_step('pick'); set_wizard_team(null); }}
                />
            ) : null}

            {panel_open && panel_team ? (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Run ${panel_team.label} on realm`}
                    className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50 p-0 sm:items-center sm:p-6"
                    onClick={(e) => { if (e.target === e.currentTarget) close_run_panel(); }}
                >
                    {/*
                        Full-screen on mobile, roomy card on desktop. Sticky
                        header + footer keep the primary CTAs visible while
                        the body scrolls — some team manifests declare 15+
                        inputs with long descriptions (parser builders,
                        schema definitions).
                    */}
                    <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:h-auto sm:max-h-[calc(100vh-4rem)] sm:w-full sm:max-w-4xl sm:rounded-2xl sm:border sm:border-slate-200 sm:dark:border-slate-700">
                        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                                    Run on realm
                                </p>
                                <p className="mt-0.5 truncate font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {panel_team.label}
                                </p>
                                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                    One online daemon in this realm will claim the run.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={close_run_panel}
                                aria-label="Close"
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-5 py-4">
                            <div className="grid gap-4">
                                {/*
                                  Primary "task" textarea — only render when the
                                  team actually declares a `task` input. Was
                                  previously shown for every team, which meant
                                  hello-world v2.0.0 (declares `name`, no `task`)
                                  presented a misleading "Task" field on top of
                                  the real `name` input. When shown here, we
                                  filter `task` out of the generic Team-inputs
                                  list below to avoid rendering it twice.
                                */}
                                {(panel_inputs_spec ?? []).some((s) => s.name === 'task') ? (
                                    <label className="block">
                                        <span className="text-[10px] font-semibold uppercase text-slate-400">
                                            Task
                                        </span>
                                        <textarea
                                            rows={3}
                                            value={task_text}
                                            onChange={(e) => set_task_text(e.target.value)}
                                            placeholder="Describe what this run should do…"
                                            className="mt-1 block w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                        />
                                        {(() => {
                                            const task_spec = (panel_inputs_spec ?? []).find((s) => s.name === 'task');
                                            const hint = task_spec?.description?.trim()
                                                || 'The primary instruction for the team.';
                                            return (
                                                <span className="mt-1 block text-[10px] text-slate-400">
                                                    {hint}
                                                </span>
                                            );
                                        })()}
                                    </label>
                                ) : null}

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="block">
                                        <span className="text-[10px] font-semibold uppercase text-slate-400">
                                            Run name <span className="font-normal normal-case text-slate-400">(optional)</span>
                                        </span>
                                        <input
                                            type="text"
                                            value={run_name}
                                            onChange={(e) => set_run_name(e.target.value)}
                                            placeholder="Leave blank to auto-generate"
                                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="text-[10px] font-semibold uppercase text-slate-400">
                                            Workspace path <span className="font-normal normal-case text-slate-400">(optional)</span>
                                        </span>
                                        <input
                                            type="text"
                                            value={workspace_path}
                                            onChange={(e) => set_workspace_path(e.target.value)}
                                            placeholder="/path/on/daemon"
                                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                        />
                                    </label>
                                </div>

                                {(() => {
                                    // `task` is promoted to the top textarea when declared, so
                                    // strip it here to avoid rendering it twice. Also drives the
                                    // empty-state message: a team that only declares `task` shows
                                    // "no additional inputs" instead of an empty grid.
                                    const non_task_inputs = (panel_inputs_spec ?? [])
                                        .filter((s) => s.name !== 'task');
                                    return (
                                <div>
                                    <p className="text-[10px] font-semibold uppercase text-slate-400">Team inputs</p>
                                    {panel_inputs_loading ? (
                                        <p className="mt-1 text-xs text-slate-400">Loading declared inputs…</p>
                                    ) : panel_inputs_spec === null ? null
                                    : non_task_inputs.length === 0 ? (
                                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                            No additional declared inputs. Use "Extras" below if the run needs any.
                                        </p>
                                    ) : (
                                        <div className="mt-2 grid gap-3">
                                            {non_task_inputs
                                                .map((spec) => {
                                                const display_label = spec.label || spec.name;
                                                const help_text = spec.help || spec.description;

                                                /** Channel inputs use the searchable picker. */
                                                if (spec.type === 'channel') {
                                                    return (
                                                        <div key={spec.name}>
                                                            <span className="block font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                                                                {display_label}
                                                                {spec.required ? <span className="ml-1 text-red-500" title="Required">*</span> : null}
                                                            </span>
                                                            {help_text ? (
                                                                <span className="mt-0.5 block whitespace-pre-wrap text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                                                    {help_text}
                                                                </span>
                                                            ) : null}
                                                            <ChannelUserPicker
                                                                selected={panel_channel_values[spec.name] ?? []}
                                                                on_change={(next) =>
                                                                    set_panel_channel_values((prev) => ({ ...prev, [spec.name]: next }))
                                                                }
                                                                placeholder={`Select ${display_label.toLowerCase()}…`}
                                                            />
                                                        </div>
                                                    );
                                                }

                                                const multiline = _is_multiline_input(spec);
                                                return (
                                                    <label key={spec.name} className="block">
                                                        <span className="block font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                                                            {display_label}
                                                            {spec.required ? <span className="ml-1 text-red-500" title="Required">*</span> : null}
                                                        </span>
                                                        {help_text ? (
                                                            <span className="mt-0.5 block whitespace-pre-wrap text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                                                {help_text}
                                                            </span>
                                                        ) : null}
                                                        {multiline ? (
                                                            <textarea
                                                                rows={5}
                                                                value={panel_input_values[spec.name] ?? ''}
                                                                onChange={(e) => set_panel_input_values(
                                                                    (prev) => ({ ...prev, [spec.name]: e.target.value }),
                                                                )}
                                                                placeholder={spec.name}
                                                                className="mt-1 block w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                                            />
                                                        ) : (
                                                            <input
                                                                type="text"
                                                                value={panel_input_values[spec.name] ?? ''}
                                                                onChange={(e) => set_panel_input_values(
                                                                    (prev) => ({ ...prev, [spec.name]: e.target.value }),
                                                                )}
                                                                placeholder={spec.name}
                                                                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                                            />
                                                        )}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                                    );
                                })()}

                                <label className="block">
                                    <span className="text-[10px] font-semibold uppercase text-slate-400">
                                        Extras <span className="font-normal normal-case text-slate-400">(key=value per line — overrides declared)</span>
                                    </span>
                                    <textarea
                                        rows={4}
                                        value={extra_inputs_text}
                                        onChange={(e) => set_extra_inputs_text(e.target.value)}
                                        placeholder={'claim_id=CLM-1042\nregion=us-west'}
                                        className="mt-1 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
                            {schedule_toast ? (
                                <p
                                    className={`mb-3 rounded-lg px-3 py-2 text-xs font-semibold ${
                                        schedule_ok
                                            ? 'bg-emerald-100 text-emerald-900'
                                            : 'bg-rose-100 text-rose-900'
                                    }`}
                                >
                                    {schedule_toast}{' '}
                                    {schedule_ok ? (
                                        <Link to={runs_href} className="underline">Open Runs →</Link>
                                    ) : null}
                                </p>
                            ) : null}
                            <div className="flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={close_run_panel}
                                    className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    disabled={
                                        scheduling
                                        || panel_inputs_loading
                                        || (panel_inputs_spec ?? []).some((s) => {
                                            if (!s.required) return false;
                                            if (s.type === 'channel') return (panel_channel_values[s.name] ?? []).length === 0;
                                            return !(panel_input_values[s.name] ?? '').trim();
                                        })
                                    }
                                    onClick={() => void schedule_run()}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800 disabled:opacity-60"
                                >
                                    <Play className="h-3.5 w-3.5" strokeWidth={2.4} />
                                    {scheduling ? 'Starting…' : 'Start run'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/**
 * Wrapper to render adjacent <tr> elements without adding a DOM node.
 */
function React_fragment({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
