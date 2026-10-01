/**
 * Publish: version (suggested from the change set), release notes drafted
 * from the diff, checks, Marketplace listing, then optionally upgrade the
 * realms that already run this team.
 *
 * Read: one `POST /v1/team_page/get {view: 'installs'}` (current version +
 * where it's installed; 404 = first publish).
 * Writes: `/v1/teams/publish`, then `/v1/realms/add_team` per ticked realm.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { api_message } from '@/lib/use_bff_read';
import type { GeneratedTeam } from '@/lib/builder/store';
import type { Problem } from '@/lib/builder/checks';
import { diff_teams, release_notes } from '@/lib/builder/graph_ops';
import { next_version, publish_body, suggest_bump, team_scope, team_slug, type Bump } from '@/lib/builder/publish';
import type { Team_install, Team_page_data } from '@/lib/team_page';
import { team_href } from '@/lib/team_page';

/** Core's publish errors name the version that's taken or the current latest. */
export function version_clash(message: string): string | null {
	const m = /Version (\d+\.\d+\.\d+\S*) already exists/i.exec(message) ?? /current latest \((\d+\.\d+\.\d+[^)]*)\)/i.exec(message);
	return m ? m[1] : null;
}

const BUMPS: Array<{ id: Bump; label: string; hint: string }> = [
	{ id: 'patch', label: 'Patch', hint: 'fixes, wording' },
	{ id: 'minor', label: 'Minor', hint: 'new phases' },
	{ id: 'major', label: 'Major', hint: 'breaking inputs' },
];

export function Gb_publish({ team, baseline, problems, on_close, on_published }: {
	team: GeneratedTeam;
	/** What the team looked like when opened (for the change set). */
	baseline: GeneratedTeam | null;
	problems: Problem[];
	on_close: () => void;
	on_published: (version: string) => void;
}) {
	const auth_fetch = useAuthFetch();
	const { scopes, user } = useAuth();
	const fallback = scopes[0]?.slug ?? user?.username ?? '';
	const [scope, set_scope] = useState(team_scope(team, fallback));
	const slug = team_slug(team);
	const changes = useMemo(() => diff_teams(baseline, team), [baseline, team]);
	const [loading, set_loading] = useState(true);
	const [current, set_current] = useState<string | null>(null);
	const [installs, set_installs] = useState<Team_install[]>([]);
	const [bump, set_bump] = useState<Bump>(suggest_bump(changes));
	const [notes, set_notes] = useState(release_notes(changes));
	const [listed, set_listed] = useState(true);
	const [upgrade, set_upgrade] = useState<Set<string>>(new Set());
	const [busy, set_busy] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	const [done, set_done] = useState<{ version: string; upgraded: string[]; failed: string[] } | null>(null);

	useEffect(() => {
		let live = true;
		set_loading(true);
		auth_fetch('/v1/team_page/get', { method: 'POST', body: JSON.stringify({ scope, name: slug, view: 'installs' }) })
			.then(async (res) => {
				const p = await res.json().catch(() => null);
				if (!live) return;
				const d = res.ok && p?.ok ? (p.data as Team_page_data) : null;
				set_current(d?.team.latest_version ?? null);
				if (d) set_listed(d.team.listed || d.team.status === 'draft');
				const items = d?.installs?.items ?? [];
				set_installs(items);
				set_upgrade(new Set(items.map((i) => i.realm_id)));
			})
			.catch(() => { if (live) { set_current(null); set_installs([]); } })
			.finally(() => { if (live) set_loading(false); });
		return () => { live = false; };
	}, [auth_fetch, scope, slug]);

	const errors = problems.filter((p) => p.level === 'error');
	const warnings = problems.filter((p) => p.level === 'warning');
	const version = next_version(current, bump);

	async function publish() {
		set_busy(true); set_error(null);
		try {
			const body = publish_body(team, { scope, current, bump, changelog: notes, listed });
			const res = await auth_fetch('/v1/teams/publish', { method: 'POST', body: JSON.stringify(body) });
			const p = await res.json().catch(() => null);
			if (!res.ok || !p?.ok) {
				const msg = api_message(p, 'Publish failed.');
				// Version clash: Core says which version is taken / latest — re-base the bump on it.
				const taken = version_clash(msg);
				if (taken) { set_current(taken); set_bump('patch'); set_error(`${msg} Pick the next version below and publish again.`); return; }
				set_error(msg);
				return;
			}
			const v = String(p.data?.version ?? version);
			const upgraded: string[] = []; const failed: string[] = [];
			for (const i of installs.filter((x) => upgrade.has(x.realm_id))) {
				const r = await auth_fetch('/v1/realms/add_team', { method: 'POST', body: JSON.stringify({ realm_id: i.realm_id, scope, slug }) }).catch(() => null);
				const rp = r ? await r.json().catch(() => null) : null;
				(r?.ok && rp?.ok ? upgraded : failed).push(i.realm_slug);
			}
			set_done({ version: v, upgraded, failed });
			on_published(v);
		} catch {
			set_error('Network error — try again.');
		} finally {
			set_busy(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) on_close(); }}>
			<div role="dialog" aria-modal="true" aria-label="Publish team" className="w-full max-w-[640px] rounded-2xl border border-[var(--g-line)] bg-[#141518] shadow-[0_30px_80px_rgba(0,0,0,.6)]">
				<div className="flex items-center gap-3 border-b border-[var(--g-line)] px-5 py-3.5">
					<b className="text-[16px]">Publish</b>
					<span className="g-mono rounded bg-[var(--g-soft)] px-1.5 py-0.5 text-[12px] text-[var(--g-ink-2)]">@{scope}/{slug}</span>
					<button type="button" aria-label="Close" onClick={on_close} disabled={busy} className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">✕</button>
				</div>
				{done ? (
					<div className="px-5 py-8 text-center" data-testid="publish-done">
						<div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[var(--g-ok-soft)] text-[22px] text-[var(--g-ok)]">✓</div>
						<h3 className="mt-3 text-[18px] font-semibold">v{done.version} is live</h3>
						{done.upgraded.length ? <p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Upgraded {done.upgraded.join(', ')}.</p> : null}
						{done.failed.length ? <p role="alert" className="mt-1 text-[13px] text-[var(--g-bad)]">Couldn’t upgrade {done.failed.join(', ')} — retry from the team’s Installs tab.</p> : null}
						<p className="g-mono mt-3 text-[12px] text-[var(--g-ink-3)]">cliq team install @{scope}/{slug}</p>
						<div className="mt-5 flex justify-center gap-2">
							<button type="button" onClick={on_close} className="rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[13px]">Keep editing</button>
							<Link to={team_href(scope, slug)} className="rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[13px] font-semibold text-[var(--g-on-acc)]">Open team →</Link>
						</div>
					</div>
				) : (
					<>
						<div className="grid max-h-[70vh] gap-5 overflow-y-auto px-5 py-4">
							{scopes.length > 1 && !/^@/.test(team.name) ? (
								<label className="flex items-center gap-2 text-[12.5px] text-[var(--g-ink-3)]">Publish to
									<select aria-label="Scope" value={scope} onChange={(e) => set_scope(e.target.value)} className="w-[220px] rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2 py-1 text-[12.5px] text-[var(--g-ink)]">
										{scopes.map((s) => <option key={s.slug} value={s.slug}>@{s.slug}</option>)}
									</select>
								</label>
							) : null}
							<div>
								<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Version <span className="normal-case tracking-normal">{loading ? '· checking…' : current ? `· now ${current}` : '· first release'}</span></p>
								{loading ? null : current ? (
									<div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Version bump">
										{BUMPS.map((b) => (
											<button key={b.id} type="button" role="radio" aria-checked={bump === b.id} onClick={() => set_bump(b.id)} className={`rounded-xl border px-3 py-2.5 text-left ${bump === b.id ? 'border-[var(--g-acc)] bg-[var(--g-acc-soft)]' : 'border-[var(--g-line)]'}`}>
												<b className="text-[13.5px]">{b.label} <span className="g-mono font-normal text-[var(--g-acc)]">{next_version(current, b.id)}</span></b>
												<span className="block text-[11.5px] text-[var(--g-ink-3)]">{b.hint}{suggest_bump(changes) === b.id ? ' · suggested' : ''}</span>
											</button>
										))}
									</div>
								) : <p className="g-mono text-[14px] text-[var(--g-acc)]">1.0.0</p>}
							</div>
							<div>
								<div className="mb-2 flex items-center"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Release notes</p>
									{changes.length ? <button type="button" onClick={() => set_notes(release_notes(changes))} className="ml-auto rounded-full bg-[rgba(155,140,255,.14)] px-2.5 py-0.5 text-[11.5px] text-[#cfc7ff]">✦ Draft from your changes</button> : null}</div>
								<textarea aria-label="Release notes" value={notes} onChange={(e) => set_notes(e.target.value)} rows={4} placeholder="What’s new in this version…" className="w-full resize-y rounded-lg border border-[var(--g-line)] bg-[var(--g-bg)] px-3 py-2 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]" />
							</div>
							<div>
								<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Checks</p>
								<div className="flex flex-wrap gap-1.5" data-testid="publish-checks">
									{!errors.length ? <span className="rounded-full bg-[var(--g-ok-soft)] px-2.5 py-0.5 text-[12px] text-[var(--g-ok)]">✓ Valid workflow</span> : null}
									{errors.map((p) => <span key={p.id} className="rounded-full bg-[var(--g-bad-soft)] px-2.5 py-0.5 text-[12px] text-[var(--g-bad)]">✕ {p.phase && !p.message.startsWith(p.phase) ? `${p.phase}: ` : ''}{p.message}</span>)}
									{warnings.map((p) => <span key={p.id} className="rounded-full bg-[var(--g-warn-soft)] px-2.5 py-0.5 text-[12px] text-[var(--g-warn-text)]">! {p.phase && !p.message.startsWith(p.phase) ? `${p.phase}: ` : ''}{p.message}</span>)}
								</div>
							</div>
							<div className="grid gap-4 md:grid-cols-2">
								<label className="flex items-start gap-2.5 text-[13px]">
									<input type="checkbox" checked={listed} onChange={(e) => set_listed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--g-acc)]" />
									<span>Listed in Marketplace<span className="block text-[11.5px] text-[var(--g-ink-3)]">Off = private: only your scope can install it.</span></span>
								</label>
								{installs.length ? (
									<div>
										<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]">Then update realms</p>
										{installs.map((i) => (
											<label key={i.realm_id} className="flex items-center gap-2 py-0.5 text-[13px]">
												<input type="checkbox" checked={upgrade.has(i.realm_id)} onChange={(e) => set_upgrade((s) => { const n = new Set(s); if (e.target.checked) n.add(i.realm_id); else n.delete(i.realm_id); return n; })} className="h-4 w-4 accent-[var(--g-acc)]" />
												{i.realm_name || i.realm_slug}
												<span className="g-mono ml-auto text-[11.5px] text-[var(--g-ink-3)]">{i.version ?? '—'} → {version}</span>
											</label>
										))}
									</div>
								) : null}
							</div>
							{error ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{error}</p> : null}
						</div>
						<div className="flex items-center gap-2 border-t border-[var(--g-line)] px-5 py-3.5">
							<p className="text-[12px] text-[var(--g-ink-3)]">{errors.length ? 'Fix the errors above to publish.' : `Publishing makes ${version} installable.`}</p>
							<button type="button" onClick={on_close} disabled={busy} className="ml-auto rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[13px]">Cancel</button>
							<button type="button" onClick={() => void publish()} disabled={busy || loading || errors.length > 0} className="rounded-md bg-[var(--g-acc)] px-4 py-1.5 text-[13px] font-semibold text-[var(--g-on-acc)] disabled:opacity-40">{busy ? 'Publishing…' : `Publish ${version}`}</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
