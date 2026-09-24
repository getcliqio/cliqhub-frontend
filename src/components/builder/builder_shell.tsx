import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { BuilderProvider, useBuilder, useBuilderDispatch } from '@/lib/builder/store';
import {
	BUILDER_SESSION_KEYS,
	normalize_builder_team,
	read_builder_session_team,
} from '@/lib/builder/session_restore';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
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

		const draft_id = searchParams.get('draft');
		if (draft_id && user) {
			authFetch('/v1/teams/get_by_id', {
				method: 'POST',
				body: JSON.stringify({ team_id: draft_id }),
			})
				.then((res) => res.json())
				.then((data) => {
					if (!data.ok) {
						set_load_error(data.error?.message || 'Failed to load draft');
						return;
					}
					const raw = data.data.team_json || data.data.raw_manifest;
					if (!raw) return;
					const team = normalize_builder_team(typeof raw === 'string' ? JSON.parse(raw) : raw);
					if (!team) return;
					dispatch({ type: 'SET_TEAM', team, validation: null });
					dispatch({ type: 'SET_DRAFT_ID', draft_id });
				})
				.catch(() => {
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
