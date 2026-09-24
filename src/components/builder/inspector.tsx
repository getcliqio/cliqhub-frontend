import { useState, useEffect, useRef } from 'react';
import { useBuilder, useBuilderDispatch, type GeneratedPhase, type GeneratedAgent, type SingleAction } from '@/lib/builder/store';
import { PhaseEditor } from './phase_editor';
import { AgentEditor } from './agent_editor';

type InspectorTab = 'phases' | 'agents';

export function Inspector() {
	const state = useBuilder();
	const [tab, setTab] = useState<InspectorTab>('phases');

	useEffect(() => {
		if (state.selected_agent) setTab('agents');
		else if (state.selected_phase) setTab('phases');
	}, [state.selected_agent, state.selected_phase]);

	const agent_count = state.team?.agents.length || 0;

	return (
		<div className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
			<div className="flex h-10 items-center border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
				<button
					onClick={() => setTab('phases')}
					className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide transition ${
						tab === 'phases' ? 'border-b-2 border-indigo-500 text-indigo-700' : 'text-slate-500 hover:text-slate-700'
					}`}
				>
					Phases
				</button>
			{tab === 'phases' && <div className="pr-2"><AddPhaseDropdown compact /></div>}
			<button
				onClick={() => setTab('agents')}
				className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wide transition ${
					tab === 'agents' ? 'border-b-2 border-purple-500 text-purple-700' : 'text-slate-500 hover:text-slate-700'
				}`}
			>
				Agents{agent_count > 0 && ` (${agent_count})`}
			</button>
			{tab === 'agents' && <div className="pr-2"><AddAgentButton /></div>}
			</div>

		{tab === 'phases' && (
			state.selected_phase ? (
				<PhaseEditor />
			) : (
				<div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
				<p className="text-center text-[11px] text-slate-500">
					Click a phase to inspect or edit
				</p>
				</div>
			)
		)}

			{tab === 'agents' && (
				state.selected_agent ? (
					<AgentEditor />
				) : (
					<AgentList />
				)
			)}
		</div>
	);
}

function AgentList() {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const agents = state.team?.agents || [];

	return (
		<div className="flex flex-1 flex-col p-3">
			{agents.length > 0 ? (
				<div className="mb-3 space-y-1.5">
					{agents.map((a) => (
					<button
						key={a.name}
						onClick={() => dispatch({ type: 'SELECT_AGENT', name: a.name })}
						className="flex w-full items-center gap-1.5 rounded-md border border-slate-200 bg-indigo-50 px-2 py-1.5 text-left transition hover:border-amber-300 hover:bg-amber-50"
					>
						<span className="font-mono text-[11px] font-bold text-slate-800">{a.name}</span>
						<span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-purple-700">
							custom
						</span>
					</button>
					))}
				</div>
		) : (
			<p className="mb-3 text-center text-[11px] text-slate-500">
				No custom agents defined
			</p>
		)}
		</div>
	);
}

type AddPhaseType = 'standard' | 'gate' | 'team';

function AddPhaseDropdown({ compact }: { compact?: boolean }) {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const [open, setOpen] = useState(false);
	const [phase_type, setPhaseType] = useState<AddPhaseType | null>(null);
	const [name, setName] = useState('');
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handle_outside(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
				setOpen(false);
				setPhaseType(null);
				setName('');
			}
		}
		document.addEventListener('mousedown', handle_outside);
		return () => document.removeEventListener('mousedown', handle_outside);
	}, []);

	function handle_add() {
		if (!phase_type || !state.team) return;
		const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
		if (!slug) return;
		if (state.team.phases.some(p => p.name === slug)) return;

		const phase: GeneratedPhase = { name: slug, type: phase_type, depends_on: [] };

		const type_defaults: Record<string, Partial<GeneratedPhase>> = {
			gate: { commands: [{ name: 'check', run: '' }] },
			team: { team: '' },
		};
		Object.assign(phase, type_defaults[phase_type] ?? {});

		const actions: SingleAction[] = [
			{ type: 'ADD_PHASE', phase },
		];

		if (phase_type !== 'team') {
			actions.push({ type: 'ADD_ROLE', role: { name: slug, content: `# Role: ${slug}\n\nDefine this role's responsibilities.` } });
		}

		actions.push({ type: 'SELECT_PHASE', name: slug });
		dispatch({ type: 'BATCH', actions });
		setName('');
		setPhaseType(null);
		setOpen(false);
	}

	return (
		<div className="relative" ref={ref}>
			<button
				onClick={(e) => { e.stopPropagation(); setOpen(!open); setPhaseType(null); setName(''); }}
				className={compact
					? "flex h-6 w-6 items-center justify-center rounded-md text-sm text-indigo-500 hover:bg-indigo-100 hover:text-indigo-700 transition"
					: "rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition"
				}
				title="Add phase"
			>
				+{!compact && ' Phase'}
			</button>

			{open && (
				<div className={`absolute z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-2.5 shadow-lg ${compact ? 'right-0 top-full' : 'left-1/2 top-full -translate-x-1/2'}`}>
					{!phase_type ? (
						<div className="space-y-0.5">
							{(['standard', 'gate', 'team'] as AddPhaseType[]).map((t) => (
								<button
									key={t}
									onClick={() => setPhaseType(t)}
									className="block w-full rounded-md px-2.5 py-1.5 text-left text-[11px] font-semibold capitalize text-slate-700 hover:bg-amber-50"
								>
									{t}
								</button>
							))}
						</div>
					) : (
						<div>
							<p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
								New {phase_type}
							</p>
							<input
								value={name}
								onChange={(e) => setName(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handle_add()}
								placeholder="phase-name"
								className="mb-1.5 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-[11px] text-slate-800 outline-none focus:border-indigo-400"
								autoFocus
							/>
							<div className="flex gap-1.5">
								<button
									onClick={handle_add}
									className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700"
								>
									Add
								</button>
								<button
									onClick={() => { setPhaseType(null); setName(''); }}
									className="text-[11px] text-slate-500 hover:text-slate-700"
								>
									Back
								</button>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/** Compact "+" button for the Agents tab header */
function AddAgentButton() {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState('');
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handle_outside(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as HTMLElement)) {
				setOpen(false);
				setName('');
			}
		}
		document.addEventListener('mousedown', handle_outside);
		return () => document.removeEventListener('mousedown', handle_outside);
	}, []);

	function handle_add() {
		if (!state.team) return;
		const slug = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
		if (!slug) return;
		if (state.team.agents.some(a => a.name === slug)) return;

		const agent: GeneratedAgent = { name: slug };
		dispatch({ type: 'BATCH', actions: [
			{ type: 'ADD_AGENT', agent },
			{ type: 'SELECT_AGENT', name: slug },
		]});
		setName('');
		setOpen(false);
	}

	return (
		<div className="relative" ref={ref}>
			<button
				onClick={(e) => { e.stopPropagation(); setOpen(!open); setName(''); }}
				className="flex h-6 w-6 items-center justify-center rounded-md text-sm text-purple-500 hover:bg-purple-100 hover:text-purple-700 transition"
				title="Add agent"
			>
				+
			</button>

			{open && (
				<div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-slate-200 bg-white p-2.5 shadow-lg">
					<p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">New custom agent</p>
					<input
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => e.key === 'Enter' && handle_add()}
						placeholder="agent-name"
						className="mb-1.5 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-[11px] text-slate-800 outline-none focus:border-purple-400"
						autoFocus
					/>
					<div className="flex gap-1.5">
						<button
							onClick={handle_add}
							className="rounded-md bg-purple-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-purple-700"
						>
							Add
						</button>
						<button
							onClick={() => { setOpen(false); setName(''); }}
							className="text-[11px] text-slate-500 hover:text-slate-700"
						>
							Cancel
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
