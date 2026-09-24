import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useBuilder, useBuilderDispatch } from '@/lib/builder/store';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import type { ClientScope } from '@/lib/auth_context';
import { build_team_yml } from '@/lib/team_export';
import { validate_slug } from '@/lib/validation';
import { clear_builder_session_restores } from '@/lib/builder/session_restore';

type BumpType = 'patch' | 'minor' | 'major';

/** Group scopes into personal vs org for the scope selector. */
function group_scopes(scopes: ClientScope[]) {
    const personal = scopes.filter((s) => s.scope_type === 'user');
    const org = scopes.filter((s) => s.scope_type === 'org');
    return { personal, org };
}

/** Compute the next semantic version given a current version and bump type. */
function compute_next_version(current: string, bump: BumpType): string {
    const match = current.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return '1.0.0';

    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);

    if (bump === 'major') return `${major + 1}.0.0`;
    if (bump === 'minor') return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
}

export function PublishDialog({ onClose }: { onClose: () => void }) {
    const state = useBuilder();
    const dispatch = useBuilderDispatch();
    const { scopes } = useAuth();
    const authFetch = useOrgFetch();
    const grouped = useMemo(() => group_scopes(scopes), [scopes]);

    const default_scope = scopes.length > 0 ? scopes[0].slug : '';

    const [bump, setBump] = useState<BumpType>('patch');
    const [changelog, setChangelog] = useState('');
    const [description, setDescription] = useState(state.team?.description || '');
    const [scope, setScope] = useState(default_scope);
    const [publishing, setPublishing] = useState(false);
    const [error, setError] = useState('');
    const [published_url, setPublishedUrl] = useState('');
    const [published_version, setPublishedVersion] = useState('');

    /* Registry state — seeded from the builder store, then confirmed by the API. */
    const [current_version, setCurrentVersion] = useState<string | null>(state.team?.version ?? null);
    const [loading_version, setLoadingVersion] = useState(!state.team?.version);

    const [searchParams] = useSearchParams();
    const draft_id = searchParams.get('draft');

    const is_initial = current_version === null;
    const next_version = is_initial
        ? '1.0.0'
        : compute_next_version(current_version, bump);

    /* Fetch the current published version on mount. */
    useEffect(() => {
        if (!state.team) return;

        authFetch('/v1/teams/get_versions', {
            method: 'POST',
            body: JSON.stringify({ name: team_slug, scope: scope || undefined }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (data.ok && data.data?.version) {
                    setCurrentVersion(data.data.version);
                }
            })
            .catch(() => { /* First publish — no version found */ })
            .finally(() => setLoadingVersion(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!state.team) return null;

    const [team_slug, set_team_slug] = useState(
        state.team.name.replace(/^@[^/]+\//, ''),
    );

    const is_edit = searchParams.get('view') === '1';
    const [name_conflict, set_name_conflict] = useState<string | null>(null);
    const slug_check_timer = useRef<ReturnType<typeof setTimeout>>(undefined);

    /** Re-check name availability when slug or scope changes. */
    useEffect(() => {
        set_name_conflict(null);
        if (!team_slug || is_edit) return;

        clearTimeout(slug_check_timer.current);
        slug_check_timer.current = setTimeout(() => {
            authFetch('/v1/teams/get_versions', {
                method: 'POST',
                body: JSON.stringify({ name: team_slug, scope: scope || undefined }),
            })
                .then((res) => res.json())
                .then((data) => {
                    if (data.ok && data.data?.version) {
                        set_name_conflict(`@${scope}/${team_slug} already exists. Choose a different name.`);
                    } else {
                        set_name_conflict(null);
                    }
                })
                .catch(() => {});
        }, 500);

        return () => clearTimeout(slug_check_timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [team_slug, scope]);

    async function handle_publish() {
        if (!state.team) return;

        if (name_conflict) {
            setError(name_conflict);
            return;
        }

        const slug_error = validate_slug(team_slug);
        if (slug_error) {
            setError(slug_error);
            return;
        }

        if (state.validation && !state.validation.valid) {
            setError(state.validation.errors[0] || 'Fix validation errors before publishing');
            return;
        }

        setPublishing(true);
        setError('');

        try {
            const team_yml_content = build_team_yml({
                ...state.team,
                roles: state.team.roles.map(r => ({ name: r.name, content: r.content })),
            });
            const roles_content = state.team.roles.map(r => ({
                name: r.name,
                content: r.content,
            }));

            const package_data = {
                'team.yml': team_yml_content,
                roles: roles_content,
            };

            const data_base64 = btoa(unescape(encodeURIComponent(JSON.stringify(package_data))));

            const agents: Record<string, Record<string, unknown>> = {};
            const agent_uploads: Record<string, string> = {};
            for (const a of state.team.agents) {
                const def: Record<string, unknown> = {};
                if (a.entry) def.entry = a.entry;
                if (a.env?.length) def.env = a.env;
                agents[a.name] = def;
                if (a.upload_data) {
                    agent_uploads[a.name] = a.upload_data;
                }
            }

            const body: Record<string, unknown> = {
                name: team_slug,
                scope: scope || undefined,
                changelog: changelog || undefined,
                description,
                tags: state.team.tags || [],
                visibility: 'public',
                data_base64,
                agents: Object.keys(agents).length > 0 ? agents : undefined,
                agent_uploads: Object.keys(agent_uploads).length > 0 ? agent_uploads : undefined,
            };

            if (is_initial) {
                body.version = '1.0.0';
            }
            if (!is_initial) {
                body.bump = bump;
            }

            const res = await authFetch('/v1/teams/publish', {
                method: 'POST',
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!data.ok) {
                setError(data.error?.message || 'Publish failed');
                setPublishing(false);
                return;
            }

            const resolved = data.data?.version || next_version;
            setPublishedVersion(resolved);

            const team_scope = scope || '_';
            setPublishedUrl(`/browse/${team_scope}/${team_slug}`);
            dispatch({ type: 'SET_DIRTY', dirty: false });
            clear_builder_session_restores();

            // Publish already flips the draft team to published — no separate delete.
            if (draft_id) {
                dispatch({ type: 'SET_DRAFT_ID', draft_id: null });
            }
        } catch {
            setError('Network error — please try again');
        } finally {
            setPublishing(false);
        }
    }

    /* ---- Success screen ---- */

    if (published_url) {
        return (
            <div className="w-full max-w-lg px-5 py-6">
                <div className="mx-auto max-w-lg text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                        <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h2 className="text-lg font-semibold tracking-tight">Published!</h2>
                    <p className="mt-1 text-xs text-slate-500">
                        v{published_version} is now live on CliqHub.
                    </p>

                    <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                        <code className="text-xs font-semibold text-indigo-900">
                            cliq team install {scope ? `@${scope}/` : ''}{team_slug}
                        </code>
                    </div>

                    <div className="mt-4 flex justify-center gap-2">
                        <a
                            href="/teams"
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                            Go to Teams
                        </a>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                            Back to Builder
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    /* ---- Publish form (full-width inline) ---- */

    return (
        <div className="w-full max-w-lg px-5 py-4">
            <div className="mt-2">
                <h2 className="text-base font-semibold tracking-tight text-slate-900">Publish to CliqHub</h2>
                <p className="mt-0.5 text-xs text-slate-500">Release this team to the registry.</p>

                <div className="mb-4">
                    <label className="mb-1 block text-xs font-bold text-slate-700">Team Name</label>
                    <div className={`flex items-center rounded-lg border px-2.5 py-1.5 ${
                        name_conflict ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'
                    }`}>
                        <span className="font-mono text-xs text-slate-500">{scope ? `@${scope}/` : ''}</span>
                        <input
                            value={team_slug}
                            onChange={(e) => set_team_slug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                            className="flex-1 bg-transparent font-mono text-xs font-bold text-slate-900 outline-none"
                            placeholder="team-name"
                        />
                        {!loading_version && current_version && !name_conflict && (
                            <span className="ml-2 text-xs font-normal text-slate-400">v{current_version}</span>
                        )}
                    </div>
                    {name_conflict && (
                        <p className="mt-1 text-[11px] text-red-600">{name_conflict}</p>
                    )}
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400"
                            rows={2}
                            placeholder="One-line description for the listing..."
                        />
                    </div>

                    {/* Version section */}
                    <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">Version</label>
                        {loading_version ? (
                            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-400">
                                Checking registry...
                            </div>
                        ) : is_initial ? (
                            <div className="flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800">
                                v1.0.0 <span className="ml-2 font-normal text-emerald-600">(initial release)</span>
                            </div>
                        ) : (
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    Current: <span className="font-mono font-semibold text-slate-700">v{current_version}</span>
                                </div>
                                <div className="flex gap-1.5">
                                    {(['patch', 'minor', 'major'] as BumpType[]).map((b) => (
                                        <button
                                            key={b}
                                            onClick={() => setBump(b)}
                                            className={`flex-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                                                bump === b
                                                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                                    : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                            }`}
                                        >
                                            {b}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-800">
                                    v{next_version}
                                </div>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">Scope</label>
                        {scopes.length <= 1 ? (
                            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
                                @{scope}
                            </div>
                        ) : (
                            <select
                                value={scope}
                                onChange={(e) => setScope(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400"
                            >
                                {grouped.personal.length > 0 && (
                                    <optgroup label="Personal">
                                        {grouped.personal.map((s) => (
                                            <option key={s.slug} value={s.slug}>@{s.slug}</option>
                                        ))}
                                    </optgroup>
                                )}
                                {grouped.org.length > 0 && (
                                    <optgroup label="Organization">
                                        {grouped.org.map((s) => (
                                            <option key={s.slug} value={s.slug}>@{s.slug}</option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                        )}
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">Changelog</label>
                        <textarea
                            value={changelog}
                            onChange={(e) => setChangelog(e.target.value)}
                            className="w-full resize-none rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-400"
                            rows={2}
                            placeholder="What's new in this version..."
                        />
                    </div>
                </div>

                {error && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                        {error}
                    </div>
                )}

                {state.validation && !state.validation.valid && (
                    <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                        Fix validation errors before publishing.
                        <ul className="mt-1 list-disc pl-3 text-[11px]">
                            {state.validation.errors.slice(0, 5).map((err) => (
                                <li key={err}>{err}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="mt-4 flex gap-2">
                    <button
                        onClick={handle_publish}
                        disabled={publishing || loading_version || Boolean(name_conflict) || Boolean(state.validation && !state.validation.valid)}
                        className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {publishing ? 'Publishing...' : `Publish v${next_version}`}
                    </button>
                    <button
                        onClick={onClose}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}
