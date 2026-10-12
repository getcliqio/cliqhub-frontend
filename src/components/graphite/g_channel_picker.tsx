/**
 * Channel picker — search as you type over the channels the page already has, grouped as
 * Org channels, Realm channels and People (each person's own channel, yours first).
 *
 * An org can hold hundreds of channels (one per person, plus shared ones), so this is a
 * searchable list rather than a plain dropdown. Search matches the channel name, its realm and
 * its destinations ("slack", an address).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { Notif_channel } from '@/lib/notification_center';

type Group = 'org' | 'realm' | 'people';
const GROUP_LABEL: Record<Group, string> = { org: 'Org channels', realm: 'Realm channels', people: 'People' };

/** "sapan · you", "elan · person", "cliqhub · realm default", "Email". */
export function channel_option_label(c: Notif_channel, me_id: string | null): string {
	if (c.owner.kind === 'personal') return `${c.name} · ${c.owner.user_id && c.owner.user_id === me_id ? 'you' : 'person'}`;
	if (c.owner.kind === 'realm') return `${c.name} · realm ${c.owner.realm_slug ?? ''}`.trim();
	return c.name;
}

function group_of(c: Notif_channel): Group {
	return c.owner.kind === 'personal' ? 'people' : c.owner.kind === 'realm' ? 'realm' : 'org';
}

function matches(c: Notif_channel, q: string): boolean {
	if (!q) return true;
	const hay = [c.name, c.owner.realm_slug ?? '', ...c.destinations.map((d) => `${d.type} ${d.label}`)].join(' ').toLowerCase();
	return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export function Channel_picker({ channels, value, on_change, me_id, label = 'Channel', placeholder = 'Choose a channel…', id }: {
	channels: Notif_channel[];
	/** Selected channel id ('' for none). */
	value: string;
	on_change: (id: string) => void;
	/** The viewer, to show their own channel as "you". */
	me_id: string | null;
	label?: string;
	placeholder?: string;
	id?: string;
}) {
	const [open, set_open] = useState(false);
	const [q, set_q] = useState('');
	const [active, set_active] = useState(0);
	const box = useRef<HTMLDivElement | null>(null);
	const list = useRef<HTMLUListElement | null>(null);
	const current = channels.find((c) => c.id === value) ?? null;

	// Grouped and filtered; your own channel first among People, then by name.
	const rows = useMemo(() => {
		const order: Group[] = ['org', 'realm', 'people'];
		const mine = (c: Notif_channel) => (c.owner.user_id && c.owner.user_id === me_id ? 0 : 1);
		return channels
			.filter((c) => matches(c, q.trim()))
			.sort((a, b) => order.indexOf(group_of(a)) - order.indexOf(group_of(b)) || mine(a) - mine(b) || a.name.localeCompare(b.name));
	}, [channels, q, me_id]);

	useEffect(() => { set_active(0); }, [q, open]);
	useEffect(() => {
		if (!open) return;
		const on_down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) set_open(false); };
		document.addEventListener('mousedown', on_down);
		return () => document.removeEventListener('mousedown', on_down);
	}, [open]);
	useEffect(() => {
		list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
	}, [active]);

	function pick(c: Notif_channel) {
		on_change(c.id);
		set_open(false);
		set_q('');
	}

	function on_key(e: React.KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); set_open(false); return; }
		if (e.key === 'ArrowDown') { e.preventDefault(); set_active((i) => Math.min(i + 1, rows.length - 1)); }
		if (e.key === 'ArrowUp') { e.preventDefault(); set_active((i) => Math.max(i - 1, 0)); }
		if (e.key === 'Enter') { e.preventDefault(); const c = rows[active]; if (c) pick(c); }
	}

	return (
		<div className="relative" ref={box}>
			<button
				id={id}
				type="button"
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={() => set_open((v) => !v)}
				className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-[var(--g-line)] bg-[var(--g-bg)] px-2.5 text-left text-[13px] text-[var(--g-ink)] outline-none focus:border-[var(--g-acc-line)]"
				data-testid="channel-picker"
			>
				<span className={`min-w-0 flex-1 truncate ${current ? '' : 'text-[var(--g-ink-3)]'}`}>
					{current ? channel_option_label(current, me_id) : placeholder}
				</span>
				<ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-[var(--g-ink-3)]" />
			</button>
			{open ? (
				<div className="absolute left-0 right-0 top-10 z-[60] overflow-hidden rounded-lg border border-[var(--g-line-strong)] bg-[var(--g-pop)] shadow-[var(--g-pop-shadow)]">
					<div className="flex items-center gap-2 border-b border-[var(--g-line)] px-2.5">
						<Search aria-hidden className="h-3.5 w-3.5 text-[var(--g-ink-3)]" />
						<input
							autoFocus
							aria-label="Search channels"
							value={q}
							onChange={(e) => set_q(e.target.value)}
							onKeyDown={on_key}
							placeholder="Search channels, people, destinations…"
							className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--g-ink)] outline-none"
						/>
						<span className="shrink-0 text-[11px] text-[var(--g-ink-3)]">{rows.length} of {channels.length}</span>
					</div>
					<ul ref={list} role="listbox" aria-label={label} className="max-h-[300px] overflow-y-auto py-1">
						{rows.map((c, i) => {
							const head = i === 0 || group_of(rows[i - 1]) !== group_of(c);
							return (
								<li key={c.id} role="presentation">
									{head ? <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--g-ink-3)]">{GROUP_LABEL[group_of(c)]}</div> : null}
									<div
										role="option"
										aria-selected={c.id === value}
										data-index={i}
										onMouseEnter={() => set_active(i)}
										onMouseDown={(e) => { e.preventDefault(); pick(c); }}
										className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--g-ink)] ${i === active ? 'bg-[var(--g-soft)]' : ''}`}
									>
										<span className="min-w-0 flex-1 truncate">
											{channel_option_label(c, me_id)}
											{c.enabled ? null : <span className="ml-1.5 text-[var(--g-ink-3)]">— disabled</span>}
										</span>
										<span className="shrink-0 truncate text-[11px] text-[var(--g-ink-3)]">{c.destinations.map((d) => (d.type === 'cliqhub' ? 'in-app' : d.type)).join(' + ')}</span>
										{c.id === value ? <span className="shrink-0 text-[11px] text-[var(--g-acc)]">selected</span> : null}
									</div>
								</li>
							);
						})}
						{rows.length === 0 ? <li className="px-3 py-3 text-[12.5px] text-[var(--g-ink-3)]">{q ? 'No channels match.' : 'No channels yet.'}</li> : null}
					</ul>
				</div>
			) : null}
		</div>
	);
}
