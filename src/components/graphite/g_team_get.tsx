/**
 * Getting a team you found in the marketplace, two ways:
 *
 *   Add — the team joins one of your orgs (`orgs/add_team`), then optionally
 *     one of that org's realms (`realms/add_team`), whose online daemons
 *     install it. A team runs only in a realm that has it.
 *   Fork — a copy of one version becomes a new private draft team in a scope
 *     you own (`teams/create { forked_from }`). The original, its versions and
 *     its installs are untouched; the fork remembers where it came from.
 *
 * Also the lineage strip shown on a fork's page.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, GitFork, Server, X } from 'lucide-react';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { api_message } from '@/lib/use_bff_read';
import type { Overview_org } from '@/lib/overview';
import { team_href, type Team_fork_origin, type Team_org_state, type Team_release } from '@/lib/team_page';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';

const PRIMARY = 'inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--g-acc)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';
const INPUT = 'h-9 w-full rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[13px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';
const LABEL = 'mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]';
const NAME_RE = /^[a-z][a-z0-9-]*$/;

type Post = { ok: true; data: Record<string, unknown> } | { ok: false; error: string; status: number; details: Record<string, unknown> | null };

function use_post() {
	const auth_fetch = useAuthFetch();
	return async (path: string, body: Record<string, unknown>): Promise<Post> => {
		try {
			const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify(body) });
			const p = await res.json().catch(() => null);
			if (!res.ok || !p?.ok) return { ok: false, error: api_message(p, 'Request failed'), status: res.status, details: p?.details ?? p?.error?.details ?? null };
			return { ok: true, data: (p.data ?? p) as Record<string, unknown> };
		} catch {
			return { ok: false, error: 'Network error — check your connection.', status: 0, details: null };
		}
	};
}

/** Closes on Escape. */
function use_escape(on_close: () => void) {
	useEffect(() => {
		const h = (e: KeyboardEvent) => { if (e.key === 'Escape') on_close(); };
		document.addEventListener('keydown', h);
		return () => document.removeEventListener('keydown', h);
	}, [on_close]);
}

/** Right-hand drawer chrome shared by the team page's drawers. */
export function G_drawer({ title, sub, on_close, footer, children, width = 460, label }: { title: ReactNode; sub?: ReactNode; on_close: () => void; footer?: ReactNode; children: ReactNode; width?: number; label: string }) {
	use_escape(on_close);
	return (
		<div className="fixed inset-0 z-50 flex justify-end">
			<button type="button" aria-label="Close" tabIndex={-1} onClick={on_close} className="absolute inset-0 cursor-default bg-black/45" />
			<aside role="dialog" aria-modal="true" aria-label={label} style={{ width }} className="relative flex h-full max-w-full flex-col border-l border-[#33363c] bg-[#121316] shadow-[-30px_0_80px_rgba(0,0,0,.5)]">
				<header className="flex items-start gap-3 border-b border-[var(--g-line)] px-5 py-4">
					<div className="min-w-0 flex-1">
						<h2 className="text-[15px] font-semibold">{title}</h2>
						{sub ? <p className="mt-0.5 text-[12.5px] text-[var(--g-ink-3)]">{sub}</p> : null}
					</div>
					<button type="button" onClick={on_close} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-md text-[var(--g-ink-3)] hover:bg-[var(--g-soft)] hover:text-[var(--g-ink)]"><X aria-hidden className="h-4 w-4" /></button>
				</header>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
				{footer ? <footer className="flex items-center gap-2 border-t border-[var(--g-line)] px-5 py-3">{footer}</footer> : null}
			</aside>
		</div>
	);
}

// ── Add to your org (and a realm) ───────────────────────────────────────

export interface Add_team_result { org_id: string; org_slug: string; realm_id: string | null; realm_slug: string | null; daemons: number }

/**
 * Takes a team on in two steps: it joins one of your orgs' team libraries,
 * then (optionally) one of that org's realms, whose online daemons install it.
 * A team already in the org skips straight to picking a realm.
 */
export function Add_team_drawer({ team_id, label, scope, name, version, orgs, states, initial_org, on_close, on_added, on_run }: {
	team_id: string;
	label: string;
	scope: string;
	name: string;
	/** The version realms get (the latest published). */
	version: string | null;
	/** The caller's orgs with their realms (daemon counts). */
	orgs: Overview_org[];
	/** The team's place in each of the caller's orgs. */
	states: Team_org_state[];
	initial_org?: string | null;
	on_close: () => void;
	on_added: (r: Add_team_result) => void;
	on_run: (realm_id: string) => void;
}) {
	const post = use_post();
	const by_org = useMemo(() => new Map(states.map((s) => [s.org_id, s])), [states]);
	const choices = orgs.filter((o) => o.status !== 'error');
	// Start on the only org, or the only org that already has the team.
	const having = choices.filter((o) => by_org.get(o.id)?.in_library || by_org.get(o.id)?.own);
	const [org_id, set_org_id] = useState<string | null>(initial_org ?? (choices.length === 1 ? choices[0].id : having.length === 1 ? having[0].id : null));
	const org = choices.find((o) => o.id === org_id) ?? null;
	const state = org ? by_org.get(org.id) ?? null : null;
	const in_org = Boolean(state?.in_library || state?.own);
	const [realm_id, set_realm_id] = useState<string | null>(null);
	const [busy, set_busy] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const [done, set_done] = useState<Add_team_result | null>(null);
	const realm = org?.realms.find((r) => r.id === realm_id) ?? null;
	const realm_has = new Set(state?.realms.map((r) => r.realm_id) ?? []);

	async function add() {
		if (!org) return;
		set_busy(true); set_err(null);
		if (!state?.in_library) {
			const r = await post('/v1/orgs/add_team', { org_id: org.id, team_id });
			if (!r.ok) {
				set_busy(false);
				set_err(r.status === 403 ? `You can’t add teams to ${org.display_name || org.slug}. Ask an org admin or operator to add ${label}.` : r.error);
				return;
			}
		}
		if (realm) {
			const r = await post('/v1/realms/add_team', { realm_id: realm.id, scope, slug: name });
			if (!r.ok) {
				set_busy(false);
				set_err(r.status === 403
					? `${label} is in ${org.display_name || org.slug} now, but you can’t change ${realm.slug}’s team list. Ask a realm operator to add it.`
					: `${label} is in ${org.display_name || org.slug} now, but adding it to ${realm.slug} failed: ${r.error}`);
				on_added({ org_id: org.id, org_slug: org.slug, realm_id: null, realm_slug: null, daemons: 0 });
				return;
			}
		}
		set_busy(false);
		const result = { org_id: org.id, org_slug: org.slug, realm_id: realm?.id ?? null, realm_slug: realm?.slug ?? null, daemons: realm?.daemons.online ?? 0 };
		set_done(result);
		on_added(result);
	}

	if (done) {
		const org_name = org?.display_name || done.org_slug;
		return (
			<G_drawer label={`Add ${label}`} title={done.realm_slug ? `Ready in ${done.realm_slug}` : `Added to ${org_name}`} on_close={on_close}
				footer={done.realm_id
					? <><button type="button" onClick={() => on_run(done.realm_id!)} className={PRIMARY}>Run in {done.realm_slug}</button><button type="button" onClick={on_close} className={ROW_ACTION_CLS}>Done</button></>
					: <button type="button" onClick={on_close} className={PRIMARY}>Done</button>}>
				<div className="flex items-start gap-3 rounded-xl border border-[var(--g-ok)]/30 bg-[var(--g-ok-soft)] px-4 py-3.5 text-[13px]">
					<Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[var(--g-ok)]" />
					<div>
						<p><b className="g-mono">{label}</b> is in {org_name}’s teams{done.realm_slug ? <> and on {done.realm_slug}’s team list{version ? <> at <span className="g-mono">v{version}</span></> : null}</> : null}.</p>
						{done.realm_slug ? (
							<p className="mt-1 text-[var(--g-ink-2)]">{done.daemons
								? `${done.daemons} online daemon${done.daemons === 1 ? ' is' : 's are'} installing it now; it can run as soon as one finishes.`
								: 'No daemon is online there right now. Daemons install it when they next connect.'}</p>
						) : <p className="mt-1 text-[var(--g-ink-2)]">Anyone in {org_name} who manages a realm’s teams can now add it to that realm. Add it to a realm to run it.</p>}
					</div>
				</div>
				{done.realm_slug ? <p className="mt-4 text-[12.5px] text-[var(--g-ink-3)]">New versions of {label} don’t reach {done.realm_slug} on their own; this page shows when one is out.</p> : null}
			</G_drawer>
		);
	}

	const step = (n: number, on: boolean, text: string) => (
		<h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold">
			<span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${on ? 'bg-[var(--g-acc)] text-[var(--g-on-acc)]' : 'bg-[var(--g-soft)] text-[var(--g-ink-3)]'}`}>{n}</span>{text}
		</h3>
	);
	const submit = !org ? 'Add' : realm ? (in_org ? `Add to ${realm.slug}` : `Add to ${org.slug} and ${realm.slug}`) : `Add to ${org.slug}`;

	return (
		<G_drawer
			label={`Add ${label}`}
			title={<>Add <span className="g-mono">{label}</span></>}
			sub="Teams join your org first, then the realms that will run them."
			on_close={on_close}
			footer={<>
				<button type="button" disabled={!org || busy || (in_org && !realm)} onClick={() => void add()} className={PRIMARY}>{busy ? 'Adding…' : submit}</button>
				<button type="button" onClick={on_close} className={ROW_ACTION_CLS}>Cancel</button>
				{version ? <span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]">latest <span className="g-mono">v{version}</span></span> : null}
			</>}
		>
			{choices.length === 0 ? (
				<div className="rounded-xl border border-dashed border-[var(--g-line)] px-4 py-6 text-center text-[13px] text-[var(--g-ink-2)]">
					<p>You aren’t in an org yet.</p>
					<p className="mt-1 text-[12px] text-[var(--g-ink-3)]">Teams are added to an org, then to its realms.</p>
					<Link to="/getting-started" className="mt-3 inline-block text-[12.5px] text-[var(--g-acc)] hover:underline">Get set up →</Link>
				</div>
			) : (
				<>
					<section className="mb-5">
						{step(1, true, 'Org')}
						<div role="radiogroup" aria-label="Org" className="overflow-hidden rounded-xl border border-[var(--g-line)]">
							{choices.map((o) => {
								const st = by_org.get(o.id);
								const has = Boolean(st?.in_library || st?.own);
								return (
									<label key={o.id} className={`flex cursor-pointer items-center gap-3 border-b border-[var(--g-line-2)] px-3.5 py-2.5 last:border-b-0 hover:bg-[var(--g-soft)] ${org_id === o.id ? 'bg-[var(--g-acc-soft)]' : ''}`}>
										<input type="radio" name="add-org" checked={org_id === o.id} onChange={() => { set_org_id(o.id); set_realm_id(null); set_err(null); }} className="accent-[var(--g-acc)]" />
										<span className="min-w-0 flex-1 truncate text-[13px] font-medium">{o.display_name || o.slug}</span>
										<span className="text-[11.5px] text-[var(--g-ink-3)]">{st?.own ? 'its own team' : has ? `in org${st?.realms.length ? ` · ${st.realms.length} realm${st.realms.length === 1 ? '' : 's'}` : ''}` : 'not added yet'}</span>
									</label>
								);
							})}
						</div>
					</section>
					<section>
						{step(2, Boolean(org), in_org ? 'Realm' : 'Realm (optional)')}
						{!org ? <p className="text-[12.5px] text-[var(--g-ink-3)]">Pick an org first.</p> : org.realms.length === 0 ? (
							<p className="rounded-xl border border-dashed border-[var(--g-line)] px-4 py-4 text-[12.5px] text-[var(--g-ink-3)]">{org.display_name || org.slug} has no realms yet. {in_org ? '' : 'You can still add the team to the org now.'}</p>
						) : (
							<div role="radiogroup" aria-label="Realm" className="overflow-hidden rounded-xl border border-[var(--g-line)]">
								{!in_org ? (
									<label className={`flex cursor-pointer items-center gap-3 border-b border-[var(--g-line-2)] px-3.5 py-2.5 hover:bg-[var(--g-soft)] ${realm_id === null ? 'bg-[var(--g-acc-soft)]' : ''}`}>
										<input type="radio" name="add-realm" checked={realm_id === null} onChange={() => set_realm_id(null)} className="accent-[var(--g-acc)]" />
										<span className="flex-1 text-[13px] text-[var(--g-ink-2)]">Not yet — just add it to the org</span>
									</label>
								) : null}
								{org.realms.map((r) => {
									const has = realm_has.has(r.id);
									return (
										<label key={r.id} className={`flex items-center gap-3 border-b border-[var(--g-line-2)] px-3.5 py-2.5 last:border-b-0 ${has ? 'opacity-60' : 'cursor-pointer hover:bg-[var(--g-soft)]'} ${realm_id === r.id ? 'bg-[var(--g-acc-soft)]' : ''}`}>
											<input type="radio" name="add-realm" disabled={has} checked={realm_id === r.id} onChange={() => set_realm_id(r.id)} className="accent-[var(--g-acc)]" />
											<span className="min-w-0 flex-1">
												<span className="block truncate text-[13px] font-medium">{r.slug}</span>
												{r.name && r.name !== r.slug ? <span className="block truncate text-[11.5px] text-[var(--g-ink-3)]">{r.name}</span> : null}
											</span>
											{has ? <span className="text-[11.5px] text-[var(--g-ink-3)]">already added</span> : (
												<span className={`inline-flex items-center gap-1 text-[11.5px] ${r.daemons.online ? 'text-[var(--g-ink-2)]' : 'text-[var(--g-warn-text)]'}`}>
													<Server aria-hidden className="h-3 w-3" />{r.daemons.online ? `${r.daemons.online} online` : 'no daemons online'}
												</span>
											)}
										</label>
									);
								})}
							</div>
						)}
					</section>
				</>
			)}
			{err ? <p role="alert" className="mt-3 text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
		</G_drawer>
	);
}

// ── Fork ─────────────────────────────────────────────────────────────────

export interface Fork_result { id: string; scope: string; name: string }

/**
 * Fork one version of a team into a scope you own. The copy is a new private
 * draft; nothing about the original changes.
 */
export function Fork_dialog({ team_id, label, name, version, versions, on_close, on_forked }: {
	team_id: string;
	label: string;
	name: string;
	/** The version being viewed (the default to fork from). */
	version: string | null;
	versions: Team_release[];
	on_close: () => void;
	on_forked: (r: Fork_result, open_builder: boolean) => void;
}) {
	const { user, scopes } = useAuth();
	const post = use_post();
	use_escape(on_close);
	// Org scopes first: forking "to your org" is the common case.
	const options = useMemo(() => {
		const list = [...(scopes ?? [])].sort((a, b) => (a.scope_type === b.scope_type ? a.slug.localeCompare(b.slug) : a.scope_type === 'org' ? -1 : 1));
		if (!list.length && user?.username) return [{ slug: user.username, display_name: user.username, scope_type: 'user' as const }];
		return list.map((s) => ({ slug: s.slug, display_name: s.display_name || s.slug, scope_type: s.scope_type }));
	}, [scopes, user]);
	const [scope, set_scope] = useState(options[0]?.slug ?? '');
	const [new_name, set_new_name] = useState(name);
	const [from, set_from] = useState(version ?? versions[0]?.version ?? '');
	const [busy, set_busy] = useState<null | 'fork' | 'open'>(null);
	const [err, set_err] = useState<{ field: 'name' | 'scope' | null; text: string } | null>(null);
	const name_ok = NAME_RE.test(new_name);
	const target = scope ? `@${scope}/${new_name || '…'}` : new_name;
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => { ref.current?.select(); }, []);

	async function fork(open: boolean) {
		if (!scope || !name_ok) return;
		set_busy(open ? 'open' : 'fork'); set_err(null);
		const res = await post('/v1/teams/create', { name: new_name, scope, forked_from: { team_id, ...(from ? { version: from } : {}) } });
		set_busy(null);
		if (!res.ok) {
			if (res.status === 409) set_err({ field: 'name', text: `${target} already exists. Pick another name.` });
			else if (res.status === 403) set_err({ field: 'scope', text: `You can’t create teams in @${scope}.` });
			else set_err({ field: null, text: res.error });
			return;
		}
		on_forked({ id: String(res.data.id ?? ''), scope, name: new_name }, open);
	}

	return (
		<div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
			<div role="dialog" aria-modal="true" aria-label={`Fork ${label}`} className="w-[520px] max-w-full overflow-hidden rounded-2xl border border-[#33363c] bg-[#121316] shadow-[0_30px_90px_rgba(0,0,0,.6)]">
				<header className="flex items-center gap-3 border-b border-[var(--g-line)] px-5 py-4">
					<span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--g-acc-soft)] text-[var(--g-acc)]"><GitFork aria-hidden className="h-4 w-4" /></span>
					<div className="min-w-0 flex-1">
						<h2 className="text-[15px] font-semibold">Fork <span className="g-mono">{label}</span></h2>
						<p className="text-[12.5px] text-[var(--g-ink-3)]">Make your own copy to change. The original stays as it is.</p>
					</div>
					<button type="button" onClick={on_close} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-md text-[var(--g-ink-3)] hover:bg-[var(--g-soft)]"><X aria-hidden className="h-4 w-4" /></button>
				</header>
				<div className="grid gap-4 px-5 py-4">
					<div className="grid grid-cols-[1fr_1.2fr] gap-3">
						<label>
							<span className={LABEL}>Into</span>
							<select aria-label="Scope" value={scope} onChange={(e) => { set_scope(e.target.value); set_err(null); }} className={INPUT}>
								{options.map((o) => <option key={o.slug} value={o.slug}>@{o.slug}{o.scope_type === 'org' ? ' · org' : ' · you'}</option>)}
							</select>
						</label>
						<label>
							<span className={LABEL}>Name</span>
							<input ref={ref} aria-label="Name" aria-invalid={!name_ok || err?.field === 'name'} value={new_name} onChange={(e) => { set_new_name(e.target.value.trim()); set_err(null); }} className={`${INPUT} g-mono ${!name_ok || err?.field === 'name' ? 'border-[var(--g-bad)]' : ''}`} />
						</label>
					</div>
					{!name_ok ? <p className="-mt-2 text-[12px] text-[var(--g-bad)]">Lowercase letters, digits and hyphens, starting with a letter.</p> : null}
					{versions.length > 1 ? (
						<label>
							<span className={LABEL}>From version</span>
							<select aria-label="From version" value={from} onChange={(e) => set_from(e.target.value)} className={INPUT}>
								{versions.map((v) => <option key={v.version} value={v.version}>v{v.version}{v.is_latest ? ' · latest' : ''}</option>)}
							</select>
						</label>
					) : null}
					<ul className="space-y-2 rounded-xl border border-[var(--g-line)] bg-[#0f1012] px-4 py-3 text-[12.5px] text-[var(--g-ink-2)]" aria-label="What forking does">
						<li className="flex gap-2"><Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--g-ok)]" /><span><b className="g-mono text-[var(--g-ink)]">{target}</b> is a new private draft{scope ? <> in @{scope}</> : null}, starting at <span className="g-mono">v0.1.0</span> with the workflow, roles and inputs of {from ? <span className="g-mono">v{from}</span> : 'the latest version'}.</span></li>
						<li className="flex gap-2"><Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--g-ok)]" /><span>Your edits save to the fork only. <span className="g-mono">{label}</span>, its versions and every realm running it are unchanged.</span></li>
						<li className="flex gap-2"><Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--g-ok)]" /><span>The fork links back to the original, and tells you when a newer version of it comes out.</span></li>
					</ul>
					{err && err.field !== null ? <p role="alert" className="-mt-1 text-[12.5px] text-[var(--g-bad)]">{err.text}</p> : null}
					{err && err.field === null ? <p role="alert" className="-mt-1 text-[12.5px] text-[var(--g-bad)]">{err.text}</p> : null}
				</div>
				<footer className="flex items-center gap-2 border-t border-[var(--g-line)] px-5 py-3">
					<button type="button" disabled={!scope || !name_ok || busy !== null} onClick={() => void fork(true)} className={PRIMARY}>{busy === 'open' ? 'Forking…' : 'Fork and edit'}</button>
					<button type="button" disabled={!scope || !name_ok || busy !== null} onClick={() => void fork(false)} className={ROW_ACTION_CLS}>{busy === 'fork' ? 'Forking…' : 'Fork only'}</button>
					<button type="button" onClick={on_close} className="ml-auto text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">Cancel</button>
				</footer>
			</div>
		</div>
	);
}

// ── Lineage ──────────────────────────────────────────────────────────────

/** Semver a > b (numeric parts only). */
export function newer(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) return false;
	const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
	const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
	for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0); }
	return false;
}

/** "Forked from @x/y v1.4.2" — and, when the original has moved on, its newer version. */
export function Lineage_strip({ origin }: { origin: Team_fork_origin }) {
	const known = origin.name !== null;
	const label = known ? `${origin.scope ? `@${origin.scope}/` : ''}${origin.name}` : 'a team you can no longer see';
	const ahead = known && newer(origin.latest_version, origin.version);
	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--g-line)] bg-[var(--g-panel)] px-3.5 py-2 text-[12.5px] text-[var(--g-ink-2)]" data-testid="lineage">
			<GitFork aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
			<span>Forked from {known ? <Link to={team_href(origin.scope ?? '', origin.name!)} className="g-mono text-[var(--g-acc)] hover:underline">{label}</Link> : <span className="text-[var(--g-ink-3)]">{label}</span>}{origin.version ? <> at <span className="g-mono">v{origin.version}</span></> : null}</span>
			{ahead ? (
				<span className="ml-auto inline-flex items-center gap-2">
					<span className="rounded bg-[var(--g-warn-soft)] px-1.5 py-px text-[11.5px] text-[var(--g-warn-text)]">v{origin.latest_version} is out</span>
					<Link to={`${team_href(origin.scope ?? '', origin.name!)}?tab=versions&from=${encodeURIComponent(origin.version!)}&to=${encodeURIComponent(origin.latest_version!)}`} className="text-[12px] text-[var(--g-acc)] hover:underline">See what changed →</Link>
				</span>
			) : null}
		</div>
	);
}
