import type { Overview_data, Overview_org, Overview_realm, Overview_counts } from '@/lib/overview';

export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';

export function counts(over: Partial<Overview_counts> = {}): Overview_counts {
	return { needs_you: 0, pending_reviews: 0, awaiting_input: 0, active_runs: 0, failed_24h: 0, completed_24h: 0, daemons_online: 0, daemons_total: 0, ...over };
}

export function realm(over: Partial<Overview_realm> & { id: string; slug: string; org_id: string; org_slug: string }): Overview_realm {
	return {
		name: over.slug,
		last_activity_at: 1,
		daemons: { online: 1, stale: 0, offline: 0, total: 1 },
		active_runs: 0,
		awaiting_input: 0,
		pending_reviews: 0,
		needs_you: 0,
		...over,
	};
}

export function org(over: Partial<Overview_org> & { id: string; slug: string }): Overview_org {
	return { display_name: over.slug, role: 'member', status: 'ok', error: null, counts: counts(), realms: [], ...over };
}

/** Two orgs: measureone (owner, 2 realms) and acme-labs (member, 1 realm). */
export function multi_org_overview(): Overview_data {
	const m1 = org({
		id: ORG_A, slug: 'measureone', display_name: 'MeasureOne', role: 'owner',
		counts: counts({ needs_you: 5, pending_reviews: 4, awaiting_input: 1, active_runs: 3, failed_24h: 2, completed_24h: 9, daemons_online: 5, daemons_total: 6 }),
		realms: [
			realm({ id: 'r-prod', slug: 'prod-us', org_id: ORG_A, org_slug: 'measureone', daemons: { online: 5, stale: 0, offline: 1, total: 6 }, active_runs: 3, pending_reviews: 3, awaiting_input: 1, needs_you: 4 }),
			realm({ id: 'r-stage', slug: 'staging', org_id: ORG_A, org_slug: 'measureone', pending_reviews: 1, needs_you: 1 }),
		],
	});
	const acme = org({
		id: ORG_B, slug: 'acme-labs', display_name: 'Acme Labs', role: 'member',
		counts: counts({ needs_you: 1, pending_reviews: 1, daemons_online: 1, daemons_total: 1 }),
		realms: [realm({ id: 'r-sand', slug: 'sandbox', org_id: ORG_B, org_slug: 'acme-labs', pending_reviews: 1, needs_you: 1 })],
	});
	return {
		orgs: [m1, acme],
		totals: { ...counts({ needs_you: 6, pending_reviews: 5, awaiting_input: 1, active_runs: 3, failed_24h: 2, completed_24h: 9, daemons_online: 6, daemons_total: 7 }), orgs: 2, realms: 3 },
		needs_you: [
			{ kind: 'review', id: 'rev-1', title: 'Approve architecture · PROJ-482', org_id: ORG_A, org_slug: 'measureone', realm_id: 'r-prod', realm_slug: 'prod-us', run_id: 'run-1841', team: '@cliq/feature-dev-js', phase: 'design-review', state: 'pending', at: Date.now() - 60_000 * 12 },
			{ kind: 'review', id: 'rev-2', title: 'Review docs page', org_id: ORG_B, org_slug: 'acme-labs', realm_id: 'r-sand', realm_slug: 'sandbox', run_id: 'run-9', team: 'docs-from-drive', phase: 'editor-pass', state: 'pending', at: Date.now() - 60_000 * 60 },
			{ kind: 'input', id: 'run-88', title: 'income-verify #88', org_id: ORG_A, org_slug: 'measureone', realm_id: 'r-prod', realm_slug: 'prod-us', run_id: 'run-88', team: 'income-verify', phase: null, state: 'awaiting_input', at: Date.now() - 60_000 * 38 },
		],
		live_runs: [
			{ kind: 'run', id: 'run-1843', title: 'PROJ-491 · Webhook signing', org_id: ORG_A, org_slug: 'measureone', realm_id: 'r-prod', realm_slug: 'prod-us', run_id: 'run-1843', team: 'feature-dev-js', phase: null, state: 'running', at: Date.now() - 60_000 * 14 },
		],
		partial: false,
	};
}

export function single_org_overview(): Overview_data {
	const d = multi_org_overview();
	const only = d.orgs[0];
	return {
		orgs: [only],
		totals: { ...only.counts, orgs: 1, realms: only.realms.length },
		needs_you: d.needs_you.filter((i) => i.org_id === ORG_A),
		live_runs: d.live_runs,
		partial: false,
	};
}

/** Getting-started progress used by the shell footer in page tests. */
export function gs_progress(done_count = 2) {
	return {
		cli: { done: done_count > 0 }, daemon: { done: done_count > 1, online: 1, total: 1, realm: { org_slug: 'measureone', slug: 'prod-us' } },
		team: { done: done_count > 2, realm: null }, run: { done: done_count > 3, run_id: null, realm: null },
		realm: { org_slug: 'measureone', slug: 'prod-us' }, done_count, total: 4, partial: false,
	};
}

/** Answer the shell's getting-started read; everything else falls through. */
export function gs_response(url: unknown): Response | null {
	return String(url) === '/v1/getting_started/get' ? new Response(JSON.stringify({ ok: true, data: gs_progress() })) : null;
}
