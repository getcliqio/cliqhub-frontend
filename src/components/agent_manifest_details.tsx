import type React from 'react';

/**
 * Read-only manifest metadata card — surfaces every attribute the
 * agent manifest declares beyond raw settings. Used by both the
 * account-level and realm-level agent settings pages so the two
 * views stay in sync and a manifest change automatically shows up
 * everywhere.
 *
 * The `agent` prop is the same shape the backend Registry_agent
 * returns — see services/backend/src/services/*_agent_settings_service.ts.
 */

export interface Manifest_input_spec {
	name: string;
	type?: string;
	required?: boolean;
	default?: unknown;
	required_unless?: string[];
	description?: string;
}

export interface Manifest_output_field {
	name: string;
	type: string;
}

export interface Manifest_output {
	data?: Manifest_output_field[];
	text?: string;
}

export interface Manifest_agent {
	name: string;
	version: string | null;
	min_cliq_version?: string | null;
	capabilities?: string[];
	binaries?: string[];
	env?: string[];
	inputs?: Manifest_input_spec[];
	output?: Manifest_output | null;
}

function Chip({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'indigo' | 'emerald' | 'amber' }) {
	const tones: Record<string, string> = {
		slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
		indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
		emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
		amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
	};
	return (
		<span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ${tones[tone]}`}>
			{children}
		</span>
	);
}

function _stringify_default(value: unknown): string {
	if (typeof value === 'string') return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function Agent_manifest_details({ agent }: { agent: Manifest_agent }) {
	const has_capabilities = (agent.capabilities?.length ?? 0) > 0;
	const has_binaries = (agent.binaries?.length ?? 0) > 0;
	const has_env = (agent.env?.length ?? 0) > 0;
	const has_min = !!agent.min_cliq_version;
	const has_meta_row = has_capabilities || has_binaries || has_env || has_min;

	const inputs = agent.inputs ?? [];
	const output = agent.output ?? null;

	if (!has_meta_row && inputs.length === 0 && !output) return null;

	return (
		<div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900">
			{has_meta_row ? (
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-100 pb-3 dark:border-slate-800">
					{has_capabilities ? (
						<div>
							<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Capabilities</p>
							<div className="flex flex-wrap gap-1">
								{agent.capabilities!.map((c) => (
									<Chip key={c} tone="indigo">{c}</Chip>
								))}
							</div>
						</div>
					) : null}
					{has_binaries ? (
						<div>
							<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Binaries</p>
							<div className="flex flex-wrap gap-1">
								{agent.binaries!.map((b) => (
									<Chip key={b} tone="amber">{b}</Chip>
								))}
							</div>
						</div>
					) : null}
					{has_env ? (
						<div>
							<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Env</p>
							<div className="flex flex-wrap gap-1">
								{agent.env!.map((e) => (
									<Chip key={e}>{e}</Chip>
								))}
							</div>
						</div>
					) : null}
					{has_min ? (
						<div>
							<p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Min cliq</p>
							<Chip>≥ {agent.min_cliq_version}</Chip>
						</div>
					) : null}
				</div>
			) : null}

			{inputs.length > 0 ? (
				<div className={has_meta_row ? 'pt-3' : ''}>
					<p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
						Phase inputs
						<span className="ml-1 font-normal normal-case text-slate-400 dark:text-slate-500">
							(what a team phase must pass when calling this agent)
						</span>
					</p>
					<div className="grid gap-2">
						{inputs.map((i) => {
							const conditional = (i.required_unless?.length ?? 0) > 0;
							const required = i.required && !conditional;
							return (
								<div
									key={i.name}
									className="rounded-lg border border-slate-100 bg-slate-50/50 p-2 dark:border-slate-800 dark:bg-slate-950/40"
								>
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">
											{i.name}
										</span>
										{i.type ? <Chip>{i.type}</Chip> : null}
										{required ? <Chip tone="emerald">required</Chip> : null}
										{conditional ? (
											<Chip tone="amber">
												required unless {i.required_unless!.join(', ')}
											</Chip>
										) : null}
										{!required && !conditional && i.required === false ? <Chip>optional</Chip> : null}
										{i.default !== undefined ? (
											<Chip tone="indigo">default: {_stringify_default(i.default)}</Chip>
										) : null}
									</div>
									{i.description ? (
										<p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-slate-600 dark:text-slate-400">
											{i.description}
										</p>
									) : null}
								</div>
							);
						})}
					</div>
				</div>
			) : null}

			{output ? (
				<div className={has_meta_row || inputs.length > 0 ? 'mt-3 border-t border-slate-100 pt-3 dark:border-slate-800' : ''}>
					<p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
						Output
					</p>
					{output.data && output.data.length > 0 ? (
						<div className="grid gap-1 sm:grid-cols-2">
							{output.data.map((f) => (
								<div key={f.name} className="flex items-baseline gap-2 rounded-md bg-slate-50 px-2 py-1 dark:bg-slate-950/40">
									<span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-100">
										{f.name}
									</span>
									<span className="truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">
										{f.type}
									</span>
								</div>
							))}
						</div>
					) : null}
					{output.text ? (
						<p className="mt-2 text-[11px] italic text-slate-500 dark:text-slate-400">
							text: {output.text}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
