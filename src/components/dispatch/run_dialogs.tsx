import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChannelUserPicker } from '@/components/channel_user_picker';

export interface Team_option {
	id: string;
	label: string;
}

export interface Quick_run_target {
	label: string;
	scope: string;
	name: string;
	last_daemon_id?: string | null;
}

/** Declared team input — mirrors the shape from capability_json. */
interface Input_spec {
	name: string;
	description?: string;
	required?: boolean;
	type?: string;
	label?: string;
	help?: string;
}

/** Parse raw inputs array/object from team detail API into Input_spec[]. */
function normalize_input_specs(raw: unknown): Input_spec[] {
	if (!raw) return [];
	if (Array.isArray(raw)) {
		return raw
			.filter((i: unknown): i is Input_spec =>
				!!i
				&& typeof i === 'object'
				&& typeof (i as { name?: unknown }).name === 'string'
				&& !!(i as { name: string }).name.trim(),
			)
			.map((i) => ({
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
			type: typeof (meta as { type?: unknown })?.type === 'string' ? (meta as { type: string }).type : undefined,
			label: typeof (meta as { label?: unknown })?.label === 'string' ? (meta as { label: string }).label : undefined,
			help: typeof (meta as { help?: unknown })?.help === 'string' ? (meta as { help: string }).help : undefined,
		}));
	}
	return [];
}

type AuthFetch = (
	path: string,
	init?: RequestInit,
) => Promise<Response>;

interface Daemon_option {
	id: string;
	label: string;
	status: string;
}

interface Workspace_option {
	id: string;
	path: string;
	name: string | null;
	has_team: boolean;
}

function parse_kv_lines(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eq = trimmed.indexOf('=');
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (!key) continue;
		out[key] = value;
	}
	return out;
}

/** Pick a team and optionally supply run inputs (KEY=value lines). */
export function Run_team_dialog({
	teams,
	title = 'Run team',
	submitting,
	on_submit,
	on_cancel,
}: {
	teams: Team_option[];
	title?: string;
	submitting: boolean;
	on_submit: (team_id: string, inputs?: Record<string, string>) => void;
	on_cancel: () => void;
}) {
	const [team_id, set_team_id] = useState(teams[0]?.id ?? '');
	const [inputs_raw, set_inputs_raw] = useState('');

	const parsed = useMemo(() => parse_kv_lines(inputs_raw), [inputs_raw]);
	const has_inputs = Object.keys(parsed).length > 0;

	return (
		<div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
			<p className="mb-3 text-xs font-bold uppercase tracking-wider text-emerald-700">{title}</p>
			{teams.length === 0 ? (
				<p className="text-xs text-slate-500">No assembled teams on this workspace.</p>
			) : (
				<div className="space-y-3">
					<label className="block">
						<span className="text-[10px] font-semibold uppercase text-slate-400">Team</span>
						<select
							value={team_id}
							onChange={(e) => set_team_id(e.target.value)}
							className="mt-0.5 block w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs"
						>
							{teams.map((t) => (
								<option key={t.id} value={t.id}>{t.label}</option>
							))}
						</select>
					</label>
					<label className="block">
						<span className="text-[10px] font-semibold uppercase text-slate-400">
							Inputs (optional)
						</span>
						<textarea
							value={inputs_raw}
							onChange={(e) => set_inputs_raw(e.target.value)}
							placeholder={'# one per line\nbranch=main\nenv=staging'}
							rows={3}
							className="mt-0.5 block w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs"
						/>
						<span className="mt-1 block text-[10px] text-slate-400">
							KEY=value lines. Leave empty if the team needs no start inputs.
						</span>
					</label>
					<div className="flex gap-2">
						<button
							type="button"
							disabled={!team_id || submitting}
							onClick={() => on_submit(team_id, has_inputs ? parsed : undefined)}
							className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
						>
							{submitting ? 'Starting…' : 'Start run'}
						</button>
						<button
							type="button"
							onClick={on_cancel}
							className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
						>
							Cancel
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

/** Supply inputs when a run is awaiting_input. */
export function Supply_inputs_dialog({
	run_id,
	submitting,
	on_submit,
	on_cancel,
}: {
	run_id: string;
	submitting: boolean;
	on_submit: (inputs: Record<string, string>) => void;
	on_cancel: () => void;
}) {
	const [inputs_raw, set_inputs_raw] = useState('');
	const parsed = useMemo(() => parse_kv_lines(inputs_raw), [inputs_raw]);
	const ready = Object.keys(parsed).length > 0;

	return (
		<div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
			<p className="mb-1 text-xs font-bold uppercase tracking-wider text-amber-700">
				Supply inputs
			</p>
			<p className="mb-3 font-mono text-[10px] text-slate-500">{run_id.slice(0, 8)}…</p>
			<textarea
				value={inputs_raw}
				onChange={(e) => set_inputs_raw(e.target.value)}
				placeholder={'name=value\n# required keys from the phase'}
				rows={3}
				className="block w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs"
			/>
			<div className="mt-3 flex gap-2">
				<button
					type="button"
					disabled={!ready || submitting}
					onClick={() => on_submit(parsed)}
					className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
				>
					{submitting ? 'Sending…' : 'Supply & resume'}
				</button>
				<button
					type="button"
					onClick={on_cancel}
					className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

/**
 * Resume a failed / awaiting_input / crashed run from a specific phase.
 * Backed by the user-facing `/v1/runs/resume` endpoint (optional `from_phase`; cliqhub
 * slice 2.1), which enqueues `/v1/resume` to the run's daemon.
 *
 * We render as an inline card (not a modal) to match the sibling
 * `Supply_inputs_dialog` pattern — the run detail page slots it into
 * the same action strip so users don't have to context-switch.
 *
 * Phase default = the failed phase if we can identify it, else the
 * last non-completed phase, else the first phase. The user can pick
 * any phase to re-run from; the daemon validates it against the
 * workflow.
 */
export interface Resume_phase_option {
	phase: string;
	status?: string | null;
	sequence?: number | null;
}

export function pick_default_resume_phase(
	phases: readonly Resume_phase_option[],
): string {
	if (phases.length === 0) return '';
	const failed = phases.find((p) => {
		const s = (p.status ?? '').toLowerCase();
		return s === 'failed' || s === 'error' || s === 'failure' || s === 'crashed';
	});
	if (failed) return failed.phase;
	const awaiting = phases.find((p) => {
		const s = (p.status ?? '').toLowerCase();
		return s === 'awaiting_input' || s === 'awaiting';
	});
	if (awaiting) return awaiting.phase;
	const last_incomplete = [...phases].reverse().find((p) => {
		const s = (p.status ?? '').toLowerCase();
		return s !== 'completed' && s !== 'complete' && s !== 'done' && s !== 'success' && s !== 'succeeded' && s !== 'skipped';
	});
	return (last_incomplete ?? phases[0]).phase;
}

export function Resume_from_phase_dialog({
	run_id,
	phases,
	submitting,
	on_submit,
	on_cancel,
}: {
	run_id: string;
	phases: readonly Resume_phase_option[];
	submitting: boolean;
	on_submit: (from_phase: string) => void;
	on_cancel: () => void;
}) {
	const [from_phase, set_from_phase] = useState<string>(
		() => pick_default_resume_phase(phases),
	);
	useEffect(() => {
		set_from_phase(pick_default_resume_phase(phases));
	}, [phases]);
	const ready = from_phase.trim().length > 0;

	return (
		<div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4" data-testid="resume-from-phase-dialog">
			<p className="mb-1 text-xs font-bold uppercase tracking-wider text-indigo-700">
				Resume from phase
			</p>
			<p className="mb-3 font-mono text-[10px] text-slate-500">{run_id.slice(0, 8)}…</p>
			{phases.length === 0 ? (
				<p className="mb-3 text-xs text-slate-500">
					No phases recorded yet — cannot pick a resume point.
				</p>
			) : (
				<label className="mb-3 block text-xs text-slate-700">
					<span className="mb-1 block font-semibold text-slate-600">Start from</span>
					<select
						value={from_phase}
						onChange={(e) => set_from_phase(e.target.value)}
						className="block w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs"
						data-testid="resume-from-phase-select"
					>
						{phases.map((p) => (
							<option key={p.phase} value={p.phase}>
								{p.phase}{p.status ? ` — ${p.status}` : ''}
							</option>
						))}
					</select>
				</label>
			)}
			<div className="flex gap-2">
				<button
					type="button"
					disabled={!ready || submitting}
					onClick={() => on_submit(from_phase)}
					className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
					data-testid="resume-from-phase-confirm"
				>
					{submitting ? 'Resuming…' : `Resume from ${from_phase || '…'}`}
				</button>
				<button
					type="button"
					onClick={on_cancel}
					className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

/** Home quick-run: pick online daemon + workspace, dispatch without leaving the page. */
export function Quick_run_panel({
	target,
	auth_fetch,
	submitting,
	on_submit,
	on_cancel,
}: {
	target: Quick_run_target;
	auth_fetch: AuthFetch;
	submitting: boolean;
	on_submit: (args: {
		daemon_id: string;
		workspace_id: string;
		workspace_path: string;
		team_id: string;
		inputs?: Record<string, unknown>;
	}) => void;
	on_cancel: () => void;
}) {
	const [daemons, set_daemons] = useState<Daemon_option[]>([]);
	const [daemon_id, set_daemon_id] = useState('');
	const [workspaces, set_workspaces] = useState<Workspace_option[]>([]);
	const [workspace_id, set_workspace_id] = useState('');
	const [installed_team_id, set_installed_team_id] = useState<string | null>(null);
	const [loading, set_loading] = useState(true);
	const [loading_ws, set_loading_ws] = useState(false);
	const [error, set_error] = useState<string | null>(null);

	/** Declared input specs fetched from team detail API. */
	const [input_specs, set_input_specs] = useState<Input_spec[]>([]);
	const [loading_specs, set_loading_specs] = useState(true);

	/** Typed field values for declared inputs. */
	const [field_values, set_field_values] = useState<Record<string, string>>({});

	/** Channel-type inputs store arrays of selected values. */
	const [channel_values, set_channel_values] = useState<Record<string, string[]>>({});

	/** Free-form KEY=value textarea for undeclared extras. */
	const [extras_raw, set_extras_raw] = useState('');

	const selected_ws = workspaces.find((w) => w.id === workspace_id) ?? null;
	const team_label = `@${target.scope}/${target.name}`;

	/** Separate specs into channel inputs and text inputs. */
	const channel_specs = useMemo(() => input_specs.filter((s) => s.type === 'channel'), [input_specs]);
	const text_specs = useMemo(() => input_specs.filter((s) => s.type !== 'channel'), [input_specs]);

	/** Fetch declared input specs from the team detail API. */
	const load_input_specs = useCallback(async () => {
		set_loading_specs(true);
		try {
			const res = await auth_fetch('/v1/teams/get_by_id', {
				method: 'POST',
				body: JSON.stringify({ scope: target.scope, name: target.name }),
			});
			const data = await res.json() as { ok?: boolean; data?: { inputs?: unknown }; inputs?: unknown };
			const raw_inputs = data.data?.inputs ?? data.inputs;
			const specs = data.ok ? normalize_input_specs(raw_inputs) : [];
			set_input_specs(specs);
			set_field_values(Object.fromEntries(specs.filter((s) => s.type !== 'channel').map((s) => [s.name, ''])));
			set_channel_values(Object.fromEntries(specs.filter((s) => s.type === 'channel').map((s) => [s.name, []])));
		} catch {
			set_input_specs([]);
		} finally {
			set_loading_specs(false);
		}
	}, [auth_fetch, target.scope, target.name]);

	useEffect(() => { void load_input_specs(); }, [load_input_specs]);

	/** Fetch online daemons. */
	useEffect(() => {
		let cancelled = false;
		(async () => {
			set_loading(true);
			set_error(null);
			try {
				const res = await auth_fetch('/v1/daemons/get', {
					method: 'POST',
					body: JSON.stringify({ limit: 50, offset: 0 }),
				});
				const data = await res.json();
				if (cancelled) return;
				const rows = (data.daemons ?? []) as Array<{
					id: string;
					name?: string | null;
					hostname?: string | null;
					status?: string;
				}>;
				const online = rows
					.filter((d) => d.status === 'online')
					.map((d) => ({
						id: d.id,
						label: d.name || d.hostname || d.id.slice(0, 8),
						status: d.status ?? 'online',
					}));
				set_daemons(online);
				const preferred = target.last_daemon_id
					&& online.some((d) => d.id === target.last_daemon_id)
					? target.last_daemon_id
					: online[0]?.id ?? '';
				set_daemon_id(preferred);
				if (online.length === 0) {
					set_error('No online daemons — start cliqd, then try again.');
				}
			} catch {
				if (!cancelled) set_error('Failed to load daemons');
			} finally {
				if (!cancelled) set_loading(false);
			}
		})();
		return () => { cancelled = true; };
	}, [auth_fetch, target.last_daemon_id]);

	/** Fetch workspaces + installed teams when daemon changes. */
	useEffect(() => {
		if (!daemon_id) {
			set_workspaces([]);
			set_workspace_id('');
			set_installed_team_id(null);
			return;
		}
		let cancelled = false;
		(async () => {
			set_loading_ws(true);
			set_error(null);
			try {
				const [teams_res, ws_res] = await Promise.all([
					auth_fetch('/v1/teams/get', {
						method: 'POST',
						body: JSON.stringify({ daemon_id }),
					}),
					auth_fetch('/v1/workspaces/get', {
						method: 'POST',
						body: JSON.stringify({ daemon_id }),
					}),
				]);
				const teams_data = await teams_res.json();
				const ws_data = await ws_res.json();
				if (cancelled) return;

				const daemon_teams = teams_data.data?.payload?.data?.teams
					?? teams_data.data?.teams
					?? teams_data.teams
					?? [];
				const match = (daemon_teams as Array<{
					team_id?: string;
					id?: string;
					scope?: string;
					scope_slug?: string;
					slug?: string;
				}>).find((t) => {
					const scope = t.scope ?? t.scope_slug ?? '';
					const slug = t.slug ?? '';
					return scope === target.scope && slug === target.name;
				});
				const team_id = match?.team_id ?? match?.id ?? null;
				set_installed_team_id(team_id);

				const raw_ws = ws_data.data?.payload?.data?.workspaces
					?? ws_data.data?.workspaces
					?? ws_data.workspaces
					?? [];
				const mapped: Workspace_option[] = (raw_ws as Array<{
					workspace_id?: string;
					id?: string;
					name?: string | null;
					workspace_dir?: string;
					path?: string;
					teams?: Array<{ scope?: string; slug?: string } | string>;
				}>).map((ws) => {
					const labels = (ws.teams ?? []).map((t) => {
						if (typeof t === 'string') return t;
						if (t.scope && t.slug) return `@${t.scope}/${t.slug}`;
						return '';
					});
					return {
						id: ws.workspace_id ?? ws.id ?? '',
						path: ws.workspace_dir ?? ws.path ?? '',
						name: ws.name ?? null,
						has_team: labels.includes(team_label),
					};
				}).filter((w) => w.id && w.path);

				set_workspaces(mapped);
				const preferred = mapped.find((w) => w.has_team) ?? mapped[0] ?? null;
				set_workspace_id(preferred?.id ?? '');

				if (!team_id) {
					set_error(`Team ${team_label} is not installed on this daemon.`);
				} else if (mapped.length === 0) {
					set_error('No workspaces on this daemon — create one from the daemon page.');
				}
			} catch {
				if (!cancelled) set_error('Failed to load workspace data');
			} finally {
				if (!cancelled) set_loading_ws(false);
			}
		})();
		return () => { cancelled = true; };
	}, [auth_fetch, daemon_id, target.scope, target.name, team_label]);

	/** Check if all required inputs are satisfied. */
	const required_satisfied = useMemo(() => {
		for (const spec of input_specs) {
			if (!spec.required) continue;
			if (spec.type === 'channel') {
				if ((channel_values[spec.name] ?? []).length === 0) return false;
			} else {
				if (!(field_values[spec.name] ?? '').trim()) return false;
			}
		}
		return true;
	}, [input_specs, field_values, channel_values]);

	const can_start = Boolean(
		daemon_id && workspace_id && installed_team_id && selected_ws?.path
		&& !submitting && required_satisfied,
	);

	/** Build final inputs from typed fields, channel selections, and extras. */
	function build_inputs(): Record<string, unknown> | undefined {
		const result: Record<string, unknown> = {};
		let has_any = false;

		for (const spec of text_specs) {
			const val = (field_values[spec.name] ?? '').trim();
			if (val) {
				result[spec.name] = val;
				has_any = true;
			}
		}

		for (const spec of channel_specs) {
			const vals = channel_values[spec.name] ?? [];
			if (vals.length > 0) {
				result[spec.name] = vals;
				has_any = true;
			}
		}

		const extras = parse_kv_lines(extras_raw);
		for (const [k, v] of Object.entries(extras)) {
			result[k] = v;
			has_any = true;
		}

		return has_any ? result : undefined;
	}

	return (
		<div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
			<p className="mb-1 text-xs font-bold uppercase tracking-wider text-indigo-700">Run now</p>
			<p className="mb-3 font-mono text-[11px] font-semibold text-slate-800">{team_label}</p>
			{loading ? (
				<p className="text-xs text-slate-500">Finding online daemons…</p>
			) : (
				<div className="space-y-3">
					{error ? <p className="text-xs text-rose-700">{error}</p> : null}
					{daemons.length > 0 ? (
						<label className="block">
							<span className="text-[10px] font-semibold uppercase text-slate-400">Daemon</span>
							<select
								value={daemon_id}
								onChange={(e) => set_daemon_id(e.target.value)}
								className="mt-0.5 block w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
							>
								{daemons.map((d) => (
									<option key={d.id} value={d.id}>{d.label}</option>
								))}
							</select>
						</label>
					) : (
						<p className="text-xs text-slate-600">
							<Link to="/getting-started" className="font-semibold text-indigo-700 hover:underline">
								Get started
							</Link>
							{' '}to enroll a daemon.
						</p>
					)}
					{daemon_id && loading_ws ? (
						<p className="text-xs text-slate-500">Loading workspaces…</p>
					) : null}
					{daemon_id && !loading_ws && workspaces.length > 0 ? (
						<label className="block">
							<span className="text-[10px] font-semibold uppercase text-slate-400">Workspace</span>
							<select
								value={workspace_id}
								onChange={(e) => set_workspace_id(e.target.value)}
								className="mt-0.5 block w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs"
							>
								{workspaces.map((w) => (
									<option key={w.id} value={w.id}>
										{w.name || w.path}{w.has_team ? ' · assembled' : ''}
									</option>
								))}
							</select>
						</label>
					) : null}
					{!installed_team_id && daemon_id && !loading_ws ? (
						<p className="text-xs text-slate-600">
							Install this team on the{' '}
							<Link
								to={`/daemons/${daemon_id}`}
								className="font-semibold text-indigo-700 hover:underline"
							>
								daemon page
							</Link>
							, then come back.
						</p>
					) : null}

					{/* ── Declared inputs ──────────────────────────── */}
					{loading_specs ? (
						<p className="text-xs text-slate-400">Loading inputs…</p>
					) : input_specs.length > 0 ? (
						<div className="space-y-2">
							<p className="text-[10px] font-semibold uppercase text-slate-400">Inputs</p>
							{input_specs.map((spec) => {
								const display_label = spec.label || spec.name;
								const is_channel = spec.type === 'channel';

								if (is_channel) {
									return (
										<div key={spec.name}>
											<span className="text-[10px] font-semibold text-slate-500">
												{display_label}
												{spec.required ? <span className="ml-1 text-rose-500">*</span> : null}
											</span>
											{spec.help ? (
												<p className="mb-1 text-[10px] text-slate-400">{spec.help}</p>
											) : null}
											<ChannelUserPicker
												selected={channel_values[spec.name] ?? []}
												on_change={(next) =>
													set_channel_values((prev) => ({ ...prev, [spec.name]: next }))
												}
												placeholder={`Select ${display_label.toLowerCase()}…`}
											/>
										</div>
									);
								}

								return (
									<label key={spec.name} className="block">
										<span className="text-[10px] font-semibold text-slate-500">
											{display_label}
											{spec.required ? <span className="ml-1 text-rose-500">*</span> : null}
										</span>
										{spec.help ? (
											<p className="mb-0.5 text-[10px] text-slate-400">{spec.help}</p>
										) : null}
										<input
											type="text"
											value={field_values[spec.name] ?? ''}
											onChange={(e) =>
												set_field_values((prev) => ({ ...prev, [spec.name]: e.target.value }))
											}
											placeholder={spec.description || `Enter ${spec.name}`}
											className="mt-0.5 block w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs"
										/>
									</label>
								);
							})}
						</div>
					) : null}

					{/* ── Extras (free-form KEY=value) ─────────────── */}
					<label className="block">
						<span className="text-[10px] font-semibold uppercase text-slate-400">
							{input_specs.length > 0 ? 'Extra inputs' : 'Inputs (optional)'}
						</span>
						<textarea
							value={extras_raw}
							onChange={(e) => set_extras_raw(e.target.value)}
							placeholder={'# one per line\nbranch=main'}
							rows={2}
							className="mt-0.5 block w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono text-xs"
						/>
					</label>
					<div className="flex gap-2">
						<button
							type="button"
							disabled={!can_start}
							onClick={() => {
								if (!installed_team_id || !selected_ws) return;
								on_submit({
									daemon_id,
									workspace_id: selected_ws.id,
									workspace_path: selected_ws.path,
									team_id: installed_team_id,
									inputs: build_inputs(),
								});
							}}
							className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
						>
							{submitting ? 'Starting…' : 'Start run'}
						</button>
						<button
							type="button"
							onClick={on_cancel}
							className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
						>
							Cancel
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
