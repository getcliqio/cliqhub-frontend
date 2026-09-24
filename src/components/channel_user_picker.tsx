/**
 * Searchable multi-select picker for reviewer targets — org members
 * (usernames) and notification channels. Fetches from
 * `POST /v1/orgs/get_reviewable_targets`. Used by dispatch dialogs and
 * the HUG review detail page for `type: channel` inputs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrgFetch } from '@/lib/org_context';

/** A selectable target — either a user or a named channel. */
interface PickerTarget {
    kind: 'user' | 'channel';
    /** Value written into the input — username for users, channel name for channels. */
    value: string;
    label: string;
    /** Extra context (e.g. provider for channels, display_name for users). */
    detail?: string;
}

interface Props {
    /** Currently selected values (usernames / channel names). */
    selected: string[];
    /** Called when selection changes. */
    on_change: (next: string[]) => void;
    /** Placeholder when nothing is selected. */
    placeholder?: string;
    /** Additional CSS class on the outermost wrapper. */
    class_name?: string;
}

export function ChannelUserPicker({ selected, on_change, placeholder, class_name }: Props) {
    const auth_fetch = useOrgFetch();
    const [query, set_query] = useState('');
    const [targets, set_targets] = useState<PickerTarget[]>([]);
    const [loading, set_loading] = useState(false);
    const [open, set_open] = useState(false);
    const wrapper_ref = useRef<HTMLDivElement>(null);
    const input_ref = useRef<HTMLInputElement>(null);
    /** Debounce handle for search-as-you-type. */
    const debounce_ref = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** Fetch targets from the backend, debounced. */
    const fetch_targets = useCallback(
        (search: string) => {
            if (debounce_ref.current) clearTimeout(debounce_ref.current);
            debounce_ref.current = setTimeout(async () => {
                set_loading(true);
                try {
                    const res = await auth_fetch('/v1/orgs/get_reviewable_targets', {
                        method: 'POST',
                        body: JSON.stringify({ query: search }),
                    });
                    const data = await res.json();
                    if (!data.ok) {
                        set_targets([]);
                        return;
                    }
                    const users: PickerTarget[] = (data.data?.users ?? []).map(
                        (u: { username: string; display_name?: string }) => ({
                            kind: 'user' as const,
                            value: u.username,
                            label: u.username,
                            detail: u.display_name || undefined,
                        }),
                    );
                    const channels: PickerTarget[] = (data.data?.channels ?? []).map(
                        (c: { name: string }) => ({
                            kind: 'channel' as const,
                            value: c.name,
                            label: c.name,
                        }),
                    );
                    set_targets([...users, ...channels]);
                } catch {
                    set_targets([]);
                } finally {
                    set_loading(false);
                }
            }, 200);
        },
        [auth_fetch],
    );

    /** Load initial list on first open. */
    useEffect(() => {
        if (open) fetch_targets(query);
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    /** Re-fetch when query changes. */
    useEffect(() => {
        if (open) fetch_targets(query);
    }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

    /** Close dropdown when clicking outside. */
    useEffect(() => {
        function handle_click(e: MouseEvent) {
            if (wrapper_ref.current && !wrapper_ref.current.contains(e.target as Node)) {
                set_open(false);
            }
        }
        document.addEventListener('mousedown', handle_click);
        return () => document.removeEventListener('mousedown', handle_click);
    }, []);

    function toggle_target(value: string) {
        if (selected.includes(value)) {
            on_change(selected.filter((v) => v !== value));
        } else {
            on_change([...selected, value]);
        }
    }

    function remove_chip(value: string) {
        on_change(selected.filter((v) => v !== value));
    }

    /** Targets not already selected. */
    const available = targets.filter((t) => !selected.includes(t.value));

    return (
        <div ref={wrapper_ref} className={`relative ${class_name ?? ''}`}>
            {/* Chips + search input */}
            <div
                className="flex min-h-[38px] flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100"
                onClick={() => {
                    set_open(true);
                    input_ref.current?.focus();
                }}
            >
                {selected.map((val) => (
                    <span
                        key={val}
                        className="inline-flex items-center gap-1 rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800"
                    >
                        {val}
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                remove_chip(val);
                            }}
                            className="ml-0.5 text-indigo-600 hover:text-indigo-900"
                            aria-label={`Remove ${val}`}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <input
                    ref={input_ref}
                    type="text"
                    value={query}
                    onChange={(e) => set_query(e.target.value)}
                    onFocus={() => set_open(true)}
                    placeholder={selected.length === 0 ? (placeholder ?? 'Search users or channels…') : ''}
                    className="min-w-[80px] flex-1 border-0 bg-transparent p-1 text-sm outline-none"
                />
            </div>

            {/* Dropdown */}
            {open ? (
                <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                    {loading ? (
                        <p className="px-3 py-2 text-xs text-slate-400">Loading…</p>
                    ) : available.length === 0 ? (
                        <p className="px-3 py-2 text-xs text-slate-400">
                            {targets.length === 0 ? 'No users or channels found' : 'All targets selected'}
                        </p>
                    ) : (
                        available.map((t) => (
                            <button
                                key={`${t.kind}-${t.value}`}
                                type="button"
                                onClick={() => {
                                    toggle_target(t.value);
                                    set_query('');
                                    input_ref.current?.focus();
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-indigo-50"
                            >
                                <span className={`inline-block w-[18px] rounded px-1 py-0.5 text-center text-[9px] font-bold uppercase ${
                                    t.kind === 'user'
                                        ? 'bg-blue-100 text-blue-700'
                                        : 'bg-amber-100 text-amber-700'
                                }`}>
                                    {t.kind === 'user' ? 'U' : 'C'}
                                </span>
                                <span className="font-medium text-slate-800">{t.label}</span>
                                {t.detail ? (
                                    <span className="text-xs text-slate-400">{t.detail}</span>
                                ) : null}
                            </button>
                        ))
                    )}
                </div>
            ) : null}
        </div>
    );
}
