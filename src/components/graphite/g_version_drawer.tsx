/**
 * Change the version a realm runs (Update / Change version): the team's versions with their notes
 * (`/v1/teams/get_versions`); saving is `/v1/realms/add_team` with the picked version's id — the
 * realm's own version again re-installs it on the online daemons. Opened from the team's page in
 * a realm.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { relative_time } from '@/lib/overview';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';

const PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';

/** The team as the realm has it. */
export interface Version_drawer_team {
	label: string;
	scope: string | null;
	slug: string;
	/** Catalog team id: what realms/add_team takes. */
	team_id: string | null;
	/** The version the realm runs, and its id when known (else it is looked up in the versions list). */
	version: string | null;
	version_id?: string | null;
	latest_version: string | null;
	update_available: boolean;
}

export function Version_drawer({ realm_id, row, on_close, on_done }: { realm_id: string; row: Version_drawer_team; on_close: () => void; on_done: (text: string, version: string) => Promise<void> | void }) {
	const versions = use_bff_read<{ versions?: Array<{ id: string; version: string; changelog: string | null; published_at: number | null }> }>(
		'/v1/teams/get_versions', { name: row.slug, scope: row.scope }, { fallback_error: 'Could not load versions.' },
	);
	const list = versions.data?.versions ?? [];
	const latest = list[0]?.version ?? row.latest_version;
	const [pick, set_pick] = useState<string | null>(null);
	const chosen = pick ?? (row.update_available && latest ? latest : row.version);
	const auth_fetch = useAuthFetch();
	const [busy, set_busy] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	async function save() {
		if (!chosen) return;
		const version_id = list.find((v) => v.version === chosen)?.id ?? (chosen === row.version ? row.version_id : null);
		// Without the ids there is nothing to send: say so rather than do nothing.
		if (!row.team_id || !version_id) { set_error('This version can’t be picked right now. Reload the page and try again.'); return; }
		set_busy(true);
		set_error(null);
		try {
			const res = await auth_fetch('/v1/realms/add_team', { method: 'POST', body: JSON.stringify({ realm_id, team_id: row.team_id, version_id }) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) { set_error(api_message(payload, 'Request failed')); return; }
		} catch {
			set_error('Network error — check your connection.');
			return;
		} finally {
			set_busy(false);
		}
		await on_done(chosen === row.version ? `${row.label} ${chosen} re-installed on the online daemons.` : `${row.label}: this realm now runs ${chosen}. Online daemons install it now; others when they connect.`, chosen);
	}
	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-[var(--g-backdrop)]" role="dialog" aria-label={`Version of ${row.label}`} onMouseDown={(e) => { if (e.target === e.currentTarget) on_close(); }}>
			<div className="flex h-full w-[480px] max-w-full flex-col gap-4 overflow-y-auto border-l border-[var(--g-line-strong)] bg-[var(--g-panel)] px-6 py-5 shadow-[var(--g-drawer-shadow)]">
				<div className="flex items-center">
					<h2 className="truncate text-[17px] font-semibold">{row.label}</h2>
					<button type="button" onClick={on_close} aria-label="Close" className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-4 w-4" /></button>
				</div>
				<p className="text-[12.5px] text-[var(--g-ink-3)]">This realm runs <span className="g-mono text-[var(--g-ink-2)]">{row.version ?? '—'}</span>. Pick the version it should run.</p>
				{versions.status === 'loading' && !list.length ? <div className="h-[160px] animate-pulse rounded-lg bg-[var(--g-soft)]" aria-busy="true" aria-label="Loading versions" /> : null}
				{versions.error && !list.length ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{versions.error}</p> : null}
				<div role="radiogroup" aria-label="Version" className="flex flex-col gap-1.5">
					{list.map((v, i) => (
						<label key={v.version} className={`flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 ${chosen === v.version ? 'border-[var(--g-acc)] bg-[var(--g-acc-soft)]' : 'border-[var(--g-line)]'}`}>
							<input type="radio" name="version" value={v.version} checked={chosen === v.version} onChange={() => set_pick(v.version)} className="mt-0.5" />
							<span className="min-w-0">
								<span className="flex items-center gap-2">
									<b className="g-mono text-[13px] font-semibold">{v.version}</b>
									{i === 0 ? <span className="rounded-full bg-[var(--g-acc-soft)] px-2 py-0.5 text-[11px] text-[var(--g-acc)]">latest</span> : null}
									{v.version === row.version ? <span className="text-[11.5px] text-[var(--g-ink-3)]">current</span> : null}
									{v.published_at ? <span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]">{relative_time(v.published_at)}</span> : null}
								</span>
								{v.changelog ? <span className="mt-0.5 block text-[12px] text-[var(--g-ink-3)]">{v.changelog}</span> : null}
							</span>
						</label>
					))}
				</div>
				<p className="text-[12px] text-[var(--g-ink-3)]">Daemons online now install it straight away; any other daemon when it connects. Runs already going finish on the version they started with.</p>
				{error ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{error}</p> : null}
				<div className="flex gap-2">
					<button type="button" disabled={!chosen || busy} onClick={() => void save()} className={PRIMARY}>{busy ? 'Saving…' : chosen === row.version ? 'Re-install on online daemons' : `Update realm to ${chosen ?? '…'}`}</button>
					<button type="button" onClick={on_close} className={ROW_ACTION_CLS}>Cancel</button>
				</div>
			</div>
		</div>
	);
}
