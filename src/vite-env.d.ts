/// <reference types="vite/client" />

interface ImportMetaEnv {
	/**
	 * Set to the string `'true'` to expose the JIRA Forge integration
	 * page under Settings → Integrations → JIRA (slice 1.7). When
	 * unset the page redirects to /settings and the nav link is
	 * hidden. Independently of this flag, the backend must have
	 * `ENABLE_JIRA_INTEGRATION=1` set — the SPA gracefully surfaces
	 * a "not enabled" banner when only the frontend flag is on.
	 */
	readonly VITE_ENABLE_JIRA_INTEGRATION?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
