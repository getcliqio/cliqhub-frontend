import { useState } from 'react';
import { Link } from 'react-router';
import { Play } from 'lucide-react';
import { useOrgFetch } from '@/lib/org_context';
import { use_busy } from '@/lib/use_busy';
import { Quick_run_panel } from '@/components/dispatch/run_dialogs';
import { hub_payload } from '@/lib/hub_envelope';

/** Inline Run for a hub team — same quick-dispatch panel as Home. */
export function Team_run_cta({
	scope,
	name,
	compact = false,
	default_open = false,
	hide_trigger = false,
	on_dismiss,
}: {
	scope: string;
	name: string;
	compact?: boolean;
	default_open?: boolean;
	/** When true, only the panel is shown (parent owns the Run/Close button). */
	hide_trigger?: boolean;
	on_dismiss?: () => void;
}) {
	const auth_fetch = useOrgFetch();
	const { is_busy, run_busy } = use_busy();
	const [open, set_open] = useState(default_open || hide_trigger);
	const [notice, set_notice] = useState<string | null>(null);
	const [error, set_error] = useState<string | null>(null);

	const label = `@${scope}/${name}`;

	async function handle_submit(args: {
		daemon_id: string;
		workspace_id: string;
		workspace_path: string;
		team_id: string;
		inputs?: Record<string, unknown>;
	}) {
		set_error(null);
		set_notice(null);
		await run_busy('team_run', async () => {
			const res = await auth_fetch('/v1/runs/enqueue', {
				method: 'POST',
				body: JSON.stringify({
					daemon_id: args.daemon_id,
					workspace_id: args.workspace_id,
					workspace_path: args.workspace_path,
					team_id: args.team_id,
					inputs: args.inputs,
				}),
			});
			const data = await res.json();
			if (!data.ok) {
				const msg = typeof data.error === 'string'
					? data.error
					: data.error?.message ?? 'Run dispatch failed';
				set_error(msg);
				return;
			}
			const enqueue_payload = hub_payload<{ run_id?: string }>(data);
			const run_id = typeof enqueue_payload?.run_id === 'string' ? enqueue_payload.run_id : null;
			set_notice(run_id
				? `Run started (${run_id.slice(0, 8)}…) — watch Home or the daemon`
				: 'Run started');
			set_open(false);
			on_dismiss?.();
		});
	}

	return (
		<div className={compact ? '' : 'mb-6'}>
			{notice ? (
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
					<span>{notice}</span>
					<Link to="/home" className="font-semibold text-indigo-700 hover:underline">
						Open Home →
					</Link>
				</div>
			) : null}
			{error ? (
				<div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
					{error}
				</div>
			) : null}
			{!open && !hide_trigger ? (
				<button
					type="button"
					onClick={() => {
						set_error(null);
						set_open(true);
					}}
					className={`inline-flex items-center gap-1.5 font-bold text-white ${
						compact
							? 'rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] hover:bg-indigo-700'
							: 'rounded-xl bg-indigo-600 px-4 py-2.5 text-sm hover:bg-indigo-700'
					}`}
				>
					<Play className={compact ? 'h-3 w-3' : 'h-4 w-4'} strokeWidth={2.25} />
					Run
				</button>
			) : null}
			{open ? (
				<div className="space-y-2">
					{!compact && !hide_trigger ? (
						<p className="text-xs text-slate-500">
							Dispatch <span className="font-mono font-semibold text-slate-700">{label}</span> on an online
							daemon — team must already be installed and assembled.
						</p>
					) : null}
					<Quick_run_panel
						target={{ label, scope, name }}
						auth_fetch={auth_fetch}
						submitting={is_busy('team_run')}
						on_submit={(args) => void handle_submit(args)}
						on_cancel={() => {
							set_open(false);
							on_dismiss?.();
						}}
					/>
				</div>
			) : null}
		</div>
	);
}
