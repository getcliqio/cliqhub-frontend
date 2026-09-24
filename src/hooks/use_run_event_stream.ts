/**
 * useRunEventStream — opens an EventSource to the run events SSE
 * endpoint and dispatches parsed events to a callback.
 *
 * Manages reconnect with cursor tracking (`after_id`), stale
 * connection detection (60s without any data/keepalive), and
 * cleanup on unmount.
 */

import { useEffect, useRef, useCallback } from 'react';

/** Shape of a streaming event received via SSE. */
export interface StreamEvent {
    id: number;
    event_type: string;
    phase: string | null;
    agent: string | null;
    payload: unknown;
    timestamp: number;
}

/** Options for the SSE hook. */
export interface UseRunEventStreamOptions {
    /** Run ID to stream events for. */
    run_id: string;
    /** Called for each event received. */
    on_event: (event: StreamEvent) => void;
    /** Whether the stream is enabled (default true). */
    enabled?: boolean;
    /** Initial cursor — skip events up to this ID (e.g. from historical fetch). */
    initial_cursor?: number;
}

/** Stale connection timeout — reopen if no data for 60s. */
const STALE_TIMEOUT_MS = 60_000;

/**
 * Opens an EventSource to `/v1/runs/stream?run_id=` and
 * dispatches parsed events. Handles reconnection with cursor
 * tracking and stale connection detection.
 */
export function use_run_event_stream({
    run_id,
    on_event,
    enabled = true,
    initial_cursor = 0,
}: UseRunEventStreamOptions): void {
    const on_event_ref = useRef(on_event);
    on_event_ref.current = on_event;

    /** Last received event ID — used as cursor on reconnect. */
    const last_id_ref = useRef(initial_cursor);
    if (initial_cursor > last_id_ref.current) {
        last_id_ref.current = initial_cursor;
    }

    const connect = useCallback(() => {
        if (!run_id || !enabled) return null;

        const params = new URLSearchParams({ run_id });
        if (last_id_ref.current > 0) params.set('after_id', String(last_id_ref.current));
        const url = `/v1/runs/stream?${params.toString()}`;
        const es = new EventSource(url);

        let stale_timer: ReturnType<typeof setTimeout> | null = null;

        /** Reset the stale-connection watchdog. */
        const touch = () => {
            if (stale_timer) clearTimeout(stale_timer);
            stale_timer = setTimeout(() => {
                // No data for 60s — connection is likely dead. Close and
                // let the effect re-create it.
                es.close();
            }, STALE_TIMEOUT_MS);
        };

        /** Handle incoming SSE messages (all event types). */
        const handle_message = (msg: MessageEvent) => {
            touch();
            try {
                const data = JSON.parse(msg.data) as StreamEvent;
                if (data.id) last_id_ref.current = data.id;
                on_event_ref.current(data);
            } catch {
                // Malformed event — skip silently.
            }
        };

        // EventSource dispatches named events (e.g. `event: llm_output`).
        // We also listen on the generic `message` for fallback.
        es.onmessage = handle_message;

        // Named event types we expect.
        //
        // EventSource dispatch is exact-match on the `event:` line, so we
        // must list every wire type the backend/daemon actually emits.
        // The daemon (`run_executor.ts`) uses `phase_start` / `phase_complete`
        // / `phase_error` / `gate_verdict` / `orchestrator_registered` /
        // `run_cancelled` — those spellings are the authoritative wire
        // format. The `_ed`/`_decision` names are kept for compat with any
        // future producer that emits them.
        const event_types = [
            'llm_output', 'tool_call', 'thinking',
            'gate_verdict', 'gate_decision',
            'phase_start', 'phase_started',
            'phase_complete', 'phase_completed',
            'phase_failed', 'phase_error',
            'phase_awaiting_input', 'phase_inputs_supplied',
            'agent_started', 'agent_completed', 'agent_failed',
            'run_complete', 'run_failed', 'run_crashed', 'run_cancelled',
            'orchestrator_registered',
            'usage_delta', 'error',
        ];
        for (const type of event_types) {
            es.addEventListener(type, handle_message as EventListener);
        }

        es.onerror = () => {
            // EventSource auto-reconnects on error. Reset the stale
            // timer so we don't double-close.
            touch();
        };

        // Start the stale watchdog.
        touch();

        return { es, stale_timer };
    }, [run_id, enabled, initial_cursor]);

    useEffect(() => {
        const conn = connect();
        if (!conn) return;

        return () => {
            conn.es.close();
            if (conn.stale_timer) clearTimeout(conn.stale_timer);
        };
    }, [connect]);
}
