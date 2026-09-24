import { useState, useMemo } from 'react';
import { useBuilder, useBuilderDispatch, type GeneratedPhase, type GeneratedAgent } from '@/lib/builder/store';
import type { SourceEntry, TargetEntry } from '@/lib/types';
import { get_agent_schema, has_attribute, is_required, get_tooltip, type AttributeName } from '@/lib/agent_schema';

/** Inline info icon with hover tooltip. */
function InfoTooltip({ text }: { text: string }) {
    const [visible, setVisible] = useState(false);

    if (!text) return null;

    return (
        <span
            className="relative inline-flex cursor-help"
            onMouseEnter={() => setVisible(true)}
            onMouseLeave={() => setVisible(false)}
            onClick={() => setVisible(v => !v)}
        >
            <span className="text-xs text-slate-400 hover:text-slate-600">&#9432;</span>
            {visible && (
                <span className="absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal text-slate-700 shadow-lg">
                    {text}
                </span>
            )}
        </span>
    );
}

/** Section header with info tooltip and required/optional badge. */
function SectionLabel({ label, required, tooltip, children }: { label: string; required: boolean; tooltip?: string; children?: React.ReactNode }) {
    return (
        <div className="mb-1.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
                <label className="text-sm font-bold text-slate-800">{label}</label>
                <InfoTooltip text={tooltip || ''} />
                {required ? (
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-600">required</span>
                ) : (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-400">optional</span>
                )}
            </div>
            {children}
        </div>
    );
}

function CopyIconButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
			className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
			title="Copy to clipboard"
		>
			{copied ? 'Copied!' : (
				<svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
					<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
				</svg>
			)}
		</button>
	);
}

const TYPE_BADGE_STYLES: Record<string, string> = {
	standard: 'bg-slate-100 text-slate-600',
	gate: 'bg-amber-100 text-amber-700',
	team: 'bg-violet-100 text-violet-700',
};

function validate_phase(phase: GeneratedPhase): string[] {
	const errors: string[] = [];
	const has_commands = phase.commands && phase.commands.length > 0;

	if (phase.type === 'gate' && !has_commands) {
		errors.push('Gate phases require at least one command');
	}
	if (phase.type === 'standard' && phase.agent === 'exec' && !has_commands) {
		errors.push('Exec phases require at least one command');
	}
	if (phase.agent === 'hug' && !phase.review?.reviewer) {
		errors.push('HUG phases require a reviewer');
	}

	return errors;
}

export function PhaseEditor() {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const [improving, setImproving] = useState(false);
	const [instruction, setInstruction] = useState('');
	const [showInstruction, setShowInstruction] = useState(false);
	const [editingCheck, setEditingCheck] = useState<number | null>(null);
	const [focusMode, setFocusMode] = useState(false);
	const [submit_errors, setSubmitErrors] = useState<string[]>([]);
	const [improve_error, setImproveError] = useState<string | null>(null);

	const phase = state.team?.phases.find(p => p.name === state.selected_phase);
	const role = state.team?.roles.find(r => r.name === state.selected_phase);
	if (!phase || !state.team) return null;

	function update(partial: Partial<GeneratedPhase>) {
		if (!phase) return;
		dispatch({ type: 'UPDATE_PHASE', phase: { ...phase, ...partial } });
	}

	function add_commands() {
		update({ commands: [{ name: 'test', run: 'npm test' }] });
	}

	function remove_all_commands() {
		update({ commands: undefined, max_iterations: undefined });
	}

	function add_command() {
		const commands = [...(phase!.commands || []), { name: '', run: '' }];
		update({ commands });
		setEditingCheck(commands.length - 1);
	}

	function remove_command(index: number) {
		const commands = (phase!.commands || []).filter((_: unknown, i: number) => i !== index);
		if (commands.length === 0) {
			update({ commands: undefined, max_iterations: undefined });
			return;
		}
		update({ commands });
	}

	function toggle_retry(enabled: boolean) {
		update(enabled ? { max_iterations: 3 } : { max_iterations: undefined });
	}

	function remove_dependency(dep: string) {
		dispatch({ type: 'REMOVE_DEPENDENCY', phase: phase!.name, dependency: dep });
	}

	async function handle_improve() {
		if (!role || !state.team) return;
		setImproving(true);
		setImproveError(null);

		try {
			const res = await fetch('/v1/teams/build', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
				body: JSON.stringify({
					action: 'improve_role',
					role_name: role.name,
					role_content: role.content,
					team_name: state.team.name,
					team_description: state.team.description,
					phases: state.team.phases.map(p => p.name),
					instruction: instruction || undefined,
				}),
			});

			const data = await res.json();
			if (data.ok && data.data?.improved_content) {
				dispatch({ type: 'UPDATE_ROLE', name: role.name, content: data.data.improved_content });
				setImproveError(null);
				return;
			}
			setImproveError(data.error?.message || 'Improve failed — try again');
		} catch {
			setImproveError('Network error — try again');
		} finally {
			setImproving(false);
			setInstruction('');
			setShowInstruction(false);
		}
	}

	const is_support = !!phase.is_support;
	const has_commands = phase.commands && phase.commands.length > 0;
	const schema = useMemo(() => get_agent_schema(phase.type, phase.agent), [phase.type, phase.agent]);
	const show = (attr: AttributeName) => has_attribute(schema, attr);
	const req = (attr: AttributeName) => is_required(schema, attr);
	const tip = (attr: AttributeName) => get_tooltip(schema, attr);

	return (
		<>
		{/* Phase sub-header */}
		<div className={`flex items-center gap-2 border-b px-4 py-3 ${phase.pending ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
			<button
				onClick={() => dispatch({ type: 'SELECT_PHASE', name: null })}
				className="text-slate-500 hover:text-slate-800"
			>
				&#9666;
			</button>
			<h3 className="font-mono text-base font-bold text-slate-900">{phase.name}</h3>
			<span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${TYPE_BADGE_STYLES[phase.type] || TYPE_BADGE_STYLES.standard}`}>
				{phase.type}
			</span>
			{phase.pending && (
				<span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-800">
					pending
				</span>
			)}
		</div>

			<div className="flex-1 overflow-y-auto p-4 space-y-5">
				{/* Dependencies */}
				<div>
					<label className="mb-1.5 block text-sm font-bold text-slate-800">Dependencies</label>
					{phase.depends_on.length > 0 ? (
						<div className="space-y-1">
							{phase.depends_on.map((dep) => (
								<div key={dep} className="flex items-center justify-between rounded-lg bg-indigo-50 px-3 py-2">
									<span className="font-mono text-sm text-slate-900">{dep}</span>
									<button
										onClick={() => remove_dependency(dep)}
										className="text-xs text-slate-400 hover:text-red-500"
									>
										✕
									</button>
								</div>
							))}
						</div>
					) : (
						<p className="text-xs text-slate-500">No dependencies (root phase)</p>
					)}
					<AddDependency phase={phase} allPhases={state.team.phases} />
				</div>

			{phase.type !== 'team' && (
			<div>
				<label className="mb-1.5 block text-sm font-bold text-slate-800">Agent</label>
				<AgentDropdown phase={phase} agents={state.team.agents} />
			</div>
			)}

				{/* Phase commands */}
				{show('commands') && !is_support && (
					<div>
						<SectionLabel label="Commands" required={req('commands')} tooltip={tip('commands')} />
						{has_commands ? (
							<>
								<div className="space-y-2">
									{phase.commands!.map((cmd, i) =>
										editingCheck === i ? (
											<div key={i} className="rounded-lg border-2 border-emerald-300 bg-white p-3 shadow-sm">
												<div className="space-y-2.5">
													<div>
														<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Command Name</label>
														<input
															value={cmd.name}
															onChange={(e) => {
																const commands = [...phase.commands!];
																commands[i] = { ...commands[i], name: e.target.value };
																update({ commands });
															}}
															placeholder="e.g. test, lint, typecheck"
															className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400"
															autoFocus
														/>
													</div>
												<div>
													<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Run Command</label>
													<textarea
														value={cmd.run}
														onChange={(e) => {
															const commands = [...phase.commands!];
															commands[i] = { ...commands[i], run: e.target.value };
															update({ commands });
														}}
														rows={2}
														placeholder="e.g. npm test"
														className="w-full resize-none rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm leading-relaxed text-slate-900 outline-none focus:border-indigo-400"
													/>
												</div>
												</div>
												<div className="mt-3 flex items-center justify-between">
													<button onClick={() => remove_command(i)} className="text-sm text-red-500 hover:text-red-700">Remove</button>
													<button onClick={() => setEditingCheck(null)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Done</button>
												</div>
											</div>
									) : (
									<div
										key={i}
										onClick={() => setEditingCheck(i)}
										className="group cursor-pointer rounded-lg border border-slate-200 bg-indigo-50 px-3 py-2.5 transition hover:border-amber-300 hover:bg-amber-50"
										title={`${cmd.name}: ${cmd.run}`}
									>
										<div className="flex items-center justify-between">
											<span className="text-sm font-bold text-slate-900">{cmd.name || 'unnamed'}</span>
											<div className="flex items-center gap-1.5">
												<span className="text-sm text-slate-400 opacity-0 group-hover:opacity-100 transition">✎</span>
												<button
													onClick={(e) => { e.stopPropagation(); remove_command(i); }}
													className="text-sm text-slate-400 hover:text-red-500"
												>✕</button>
											</div>
										</div>
										<code className="mt-1 block font-mono text-sm leading-relaxed text-slate-600 line-clamp-2">{cmd.run || 'no command'}</code>
									</div>
									),
								)}
							</div>
							<button
								onClick={add_command}
								className="mt-2 w-full rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition"
							>
								+ Add command
							</button>
							<button
								onClick={remove_all_commands}
								className="mt-1 text-sm text-red-500 hover:text-red-700"
							>
								Remove all commands
							</button>
						</>
					) : (
						<button
							onClick={add_commands}
							className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition"
						>
							+ Add commands
						</button>
					)}
				</div>
			)}

			{/* Retry loop toggle — only shown when commands exist */}
			{show('max_iterations') && !is_support && has_commands && (
					<div>
						<SectionLabel label="Retry Loop" required={req('max_iterations')} tooltip={tip('max_iterations')} />
						<div className="flex items-center gap-3">
							<button
								onClick={() => toggle_retry(!phase.max_iterations)}
								className={`relative h-5 w-9 rounded-full transition ${
									phase.max_iterations ? 'bg-amber-500' : 'bg-slate-300'
								}`}
							>
								<span
									className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
										phase.max_iterations ? 'left-[18px]' : 'left-0.5'
									}`}
								/>
							</button>
							<span className="text-sm text-slate-700">
								{phase.max_iterations ? 'Enabled' : 'Disabled'}
							</span>
							{phase.max_iterations && (
								<div className="flex items-center gap-1.5">
									<span className="text-xs text-slate-600">max</span>
									<input
										type="number"
										min={1}
										max={10}
										value={phase.max_iterations}
										onChange={(e) => update({ max_iterations: parseInt(e.target.value) || 3 })}
										className="w-14 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-indigo-400"
									/>
									<span className="text-xs text-slate-600">iterations</span>
								</div>
							)}
						</div>
					</div>
				)}

	{show('review') && (
			<ReviewSection phase={phase} on_change={update} required={req('review')} tooltip={tip('review')} />
		)}

		{show('team') && (
			<div>
				<SectionLabel label="Team Reference" required={req('team')} tooltip={tip('team')} />
				<input
					value={phase.team || ''}
					onChange={(e) => update({ team: e.target.value || undefined })}
					placeholder="e.g. @acme/security-scan"
					className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 outline-none focus:border-indigo-400"
				/>
			</div>
		)}

		{show('action') && (
			<div>
				<SectionLabel label="Action" required={req('action')} tooltip={tip('action')} />
				<input
					value={phase.action || ''}
					onChange={(e) => update({ action: e.target.value || undefined })}
					placeholder="e.g. get_issue, query_metrics, create_page"
					className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 outline-none focus:border-indigo-400"
				/>
			</div>
		)}

	{show('sources') && (
		<SourcesSection sources={phase.sources || []} on_change={(sources) => update({ sources: sources.length > 0 ? sources : undefined })} required={req('sources')} tooltip={tip('sources')} />
	)}

	{show('target_entries') && (
		<TargetsSection targets={phase.target_entries || []} on_change={(target_entries) => update({ target_entries: target_entries.length > 0 ? target_entries : undefined })} required={req('target_entries')} tooltip={tip('target_entries')} />
	)}

		{show('inputs') && (
			<div>
				<SectionLabel label="Sub-team Inputs" required={req('inputs')} tooltip={tip('inputs')} />
				<textarea
					value={phase.inputs ? Object.entries(phase.inputs).map(([k, v]) => `${k}: ${v}`).join('\n') : ''}
					onChange={(e) => {
						const lines = e.target.value.split('\n').filter(l => l.trim());
						const parsed: Record<string, string> = {};
						for (const line of lines) {
							const idx = line.indexOf(':');
							if (idx > 0) {
								parsed[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
							}
						}
						update({ inputs: Object.keys(parsed).length > 0 ? parsed : undefined });
					}}
					rows={3}
					placeholder={"key: value\nkey2: $(inputs.from_parent)"}
					className="w-full resize-none rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm leading-relaxed text-slate-900 outline-none focus:border-indigo-400"
				/>
				<p className="mt-1 text-xs text-slate-500">One key: value pair per line. Supports $(inputs.*) templates.</p>
			</div>
		)}

		{show('model') && (
			<div>
				<SectionLabel label="Model" required={req('model')} tooltip={tip('model')} />
				<input
					value={phase.model || ''}
					onChange={(e) => update({ model: e.target.value || undefined })}
					placeholder="e.g. gpt-4o, claude-sonnet-4, gemini-2.5-pro"
					className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 outline-none focus:border-indigo-400"
				/>
				<p className="mt-1 text-xs text-slate-500">Leave empty to use the agent&apos;s default model.</p>
			</div>
		)}

		{show('role') && (
		<div>
			<SectionLabel label="Role" required={req('role')} tooltip={tip('role')}>
				{role && (
					<button
						onClick={() => setShowInstruction(!showInstruction)}
						disabled={improving}
						className="rounded-lg bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-200 disabled:opacity-50"
					>
						{improving ? 'Improving...' : 'AI Improve'}
					</button>
				)}
			</SectionLabel>

			{role ? (
				<>
					{showInstruction && (
						<div className="mb-2">
							<input
								value={instruction}
								onChange={(e) => setInstruction(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handle_improve()}
								placeholder="Focus on... (optional, press Enter)"
								className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-violet-400"
								autoFocus
							/>
							<div className="mt-1.5 flex gap-2">
								<button
									onClick={handle_improve}
									disabled={improving}
									className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
								>
									Improve
								</button>
								<button
									onClick={() => { setShowInstruction(false); setInstruction(''); }}
									className="text-xs text-slate-500 hover:text-slate-700"
								>
									Cancel
								</button>
							</div>
						</div>
					)}
					{improve_error && (
						<div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
							{improve_error}
						</div>
					)}
					<button
						onClick={() => setFocusMode(true)}
						className="w-full rounded-lg border border-slate-200 bg-indigo-50 px-3 py-2 text-left transition hover:border-amber-300 hover:bg-amber-50"
					>
						<span className="font-mono text-sm leading-relaxed text-slate-900 line-clamp-4">
							{role.content || 'Click to edit role...'}
						</span>
						<span className="mt-1 block text-xs text-slate-500">{role.content.length} chars</span>
					</button>

					{focusMode && (
						<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setFocusMode(false)}>
							<div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
								<div className="mb-3 flex items-center justify-between">
									<h3 className="text-lg font-bold text-slate-900">Role: {role.name}</h3>
									<div className="flex items-center gap-2">
										<CopyIconButton text={role.content} />
										<button onClick={() => setFocusMode(false)} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700">
											Done
										</button>
									</div>
								</div>
								<textarea
									value={role.content}
									onChange={(e) => dispatch({ type: 'UPDATE_ROLE', name: role.name, content: e.target.value })}
									className="flex-1 resize-none rounded-lg border border-slate-300 bg-slate-50 p-4 font-mono text-sm leading-relaxed text-slate-900 outline-none focus:border-indigo-400 focus:bg-white"
									spellCheck={false}
									autoFocus
								/>
								<span className="mt-2 text-sm text-slate-500">{role.content.length} chars</span>
							</div>
						</div>
					)}
				</>
			) : (
				<button
					onClick={() => {
						dispatch({ type: 'ADD_ROLE', role: { name: phase.name, content: `# Role: ${phase.name}\n\nDefine this role's responsibilities.` } });
					}}
					className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition"
				>
					+ Create role
				</button>
			)}
		</div>
		)}

			{/* Add to Team / Discard — pending phases only */}
			{phase.pending && (
				<div className="mt-4 space-y-2">
					{submit_errors.length > 0 && (
						<div className="rounded-lg border border-red-200 bg-red-50 p-3">
							{submit_errors.map((err, i) => (
								<p key={i} className="text-sm text-red-700">{err}</p>
							))}
						</div>
					)}
					<button
						onClick={() => {
							const errors = validate_phase(phase);
							if (errors.length > 0) {
								setSubmitErrors(errors);
								return;
							}
							setSubmitErrors([]);
							dispatch({ type: 'CONFIRM_PHASE', name: phase.name });
						}}
						className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 transition"
					>
						Add to Team
					</button>
					<button
						onClick={() => {
							dispatch({ type: 'BATCH', actions: [
								{ type: 'REMOVE_PHASE', name: phase.name },
								{ type: 'SELECT_PHASE', name: null },
							]});
						}}
						className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
					>
						Discard
					</button>
				</div>
			)}

			{/* Delete — confirmed phases only */}
			{!phase.pending && (
				<div className="mt-4">
					<button
						onClick={() => {
							dispatch({ type: 'BATCH', actions: [
								{ type: 'REMOVE_PHASE', name: phase.name },
								{ type: 'SELECT_PHASE', name: null },
							]});
						}}
						className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition"
					>
						Delete Phase
					</button>
				</div>
			)}
			</div>
		</>
	);
}

// Keep in sync with cliq agents.json
const BUILTIN_AGENTS = [
	'claude-api', 'claude-code', 'codex', 'confluence',
	'curl', 'cursor', 'datadog', 'exec',
	'gdrive', 'gemini', 'gemini-api', 'hubspot',
	'hug', 'jira', 'mesh', 'openai-api',
	's3', 'team', 'zendesk',
];

function AgentDropdown({ phase, agents }: { phase: GeneratedPhase; agents: GeneratedAgent[] }) {
	const dispatch = useBuilderDispatch();

	const options = [
		...BUILTIN_AGENTS.map(a => ({ value: a, label: a, builtin: true })),
		...agents.map(a => ({ value: a.name, label: a.name, builtin: false })),
	].sort((a, b) => a.label.localeCompare(b.label));

	return (
		<select
			value={phase.agent || ''}
			onChange={(e) => {
				const val = e.target.value || undefined;
				dispatch({ type: 'UPDATE_PHASE', phase: { ...phase, agent: val } });
			}}
			className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400"
		>
			<option value="">Default (cursor)</option>
			<optgroup label="Built-in">
				{options.filter(o => o.builtin).map(o => (
					<option key={o.value} value={o.value}>{o.label}</option>
				))}
			</optgroup>
			{agents.length > 0 && (
				<optgroup label="Custom">
					{options.filter(o => !o.builtin).map(o => (
						<option key={o.value} value={o.value}>{o.label}</option>
					))}
				</optgroup>
			)}
		</select>
	);
}

function SourcesSection({ sources, on_change, required = false, tooltip }: { sources: SourceEntry[]; on_change: (sources: SourceEntry[]) => void; required?: boolean; tooltip?: string }) {
	const [editing, setEditing] = useState<number | null>(null);

	function add() {
		const next = [...sources, { name: '' }];
		on_change(next);
		setEditing(next.length - 1);
	}

	function remove(i: number) {
		on_change(sources.filter((_, idx) => idx !== i));
		if (editing === i) setEditing(null);
	}

	function set(i: number, partial: Partial<SourceEntry>) {
		const next = [...sources];
		next[i] = { ...next[i], ...partial };
		on_change(next);
	}

	return (
		<div>
			<SectionLabel label="Sources" required={required} tooltip={tooltip} />
			{sources.length > 0 ? (
				<div className="space-y-2">
					{sources.map((entry, i) =>
						editing === i ? (
							<div key={i} className="rounded-lg border-2 border-sky-300 bg-white p-3 shadow-sm space-y-2">
								<div>
									<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Name</label>
									<input
										value={entry.name}
										onChange={(e) => set(i, { name: e.target.value })}
										placeholder="e.g. research-data"
										className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400"
										autoFocus
									/>
								</div>
								<div>
									<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">URL (optional)</label>
									<input
										value={entry.url || ''}
										onChange={(e) => set(i, { url: e.target.value || undefined })}
										placeholder="https://... or $(inputs.data_url)"
										className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400"
									/>
								</div>
								<div>
									<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Ref (optional)</label>
									<input
										value={entry.ref || ''}
										onChange={(e) => set(i, { ref: e.target.value || undefined })}
										placeholder="e.g. main, v1.2.0"
										className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400"
									/>
								</div>
								<div className="mt-2 flex items-center justify-between">
									<button onClick={() => remove(i)} className="text-sm text-red-500 hover:text-red-700">Remove</button>
									<button onClick={() => setEditing(null)} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700">Done</button>
								</div>
							</div>
						) : (
							<div
								key={i}
								onClick={() => setEditing(i)}
								className="group cursor-pointer rounded-lg border border-slate-200 bg-sky-50 px-3 py-2.5 transition hover:border-sky-300"
							>
								<div className="flex items-center justify-between">
									<span className="text-sm font-bold text-slate-900">{entry.name || 'unnamed'}</span>
									<div className="flex items-center gap-1.5">
										<span className="text-sm text-slate-400 opacity-0 group-hover:opacity-100 transition">&#9998;</span>
										<button onClick={(e) => { e.stopPropagation(); remove(i); }} className="text-sm text-slate-400 hover:text-red-500">&#10005;</button>
									</div>
								</div>
								<code className="mt-1 block font-mono text-xs text-slate-500 truncate">{entry.url || entry.ref || 'no url'}</code>
							</div>
						),
					)}
				</div>
			) : null}
			<button
				onClick={add}
				className={`${sources.length > 0 ? 'mt-2 ' : ''}w-full rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 transition`}
			>
				+ Add source
			</button>
		</div>
	);
}

function TargetsSection({ targets, on_change, required = false, tooltip }: { targets: TargetEntry[]; on_change: (targets: TargetEntry[]) => void; required?: boolean; tooltip?: string }) {
	const [editing, setEditing] = useState<number | null>(null);

	function add() {
		const next = [...targets, { name: '', file: '' }];
		on_change(next);
		setEditing(next.length - 1);
	}

	function remove(i: number) {
		on_change(targets.filter((_, idx) => idx !== i));
		if (editing === i) setEditing(null);
	}

	function set(i: number, partial: Partial<TargetEntry>) {
		const next = [...targets];
		next[i] = { ...next[i], ...partial };
		on_change(next);
	}

	return (
		<div>
			<SectionLabel label="Targets" required={required} tooltip={tooltip} />
			{targets.length > 0 ? (
				<div className="space-y-2">
					{targets.map((entry, i) =>
						editing === i ? (
							<div key={i} className="rounded-lg border-2 border-teal-300 bg-white p-3 shadow-sm space-y-2">
								<div>
									<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Name</label>
									<input
										value={entry.name}
										onChange={(e) => set(i, { name: e.target.value })}
										placeholder="e.g. Research Report"
										className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400"
										autoFocus
									/>
								</div>
								<div>
									<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">File (local path)</label>
									<input
										value={entry.file}
										onChange={(e) => set(i, { file: e.target.value })}
										placeholder="e.g. output/report.md"
										className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400"
									/>
								</div>
								<div>
									<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">URL (optional)</label>
									<input
										value={entry.url || ''}
										onChange={(e) => set(i, { url: e.target.value || undefined })}
										placeholder="gdoc://..., gdrive://..., confluence://..."
										className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400"
									/>
								</div>
								<div>
									<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Ref (optional)</label>
									<input
										value={entry.ref || ''}
										onChange={(e) => set(i, { ref: e.target.value || undefined })}
										placeholder="e.g. main, v1.2.0"
										className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-indigo-400"
									/>
								</div>
								<div>
									<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Mode</label>
									<select
										value={entry.mode || 'create'}
										onChange={(e) => set(i, { mode: e.target.value as TargetEntry['mode'] })}
										className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-400"
									>
										<option value="create">create</option>
										<option value="append">append</option>
										<option value="replace">replace</option>
									</select>
								</div>
								<div className="mt-2 flex items-center justify-between">
									<button onClick={() => remove(i)} className="text-sm text-red-500 hover:text-red-700">Remove</button>
									<button onClick={() => setEditing(null)} className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700">Done</button>
								</div>
							</div>
						) : (
							<div
								key={i}
								onClick={() => setEditing(i)}
								className="group cursor-pointer rounded-lg border border-slate-200 bg-teal-50 px-3 py-2.5 transition hover:border-teal-300"
							>
								<div className="flex items-center justify-between">
									<span className="text-sm font-bold text-slate-900">{entry.name || entry.file || 'unnamed'}</span>
									<div className="flex items-center gap-1.5">
										<span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{entry.mode || 'create'}</span>
										<span className="text-sm text-slate-400 opacity-0 group-hover:opacity-100 transition">&#9998;</span>
										<button onClick={(e) => { e.stopPropagation(); remove(i); }} className="text-sm text-slate-400 hover:text-red-500">&#10005;</button>
									</div>
								</div>
								<code className="mt-1 block font-mono text-xs text-slate-500 truncate">{entry.url || entry.file || 'no destination'}</code>
							</div>
						),
					)}
				</div>
			) : null}
			<button
				onClick={add}
				className={`${targets.length > 0 ? 'mt-2 ' : ''}w-full rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 transition`}
			>
				+ Add target
			</button>
		</div>
	);
}

function ReviewSection({ phase, on_change, required = false, tooltip }: { phase: GeneratedPhase; on_change: (partial: Partial<GeneratedPhase>) => void; required?: boolean; tooltip?: string }) {
	const review = phase.review || {};

	function update_review(partial: Partial<GeneratedPhase['review']>) {
		const merged = { ...review, ...partial };
		const has_any = merged.reviewer || merged.artifacts?.length || merged.timeout || merged.remind_every;
		on_change({ review: has_any ? merged : undefined });
	}

	return (
		<div>
			<SectionLabel label="Human Review" required={required} tooltip={tooltip} />
			<div className="space-y-2.5 rounded-lg border border-violet-200 bg-violet-50 p-3">
				<div>
					<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reviewer</label>
					<input
						value={review.reviewer || ''}
						onChange={(e) => update_review({ reviewer: e.target.value || undefined })}
						placeholder="e.g. architects, senior-devs"
						className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-violet-400"
					/>
				</div>
				<div>
					<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Artifacts (one per line)</label>
					<textarea
						value={(review.artifacts || []).join('\n')}
						onChange={(e) => {
							const lines = e.target.value.split('\n').filter(l => l.trim());
							update_review({ artifacts: lines.length > 0 ? lines : undefined });
						}}
						rows={2}
						placeholder={"src/\n.cliq/channels/dev--review/handoff.md"}
						className="w-full resize-none rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm leading-relaxed text-slate-900 outline-none focus:border-violet-400"
					/>
				</div>
				<div className="flex gap-2">
					<div className="flex-1">
						<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Timeout</label>
						<input
							value={review.timeout || ''}
							onChange={(e) => update_review({ timeout: e.target.value || undefined })}
							placeholder="e.g. 2h"
							className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-violet-400"
						/>
					</div>
					<div className="flex-1">
						<label className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Remind Every</label>
						<input
							value={review.remind_every || ''}
							onChange={(e) => update_review({ remind_every: e.target.value || undefined })}
							placeholder="e.g. 30m"
							className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-violet-400"
						/>
					</div>
				</div>
				{review.reviewer && (
					<button
						onClick={() => on_change({ review: undefined })}
						className="text-sm text-red-500 hover:text-red-700"
					>
						Clear review fields
					</button>
				)}
			</div>
		</div>
	);
}

function AddDependency({ phase, allPhases }: { phase: GeneratedPhase; allPhases: GeneratedPhase[] }) {
	const dispatch = useBuilderDispatch();
	const [open, setOpen] = useState(false);

	const available = allPhases.filter(
		p => p.name !== phase.name && !phase.depends_on.includes(p.name),
	);

	if (available.length === 0) return null;

	return (
		<div className="mt-2">
			{open ? (
				<div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
					<div className="space-y-0.5">
						{available.map((p) => (
							<button
								key={p.name}
								onClick={() => {
									dispatch({ type: 'ADD_DEPENDENCY', phase: phase.name, dependency: p.name });
									setOpen(false);
								}}
								className="block w-full rounded bg-indigo-50 px-2.5 py-1.5 text-left font-mono text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-800"
							>
								{p.name}
							</button>
						))}
					</div>
					<button onClick={() => setOpen(false)} className="mt-1 text-xs text-slate-500 hover:text-slate-700">
						Cancel
					</button>
				</div>
			) : (
				<button
					onClick={() => setOpen(true)}
					className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition"
				>
					+ Add dependency
				</button>
			)}
		</div>
	);
}
