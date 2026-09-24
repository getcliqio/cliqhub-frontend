import { useState } from 'react';
import { useBuilder, useBuilderDispatch, type GeneratedAgent } from '@/lib/builder/store';

export function AgentEditor() {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();

	const agent = state.team?.agents.find(a => a.name === state.selected_agent);
	if (!agent || !state.team) return null;

	function update(partial: Partial<GeneratedAgent>) {
		if (!agent) return;
		dispatch({ type: 'UPDATE_AGENT', agent: { ...agent, ...partial } });
	}

	const used_by = state.team.phases.filter(p => p.agent === agent.name).map(p => p.name);

	return (
		<>
			<div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
				<button
					onClick={() => dispatch({ type: 'SELECT_AGENT', name: null })}
					className="text-slate-500 hover:text-slate-800"
				>
					&#9666;
				</button>
				<h3 className="font-mono text-base font-bold text-slate-900">{agent.name}</h3>
				<span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold uppercase text-purple-700">
					custom
				</span>
			</div>

			<div className="flex-1 overflow-y-auto p-4 space-y-5">
				{/* Entry point */}
				<div>
					<label className="mb-1.5 block text-sm font-bold text-slate-800">Entry point</label>
					<input
						value={agent.entry || ''}
						onChange={(e) => update({ entry: e.target.value || undefined })}
						placeholder="agents/my-agent/index.js"
						className="w-full rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-sm text-slate-800 outline-none focus:border-indigo-400"
					/>
					<p className="mt-1 text-xs text-slate-500">Path to your SDK agent within the team package</p>
				</div>

				{/* Env vars */}
				<EnvVarEditor env={agent.env || []} onChange={(env) => update({ env: env.length > 0 ? env : undefined })} />

				{/* Used by */}
				{used_by.length > 0 && (
					<div>
						<label className="mb-1.5 block text-sm font-bold text-slate-800">Used by phases</label>
						<div className="flex flex-wrap gap-1">
							{used_by.map(p => (
								<span key={p} className="rounded bg-indigo-50 px-2 py-0.5 font-mono text-sm text-indigo-700">{p}</span>
							))}
						</div>
					</div>
				)}

				{/* Delete */}
				<button
					onClick={() => dispatch({ type: 'REMOVE_AGENT', name: agent.name })}
					className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100"
				>
					Delete agent
				</button>
			</div>
		</>
	);
}


function EnvVarEditor({ env, onChange }: { env: string[]; onChange: (env: string[]) => void }) {
	const [draft, setDraft] = useState('');

	function add() {
		const v = draft.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
		if (!v || env.includes(v)) return;
		onChange([...env, v]);
		setDraft('');
	}

	return (
		<div>
			<label className="mb-1.5 block text-sm font-bold text-slate-800">Environment variables</label>
			{env.length > 0 && (
				<div className="mb-2 space-y-1">
					{env.map((v) => (
						<div key={v} className="flex items-center justify-between rounded-lg bg-indigo-50 px-3 py-1.5">
							<span className="font-mono text-sm text-amber-900">{v}</span>
							<button
								onClick={() => onChange(env.filter(e => e !== v))}
								className="text-xs text-slate-400 hover:text-red-500"
							>
								✕
							</button>
						</div>
					))}
				</div>
			)}
			<div className="flex gap-2">
				<input
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && add()}
					placeholder="MY_API_KEY"
					className="flex-1 rounded-lg border border-slate-300 px-2.5 py-2 font-mono text-sm uppercase text-slate-800 outline-none focus:border-indigo-400"
				/>
				<button
					onClick={add}
					className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
				>
					Add
				</button>
			</div>
		</div>
	);
}
