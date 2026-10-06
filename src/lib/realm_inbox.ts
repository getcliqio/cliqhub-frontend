/**
 * Realm inbox + run detail — types for the BFF composition routes
 * `POST /v1/realm_inbox/get` and `POST /v1/run_detail/get`, plus link helpers.
 */
import { realm_path } from '@/lib/realm_url';

export interface Control_realm {
	id: string;
	slug: string;
	name: string;
	org_slug: string | null;
}

export interface Section_status {
	status: 'ok' | 'error';
	error: string | null;
}

export interface Inbox_item {
	kind: 'review' | 'input' | 'failed' | 'run';
	id: string;
	run_id: string | null;
	title: string;
	team: string | null;
	phase: string | null;
	state: string;
	at: number | null;
	error: string | null;
	message: string | null;
	artifact_count: number | null;
}

export interface Realm_inbox_data {
	realm: Control_realm;
	items: Inbox_item[];
	live: Inbox_item[];
	counts: { reviews: number; awaiting_input: number; failed_24h: number; running: number };
	sections: Record<'reviews' | 'awaiting_input' | 'failed' | 'running', Section_status>;
	partial: boolean;
}

export interface Run_detail_phase {
	phase: string;
	status: string;
	sequence: number | null;
	started_at: number | null;
	completed_at: number | null;
	error: string | null;
	agent: string | null;
}

export interface Pending_control {
	tx_id: string;
	endpoint: string;
	enqueued_at: number;
	attempts: number;
	max_attempts: number;
	delivered_at: number | null;
	last_error: string | null;
	ack_status: string | null;
}

export interface Force_terminate_status {
	already_terminated: boolean;
	terminated_at: number | null;
	terminated_by_user_id: string | null;
	terminated_reason: string | null;
	eligible: boolean;
	trigger: string | null;
	blocker: string | null;
}

export interface Run_row {
	run_id: string;
	run_name?: string | null;
	state: string;
	realm_id?: string | null;
	team_id?: string | null;
	team_label?: string | null;
	workspace_id?: string | null;
	workspace_name?: string | null;
	daemon_id?: string | null;
	external_id?: string | null;
	context_labels?: Record<string, string> | null;
	current_phase?: string | null;
	started_at?: number | null;
	completed_at?: number | null;
	last_updated_at?: number | null;
	error?: string | null;
	inputs?: string | Record<string, unknown> | null;
	pending_control?: Pending_control | null;
	force_terminate?: Force_terminate_status | null;
	state_lost_at?: number | null;
}

/**
 * Something a run's phase produced: a stored file (download with
 * `artifacts/get_by_id` for a fresh link) or a run record (text — its
 * preview here, the whole text from `artifacts/get_by_id`).
 */
export interface Run_artifact {
	artifact_id: string;
	source?: 'file' | 'record';
	/** 'file', or the record kind: output, chat_transcript, review, design, handoff, … */
	kind?: string;
	content_preview?: string | null;
	phase: string;
	name: string;
	description: string | null;
	mime_type: string;
	size_bytes: number;
	created_at: number | null;
}

/** How a phase's output is shown (read by the BFF from the stored `{ text, data }`). */
export interface Phase_output_view {
	kind: 'commands' | 'tool' | 'agent' | 'verdict' | 'sub_team' | 'text';
	/** One line for the collapsed phase row. */
	summary: string;
	body_markdown: string | null;
	/** The agent's "I'll …" narration before its answer. */
	steps: string[];
	verdict: { outcome: string; reason: string | null } | null;
	commands: { total: number; failed: number; items: Array<{ label: string; command: string; pass: boolean; exit_code: number | null; duration_ms: number | null }> } | null;
	sources: Array<{ name: string; detail: string | null; url: string | null }>;
	sub_run: { run_id: string; team_ref: string | null; phases: Array<{ phase: string; ok: boolean | null; summary: string }> } | null;
}

/** A phase's recorded output: the view, plus the stored text exactly as kept. */
export interface Run_phase_output {
	artifact_id: string;
	phase: string;
	created_at: number | null;
	view: Phase_output_view;
	/** The stored output, unmodified — the Raw view. */
	raw: string;
	/** False when only the start could be read. */
	complete: boolean;
}

export interface Run_detail_data {
	run: Run_row;
	phases: Run_detail_phase[];
	realm: Control_realm | null;
	reviews: Array<{ id: string; title: string; phase: string | null; requested_at: number | null; message: string | null }>;
	/** Files the run stored and its run records (`artifacts/get`, composed by the BFF). */
	artifacts: Run_artifact[];
	/** Each phase output, oldest first (absent from an older BFF). */
	phase_outputs?: Run_phase_output[];
	sections: Record<'phases' | 'labels' | 'realm' | 'reviews' | 'artifacts', Section_status>;
	partial: boolean;
}

export function run_href(org_slug: string, realm_slug: string, run_id: string): string {
	return `${realm_path(org_slug, realm_slug)}/runs/${encodeURIComponent(run_id)}`;
}

export function inbox_item_href(item: Inbox_item, org_slug: string, realm_slug: string): string {
	if (item.kind === 'review') return `/reviews/${encodeURIComponent(item.id)}`;
	return run_href(org_slug, realm_slug, item.run_id ?? item.id);
}

export function is_live_state(state: string | null | undefined): boolean {
	return state === 'running' || state === 'awaiting_input';
}

/** Human duration: 45s, 3m 12s, 2h 4m. */
export function format_duration(ms: number | null | undefined): string {
	if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${s % 60}s`;
	const h = Math.floor(m / 60);
	return `${h}h ${m % 60}m`;
}
