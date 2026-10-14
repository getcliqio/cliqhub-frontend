/**
 * Notification pieces shared by Org settings › Notifications and a realm's Settings › Notifications
 * (components/graphite/g_notifications.tsx): the channels list with its details panel and the New
 * channel drawer, the side-panel Drawer, and the built-in messages list. Channel writes are the
 * existing Core routes (notification_channels create/update/remove/test).
 *
 * The route `/notifications` (the old Events page) now redirects to where notifications live.
 */
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { Lock, Plus, X } from 'lucide-react';
import { useAuth, useAuthFetch } from '@/lib/auth_context';
import { use_overview } from '@/lib/overview';
import { api_message } from '@/lib/use_bff_read';
import type { View_scope } from '@/lib/view_scope';
import {
	can_edit_channel,
	can_edit_org_channels,
	can_edit_realm,
	event_label,
	scope_text,
	type Notif_channel,
	type Notif_scope_kind,
	type Notification_center_data,
} from '@/lib/notification_center';
import { ROW_ACTION_CLS } from '@/components/graphite/g_kinds';
import { Realm_picker, type Picked_realm } from '@/components/graphite/g_realm_picker';
import { ROW_OPENS, use_row_open } from '@/components/graphite/g_row';

const INPUT = 'h-9 w-full rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[13px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]';
const PRIMARY = 'rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-acc)] hover:bg-[var(--g-acc-hover)] disabled:opacity-50';
const LABEL = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]';

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */

const TAG_STYLE: Record<Notif_scope_kind | 'personal', { fg: string; bg: string; word: string }> = {
	org: { fg: 'var(--g-ink-2)', bg: 'var(--g-soft)', word: 'org' },
	realm: { fg: 'var(--g-run-text)', bg: 'rgba(91,157,255,.12)', word: 'realm' },
	personal: { fg: 'var(--g-ink-2)', bg: 'var(--g-soft)', word: 'person' },
};

export function Scope_tag({ kind, text }: { kind: Notif_scope_kind | 'personal'; text: string; org?: { slug: string; display_name: string } | null }) {
	// One org at a time: the org is the page's context, so the tag names only the level.
	const t = TAG_STYLE[kind];
	return (
		<span className="inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px]" style={{ color: t.fg, background: t.bg }} data-scope={kind}>
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

/**
 * Invite and account messages CliqHub always sends to the people involved. They are built in,
 * not rules: nothing here can be turned off or redirected.
 */
const BUILT_IN_MESSAGES: Array<{ what: string; to: string; how: string }> = [
	{ what: 'Invite sent, invite reminder', to: 'The invited person', how: 'Email · in-app once they have an account' },
	{ what: 'Invite accepted, declined or expired', to: 'Who sent the invite, and the org’s owners', how: 'Email · in-app' },
	{ what: 'Org never claimed by its owner', to: 'Who sent the owner invite', how: 'In-app' },
	{ what: 'New account: set your password', to: 'The person', how: 'Email' },
	{ what: 'Password reset, password changed', to: 'The person', how: 'Email · in-app' },
];

export function Built_in_messages() {
	return (
		<section aria-label="Built-in messages" className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-panel)]" data-testid="built-in-messages">
			<div className="border-b border-[var(--g-line)] px-4 py-2.5">
				<b className="text-[13px] font-semibold">Built-in messages</b>
				<span className="ml-2 text-[12px] text-[var(--g-ink-3)]">Always sent to the people involved — not rules, nothing to set up.</span>
			</div>
			<table className="w-full text-left text-[12.5px]">
				<tbody>
					{BUILT_IN_MESSAGES.map((m) => (
						<tr key={m.what} className="border-b border-[var(--g-line-2)] last:border-b-0">
							<td className="px-4 py-2 font-medium">{m.what}</td>
							<td className="px-4 py-2 text-[var(--g-ink-2)]">{m.to}</td>
							<td className="px-4 py-2 text-[var(--g-ink-3)]">{m.how}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
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

/** Channels that belong in the current view. Realm view includes the org's channels. */
export function in_view_channel(c: Notif_channel, scope: View_scope): boolean {
	if (scope.kind === 'all') return true;
	if (scope.kind === 'org') return c.owner.org_id === scope.org.id;
	return c.owner.org_id === scope.realm.org_id && (c.owner.kind !== 'realm' || c.owner.realm_id === scope.realm.id);
}

export function Drawer({ title, on_close, children, label }: { title: string; on_close: () => void; children: React.ReactNode; label: string }) {
	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-[var(--g-backdrop)]" role="dialog" aria-label={label} onMouseDown={(e) => { if (e.target === e.currentTarget) on_close(); }}>
			<div className="flex h-full w-[560px] max-w-full flex-col gap-5 overflow-y-auto border-l border-[var(--g-line-strong)] bg-[var(--g-panel)] px-7 py-6 shadow-[var(--g-drawer-shadow)]">
				<div className="flex items-center">
					<h2 className="text-[18px] font-semibold">{title}</h2>
					<button type="button" onClick={on_close} aria-label="Close" className="ml-auto text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"><X className="h-4 w-4" /></button>
				</div>
				{children}
			</div>
		</div>
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

export function Channels_tab({ data, scope, reload, realm_filter }: { data: Notification_center_data; scope: View_scope; reload: () => Promise<void>; realm_filter?: React.ReactNode }) {
	const { user } = useAuth();
	const me_id = user ? String(user.id) : null;
	const row = use_row_open();
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
				<div className="flex flex-wrap items-center gap-2">
					{realm_filter}
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
										{...row({ on_open: () => { set_open_id(c.id); set_msg(null); set_confirm_delete(false); } })}
										className={`border-b border-[var(--g-line-2)] last:border-b-0 ${ROW_OPENS} ${open_id === c.id ? 'bg-[var(--g-soft)]' : ''}`}
										data-testid={`channel-${c.id}`}
									>
										<td className="px-4 py-2.5">
											<button type="button" className="text-left font-semibold hover:underline" onClick={() => { set_open_id(c.id); set_msg(null); set_confirm_delete(false); }}>{c.name}</button>
											{c.locked ? <span title={c.lock_reason ?? 'Built in'}><Lock aria-label="Built in" className="ml-1.5 inline h-3 w-3 text-[var(--g-ink-3)]" /></span> : null}
											{c.enabled ? null : <span className="ml-2 rounded bg-[var(--g-soft)] px-1.5 text-[10.5px] text-[var(--g-ink-3)]">disabled</span>}
										</td>
										<td className="px-4 py-2.5">
											<Scope_tag kind={c.owner.kind} text={c.owner.kind === 'realm' ? c.owner.realm_slug ?? '' : c.owner.kind === 'org' ? org_by_id.get(c.owner.org_id)?.display_name ?? c.owner.org_slug : c.owner.user_id && c.owner.user_id === me_id ? 'you' : ''} org={c.owner.kind === 'personal' ? null : org_by_id.get(c.owner.org_id)} />
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

			<aside className="rounded-[10px] border border-[var(--g-line)] bg-[var(--g-head)] p-5" aria-label="Channel details">
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
									<button type="button" onClick={async () => { if (await act('/v1/notification_channels/remove', { id: open.id }, 'Channel deleted.')) set_open_id(null); }} className="rounded-md bg-[var(--g-bad)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-color)]">Delete channel</button>
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
						<button key={k} type="button" role="radio" aria-checked={owner === k} disabled={k === 'org' && !can_edit_org_channels(data, org_id)} title={k === 'org' && !can_edit_org_channels(data, org_id) ? 'Needs org owner or admin' : undefined} onClick={() => set_owner(k)} className={`rounded-lg border px-3 py-2.5 text-left text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${owner === k ? 'border-[var(--g-acc)] bg-[var(--g-acc-soft)]' : 'border-[var(--g-line)]'}`}>{l}</button>
					))}
				</div>
				<div className="mt-2 grid gap-2">
					{view_org_id ? null : <select aria-label="Org" value={org_id} onChange={(e) => { const id = e.target.value; set_org_id(id); set_realm(first_realm(id)); if (!can_edit_org_channels(data, id)) set_owner('realm'); }} className={INPUT}>
						{ok_orgs.map((o) => <option key={o.id} value={o.id} disabled={!org_usable(o.id)}>{o.display_name}{org_usable(o.id) ? '' : ` — ${o.role}, view only`}</option>)}
					</select>}
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

/**
 * `/notifications` — the old Events page. Notifications now live where they apply: a realm's under
 * its Settings › Notifications, the org's under Org settings › Notifications. Old links
 * (`?org=`, `?realm=` id or slug, `?channel=`) land there.
 */
export function Component() {
	const overview = use_overview();
	const [params] = useSearchParams();
	const data = overview.data;
	if (!data) return overview.status === 'error' ? <Navigate to="/home" replace /> : null;
	const realm_param = params.get('realm');
	const org_param = params.get('org');
	const realms = data.orgs.flatMap((o) => o.realms);
	const realm = realm_param ? realms.find((r) => r.id === realm_param) ?? realms.find((r) => r.slug === realm_param && (!org_param || r.org_slug === org_param)) : undefined;
	const keep = params.get('channel') ? `&channel=${encodeURIComponent(params.get('channel')!)}` : '';
	if (realm) return <Navigate to={`/o/${encodeURIComponent(realm.org_slug)}/realms/${encodeURIComponent(realm.slug)}/settings?section=notifications${keep}`} replace />;
	const org = (org_param ? data.orgs.find((o) => o.slug === org_param || o.id === org_param) : undefined) ?? data.orgs.find((o) => o.role === 'owner' || o.role === 'admin') ?? data.orgs[0];
	if (!org) return <Navigate to="/home" replace />;
	return <Navigate to={`/orgs/${encodeURIComponent(org.id)}?tab=notifications${keep}`} replace />;
}
