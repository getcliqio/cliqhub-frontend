/**
 * Notifications (Graphite) — where events go, for one org or one realm.
 *
 *   Org settings › Notifications   the org's rules (the Default everywhere) and channels
 *   Realm › Settings › Notifications  each event as it stands here — Default (the org's), Paused by
 *                                  org, Replaced, Realm only or Off — plus the realm's channels and
 *                                  custom events
 *
 * Rules and channels each have an on/off switch; a rule sends only when it and its channel are on.
 * One switch per row, always in the On column: on an org row it pauses the org's rule; on a realm row
 * it means "sends in this realm" (off on a Default row turns it off here, on again goes back to Default).
 * Actions are Replace (copy the org's rule here to edit), Reset (back to Default) and Remove.
 *
 * Read: `POST /v1/notification_center/get { org_id, realm_id? }` (with a realm, `realm_events`).
 * Writes: `POST /v1/notification_center/set_rules` (rules to write, each with its own channel and
 * on/off, and rule ids to remove — one call per action); channels via the existing Core routes.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Lock, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import type { View_scope } from '@/lib/view_scope';
import {
	event_family, event_label, event_options,
	type Notif_channel, type Notif_event_rule, type Notif_event_status, type Notif_realm_event, type Notif_rule, type Notification_center_data,
} from '@/lib/notification_center';
import { use_post } from '@/components/graphite/g_agents';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Event_picker } from '@/components/graphite/g_event_picker';
import { Channel_picker } from '@/components/graphite/g_channel_picker';
import { Custom_events_panel } from '@/components/graphite/g_custom_events';
import { Built_in_messages, Channels_tab, Drawer } from '@/pages/notification_center_page';

const PRIMARY = 'inline-flex items-center gap-1.5 rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';
const LINK = 'text-[12.5px] font-semibold text-[var(--g-acc)] hover:underline disabled:opacity-40 disabled:no-underline';
const QUIET = 'text-[12.5px] text-[var(--g-ink-3)] hover:text-[var(--g-ink)] disabled:opacity-40';
/** Event · Sends to · Status · On · actions — the same columns on every row (and channel line). */
const ROW = 'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_120px_44px_84px] items-center gap-3 px-4 py-2.5';

const STATUS: Record<Notif_event_status, { label: string; cls: string }> = {
	default: { label: 'Default', cls: 'bg-[var(--g-soft)] text-[var(--g-ink-2)]' },
	paused: { label: 'Paused by org', cls: 'bg-[var(--g-bad-soft)] text-[var(--g-bad)]' },
	replaced: { label: 'Replaced', cls: 'bg-[var(--g-acc-soft)] text-[var(--g-acc)]' },
	realm_only: { label: 'Realm only', cls: 'bg-[var(--g-ok-soft,var(--g-soft))] text-[var(--g-ok)]' },
	off: { label: 'Off', cls: 'bg-[var(--g-bad-soft)] text-[var(--g-bad)]' },
};

/** An on/off switch; `locked` shows it greyed with why. */
export function Switch({ on, on_change, label, disabled = false, title }: { on: boolean; on_change: (next: boolean) => void; label: string; disabled?: boolean; title?: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={label}
			title={title}
			disabled={disabled}
			onClick={() => on_change(!on)}
			className={`relative inline-block h-[17px] w-[30px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-[var(--g-acc)]' : 'bg-[var(--g-line-strong)]'}`}
		>
			<i aria-hidden className={`absolute top-[2px] h-[13px] w-[13px] rounded-full transition-[left] ${on ? 'left-[15px] bg-white' : 'left-[2px] bg-[var(--g-ink-3)]'}`} />
		</button>
	);
}

/** A channel a rule sends to; struck through when the rule or the channel is off. */
function Chip({ name, rule_on = true, channel_on = true }: { name: string | null; rule_on?: boolean; channel_on?: boolean }) {
	const dead = !rule_on || !channel_on;
	return (
		<span className={`mr-1 inline-flex items-center rounded-md border border-[var(--g-line)] bg-[var(--g-soft)] px-1.5 py-px text-[12px] ${dead ? 'text-[var(--g-ink-3)] line-through' : ''}`} title={!channel_on ? 'This channel is off — nothing sends to it' : !rule_on ? 'Switched off' : undefined}>
			{name ?? 'unknown channel'}
		</span>
	);
}

function Status_badge({ status, via }: { status: Notif_event_status; via?: string | null }) {
	const s = STATUS[status];
	return <span className={`inline-flex w-fit whitespace-nowrap rounded-full px-2 py-px text-[11.5px] font-semibold ${s.cls}`} title={via ? `Set by this realm’s ${via} rule` : undefined} data-status={status}>{s.label}{via ? ' ·' : ''}{via ? <span className="g-mono ml-1 font-normal">{via}</span> : null}</span>;
}

function Event_name({ event }: { event: string }) {
	return (
		<div className="min-w-0">
			<b className="block truncate text-[13px] font-semibold">{event_label(event)}</b>
			<span className="g-mono block truncate text-[11px] text-[var(--g-ink-3)]">{event}</span>
		</div>
	);
}

/** Rows grouped by event family (Runs, Reviews, …), groups in order of their first row. */
function by_family<T>(rows: T[], event_of: (r: T) => string): Array<{ family: string; rows: T[] }> {
	const groups = new Map<string, T[]>();
	for (const r of rows) {
		const f = event_family(event_of(r));
		groups.set(f, [...(groups.get(f) ?? []), r]);
	}
	return [...groups.entries()].map(([family, rs]) => ({ family, rows: rs }));
}

function Group_head({ family }: { family: string }) {
	return <div role="row" className="bg-[var(--g-bg)] px-4 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">{family}</div>;
}

type Write = { items?: Array<{ event: string; channel_id: string; enabled?: boolean }>; remove?: string[] };

/**
 * Notifications for an org (`realm` null) or one realm.
 */
export function Notifications_panel({ org_id, realm }: { org_id: string; realm: { id: string; slug: string; org_slug: string } | null }) {
	const overview = use_overview();
	const body = useMemo(() => (realm ? { org_id, realm_id: realm.id } : { org_id, realm_limit: 1 }), [org_id, realm]);
	const read = use_bff_read<Notification_center_data>('/v1/notification_center/get', body, { refresh_ms: 60_000, fallback_error: 'Could not load notifications.' });
	const post = use_post();
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [busy, set_busy] = useState(false);
	const [adding, set_adding] = useState(false);
	const d = read.data;

	// The channels list (shared with the old page) works on a view scope.
	const scope = useMemo<View_scope | null>(() => {
		const org = overview.data?.orgs.find((o) => o.id === org_id) ?? null;
		if (!org) return null;
		if (!realm) return { kind: 'org', org, realm: null };
		const r = org.realms.find((x) => x.id === realm.id);
		return r ? { kind: 'realm', org, realm: r } : null;
	}, [overview.data, org_id, realm]);

	if (read.status === 'error' && !d) return <p role="alert" className="text-[13px] text-[var(--g-bad)]">{read.error}</p>;
	if (!d) return <div className="h-[320px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading notifications" />;

	const can_edit = realm ? Boolean(d.realms.find((r) => r.id === realm.id)?.can_edit) : Boolean(d.orgs.find((o) => o.id === org_id)?.can_edit);

	/** One action = one BFF call (removals first, then rule writes). */
	async function write(w: Write, done: string) {
		set_busy(true);
		set_msg(null);
		const res = await post('/v1/notification_center/set_rules', { ...(realm ? { realm_id: realm.id } : { org_id }), ...w });
		set_busy(false);
		if (!res.ok) { set_msg({ tone: 'bad', text: res.error }); return; }
		const failed = (res.data as { failed?: Array<{ event: string; error: string }> } | null)?.failed ?? [];
		set_msg(failed.length ? { tone: 'bad', text: failed.map((f) => `${event_label(f.event)}: ${f.error}`).join(' · ') } : { tone: 'ok', text: done });
		await read.reload();
	}

	const channels = d.channels.filter((c) => c.owner.kind !== 'personal' && c.owner.org_id === org_id && (c.owner.kind === 'org' || c.owner.realm_id === realm?.id));

	return (
		<div className="flex flex-col gap-4" data-testid="notifications">
			<div>
				<h2 className="text-[14px] font-semibold">Notifications</h2>
				<p className="mt-0.5 text-[12.5px] text-[var(--g-ink-3)]">
					{realm
						? <>Each event uses the org’s rule (<b className="text-[var(--g-ink-2)]">Default</b>) unless this realm replaces it, turns it off or adds its own. A rule sends only when both the rule and its channel are on.</>
						: <>Where events go for every realm in this org. A realm can replace or turn off any event for itself. A rule sends only when both the rule and its channel are on.</>}
				</p>
			</div>
			{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
			{d.partial ? <p role="status" className="text-[12px] text-[var(--g-warn-text)]">Some of this couldn’t be loaded — what’s shown may be incomplete.</p> : null}

			{realm
				? <Realm_rules rows={d.realm_events ?? []} can_edit={can_edit} busy={busy} write={write} channels={channels} on_add={() => set_adding(true)} />
				: <Org_rules rules={d.rules.filter((r) => r.scope.kind === 'org' && r.scope.org_id === org_id)} channels={d.channels} can_edit={can_edit} busy={busy} write={write} on_add={() => set_adding(true)} />}

			{scope ? (
				<section aria-label="Channels" data-testid="notif-channels">
					<h3 className="mb-2 text-[13px] font-semibold">Channels <span className="font-normal text-[var(--g-ink-3)]">{realm ? '· this realm’s own, and the org’s (managed in Org settings)' : '· usable by every realm’s rules'}</span></h3>
					{/* Only this page's channels: the org's (and, in a realm, the realm's own) — not people's personal ones. */}
					<Channels_tab data={{ ...d, channels }} scope={scope} reload={read.reload} />
				</section>
			) : null}

			{realm ? null : <Built_in_messages />}

			{realm ? (
				<section aria-label="Custom events" data-testid="notif-custom">
					<h3 className="mb-2 text-[13px] font-semibold">Custom events <span className="font-normal text-[var(--g-ink-3)]">· events your teams emit; they get rules like any other</span></h3>
					<Custom_events_panel org_id={org_id} initial={{ id: realm.id, slug: realm.slug, org_slug: realm.org_slug }} />
				</section>
			) : null}

			{adding ? (
				<Add_rule_drawer
					data={d}
					channels={channels}
					realm_rows={realm ? d.realm_events ?? [] : null}
					on_close={() => set_adding(false)}
					on_save={async (w, done) => { await write(w, done); set_adding(false); }}
				/>
			) : null}
		</div>
	);
}

function Rules_card({ title, summary, can_edit, on_add, children }: { title: string; summary: ReactNode; can_edit: boolean; on_add: () => void; children: ReactNode }) {
	return (
		<section className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label={title} data-testid="notif-rules">
			<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-2.5">
				<b className="text-[13px] font-semibold">{title}</b>
				<span className="text-[12px] text-[var(--g-ink-3)]">{summary}</span>
				{can_edit ? <button type="button" onClick={on_add} className={`${PRIMARY} ml-auto`}><Plus aria-hidden className="h-3.5 w-3.5" />Add rule</button> : null}
			</div>
			<div role="table" aria-label={title}>
				<div role="row" className={`${ROW} border-b border-[var(--g-line)] py-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--g-ink-3)]`}>
					<span role="columnheader">Event</span><span role="columnheader">Sends to</span><span role="columnheader">Status</span><span role="columnheader">On</span><span />
				</div>
				{children}
			</div>
		</section>
	);
}

/* ── Org ─────────────────────────────────────────────────────────────── */

function Org_rules({ rules, channels, can_edit, busy, write, on_add }: {
	rules: Notif_rule[]; channels: Notif_channel[]; can_edit: boolean; busy: boolean;
	write: (w: Write, done: string) => Promise<void>; on_add: () => void;
}) {
	const ch = new Map(channels.map((c) => [c.id, c]));
	const events = [...new Set(rules.map((r) => r.event))].sort();
	const of = (e: string) => rules.filter((r) => r.event === e);
	const paused = events.filter((e) => of(e).every((r) => !r.enabled)).length;
	return (
		<Rules_card title="Rules" summary={`${events.length} event${events.length === 1 ? '' : 's'}${paused ? ` · ${paused} paused` : ''}`} can_edit={can_edit} on_add={on_add}>
			{events.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">No rules yet — nothing is sent for this org’s events.</p> : null}
			{by_family(events, (e) => e).map((g) => (
				<div key={g.family} role="rowgroup">
					<Group_head family={g.family} />
					{g.rows.map((e) => {
						const rs = of(e);
						const on = rs.some((r) => r.enabled);
						const locked = rs.some((r) => r.locked);
						const editable = can_edit && !locked && !busy;
						return (
							<div key={e} className="border-b border-[var(--g-line-2)] last:border-b-0" data-testid={`org-event-${e}`}>
								<div role="row" className={ROW}>
									<Event_name event={e} />
									<div className="min-w-0">
										{rs.map((r) => <Chip key={r.id} name={r.channel_name} rule_on={r.enabled} channel_on={ch.get(r.channel_id)?.enabled ?? true} />)}
										{rs.some((r) => r.enabled && ch.get(r.channel_id)?.enabled === false) ? <span className="text-[11.5px] text-[var(--g-warn-text)]">a channel is off — it sends nothing</span> : null}
									</div>
									<span>{on ? null : <Status_badge status="paused" />}</span>
									<Switch on={on} label={`${event_label(e)} on`} disabled={!editable} title={locked ? 'Locked — always sent' : undefined}
										on_change={(next) => void write({ items: rs.map((r) => ({ event: e, channel_id: r.channel_id, enabled: next })) }, next ? `${event_label(e)} is on.` : `${event_label(e)} is paused.`)} />
									<div className="flex justify-end">
										{locked ? <span className="inline-flex items-center gap-1 text-[12px] text-[var(--g-ink-3)]" title={rs.find((r) => r.locked)?.lock_reason ?? undefined}><Lock aria-hidden className="h-3 w-3" />locked</span>
											: can_edit ? <button type="button" disabled={busy} onClick={() => void write({ remove: rs.map((r) => r.id) }, `${event_label(e)} rule removed.`)} className={QUIET}>Remove</button> : null}
									</div>
								</div>
								{rs.length > 1 ? rs.map((r) => (
									<div key={r.id} role="row" className={`${ROW} py-1 text-[12.5px]`} data-testid={`org-rule-${r.id}`}>
										<span className="pl-3 text-[var(--g-ink-3)]">↳ channel</span>
										<span><Chip name={r.channel_name} rule_on={r.enabled} channel_on={ch.get(r.channel_id)?.enabled ?? true} /></span>
										<span />
										<Switch on={r.enabled} label={`${r.channel_name ?? 'channel'} on`} disabled={!can_edit || r.locked || busy} on_change={(next) => void write({ items: [{ event: e, channel_id: r.channel_id, enabled: next }] }, 'Saved.')} />
										<div className="flex justify-end">{can_edit && !r.locked ? <button type="button" disabled={busy} onClick={() => void write({ remove: [r.id] }, 'Channel removed from the rule.')} className={QUIET}>Remove</button> : null}</div>
									</div>
								)) : null}
							</div>
						);
					})}
				</div>
			))}
		</Rules_card>
	);
}

/* ── Realm ───────────────────────────────────────────────────────────── */

/** Same channels on both sides (Off made by turning a Default row off). */
function same_channels(a: Notif_event_rule[], b: Notif_event_rule[]): boolean {
	const x = new Set(a.map((r) => r.channel_id));
	const y = new Set(b.map((r) => r.channel_id));
	return x.size === y.size && [...x].every((c) => y.has(c));
}

function Realm_rules({ rows, can_edit, busy, write, channels, on_add }: {
	rows: Notif_realm_event[]; can_edit: boolean; busy: boolean; channels: Notif_channel[];
	write: (w: Write, done: string) => Promise<void>; on_add: () => void;
}) {
	const [only_changed, set_only_changed] = useState(false);
	const [adding_to, set_adding_to] = useState<string | null>(null);
	const [pick, set_pick] = useState('');
	const { user } = useAuth();
	const count = (s: Notif_event_status) => rows.filter((r) => r.status === s && !r.via).length;
	const summary = [count('replaced') ? `${count('replaced')} replaced` : null, count('off') ? `${count('off')} off` : null, count('realm_only') ? `${count('realm_only')} realm only` : null, 'rest default'].filter(Boolean).join(' · ');
	const shown = only_changed ? rows.filter((r) => r.status !== 'default' && r.status !== 'paused') : rows;

	return (
		<Rules_card
			title="Rules"
			summary={<>{summary}<label className="ml-3 inline-flex items-center gap-1.5"><input type="checkbox" checked={only_changed} onChange={(e) => set_only_changed(e.target.checked)} />only what this realm changed</label></>}
			can_edit={can_edit}
			on_add={on_add}
		>
			{shown.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">{only_changed ? 'This realm uses the Default for every event.' : 'No rules yet — nothing is sent for this realm’s events.'}</p> : null}
			{by_family(shown, (r) => r.event).map((g) => (
				<div key={g.family} role="rowgroup">
					<Group_head family={g.family} />
					{g.rows.map((r) => {
						const own = r.realm.length > 0 && !r.via;
						const inherited = r.status === 'default' || r.status === 'paused';
						const editable = can_edit && !busy;
						// The row's switch: "sends in this realm".
						const on = r.status === 'default' || ((r.status === 'replaced' || r.status === 'realm_only') && r.realm.some((x) => x.enabled));
						const toggle = (next: boolean) => {
							if (r.status === 'default' && !next) return write({ items: r.org.map((x) => ({ event: r.event, channel_id: x.channel_id, enabled: false })) }, `${event_label(r.event)} is off in this realm.`);
							if (r.status === 'off' && next) {
								// Turned off from Default → back to Default; otherwise switch this realm's rules back on.
								return same_channels(r.realm, r.org)
									? write({ remove: r.realm.map((x) => x.rule_id) }, `${event_label(r.event)} is back to Default.`)
									: write({ items: r.realm.map((x) => ({ event: r.event, channel_id: x.channel_id, enabled: true })) }, `${event_label(r.event)} is on.`);
							}
							return write({ items: r.realm.map((x) => ({ event: r.event, channel_id: x.channel_id, enabled: next })) }, next ? `${event_label(r.event)} is on.` : `${event_label(r.event)} is off in this realm.`);
						};
						const switch_off_why = r.locked ? 'Locked by the org — always sent' : r.status === 'paused' ? 'The org paused this rule' : r.via ? `Set by this realm’s ${r.via} rule` : undefined;
						const sends = inherited ? r.org : r.realm;
						return (
							<div key={r.event} className="border-b border-[var(--g-line-2)] last:border-b-0" data-testid={`realm-event-${r.event}`}>
								<div role="row" className={ROW}>
									<Event_name event={r.event} />
									<div className={`min-w-0 ${inherited ? 'opacity-70' : ''}`}>
										{r.status === 'off' ? <span className="text-[12.5px] text-[var(--g-ink-3)]">Nothing is sent in this realm</span>
											: sends.map((x) => <Chip key={x.rule_id} name={x.channel_name} rule_on={x.enabled} channel_on={x.channel_enabled} />)}
									</div>
									<Status_badge status={r.status} via={r.via} />
									<Switch on={on} label={`${event_label(r.event)} on in this realm`} disabled={!editable || r.locked || r.status === 'paused' || Boolean(r.via)} title={switch_off_why} on_change={(next) => void toggle(next)} />
									<div className="flex justify-end">
										{r.locked ? <span className="inline-flex items-center gap-1 text-[12px] text-[var(--g-ink-3)]" title={r.org.find((x) => x.locked)?.lock_reason ?? undefined}><Lock aria-hidden className="h-3 w-3" />locked</span>
											: !can_edit || r.via ? null
												: inherited ? <button type="button" disabled={busy} onClick={() => void write({ items: r.org.map((x) => ({ event: r.event, channel_id: x.channel_id, enabled: true })) }, `${event_label(r.event)} replaced in this realm — edit its channels below.`)} className={LINK}>Replace</button>
													: r.status === 'realm_only' ? <button type="button" disabled={busy} onClick={() => void write({ remove: r.realm.map((x) => x.rule_id) }, `${event_label(r.event)} rule removed.`)} className={QUIET}>Remove</button>
														: <button type="button" disabled={busy} onClick={() => void write({ remove: r.realm.map((x) => x.rule_id) }, `${event_label(r.event)} is back to Default.`)} className={LINK} title="Back to Default: deletes this realm’s rules for the event">Reset</button>}
									</div>
								</div>
								{own && r.status === 'replaced' ? (
									<div className="bg-[color-mix(in_srgb,var(--g-acc-soft)_35%,transparent)] pb-1.5" data-testid={`realm-lines-${r.event}`}>
										{r.realm.map((x) => {
											const ch = channels.find((c) => c.id === x.channel_id);
											return (
												<div key={x.rule_id} role="row" className={`${ROW} py-1 text-[12.5px]`}>
													<span className="pl-3 text-[var(--g-ink-3)]">↳ channel</span>
													<span><Chip name={x.channel_name} rule_on={x.enabled} channel_on={x.channel_enabled} /><span className="text-[11.5px] text-[var(--g-ink-3)]">{ch?.owner.kind === 'realm' ? 'realm channel' : r.org.some((o) => o.channel_id === x.channel_id) ? 'copied from Default' : 'org channel'}</span></span>
													<span />
													<Switch on={x.enabled} label={`${x.channel_name ?? 'channel'} on`} disabled={!editable} on_change={(next) => void write({ items: [{ event: r.event, channel_id: x.channel_id, enabled: next }] }, 'Saved.')} />
													<div className="flex justify-end">{can_edit ? <button type="button" disabled={busy} onClick={() => void write({ remove: [x.rule_id] }, 'Channel removed.')} className={QUIET}>Remove</button> : null}</div>
												</div>
											);
										})}
										{can_edit ? (adding_to === r.event ? (
											<div className="flex items-center gap-2 px-4 py-1.5 pl-7">
												<div className="w-[280px]"><Channel_picker channels={channels.filter((c) => !r.realm.some((x) => x.channel_id === c.id))} value={pick} on_change={set_pick} me_id={user ? String(user.id) : null} label="Add a channel" /></div>
												<button type="button" disabled={!pick || busy} onClick={() => { void write({ items: [{ event: r.event, channel_id: pick }] }, 'Channel added.'); set_adding_to(null); set_pick(''); }} className={PRIMARY}>Add</button>
												<button type="button" onClick={() => { set_adding_to(null); set_pick(''); }} className={ROW_ACTION_CLS}>Cancel</button>
											</div>
										) : <button type="button" onClick={() => set_adding_to(r.event)} className={`${LINK} ml-7 mt-1`}>+ Add a channel</button>) : null}
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			))}
		</Rules_card>
	);
}

/* ── Add rule ────────────────────────────────────────────────────────── */

/**
 * Pick events and a channel. In a realm, an event the org already covers becomes Replaced: the org's
 * channels are copied in (on) along with the new one, so nothing is dropped without you seeing it.
 */
function Add_rule_drawer({ data, channels, realm_rows, on_close, on_save }: {
	data: Notification_center_data; channels: Notif_channel[]; realm_rows: Notif_realm_event[] | null;
	on_close: () => void; on_save: (w: Write, done: string) => Promise<void>;
}) {
	const { user } = useAuth();
	const [events, set_events] = useState<string[]>([]);
	const [channel, set_channel] = useState('');
	const [busy, set_busy] = useState(false);
	const groups = useMemo(() => event_options(data.event_types, data.rules), [data.event_types, data.rules]);
	// In a realm: events where the org's Default is in play (not yet replaced here).
	const takes_over = realm_rows ? events.map((e) => realm_rows.find((r) => r.event === e)).filter((r): r is Notif_realm_event => Boolean(r && (r.status === 'default' || r.status === 'paused') && r.org.length)) : [];
	const locked = realm_rows ? events.filter((e) => realm_rows.find((r) => r.event === e)?.locked) : [];

	async function save() {
		set_busy(true);
		const items = [
			...events.map((event) => ({ event, channel_id: channel })),
			...takes_over.flatMap((r) => r.org.filter((x) => x.channel_id !== channel).map((x) => ({ event: r.event, channel_id: x.channel_id, enabled: true }))),
		];
		await on_save({ items }, `Rule added for ${events.map(event_label).join(', ')}.`);
		set_busy(false);
	}

	return (
		<Drawer title="Add rule" label="Add rule" on_close={on_close}>
			<div>
				<span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">When</span>
				<Event_picker groups={groups} value={events} on_change={set_events} />
			</div>
			<div>
				<Channel_picker channels={channels} value={channel} on_change={set_channel} me_id={user ? String(user.id) : null} label="Send to" />
			</div>
			{takes_over.length ? (
				<p className="text-[12.5px] text-[var(--g-warn-text)]" data-testid="takes-over">
					The org already sends {takes_over.map((r) => event_label(r.event)).join(', ')}. Adding a rule here replaces it in this realm — the org’s {takes_over.flatMap((r) => r.org).length === 1 ? 'channel is' : 'channels are'} copied in (on), so you can keep or switch them off.
				</p>
			) : null}
			{locked.length ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{locked.map(event_label).join(', ')}: the org’s rule is locked and can’t be replaced in a realm.</p> : null}
			<div className="flex gap-2">
				<button type="button" disabled={!events.length || !channel || busy || locked.length > 0} onClick={() => void save()} className={PRIMARY}>{busy ? 'Adding…' : 'Add rule'}</button>
				<button type="button" onClick={on_close} className={ROW_ACTION_CLS}>Cancel</button>
			</div>
		</Drawer>
	);
}
