/**
 * DetailPanel — tabbed right panel showing event streams per phase.
 *
 * [All] tab shows every event chronologically. Per-phase tabs filter
 * to that phase. Auto-scrolls to the latest event when the user is
 * at the bottom; pauses when scrolled up with a "Jump to live" button.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ArrowDown } from 'lucide-react';

import type { StreamEvent } from '@/hooks/use_run_event_stream';
import { EventCard } from './event_card';


// ─── Types ───────────────────────────────────────────────────────────

interface DetailPanelProps {
    phases: string[];
    events: StreamEvent[];
    selected_phase: string | null;
    on_phase_select: (name: string | null) => void;
}


// ─── Component ───────────────────────────────────────────────────────

export function DetailPanel({ phases, events, selected_phase, on_phase_select }: DetailPanelProps) {
    const active_tab = selected_phase ?? '__all__';

    /** Filter events by phase when a specific tab is selected. */
    const visible_events = useMemo(() => {
        if (active_tab === '__all__') return events;
        return events.filter((e) => e.phase === active_tab);
    }, [events, active_tab]);

    return (
        <div className="flex h-full flex-col">
            {/* Tab bar */}
            <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1 dark:border-slate-700 dark:bg-slate-900">
                <TabButton
                    label="All"
                    active={active_tab === '__all__'}
                    on_click={() => on_phase_select(null)}
                />
                {phases.map((name) => (
                    <TabButton
                        key={name}
                        label={name}
                        active={active_tab === name}
                        on_click={() => on_phase_select(name)}
                    />
                ))}
            </div>

            {/* Activity stream */}
            <ActivityStream events={visible_events} />
        </div>
    );
}


// ─── Tab button ──────────────────────────────────────────────────────

function TabButton({ label, active, on_click }: { label: string; active: boolean; on_click: () => void }) {
    return (
        <button
            onClick={on_click}
            className={[
                'whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                active
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800',
            ].join(' ')}
        >
            {label}
        </button>
    );
}


// ─── Activity stream ─────────────────────────────────────────────────

function ActivityStream({ events }: { events: StreamEvent[] }) {
    const scroll_ref = useRef<HTMLDivElement>(null);
    const [auto_scroll, set_auto_scroll] = useState(true);
    const [show_jump, set_show_jump] = useState(false);

    /** Check if the user is scrolled near the bottom. */
    const check_scroll = useCallback(() => {
        const el = scroll_ref.current;
        if (!el) return;
        const near_bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        set_auto_scroll(near_bottom);
        set_show_jump(!near_bottom);
    }, []);

    /** Scroll to bottom when new events arrive (if auto-scroll is on). */
    useEffect(() => {
        if (!auto_scroll) return;
        const el = scroll_ref.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [events.length, auto_scroll]);

    const jump_to_live = useCallback(() => {
        const el = scroll_ref.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
            set_auto_scroll(true);
            set_show_jump(false);
        }
    }, []);

    if (events.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
                Waiting for events…
            </div>
        );
    }

    return (
        <div className="relative flex-1">
            <div
                ref={scroll_ref}
                onScroll={check_scroll}
                className="absolute inset-0 overflow-y-auto px-3 py-2"
            >
                {events.map((event) => (
                    <EventCard key={event.id} event={event} />
                ))}
            </div>

            {show_jump && (
                <button
                    onClick={jump_to_live}
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white shadow-lg hover:bg-indigo-700"
                >
                    <ArrowDown className="h-3 w-3" />
                    Jump to live
                </button>
            )}
        </div>
    );
}
