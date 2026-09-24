/**
 * Tests for ReviewChatPanel component.
 *
 * Validates message rendering, sending, polling, thinking indicator,
 * disabled state, AI badge, and warning banner.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const auth_fetch = vi.fn();

vi.mock('@/lib/org_context', () => ({
    useOrgFetch: () => auth_fetch,
    useOrg: () => ({ current_org: { id: 1, slug: 'acme' }, orgs: [], is_multi_org: false, is_personal: false, loading: false, switch_org: () => {} }),
}));

import { ReviewChatPanel } from '@/components/review_chat_panel';

/** Helper to render the panel with default props. */
function render_panel(overrides: Record<string, unknown> = {}) {
    const props = {
        review_id: 'rev-123',
        status: 'pending',
        is_my_claim: true,
        is_other_claim: false,
        ...overrides,
    };
    return render(
        <MemoryRouter>
            <ReviewChatPanel {...props} />
        </MemoryRouter>,
    );
}

/** Create a mock message. */
function make_msg(id: string, role: 'user' | 'assistant', text: string) {
    return {
        id,
        review_id: 'rev-123',
        role,
        text,
        sender_id: role === 'user' ? 1 : null,
        created_at: new Date().toISOString(),
    };
}

describe('ReviewChatPanel', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders messages from API', async () => {
        const msgs = [
            make_msg('m1', 'assistant', 'Hello, I need your help'),
            make_msg('m2', 'user', 'Sure, what do you need?'),
            make_msg('m3', 'assistant', 'Which approach should I take?'),
        ];

        auth_fetch.mockResolvedValue({
            json: async () => ({ ok: true, data: msgs }),
        });

        render_panel();

        await waitFor(() => {
            expect(screen.getByText('Hello, I need your help')).toBeTruthy();
            expect(screen.getByText('Sure, what do you need?')).toBeTruthy();
            expect(screen.getByText('Which approach should I take?')).toBeTruthy();
        });
    });

    it('sends user message on submit', async () => {
        /** Initial load returns empty. */
        auth_fetch
            .mockResolvedValueOnce({ json: async () => ({ ok: true, data: [] }) })
            .mockResolvedValueOnce({
                json: async () => ({
                    ok: true,
                    data: make_msg('m1', 'user', 'Go with option A'),
                }),
            });

        render_panel();
        await waitFor(() => expect(auth_fetch).toHaveBeenCalledTimes(1));

        const input = screen.getByPlaceholderText('Type a message…');
        fireEvent.change(input, { target: { value: 'Go with option A' } });

        const send_btn = screen.getByText('Send');
        await act(async () => {
            fireEvent.click(send_btn);
        });

        /** Second call should be the send. */
        const send_call = auth_fetch.mock.calls[1];
        expect(send_call[0]).toBe('/v1/reviews/send_message');
        const body = JSON.parse(send_call[1].body);
        expect(body.text).toBe('Go with option A');
    });

    it('shows thinking indicator after user send', async () => {
        const msgs = [make_msg('m1', 'user', 'Help me')];

        auth_fetch.mockResolvedValue({
            json: async () => ({ ok: true, data: msgs }),
        });

        render_panel();

        await waitFor(() => {
            expect(screen.getByText('Help me')).toBeTruthy();
        });

        /** Thinking indicator should appear since last message is user. */
        expect(screen.getByText('Agent is thinking…')).toBeTruthy();
    });

    it('disables input when review is decided', async () => {
        auth_fetch.mockResolvedValue({
            json: async () => ({ ok: true, data: [] }),
        });

        render_panel({ status: 'decided' });

        await waitFor(() => expect(auth_fetch).toHaveBeenCalled());

        /** Input should not be present for decided reviews. */
        expect(screen.queryByPlaceholderText('Type a message…')).toBeNull();
    });

    it('shows AI Agent badge on assistant messages', async () => {
        const msgs = [make_msg('m1', 'assistant', 'I have a question')];

        auth_fetch.mockResolvedValue({
            json: async () => ({ ok: true, data: msgs }),
        });

        render_panel();

        await waitFor(() => {
            expect(screen.getByText('AI Agent')).toBeTruthy();
        });
    });

    it('shows conversation warning banner', async () => {
        auth_fetch.mockResolvedValue({
            json: async () => ({ ok: true, data: [] }),
        });

        render_panel();

        await waitFor(() => {
            expect(screen.getByText(/This conversation is with an AI agent/)).toBeTruthy();
        });
    });

    it('shows expandable system prompt section', async () => {
        auth_fetch.mockResolvedValue({
            json: async () => ({ ok: true, data: [] }),
        });

        render_panel({ system_prompt: 'You are a helpful assistant.' });

        const toggle = screen.getByText('Show agent instructions');
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(screen.getByText('You are a helpful assistant.')).toBeTruthy();
        });
    });
});
