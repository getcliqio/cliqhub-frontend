/**
 * "Send to…" — one drawer for where something goes: an event's channels and people (each a rule), or the
 * channels and people a channel passes it on to (each a `channel_ref`). Search as you type; Channels and People
 * apart, each with Show more; a checkbox per row. What's already there starts ticked — untick to remove it.
 * Save sends what changed. Searches `POST /v1/orgs/get_reviewable_targets` (an org: its channels and members;
 * a realm: its channels, the org's, and its members). Optionally a "+ New channel" section, created in place
 * and then ticked.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useOrgFetch } from '@/lib/org_context';
import { Drawer } from '@/pages/notification_center_page';

const PAGE = 20;

type Channel_item = { id: string; name: string; level: 'realm' | 'org' };
type Person_item = { user_id: string; username: string; display_name: string | null; channel_id: string | null };
type Group<T> = { items: T[]; total: number };
const EMPTY = { items: [], total: 0 };

/** One pickable target. `key` is what the caller saves: a channel id (event rules) or a name (channel_ref). */
export interface Send_target {
	key: string;
	kind: 'channel' | 'person';
	label: string;
}

/** Something already there: its key, how it reads, and whatever the caller needs to remove it. */
export interface Send_current {
	key: string;
	label: string;
}

export function Send_to_drawer({ title, sub, org_id, realm_id, key_by, current, exclude, note, on_save, on_close, new_channel }: {
	title: string;
	sub: string;
	org_id: string;
	realm_id?: string;
	/** What a pick is saved as: `id` — a channel id / a person's personal channel (rules); `name` — channel_ref. */
	key_by: 'id' | 'name';
	/** What's already there (starts ticked). */
	current: Send_current[];
	/** Keys never offered (a channel can't pass to itself). */
	exclude?: string[];
	note?: string;
	/** Save the changes; an error to show, or null. */
	on_save: (adds: Send_target[], removes: Send_current[]) => Promise<string | null>;
	on_close: () => void;
	/** "+ New channel": render its form; call `created` with the new channel's id and name once made. */
	new_channel?: (created: (c: { id: string; name: string }) => void) => ReactNode;
}) {
	const auth_fetch = useOrgFetch();
	const [query, set_query] = useState('');
	const [channels, set_channels] = useState<Group<Channel_item>>(EMPTY);
	const [people, set_people] = useState<Group<Person_item>>(EMPTY);
	const [loading, set_loading] = useState(true);
	const [failed, set_failed] = useState(false);
	const [picked, set_picked] = useState<Map<string, Send_target>>(() => new Map(current.map((c) => [c.key, { key: c.key, kind: 'channel', label: c.label }])));
	const [creating, set_creating] = useState(false);
	const [busy, set_busy] = useState(false);
	const [error, set_error] = useState<string | null>(null);
	const [reload, set_reload] = useState(0);
	const seq = useRef(0);

	const load = useCallback(async (body: Record<string, unknown>) => {
		const res = await auth_fetch('/v1/orgs/get_reviewable_targets', {
			method: 'POST',
			body: JSON.stringify({ org_id, ...(realm_id ? { realm_id } : {}), limit: PAGE, ...body }),
		});
		const data = await res.json();
		if (!data.ok) throw new Error('load failed');
		return data.data as { channels: Group<Channel_item>; people: Group<Person_item> };
	}, [auth_fetch, org_id, realm_id]);

	// First page of both groups for the search (debounced; a newer search wins).
	useEffect(() => {
		const mine = ++seq.current;
		const t = setTimeout(async () => {
			set_loading(true);
			try {
				const d = await load({ query });
				if (mine !== seq.current) return;
				set_channels(d.channels);
				set_people(d.people);
				set_failed(false);
			} catch {
				if (mine === seq.current) set_failed(true);
			} finally {
				if (mine === seq.current) set_loading(false);
			}
		}, 200);
		return () => clearTimeout(t);
	}, [load, query, reload]);

	async function more(kind: 'channel' | 'person') {
		try {
			const d = await load({ query, kind, offset: kind === 'channel' ? channels.items.length : people.items.length });
			if (kind === 'channel') set_channels((g) => ({ items: [...g.items, ...d.channels.items], total: d.channels.total }));
			else set_people((g) => ({ items: [...g.items, ...d.people.items], total: d.people.total }));
		} catch {
			set_failed(true);
		}
	}

	const skip = useMemo(() => new Set(exclude ?? []), [exclude]);
	const channel_target = (c: Channel_item): Send_target => ({ key: key_by === 'id' ? c.id : c.name, kind: 'channel', label: c.name });
	const person_target = (p: Person_item): Send_target | null => {
		const key = key_by === 'id' ? p.channel_id : p.username;
		return key ? { key, kind: 'person', label: p.display_name || p.username } : null;
	};
	function toggle(t: Send_target) {
		set_error(null);
		set_picked((m) => {
			const next = new Map(m);
			if (next.has(t.key)) next.delete(t.key); else next.set(t.key, t);
			return next;
		});
	}

	const was = new Set(current.map((c) => c.key));
	const adds = [...picked.values()].filter((t) => !was.has(t.key));
	const removes = current.filter((c) => !picked.has(c.key));
	const changes = [adds.length && `${adds.length} to add`, removes.length && `${removes.length} to remove`].filter(Boolean).join(' · ');

	async function save() {
		set_busy(true);
		set_error(null);
		const err = await on_save(adds, removes);
		set_busy(false);
		if (err) set_error(err);
	}

	const row = (t: Send_target, inner: ReactNode) => {
		const on = picked.has(t.key);
		return (
			<button key={`${t.kind}-${t.key}`} type="button" role="option" aria-selected={on} onClick={() => toggle(t)}
				className="flex w-full items-center gap-2 border-t border-[var(--g-line-2)] px-3 py-1.5 text-left text-[12.5px] hover:bg-[var(--g-hover)]">
				<span aria-hidden className={`grid h-[15px] w-[15px] flex-none place-items-center rounded-[4px] border ${on ? 'border-[var(--g-acc)] bg-[var(--g-acc)] text-[var(--g-on-color)]' : 'border-[var(--g-ink-4)]'}`}>
					{on ? <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.2 2.2 4.8-5" /></svg> : null}
				</span>
				{inner}
			</button>
		);
	};
	const head = 'flex justify-between bg-[var(--g-head)] px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]';
	const show_more = 'w-full border-t border-[var(--g-line-2)] px-3 py-1.5 text-left text-[12px] text-[var(--g-acc)] hover:bg-[var(--g-soft)]';
	const shown_channels = channels.items.filter((c) => !skip.has(key_by === 'id' ? c.id : c.name));

	return (
		<Drawer title={title} label={title} on_close={on_close}>
			<p className="-mt-3 text-[12.5px] text-[var(--g-ink-3)]">{sub}</p>
			<div className="flex flex-col gap-2">
				<input
					type="search" aria-label="Search channels or people" placeholder="Search channels or people…" autoFocus
					value={query} onChange={(e) => set_query(e.target.value)}
					className="h-9 w-full rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-[13px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]"
				/>
				<div role="listbox" aria-label="Channels and people" aria-multiselectable="true" className="overflow-hidden rounded-md border border-[var(--g-line)]">
					{failed ? <p className="px-3 py-2 text-[12px] text-[var(--g-bad)]">Couldn’t load channels and people.</p> : null}
					{loading && !channels.items.length && !people.items.length ? <p className="px-3 py-2 text-[12px] text-[var(--g-ink-3)]">Searching…</p> : null}
					{!loading && !failed && !shown_channels.length && !people.items.length
						? <p className="px-3 py-2 text-[12px] text-[var(--g-ink-3)]">{query ? `No channel or person matches “${query}”.` : 'No channels or people yet.'}</p> : null}
					{shown_channels.length ? (
						<div data-testid="send-channels">
							<div className={head}>Channels <span className="font-medium normal-case tracking-normal">{channels.total}</span></div>
							{shown_channels.map((c) => row(channel_target(c), <>
								<span className="font-medium">{c.name}</span>
								<span className="ml-auto rounded bg-[var(--g-soft)] px-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--g-ink-3)]">{c.level}</span>
							</>))}
							{channels.items.length < channels.total ? <button type="button" onClick={() => void more('channel')} className={show_more}>Show more ({channels.total - channels.items.length})</button> : null}
						</div>
					) : null}
					{people.items.length ? (
						<div data-testid="send-people">
							<div className={head}>People <span className="font-medium normal-case tracking-normal">{people.total}</span></div>
							{people.items.map((p) => {
								const t = person_target(p);
								return t ? row(t, <>
									<span className="font-medium">{p.display_name || p.username}</span>
									<span className="g-mono text-[11px] text-[var(--g-ink-3)]">@{p.username}</span>
								</>) : null;
							})}
							{people.items.length < people.total ? <button type="button" onClick={() => void more('person')} className={show_more}>Show more ({people.total - people.items.length})</button> : null}
						</div>
					) : null}
				</div>
				{note ? <p className="text-[12px] text-[var(--g-ink-3)]">{note}</p> : null}
			</div>

			{new_channel ? (
				<div className={`rounded-md border ${creating ? 'border-[var(--g-acc-line)] bg-[var(--g-acc-soft)] p-3' : 'border-dashed border-[var(--g-line-strong)]'}`}>
					{creating ? new_channel((c) => {
						set_picked((m) => new Map(m).set(key_by === 'id' ? c.id : c.name, { key: key_by === 'id' ? c.id : c.name, kind: 'channel', label: c.name }));
						set_creating(false);
						set_reload((n) => n + 1);
					}) : <button type="button" onClick={() => set_creating(true)} className="w-full px-3 py-2.5 text-left text-[12.5px] font-medium text-[var(--g-acc)]">+ New channel</button>}
				</div>
			) : null}

			{error ? <p role="alert" className="text-[12.5px] text-[var(--g-bad)]">{error}</p> : null}
			<div className="mt-auto flex items-center gap-2 border-t border-[var(--g-line-2)] pt-3">
				<button type="button" disabled={busy || (!adds.length && !removes.length)} onClick={() => void save()}
					className="rounded-md bg-[var(--g-acc)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--g-on-color)] disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
				<button type="button" onClick={on_close} className="rounded-md border border-[var(--g-line)] px-3 py-1.5 text-[12.5px]">Cancel</button>
				<span className="ml-auto text-[12px] text-[var(--g-ink-3)]" data-testid="send-changes">{changes || 'No changes'}</span>
			</div>
		</Drawer>
	);
}
