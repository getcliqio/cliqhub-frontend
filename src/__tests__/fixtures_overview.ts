import type { Overview_data, Overview_org, Overview_realm, Overview_counts } from '@/lib/overview';

export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';

export function counts(over: Partial<Overview_counts> = {}): Overview_counts {
	return { awaiting_input: 0, active_runs: 0, failed_24h: 0, completed_24h: 0, daemons_online: 0, daemons_total: 0, ...over };
}

export function realm(over: Partial<Overview_realm> & { id: string; slug: string; org_id: string; org_slug: string }): Overview_realm {
	return {
		name: over.slug,
		last_activity_at: 1,
		daemons: { online: 1, stale: 0, offline: 0, total: 1 },
		active_runs: 0,
		awaiting_input: 0,
		...over,
	};
}

export function org(over: Partial<Overview_org> & { id: string; slug: string }): Overview_org {
	return { display_name: over.slug, role: 'member', org_status: 'active', status: 'ok', error: null, counts: counts(), realms: [], ...over };
}

/** Two orgs: measureone (owner, 2 realms) and acme-labs (member, 1 realm). */
export function multi_org_overview(): Overview_data {
	const m1 = org({
		id: ORG_A, slug: 'measureone', display_name: 'MeasureOne', role: 'owner',
		counts: counts({ awaiting_input: 1, active_runs: 3, failed_24h: 2, completed_24h: 9, daemons_online: 5, daemons_total: 6 }),
		realms: [
			realm({ id: 'r-prod', slug: 'prod-us', org_id: ORG_A, org_slug: 'measureone', daemons: { online: 5, stale: 0, offline: 1, total: 6 }, active_runs: 3, awaiting_input: 1 }),
			realm({ id: 'r-stage', slug: 'staging', org_id: ORG_A, org_slug: 'measureone' }),
		],
	});
	const acme = org({
		id: ORG_B, slug: 'acme-labs', display_name: 'Acme Labs', role: 'member',
		counts: counts({ daemons_online: 1, daemons_total: 1 }),
		realms: [realm({ id: 'r-sand', slug: 'sandbox', org_id: ORG_B, org_slug: 'acme-labs' })],
	});
	return {
		orgs: [m1, acme],
		totals: { ...counts({ awaiting_input: 1, active_runs: 3, failed_24h: 2, completed_24h: 9, daemons_online: 6, daemons_total: 7 }), orgs: 2, realms: 3 },
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
