/**
 * Notifications (Graphite) — Events and Channels, for one org or one realm (PLAN-notifications-v2 D).
 *
 *   Events     every event, grouped (Runs, Phases, Reviews, …), including ones sent nowhere. Each row: the
 *              channels it goes to (chips, ✕ to remove), + channel to add one, and an on/off switch.
 *              In a realm, the org's channels show read-only ("org") — they apply in every realm — and the
 *              realm adds its own. Rows CliqHub fixes (e.g. Unknown channel) are locked.
 *   Channels   the channels you can send to (the org's; in a realm, its own and the org's).
 *
 * The org's channels for an event and a realm's own both get it (PLAN-notifications-v2 B1). A channel on
 * an event sends only while it and the event's switch are on.
 *
 * Read: `POST /v1/notification_center/get { org_id, realm_id? }` (`events`).
 * Writes: `POST /v1/notification_center/set_rules` (channels to add or switch, each with its on/off, and
 * ids to remove — one call per action); channels via the existing Core routes.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Lock, X } from 'lucide-react';
import { use_overview } from '@/lib/overview';
import { use_bff_read } from '@/lib/use_bff_read';
import type { View_scope } from '@/lib/view_scope';
import {
	event_family, event_label,
	type Notif_event_group, type Notif_event_row, type Notif_event_rule, type Notification_center_data,
} from '@/lib/notification_center';
import { use_post } from '@/components/graphite/g_agents';
import { Custom_events_panel } from '@/components/graphite/g_custom_events';
import { Channels_tab, New_channel_form } from '@/pages/notification_center_page';
import { Send_to_drawer } from '@/components/graphite/g_send_to';
import { Switch } from '@/components/graphite/g_switch';

export { Switch };

const LINK = 'text-[12.5px] font-semibold text-[var(--g-acc)] hover:underline disabled:opacity-40 disabled:no-underline';
/** Event · Goes to · On · + channel — the same columns on every row. */
const ROW = 'grid grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_44px_92px] items-center gap-3 px-4 py-2.5';

/** Which part of Notifications is shown. */
export type Notif_view = 'events' | 'channels';

/**
 * A channel an event goes to; struck through when it or the event's switch is off. `org` marks the
 * org's channel in a realm (read-only there); a wildcard notes it covers the whole family.
 */
function Chip({ r, event, org = false, busy = false, on_remove }: { r: Notif_event_rule; event: string; org?: boolean; busy?: boolean; on_remove?: () => void }) {
	const dead = !r.enabled || !r.channel_enabled;
	const wide = r.selector !== event;
	const why = !r.channel_enabled ? 'This channel is off — nothing sends to it'
		: !r.enabled ? 'Switched off'
			: wide ? `Set for ${event_label(r.selector).toLowerCase()}s` : org ? 'The org’s — applies in every realm' : undefined;
	return (
		<span
			className={`mb-1 mr-1 inline-flex items-center gap-1 rounded-md border border-[var(--g-line)] bg-[var(--g-soft)] px-1.5 py-px text-[12px] ${dead ? 'text-[var(--g-ink-3)] line-through' : ''} ${org ? 'opacity-75' : ''}`}
			title={why}
			data-testid="event-chip"
		>
			{r.locked ? <Lock aria-hidden className="h-3 w-3" /> : null}
			{r.channel_name ?? 'unknown channel'}
			{org ? <span className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--g-ink-3)]">org</span> : null}
			{wide ? <span className="g-mono text-[10.5px] text-[var(--g-ink-3)]">{r.selector}</span> : null}
			{on_remove ? (
				<button type="button" onClick={on_remove} disabled={busy} aria-label={`Remove ${r.channel_name ?? 'channel'} from ${event_label(event)}`} className="-mr-0.5 rounded p-px text-[var(--g-ink-3)] hover:bg-[var(--g-line)] hover:text-[var(--g-ink)]">
					<X aria-hidden className="h-3 w-3" />
				</button>
			) : null}
		</span>
	);
}

function Event_name({ event }: { event: string }) {
	return (
		<div className="min-w-0">
			<b className="block truncate text-[13px] font-semibold">{event_label(event)}</b>
			<span className="g-mono block truncate text-[11px] text-[var(--g-ink-3)]">{event}</span>
		</div>
	);
}

/**
 * A family's heading, with the rules set for the whole family (`run.*` — "Any run event"): this level's with ✕
 * and a switch, the org's (in a realm) read-only. Each event row below shows them greyed, "set for any … event".
 */
function Group_head({ group, in_realm, can_edit, busy, write }: {
	group: Notif_event_group; in_realm: boolean; can_edit: boolean; busy: boolean; write: (w: Write, done: string) => Promise<void>;
}) {
	const selector = `${group.family}.*`;
	const mine = (in_realm ? group.family_rules?.realm : group.family_rules?.org) ?? [];
	const org = in_realm ? group.family_rules?.org ?? [] : [];
	const label = event_label(selector);
	return (
		<div role="row" className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[var(--g-bg)] px-4 pb-1 pt-2.5" data-testid={`family-${group.family}`}>
			<span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">{event_family(`${group.family}.x`)}</span>
			{mine.length + org.length ? (
				<span className="flex min-w-0 flex-wrap items-center gap-1 text-[12px]">
					<span className="text-[var(--g-ink-3)]">{label} →</span>
					{org.map((x) => <Chip key={x.rule_id} r={x} event={selector} org />)}
					{mine.map((x) => (
						<Chip key={x.rule_id} r={x} event={selector} busy={busy} on_remove={can_edit && !x.locked ? () => void write({ remove: [x.rule_id] }, `${x.channel_name ?? 'Channel'} no longer gets ${label.toLowerCase()}.`) : undefined} />
					))}
					{mine.length ? (
						<Switch
							on={mine.some((x) => x.enabled)}
							label={`${label} on`}
							disabled={!can_edit || busy}
							on_change={(next) => void write({ items: mine.map((x) => ({ event: selector, channel_id: x.channel_id, enabled: next })) }, next ? `${label} is on.` : `${label} is off.`)}
						/>
					) : null}
				</span>
			) : null}
		</div>
	);
}

type Write = { items?: Array<{ event: string; channel_id: string; enabled?: boolean }>; remove?: string[] };

/**
 * Notifications for an org (`realm` null) or one realm: its Events or its Channels.
 */
export function Notifications_panel({ org_id, realm, view = 'events' }: { org_id: string; realm: { id: string; slug: string; org_slug: string } | null; view?: Notif_view }) {
	const overview = use_overview();
	const body = useMemo(() => (realm ? { org_id, realm_id: realm.id } : { org_id, realm_limit: 1 }), [org_id, realm]);
	const read = use_bff_read<Notification_center_data>('/v1/notification_center/get', body, { refresh_ms: 60_000, fallback_error: 'Could not load notifications.' });
	const post = use_post();
	const [msg, set_msg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
	const [busy, set_busy] = useState(false);
	const d = read.data;

	// The channels list (shared with the old page) works on a view scope.
	const scope = useMemo<Exclude<View_scope, { kind: 'all' }> | null>(() => {
		const org = overview.data?.orgs.find((o) => o.id === org_id) ?? null;
		if (!org) return null;
		if (!realm) return { kind: 'org', org, realm: null };
		const r = org.realms.find((x) => x.id === realm.id);
		return r ? { kind: 'realm', org, realm: r } : null;
	}, [overview.data, org_id, realm]);

	if (read.status === 'error' && !d) return <p role="alert" className="text-[13px] text-[var(--g-bad)]">{read.error}</p>;
	if (!d) return <div className="h-[320px] animate-pulse rounded-[10px] bg-[var(--g-panel)]" aria-busy="true" aria-label="Loading notifications" />;

	const can_edit = realm ? Boolean(d.realms.find((r) => r.id === realm.id)?.can_edit) : Boolean(d.orgs.find((o) => o.id === org_id)?.can_edit);

	/** One action = one BFF call (removals first, then the channels to add or switch). */
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

	// The channels this page can send to: the org's, and in a realm its own — not people's personal ones.
	const channels = d.channels.filter((c) => c.owner.kind !== 'personal' && c.owner.org_id === org_id && (c.owner.kind === 'org' || c.owner.realm_id === realm?.id));

	return (
		<div className="flex flex-col gap-4" data-testid="notifications">
			<div>
				<h2 className="text-[14px] font-semibold">{view === 'events' ? 'Events' : 'Channels'}</h2>
				<p className="mt-0.5 text-[12.5px] text-[var(--g-ink-3)]">
					{view === 'channels'
						? (realm ? <>Where this realm’s events can go: its own channels and the org’s.</> : <>Where this org’s events can go. Every realm can send to them too.</>)
						: realm
							? <>Where each event goes in this realm. The org’s channels (marked <b className="text-[var(--g-ink-2)]">org</b>) apply in every realm; add this realm’s own as well.</>
							: <>Where each event goes, for every realm in this org. A realm can add channels of its own.</>}
				</p>
			</div>
			{msg ? <p role={msg.tone === 'bad' ? 'alert' : 'status'} className={`text-[12.5px] ${msg.tone === 'bad' ? 'text-[var(--g-bad)]' : 'text-[var(--g-ok)]'}`}>{msg.text}</p> : null}
			{d.partial ? <p role="status" className="text-[12px] text-[var(--g-warn-text)]">Some of this couldn’t be loaded — what’s shown may be incomplete.</p> : null}

			{view === 'events' ? (
				<>
					<Events
						groups={d.events ?? []} in_realm={Boolean(realm)} can_edit={can_edit} busy={busy} write={write}
						send_to={(r, mine, close) => (
							<Send_to_drawer
								title={`${event_label(r.event)} goes to…`}
								sub={realm ? `Realm ${realm.slug} · ${r.event}` : `${scope?.org?.display_name ?? 'This org'} · every realm · ${r.event}`}
								org_id={org_id} realm_id={realm?.id} key_by="id"
								current={mine.map((x) => ({ key: x.channel_id, label: x.channel_name ?? 'channel' }))}
								note={realm
									? 'This realm’s channels and the org’s, and this realm’s members. A person gets it in-app and however they chose in their Settings.'
									: 'The org’s channels and its members. A realm’s own channels are chosen on that realm’s Events. A person gets it in-app and however they chose in their Settings.'}
								on_close={close}
								on_save={async (adds, removes) => {
									close();
									const rule_of = (key: string) => mine.find((x) => x.channel_id === key)!.rule_id;
									await write(
										{ items: adds.map((t) => ({ event: r.event, channel_id: t.key })), remove: removes.map((c) => rule_of(c.key)) },
										`${event_label(r.event)}: ${[adds.length && `${adds.length} added`, removes.length && `${removes.length} removed`].filter(Boolean).join(', ')}.`,
									);
									return null;
								}}
								new_channel={scope ? (created) => (
									<New_channel_form data={d} scope={scope} on_cancel={() => {}} on_saved={(c) => { if (c) created(c); }} />
								) : undefined}
							/>
						)}
					/>
					{realm ? (
						<section aria-label="Custom events" data-testid="notif-custom">
							<h3 className="mb-2 text-[13px] font-semibold">Custom events <span className="font-normal text-[var(--g-ink-3)]">· events your teams emit; send them anywhere like any other</span></h3>
							<Custom_events_panel org_id={org_id} initial={{ id: realm.id, slug: realm.slug, org_slug: realm.org_slug }} />
						</section>
					) : null}
				</>
			) : scope ? (
				<section aria-label="Channels" data-testid="notif-channels">
					{/* The org lists its own channels; a realm, its own and the org's — each next to the events that use them. */}
					<Channels_tab data={{ ...d, channels }} scope={scope} reload={read.reload} />
				</section>
			) : null}
		</div>
	);
}

/* ── Events ──────────────────────────────────────────────────────────── */

/**
 * Every event, grouped. A row's own channels are the ones set for exactly that event at this level (the
 * org's in an org; the realm's own in a realm): those get ✕ and the switch. A channel set for the whole
 * family (`run.*`) or, in a realm, by the org shows read-only.
 */
function Events({ groups, in_realm, can_edit, busy, write, send_to }: {
	groups: Notif_event_group[]; in_realm: boolean; can_edit: boolean; busy: boolean;
	write: (w: Write, done: string) => Promise<void>;
	/** The "Send to…" drawer for an event: this level's own rules for it, and how to close it. */
	send_to: (row: Notif_event_row, mine: Notif_event_rule[], close: () => void) => ReactNode;
}) {
	const [editing, set_editing] = useState<Notif_event_row | null>(null);
	const rows = groups.flatMap((g) => g.events);
	const sent = rows.filter((r) => r.sent).length;
	const own = (r: Notif_event_row) => (in_realm ? r.realm : r.org).filter((x) => x.selector === r.event && !x.locked);

	return (
		<section className="overflow-hidden rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" aria-label="Events" data-testid="notif-events">
			<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-4 py-2.5">
				<b className="text-[13px] font-semibold">Events</b>
				<span className="text-[12px] text-[var(--g-ink-3)]">{rows.length} event{rows.length === 1 ? '' : 's'} · {sent} sent somewhere</span>
			</div>
			<div role="table" aria-label="Events">
				<div role="row" className={`${ROW} border-b border-[var(--g-line)] py-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--g-ink-3)]`}>
					<span role="columnheader">Event</span><span role="columnheader">Goes to</span><span role="columnheader">On</span><span />
				</div>
				{rows.length === 0 ? <p className="px-4 py-8 text-center text-[13px] text-[var(--g-ink-3)]">No events to show.</p> : null}
				{groups.map((g) => (
					<div key={g.family} role="rowgroup">
						<Group_head group={g} in_realm={in_realm} can_edit={can_edit} busy={busy} write={write} />
						{g.events.map((r) => (
							<Event_row key={r.event} row={r} in_realm={in_realm} can_edit={can_edit} busy={busy} write={write} on_edit={() => set_editing(r)} />
						))}
					</div>
				))}
			</div>
			{editing ? send_to(editing, own(editing), () => set_editing(null)) : null}
		</section>
	);
}

function Event_row({ row, in_realm, can_edit, busy, write, on_edit }: {
	row: Notif_event_row; in_realm: boolean; can_edit: boolean; busy: boolean;
	write: (w: Write, done: string) => Promise<void>; on_edit: () => void;
}) {
	const e = row.event;
	// This level's channels for exactly this event: what ✕ and the switch act on.
	const mine = (in_realm ? row.realm : row.org).filter((x) => x.selector === e);
	const others = [...(in_realm ? row.org : []), ...(in_realm ? row.realm : row.org).filter((x) => x.selector !== e)];
	const on = mine.some((x) => x.enabled);
	const editable = can_edit && !row.fixed;
	return (
		<div className="border-b border-[var(--g-line-2)] last:border-b-0" data-testid={`event-${e}`}>
			<div role="row" className={ROW}>
				<Event_name event={e} />
				<div className="min-w-0">
					{others.map((x) => <Chip key={x.rule_id} r={x} event={e} org={in_realm && x.tier === 'org'} />)}
					{mine.map((x) => (
						<Chip key={x.rule_id} r={x} event={e} busy={busy} on_remove={editable && !x.locked ? () => void write({ remove: [x.rule_id] }, `${x.channel_name ?? 'Channel'} no longer gets ${event_label(e)}.`) : undefined} />
					))}
					{!row.sent && mine.length + others.length === 0 ? <span className="text-[12.5px] text-[var(--g-ink-3)]">Not sent</span> : null}
				</div>
				{mine.length ? (
					<Switch
						on={on}
						label={`${event_label(e)} on`}
						disabled={!editable || busy}
						title={row.fixed ? 'Fixed — always sent' : undefined}
						on_change={(next) => void write({ items: mine.map((x) => ({ event: e, channel_id: x.channel_id, enabled: next })) }, next ? `${event_label(e)} is on.` : `${event_label(e)} is off${in_realm && row.org.length ? ' here (the org’s channels still get it)' : ''}.`)}
					/>
				) : <span />}
				<div className="flex justify-end">
					{row.fixed
						? <span className="inline-flex items-center gap-1 text-[12px] text-[var(--g-ink-3)]" title={[...row.org, ...row.realm].find((x) => x.locked)?.lock_reason ?? undefined}><Lock aria-hidden className="h-3 w-3" />fixed</span>
						: can_edit ? <button type="button" onClick={on_edit} className={LINK} aria-label={`${mine.length ? 'Edit where' : 'Choose where'} ${event_label(e)} goes`}>{mine.length ? 'Edit' : '+ add'}</button> : null}
				</div>
			</div>
		</div>
	);
}
