/**
 * Searchable multi-select picker for channels and people — what a channel, run or review can name. Typing
 * searches (`POST /v1/orgs/get_reviewable_targets`); results come in two groups, Channels (the org's, and
 * the realm's own with `realm_id`) and People (the realm's members with `realm_id`, else the org's), each
 * with "Show more". A pick is a name: a person's name reaches them their way. Used by the run dialogs, the
 * HUG review page (`type: channel` inputs) and a channel's destinations.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrg, useOrgFetch } from '@/lib/org_context';

const PAGE = 20;

/** The current org's id, or undefined outside an org (a page that passes `org_id` needs no org context). */
function use_current_org_id(): string | undefined {
    try {
        return useOrg().current_id ?? undefined;
    } catch {
        return undefined;
    }
}

type Channel_item = { id: string; name: string; level: 'realm' | 'org' };
type Person_item = { user_id: string; username: string; display_name: string | null };
type Group<T> = { items: T[]; total: number };
const EMPTY = { items: [], total: 0 };

interface Props {
    /** Currently selected names (channel names / usernames). */
    selected: string[];
    /** Called when selection changes. */
    on_change: (next: string[]) => void;
    /** Placeholder when nothing is selected. */
    placeholder?: string;
    /** Additional CSS class on the outermost wrapper. */
    class_name?: string;
    /** The realm: its own channels and its members (else the org's channels and members). */
    realm_id?: string;
    /** The org to search (defaults to the current org). */
    org_id?: string;
    /** Names already in use (e.g. a channel's destinations): listed as added, not pickable. */
    taken?: string[];
}

export function ChannelUserPicker({ selected, on_change, placeholder, class_name, realm_id, org_id, taken = [] }: Props) {
    const auth_fetch = useOrgFetch();
    const org = org_id ?? use_current_org_id();
    const [query, set_query] = useState('');
    const [channels, set_channels] = useState<Group<Channel_item>>(EMPTY);
    const [people, set_people] = useState<Group<Person_item>>(EMPTY);
    const [loading, set_loading] = useState(false);
    const [failed, set_failed] = useState(false);
    const [open, set_open] = useState(false);
    const wrapper_ref = useRef<HTMLDivElement>(null);
    const input_ref = useRef<HTMLInputElement>(null);
    /** Debounce handle for search-as-you-type; a newer search wins over a slower older one. */
    const debounce_ref = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seq = useRef(0);

    const load = useCallback(async (body: Record<string, unknown>) => {
        const res = await auth_fetch('/v1/orgs/get_reviewable_targets', {
            method: 'POST',
            body: JSON.stringify({ org_id: org, ...(realm_id ? { realm_id } : {}), limit: PAGE, ...body }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error('load failed');
        return data.data as { channels: Group<Channel_item>; people: Group<Person_item> };
    }, [auth_fetch, org, realm_id]);

    /** First page of both groups for a search, debounced. */
    const search = useCallback((text: string) => {
        if (debounce_ref.current) clearTimeout(debounce_ref.current);
        debounce_ref.current = setTimeout(async () => {
            const mine = ++seq.current;
            set_loading(true);
            try {
                const d = await load({ query: text });
                if (mine !== seq.current) return;
                set_channels(d.channels);
                set_people(d.people);
                set_failed(false);
            } catch {
                if (mine !== seq.current) return;
                set_channels(EMPTY);
                set_people(EMPTY);
                set_failed(true);
            } finally {
                if (mine === seq.current) set_loading(false);
            }
        }, 200);
    }, [load]);

    /** The next page of one group. */
    async function more(kind: 'channel' | 'person') {
        try {
            const d = await load({ query, kind, offset: kind === 'channel' ? channels.items.length : people.items.length });
            if (kind === 'channel') set_channels((g) => ({ items: [...g.items, ...d.channels.items], total: d.channels.total }));
            else set_people((g) => ({ items: [...g.items, ...d.people.items], total: d.people.total }));
        } catch {
            set_failed(true);
        }
    }

    useEffect(() => {
        if (open) search(query);
    }, [open, query]); // eslint-disable-line react-hooks/exhaustive-deps

    /** Close the list when clicking outside. */
    useEffect(() => {
        function handle_click(e: MouseEvent) {
            if (wrapper_ref.current && !wrapper_ref.current.contains(e.target as Node)) set_open(false);
        }
        document.addEventListener('mousedown', handle_click);
        return () => document.removeEventListener('mousedown', handle_click);
    }, []);

    const used = new Set([...selected, ...taken].map((n) => n.toLowerCase()));
    function pick(name: string) {
        if (!used.has(name.toLowerCase())) on_change([...selected, name]);
        set_query('');
        input_ref.current?.focus();
    }

    const row = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px]';
    const head = 'px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--g-ink-3)]';
    const show_more = 'w-full px-3 py-1.5 text-left text-[12px] text-[var(--g-acc)] hover:bg-[var(--g-soft)]';
    const nothing = !loading && channels.total === 0 && people.total === 0;

    return (
        <div ref={wrapper_ref} className={`relative ${class_name ?? ''}`}>
            <div
                className="flex min-h-[36px] flex-wrap items-center gap-1 rounded-md border border-[var(--g-line)] bg-[var(--g-panel)] px-2 py-1 text-[12.5px] focus-within:border-[var(--g-acc-line)]"
                onClick={() => { set_open(true); input_ref.current?.focus(); }}
            >
                {selected.map((val) => (
                    <span key={val} className="inline-flex items-center gap-1 rounded bg-[var(--g-acc-soft)] px-2 py-0.5 text-[12px] font-medium text-[var(--g-ink)]">
                        {val}
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); on_change(selected.filter((v) => v !== val)); }}
                            className="ml-0.5 text-[var(--g-ink-3)] hover:text-[var(--g-ink)]"
                            aria-label={`Remove ${val}`}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <input
                    ref={input_ref}
                    type="text"
                    role="combobox"
                    aria-expanded={open}
                    aria-label={placeholder ?? 'Search channels or people'}
                    value={query}
                    onChange={(e) => set_query(e.target.value)}
                    onFocus={() => set_open(true)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); set_open(false); } }}
                    placeholder={selected.length === 0 ? (placeholder ?? 'Search channels or people…') : ''}
                    className="min-w-[80px] flex-1 border-0 bg-transparent p-1 outline-none"
                />
            </div>

            {open ? (
                <div role="listbox" aria-label="Channels and people" aria-multiselectable="true" className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-[var(--g-line)] bg-[var(--g-head)] shadow-lg">
                    {failed ? <p className="px-3 py-2 text-[12px] text-[var(--g-bad)]">Couldn’t load channels and people.</p> : null}
                    {loading && !channels.items.length && !people.items.length ? <p className="px-3 py-2 text-[12px] text-[var(--g-ink-3)]">Searching…</p> : null}
                    {nothing && !failed ? <p className="px-3 py-2 text-[12px] text-[var(--g-ink-3)]">{query ? `No channel or person matches “${query}”.` : 'No channels or people yet.'}</p> : null}
                    {channels.items.length ? (
                        <div data-testid="picker-channels">
                            <div className={head}>Channels</div>
                            {channels.items.map((c) => {
                                const added = used.has(c.name.toLowerCase());
                                return (
                                    <button key={c.id} type="button" role="option" aria-selected={added} disabled={added} onClick={() => pick(c.name)} className={`${row} ${added ? 'text-[var(--g-ink-4)]' : 'hover:bg-[var(--g-soft)]'}`}>
                                        <span className="font-medium">{c.name}</span>
                                        <span className="rounded bg-[var(--g-soft)] px-1.5 text-[10.5px] text-[var(--g-ink-3)]">{c.level === 'realm' ? 'realm' : 'org'}</span>
                                        {added ? <span className="ml-auto text-[11px]">added</span> : null}
                                    </button>
                                );
                            })}
                            {channels.items.length < channels.total ? <button type="button" onClick={() => void more('channel')} className={show_more}>Show more ({channels.total - channels.items.length})</button> : null}
                        </div>
                    ) : null}
                    {people.items.length ? (
                        <div data-testid="picker-people">
                            <div className={head}>People</div>
                            {people.items.map((p) => {
                                const added = used.has(p.username.toLowerCase());
                                return (
                                    <button key={p.user_id} type="button" role="option" aria-selected={added} disabled={added} onClick={() => pick(p.username)} className={`${row} ${added ? 'text-[var(--g-ink-4)]' : 'hover:bg-[var(--g-soft)]'}`}>
                                        <span className="font-medium">{p.display_name || p.username}</span>
                                        <span className="g-mono text-[11px] text-[var(--g-ink-3)]">@{p.username}</span>
                                        <span className="ml-auto text-[11px] text-[var(--g-ink-3)]">{added ? 'added' : 'their way'}</span>
                                    </button>
                                );
                            })}
                            {people.items.length < people.total ? <button type="button" onClick={() => void more('person')} className={show_more}>Show more ({people.total - people.items.length})</button> : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
