import type { Realm_inbox_data, Run_detail_data } from '@/lib/realm_inbox';
import { single_org_overview } from './fixtures_overview';

export const REALM = { id: 'r-prod', slug: 'prod-us', name: 'Prod US', org_slug: 'measureone' };

const ok = { status: 'ok' as const, error: null };

export function inbox(over: Partial<Realm_inbox_data> = {}): Realm_inbox_data {
	const now = Date.now();
	return {
		realm: REALM,
		items: [
			{ kind: 'input', id: 'run-88', run_id: 'run-88', title: 'income-verify #88', team: 'income-verify', phase: 'intake', state: 'awaiting_input', at: now - 60_000, error: null, message: null, artifact_count: null },
			{ kind: 'failed', id: 'run-77', run_id: 'run-77', title: 'Nightly reconcile', team: 'recon', phase: 'match', state: 'crashed', at: now - 120_000, error: 'Timeout talking to ledger', message: null, artifact_count: null },
			{ kind: 'review', id: 'rev-1', run_id: 'run-1841', title: 'Approve architecture', team: '@cliq/feature-dev-js', phase: 'design-review', state: 'pending', at: now - 600_000, error: null, message: 'Please check the retry budget', artifact_count: 2 },
		],
		live: [
			{ kind: 'run', id: 'run-1843', run_id: 'run-1843', title: 'PROJ-491 · Webhook signing', team: 'feature-dev-js', phase: 'implement', state: 'running', at: now - 30_000, error: null, message: null, artifact_count: null },
		],
		counts: { reviews: 1, awaiting_input: 1, failed_24h: 1, running: 1 },
		sections: { reviews: ok, awaiting_input: ok, failed: ok, running: ok },
		partial: false,
		...over,
	};
}

export function run_detail(over: Partial<Run_detail_data> = {}, run_over: Partial<Run_detail_data['run']> = {}): Run_detail_data {
	const now = Date.now();
	return {
		run: {
			run_id: 'run-77', run_name: 'Nightly reconcile', state: 'failed', realm_id: REALM.id,
			team_id: 'measureone/recon', team_label: '@measureone/recon', workspace_id: 'ws-1', workspace_name: 'ledger',
			daemon_id: 'd-1', started_at: now - 600_000, completed_at: now - 60_000, error: 'Timeout talking to ledger',
			inputs: { month: '2026-08' }, context_labels: { source: 'cron' }, pending_control: null, force_terminate: null, state_lost_at: null,
			...run_over,
		},
		phases: [
			{ phase: 'match', status: 'failed', sequence: 1, started_at: now - 300_000, completed_at: now - 60_000, error: 'ledger timeout', agent: 'matcher' },
			{ phase: 'fetch', status: 'completed', sequence: 0, started_at: now - 600_000, completed_at: now - 300_000, error: null, agent: 'fetcher' },
		],
		realm: REALM,
		reviews: [],
		sections: { phases: ok, labels: ok, realm: ok, reviews: ok },
		partial: false,
		...over,
	};
}

export function overview_for_realm() {
	return single_org_overview();
}
