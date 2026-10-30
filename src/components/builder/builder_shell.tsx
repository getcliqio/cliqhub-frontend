import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { BuilderProvider, useBuilder, useBuilderDispatch, type Builder_source } from '@/lib/builder/store';
import { detail_from_files } from '@/lib/builder/publish';
import {
	BUILDER_SESSION_KEYS,
	read_builder_session_team,
} from '@/lib/builder/session_restore';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import { builder_team_from_detail } from '@/lib/team_builder';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { SparkPage } from './spark_page';
import { CanvasView } from './canvas_view';

/** Restores team state from sessionStorage or URL params on mount. */
export function StateRestorer() {
	const dispatch = useBuilderDispatch();
	const state = useBuilder();
	const [searchParams] = useSearchParams();
	const { user } = useAuth();
	const authFetch = useOrgFetch();
	const [load_error, set_load_error] = useState<string | null>(null);

	useEffect(() => {
		// Already on canvas with a team — nothing to do (avoids clobbering edits).
		if (state.view === 'canvas' && state.team) return;

		const fork_team = read_builder_session_team(BUILDER_SESSION_KEYS.fork);
		if (fork_team) {
			dispatch({ type: 'SET_TEAM', team: fork_team, validation: null });
			return;
		}

		const view_team = read_builder_session_team(BUILDER_SESSION_KEYS.view);
		if (view_team) {
			dispatch({ type: 'SET_TEAM', team: view_team, validation: null });
			return;
		}
		// Stale ?view=1 / ?fork=1 without session → fall through to start page
		if (searchParams.get('view') === '1' || searchParams.get('fork') === '1') {
			/* keep spark */
		}

		const publish_team = read_builder_session_team(BUILDER_SESSION_KEYS.publish);
		if (publish_team) {
			dispatch({ type: 'SET_TEAM', team: publish_team, validation: null });
			return;
		}
		if (searchParams.get('publish') === '1') {
			/* keep spark unless session present */
		}

		// ?draft=<team id>: a saved team. Its open draft wins unless ?fresh=1 (start from the latest version;
		// the first save starts a new draft). The builder saves into the draft it opened (PLAN-team-bundle S1.3c).
		const draft_id = searchParams.get('draft');
		if (draft_id && user) {
			const post = (url: string, body: Record<string, unknown>) =>
				authFetch(url, { method: 'POST', body: JSON.stringify(body) }).then((res) => res.json());
			(async () => {
				const data = await post('/v1/teams/get_by_id', { team_id: draft_id });
				if (!data.ok) {
					set_load_error(data.error?.message || 'Failed to load draft');
					return;
				}
				const d = data.data as Record<string, unknown> & { name?: string; scope?: string | null; latest_version?: string | null; status?: string; visibility?: string; draft?: { version_id: string; saved_at: string | null } | null };
				let copy: Builder_source['copy'] = null;
				if (d.draft?.version_id && searchParams.get('fresh') !== '1') {
					const f = await post('/v1/teams/files/get', { team_id: draft_id, version_id: d.draft.version_id, content: true });
					if (!f.ok) {
						set_load_error(f.error?.message || 'Failed to load draft');
						return;
					}
					const files = Object.fromEntries((f.data?.files as Array<{ path: string; content?: string }> ?? []).map((x) => [x.path, x.content ?? '']));
					copy = { version_id: d.draft.version_id, saved_at: d.draft.saved_at ?? null, files };
				}
				const opts = { label: d.scope ? `@${d.scope}/${d.name}` : String(d.name ?? ''), version: d.latest_version ?? null };
				// The draft's own files, else the published version (its team.yml).
				const team = copy ? builder_team_from_detail({ ...d, ...detail_from_files(copy.files) }, opts) : builder_team_from_detail(d, opts);
				if (!team) return;
				dispatch({ type: 'SET_TEAM', team, validation: null });
				dispatch({ type: 'SET_DRAFT_ID', draft_id, version_id: copy?.version_id ?? null });
				dispatch({ type: 'SET_SOURCE', source: { published: d.status === 'published' && d.visibility !== 'draft', copy } });
			})().catch(() => {
				set_load_error('Network error — could not load draft');
			});
		}
	}, [dispatch, searchParams, user, authFetch, state.view, state.team]);

	return <ApiErrorBanner error={load_error} onDismiss={() => set_load_error(null)} className="mx-4 mt-4" />;
}

/**
 * Reads the builder context view and renders the appropriate content.
 * Exported so the builder page can use it directly with BuilderProvider
 * at a stable tree position.
 */
export function BuilderContent() {
	const state = useBuilder();

	if (state.view === 'spark') {
		return <SparkPage />;
	}

	return <CanvasView />;
}

/**
 * Self-contained builder shell with its own provider.
 * Use when the parent doesn't need to react to view changes
 * (i.e. when the layout doesn't change based on the builder view).
 */
export function BuilderShell() {
	return (
		<BuilderProvider>
			<Suspense>
				<StateRestorer />
				<BuilderContent />
			</Suspense>
		</BuilderProvider>
	);
}
