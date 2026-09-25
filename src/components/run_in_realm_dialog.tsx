import { useCallback, useEffect, useState } from 'react';
import { useOrgFetch, useOrg } from '@/lib/org_context';
import { parse_run_inputs_text } from '@/lib/realm_teams_coverage';
import { ChannelUserPicker } from '@/components/channel_user_picker';
import { hub_payload } from '@/lib/hub_envelope';

interface Realm_option {
	id: string;
	slug: string;
	name: string;
}

interface Input_spec {
	name: string;
	description?: string;
	required?: boolean;
	type?: string;
	label?: string;
	help?: string;
}

/**
 * Inputs / metadata to seed the form with — used by "Run again" on
 * the run detail page to copy the previous run's inputs forward.
 *
 * Keys that match a declared team input go straight into that field.
 * Keys the team doesn't declare land in the Extras textarea as
 * `key=value` lines (matching the format that `parse_run_inputs_text`
 * emits — round-trip stable).
 */
export interface Run_prefill {
	inputs: Record<string, unknown>;
	run_name?: string | null;
	workspace_path?: string | null;
	source_run_id?: string | null;
}

/**
 * Coerce an arbitrary input value into the string a text field can
 * hold. Objects / arrays are JSON-stringified; the user can edit
 * the JSON in-place before submit.
 */
function coerce_prefill_value(v: unknown): string {
	if (v == null) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
}

/**
 * Split a prefill payload into (declared, extras) buckets based on
 * the team's declared input spec. Extras are formatted as one
 * `key=value` line per entry — the same shape the extras textarea
 * emits, so a round-trip through "Run again → submit" preserves
 * everything the parser can see.
 */
export function split_prefill_by_spec(
	prefill: Run_prefill,
	spec: readonly Input_spec[],
): { declared: Record<string, string>; extras_text: string } {
	const declared_names = new Set(spec.map((s) => s.name));
	const declared: Record<string, string> = {};
	const extras_lines: string[] = [];
	for (const [k, v] of Object.entries(prefill.inputs)) {
		if (declared_names.has(k)) {
			declared[k] = coerce_prefill_value(v);
			continue;
		}
		extras_lines.push(`${k}=${coerce_prefill_value(v)}`);
	}
	return { declared, extras_text: extras_lines.join('\n') };
}

function api_error_message(data: { error?: string | { message?: string } }): string {
	if (typeof data.error === 'string') return data.error;
	return data.error?.message ?? 'Request failed';
}

const MULTILINE_TOKENS = [
	'schema', 'description', 'body', 'config', 'yaml', 'json',
	'sql', 'query', 'template', 'prompt', 'text', 'markdown',
	'instructions', 'rules', 'context', 'notes',
] as const;

function is_multiline_input(spec: Input_spec): boolean {
	const name = spec.name.toLowerCase();
	if (MULTILINE_TOKENS.some((t) => name.includes(t))) return true;
	return (spec.description ?? '').trim().length > 140;
}

function normalize_inputs(raw: unknown): Input_spec[] {
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

/**
 * Start a run of a published team on a realm where it is installed.
 * Realm picker is filtered to team-list membership (optional fixed realm).
 */
export function Run_in_realm_dialog({
	scope,
	slug,
	fixed_realm,
	prefill_from,
	on_close,
}: {
	scope: string;
	slug: string;
	/** When set (realm team detail), skip the realm picker. */
	fixed_realm?: { id: string; slug: string; name: string };
	/**
	 * When set, seed the form with the given inputs — used by
	 * "Run again" on the run detail page to copy a prior run's
	 * inputs into a fresh form the user can tweak before submit.
	 * `null`/undefined = blank form (original behaviour).
	 */
	prefill_from?: Run_prefill | null;
	on_close: () => void;
}) {
	const auth_fetch = useOrgFetch();
	const { current_id } = useOrg();
	const [realms, set_realms] = useState<Realm_option[]>([]);
	const [loading_realms, set_loading_realms] = useState(!fixed_realm);
	const [selected, set_selected] = useState(fixed_realm?.id ?? '');
	const [filter, set_filter] = useState('');
	const [inputs_spec, set_inputs_spec] = useState<Input_spec[]>([]);
	const [input_values, set_input_values] = useState<Record<string, string>>({});
	const [loading_inputs, set_loading_inputs] = useState(true);
	const [run_name, set_run_name] = useState(prefill_from?.run_name ?? '');
	const [workspace_path, set_workspace_path] = useState(prefill_from?.workspace_path ?? '');
	const [extra_inputs_text, set_extra_inputs_text] = useState('');
	const [submitting, set_submitting] = useState(false);
	const [error, set_error] = useState<string | null>(null);

	const team_label = `@${scope}/${slug}`;

	const load_realms = useCallback(async () => {
		if (fixed_realm) {
			set_realms([fixed_realm]);
			set_selected(fixed_realm.id);
			set_loading_realms(false);
			return;
		}
		set_loading_realms(true);
		set_error(null);
		try {
			const body: Record<string, unknown> = { limit: 100, offset: 0 };
			if (current_id) body.org_id = current_id;
			const res = await auth_fetch('/v1/realms/get', {
				method: 'POST',
				body: JSON.stringify(body),
			});
			const data = await res.json();
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			const all = (data.realms ?? []) as Realm_option[];
			const checks = await Promise.all(
				all.map(async (r) => {
					try {
						const tl_res = await auth_fetch('/v1/teams/get', {
							method: 'POST',
							body: JSON.stringify({ realm_id: r.id }),
						});
						const tl = await tl_res.json() as {
							ok?: boolean;
							teams?: Array<{ scope?: string; slug?: string }>;
							team_list?: Array<{ scope?: string; slug?: string }>;
							rows?: Array<{ scope?: string; slug?: string }>;
							data?: {
								teams?: Array<{ scope?: string; slug?: string }>;
								rows?: Array<{ scope?: string; slug?: string }>;
							};
						};
						if (!tl.ok) return null;
						const roster = tl.data?.teams
							?? tl.teams
							?? tl.data?.rows
							?? tl.rows
							?? tl.team_list
							?? [];
						const hit = roster.some(
							(t) => t.scope === scope && t.slug === slug,
						);
						return hit ? r : null;
					} catch {
						return null;
					}
				}),
			);
			const installed = checks.filter((r): r is Realm_option => r !== null);
			set_realms(installed);
			if (installed[0]) set_selected(installed[0].id);
		} catch {
			set_error('Failed to load realms');
		} finally {
			set_loading_realms(false);
		}
	}, [auth_fetch, current_id, fixed_realm, scope, slug]);

	const load_inputs = useCallback(async () => {
		set_loading_inputs(true);
		try {
			const res = await auth_fetch('/v1/teams/get_by_id', {
				method: 'POST',
				body: JSON.stringify({ scope, name: slug }),
			});
			const data = await res.json() as { ok?: boolean; data?: { inputs?: unknown }; inputs?: unknown };
			/** The Hub wraps the detail DTO under `data` (BFF) or at the top level. */
			const raw_inputs = data.data?.inputs ?? data.inputs;
			const spec = data.ok ? normalize_inputs(raw_inputs) : [];
			set_inputs_spec(spec);
			// Seed the field values. When a prefill is present, apply
			// declared-key values now — undeclared keys go into the
			// extras textarea (see split_prefill_by_spec) so the round
			// trip through submit is stable. Without prefill, all
			// fields start blank as before.
			if (prefill_from) {
				const { declared, extras_text } = split_prefill_by_spec(prefill_from, spec);
				set_input_values(Object.fromEntries(spec.map((s) => [s.name, declared[s.name] ?? ''])));
				if (extras_text) set_extra_inputs_text(extras_text);
				return;
			}
			set_input_values(Object.fromEntries(spec.map((s) => [s.name, ''])));
		} catch {
			set_inputs_spec([]);
		} finally {
			set_loading_inputs(false);
		}
	}, [auth_fetch, scope, slug, prefill_from]);

	useEffect(() => {
		void load_realms();
		void load_inputs();
	}, [load_realms, load_inputs]);

	const filtered = filter.trim()
		? realms.filter((r) => {
			const q = filter.toLowerCase();
			return r.slug.toLowerCase().includes(q) || r.name.toLowerCase().includes(q);
		})
		: realms;

	const selected_realm = realms.find((r) => r.id === selected) ?? fixed_realm ?? null;

	async function submit() {
		if (!selected_realm) return;
		set_submitting(true);
		set_error(null);
		try {
			/** Block submission when any required input is blank. */
			const missing = inputs_spec
				.filter((s) => {
					if (!s.required) return false;
					const val = (input_values[s.name] ?? '').trim();
					/** Channel inputs are comma-separated — empty after split = missing. */
					if (s.type === 'channel') {
						return val.split(',').map((v) => v.trim()).filter(Boolean).length === 0;
					}
					return !val;
				})
				.map((s) => s.name);
			if (missing.length > 0) {
				set_error(`Required input${missing.length > 1 ? 's' : ''} missing: ${missing.join(', ')}`);
				set_submitting(false);
				return;
			}

			/** Build the declared inputs, converting channel values to arrays. */
			const declared: Record<string, unknown> = {};
			for (const spec of inputs_spec) {
				const val = (input_values[spec.name] ?? '').trim();
				if (!val) continue;
				if (spec.type === 'channel') {
					declared[spec.name] = val.split(',').map((v) => v.trim()).filter(Boolean);
				} else {
					declared[spec.name] = val;
				}
			}
			const extras = parse_run_inputs_text(extra_inputs_text);
			const inputs = { ...declared, ...extras };
			const payload: Record<string, unknown> = {
				team_id: `${scope}/${slug}`,
				inputs,
			};
			if (run_name.trim()) payload.run_name = run_name.trim();
			if (workspace_path.trim()) payload.workspace_path = workspace_path.trim();

			const res = await auth_fetch('/v1/runs/enqueue', {
				method: 'POST',
				body: JSON.stringify({
					realm_id: selected_realm.id,
					payload,
				}),
			});
			const data = await res.json() as {
				ok?: boolean;
				error?: string | { message?: string };
			};
			if (!data.ok) {
				set_error(api_error_message(data));
				return;
			}
			const item = hub_payload<{ item?: { status?: string; error?: string | null; run_id?: string | null } }>(data)?.item;
			if (item?.status === 'failed') {
				set_error(item.error?.trim() || 'Run failed to start on any daemon');
				return;
			}
			if (item?.status === 'queued' || item?.status === 'offered') {
				set_error(
					'Run was queued but no daemon claimed it — check that a daemon is online in this realm',
				);
				return;
			}
			on_close();
		} catch {
			set_error('Failed to start run');
		} finally {
			set_submitting(false);
		}
	}

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={`Run ${team_label} in a realm`}
			className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50 p-0 sm:items-center sm:p-6"
			onClick={(e) => {
				if (e.target === e.currentTarget) on_close();
			}}
		>
			<div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:h-auto sm:max-h-[calc(100vh-4rem)] sm:w-full sm:max-w-2xl sm:rounded-2xl sm:border sm:border-slate-200 sm:dark:border-slate-700">
				<header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
					<div className="min-w-0">
						<p className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
							Run in realm
						</p>
						<p className="mt-0.5 truncate font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
							{team_label}
						</p>
						<p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
							Pick a realm where this team is installed. An online daemon claims the run.
						</p>
						{prefill_from ? (
							<p
								data-testid="prefill-source-hint"
								className="mt-2 inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
							>
								Inputs prefilled
								{prefill_from.source_run_id
									? <> from run <span className="font-mono">{prefill_from.source_run_id.slice(0, 8)}</span></>
									: null}
								— tweak before starting.
							</p>
						) : null}
					</div>
					<button
						type="button"
						onClick={on_close}
						className="text-xs font-semibold text-slate-400 hover:text-slate-700"
					>
						Close
					</button>
				</header>

				<div className="flex-1 overflow-y-auto px-5 py-4">
						<div className="grid gap-4">
							{!fixed_realm ? (
								<div>
									<p className="text-[10px] font-semibold uppercase text-slate-400">
										Realm
									</p>
									{loading_realms ? (
										<p className="mt-1 text-xs text-slate-400">Loading installed realms…</p>
									) : realms.length === 0 ? (
										<p className="mt-1 text-sm text-slate-500">
											Not installed in any of your realms yet.{' '}
											<span className="font-semibold text-slate-700">
												Use Install to realm first.
											</span>
										</p>
									) : (
										<>
											{realms.length > 5 ? (
												<input
													value={filter}
													onChange={(e) => set_filter(e.target.value)}
													placeholder="Filter realms…"
													className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-950"
												/>
											) : null}
											<select
												value={selected}
												onChange={(e) => set_selected(e.target.value)}
												className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
											>
												{filtered.map((r) => (
													<option key={r.id} value={r.id}>
														{r.name} ({r.slug})
													</option>
												))}
											</select>
										</>
									)}
								</div>
							) : (
								<p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
									Realm:{' '}
									<span className="font-semibold">
										{fixed_realm.name || fixed_realm.slug}
									</span>
								</p>
							)}

							<div className="grid gap-4 sm:grid-cols-2">
								<label className="block">
									<span className="text-[10px] font-semibold uppercase text-slate-400">
										Run name <span className="font-normal normal-case">(optional)</span>
									</span>
									<input
										type="text"
										value={run_name}
										onChange={(e) => set_run_name(e.target.value)}
										placeholder="Leave blank to auto-generate"
										className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
									/>
								</label>
								<label className="block">
									<span className="text-[10px] font-semibold uppercase text-slate-400">
										Workspace path <span className="font-normal normal-case">(optional)</span>
									</span>
									<input
										type="text"
										value={workspace_path}
										onChange={(e) => set_workspace_path(e.target.value)}
										placeholder="/path/on/daemon"
										className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
									/>
								</label>
							</div>

							<div>
								<p className="text-[10px] font-semibold uppercase text-slate-400">Team inputs</p>
								{loading_inputs ? (
									<p className="mt-1 text-xs text-slate-400">Loading declared inputs…</p>
								) : inputs_spec.length === 0 ? (
									<p className="mt-1 text-[11px] text-slate-500">
										No declared inputs. Use Extras below if needed.
									</p>
								) : (
									<div className="mt-2 grid gap-3">
										{inputs_spec.map((spec) => {
											const multiline = is_multiline_input(spec);
											const display_label = spec.label || spec.name;
											const help_text = spec.help || spec.description;

											/** Channel inputs use the searchable picker. */
											if (spec.type === 'channel') {
												const selected_arr = (input_values[spec.name] ?? '')
													.split(',').map((s) => s.trim()).filter(Boolean);
												return (
													<div key={spec.name} className="block">
														<span className="block font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">
															{display_label}
															{spec.required ? <span className="ml-1 text-red-500" title="Required">*</span> : null}
														</span>
														{help_text ? (
															<span className="mt-0.5 block text-[11px] text-slate-500">
																{help_text}
															</span>
														) : null}
														<ChannelUserPicker
															selected={selected_arr}
															on_change={(next) => set_input_values((prev) => ({
																...prev,
																[spec.name]: next.join(','),
															}))}
															placeholder="Search users or channels…"
															class_name="mt-1"
														/>
													</div>
												);
											}

											return (
												<label key={spec.name} className="block">
													<span className="block font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">
														{display_label}
														{spec.required ? <span className="ml-1 text-red-500" title="Required">*</span> : null}
													</span>
													{help_text ? (
														<span className="mt-0.5 block text-[11px] text-slate-500">
															{help_text}
														</span>
													) : null}
													{multiline ? (
														<textarea
															rows={4}
															value={input_values[spec.name] ?? ''}
															onChange={(e) => set_input_values((prev) => ({
																...prev,
																[spec.name]: e.target.value,
															}))}
															className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
														/>
													) : (
														<input
															type="text"
															value={input_values[spec.name] ?? ''}
															onChange={(e) => set_input_values((prev) => ({
																...prev,
																[spec.name]: e.target.value,
															}))}
															className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
														/>
													)}
												</label>
											);
										})}
									</div>
								)}
							</div>

							<label className="block">
								<span className="text-[10px] font-semibold uppercase text-slate-400">
									Extras <span className="font-normal normal-case">(key=value per line)</span>
								</span>
								<textarea
									rows={3}
									value={extra_inputs_text}
									onChange={(e) => set_extra_inputs_text(e.target.value)}
									placeholder={'claim_id=CLM-1042\nregion=us-west'}
									className="mt-1 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"
								/>
							</label>

							{error ? (
								<p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
									{error}
								</p>
							) : null}
						</div>
				</div>

				<footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
						<button
							type="button"
							onClick={on_close}
							className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800"
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={
								submitting
								|| loading_realms
								|| loading_inputs
								|| (!fixed_realm && realms.length === 0)
								|| !selected
								|| inputs_spec.some((s) => {
									if (!s.required) return false;
									const val = (input_values[s.name] ?? '').trim();
									if (s.type === 'channel') return val.split(',').map((v) => v.trim()).filter(Boolean).length === 0;
									return !val;
								})
							}
							onClick={() => void submit()}
							className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800 disabled:opacity-50"
						>
							{submitting ? 'Starting…' : 'Start run'}
						</button>
				</footer>
			</div>
		</div>
	);
}
