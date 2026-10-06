import { describe, it, expect } from 'vitest';
import { resolve_view, sidebar_realms, sort_realms, view_href, SIDEBAR_REALM_LIMIT } from '@/lib/view_scope';
import { multi_org_overview, single_org_overview, realm, ORG_A } from './fixtures_overview';

const none = { org_param: null, realm_org: null, realm_slug: null };

describe('resolve_view', () => {
	it('several orgs and nothing chosen → no org yet (the shell asks)', () => {
		expect(resolve_view(multi_org_overview(), none).kind).toBe('all');
	});
	it('org from ?org= when the user is a member', () => {
		const v = resolve_view(multi_org_overview(), { ...none, org_param: 'acme-labs' });
		expect(v.kind === 'org' && v.org.slug).toBe('acme-labs');
	});
	it('ignores an org the user is not in', () => {
		expect(resolve_view(multi_org_overview(), { ...none, org_param: 'nope' }).kind).toBe('all');
	});
	it('realm route wins, and carries its org', () => {
		const v = resolve_view(multi_org_overview(), { org_param: 'acme-labs', realm_org: 'measureone', realm_slug: 'staging' });
		expect(v.kind).toBe('realm');
		expect(v.realm?.slug).toBe('staging');
		expect(v.org?.slug).toBe('measureone');
	});
	it('fallbacks: URL, then the remembered org, then the default realm\'s org', () => {
		const d = multi_org_overview();
		expect(resolve_view(d, { ...none, last_org: 'acme-labs' }).org?.slug).toBe('acme-labs');
		expect(resolve_view(d, { ...none, org_param: 'measureone', last_org: 'acme-labs' }).org?.slug).toBe('measureone');
		expect(resolve_view(d, { ...none, default_realm_id: 'r-sand' }).org?.slug).toBe('acme-labs');
		expect(resolve_view(d, { ...none, last_org: 'measureone', default_realm_id: 'r-sand' }).org?.slug).toBe('measureone');
		// A remembered org the user has left is ignored.
		expect(resolve_view(d, { ...none, last_org: 'gone', default_realm_id: 'r-sand' }).org?.slug).toBe('acme-labs');
	});
	it('a single-org user is always in their org', () => {
		const v = resolve_view(single_org_overview(), none);
		expect(v.kind === 'org' && v.org.slug).toBe('measureone');
	});
	it('no data yet → no org', () => {
		expect(resolve_view(null, none).kind).toBe('all');
	});
});

describe('sidebar_realms', () => {
	it('lists no realms until an org is chosen', () => {
		expect(sidebar_realms(multi_org_overview(), { kind: 'all', org: null, realm: null })).toEqual({ shown: [], total: 0 });
	});
	it('caps at the limit and keeps the current realm visible', () => {
		const d = single_org_overview();
		d.orgs[0] = { ...d.orgs[0], realms: Array.from({ length: 15 }, (_, i) => realm({ id: `r${i}`, slug: `r-${i}`, org_id: ORG_A, org_slug: 'measureone', last_activity_at: i })) };
		const current = d.orgs[0].realms[0];
		const { shown, total } = sidebar_realms(d, { kind: 'realm', realm: current, org: d.orgs[0] });
		expect(total).toBe(15);
		expect(shown).toHaveLength(SIDEBAR_REALM_LIMIT);
		expect(shown.map((r) => r.id)).toContain('r0');
	});
	it('sorts waiting-on-you, then activity, then name', () => {
		const a = realm({ id: 'a', slug: 'b', org_id: ORG_A, org_slug: 'x', last_activity_at: 5, needs_you: 0 });
		const b = realm({ id: 'b', slug: 'a', org_id: ORG_A, org_slug: 'x', last_activity_at: 5, needs_you: 0 });
		const c = realm({ id: 'c', slug: 'c', org_id: ORG_A, org_slug: 'x', last_activity_at: 1, needs_you: 3 });
		expect(sort_realms([a, b, c]).map((r) => r.id)).toEqual(['c', 'b', 'a']);
	});
});

describe('view_href', () => {
	const d = multi_org_overview();
	it('adds ?org for an org view in a multi-org account', () => {
		expect(view_href('/home', { kind: 'org', org: d.orgs[1], realm: null }, true)).toBe('/home?org=acme-labs');
	});
	it('leaves the path alone for all, or for single-org users', () => {
		expect(view_href('/home', { kind: 'all', org: null, realm: null }, true)).toBe('/home');
		expect(view_href('/home', { kind: 'org', org: d.orgs[0], realm: null }, false)).toBe('/home');
	});
});
