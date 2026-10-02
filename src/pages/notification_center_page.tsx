/**
 * Notifications (Graphite) — who gets told what, in one place.
 *
 * Reads: `POST /v1/notification_center/get` (every rule + channel you can
 * see, composed by the BFF) and `POST /v1/notification_center/check` for the
 * "Check a realm" tab. One call per view.
 * Writes: the existing single Core routes — orgs|realms set/remove_notification_rules
 * and notification_channels create/update/remove/test.
 *
 * Follows the view switcher: all orgs, one org, or one realm (org-wide rules
 * that reach that realm are included). Built-in (locked) rules and channels
 * show a lock and the reason, with no edit controls; seeded defaults carry a
 * "Default" tag and stay editable. Rule recipients show as chips.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, Bell, Lock, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useAuthFetch } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { api_message, use_bff_read } from '@/lib/use_bff_read';
import { use_view_scope, type View_scope } from '@/lib/view_scope';
import {
	can_edit_channel,
	can_edit_org,
	can_edit_org_channels,
	can_edit_realm,
	can_edit_rule,
	event_label,
	recipient_label,
	view_only_orgs,
	event_options,
	rule_effect,
	scope_text,
	type Notif_channel,
	type Notif_rule,
	type Notif_scope,
	type Notif_scope_kind,
	type Notification_center_data,
	type Notification_check_data,
} from '@/lib/notification_center';
import { Graphite_shell, Org_chip } from '@/components/graphite/graphite_shell';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Realm_picker, type Picked_realm } from '@/components/graphite/g_realm_picker';
import { Event_picker } from '@/components/graphite/g_event_picker';
import { Custom_events_panel } from '@/components/graphite/g_custom_events';

type Tab = 'rules' | 'channels' | 'check' | 'custom';
const TABS: Array<{ id: Tab; label: string }> = [
	{ id: 'rules', label: 'Rules' },
	{ id: 'channels', label: 'Channels' },
	{ id: 'check', label: 'Check a realm' },
	{ id: 'custom', label: 'Custom events' },
];

const INPUT = 'h-9 w-full rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[13px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';
const PRIMARY = 'rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';
const LABEL = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]';

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */

const TAG_STYLE: Record<Notif_scope_kind | 'personal', { fg: string; bg: string; word: string }> = {
	org: { fg: 'var(--g-ink-2)', bg: 'var(--g-soft)', word: 'org' },
	realm: { fg: '#7cc4ff', bg: 'rgba(91,157,255,.12)', word: 'realm' },
	team: { fg: '#c9b6ff', bg: 'rgba(182,156,255,.13)', word: 'team in realm' },
	personal: { fg: 'var(--g-ink-2)', bg: 'var(--g-soft)', word: 'only you' },
};

export function Scope_tag({ kind, text, org }: { kind: Notif_scope_kind | 'personal'; text: string; org?: { slug: string; display_name: string } | null }) {
	const t = TAG_STYLE[kind];
	return (
		<span className="inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px]" style={{ color: t.fg, background: t.bg }} data-scope={kind}>
			{org ? <Org_chip org={org} size={13} /> : null}
			<span className="text-[10px] uppercase tracking-[0.06em] opacity-80">{t.word}</span>
			<span className="truncate">{text}</span>
		</span>
	);
}

const DEST_GLYPH: Record<string, string> = { slack: '#', email: '@', webhook: '↗', http: '↗', jira: 'J', cliqhub: '◉', channel_ref: '→' };

function Dest_icons({ destinations }: { destinations: Array<{ type: string; label: string }> }) {
	return (
		<span className="inline-flex gap-1">
			{destinations.map((d, i) => (
				<span key={i} title={d.label} aria-label={d.label} className="grid h-[18px] w-[18px] place-items-center rounded border border-[var(--g-line)] bg-[var(--g-soft)] text-[10px] font-bold text-[var(--g-ink-2)]">
					{DEST_GLYPH[d.type] ?? '·'}
				</span>
			))}
		</span>
	);
}

function Event_cell({ selector, tag }: { selector: string; tag?: React.ReactNode }) {
	return (
		<div className="min-w-0">
			<b className="flex items-center gap-1.5 truncate text-[13px] font-semibold">{event_label(selector)}{tag}</b>
			<span className="g-mono block truncate text-[11px] text-[var(--g-ink-3)]">{selector}</span>
		</div>
	);
}

function Recipient_chips({ recipients }: { recipients: string[] }) {
	if (!recipients.length) return null;
	return (
		<span className="mt-1 flex flex-wrap gap-1" aria-label="Recipients">
			{recipients.map((r) => <span key={r} className="rounded-full border border-[var(--g-line)] bg-[var(--g-soft)] px-2 py-0.5 text-[11px] text-[var(--g-ink-2)]" data-testid="recipient-chip">{recipient_label(r)}</span>)}
		</span>
	);
}

function use_post() {
	const auth_fetch = useAuthFetch();
	return async (path: string, body: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> => {
		try {
			const res = await auth_fetch(path, { method: 'POST', body: JSON.stringify(body) });
			const payload = await res.json().catch(() => null);
			if (!res.ok || !payload?.ok) return { ok: false, error: api_message(payload, 'Request failed') };
			return { ok: true, data: payload.data ?? payload };
		} catch {
			return { ok: false, error: 'Network error — check your connection.' };
		}
	};
}

/** Rules/channels that belong in the current view. Realm view includes org-wide rules that reach it. */
export function in_view_rule(r: Notif_rule, scope: View_scope): boolean {
	if (scope.kind === 'all') return true;
	if (scope.kind === 'org') return r.scope.org_id === scope.org.id;
	return r.scope.org_id === scope.realm.org_id && (r.scope.kind === 'org' || r.scope.realm_id === scope.realm.id);
}

export function in_view_channel(c: Notif_channel, scope: View_scope): boolean {
	if (scope.kind === 'all') return true;
	if (scope.kind === 'org') return c.owner.org_id === scope.org.id;
	return c.owner.org_id === scope.realm.org_id && (c.owner.kind !== 'realm' || c.owner.realm_id === scope.realm.id);
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */

function Rules_tab({ data, scope, reload }: { data: Notification_center_data; scope: View_scope; reload: () => Promise<void> }) {
	const post = use_post();
	const [q, set_q] = useState('');
	const [kind, set_kind] = useState<'all' | Notif_scope_kind>('all');
	const [mine, set_mine] = useState(false);
	const [creating, set_creating] = useState(false);
	const [confirm, set_confirm] = useState<string | null>(null);
	const [error, set_error] = useState<string | null>(null);
	const org_by_id = new Map(data.orgs.map((o) => [o.id, o]));
	const by_id = new Map(data.rules.map((r) => [r.id, r]));
	const channel_by_id = new Map(data.channels.map((c) => [c.id, c]));

	const rules = data.rules
		.filter((r) => in_view_rule(r, scope))
		.filter((r) => kind === 'all' || r.scope.kind === kind)
		.filter((r) => !mine || can_edit_rule(data, r))
		.filter((r) => {
			const s = q.trim().toLowerCase();
			return !s || r.event.includes(s) || event_label(r.event).toLowerCase().includes(s) || (r.channel_name ?? '').toLowerCase().includes(s);
		});

	const any_editable = data.orgs.some((o) => o.status === 'ok' && can_edit_org(data, o.id)) || data.realms.some((r) => can_edit_realm(data, r.id));
	const read_only = view_only_orgs(data).filter((o) => scope.kind === 'all' || o.id === (scope.kind === 'org' ? scope.org.id : scope.realm.org_id));

	async function remove(r: Notif_rule) {
		set_error(null);
		const path = r.scope.kind === 'org' ? '/v1/orgs/remove_notification_rules' : '/v1/realms/remove_notification_rules';
		const res = await post(path, { id: r.id });
		if (!res.ok) { set_error(res.error); return; }
		set_confirm(null);
		await reload();
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<input value={q} onChange={(e) => set_q(e.target.value)} placeholder="Search event or channel…" aria-label="Search rules" className={`${INPUT} max-w-[260px]`} />
				<div role="group" aria-label="Applies to" className="flex gap-1">
					{(['all', 'org', 'realm', 'team'] as const).map((k) => (
						<button
							key={k}
							type="button"
							aria-pressed={kind === k}
							onClick={() => set_kind(k)}
							className={`h-8 rounded-full border px-3 text-[12.5px] ${kind === k ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}
						>
							{k === 'all' ? 'All levels' : k === 'org' ? 'Org-wide' : k === 'realm' ? 'Realm' : 'Team in realm'}
						</button>
					))}
				</div>
				<button type="button" aria-pressed={mine} onClick={() => set_mine((v) => !v)} className={`h-8 rounded-full border px-3 text-[12.5px] ${mine ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] text-[var(--g-ink)]' : 'border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>Only ones I can edit</button>
				<span className="ml-auto text-[12px] text-[var(--g-ink-3)]">Most specific wins: team › realm › org</span>
				{any_editable ? <button type="button" onClick={() => set_creating(true)} className={`${PRIMARY} inline-flex items-center gap-1.5`}><Plus className="h-3.5 w-3.5" aria-hidden />New rule</button> : null}
			</div>
			{read_only.length ? (
				<p className="flex items-center gap-2 text-[12.5px] text-[var(--g-ink-3)]" data-testid="view-only-note">
					<Lock aria-hidden className="h-3.5 w-3.5" />
					View only in {read_only.map((o) => `${o.display_name} (${o.role})`).join(', ')} — ask an org admin to change these.
				</p>
			) : null}

			{error ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{error}</p> : null}

			<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
				{rules.length === 0 ? (
					<div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
						<Bell aria-hidden className="h-6 w-6 text-[var(--g-ink-3)]" />
						<p className="text-[14px] font-semibold">No rules here yet</p>
						<p className="text-[12.5px] text-[var(--g-ink-3)]">Rules say when to notify, where it applies and where to send it.</p>
					</div>
				) : (
					<table className="w-full text-left text-[12.5px]">
						<thead>
							<tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
								<th className="px-4 py-2.5 font-semibold">When</th>
								<th className="px-4 py-2.5 font-semibold">Applies to</th>
								<th className="px-4 py-2.5 font-semibold">Send to</th>
								<th className="px-4 py-2.5 font-semibold"><span className="sr-only">Overrides</span></th>
								<th className="w-[120px] px-4 py-2.5" />
							</tr>
						</thead>
						<tbody>
							{rules.map((r) => {
								const ch = channel_by_id.get(r.channel_id);
								const replaced = r.replaces.map((id) => by_id.get(id)).filter(Boolean) as Notif_rule[];
								return (
									<tr key={r.id} className="border-b border-[var(--g-line-2)] last:border-b-0" data-testid={`rule-${r.id}`}>
										<td className="px-4 py-2.5">
											<Event_cell selector={r.event} tag={r.system_key && !r.locked ? <span className="rounded bg-[var(--g-soft)] px-1.5 text-[10.5px] font-medium text-[var(--g-ink-3)]" data-testid="default-tag">Default</span> : null} />
											{r.locked && r.lock_reason ? <span className="mt-0.5 block text-[11.5px] text-[var(--g-ink-3)]" data-testid="lock-reason">{r.lock_reason}</span> : null}
										</td>
										<td className="px-4 py-2.5"><Scope_tag kind={r.scope.kind} text={scope_text(r.scope)} org={org_by_id.get(r.scope.org_id)} /></td>
										<td className="px-4 py-2.5">
											<span className="inline-flex items-center gap-2">
												{ch ? <Dest_icons destinations={ch.destinations} /> : null}
												<b className="font-medium">{r.channel_name ?? <span className="text-[var(--g-ink-3)]">unknown channel</span>}</b>
												{ch && !ch.enabled ? <span className="rounded bg-[var(--g-soft)] px-1.5 text-[10.5px] text-[var(--g-ink-3)]">disabled</span> : null}
											</span>
											<Recipient_chips recipients={r.recipients} />
										</td>
										<td className="px-4 py-2.5">
											{replaced.length ? (
												<span
													className="inline-block rounded-full bg-[var(--g-warn-soft)] px-2 py-0.5 text-[11.5px] text-[var(--g-warn-text)]"
													title={replaced.map((b) => `${event_label(b.event)} · ${scope_text(b.scope)} → ${b.channel_name ?? '?'}`).join('\n')}
													data-testid="replaces"
												>
													↳ replaces {replaced.length === 1 ? `the ${replaced[0].scope.kind === 'org' ? 'org' : 'realm'} rule` : `${replaced.length} broader rules`}
												</span>
											) : null}
										</td>
										<td className="px-4 py-2.5 text-right">
											{r.locked ? (
												<span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--g-ink-3)]" title={r.lock_reason ?? 'Built in'} data-testid="locked">
													<Lock aria-hidden className="h-3 w-3" />Built in
												</span>
											) : !can_edit_rule(data, r) ? (
												<span className="inline-flex items-center gap-1.5 text-[11.5px] text-[var(--g-ink-3)]" title="You can see this rule but not change it" data-testid="view-only">
													<Lock aria-hidden className="h-3 w-3" />view only
												</span>
											) : confirm === r.id ? (
												<span className="inline-flex gap-1.5">
													<button type="button" onClick={() => void remove(r)} className="rounded-md bg-[var(--g-bad)] px-2.5 py-1 text-[12px] font-semibold text-[#160606]">Delete</button>
													<button type="button" onClick={() => set_confirm(null)} className={ROW_ACTION_CLS}>Keep</button>
												</span>
											) : (
												<button type="button" aria-label={`Delete rule ${event_label(r.event)} for ${scope_text(r.scope)}`} onClick={() => set_confirm(r.id)} className="grid h-7 w-7 place-items-center rounded-md text-[var(--g-ink-3)] hover:bg-[var(--g-soft)] hover:text-[var(--g-bad)]">
													<Trash2 className="h-3.5 w-3.5" />
												</button>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</div>

			{creating ? <New_rule_drawer data={data} scope={scope} on_close={() => set_creating(false)} on_saved={async () => { set_creating(false); await reload(); }} on_channel_created={async () => { await reload(); }} /> : null}
		</div>
	);
}

function Drawer({ title, on_close, children, label }: { title: string; on_close: () => void; children: React.ReactNode; label: string }) {
	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-label={label} onMouseDown={(e) => { if (e.target === e.currentTarget) on_close(); }}>
			<div className="flex h-full w-[560px] max-w-full flex-col gap-5 overflow-y-auto border-l border-[#33363c] bg-[#141518] px-7 py-6 shadow-[-20px_0_60px_rgba(0,0,0,.5)]">
				<div className="flex items-center">
					<h2 className="text-[18px] font-semibold">{title}</h2>
					<button type="button" onClick={on_close} aria-label="Close" className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-4 w-4" /></button>
				</div>
				{children}
			</div>
		</div>
	);
}

function New_rule_drawer({ data, scope, on_close, on_saved, on_channel_created }: {
	data: Notification_center_data; scope: View_scope; on_close: () => void; on_saved: () => Promise<void>;
	/** Refresh the page data (a channel was created, or some rules were saved). */
	on_channel_created: (created: { id: string; name: string } | null) => Promise<void>;
}) {
	const post = use_post();
	const ok_orgs = data.orgs.filter((o) => o.status === 'ok');
	// An org is pickable when you can change something in it (org rules or any realm).
	const org_usable = (id: string) => can_edit_org(data, id) || data.realms.some((r) => r.org_id === id && can_edit_realm(data, r.id));
	const view_org_id = scope.kind === 'org' ? scope.org.id : scope.kind === 'realm' ? scope.realm.org_id : null;
	const default_org = view_org_id && org_usable(view_org_id) ? view_org_id : ok_orgs.find((o) => org_usable(o.id))?.id ?? '';
	const first_realm = (oid: string): Picked_realm | null => {
		const r = data.realms.find((x) => x.org_id === oid && can_edit_realm(data, x.id));
		return r ? { id: r.id, slug: r.slug, org_slug: r.org_slug } : null;
	};
	const [events, set_events] = useState<string[]>(['run.failed']);
	const [kind, set_kind] = useState<Notif_scope_kind>(scope.kind === 'realm' || !can_edit_org(data, default_org) ? 'realm' : 'org');
	const [org_id, set_org_id] = useState(default_org);
	const [realm, set_realm] = useState<Picked_realm | null>(
		scope.kind === 'realm' && can_edit_realm(data, scope.realm.id)
			? { id: scope.realm.id, slug: scope.realm.slug, org_slug: scope.realm.org_slug }
			: first_realm(default_org),
	);
	const realm_id = realm?.id ?? '';
	const [making_channel, set_making_channel] = useState(false);
	const [team, set_team] = useState('');
	const [channel_id, set_channel_id] = useState('');
	const [busy, set_busy] = useState(false);
	const [error, set_error] = useState<string | null>(null);

	const org = data.orgs.find((o) => o.id === org_id);
	const channels = data.channels.filter((c) => c.owner.org_id === org_id && (c.owner.kind !== 'realm' || (kind !== 'org' && c.owner.realm_id === realm_id)));
	const team_options = [...new Set(data.rules.filter((r) => r.scope.realm_id === realm_id && r.scope.team_slug).map((r) => r.scope.team_slug as string))];

	const draft_scope: Notif_scope = {
		kind, org_id, org_slug: org?.slug ?? '', realm_id: kind === 'org' ? null : realm_id || null,
		realm_slug: kind === 'org' ? null : realm?.slug ?? null, team_slug: kind === 'team' ? team.trim() || null : null,
	};
	// Combine the effect of every chosen event; only the nearest broader level would have fired.
	const uniq = (rs: Notif_rule[]) => [...new Map(rs.map((r) => [r.id, r])).values()];
	const effects = events.map((e) => rule_effect({ event: e, scope: draft_scope }, data.rules));
	const nearest = uniq(effects.flatMap((ef) => {
		const k = ef.replaces.some((r) => r.scope.kind === 'realm') ? 'realm' : 'org';
		return ef.replaces.filter((r) => r.scope.kind === k);
	}));
	const alongside = uniq(effects.flatMap((ef) => ef.alongside));
	const overridden = uniq(effects.flatMap((ef) => ef.overridden_by));
	const channel = data.channels.find((c) => c.id === channel_id);
	const allowed = kind === 'org' ? can_edit_org(data, org_id) : Boolean(realm_id) && can_edit_realm(data, realm_id);
	const ready = Boolean(allowed && org_id && events.length && channel_id && (kind === 'org' || realm_id) && (kind !== 'team' || team.trim()));
	const where = kind === 'org' ? `every realm in ${org?.display_name ?? 'the org'}` : kind === 'realm' ? realm?.slug ?? 'this realm' : `${team.trim() || 'the team'} in ${realm?.slug ?? 'the realm'}`;
	const what = events.length <= 3 ? events.map((e) => `“${event_label(e)}”`).join(', ') : `${events.slice(0, 2).map((e) => `“${event_label(e)}”`).join(', ')} and ${events.length - 2} more`;

	async function save() {
		set_busy(true);
		set_error(null);
		// One request; the BFF writes one rule per event (Core takes one at a time).
		const body = kind === 'org'
			? { org_id, events, channel_id }
			: { realm_id, events, channel_id, ...(kind === 'team' ? { team_slug: team.trim() } : {}) };
		const res = await post('/v1/notification_center/set_rules', body);
		set_busy(false);
		if (!res.ok) { set_error(res.error); return; }
		const out = res.data as { saved?: Array<{ event: string }>; failed?: Array<{ event: string; error: string }> };
		if (out.failed?.length) {
			set_events(out.failed.map((f) => f.event));
			set_error(`Saved ${out.saved?.length ?? 0}. Couldn’t save: ${out.failed.map((f) => `${event_label(f.event)} (${f.error})`).join('; ')}`);
			await on_channel_created(null);
			return;
		}
		await on_saved();
	}

	return (
		<Drawer title="New rule" label="New rule" on_close={on_close}>
			<div>
				<span className={LABEL}>1 · When <span className="normal-case tracking-normal text-[var(--g-ink-3)]">— pick one or more</span></span>
				<Event_picker groups={event_options(data.event_types, data.rules)} value={events} on_change={set_events} />
			</div>

			<div>
				<span className={LABEL}>2 · Applies to</span>
				<div role="radiogroup" aria-label="Applies to" className="grid grid-cols-3 gap-2">
					{([['org', 'Whole org'], ['realm', 'One realm'], ['team', 'A team in a realm']] as const).map(([k, l]) => (
						<button
							key={k}
							type="button"
							role="radio"
							aria-checked={kind === k}
							disabled={k === 'org' && !can_edit_org(data, org_id)}
							title={k === 'org' && !can_edit_org(data, org_id) ? 'Needs org owner' : undefined}
							onClick={() => { set_kind(k); set_channel_id(''); }}
							className={`rounded-lg border px-3 py-2.5 text-left text-[13px] font-semibold ${kind === k ? 'border-[var(--g-acc)] bg-[rgba(212,255,63,.05)]' : 'border-[var(--g-line)] hover:border-[#3a3d44]'} disabled:cursor-not-allowed disabled:opacity-40`}
						>
							{l}
						</button>
					))}
				</div>
				<div className="mt-2 grid gap-2">
					<select aria-label="Org" value={org_id} onChange={(e) => { const id = e.target.value; set_org_id(id); set_realm(first_realm(id)); if (kind === 'org' && !can_edit_org(data, id)) set_kind('realm'); set_channel_id(''); }} className={INPUT}>
						{ok_orgs.map((o) => <option key={o.id} value={o.id} disabled={!org_usable(o.id)}>{o.display_name}{org_usable(o.id) ? '' : ` — ${o.role}, can’t add rules`}</option>)}
					</select>
					{kind !== 'org' ? (
						<Realm_picker
							org_id={org_id}
							value={realm}
							on_change={(r) => { set_realm(r); set_channel_id(''); }}
							blocked={(id) => (can_edit_realm(data, id) ? null : 'view only')}
						/>
					) : null}
					{kind === 'team' ? (
						<>
							<input aria-label="Team" list="nr-teams" value={team} onChange={(e) => set_team(e.target.value)} placeholder="team slug, e.g. feature-dev-js" className={INPUT} />
							<datalist id="nr-teams">{team_options.map((t) => <option key={t} value={t} />)}</datalist>
						</>
					) : null}
				</div>
			</div>

			<div>
				<label className={LABEL} htmlFor="nr-channel">3 · Send to</label>
				<select id="nr-channel" value={channel_id} onChange={(e) => set_channel_id(e.target.value)} className={INPUT}>
					<option value="">Choose a channel…</option>
					{channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.owner.kind === 'realm' ? ` (realm ${c.owner.realm_slug})` : c.owner.kind === 'personal' ? ' (only you)' : ''}{c.enabled ? '' : ' — disabled'}</option>)}
				</select>
				<p className="mt-1.5 text-[12px] text-[var(--g-ink-3)]">
					A channel is a named set of destinations. Or{' '}
					<button type="button" onClick={() => set_making_channel(true)} disabled={!allowed} className="font-semibold text-[var(--g-acc)] hover:underline disabled:opacity-50">+ create a channel</button>{' '}
					without leaving this rule.
				</p>
			</div>

			<div className="rounded-[10px] border border-[rgba(255,178,36,.35)] bg-[var(--g-warn-soft)] px-4 py-3 text-[13px]" data-testid="rule-effect">
				<b>What changes</b>
				{events.length ? (
					<p className="mt-1 text-[var(--g-ink-2)]">
						For {where}, {what} will go to <b>{channel?.name ?? 'the chosen channel'}</b>
						{nearest.length ? <> <u>instead of</u> {nearest.map((r) => `${r.channel_name ?? '?'} (${r.scope.kind} rule)`).join(', ')}</> : null}.
						{alongside.length ? <> It fires alongside {alongside.length} other rule{alongside.length === 1 ? '' : 's'} at the same level.</> : null}
						{overridden.length ? <> Where a narrower rule exists ({[...new Set(overridden.map((r) => scope_text(r.scope)))].join(', ')}), that rule still wins.</> : null}
					</p>
				) : <p className="mt-1 text-[var(--g-ink-3)]">Pick at least one event.</p>}
				{events.length > 1 ? <p className="mt-1 text-[12px] text-[var(--g-ink-3)]">Saves as {events.length} rules — one per event — so each can be changed on its own later.</p> : null}
			</div>

			{error ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{error}</p> : null}
			<div className="flex gap-2">
				<button type="button" disabled={!ready || busy} onClick={() => void save()} className={PRIMARY}>{busy ? 'Saving…' : events.length > 1 ? `Save ${events.length} rules` : 'Save rule'}</button>
				<button type="button" onClick={on_close} className={ROW_ACTION_CLS}>Cancel</button>
			</div>
			{making_channel ? (
				<New_channel_drawer
					data={data}
					scope={scope}
					preset={{ owner: kind === 'org' ? 'org' : 'realm', org_id, realm }}
					on_close={() => set_making_channel(false)}
					on_saved={async (created) => { set_making_channel(false); await on_channel_created(created); if (created?.id) set_channel_id(created.id); }}
				/>
			) : null}
		</Drawer>
	);
}

/* ------------------------------------------------------------------ */
/* Channels                                                            */

type Dest_draft = { type: 'cliqhub' | 'slack' | 'email' | 'webhook'; value: string };

export function draft_to_destination(d: Dest_draft): Record<string, unknown> {
	if (d.type === 'slack') return { type: 'slack', webhook_url: d.value.trim() };
	if (d.type === 'email') return { type: 'email', address: d.value.trim() };
	if (d.type === 'webhook') return { type: 'webhook', url: d.value.trim() };
	return { type: 'cliqhub' };
}

function Channels_tab({ data, scope, reload }: { data: Notification_center_data; scope: View_scope; reload: () => Promise<void> }) {
	const post = use_post();
	const [search] = useSearchParams();
	// Deep link from the inbox ("Fix channel").
	const [open_id, set_open_id] = useState<string | null>(() => search.get('channel'));
	const [creating, set_creating] = useState(false);
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [confirm_delete, set_confirm_delete] = useState(false);
	const org_by_id = new Map(data.orgs.map((o) => [o.id, o]));
	const channels = data.channels.filter((c) => in_view_channel(c, scope));
	const open = channels.find((c) => c.id === open_id) ?? null;
	const used_by = open ? data.rules.filter((r) => r.channel_id === open.id) : [];

	async function act(path: string, body: Record<string, unknown>, done: string) {
		set_msg(null);
		const res = await post(path, body);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return false; }
		if (path.endsWith('/test')) {
			const d = res.data as { delivered?: number; errors?: string[] };
			set_msg(d.errors?.length ? { tone: 'bad', text: `Delivered to ${d.delivered ?? 0}; ${d.errors.join('; ')}` } : { tone: 'ok', text: `Test delivered to ${d.delivered ?? 0} destination${d.delivered === 1 ? '' : 's'}.` });
		} else {
			set_msg({ tone: 'ok', text: done });
		}
		await reload();
		return true;
	}

	return (
		<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
			<div className="flex min-w-0 flex-col gap-4">
				<div className="flex items-center">
					<p className="text-[13px] text-[var(--g-ink-3)]">Named places messages go. One channel can fan out to several destinations.</p>
					{data.orgs.some((o) => o.status === 'ok' && can_edit_org_channels(data, o.id)) || data.realms.some((r) => can_edit_realm(data, r.id))
						? <button type="button" onClick={() => set_creating(true)} className={`${PRIMARY} ml-auto inline-flex items-center gap-1.5`}><Plus className="h-3.5 w-3.5" aria-hidden />New channel</button>
						: null}
				</div>
				<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
					{channels.length === 0 ? (
						<p className="px-4 py-10 text-center text-[13px] text-[var(--g-ink-3)]">No channels in this view yet.</p>
					) : (
						<table className="w-full text-left text-[12.5px]">
							<thead>
								<tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
									<th className="px-4 py-2.5 font-semibold">Channel</th>
									<th className="px-4 py-2.5 font-semibold">Owned by</th>
									<th className="px-4 py-2.5 font-semibold">Destinations</th>
									<th className="px-4 py-2.5 font-semibold">Used by</th>
								</tr>
							</thead>
							<tbody>
								{channels.map((c) => (
									<tr
										key={c.id}
										onClick={() => { set_open_id(c.id); set_msg(null); set_confirm_delete(false); }}
										className={`cursor-pointer border-b border-[var(--g-line-2)] last:border-b-0 hover:bg-[var(--g-soft)] ${open_id === c.id ? 'bg-[var(--g-soft)]' : ''}`}
										data-testid={`channel-${c.id}`}
									>
										<td className="px-4 py-2.5">
											<button type="button" className="text-left font-semibold" onClick={() => set_open_id(c.id)}>{c.name}</button>
											{c.locked ? <span title={c.lock_reason ?? 'Built in'}><Lock aria-label="Built in" className="ml-1.5 inline h-3 w-3 text-[var(--g-ink-3)]" /></span> : null}
											{c.enabled ? null : <span className="ml-2 rounded bg-[var(--g-soft)] px-1.5 text-[10.5px] text-[var(--g-ink-3)]">disabled</span>}
										</td>
										<td className="px-4 py-2.5">
											<Scope_tag kind={c.owner.kind} text={c.owner.kind === 'realm' ? c.owner.realm_slug ?? '' : c.owner.kind === 'org' ? org_by_id.get(c.owner.org_id)?.display_name ?? c.owner.org_slug : ''} org={c.owner.kind === 'personal' ? null : org_by_id.get(c.owner.org_id)} />
										</td>
										<td className="px-4 py-2.5"><Dest_icons destinations={c.destinations} /></td>
										<td className="px-4 py-2.5 text-[var(--g-ink-2)]">{c.rule_count} rule{c.rule_count === 1 ? '' : 's'}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</div>
			</div>

			<aside className="rounded-[10px] border border-[var(--g-line)] bg-[#121316] p-5" aria-label="Channel details">
				{open ? (
					<div className="flex flex-col gap-3.5">
						<div className="flex items-start">
							<h2 className="text-[16px] font-semibold">{open.name}</h2>
							<button type="button" aria-label="Close details" onClick={() => set_open_id(null)} className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-4 w-4" /></button>
						</div>
						<p className="text-[12.5px] text-[var(--g-ink-3)]">{open.enabled ? 'Enabled' : 'Disabled'} · used by {open.rule_count} rule{open.rule_count === 1 ? '' : 's'}</p>
						<div>
							<span className={LABEL}>Destinations</span>
							<ul className="flex flex-col gap-1.5">
								{open.destinations.map((d, i) => (
									<li key={i} className="flex items-center gap-2 rounded-md border border-[var(--g-line)] px-2.5 py-2 text-[12.5px]"><Dest_icons destinations={[d]} />{d.label}</li>
								))}
							</ul>
						</div>
						<div>
							<span className={LABEL}>Used by</span>
							{used_by.length ? (
								<ul className="text-[12.5px] text-[var(--g-ink-2)]">
									{used_by.map((r) => <li key={r.id}>{event_label(r.event)} · {scope_text(r.scope)}</li>)}
								</ul>
							) : <p className="text-[12.5px] text-[var(--g-ink-3)]">No rules use this channel yet.</p>}
						</div>
						{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
						{open.locked ? (
							<p className="flex items-center gap-2 text-[12.5px] text-[var(--g-ink-3)]" data-testid="channel-locked"><Lock aria-hidden className="h-3.5 w-3.5" />{open.lock_reason ?? 'Built in — this channel can’t be changed or removed.'}</p>
						) : !can_edit_channel(data, open) ? (
							<p className="flex items-center gap-2 text-[12.5px] text-[var(--g-ink-3)]" data-testid="channel-view-only"><Lock aria-hidden className="h-3.5 w-3.5" />View only — ask an org admin to change this channel.</p>
						) : <div className="flex flex-wrap gap-2">
							<button type="button" onClick={() => void act('/v1/notification_channels/test', { id: open.id }, '')} className={PRIMARY}>Send test</button>
							<button type="button" onClick={() => void act('/v1/notification_channels/update', { id: open.id, enabled: !open.enabled }, open.enabled ? 'Channel disabled.' : 'Channel enabled.')} className={ROW_ACTION_CLS}>{open.enabled ? 'Disable' : 'Enable'}</button>
							{confirm_delete ? (
								<>
									<button type="button" onClick={async () => { if (await act('/v1/notification_channels/remove', { id: open.id }, 'Channel deleted.')) set_open_id(null); }} className="rounded-md bg-[var(--g-bad)] px-3 py-1.5 text-[12.5px] font-semibold text-[#160606]">Delete channel</button>
									<button type="button" onClick={() => set_confirm_delete(false)} className={ROW_ACTION_CLS}>Keep</button>
								</>
							) : (
								<button type="button" onClick={() => set_confirm_delete(true)} className={`${ROW_ACTION_CLS} text-[var(--g-bad)]`}>Delete…</button>
							)}
						</div>}
						{confirm_delete && open.rule_count > 0 ? <p className="text-[12px] text-[var(--g-warn-text)]">{open.rule_count} rule{open.rule_count === 1 ? '' : 's'} send to this channel and will stop delivering.</p> : null}
					</div>
				) : (
					<p className="text-[12.5px] text-[var(--g-ink-3)]">Select a channel to see its destinations, which rules use it, and to send a test.</p>
				)}
			</aside>

			{creating ? <New_channel_drawer data={data} scope={scope} on_close={() => set_creating(false)} on_saved={async () => { set_creating(false); await reload(); }} /> : null}
		</div>
	);
}

function New_channel_drawer({ data, scope, preset, on_close, on_saved }: {
	data: Notification_center_data; scope: View_scope;
	/** Opened from the rule panel: start at the rule's level. */
	preset?: { owner: 'org' | 'realm'; org_id: string; realm: Picked_realm | null };
	on_close: () => void; on_saved: (created: { id: string; name: string } | null) => Promise<void>;
}) {
	const post = use_post();
	const ok_orgs = data.orgs.filter((o) => o.status === 'ok');
	const org_usable = (id: string) => can_edit_org_channels(data, id) || data.realms.some((r) => r.org_id === id && can_edit_realm(data, r.id));
	const view_org_id = scope.kind === 'org' ? scope.org.id : scope.kind === 'realm' ? scope.realm.org_id : null;
	const start_org = preset?.org_id ?? (view_org_id && org_usable(view_org_id) ? view_org_id : ok_orgs.find((o) => org_usable(o.id))?.id ?? '');
	const first_realm = (oid: string): Picked_realm | null => {
		const r = data.realms.find((x) => x.org_id === oid && can_edit_realm(data, x.id));
		return r ? { id: r.id, slug: r.slug, org_slug: r.org_slug } : null;
	};
	const [name, set_name] = useState('');
	const [owner, set_owner] = useState<'org' | 'realm'>(preset?.owner ?? (scope.kind === 'realm' || !can_edit_org_channels(data, start_org) ? 'realm' : 'org'));
	const [org_id, set_org_id] = useState(start_org);
	const [realm, set_realm] = useState<Picked_realm | null>(preset?.realm ?? (scope.kind === 'realm' ? { id: scope.realm.id, slug: scope.realm.slug, org_slug: scope.realm.org_slug } : first_realm(start_org)));
	const realm_id = realm?.id ?? '';
	const [dests, set_dests] = useState<Dest_draft[]>([{ type: 'cliqhub', value: '' }]);
	const [busy, set_busy] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	const allowed = owner === 'org' ? can_edit_org_channels(data, org_id) : Boolean(realm_id) && can_edit_realm(data, realm_id);
	const ready = allowed && name.trim() && dests.length > 0 && dests.every((d) => d.type === 'cliqhub' || d.value.trim()) && (owner === 'org' ? org_id : realm_id);

	async function save() {
		set_busy(true);
		set_error(null);
		const body: Record<string, unknown> = { name: name.trim(), destinations: dests.map(draft_to_destination) };
		if (owner === 'org') body.org_id = org_id;
		else body.realm_id = realm_id;
		const res = await post('/v1/notification_channels/create', body);
		set_busy(false);
		if (!res.ok) { set_error(res.error); return; }
		const created = res.data as { id?: unknown; name?: unknown } | null;
		await on_saved(created && typeof created.id === 'string' ? { id: created.id, name: String(created.name ?? name.trim()) } : null);
	}

	const placeholder: Record<Dest_draft['type'], string> = { cliqhub: '', slack: 'https://hooks.slack.com/services/…', email: 'ops@example.com', webhook: 'https://example.com/hook' };

	return (
		<Drawer title="New channel" label="New channel" on_close={on_close}>
			<div>
				<label className={LABEL} htmlFor="nc-name">Name</label>
				<input id="nc-name" value={name} onChange={(e) => set_name(e.target.value)} placeholder="#prod-oncall" className={INPUT} />
			</div>
			<div>
				<span className={LABEL}>Owned by</span>
				<div role="radiogroup" aria-label="Owned by" className="grid grid-cols-2 gap-2">
					{([['org', 'The whole org'], ['realm', 'One realm']] as const).map(([k, l]) => (
						<button key={k} type="button" role="radio" aria-checked={owner === k} disabled={k === 'org' && !can_edit_org_channels(data, org_id)} title={k === 'org' && !can_edit_org_channels(data, org_id) ? 'Needs org owner or admin' : undefined} onClick={() => set_owner(k)} className={`rounded-lg border px-3 py-2.5 text-left text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${owner === k ? 'border-[var(--g-acc)] bg-[rgba(212,255,63,.05)]' : 'border-[var(--g-line)]'}`}>{l}</button>
					))}
				</div>
				<div className="mt-2 grid gap-2">
					<select aria-label="Org" value={org_id} onChange={(e) => { const id = e.target.value; set_org_id(id); set_realm(first_realm(id)); if (!can_edit_org_channels(data, id)) set_owner('realm'); }} className={INPUT}>
						{ok_orgs.map((o) => <option key={o.id} value={o.id} disabled={!org_usable(o.id)}>{o.display_name}{org_usable(o.id) ? '' : ` — ${o.role}, view only`}</option>)}
					</select>
					{owner === 'realm' ? (
						<Realm_picker org_id={org_id} value={realm} on_change={set_realm} blocked={(id) => (can_edit_realm(data, id) ? null : 'view only')} />
					) : null}
				</div>
			</div>
			<div>
				<span className={LABEL}>Destinations</span>
				<div className="flex flex-col gap-2">
					{dests.map((d, i) => (
						<div key={i} className="flex gap-2">
							<select aria-label={`Destination ${i + 1} type`} value={d.type} onChange={(e) => set_dests((cur) => cur.map((x, j) => (j === i ? { type: e.target.value as Dest_draft['type'], value: '' } : x)))} className={`${INPUT.replace('w-full', '')} w-[140px] shrink-0`}>
								<option value="cliqhub">In-app</option>
								<option value="slack">Slack</option>
								<option value="email">Email</option>
								<option value="webhook">Webhook</option>
							</select>
							{d.type === 'cliqhub' ? (
								<span className="flex min-w-0 flex-1 items-center text-[12.5px] text-[var(--g-ink-3)]">Shows in CliqHub for the people involved</span>
							) : (
								<input aria-label={`Destination ${i + 1} value`} value={d.value} onChange={(e) => set_dests((cur) => cur.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={placeholder[d.type]} className={INPUT} />
							)}
							{dests.length > 1 ? <button type="button" aria-label={`Remove destination ${i + 1}`} onClick={() => set_dests((cur) => cur.filter((_, j) => j !== i))} className="text-[var(--g-ink-3)] hover:text-[var(--g-bad)]"><X className="h-4 w-4" /></button> : null}
						</div>
					))}
				</div>
				<button type="button" onClick={() => set_dests((cur) => [...cur, { type: 'slack', value: '' }])} className="mt-2 text-[12.5px] text-[var(--g-acc)] hover:underline">+ Add destination</button>
			</div>
			{error ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{error}</p> : null}
			<div className="flex gap-2">
				<button type="button" disabled={!ready || busy} onClick={() => void save()} className={PRIMARY}>{busy ? 'Creating…' : 'Create channel'}</button>
				<button type="button" onClick={on_close} className={ROW_ACTION_CLS}>Cancel</button>
			</div>
		</Drawer>
	);
}

/* ------------------------------------------------------------------ */
/* Check a realm                                                       */

function Check_tab({ data, scope }: { data: Notification_center_data; scope: View_scope }) {
	const view_org_id = scope.kind === 'all' ? null : scope.kind === 'org' ? scope.org.id : scope.realm.org_id;
	const candidates = data.realms.filter((r) => !view_org_id || r.org_id === view_org_id);
	const [search] = useSearchParams();
	const as_pick = (id: string | null): Picked_realm | null => {
		if (!id) return null;
		const r = data.realms.find((x) => x.id === id);
		return { id, slug: r?.slug ?? '', org_slug: r?.org_slug ?? null };
	};
	// Deep link from the inbox ("Why did I get this?"): realm preselected, event highlighted.
	const [picked, set_picked] = useState<Picked_realm | null>(() => as_pick(scope.kind === 'realm' ? scope.realm.id : search.get('realm')) ?? as_pick(candidates[0]?.id ?? null));
	const focus_event = search.get('event');
	const realm_id = picked?.id ?? '';
	const [team, set_team] = useState('');
	const [gaps, set_gaps] = useState(true);
	const check = use_bff_read<Notification_check_data>(
		'/v1/notification_center/check',
		realm_id ? { realm_id, ...(team ? { team_slug: team } : {}) } : null,
		{ fallback_error: 'Could not check this realm.' },
	);
	const d = check.data;
	const rows = d ? d.rows.filter((r) => gaps || r.winners.length) : [];

	// Slug for a deep-linked realm we hadn't loaded comes back with the check.
	const shown_pick = picked && !picked.slug && d?.realm.id === picked.id ? { ...picked, slug: d.realm.slug, org_slug: d.realm.org_slug } : picked;

	return (
		<div className="flex flex-col gap-4">
			<p className="text-[13px] text-[var(--g-ink-3)]">Pick a realm (and optionally a team) to see exactly who gets told for each event, after org, realm and team rules are applied.</p>
			<div className="flex flex-wrap items-center gap-2">
				<div className="w-[300px] max-w-full">
					<Realm_picker label="Realm to check" org_id={view_org_id} value={shown_pick} on_change={(r) => { set_picked(r); set_team(''); }} show_org={!view_org_id} />
				</div>
				<select aria-label="Team" value={team} onChange={(e) => set_team(e.target.value)} className={`${INPUT} w-[240px] max-w-full`}>
					<option value="">Any team (realm level)</option>
					{(d?.teams ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
				</select>
				<label className="ml-auto flex items-center gap-2 text-[12.5px] text-[var(--g-ink-2)]">
					<input type="checkbox" checked={gaps} onChange={(e) => set_gaps(e.target.checked)} /> Show events nobody is told about
				</label>
			</div>
			{check.status === 'loading' ? <div className="h-[300px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Checking" /> : null}
			{check.status === 'error' && !d ? <p role="alert" className="text-[13px] text-[var(--g-bad)]">{check.error}</p> : null}
			{d ? (
				<div className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]">
					<table className="w-full text-left text-[12.5px]">
						<thead>
							<tr className="border-b border-[var(--g-line)] text-[10.5px] uppercase tracking-[0.07em] text-[var(--g-ink-3)]">
								<th className="px-4 py-2.5 font-semibold">Event</th>
								<th className="px-4 py-2.5 font-semibold">Goes to</th>
								<th className="px-4 py-2.5 font-semibold">Because of</th>
								<th className="px-4 py-2.5 font-semibold">Replaces</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.event} className={`border-b border-[var(--g-line-2)] last:border-b-0 ${focus_event === r.event ? 'bg-[var(--g-acc-soft)] shadow-[inset_2px_0_0_var(--g-acc)]' : ''}`} data-testid={`check-${r.event}`} aria-current={focus_event === r.event ? 'true' : undefined}>
									<td className="px-4 py-2.5"><Event_cell selector={r.event} /></td>
									<td className="px-4 py-2.5">{r.winners.length ? r.winners.map((w) => <b key={w.rule_id} className="mr-2 font-medium">{w.channel_name ?? '?'}</b>) : <span className="text-[var(--g-ink-3)]">— Nobody is told</span>}</td>
									<td className="px-4 py-2.5">
										{r.winners.length ? r.winners.map((w) => (
											<span key={w.rule_id} className="mr-1.5 inline-block">
												<Scope_tag kind={w.tier} text={`${w.tier === 'org' ? d.realm.org_slug : w.tier === 'team' ? `${d.team_slug} · ${d.realm.slug}` : d.realm.slug}${w.selector !== r.event ? ` (${w.selector})` : ''}`} />
											</span>
										)) : <span className="text-[var(--g-ink-3)]">no rule</span>}
									</td>
									<td className="px-4 py-2.5 text-[var(--g-ink-3)]">{r.replaced.map((x) => <s key={x.rule_id} className="mr-2">{x.tier} → {x.channel_name ?? '?'}</s>)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
		</div>
	);
}

function Custom_tab({ data, scope }: { data: Notification_center_data; scope: View_scope }) {
	const view_org_id = scope.kind === 'all' ? null : scope.kind === 'org' ? scope.org.id : scope.realm.org_id;
	const [search] = useSearchParams();
	const first = scope.kind === 'realm' ? scope.realm.id : search.get('realm') ?? data.realms.find((r) => !view_org_id || r.org_id === view_org_id)?.id ?? null;
	const r = first ? data.realms.find((x) => x.id === first) : null;
	const initial: Picked_realm | null = first ? { id: first, slug: r?.slug ?? '', org_slug: r?.org_slug ?? null } : null;
	return <Custom_events_panel key={view_org_id ?? 'all'} org_id={view_org_id} initial={initial} />;
}

/* ------------------------------------------------------------------ */

type Realm_paging = { q: string; set_q: (q: string) => void; offset: number; set_offset: (n: number) => void };

/**
 * Realm rules are shown one page of realms at a time: search realms, page
 * through them, see which realms on this page have rules of their own.
 */
function Realm_pager({ data, paging }: { data: Notification_center_data; paging: Realm_paging }) {
	const page = data.realm_page;
	const [draft, set_draft] = useState(paging.q);
	useEffect(() => { const t = setTimeout(() => { if (draft.trim() !== paging.q) paging.set_q(draft.trim()); }, 300); return () => clearTimeout(t); }, [draft, paging]);
	const from = page.total ? page.offset + 1 : 0;
	const to = Math.min(page.offset + page.limit, page.total);
	const own = (id: string) => data.rules.filter((r) => r.scope.realm_id === id).length;
	return (
		<div className="flex flex-col gap-2 rounded-[10px] border border-[var(--g-line)] bg-[#121316] px-3.5 py-2.5" data-testid="realm-pager">
			<div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--g-ink-3)]">
				<span>Org-wide rules, plus realm and team rules for</span>
				<input aria-label="Search realms" value={draft} onChange={(e) => set_draft(e.target.value)} placeholder="Search realms…" className="h-7 w-[180px] rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2 text-[12.5px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]" />
				<span className="ml-auto whitespace-nowrap" data-testid="realm-range">{page.status === 'error' ? 'Realms couldn’t be loaded' : page.total ? `Realms ${from}–${to} of ${page.total}` : paging.q ? 'No realms match' : 'No realms'}</span>
				<button type="button" aria-label="Previous realms" disabled={page.offset === 0} onClick={() => paging.set_offset(Math.max(0, page.offset - page.limit))} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] disabled:opacity-40">‹</button>
				<button type="button" aria-label="Next realms" disabled={to >= page.total} onClick={() => paging.set_offset(page.offset + page.limit)} className="grid h-7 w-7 place-items-center rounded-md border border-[var(--g-line)] text-[var(--g-ink-2)] hover:bg-[var(--g-soft)] disabled:opacity-40">›</button>
			</div>
			{data.realms.length ? (
				<div className="flex flex-wrap gap-1.5" aria-label="Realms on this page">
					{data.realms.map((r) => {
						const n = own(r.id);
						return (
							<span key={r.id} className={`inline-flex items-center gap-1.5 rounded-md border border-[var(--g-line-2)] px-2 py-0.5 text-[11.5px] ${n ? 'text-[var(--g-ink-2)]' : 'text-[var(--g-ink-3)] opacity-70'}`} title={n ? `${n} rule${n === 1 ? '' : 's'} of its own` : 'Only org-wide rules apply'}>
								<span className="g-mono">{r.slug}</span>{n ? <span className="g-mono text-[var(--g-acc)]">{n}</span> : null}
							</span>
						);
					})}
				</div>
			) : null}
		</div>
	);
}

function Notifications_inner({ data, reload, tab, scope, on_tab, paging = null }: { data: Notification_center_data; reload: () => Promise<void>; tab: Tab; scope: View_scope; on_tab: (t: Tab) => void; paging?: Realm_paging | null }) {
	const failed = [...data.orgs.filter((o) => o.status === 'error').map((o) => o.display_name), ...data.realms.filter((r) => r.status === 'error').map((r) => r.slug)];
	return (
		<div className="flex flex-col gap-[18px]">
			<div>
				<h1 className="text-[24px] font-semibold tracking-[-0.02em]">Notifications</h1>
				<p className="mt-1 text-[13.5px] text-[var(--g-ink-3)]">Who gets told what — every org, realm and team you can see, in one place. Each rule says <b className="text-[var(--g-ink)]">when</b>, <b className="text-[var(--g-ink)]">where it applies</b> and <b className="text-[var(--g-ink)]">where it goes</b>.</p>
			</div>
			{data.partial ? (
				<p role="status" className="flex items-center gap-2 text-[12.5px] text-[var(--g-warn-text)]">
					<AlertTriangle aria-hidden className="h-3.5 w-3.5" />
					Some of this couldn’t be loaded{failed.length ? `: ${failed.join(', ')}` : ''}. What’s shown may be incomplete.
				</p>
			) : null}
			<div role="tablist" aria-label="Notifications" className="flex gap-1 border-b border-[var(--g-line)]">
				{TABS.map((t) => (
					<button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => on_tab(t.id)} className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium ${tab === t.id ? 'border-[var(--g-acc)] text-[var(--g-ink)]' : 'border-transparent text-[var(--g-ink-3)] hover:text-[var(--g-ink)]'}`}>
						{t.label}
					</button>
				))}
			</div>
			{paging && tab !== 'check' && tab !== 'custom' ? <Realm_pager data={data} paging={paging} /> : null}
			{tab === 'rules' ? <Rules_tab data={data} scope={scope} reload={reload} /> : null}
			{tab === 'channels' ? <Channels_tab data={data} scope={scope} reload={reload} /> : null}
			{tab === 'check' ? <Check_tab data={data} scope={scope} /> : null}
			{tab === 'custom' ? <Custom_tab data={data} scope={scope} /> : null}
		</div>
	);
}

export const REALMS_PER_PAGE = 10;

export function Component() {
	const overview = use_overview();
	const scope = use_view_scope(overview.data);
	// Org-wide rules always load; realm rules load one page of realms at a time (BFF pages Core's realm search).
	const [realm_q, set_realm_q] = useState('');
	const [realm_offset, set_realm_offset] = useState(0);
	const view_key = scope.kind === 'all' ? 'all' : scope.kind === 'org' ? `o:${scope.org.id}` : `r:${scope.realm.id}`;
	useEffect(() => { set_realm_offset(0); }, [view_key, realm_q]);
	const body = useMemo(() => {
		// Wait for the view to resolve so the first request is already scoped.
		if (overview.status === 'loading') return null;
		const b: Record<string, unknown> = {};
		if (scope.kind === 'org') b.org_id = scope.org.id;
		if (scope.kind === 'realm') b.realm_id = scope.realm.id;
		else { b.realm_limit = REALMS_PER_PAGE; b.realm_offset = realm_offset; if (realm_q) b.realm_q = realm_q; }
		return b;
	}, [overview.status, scope, realm_q, realm_offset]);
	const center = use_bff_read<Notification_center_data>('/v1/notification_center/get', body, { refresh_ms: 60_000, fallback_error: 'Could not load notifications.' });
	const paging: Realm_paging | null = scope.kind === 'realm' ? null : { q: realm_q, set_q: set_realm_q, offset: realm_offset, set_offset: set_realm_offset };
	const [search, set_search] = useSearchParams();
	const raw = search.get('tab');
	const tab: Tab = raw === 'channels' || raw === 'check' || raw === 'custom' ? raw : 'rules';
	const on_tab = (t: Tab) => set_search((prev) => { const p = new URLSearchParams(prev); if (t === 'rules') p.delete('tab'); else p.set('tab', t); return p; }, { replace: true });
	const view = center.data;

	return (
		<Graphite_shell
			data={overview.data}
			title="Notifications"
			actions={
				<button type="button" onClick={() => void center.reload()} aria-label="Refresh" title="Refresh" className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--g-line)] text-[var(--g-ink-3)] hover:text-[var(--g-ink)]">
					<RefreshCw className="h-3.5 w-3.5" />
				</button>
			}
		>
			<div className="px-7 py-6">
				{center.status === 'loading' ? <div className="h-[420px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading notifications" /> : null}
				{center.status === 'error' && !view ? (
					<div role="alert" className="max-w-[460px] rounded-xl border border-[var(--g-bad-line)] bg-[var(--g-bad-soft)] p-5">
						<p className="text-[14px] font-semibold">Couldn’t load notifications</p>
						<p className="mt-1 text-[13px] text-[var(--g-ink-3)]">{center.error}</p>
						<button type="button" onClick={() => void center.reload()} className="mt-3 rounded-lg border border-[var(--g-line)] px-4 py-1.5 text-[13px] font-semibold">Try again</button>
					</div>
				) : null}
				{view ? <Notifications_inner data={view} reload={center.reload} tab={tab} scope={scope} on_tab={on_tab} paging={paging} /> : null}
			</div>
		</Graphite_shell>
	);
}
