import { AlertTriangle } from 'lucide-react';
import type { AgentDef, WorkflowPhase } from '@/lib/types';


export function AgentSection({
	agents,
	phases,
	registered_agents,
}: {
	agents: Record<string, AgentDef>;
	phases: WorkflowPhase[];
	/** When provided, agents whose name is NOT in this set show an "Unregistered" badge. */
	registered_agents?: Set<string>;
}) {
	const entries = Object.entries(agents);
	if (entries.length === 0) return null;

	const phase_map = new Map<string, string[]>();
	for (const p of phases) {
		if (!p.agent) continue;
		const list = phase_map.get(p.agent) || [];
		list.push(p.name);
		phase_map.set(p.agent, list);
	}

	const all_env = new Set<string>();
	for (const def of Object.values(agents)) {
		if (def.env) def.env.forEach(e => all_env.add(e));
	}

	return (
		<div>
			<h2 className="mb-4 text-xl font-bold">
				Agents <span className="text-base font-normal text-slate-400">({entries.length})</span>
			</h2>
			<div className="space-y-3">
				{entries.map(([name, def]) => {
					const used_by = phase_map.get(name) || [];

					return (
						<div key={name} className="rounded-lg border border-slate-200 bg-white p-4">
							<div className="flex items-center gap-2">
								<span className="font-mono text-sm font-bold">{name}</span>
								{registered_agents && !registered_agents.has(name) ? (
									<span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-900/20 dark:text-red-400 dark:ring-red-800">
										<AlertTriangle className="h-3 w-3" />
										Unregistered
									</span>
								) : null}
							</div>

							<div className="mt-2 space-y-1 text-xs text-slate-500">
								{def.entry && (
									<p>Entry: <span className="font-mono font-semibold text-slate-700">{def.entry}</span></p>
								)}
								{used_by.length > 0 && (
									<p>
										Used by:{' '}
										{used_by.map((phase_name) => (
											<span key={phase_name} className="mr-1 inline-block rounded bg-indigo-50 px-1.5 py-0.5 font-mono font-semibold text-indigo-700">
												{phase_name}
											</span>
										))}
									</p>
								)}
								{def.env && def.env.length > 0 && (
									<p>
										Env:{' '}
										{def.env.map((v) => (
											<span key={v} className="mr-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 font-mono text-amber-700">
												{v}
											</span>
										))}
									</p>
								)}
							</div>
						</div>
					);
				})}
			</div>

			{all_env.size > 0 && (
				<div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
					<p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-700">Required environment variables</p>
					<div className="flex flex-wrap gap-2">
						{[...all_env].map((v) => (
							<span key={v} className="rounded bg-white px-2 py-1 font-mono text-xs text-amber-800 shadow-sm">
								{v}
							</span>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
