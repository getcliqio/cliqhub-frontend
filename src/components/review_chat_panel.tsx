/**
 * ReviewChatPanel — live multi-turn chat between a human reviewer
 * and an AI agent within a HUG review.
 *
 * Loads messages on mount, polls for new messages every 3 seconds,
 * and lets the reviewer send messages. Read-only when the review
 * is decided.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrgFetch } from '@/lib/org_context';
import { useAuth } from '@/lib/auth_context';

/** Shape of a single chat message from the API. */
interface ChatMessage {
    id: string;
    review_id: string;
    role: 'user' | 'assistant';
    text: string;
    sender_id: number | null;
    created_at: string;
}

interface ReviewChatPanelProps {
    review_id: string;
    /** Current review status — disables input when decided. */
    status: string;
    /** Whether the current user has the chat claimed. */
    is_my_claim: boolean;
    /** Whether another user has claimed the chat. */
    is_other_claim: boolean;
    /** Name of the claimer if someone else claimed. */
    claimer_name?: string;
    /** System prompt from the agent (optional, shown in expandable section). */
    system_prompt?: string;
}

const POLL_INTERVAL_MS = 3_000;

export function ReviewChatPanel({
    review_id,
    status,
    is_my_claim,
    is_other_claim,
    claimer_name,
    system_prompt,
}: ReviewChatPanelProps) {
    const auth_fetch = useOrgFetch();
    const [messages, set_messages] = useState<ChatMessage[]>([]);
    const [draft, set_draft] = useState('');
    const [sending, set_sending] = useState(false);
    const [loading, set_loading] = useState(true);
    const [error, set_error] = useState<string | null>(null);
    const [show_system_prompt, set_show_system_prompt] = useState(false);
    const scroll_ref = useRef<HTMLDivElement>(null);

    const is_decided = status === 'decided' || status === 'completed';
    const can_send = !is_decided && !sending && !is_other_claim;

    /** Load all messages (or new ones after the last known). */
    const load_messages = useCallback(async (after_id?: string) => {
        try {
            const body: Record<string, string> = { review_id };
            if (after_id) body.after_id = after_id;

            const res = await auth_fetch('/v1/reviews/get_messages', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!data.ok) return;

            const new_msgs = (data.data?.messages ?? data.data ?? []) as ChatMessage[];
            if (new_msgs.length === 0) return;

            set_messages((prev) => {
                /** Deduplicate in case of race between send-response and poll. */
                const existing_ids = new Set(prev.map((m) => m.id));
                const fresh = new_msgs.filter((m) => !existing_ids.has(m.id));
                if (fresh.length === 0) return prev;
                return [...prev, ...fresh];
            });
        } catch {
            /* Network error — poll will retry. */
        }
    }, [auth_fetch, review_id]);

    /** Initial load. */
    useEffect(() => {
        set_loading(true);
        load_messages().finally(() => set_loading(false));
    }, [load_messages]);

    /** SSE for live message delivery, with polling fallback. */
    useEffect(() => {
        if (is_decided) return;

        let es: EventSource | null = null;
        let fallback_interval: ReturnType<typeof setInterval> | null = null;

        /** Try SSE first. */
        try {
            const last_id = messages.length > 0 ? messages[messages.length - 1].id : '';
            const params = new URLSearchParams({ review_id });
            if (last_id) params.set('after_id', last_id);
            es = new EventSource(`/api/v1/reviews/stream_messages?${params.toString()}`);

            es.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data) as ChatMessage;
                    set_messages((prev) => {
                        if (prev.some((m) => m.id === msg.id)) return prev;
                        return [...prev, msg];
                    });
                } catch { /* ignore malformed frames */ }
            };

            es.onerror = () => {
                /** SSE failed — close and fall back to polling. */
                es?.close();
                es = null;
                start_polling_fallback();
            };
        } catch {
            /** EventSource not available — use polling. */
            start_polling_fallback();
        }

        function start_polling_fallback() {
            if (fallback_interval) return;
            fallback_interval = setInterval(() => {
                const last = messages.length > 0 ? messages[messages.length - 1].id : undefined;
                load_messages(last);
            }, POLL_INTERVAL_MS);
        }

        return () => {
            es?.close();
            if (fallback_interval) clearInterval(fallback_interval);
        };
    }, [is_decided, review_id, load_messages]); // eslint-disable-line react-hooks/exhaustive-deps

    /** Auto-scroll to bottom on new messages. */
    useEffect(() => {
        const el = scroll_ref.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [messages]);

    /** Send a user message. */
    async function handle_send() {
        const text = draft.trim();
        if (!text || !can_send) return;

        set_sending(true);
        set_error(null);
        set_draft('');

        try {
            const res = await auth_fetch('/v1/reviews/send_message', {
                method: 'POST',
                body: JSON.stringify({ review_id, text }),
            });
            const data = await res.json();
            if (!data.ok) {
                set_error(typeof data.error === 'string' ? data.error : 'Failed to send');
                set_draft(text);
                return;
            }

            /** Optimistically add the message. */
            const msg = data.data as ChatMessage;
            set_messages((prev) => {
                if (prev.some((m) => m.id === msg.id)) return prev;
                return [...prev, msg];
            });
        } catch {
            set_error('Failed to send message');
            set_draft(text);
        } finally {
            set_sending(false);
        }
    }

    /** Whether we're waiting for the agent to respond. */
    const agent_thinking = !is_decided
        && messages.length > 0
        && messages[messages.length - 1].role === 'user';

    return (
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-slate-800">
                    Agent Chat
                    {messages.length > 0 ? (
                        <span className="ml-2 text-xs font-normal text-slate-400">
                            {messages.length} message{messages.length !== 1 ? 's' : ''}
                        </span>
                    ) : null}
                </h2>
                {system_prompt ? (
                    <button
                        type="button"
                        className="text-xs font-medium text-slate-500 hover:text-slate-800"
                        onClick={() => set_show_system_prompt((v) => !v)}
                    >
                        {show_system_prompt ? 'Hide agent instructions' : 'Show agent instructions'}
                    </button>
                ) : null}
            </div>

            {/* System prompt (expandable) */}
            {show_system_prompt && system_prompt ? (
                <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Agent System Prompt</p>
                    <pre className="mt-1 max-h-40 overflow-auto text-xs text-slate-600 whitespace-pre-wrap">
                        {system_prompt}
                    </pre>
                </div>
            ) : null}

            {/* AI warning banner */}
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-2">
                <p className="text-xs text-amber-800">
                    ⚠ This conversation is with an AI agent. Verify claims independently before submitting your verdict.
                </p>
            </div>

            {/* Message list */}
            <div
                ref={scroll_ref}
                className="max-h-[28rem] min-h-[8rem] overflow-y-auto px-5 py-4"
            >
                {loading ? (
                    <p className="text-center text-xs text-slate-400">Loading messages…</p>
                ) : messages.length === 0 ? (
                    <p className="text-center text-xs text-slate-400">No messages yet.</p>
                ) : (
                    <div className="space-y-3">
                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                                        msg.role === 'user'
                                            ? 'bg-indigo-600 text-white'
                                            : 'border border-slate-200 bg-slate-50 text-slate-800'
                                    }`}
                                >
                                    {msg.role === 'assistant' ? (
                                        <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                            AI Agent
                                        </span>
                                    ) : null}
                                    <p className="whitespace-pre-wrap">{msg.text}</p>
                                    <p className={`mt-1 text-[10px] ${
                                        msg.role === 'user' ? 'text-indigo-200' : 'text-slate-400'
                                    }`}>
                                        {new Date(msg.created_at).toLocaleTimeString()}
                                    </p>
                                </div>
                            </div>
                        ))}
                        {agent_thinking ? (
                            <div className="flex justify-start">
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-500">
                                    <span className="animate-pulse">Agent is thinking…</span>
                                </div>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>

            {/* Error */}
            {error ? (
                <div className="border-t border-red-100 bg-red-50 px-5 py-2">
                    <p className="text-xs text-red-800">{error}</p>
                </div>
            ) : null}

            {/* Other user claimed */}
            {is_other_claim ? (
                <div className="border-t border-amber-100 bg-amber-50 px-5 py-2">
                    <p className="text-xs text-amber-800">
                        Chat is locked by <span className="font-semibold">{claimer_name ?? 'another reviewer'}</span>.
                        You can still view the conversation and submit a verdict.
                    </p>
                </div>
            ) : null}

            {/* Input area */}
            {!is_decided ? (
                <div className="border-t border-slate-100 px-5 py-3">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={draft}
                            onChange={(e) => set_draft(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void handle_send();
                                }
                            }}
                            disabled={!can_send}
                            placeholder={is_other_claim ? 'Chat locked by another reviewer' : 'Type a message…'}
                            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
                        />
                        <button
                            type="button"
                            disabled={!can_send || !draft.trim()}
                            onClick={() => void handle_send()}
                            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {sending ? 'Sending…' : 'Send'}
                        </button>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
