/** lib/access — the app's mirror of Core's route policy for greying out actions. */
import { describe, it, expect } from 'vitest';
import { realm_gate, org_gate } from '@/lib/access';
import { multi_org_overview, ORG_A } from './fixtures_overview';

function data(level: 'view' | 'operate' | 'admin' | null, permissions: string[] | null) {
	const d = multi_org_overview();
	const org = d.orgs.find((o) => o.id === ORG_A)!;
	org.permissions = permissions;
	org.realms[0]!.level = level; // r-prod
	return d;
}

describe('realm_gate', () => {
	it('level too low → greyed out with the reason', () => {
		expect(realm_gate(data('view', null), 'r-prod', 'operate')).toEqual({ ok: false, reason: 'Needs operator access in prod-us' });
		expect(realm_gate(data('operate', null), 'r-prod', 'admin').reason).toBe('Needs admin access in prod-us');
		expect(realm_gate(data('operate', null), 'r-prod', 'operate').ok).toBe(true);
	});
	it('the org role must hold the permission', () => {
		expect(realm_gate(data('operate', ['teams.run']), 'r-prod', 'operate', 'teams.cancel')).toEqual({ ok: false, reason: "Your role in MeasureOne doesn't allow this" });
		expect(realm_gate(data('operate', ['teams.run']), 'r-prod', 'operate', 'teams.run').ok).toBe(true);
	});
	it('unknown (older Core, unknown realm, no data) or site admin → allowed; Core still enforces', () => {
		expect(realm_gate(data(null, null), 'r-prod', 'admin', 'x').ok).toBe(true);
		expect(realm_gate(data('view', []), 'nope', 'admin').ok).toBe(true);
		expect(realm_gate(null, 'r-prod', 'admin').ok).toBe(true);
		expect(realm_gate(data('view', []), 'r-prod', 'admin', 'x', true).ok).toBe(true);
	});
});

describe('org_gate', () => {
	it('needs the org permission; unknown → allowed', () => {
		expect(org_gate(data(null, ['realms.view']), ORG_A, 'realms.create').ok).toBe(false);
		expect(org_gate(data(null, ['realms.create']), ORG_A, 'realms.create').ok).toBe(true);
		expect(org_gate(data(null, null), ORG_A, 'realms.create').ok).toBe(true);
	});
});
