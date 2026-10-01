/**
 * Realms (Graphite) — /realms[?org=slug&q=&new=1]
 * List: from the overview read already on every Graphite page (realms per org
 * with daemon health, live runs and what needs you) — no extra read.
 * New realm (owners/admins): 3 steps, each action one Core call —
 *   1 realms/create · 2 realms/add_team|remove_team, realms/add_member, invitations/create ·
 *   3 auth/generate_token {type:'realm'} (shown once).
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview, relative_time, type Overview_org, type Overview_realm } from '@/lib/overview';
import { realm_path } from '@/lib/realm_url';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Banner, Chips, Pill } from '@/components/graphite/g_admin';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { Secret_reveal } from '@/components/graphite/g_secret';

export function slugify(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}
const can_create = (o: Overview_org) => o.role === 'owner' || o.role === 'admin';

function Health({ r }: { r: Overview_realm }) {
	const d = r.daemons;
	if (!d.total) return <Pill tone="warn">no daemons</Pill>;
	return (
		<span className="inline-flex items-center gap-2 text-[12px] text-[var(--g-ink-2)]" title={`${d.online} online · ${d.stale} stale · ${d.offline} offline`}>
			<span aria-hidden className="flex h-1.5 w-[64px] overflow-hidden rounded-full bg-[var(--g-soft)]">
				<span style={{ width: `${(d.online / d.total) * 100}%` }} className="bg-[var(--g-ok)]" />
				<span style={{ width: `${(d.stale / d.total) * 100}%` }} className="bg-[var(--g-warn)]" />
			</span>
			<span className="g-mono">{d.online}/{d.total}</span> online
		</span>
	);
}

function Realm_card({ r }: { r: Overview_realm }) {
	const base = realm_path(r.org_slug, r.slug);
	return (
		<Link to={`${base}/inbox`} className="flex flex-col gap-2.5 rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)] p-4 hover:border-[var(--g-acc-line)]" data-testid={`realm-${r.slug}`}>
			<div className="flex items-baseline gap-2"><b className="truncate text-[14px] font-semibold">{r.name || r.slug}</b><span className="g-mono truncate text-[11.5px] text-[var(--g-ink-3)]">{r.slug}</span></div>
			<Health r={r} />
			<div className="flex flex-wrap gap-1.5 text-[11.5px]">
				{r.needs_you ? <Pill tone="warn">{r.needs_you} need you</Pill> : null}
				{r.active_runs ? <Pill tone="run">{r.active_runs} running</Pill> : null}
				{!r.needs_you && !r.active_runs ? <span className="text-[var(--g-ink-3)]">{r.last_activity_at ? `Active ${relative_time(r.last_activity_at)}` : 'No runs yet'}</span> : null}
			</div>
		</Link>
	);
}

type Created = { id: string; slug: string; name: string; org_slug: string };
type Team_opt = { scope: string; slug: string; label: string };

function New_realm({ orgs, initial_org, on_close }: { orgs: Overview_org[]; initial_org: string | null; on_close: () => void }) {
	const post = use_post();
	const auth_fetch = useAuthFetch();
	const navigate = useNavigate();
	const overview = use_overview();
	const [step, set_step] = useState<1 | 2 | 3>(1);
	const [org_id, set_org_id] = useState(orgs.find((o) => o.slug === initial_org)?.id ?? orgs[0]?.id ?? '');
	const [name, set_name] = useState('');
	const [slug, set_slug] = useState('');
	const [slug_touched, set_slug_touched] = useState(false);
	const [realm, set_realm] = useState<Created | null>(null);
	const [err, set_err] = useState<string | null>(null);
	const [busy, set_busy] = useState(false);
	// step 2
	const [teams, set_teams] = useState<Team_opt[] | null>(null);
	const [team_q, set_team_q] = useState('');
	const [added, set_added] = useState<Set<string>>(new Set());
	const [who, set_who] = useState('');
	const [role, set_role] = useState<'admin' | 'operator' | 'member'>('operator');
	const [people, set_people] = useState<string[]>([]);
	const [found, set_found] = useState<Array<{ id: string; username: string; display_name?: string }>>([]);
	// step 3
	const [token, set_token] = useState<string | null>(null);
	const org = orgs.find((o) => o.id === org_id);
	const eff_slug = slug_touched ? slug : slugify(name);

	async function create(e: FormEvent) {
		e.preventDefault();
		if (!org) return;
		set_busy(true); set_err(null);
		const r = await post('/v1/realms/create', { org_id, slug: eff_slug, name: name.trim() });
		set_busy(false);
		if (!r.ok) { set_err(r.error); return; }
		const d = r.data as { realm?: Created } & Partial<Created>;
		const rr = d.realm ?? (d as Created);
		set_realm({ id: rr.id, slug: rr.slug ?? eff_slug, name: rr.name ?? name.trim(), org_slug: rr.org_slug ?? org.slug });
		set_step(2);
		void overview.reload?.();
	}

	useEffect(() => {
		if (step !== 2 || teams) return;
		void (async () => {
			try {
				const res = await auth_fetch('/v1/teams/get', { method: 'POST', body: JSON.stringify({}) });
				const j = await res.json().catch(() => null);
				const raw = ((j?.data ?? j)?.teams ?? []) as Array<{ scope?: string | null; name?: string; slug?: string }>;
				const seen = new Set<string>();
				const out: Team_opt[] = [];
				for (const t of raw) {
					const s = (t.scope ?? '').trim(); const n = (t.name ?? t.slug ?? '').trim();
					if (!s || !n || seen.has(`${s}/${n}`)) continue;
					seen.add(`${s}/${n}`); out.push({ scope: s, slug: n, label: `@${s}/${n}` });
				}
				set_teams(out.sort((a, b) => a.label.localeCompare(b.label)));
			} catch { set_teams([]); }
		})();
	}, [step, teams, auth_fetch]);

	useEffect(() => {
		const q = who.trim().replace(/^@+/, '');
		if (!realm || q.length < 2 || q.includes('@')) { set_found([]); return; }
		const t = setTimeout(async () => {
			try {
				const res = await auth_fetch('/v1/users/get', { method: 'POST', body: JSON.stringify({ realm_id: realm.id, query: q }) });
				const j = await res.json().catch(() => null);
				set_found(j?.ok ? (j.data?.users ?? j.users ?? []).map((u: { id: string | number; username: string; display_name?: string }) => ({ ...u, id: String(u.id) })) : []);
			} catch { set_found([]); }
		}, 250);
		return () => clearTimeout(t);
	}, [who, realm, auth_fetch]);

	async function toggle_team(t: Team_opt) {
		if (!realm) return;
		const on = added.has(t.label);
		set_err(null);
		const r = await post(on ? '/v1/realms/remove_team' : '/v1/realms/add_team', { realm_id: realm.id, scope: t.scope, slug: t.slug });
		if (!r.ok) { set_err(r.error); return; }
		set_added((s) => { const n = new Set(s); if (on) n.delete(t.label); else n.add(t.label); return n; });
	}
	async function add_person(u?: { id: string; username: string }) {
		if (!realm) return;
		set_err(null); set_busy(true);
		const email = who.trim();
		const r = u
			? await post('/v1/realms/add_member', { realm_id: realm.id, member_type: 'user', member_id: u.id, role })
			: await post('/v1/invitations/create', { target_type: 'realm', realm_id: realm.id, email, role });
		set_busy(false);
		if (!r.ok) { set_err(r.error); return; }
		set_people((p) => [...p, `${u ? `@${u.username}` : `${email} (invited)`} · ${role}`]);
		set_who(''); set_found([]);
	}
	async function mint() {
		if (!realm) return;
		set_busy(true); set_err(null);
		const r = await post('/v1/auth/generate_token', { type: 'realm', realm_ids: [realm.id], name: `${realm.slug}-enroll` });
		set_busy(false);
		if (!r.ok) { set_err(r.error); return; }
		set_token(String((r.data as { token?: string }).token ?? ''));
	}
	const finish = () => { if (realm) navigate(`${realm_path(realm.org_slug, realm.slug)}/inbox`); };
	const shown_teams = (teams ?? []).filter((t) => !team_q || t.label.includes(team_q.toLowerCase()));
	const is_email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(who.trim());

	return (
		<section aria-label="New realm" className="flex flex-col gap-4 rounded-[12px] border border-[var(--g-acc-line)] bg-[var(--g-panel)] p-5">
			<ol className="flex gap-2 text-[12px]" aria-label="Steps">
				{['Name it', 'Teams & people', 'Connect a machine'].map((l, i) => (
					<li key={l} aria-current={step === i + 1 ? 'step' : undefined} className={`rounded-full px-3 py-1 ${step === i + 1 ? 'bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : step > i + 1 ? 'text-[var(--g-ok)]' : 'text-[var(--g-ink-3)]'}`}>{step > i + 1 ? '✓ ' : `${i + 1}. `}{l}</li>
				))}
			</ol>
			{err ? <Banner tone="bad">{err}</Banner> : null}
			{step === 1 ? (
				<form onSubmit={(e) => void create(e)} className="flex flex-col gap-3" aria-label="Name it">
					<p className="text-[12.5px] text-[var(--g-ink-3)]">A realm is a group of machines (daemons) that run your teams, with its own members, inbox and settings — e.g. <span className="g-mono">prod-us</span> or <span className="g-mono">sapan-laptop</span>.</p>
					<div className="flex flex-wrap items-end gap-3">
						{orgs.length > 1 ? <label className="text-[12.5px] text-[var(--g-ink-2)]">Organization<select aria-label="Organization" value={org_id} onChange={(e) => set_org_id(e.target.value)} className={`${G_INPUT} mt-1 block w-[200px]`}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.display_name || o.slug}</option>)}</select></label> : null}
						<label className="text-[12.5px] text-[var(--g-ink-2)]">Name<input aria-label="Realm name" autoFocus value={name} onChange={(e) => set_name(e.target.value)} placeholder="Production US" className={`${G_INPUT} mt-1 block w-[220px]`} /></label>
						<label className="text-[12.5px] text-[var(--g-ink-2)]">Slug<input aria-label="Realm slug" value={eff_slug} onChange={(e) => { set_slug_touched(true); set_slug(slugify(e.target.value)); }} className={`${G_INPUT} g-mono mt-1 block w-[180px]`} /></label>
					</div>
					{org ? <p className="g-mono text-[11.5px] text-[var(--g-ink-3)]">{`/o/${org.slug}/realms/${eff_slug || '…'}`}</p> : null}
					<div className="flex gap-2"><button type="submit" disabled={busy || !name.trim() || !eff_slug || !org} className={G_PRIMARY}>Create realm</button><button type="button" onClick={on_close} className={G_BTN}>Cancel</button></div>
				</form>
			) : null}
			{step === 2 && realm ? (
				<div className="flex flex-col gap-4">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="flex flex-col gap-2" role="group" aria-label="Teams">
							<b className="text-[13px]">Teams this realm runs</b>
							<input aria-label="Filter teams" value={team_q} onChange={(e) => set_team_q(e.target.value)} placeholder="Filter…" className={`${G_INPUT} w-full`} />
							<ul className="max-h-[220px] overflow-y-auto rounded-md border border-[var(--g-line)]">
								{teams === null ? <li className="px-3 py-2 text-[12.5px] text-[var(--g-ink-3)]">Loading…</li> : !shown_teams.length ? <li className="px-3 py-2 text-[12.5px] text-[var(--g-ink-3)]">No teams.</li> : null}
								{shown_teams.map((t) => (
									<li key={t.label}><label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] hover:bg-[var(--g-soft)]"><input type="checkbox" checked={added.has(t.label)} onChange={() => void toggle_team(t)} /><span className="g-mono">{t.label}</span></label></li>
								))}
							</ul>
						</div>
						<div className="flex flex-col gap-2" role="group" aria-label="People">
							<b className="text-[13px]">People</b>
							<div className="relative flex gap-2">
								<input aria-label="Person" value={who} onChange={(e) => set_who(e.target.value)} placeholder="Username or email" className={`${G_INPUT} min-w-0 flex-1`} />
								<select aria-label="Role" value={role} onChange={(e) => set_role(e.target.value as typeof role)} className={`${G_INPUT} w-[110px]`}><option value="admin">Admin</option><option value="operator">Operator</option><option value="member">Member</option></select>
								{is_email ? <button type="button" disabled={busy} onClick={() => void add_person()} className={G_PRIMARY}>Invite</button> : null}
								{found.length ? (
									<ul role="listbox" aria-label="Matches" className="absolute left-0 right-0 top-10 z-40 rounded-lg border border-[#33363c] bg-[#16171a] py-1">
										{found.map((u) => <li key={u.id} role="option" aria-selected={false} onMouseDown={(e) => { e.preventDefault(); void add_person(u); }} className="cursor-pointer px-3 py-1.5 text-[12.5px] hover:bg-[var(--g-soft)]">{u.display_name || u.username} <span className="text-[var(--g-ink-3)]">@{u.username}</span></li>)}
									</ul>
								) : null}
							</div>
							<p className="text-[11.5px] text-[var(--g-ink-3)]">You’re already an admin. Operators run teams and answer reviews; members view.</p>
							<ul className="flex flex-col gap-1 text-[12.5px]">{people.map((p) => <li key={p} className="text-[var(--g-ink-2)]">✓ {p}</li>)}</ul>
						</div>
					</div>
					<div className="flex gap-2"><button type="button" onClick={() => set_step(3)} className={G_PRIMARY}>Next</button><button type="button" onClick={() => set_step(3)} className={G_BTN}>Skip</button></div>
				</div>
			) : null}
			{step === 3 && realm ? (
				<div className="flex flex-col gap-3">
					<p className="max-w-[680px] text-[12.5px] text-[var(--g-ink-2)]">On your own machine: <code className="g-mono rounded bg-[var(--g-soft)] px-1.5 py-0.5">cliq login</code> then <code className="g-mono rounded bg-[var(--g-soft)] px-1.5 py-0.5">cliqd --realm {realm.slug}</code>. For a server or CI box, create an enrollment token instead.</p>
					{token ? <Secret_reveal title={`${realm.slug}-enroll`} secret={token} env_name="CLIQ_REALM_TOKEN" note={`Then run: cliqd --realm ${realm.slug}`} on_done={finish} /> : (
						<div className="flex gap-2"><button type="button" disabled={busy} onClick={() => void mint()} className={G_BTN}>Create enrollment token</button><button type="button" onClick={finish} className={G_PRIMARY}>Open {realm.name || realm.slug} →</button></div>
					)}
				</div>
			) : null}
		</section>
	);
}

export function Component() {
	const overview = use_overview();
	const [sp, set_sp] = useSearchParams();
	const orgs = overview.data?.orgs ?? [];
	const org_filter = sp.get('org');
	const q = (sp.get('q') ?? '').toLowerCase();
	const creating = sp.get('new') === '1';
	const joined = sp.get('joined');
	const joined_realm = joined ? orgs.flatMap((o) => o.realms).find((r) => r.slug === joined) ?? null : null;
	const creatable = orgs.filter(can_create);
	const set = (k: string, v: string | null) => set_sp((prev) => { const p = new URLSearchParams(prev); if (v) p.set(k, v); else p.delete(k); return p; }, { replace: true });
	const groups = useMemo(() => orgs
		.filter((o) => !org_filter || o.slug === org_filter)
		.map((o) => ({ org: o, realms: o.realms.filter((r) => !q || `${r.slug} ${r.name}`.toLowerCase().includes(q)) }))
		.filter((g) => g.realms.length || !q), [orgs, org_filter, q]);
	const total = orgs.reduce((n, o) => n + o.realms.length, 0);
	return (
		<Graphite_shell data={overview.data} title="Realms">
			<div className="flex flex-col gap-4 px-7 py-6">
				<header className="flex flex-wrap items-center gap-3">
					<div><h1 className="text-[22px] font-semibold tracking-tight">Realms</h1><p className="mt-1 text-[13px] text-[var(--g-ink-3)]">Groups of machines that run your teams. {total} realm{total === 1 ? '' : 's'} across {orgs.length} organization{orgs.length === 1 ? '' : 's'}.</p></div>
					{creatable.length && !creating ? <button type="button" onClick={() => set('new', '1')} className={`${G_PRIMARY} ml-auto`}><Plus className="h-3.5 w-3.5" /> New realm</button> : null}
				</header>
				{joined_realm ? <Banner tone="ok">You joined {joined_realm.name || joined_realm.slug}. <Link to={`${realm_path(joined_realm.org_slug, joined_realm.slug)}/inbox`} className="font-semibold underline">Open it →</Link></Banner> : null}
				{creating && creatable.length ? <New_realm orgs={creatable} initial_org={org_filter} on_close={() => set('new', null)} /> : null}
				<div className="flex flex-wrap items-center gap-2">
					{orgs.length > 1 ? <Chips value={org_filter ?? 'all'} on_change={(v) => set('org', v === 'all' ? null : v)} options={[{ key: 'all', label: 'All', count: total }, ...orgs.map((o) => ({ key: o.slug, label: o.display_name || o.slug, count: o.realms.length }))]} /> : null}
					<label className="relative ml-auto"><Search aria-hidden className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--g-ink-3)]" /><input aria-label="Search realms" value={sp.get('q') ?? ''} onChange={(e) => set('q', e.target.value || null)} placeholder="Search realms" className={`${G_INPUT} w-[220px] pl-8`} /></label>
				</div>
				{!overview.data ? <div className="h-[240px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading realms" /> : null}
				{groups.map(({ org, realms }) => (
					<section key={org.id} aria-label={org.display_name || org.slug} className="flex flex-col gap-2">
						<div className="flex items-center gap-2"><h2 className="text-[13px] font-semibold text-[var(--g-ink-2)]">{org.display_name || org.slug}</h2><span className="text-[11.5px] text-[var(--g-ink-3)]">{org.role}</span>{can_create(org) ? <Link to={`/orgs/${org.id}`} className="ml-auto text-[12px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">Manage org →</Link> : null}</div>
						{org.status === 'error' ? <Banner tone="bad">{org.error ?? 'Could not load this organization’s realms.'}</Banner> : null}
						{realms.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{realms.map((r) => <Realm_card key={r.id} r={r} />)}</div> : (
							<p className="rounded-[10px] border border-dashed border-[var(--g-line)] px-4 py-6 text-center text-[12.5px] text-[var(--g-ink-3)]">No realms yet.{can_create(org) ? <> <button type="button" onClick={() => { set('org', org.slug); set('new', '1'); }} className="text-[var(--g-acc)] hover:underline">Create one</button></> : ' Ask an owner or admin to add you to one.'}</p>
						)}
					</section>
				))}
				{overview.data && q && !groups.length ? <p className="text-[13px] text-[var(--g-ink-3)]">No realms match “{sp.get('q')}”.</p> : null}
			</div>
		</Graphite_shell>
	);
}
