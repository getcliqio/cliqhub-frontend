/**
 * Wrap a React-Router `lazy` loader so a stale chunk 404 (typical
 * after a fresh deploy) auto-recovers with a single hard reload
 * instead of dumping the user on the router's default error page.
 *
 * Vite hashes chunk filenames. When we ship a new build, the browser
 * still holds the old `index.html` in memory; clicking a route it
 * hadn't loaded yet triggers `import('/assets/foo-<oldhash>.js')`
 * against a URL the server no longer knows about → the promise rejects
 * with a `TypeError: Failed to fetch dynamically imported module`.
 *
 * The reload fetches the fresh `index.html`, which references the new
 * chunk names, and the second navigation succeeds. A session flag
 * guards against infinite reload loops if the failure is not deploy-
 * related (e.g. offline, blocked by an extension).
 */

const RELOAD_SESSION_KEY = '__cliqhub_reload_after_chunk_error';

function _is_chunk_load_error(err: unknown): boolean {
	if (!err) return false;
	const msg = err instanceof Error ? err.message : String(err);
	if (!msg) return false;
	return (
		msg.includes('Failed to fetch dynamically imported module')
		|| msg.includes('Importing a module script failed')
		|| msg.includes('error loading dynamically imported module')
		|| msg.includes('ChunkLoadError')
	);
}

export function lazy_route<T>(load: () => Promise<T>): () => Promise<T> {
	return async () => {
		try {
			return await load();
		} catch (err) {
			if (!_is_chunk_load_error(err)) throw err;

			// Only auto-reload once per session — if the fresh
			// `index.html` still can't reach the chunk (offline,
			// CDN misconfig) surface the error normally so the
			// user isn't trapped in a reload loop.
			if (typeof window === 'undefined') throw err;
			try {
				if (window.sessionStorage.getItem(RELOAD_SESSION_KEY)) throw err;
				window.sessionStorage.setItem(RELOAD_SESSION_KEY, String(Date.now()));
			} catch {
				// sessionStorage unavailable (private mode?) — still try one reload.
			}
			window.location.reload();
			// The reload is async; return an unresolved promise so
			// React Router stays in its pending state until the page
			// tears down.
			return new Promise<T>(() => {});
		}
	};
}
