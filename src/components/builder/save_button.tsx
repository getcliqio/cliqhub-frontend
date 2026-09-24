import { useState, useEffect, useRef, useCallback } from 'react';
import { useBuilder, useBuilderDispatch } from '@/lib/builder/store';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';

const LOCAL_DRAFT_KEY = 'cliqhub_local_draft';

export function SaveButton() {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const { user } = useAuth();
	const authFetch = useOrgFetch();
	const [saving, set_saving] = useState(false);
	const [save_error, set_save_error] = useState<string | null>(null);
	const auto_save_ref = useRef<ReturnType<typeof setTimeout>>(undefined);

	const handle_save = useCallback(async () => {
		if (!state.team || !state.dirty || saving) return;
		set_saving(true);
		set_save_error(null);

		try {
			const validate_res = await fetch('/v1/teams/build', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Requested-With': 'XMLHttpRequest',
				},
				body: JSON.stringify({ action: 'validate', team: state.team }),
			});
			const validate_data = await validate_res.json();
			if (!validate_data.ok) {
				set_save_error(validate_data.error?.message || 'Validation failed');
				return;
			}
			const validation = validate_data.data as { valid: boolean; errors: string[]; warnings: string[] };
			dispatch({ type: 'SET_VALIDATION', validation });
			if (!validation.valid) {
				set_save_error(validation.errors[0] || 'Fix validation errors before saving');
				return;
			}

			if (!user) {
				localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({
					title: state.team.name || 'Untitled Team',
					team: state.team,
					saved_at: new Date().toISOString(),
				}));
				dispatch({ type: 'SET_DIRTY', dirty: false });
				return;
			}

			const scope = user.scopes?.[0]?.slug || user.username;
			if (!scope) {
				set_save_error('No scope available to save draft');
				return;
			}

			const team_name = (state.team.name || 'untitled-team')
				.toLowerCase()
				.replace(/[^a-z0-9-]+/g, '-')
				.replace(/^-+|-+$/g, '') || 'untitled-team';

			const endpoint = state.draft_id ? '/v1/teams/update' : '/v1/teams/create';
			const res = await authFetch(endpoint, {
				method: 'POST',
				body: JSON.stringify(
					state.draft_id
						? {
							team_id: state.draft_id,
							description: state.team.description || '',
							team_json: JSON.stringify(state.team),
						}
						: {
							name: team_name,
							scope,
							description: state.team.description || '',
							team_json: JSON.stringify(state.team),
						},
				),
			});

			const data = await res.json();
			if (data.ok && data.data?.id) {
				dispatch({ type: 'SET_DRAFT_ID', draft_id: data.data.id });
				return;
			}
			set_save_error(data.error?.message || 'Save failed — retry');
		} catch {
			set_save_error('Save failed — retry');
		} finally {
			set_saving(false);
		}
	}, [state.team, state.draft_id, state.dirty, saving, user, authFetch, dispatch]);

	/** Auto-save only updates an existing draft — never creates a new one */
	useEffect(() => {
		if (!state.dirty || !state.team || !state.draft_id) return;

		auto_save_ref.current = setTimeout(() => {
			void handle_save();
		}, 30000);

		return () => clearTimeout(auto_save_ref.current);
	}, [state.dirty, state.team, state.draft_id, handle_save]);

	if (!state.team) return null;

	const label = saving
		? 'Saving...'
		: save_error
			? 'Save blocked'
			: state.dirty
				? 'Save Draft'
				: 'Saved';

	const border_class = save_error
		? 'border-amber-300 text-amber-700 hover:bg-amber-50'
		: 'border-slate-200 text-slate-700 hover:bg-slate-50';

	return (
		<button
			type="button"
			onClick={() => void handle_save()}
			disabled={saving || (!state.dirty && !save_error)}
			className={`rounded-md border px-3 py-1 text-xs font-semibold disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700 ${border_class}`}
			title={
				save_error
					? save_error
					: (!user ? 'Saving locally — sign in to save to the cloud' : undefined)
			}
		>
			{label}
		</button>
	);
}
