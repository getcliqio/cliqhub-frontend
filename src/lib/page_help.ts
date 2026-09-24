import { DOCS } from '@/lib/docs_links';

/** Help copy + docs for concept-heavy product pages (not every nav item). */
export const PAGE_HELP = {
	home: {
		help: 'Your Hub overview — workspaces, teams, daemons, and recent runs in one place.',
		docs_href: DOCS.concepts,
	},
	getting_started: {
		help: 'Step 1: install CLI, start cliqd, team install, then init → assemble → run. Step 2: cliq login (default realm token comes with login) and restart cliqd. Step 3: create a shared realm, add users, share enroll tokens.',
		docs_href: DOCS.get_started,
	},
	teams: {
		help: 'Teams are portable packages of agents, phases, and gates. Publish here; install with cliq hub install.',
		docs_href: DOCS.team,
	},
	browse: {
		help: 'Public catalog of listed teams you can install from CliqHub.',
		docs_href: DOCS.team,
	},
	scopes: {
		help: 'A scope is a package namespace for teams (for example @acme). Scopes do not enroll machines — realms do.',
		docs_href: DOCS.auth,
	},
	realms: {
		help: 'A realm is a machine access group. Mint a realm token on the realm page to enroll daemons.',
		docs_href: DOCS.realms,
	},
	tokens: {
		help: 'User Hub credentials (cliq_tok_…) for CLI login and CI. Realm enroll tokens are minted on each realm page.',
		docs_href: DOCS.user_tokens,
	},
	daemons: {
		help: 'A daemon is a machine in a realm. Mint a realm enroll token, set CLIQ_DAEMON_TOKEN, then start cliq-daemon.',
		docs_href: DOCS.realm_tokens,
	},
	workspaces: {
		help: 'A workspace is a project directory registered on a daemon. Teams are assembled to workspaces for execution.',
		docs_href: DOCS.concepts,
	},
	runs: {
		help: 'A run executes an assembled team’s phases on a daemon. Start with cliq run; inspect with status and logs.',
		docs_href: DOCS.running_teams,
	},
	logs: {
		help: 'Searchable run output for the realm (query, time, facets). Mirror from the daemon with hub_connect.sync and hub_connect.sync_logs.',
		docs_href: DOCS.inspect,
	},
	notifications: {
		help: 'Filterable in-app deliveries from Hub events (query, time, event/severity facets). Configure channels under Realm → Notifications.',
		docs_href: DOCS.agents,
	},
	reviews: {
		help: 'Open HUG reviews for realms you belong to. Open a review in Hub to approve, reject, or route — powered by the Hug review UI.',
		docs_href: DOCS.gates,
	},
	builder: {
		help: 'Describe a team in plain English; Builder generates roles, workflow, and gates you can refine and publish. gate + agent hug requires review.reviewer before publish.',
		docs_href: DOCS.builder,
	},
} as const;
