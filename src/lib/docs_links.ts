/** Canonical Cliq docs base (Mintlify). */
export const DOCS_BASE = 'https://docs.getcliq.io';

export const DOCS = {
	home: `${DOCS_BASE}/`,
	concepts: `${DOCS_BASE}/concepts`,
	team: `${DOCS_BASE}/concepts#team`,
	get_started: `${DOCS_BASE}/get-started`,
	running_teams: `${DOCS_BASE}/running-teams`,
	agents: `${DOCS_BASE}/agents`,
	auth: `${DOCS_BASE}/auth`,
	cli: `${DOCS_BASE}/cli`,
	builder: `${DOCS_BASE}/cli#builder`,
	docker: `${DOCS_BASE}/cli#docker`,
	inspect: `${DOCS_BASE}/running-teams#5-inspect`,
	gates: `${DOCS_BASE}/concepts#gates`,
	user_tokens: `${DOCS_BASE}/auth#user-token-automation`,
	realm_tokens: `${DOCS_BASE}/auth#realm-token-machines`,
	realms: `${DOCS_BASE}/auth#realm-token-machines`,
	grants: `${DOCS_BASE}/auth#grants-domains--access`,
} as const;
