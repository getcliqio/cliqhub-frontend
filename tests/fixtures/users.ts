import type { AuthContext, Scope } from '../../lib/types';

const ALICE_SCOPE: Scope = {
	id: 1,
	slug: 'alice',
	display_name: 'Alice',
	owner_id: 1,
	org_id: null,
	visibility: 'public',
	scope_type: 'user',
	created_at: '2025-01-01T00:00:00Z',
};

const ACME_SCOPE: Scope = {
	id: 2,
	slug: 'acme',
	display_name: 'Acme',
	owner_id: 1,
	org_id: 1,
	visibility: 'public',
	scope_type: 'org',
	created_at: '2025-01-01T00:00:00Z',
};

const ACME_LABS_SCOPE: Scope = {
	id: 3,
	slug: 'acme-labs',
	display_name: 'Acme Labs',
	owner_id: 1,
	org_id: 1,
	visibility: 'private',
	scope_type: 'org',
	created_at: '2025-01-01T00:00:00Z',
};

const BOB_SCOPE: Scope = {
	id: 4,
	slug: 'bob',
	display_name: 'Bob',
	owner_id: 3,
	org_id: null,
	visibility: 'public',
	scope_type: 'user',
	created_at: '2025-01-01T00:00:00Z',
};

const ADMIN_SCOPE: Scope = {
	id: 99,
	slug: 'admin_user',
	display_name: 'Admin',
	owner_id: 99,
	org_id: null,
	visibility: 'public',
	scope_type: 'user',
	created_at: '2025-01-01T00:00:00Z',
};

export const UNAUTHED: AuthContext = {
	user: null,
	org_slugs: [],
	scopes: [],
};

export const ALICE: AuthContext = {
	user: {
		id: 1,
		username: 'alice',
		display_name: 'Alice',
		email: 'alice@test.com',
		role: 'user',
		suspended_at: null,
		suspended_reason: '',
		created_at: '2025-01-01T00:00:00Z',
	},
	org_slugs: ['acme'],
	scopes: [ALICE_SCOPE, ACME_SCOPE, ACME_LABS_SCOPE],
};

export const BOB: AuthContext = {
	user: {
		id: 3,
		username: 'bob',
		display_name: 'Bob',
		email: 'bob@test.com',
		role: 'user',
		suspended_at: null,
		suspended_reason: '',
		created_at: '2025-01-01T00:00:00Z',
	},
	org_slugs: ['acme'],
	scopes: [BOB_SCOPE],
};

export const SUSPENDED_USER: AuthContext = {
	user: {
		id: 5,
		username: 'suspended',
		display_name: 'Suspended User',
		email: 'suspended@test.com',
		role: 'user',
		suspended_at: '2025-06-01T00:00:00Z',
		suspended_reason: 'Policy violation',
		created_at: '2025-01-01T00:00:00Z',
	},
	org_slugs: [],
	scopes: [],
};

export const SITE_ADMIN: AuthContext = {
	user: {
		id: 99,
		username: 'admin_user',
		display_name: 'Site Admin',
		email: 'admin@test.com',
		role: 'admin',
		suspended_at: null,
		suspended_reason: '',
		created_at: '2025-01-01T00:00:00Z',
	},
	org_slugs: [],
	scopes: [ADMIN_SCOPE],
};

export { ALICE_SCOPE, ACME_SCOPE, ACME_LABS_SCOPE, BOB_SCOPE, ADMIN_SCOPE };
