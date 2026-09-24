import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
	ReactFlow,
	Background,
	Controls,
	MiniMap,
	useNodesState,
	useEdgesState,
	type Node,
	type Edge,
	type Connection,
} from '@xyflow/react';

import { useBuilder, useBuilderDispatch, type GeneratedPhase, type NodePositions } from '@/lib/builder/store';
import { useAuth } from '@/lib/auth_context';
import { PhaseNode } from './phase_node';
import { CapabilityEditor } from './capability_editor';
import { Inspector } from './inspector';
import { ValidationBar } from './validation_bar';
import { PublishDialog } from './publish_dialog';
import { DownloadButton } from './download_button';
import { SaveButton } from './save_button';
import { YamlView } from './yaml_view';
import { ChatPanel } from './chat_panel';
import { clear_builder_session_restores } from '@/lib/builder/session_restore';

const nodeTypes = { phase: PhaseNode };

type ViewMode = 'visual' | 'yaml';

function TeamNameEditor({ name, version, on_change }: { name: string; version?: string; on_change: (name: string) => void }) {
	const [editing, set_editing] = useState(false);
	const [draft, set_draft] = useState(name);
	const input_ref = useRef<HTMLInputElement>(null);

	useEffect(() => { set_draft(name); }, [name]);

	useEffect(() => {
		if (editing) {
			input_ref.current?.focus();
			input_ref.current?.select();
		}
	}, [editing]);

	function commit() {
		set_editing(false);
		const clean = draft.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
		if (clean && clean !== name) {
			on_change(clean);
		}
		set_draft(clean || name);
	}

	if (editing) {
		return (
			<div className="flex items-center gap-1.5">
				<input
					ref={input_ref}
					type="text"
					value={draft}
					onChange={(e) => set_draft(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === 'Enter') commit();
						if (e.key === 'Escape') { set_draft(name); set_editing(false); }
					}}
					className="rounded-md border border-indigo-400 bg-white px-2 py-1 font-mono text-sm font-bold text-slate-800 outline-none dark:border-indigo-500 dark:bg-slate-800 dark:text-slate-100"
				/>
				{version && (
					<span className="text-xs text-slate-400 dark:text-slate-500">v{version}</span>
				)}
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1.5">
			<span className="font-mono text-sm font-bold text-slate-800 dark:text-slate-100">{name}</span>
			{version && (
				<span className="text-xs text-slate-400 dark:text-slate-500">v{version}</span>
			)}
			<button
				type="button"
				onClick={() => set_editing(true)}
				className="rounded p-0.5 text-slate-400 hover:text-indigo-600 dark:text-slate-500 dark:hover:text-indigo-400"
				title="Edit team name"
			>
				<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
				</svg>
			</button>
		</div>
	);
}

function build_layout(phases: GeneratedPhase[]): Map<string, { x: number; y: number }> {
	const positions = new Map<string, { x: number; y: number }>();
	const placed = new Set<string>();

	const roots = phases.filter(p => p.depends_on.length === 0 && !p.is_support);
	const support = phases.filter(p => !!p.is_support);
	let row = 0;

	function place_layer(names: string[]) {
		if (names.length === 0) return;
		const start_x = -(names.length - 1) * 120;
		names.forEach((name, i) => {
			positions.set(name, { x: start_x + i * 240, y: row * 140 });
			placed.add(name);
		});
		row++;

		const next: string[] = [];
		for (const p of phases) {
			if (placed.has(p.name) || !!p.is_support) continue;
			if (p.depends_on.every(d => placed.has(d))) next.push(p.name);
		}
		place_layer(next);
	}

	place_layer(roots.map(r => r.name));

	for (const p of phases) {
		if (!placed.has(p.name) && !p.is_support) {
			positions.set(p.name, { x: 0, y: row * 140 });
			row++;
		}
	}

	support.forEach((p, i) => {
		positions.set(p.name, { x: 400, y: i * 140 });
	});

	return positions;
}

const PUBLISH_DRAFT_KEY = 'cliqhub_publish_draft';

export function CanvasView() {
	const state = useBuilder();
	const dispatch = useBuilderDispatch();
	const { user } = useAuth();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const [showPublish, setShowPublish] = useState(false);
	const initial_tab = searchParams.get('tab') === 'yaml' ? 'yaml' : 'visual';
	const [viewMode, setViewMode] = useState<ViewMode>(initial_tab);
	const auto_publish_ref = useRef(false);

	useEffect(() => {
		if (auto_publish_ref.current) return;
		if (searchParams.get('publish') === '1' && user && state.team) {
			auto_publish_ref.current = true;
			setShowPublish(true);
		}
	}, [searchParams, user, state.team]);

	function handle_publish_click() {
		if (!user) {
			if (state.team) {
				sessionStorage.setItem(PUBLISH_DRAFT_KEY, JSON.stringify(state.team));
			}
			navigate('/login?redirect=' + encodeURIComponent('/builder?publish=1'));
			return;
		}
		setShowPublish(true);
	}

	const { initial_nodes, initial_edges } = useMemo(() => {
		if (!state.team) return { initial_nodes: [], initial_edges: [] };

		const layout = build_layout(state.team.phases);
		const nodes: Node[] = state.team.phases.map(p => {
			const pos = layout.get(p.name) || { x: 0, y: 0 };
			return {
				id: p.name,
				type: 'phase',
				position: pos,
			data: {
				label: p.name,
				phase_type: p.type,
				commands_count: p.commands?.length || 0,
				max_iterations: p.max_iterations,
				agent: p.agent,
				sources_count: p.sources?.length || 0,
				targets_count: p.target_entries?.length || 0,
				pending: !!p.pending,
			},
			};
		});

		const edges: Edge[] = [];
		for (const p of state.team.phases) {
			for (const dep of p.depends_on) {
				edges.push({
					id: `${dep}-${p.name}`,
					source: dep,
					target: p.name,
					animated: p.type === 'gate',
				});
			}
		}

		return { initial_nodes: nodes, initial_edges: edges };
	}, [state.team]);

	const [nodes, setNodes, onNodesChange] = useNodesState(initial_nodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initial_edges);
	const positions_ref = useRef<NodePositions>(new Map());

	function sync_positions_to_store() {
		const map: NodePositions = new Map();
		for (const node of nodes) {
			map.set(node.id, { x: node.position.x, y: node.position.y });
		}
		positions_ref.current = map;
		dispatch({ type: 'SET_POSITIONS', positions: map });
	}

	const onNodeDragStop = useCallback(() => {
		sync_positions_to_store();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [nodes, dispatch]);

	useEffect(() => {
		setNodes(initial_nodes.map(n => {
			const saved = positions_ref.current.get(n.id);
			return saved ? { ...n, position: saved } : n;
		}));
		const map: NodePositions = new Map();
		for (const n of initial_nodes) {
			const saved = positions_ref.current.get(n.id);
			map.set(n.id, saved || n.position);
		}
		positions_ref.current = map;
		dispatch({ type: 'SET_POSITIONS', positions: map });
	}, [initial_nodes, setNodes, dispatch]);

	useEffect(() => {
		setEdges(initial_edges);
	}, [initial_edges, setEdges]);

	const prev_undo_tick = useRef(state.undo_tick);
	useEffect(() => {
		if (state.undo_tick !== prev_undo_tick.current) {
			prev_undo_tick.current = state.undo_tick;
			positions_ref.current = new Map(state.positions);
			setNodes(prev => prev.map(n => {
				const pos = state.positions.get(n.id);
				return pos ? { ...n, position: pos } : n;
			}));
		}
	}, [state.undo_tick, state.positions, setNodes]);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (!connection.source || !connection.target) return;
			if (connection.source === connection.target) return;

			const source_phase = state.team?.phases.find(p => p.name === connection.source);
			const target_phase = state.team?.phases.find(p => p.name === connection.target);
			if (source_phase?.is_support || target_phase?.is_support) return;

			dispatch({
				type: 'ADD_DEPENDENCY',
				phase: connection.target,
				dependency: connection.source,
			});
		},
		[dispatch, state.team?.phases],
	);

	const deleting_nodes = useRef(false);

	const onNodesDelete = useCallback(
		(deleted: Node[]) => {
			deleting_nodes.current = true;
			dispatch({
				type: 'BATCH',
				actions: deleted.map(node => ({ type: 'REMOVE_PHASE' as const, name: node.id })),
			});
			queueMicrotask(() => { deleting_nodes.current = false; });
		},
		[dispatch],
	);

	const onEdgesDelete = useCallback(
		(deleted: Edge[]) => {
			if (deleting_nodes.current) return;
			dispatch({
				type: 'BATCH',
				actions: deleted.map(edge => ({
					type: 'REMOVE_DEPENDENCY' as const,
					phase: edge.target,
					dependency: edge.source,
				})),
			});
		},
		[dispatch],
	);

	useEffect(() => {
		function handle_keydown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
				e.preventDefault();
				dispatch({ type: 'UNDO' });
			}
		}
		window.addEventListener('keydown', handle_keydown);
		return () => window.removeEventListener('keydown', handle_keydown);
	}, [dispatch]);

    if (!state.team) {
        return (
            <div className="flex h-[calc(100vh-65px)] items-center justify-center bg-slate-50">
                <p className="text-sm text-slate-400">Loading team into builder…</p>
            </div>
        );
    }

    return (
		<div className="flex h-[calc(100vh-65px)] flex-col">
			{/* Top action bar */}
			<div className="flex h-10 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-700 dark:bg-slate-900">
				{!showPublish && (
					<TeamNameEditor
						name={state.team.name}
						version={state.team.version}
						on_change={(name) => dispatch({ type: 'UPDATE_TEAM', team: { ...state.team!, name } })}
					/>
				)}
				{!showPublish && (
					<div className="flex items-center gap-2">
						<button
							onClick={() => {
								const from = searchParams.get('from');
								if (from) {
									clear_builder_session_restores();
									navigate(decodeURIComponent(from));
								} else {
									clear_builder_session_restores();
									dispatch({ type: 'RESET' });
								}
							}}
							className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
						>
							Cancel
						</button>
						<SaveButton />
						<DownloadButton />
						{state.team.name && state.team.phases.length > 0 && (
							<button
								onClick={handle_publish_click}
								className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
							>
								Publish
							</button>
						)}
					</div>
				)}
			</div>

			<div className="flex flex-1 overflow-hidden">
				{!showPublish && <CapabilityEditor />}

		<div className="flex min-w-0 flex-1 flex-col">
		{/* Canvas toolbar — undo + view toggle */}
			{!showPublish && (
				<div className="flex h-10 items-center border-b border-slate-200 bg-slate-50 px-3 dark:border-slate-700 dark:bg-slate-800">
						<div className="flex items-center">
							<button
								onClick={() => dispatch({ type: 'UNDO' })}
								disabled={state.history.length === 0}
								title="Undo (Ctrl+Z)"
								className="rounded px-1.5 py-0.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-700 dark:hover:text-slate-200"
							>
								&#8634;
							</button>
						</div>
						<div className="flex flex-1 justify-center">
							<div className="flex rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-700">
								<button
									onClick={() => setViewMode('visual')}
									className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
										viewMode === 'visual'
											? 'bg-slate-50 text-slate-800 shadow-sm dark:bg-slate-600 dark:text-slate-100'
											: 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
									}`}
								>
									Visual
								</button>
								<button
									onClick={() => setViewMode('yaml')}
									className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
										viewMode === 'yaml'
											? 'bg-slate-50 text-slate-800 shadow-sm dark:bg-slate-600 dark:text-slate-100'
											: 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
									}`}
								>
									YAML
								</button>
							</div>
						</div>
					</div>
			)}

					{/* Main content area */}
					{showPublish ? (
						<div className="flex flex-1 items-start justify-center overflow-y-auto bg-white pt-8">
							<PublishDialog onClose={() => setShowPublish(false)} />
						</div>
					) : viewMode === 'visual' ? (
						<ReactFlow
							nodes={nodes}
							edges={edges}
							onNodesChange={onNodesChange}
							onEdgesChange={onEdgesChange}
							onConnect={onConnect}
							onNodesDelete={onNodesDelete}
							onEdgesDelete={onEdgesDelete}
							onNodeDragStop={onNodeDragStop}
							nodeTypes={nodeTypes}
							defaultEdgeOptions={{
								style: { stroke: '#94a3b8', strokeWidth: 2 },
							}}
							fitView
							className="bg-slate-50"
						>
							<Background />
							<Controls />
							<MiniMap
								nodeStrokeWidth={2}
							nodeColor={(n) => {
								const type = (n.data as Record<string, unknown>)?.phase_type;
								if (type === 'gate') return '#f59e0b';
								if (type === 'team') return '#3b82f6';
								return '#94a3b8';
							}}
							/>
						</ReactFlow>
					) : (
						<YamlView />
					)}
				</div>

				{!showPublish && <Inspector />}
			</div>
			{!showPublish && <ValidationBar />}
			{!showPublish && <ChatPanel />}
		</div>
	);
}
