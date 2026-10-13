/**
 * Realms › New realm (Graphite) — /realms/new[?org=slug] — its own screen, because a realm is a
 * major resource. Four steps — Details (name, slug, description) · People (search the org, or an
 * email; at least one operator) · Enrollment (token name) · Review — and nothing is saved until
 * Create realm: one `realms/create` (Core) saves the realm, its people, its invites, hello-world and
 * the enrollment token together, or none of it. Then the realm's page opens with the token shown
 * once (passed in navigation state, never in the URL). Reads: `users/get { org_id, query }`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Check, X } from 'lucide-react';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { realm_path } from '@/lib/realm_url';
import { use_view_scope } from '@/lib/view_scope';
import { Graphite_shell } from '@/components/graphite/graphite_shell';
import { Banner } from '@/components/graphite/g_admin';
import { G_BTN, G_INPUT, G_PRIMARY, use_post } from '@/components/graphite/g_agents';
import { slugify } from '@/pages/realms/realms_page';

type Role = 'admin' | 'operator' | 'member';
/** Someone on the list: a person in the org (`user_id`) or an email to invite. */
export interface Planned_person { key: string; label: string; user_id: string | null; email: string | null; role: Role }
/** What the realm page shows once, right after a create. */
export interface Realm_created_state {
	created: {
		name: string;
		token: string | null;
		token_name: string | null;
		qualified_slug: string;
		invites: Array<{ email: string; email_sent: boolean; invite_url: string | null }>;
		members_added: number;
	};
}

const STEPS = ['Details', 'People', 'Enrollment', 'Review'] as const;
const LABEL = 'mb-1 block text-[12.5px] text-[var(--g-ink-2)]';
const TH = 'border-b border-[var(--g-line)] bg-[var(--g-soft)] px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]';
const TD = 'border-b border-[var(--g-line-2)] px-3 py-2 text-[12.5px]';

export function Component() {
	const overview = use_overview();
	const scope = use_view_scope(overview.data);
	const org = scope.org;
	const { user } = useAuth();
	const auth_fetch = useAuthFetch();
	const post = use_post();
	const navigate = useNavigate();

	const [step, set_step] = useState(0);
	const [name, set_name] = useState('');
	const [slug, set_slug] = useState('');
	const [slug_touched, set_slug_touched] = useState(false);
	const [description, set_description] = useState('');
	const [people, set_people] = useState<Planned_person[]>([]);
	const [q, set_q] = useState('');
	const [role, set_role] = useState<Role>('operator');
	const [found, set_found] = useState<Array<{ id: string; username: string | null; display_name: string; email: string }>>([]);
	const [token_name, set_token_name] = useState('');
	const [token_touched, set_token_touched] = useState(false);
	const [err, set_err] = useState<string | null>(null);
	const [busy, set_busy] = useState(false);

	const eff_slug = slug_touched ? slug : slugify(name);
	const eff_token = token_touched ? token_name : (eff_slug ? `${eff_slug}-enroll` : '');
	const back_to = org ? `/realms?org=${encodeURIComponent(org.slug)}` : '/realms';
	const has_operator = people.some((p) => p.role === 'operator');
	const me = user?.id ?? null;

	// People search: members of the org (users/get { org_id, query }); an email is offered as an invite.
	useEffect(() => {
		const term = q.trim();
		if (!org || term.length < 2 || term.includes('@')) { set_found([]); return; }
		const t = setTimeout(async () => {
			try {
				const res = await auth_fetch('/v1/users/get', { method: 'POST', body: JSON.stringify({ org_id: org.id, query: term }) });
				const j = await res.json().catch(() => null);
				set_found(j?.ok ? (j.data?.users ?? []) : []);
			} catch { set_found([]); }
		}, 250);
		return () => clearTimeout(t);
	}, [q, org, auth_fetch]);
	const picks = useMemo(() => found.filter((u) => u.id !== me && !people.some((p) => p.user_id === u.id)).slice(0, 8), [found, people, me]);
	const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.trim()) ? q.trim().toLowerCase() : null;

	function add(p: Omit<Planned_person, 'role' | 'key'>) {
		set_people((prev) => [...prev, { ...p, key: p.user_id ?? `email:${p.email}`, role }]);
		set_q(''); set_found([]); set_err(null);
	}

	/** Each step's check before Next. */
	function check(i: number): string | null {
		if (i === 0) {
			if (!name.trim()) return 'Give the realm a name.';
			if (!eff_slug) return 'The slug needs letters or numbers.';
		}
		if (i === 1 && !has_operator) return 'Add at least one operator — someone who can run teams.';
		if (i === 2 && !eff_token.trim()) return 'Give the enrollment token a name.';
		return null;
	}
	function next() {
		const e = check(step);
		if (e) { set_err(e); return; }
		set_err(null);
		if (step < STEPS.length - 1) set_step(step + 1); else void create();
	}

	async function create() {
		if (!org) return;
		for (let i = 0; i < 3; i++) { const e = check(i); if (e) { set_step(i); set_err(e); return; } }
		set_busy(true); set_err(null);
		const r = await post('/v1/realms/create', {
			org_id: org.id, slug: eff_slug, name: name.trim(),
			...(description.trim() ? { description: description.trim() } : {}),
			members: people.filter((p) => p.user_id).map((p) => ({ user_id: p.user_id, role: p.role })),
			invites: people.filter((p) => p.email).map((p) => ({ email: p.email, role: p.role })),
			enroll_token: { name: eff_token.trim() },
		});
		set_busy(false);
		if (!r.ok) {
			// Nothing was saved; send them to the step the problem is about.
			const m = r.error;
			set_step(/slug|name/i.test(m) ? 0 : /member|invite|role|email/i.test(m) ? 1 : /token/i.test(m) ? 2 : step);
			set_err(m);
			return;
		}
		const realm = (r.data as { realm?: Record<string, unknown> }).realm ?? (r.data as Record<string, unknown>);
		const out = realm as {
			slug: string; name: string; org_slug: string | null; qualified_slug: string | null;
			enroll_token?: { token: string; name: string } | null;
			invites?: Array<{ email: string; email_sent: boolean; invite_url: string | null }>;
			members_added?: unknown[];
		};
		const state: Realm_created_state = {
			created: {
				name: out.name, token: out.enroll_token?.token ?? null, token_name: out.enroll_token?.name ?? null,
				qualified_slug: out.qualified_slug ?? `${org.slug}.${out.slug}`,
				invites: out.invites ?? [], members_added: out.members_added?.length ?? 0,
			},
		};
		navigate(`${realm_path(out.org_slug ?? org.slug, out.slug)}/inbox`, { replace: true, state });
	}

	const step_body = [
		// Details
		<div key="d" className="flex max-w-[560px] flex-col gap-3">
			<label><span className={LABEL}>Name</span><input aria-label="Realm name" autoFocus value={name} onChange={(e) => { set_name(e.target.value); set_err(null); }} placeholder="Production US" className={`${G_INPUT} w-full`} /></label>
			<label><span className={LABEL}>Slug <span className="text-[var(--g-ink-3)]">· used in URLs and the CLI; it can’t change later</span></span>
				<span className="flex items-center gap-1.5"><span className="g-mono text-[12.5px] text-[var(--g-ink-3)]">{org?.slug ?? ''}.</span><input aria-label="Realm slug" value={eff_slug} onChange={(e) => { set_slug_touched(true); set_slug(slugify(e.target.value)); set_err(null); }} className={`${G_INPUT} g-mono flex-1`} /></span>
			</label>
			<label><span className={LABEL}>Description</span><textarea aria-label="Realm description" value={description} onChange={(e) => set_description(e.target.value)} maxLength={500} rows={3} placeholder="What this realm is for, e.g. production delivery for the US team" className={`${G_INPUT} h-auto w-full py-2`} /></label>
		</div>,
		// People
		<div key="p" className="flex flex-col gap-3">
			<p className="text-[12.5px] text-[var(--g-ink-3)]">Who can use this realm. Invites go out only when the realm is created. Add at least one <b className="text-[var(--g-ink)]">operator</b> — someone who can run teams.</p>
			<div className="relative flex gap-2">
				<input aria-label="Find a person" value={q} onChange={(e) => set_q(e.target.value)} placeholder={`Search people in ${org?.display_name || org?.slug || 'the org'}, or type an email`} className={`${G_INPUT} min-w-0 flex-1`} />
				<select aria-label="Role for the next person" value={role} onChange={(e) => set_role(e.target.value as Role)} className={`${G_INPUT} w-[120px]`}><option value="operator">Operator</option><option value="member">Member</option><option value="admin">Admin</option></select>
				{picks.length || (email && !people.some((p) => p.email === email)) ? (
					<ul role="listbox" aria-label="Matches" className="absolute left-0 right-[128px] top-10 z-40 overflow-hidden rounded-lg border border-[var(--g-line-strong)] bg-[var(--g-pop)] py-1 shadow-[var(--g-pop-shadow)]">
						{picks.map((u) => (
							<li key={u.id}><button type="button" role="option" aria-selected={false} onClick={() => add({ label: u.display_name || u.username || u.email, user_id: u.id, email: null })} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--g-soft)]">
								{u.display_name || u.username}{u.username ? <span className="text-[var(--g-ink-3)]">@{u.username}</span> : null}<span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]">in the org</span>
							</button></li>
						))}
						{email && !picks.length && !people.some((p) => p.email === email) ? (
							<li><button type="button" role="option" aria-selected={false} onClick={() => add({ label: email, user_id: null, email })} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--g-soft)]">Invite {email}<span className="ml-auto text-[11.5px] text-[var(--g-ink-3)]">email invite</span></button></li>
						) : null}
					</ul>
				) : null}
			</div>
			<table className="w-full overflow-hidden rounded-[10px] border border-[var(--g-line)]" data-testid="people">
				<thead><tr><th className={TH}>Person</th><th className={`${TH} w-[140px]`}>Role</th><th className={`${TH} w-[140px]`}>When created</th><th className={`${TH} w-[44px]`} /></tr></thead>
				<tbody>
					<tr><td className={TD}>{user?.display_name || user?.username} <span className="text-[var(--g-ink-3)]">· you</span></td><td className={TD}>admin</td><td className={`${TD} text-[var(--g-ink-3)]`}>owner</td><td className={TD} /></tr>
					{people.map((p, i) => (
						<tr key={p.key} data-testid={`person-${p.key}`}>
							<td className={TD}>{p.label}</td>
							<td className={TD}><select aria-label={`Role for ${p.label}`} value={p.role} onChange={(e) => { const r = e.target.value as Role; set_people((prev) => prev.map((x, j) => (j === i ? { ...x, role: r } : x))); set_err(null); }} className={`${G_INPUT} h-7 w-full`}><option value="operator">Operator</option><option value="member">Member</option><option value="admin">Admin</option></select></td>
							<td className={`${TD} text-[var(--g-ink-3)]`}>{p.email ? 'email invite' : 'added'}</td>
							<td className={TD}><button type="button" aria-label={`Remove ${p.label}`} onClick={() => set_people((prev) => prev.filter((_, j) => j !== i))} className="text-[var(--g-ink-3)] hover:text-[var(--g-bad)]"><X aria-hidden className="h-3.5 w-3.5" /></button></td>
						</tr>
					))}
				</tbody>
			</table>
		</div>,
		// Enrollment
		<div key="e" className="flex max-w-[560px] flex-col gap-3">
			<p className="text-[12.5px] text-[var(--g-ink-3)]">A daemon joins the realm with an enrollment token. It’s made with the realm and shown once, right after. You can revoke it, or make more, from the realm’s Access tokens.</p>
			<label><span className={LABEL}>Token name</span><input aria-label="Token name" value={eff_token} onChange={(e) => { set_token_touched(true); set_token_name(e.target.value); set_err(null); }} className={`${G_INPUT} g-mono w-full`} /></label>
		</div>,
		// Review
		<div key="r" className="flex flex-col gap-3">
			<p className="text-[12.5px] text-[var(--g-ink-3)]">Check it over. Create realm saves all of this at once — if any part fails, nothing is saved.</p>
			<table className="w-full overflow-hidden rounded-[10px] border border-[var(--g-line)]" data-testid="review">
				<tbody>
					<tr><td className={`${TD} w-[140px] text-[var(--g-ink-3)]`}>Realm</td><td className={TD}><b>{name.trim()}</b> <span className="g-mono text-[var(--g-ink-3)]">{org?.slug}.{eff_slug}</span></td></tr>
					<tr><td className={`${TD} text-[var(--g-ink-3)]`}>Description</td><td className={TD}>{description.trim() || <span className="text-[var(--g-ink-3)]">—</span>}</td></tr>
					<tr><td className={`${TD} text-[var(--g-ink-3)]`}>People</td><td className={TD}>you (admin){people.map((p) => `, ${p.label} (${p.role}${p.email ? ', email invite' : ''})`).join('')}</td></tr>
					<tr><td className={`${TD} text-[var(--g-ink-3)]`}>Teams</td><td className={TD}><span className="g-mono">@cliq/hello-world</span> <span className="text-[var(--g-ink-3)]">· always installed</span></td></tr>
					<tr><td className={`${TD} text-[var(--g-ink-3)]`}>Enrollment</td><td className={TD}><span className="g-mono">{eff_token}</span></td></tr>
				</tbody>
			</table>
		</div>,
	];

	return (
		<Graphite_shell data={overview.data} title="New realm">
			<div className="flex flex-col gap-4 px-7 py-6">
				<nav aria-label="Breadcrumb" className="text-[12.5px] text-[var(--g-ink-3)]"><Link to={back_to} className="hover:text-[var(--g-ink)]">Realms</Link> › <span className="text-[var(--g-ink-2)]">New realm</span></nav>
				<header className="flex items-center gap-3">
					<div className="min-w-0 flex-1"><h1 className="text-[22px] font-semibold tracking-tight">New realm</h1><p className="mt-1 text-[13px] text-[var(--g-ink-3)]">in {org?.display_name || org?.slug || '…'} · nothing is saved until you create it</p></div>
					<button type="button" disabled={busy} onClick={() => navigate(back_to)} className={G_BTN}>Cancel</button>
				</header>
				{!org ? <Banner tone="bad">Pick an organization first.</Banner> : (
					<div className="grid grid-cols-[180px_minmax(0,1fr)] gap-6">
						<ol aria-label="Steps" className="flex flex-col gap-0.5">
							{STEPS.map((s, i) => (
								<li key={s} aria-current={i === step ? 'step' : undefined} className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] ${i === step ? 'bg-[var(--g-soft)] font-semibold text-[var(--g-ink)]' : i < step ? 'text-[var(--g-ink)]' : 'text-[var(--g-ink-3)]'}`}>
									<span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${i < step ? 'bg-[var(--g-ok-soft)] text-[var(--g-ok)]' : i === step ? 'bg-[var(--g-acc)] text-[var(--g-on-acc)]' : 'border border-[var(--g-line-strong)]'}`}>{i < step ? <Check aria-hidden className="h-3 w-3" /> : i + 1}</span>{s}
								</li>
							))}
						</ol>
						<section aria-label={STEPS[step]} className="flex min-w-0 flex-col gap-4">
							{step_body[step]}
							{err ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{err}</p> : null}
							<div className="flex items-center gap-2 border-t border-[var(--g-line)] pt-3">
								{step > 0 ? <button type="button" disabled={busy} onClick={() => { set_err(null); set_step(step - 1); }} className={`${G_BTN} inline-flex items-center gap-1.5`}><ArrowLeft aria-hidden className="h-3.5 w-3.5" />Back</button> : null}
								<button type="button" disabled={busy} onClick={next} className={`${G_PRIMARY} ml-auto`}>{step === STEPS.length - 1 ? (busy ? 'Creating…' : 'Create realm') : 'Next'}</button>
							</div>
						</section>
					</div>
				)}
			</div>
		</Graphite_shell>
	);
}
