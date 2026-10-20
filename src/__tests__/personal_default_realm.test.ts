/** A personal default realm has no Danger zone — the same rule Core applies on realms/delete. */
import { describe, it, expect } from 'vitest';
import { is_personal_default_realm } from '@/lib/realm_settings';

describe('is_personal_default_realm', () => {
	const you = { username: 'elan', default_realm_id: 'r-home' };

	it('your default realm, wherever it is', () => {
		expect(is_personal_default_realm({ id: 'r-home', slug: 'anything', org_slug: 'acme' }, you)).toBe(true);
	});

	it('the `default` realm of your own org', () => {
		expect(is_personal_default_realm({ id: 'r-2', slug: 'default', org_slug: 'Elan' }, you)).toBe(true);
	});

	it('any other realm — including a `default` realm in someone else\'s org — can be deleted', () => {
		expect(is_personal_default_realm({ id: 'r-3', slug: 'prod', org_slug: 'elan' }, you)).toBe(false);
		expect(is_personal_default_realm({ id: 'r-4', slug: 'default', org_slug: 'acme' }, you)).toBe(false);
		expect(is_personal_default_realm({ id: 'r-4', slug: 'default', org_slug: 'acme' }, { username: null, default_realm_id: null })).toBe(false);
	});
});
