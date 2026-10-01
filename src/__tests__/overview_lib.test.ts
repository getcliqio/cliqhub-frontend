import { describe, it, expect } from 'vitest';
import { item_href, relative_time, scope_overview } from '@/lib/overview';
import { multi_org_overview, ORG_A, ORG_B } from './fixtures_overview';

describe('scope_overview', () => {
	it('returns the same data when no org is selected', () => {
		const d = multi_org_overview();
		expect(scope_overview(d, null)).toBe(d);
	});

	it('narrows orgs, totals and lists to one org without refetching', () => {
		const d = multi_org_overview();
		const v = scope_overview(d, ORG_B);
		expect(v.orgs.map((o) => o.slug)).toEqual(['acme-labs']);
		expect(v.totals).toMatchObject({ orgs: 1, realms: 1, needs_you: 1, active_runs: 0, daemons_total: 1 });
		expect(v.needs_you.every((i) => i.org_id === ORG_B)).toBe(true);
		expect(v.live_runs).toEqual([]);
	});

	it('treats an errored org as zero and partial', () => {
		const d = multi_org_overview();
		d.orgs[0] = { ...d.orgs[0], status: 'error', error: 'boom', realms: [] };
		const v = scope_overview(d, ORG_A);
		expect(v.partial).toBe(true);
		expect(v.totals.needs_you).toBe(0);
	});
});

describe('item_href', () => {
	it('links reviews to the review page', () => {
		expect(item_href(multi_org_overview().needs_you[0])).toBe('/reviews/rev-1');
	});
	it('links runs into their realm', () => {
		expect(item_href(multi_org_overview().live_runs[0])).toBe('/o/measureone/realms/prod-us/runs/run-1843');
	});
	it('falls back to the global run route when the realm is unknown', () => {
		const item = { ...multi_org_overview().live_runs[0], realm_slug: null };
		expect(item_href(item)).toBe('/runs/run-1843');
	});
	it('encodes ids', () => {
		const item = { ...multi_org_overview().needs_you[0], id: 'a/b' };
		expect(item_href(item)).toBe('/reviews/a%2Fb');
	});
});

describe('relative_time', () => {
	const now = 1_000_000_000;
	it.each([
		[null, ''],
		[now - 10_000, 'just now'],
		[now - 12 * 60_000, '12m ago'],
		[now - 3 * 3600_000, '3h ago'],
		[now - 72 * 3600_000, '3d ago'],
	])('%s → %s', (ms, out) => {
		expect(relative_time(ms as number | null, now)).toBe(out);
	});
});
