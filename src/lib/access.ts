/**
 * May the signed-in person do this here? Mirrors Core's route policy so the
 * app can grey out what would be refused, with the reason on hover:
 *
 *   - realm actions need a realm level (view < operate < admin) AND, when
 *     the person has an org role, that role's permission (owners hold all);
 *   - org actions need the org permission;
 *   - site admins may do anything.
 *
 * Data comes from the overview the shell already loads (`realms[].level`,
 * `orgs[].permissions`). When Core didn't say (older Core, a realm not in
 * the overview) nothing is greyed out — Core still enforces.
 */
import { useMemo } from 'react';
import { useAuth } from '@/lib/auth_context';
import { realm_label, type Overview_data } from '@/lib/overview';

export type Realm_level = 'view' | 'operate' | 'admin';

/** Allowed, or why not. */
export interface Gate {
	ok: boolean;
	reason: string | null;
}

const RANK: Record<Realm_level, number> = { view: 0, operate: 1, admin: 2 };
const ALLOW: Gate = { ok: true, reason: null };
const LEVEL_WORD: Record<Exclude<Realm_level, 'view'>, string> = { operate: 'operator', admin: 'admin' };

/** Realm action: `need` level in the realm and (when the person has an org role) `perm`. */
export function realm_gate(data: Overview_data | null, realm_id: string | null | undefined, need: Exclude<Realm_level, 'view'>, perm?: string, site_admin = false): Gate {
	if (site_admin || !data || !realm_id) return ALLOW;
	for (const org of data.orgs) {
		const realm = org.realms.find((r) => r.id === realm_id);
		if (!realm) continue;
		if (realm.level && RANK[realm.level] < RANK[need]) {
			return { ok: false, reason: `Needs ${LEVEL_WORD[need]} access in ${realm_label(realm)}` };
		}
		if (perm && org.permissions && !org.permissions.includes(perm)) {
			return { ok: false, reason: `Your role in ${org.display_name || org.slug} doesn't allow this` };
		}
		return ALLOW;
	}
	return ALLOW;
}

/** Org action: the org permission. */
export function org_gate(data: Overview_data | null, org_id: string | null | undefined, perm: string, site_admin = false): Gate {
	if (site_admin || !data || !org_id) return ALLOW;
	const org = data.orgs.find((o) => o.id === org_id);
	if (!org?.permissions || org.permissions.includes(perm)) return ALLOW;
	return { ok: false, reason: `Your role in ${org.display_name || org.slug} doesn't allow this` };
}

/** `realm(id, need, perm?)` and `org(id, perm)` bound to the overview and the signed-in user. */
export function use_access(data: Overview_data | null) {
	const { user } = useAuth();
	const site_admin = user?.role === 'admin';
	return useMemo(() => ({
		realm: (realm_id: string | null | undefined, need: Exclude<Realm_level, 'view'>, perm?: string) => realm_gate(data, realm_id, need, perm, site_admin),
		org: (org_id: string | null | undefined, perm: string) => org_gate(data, org_id, perm, site_admin),
	}), [data, site_admin]);
}
