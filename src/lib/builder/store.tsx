import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { SourceEntry, TargetEntry } from '@/lib/types';

/** HUG review configuration for generated phases. */
export interface GeneratedReviewBlock {
	reviewer?: string;
	artifacts?: string[];
	timeout?: string;
	remind_every?: string;
}

export interface GeneratedPhase {
	name: string;
	type: 'standard' | 'gate' | 'team';
	depends_on: string[];
	commands?: { name: string; run: string; scope?: string; escalate_on_fail?: boolean }[];
	max_iterations?: number;
	agent?: string;
	sources?: SourceEntry[];
	target_entries?: TargetEntry[];
	action?: string;
	model?: string;
	review?: GeneratedReviewBlock;
	team?: string;
	inputs?: Record<string, string>;
	is_support?: boolean;
	/** Phase is staged but not yet confirmed by the user */
	pending?: boolean;
}

export interface GeneratedRole {
	name: string;
	content: string;
}

export interface GeneratedAgent {
	name: string;
	entry?: string;
	env?: string[];
	upload_filename?: string;
	upload_data?: string;
}

export interface GeneratedTeam {
	name: string;
	description: string;
	version?: string;
	tags?: string[];
	inputs?: { name: string; description?: string }[];
	use_when?: string[];
	not_for?: string[];
	phases: GeneratedPhase[];
	roles: GeneratedRole[];
	agents: GeneratedAgent[];
}

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

export type BuilderView = 'spark' | 'canvas';

export type NodePositions = Map<string, { x: number; y: number }>;

interface HistoryEntry {
	team: GeneratedTeam;
	positions: NodePositions;
}

const MAX_HISTORY = 50;

export interface BuilderState {
	view: BuilderView;
	team: GeneratedTeam | null;
	validation: ValidationResult | null;
	draft_id: string | null;
	generating: boolean;
	error: string | null;
	selected_role: string | null;
	selected_phase: string | null;
	selected_agent: string | null;
	dirty: boolean;
	positions: NodePositions;
	history: HistoryEntry[];
	/** Incremented on undo to signal position restore */
	undo_tick: number;
}

export const INITIAL_STATE: BuilderState = {
	view: 'spark',
	team: null,
	validation: null,
	draft_id: null,
	generating: false,
	error: null,
	selected_role: null,
	selected_phase: null,
	selected_agent: null,
	dirty: false,
	positions: new Map(),
	history: [],
	undo_tick: 0,
};

export type SingleAction =
	| { type: 'SET_VIEW'; view: BuilderView }
	| { type: 'SET_GENERATING'; generating: boolean }
	| { type: 'SET_ERROR'; error: string | null }
	| { type: 'SET_TEAM'; team: GeneratedTeam; validation: ValidationResult | null }
	| { type: 'UPDATE_TEAM'; team: GeneratedTeam }
	| { type: 'SET_VALIDATION'; validation: ValidationResult }
	| { type: 'SET_DRAFT_ID'; draft_id: string | null }
	| { type: 'SELECT_ROLE'; name: string | null }
	| { type: 'SELECT_PHASE'; name: string | null }
	| { type: 'UPDATE_ROLE'; name: string; content: string }
	| { type: 'ADD_PHASE'; phase: GeneratedPhase }
	| { type: 'CONFIRM_PHASE'; name: string }
	| { type: 'REMOVE_PHASE'; name: string }
	| { type: 'UPDATE_PHASE'; phase: GeneratedPhase }
	| { type: 'ADD_ROLE'; role: GeneratedRole }
	| { type: 'REMOVE_ROLE'; name: string }
	| { type: 'ADD_DEPENDENCY'; phase: string; dependency: string }
	| { type: 'REMOVE_DEPENDENCY'; phase: string; dependency: string }
	| { type: 'SELECT_AGENT'; name: string | null }
	| { type: 'ADD_AGENT'; agent: GeneratedAgent }
	| { type: 'REMOVE_AGENT'; name: string }
	| { type: 'UPDATE_AGENT'; agent: GeneratedAgent }
	| { type: 'SET_DIRTY'; dirty: boolean }
	| { type: 'LOAD_DRAFT'; team: GeneratedTeam; draft_id: string }
	| { type: 'SET_POSITIONS'; positions: NodePositions }
	| { type: 'RESET' };

export type BuilderAction =
	| SingleAction
	| { type: 'BATCH'; actions: SingleAction[] }
	| { type: 'UNDO' };

function push_history(state: BuilderState): HistoryEntry[] {
	if (!state.team) return state.history;
	const entry: HistoryEntry = { team: state.team, positions: new Map(state.positions) };
	const next = [...state.history, entry];
	return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

const TEAM_MUTATING: Set<string> = new Set([
	'UPDATE_TEAM', 'UPDATE_ROLE', 'ADD_PHASE', 'CONFIRM_PHASE', 'REMOVE_PHASE',
	'UPDATE_PHASE', 'ADD_ROLE', 'REMOVE_ROLE', 'ADD_DEPENDENCY', 'REMOVE_DEPENDENCY',
	'ADD_AGENT', 'REMOVE_AGENT', 'UPDATE_AGENT',
]);

/** Remove the currently-selected pending phase (and its role) when navigating away */
function discard_pending(state: BuilderState): BuilderState {
	if (!state.team || !state.selected_phase) return state;
	const prev = state.team.phases.find(p => p.name === state.selected_phase);
	if (!prev?.pending) return state;
	const phases = state.team.phases.filter(p => p.name !== prev.name);
	const roles = state.team.roles.filter(r => r.name !== prev.name);
	return { ...state, team: { ...state.team, phases, roles } };
}

function apply_action(state: BuilderState, action: SingleAction): BuilderState {
	switch (action.type) {
		case 'SET_VIEW':
			return { ...state, view: action.view };
		case 'SET_GENERATING':
			return { ...state, generating: action.generating, error: null };
		case 'SET_ERROR':
			return { ...state, error: action.error, generating: false };
	case 'SET_TEAM': {
		const team = {
			...action.team,
			phases: action.team.phases || [],
			roles: action.team.roles || [],
			agents: action.team.agents || [],
		};
		return { ...state, team, validation: action.validation, view: 'canvas', generating: false, dirty: false };
	}
		case 'UPDATE_TEAM': {
			const team = {
				...action.team,
				phases: action.team.phases || state.team?.phases || [],
				roles: action.team.roles || state.team?.roles || [],
				agents: action.team.agents || state.team?.agents || [],
			};
			return { ...state, team, dirty: true };
		}
		case 'SET_VALIDATION':
			return { ...state, validation: action.validation };
		case 'SET_DRAFT_ID':
			return { ...state, draft_id: action.draft_id, dirty: false };
	case 'SELECT_ROLE': {
		const discard = discard_pending(state);
		return { ...discard, selected_role: action.name, selected_phase: null, selected_agent: null };
	}
	case 'SELECT_PHASE': {
		if (!state.team || action.name === state.selected_phase) {
			return { ...state, selected_phase: action.name, selected_role: null, selected_agent: null };
		}
		const prev = state.selected_phase
			? state.team.phases.find(p => p.name === state.selected_phase)
			: null;
		if (prev?.pending) {
			const phases = state.team.phases.filter(p => p.name !== prev.name);
			const roles = state.team.roles.filter(r => r.name !== prev.name);
			return {
				...state,
				team: { ...state.team, phases, roles },
				selected_phase: action.name,
				selected_role: null,
				selected_agent: null,
			};
		}
		return { ...state, selected_phase: action.name, selected_role: null, selected_agent: null };
	}
	case 'SELECT_AGENT': {
		const discard = discard_pending(state);
		return { ...discard, selected_agent: action.name, selected_phase: null, selected_role: null };
	}
		case 'UPDATE_ROLE': {
			if (!state.team) return state;
			const roles = state.team.roles.map(r =>
				r.name === action.name ? { ...r, content: action.content } : r,
			);
			return { ...state, team: { ...state.team, roles }, dirty: true };
		}
	case 'ADD_PHASE': {
		if (!state.team || !action.phase) return state;
		const new_phase = { ...action.phase, depends_on: action.phase.depends_on ?? [], pending: true };
		return { ...state, team: { ...state.team, phases: [...(state.team.phases || []), new_phase] } };
	}
	case 'CONFIRM_PHASE': {
		if (!state.team) return state;
		const phases = state.team.phases.map(p =>
			p.name === action.name ? { ...p, pending: undefined } : p,
		);
		return { ...state, team: { ...state.team, phases }, dirty: true };
	}
	case 'REMOVE_PHASE': {
			if (!state.team) return state;
			const phases = state.team.phases
				.filter(p => p.name !== action.name)
				.map(p => ({ ...p, depends_on: p.depends_on.filter(d => d !== action.name) }));
			const roles = state.team.roles.filter(r => r.name !== action.name);
			return {
				...state,
				team: { ...state.team, phases, roles },
				selected_role: state.selected_role === action.name ? null : state.selected_role,
				selected_phase: state.selected_phase === action.name ? null : state.selected_phase,
				dirty: true,
			};
		}
	case 'UPDATE_PHASE': {
		if (!state.team) return state;
		const phases = state.team.phases.map(p => {
			if (p.name !== action.phase.name) return p;
			return { ...p, ...action.phase, depends_on: action.phase.depends_on ?? p.depends_on ?? [] };
		});
		return { ...state, team: { ...state.team, phases }, dirty: true };
	}
		case 'ADD_ROLE': {
			if (!state.team) return state;
			return { ...state, team: { ...state.team, roles: [...state.team.roles, action.role] }, dirty: true };
		}
		case 'REMOVE_ROLE': {
			if (!state.team) return state;
			const roles = state.team.roles.filter(r => r.name !== action.name);
			return { ...state, team: { ...state.team, roles }, selected_role: state.selected_role === action.name ? null : state.selected_role, dirty: true };
		}
		case 'ADD_DEPENDENCY': {
			if (!state.team) return state;
			const phases = state.team.phases.map(p =>
				p.name === action.phase && !p.depends_on.includes(action.dependency)
					? { ...p, depends_on: [...p.depends_on, action.dependency] }
					: p,
			);
			return { ...state, team: { ...state.team, phases }, dirty: true };
		}
		case 'REMOVE_DEPENDENCY': {
			if (!state.team) return state;
			const phases = state.team.phases.map(p =>
				p.name === action.phase
					? { ...p, depends_on: p.depends_on.filter(d => d !== action.dependency) }
					: p,
			);
			return { ...state, team: { ...state.team, phases }, dirty: true };
		}
		case 'ADD_AGENT': {
			if (!state.team) return state;
			return { ...state, team: { ...state.team, agents: [...state.team.agents, action.agent] }, dirty: true };
		}
		case 'REMOVE_AGENT': {
			if (!state.team) return state;
			const agents = state.team.agents.filter(a => a.name !== action.name);
			const phases = state.team.phases.map(p =>
				p.agent === action.name ? { ...p, agent: undefined } : p,
			);
			return {
				...state,
				team: { ...state.team, agents, phases },
				selected_agent: state.selected_agent === action.name ? null : state.selected_agent,
				dirty: true,
			};
		}
		case 'UPDATE_AGENT': {
			if (!state.team) return state;
			const agents = state.team.agents.map(a =>
				a.name === action.agent.name ? action.agent : a,
			);
			return { ...state, team: { ...state.team, agents }, dirty: true };
		}
		case 'SET_POSITIONS':
			return { ...state, positions: action.positions };
		case 'SET_DIRTY':
			return { ...state, dirty: action.dirty };
		case 'LOAD_DRAFT': {
			const team = { ...action.team, agents: action.team.agents || [] };
			return { ...state, team, draft_id: action.draft_id, view: 'canvas', dirty: false, history: [] };
		}
		case 'RESET':
			return INITIAL_STATE;
		default:
			return state;
	}
}

export function builder_reducer(state: BuilderState, action: BuilderAction): BuilderState {
	if (action.type === 'UNDO') {
		if (state.history.length === 0) return state;
		const prev = state.history[state.history.length - 1];
		return {
			...state,
			team: prev.team,
			positions: prev.positions,
			history: state.history.slice(0, -1),
			dirty: true,
			undo_tick: state.undo_tick + 1,
			selected_phase: null,
			selected_role: null,
			selected_agent: null,
		};
	}

	if (action.type === 'BATCH') {
		const mutates = action.actions.some(a => TEAM_MUTATING.has(a.type));
		const history = mutates ? push_history(state) : state.history;
		let s = { ...state, history };
		for (const sub of action.actions) {
			s = apply_action(s, sub);
		}
		return s;
	}

	if (TEAM_MUTATING.has(action.type)) {
		return apply_action({ ...state, history: push_history(state) }, action);
	}

	return apply_action(state, action);
}

const BuilderContext = createContext<BuilderState>(INITIAL_STATE);
const BuilderDispatchContext = createContext<Dispatch<BuilderAction>>(() => {});

export function BuilderProvider({ children }: { children: ReactNode }) {
	const [state, dispatch] = useReducer(builder_reducer, INITIAL_STATE);

	return (
		<BuilderContext.Provider value={state}>
			<BuilderDispatchContext.Provider value={dispatch}>
				{children}
			</BuilderDispatchContext.Provider>
		</BuilderContext.Provider>
	);
}

export function useBuilder(): BuilderState {
	return useContext(BuilderContext);
}

export function useBuilderDispatch(): Dispatch<BuilderAction> {
	return useContext(BuilderDispatchContext);
}
