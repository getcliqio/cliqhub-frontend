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
	/** Reviewers chosen per human phase when the run was started. */
	reviewers?: Record<string, string[]> | null;
	/** Channels that get this run's notifications instead of the realm rules. */
	notify_channels?: string[] | null;
}

export interface Run_detail_data {
	run: Run_row;
	phases: Run_detail_phase[];
	realm: Control_realm | null;
	reviews: Array<{ id: string; title: string; phase: string | null; requested_at: number | null; message: string | null }>;
	/** Files the run's phases produced, oldest first. */
	artifacts?: Run_artifact[];
	sections: Record<'phases' | 'labels' | 'realm' | 'reviews', Section_status> & { artifacts?: Section_status };
	partial: boolean;
}

export interface Run_artifact {
	artifact_id: string;
	phase: string;
	name: string;
	description: string | null;
	mime_type: string;
	size_bytes: number;
	download_url: string | null;
	created_at: number | null;
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
