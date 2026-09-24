/**
 * Pins the hard-cut Teams build API for SparkPage AI Generate.
 *
 * Start and poll both use POST /v1/teams/build with an `action` discriminator:
 *   { action: 'generate', intent }
 *   { action: 'status', job_id }
 *
 * A future refactor must not regress to GET /v1/teams/build/status/:job_id
 * (removed) or omit `action` (schema 422).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const auth_fetch = vi.fn();

vi.mock('@/lib/auth_context', () => ({
    useAuth: () => ({
        user: { id: 1, username: 'u', display_name: 'U', email: 'u@x', role: 'user' },
        refresh: vi.fn(),
        logout: vi.fn(),
    }),
    useAuthFetch: () => auth_fetch,
}));

// SparkPage pulls in page_help which reaches into MDX docs. Stub it flat.
vi.mock('@/lib/page_help', () => ({
    PAGE_HELP: { builder: { docs_href: '#', help: '' } },
}));

vi.mock('@/components/ui/help_tip', () => ({
    HelpTip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { BuilderProvider } from '@/lib/builder/store';
import { SparkPage } from '@/components/builder/spark_page';

function make_response(status: number, body: unknown): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
        json: async () => body,
    } as unknown as Response;
}

describe('SparkPage — AI Generate polling', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('polls POST /v1/teams/build with action: status and job_id', async () => {
        // 1st call: start-generate (POST → job_id).
        // 2nd call: poll → return a terminal job so the loop exits.
        auth_fetch
            .mockResolvedValueOnce(make_response(200, {
                ok: true,
                data: { job_id: 'job-abc', stage: 'queued' },
            }))
            .mockResolvedValueOnce(make_response(200, {
                ok: true,
                data: {
                    status: 'done',
                    stage: 'done',
                    team: {
                        name: 'demo',
                        description: 'd',
                        phases: [],
                        roles: [],
                        agents: [],
                    },
                    validation: { valid: true, errors: [], warnings: [] },
                },
            }));

        render(
            <BuilderProvider>
                <SparkPage />
            </BuilderProvider>,
        );

        const textarea = await screen.findByPlaceholderText(/test-driven development/i);
        fireEvent.change(textarea, { target: { value: 'a tiny team' } });

        const button = screen.getByRole('button', { name: /Generate team/i });
        fireEvent.click(button);

        // The polling loop sleeps 1500ms between attempts. Wait for the
        // second call rather than mocking timers — real waitFor keeps this
        // test resilient to sleep-tuning.
        await waitFor(
            () => expect(auth_fetch).toHaveBeenCalledTimes(2),
            { timeout: 4000 },
        );

        const [start_url, start_init] = auth_fetch.mock.calls[0];
        expect(start_url).toBe('/v1/teams/build');
        expect(start_init).toMatchObject({ method: 'POST' });
        expect(JSON.parse(start_init.body)).toEqual({
            action: 'generate',
            intent: 'a tiny team',
        });

        const [poll_url, poll_init] = auth_fetch.mock.calls[1];
        expect(poll_url).toBe('/v1/teams/build');
        expect(poll_init).toBeDefined();
        expect(poll_init.method).toBe('POST');
        expect(JSON.parse(poll_init.body)).toEqual({
            action: 'status',
            job_id: 'job-abc',
        });
    });
});
