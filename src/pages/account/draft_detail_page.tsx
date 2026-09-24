import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Pencil, Trash2 } from 'lucide-react';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';
import { normalize_builder_team } from '@/lib/builder/session_restore';
import type { GeneratedTeam } from '@/lib/builder/store';

interface DraftDetail {
	id: string;
	title: string;
	team_json: string;
	created_at: string;
	updated_at: string;
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

function format_when(raw: string): string {
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) return raw;
	return d.toLocaleString();
}

export function Component() {
	const { id: id_param = '' } = useParams();
	const draft_id = id_param;
	const auth_fetch = useOrgFetch();
	const navigate = useNavigate();

	const [draft, set_draft] = useState<DraftDetail | null>(null);
	const [team, set_team] = useState<GeneratedTeam | null>(null);
	const [loading, set_loading] = useState(true);
	const [error, set_error] = useState<string | null>(null);
	const [confirm_delete, set_confirm_delete] = useState(false);
	const [deleting, set_deleting] = useState(false);

	const load = useCallback(async () => {
		if (!draft_id) {
			set_loading(false);
			set_error('Invalid draft');
			return;
		}
		set_loading(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/teams/get_by_id', {
				method: 'POST',
				body: JSON.stringify({ team_id: draft_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				set_draft(null);
				set_team(null);
				return;
			}
			const row = data.data as {
				id: string;
				name: string;
				team_json?: string;
				raw_manifest?: string;
				created_at: string;
				updated_at: string;
			};
			const team_json = row.team_json || row.raw_manifest || '{}';
			set_draft({
				id: row.id,
				title: row.name,
				team_json,
				created_at: row.created_at,
				updated_at: row.updated_at,
			});
			try {
				set_team(normalize_builder_team(JSON.parse(team_json)));
			} catch {
				set_team(null);
			}
		} catch {
			set_error('Network error');
			set_draft(null);
			set_team(null);
		} finally {
			set_loading(false);
		}
	}, [auth_fetch, draft_id]);

	useEffect(() => {
		void load();
	}, [load]);

	const edit_href = useMemo(() => {
		const from = encodeURIComponent(`/teams`);
		return `/builder?draft=${draft_id}&from=${from}`;
	}, [draft_id]);

	async function handle_delete() {
		set_deleting(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/teams/delete', {
				method: 'POST',
				body: JSON.stringify({ team_id: draft_id }),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			navigate('/teams', { replace: true });
		} catch {
			set_error('Failed to delete draft');
		} finally {
			set_deleting(false);
		}
	}

	if (loading) {
		return (
			<div className="flex min-h-[40vh] items-center justify-center">
				<p className="text-sm text-slate-400">Loading draft…</p>
			</div>
		);
	}

	if (!draft) {
		return (
			<div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
				<p className="text-sm text-red-500">{error || 'Draft not found'}</p>
				<Link to="/teams" className="text-sm font-semibold text-indigo-600 hover:underline">
					Back to Teams
				</Link>
			</div>
		);
	}

	const display_name = team?.name?.trim() || draft.title;
	const phase_count = team?.phases?.length ?? 0;
	const role_count = team?.roles?.length ?? 0;
	const agent_count = team?.agents?.length ?? 0;

	return (
		<div className="mx-auto w-full max-w-3xl">
			<Breadcrumbs
				items={[
					{ label: 'Teams', to: '/teams' },
					{ label: 'Drafts', to: '/teams' },
					{ label: display_name },
				]}
			/>

			<div className="mt-1 flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
							Draft
						</span>
						<h1 className="truncate text-2xl font-extrabold tracking-tight text-slate-900">
							{display_name}
						</h1>
					</div>
					{draft.title !== display_name && (
						<p className="mt-1 text-sm text-slate-500">{draft.title}</p>
					)}
					<p className="mt-2 text-xs text-slate-400">
						Updated {format_when(draft.updated_at)}
						{' · '}
						Created {format_when(draft.created_at)}
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Link
						to={edit_href}
						className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
					>
						<Pencil className="h-4 w-4" strokeWidth={2} aria-hidden />
						Continue editing
					</Link>
					{confirm_delete ? (
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={() => void handle_delete()}
								disabled={deleting}
								className="rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
							>
								{deleting ? 'Deleting…' : 'Confirm delete'}
							</button>
							<button
								type="button"
								onClick={() => set_confirm_delete(false)}
								className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
							>
								Cancel
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={() => set_confirm_delete(true)}
							className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
						>
							<Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
							Delete
						</button>
					)}
				</div>
			</div>

			<ApiErrorBanner error={error} onDismiss={() => set_error(null)} className="mt-4" />

			{team?.description ? (
				<p className="mt-6 text-sm leading-relaxed text-slate-600">{team.description}</p>
			) : (
				<p className="mt-6 text-sm text-slate-400">No description yet.</p>
			)}

			<div className="mt-6 grid grid-cols-3 gap-3">
				<div className="rounded-xl border border-slate-200 bg-white p-4">
					<p className="text-xs text-slate-500">Phases</p>
					<p className="mt-1 text-2xl font-semibold text-slate-900">{phase_count}</p>
				</div>
				<div className="rounded-xl border border-slate-200 bg-white p-4">
					<p className="text-xs text-slate-500">Roles</p>
					<p className="mt-1 text-2xl font-semibold text-slate-900">{role_count}</p>
				</div>
				<div className="rounded-xl border border-slate-200 bg-white p-4">
					<p className="text-xs text-slate-500">Agents</p>
					<p className="mt-1 text-2xl font-semibold text-slate-900">{agent_count}</p>
				</div>
			</div>

			{team && phase_count > 0 && (
				<section className="mt-8">
					<h2 className="text-sm font-semibold text-slate-800">Phases</h2>
					<ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
						{team.phases.map((phase) => (
							<li key={phase.name} className="px-4 py-3">
								<p className="text-sm font-semibold text-slate-800">{phase.name}</p>
								<p className="mt-0.5 text-xs text-slate-400">
									{phase.type || 'phase'}
									{phase.agent ? ` · agent ${phase.agent}` : ''}
									{phase.depends_on?.length
										? ` · depends on ${phase.depends_on.join(', ')}`
										: ''}
								</p>
							</li>
						))}
					</ul>
				</section>
			)}

			{team && role_count > 0 && (
				<section className="mt-8">
					<h2 className="text-sm font-semibold text-slate-800">Roles</h2>
					<ul className="mt-3 flex flex-wrap gap-2">
						{team.roles.map((role) => (
							<li
								key={role.name}
								className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700"
							>
								{role.name}
							</li>
						))}
					</ul>
				</section>
			)}

			{!team && (
				<p className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
					This draft has no parseable team definition yet. Open the builder to continue.
				</p>
			)}

			<div className="mt-10 border-t border-slate-100 pt-6">
				<Link
					to={edit_href}
					className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
				>
					Continue editing in builder →
				</Link>
			</div>
		</div>
	);
}
