/**
 * Regression tests for the run detail page's "Resume from…" UX.
 *
 * Pins the end-to-end flow that closes cliqhub slice 2.1 for users:
 *   1. Failed / awaiting_input runs get a "Resume from…" button.
 *   2. Clicking it opens an inline phase-picker dialog defaulted to
 *      the failed phase.
 *   3. Confirming POSTs to /v1/runs/resume with {run_id, from_phase}.
 *   4. While a /v1/resume outbox row is in flight, the button is
 *      replaced by a disabled "Resume pending…" pill — same idempotency
 *      shape as cancel-pending so double-clicks don't queue dupes.
 *   5. Completed and running runs don't get the button — resume is
 *      only for failed / awaiting_input / crashed.
 *
 * Also unit-tests the pure `pick_default_resume_phase` helper because
 * its default-selection logic is the interesting part users will
 * touch — everything else is UI plumbing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

import { pick_default_resume_phase } from '@/components/dispatch/run_dialogs';

const auth_fetch = vi.fn();

vi.mock('@/lib/org_context', () => ({
    useOrgFetch: () => auth_fetch,
    useOrg: () => ({
        current_org: { id: 1, slug: 'acme' },
        orgs: [], is_multi_org: false, is_personal: false,
        loading: false, switch_org: () => {},
    }),
}));

// Silence the polling timer — same rationale as the cancel-pending
// spec: we don't want the mock fetch queue to be called unpredictably.
vi.mock('@/lib/use_poll', () => ({ use_poll: () => {} }));

vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return {
        ...actual,
        useOutletContext: () => ({
            realm: { id: 'realm-1', slug: 'acme-prod', name: 'Acme' },
            base_path: '/realms/acme-prod',
        }),
    };
});

import { Component as Run_detail_page } from '@/pages/runs/run_detail_page';

const RUN_ID = 'run-resume-abc';
const DAEMON_ID = 'dmn-1';
const NOW = Date.now();

interface Phase_fixture {
    phase: string;
    status: string;
    sequence: number;
}

interface Fixture_overrides {
    state?: string;
    phases?: readonly Phase_fixture[];
    pending?: unknown;
    resume_response?: { ok: boolean; error?: string };
}

function build_fetch(overrides: Fixture_overrides = {}) {
    const phases = overrides.phases ?? [
        { phase: 'plan', status: 'completed', sequence: 0 },
        { phase: 'implement', status: 'failed', sequence: 1 },
        { phase: 'verify', status: 'pending', sequence: 2 },
    ];
    return async (url: string, init?: RequestInit) => {
        if (url.includes('/v1/runs/resume')) {
            return { json: async () => overrides.resume_response ?? { ok: true, data: { resumed: true, from_phase: JSON.parse(init?.body as string).from_phase } } };
        }
        if (url.includes('/v1/runs/get_by_id')) {
            return {
                json: async () => ({
                    ok: true,
                    data: {
                        run_id: RUN_ID,
                        run_name: 'fixture-run',
                        state: overrides.state ?? 'failed',
                        daemon_id: DAEMON_ID,
                        started_at: NOW - 60_000,
                        pending_control: overrides.pending ?? null,
                    },
                }),
            };
        }
        if (url.includes('/v1/runs/get_status')) {
            return { json: async () => ({ ok: true, data: phases }) };
        }
        if (url.includes('/v1/runs/get')) {
            return { json: async () => ({ ok: true, data: { items: [], total: 0 } }) };
        }
        return { json: async () => ({ ok: true }) };
    };
}

function render_page() {
    return render(
        <MemoryRouter initialEntries={[`/realms/acme-prod/runs/${RUN_ID}`]}>
            <Routes>
                <Route
                    path="/realms/:realm_slug/runs/:run_id"
                    element={<Run_detail_page />}
                />
            </Routes>
        </MemoryRouter>,
    );
}

describe('pick_default_resume_phase', () => {
    it('picks the failed phase when there is one', () => {
        expect(pick_default_resume_phase([
            { phase: 'a', status: 'completed' },
            { phase: 'b', status: 'failed' },
            { phase: 'c', status: 'pending' },
        ])).toBe('b');
    });

    it('normalises alt failed statuses (error / failure / crashed)', () => {
        expect(pick_default_resume_phase([
            { phase: 'a', status: 'completed' },
            { phase: 'b', status: 'CRASHED' },
        ])).toBe('b');
    });

    it('falls back to awaiting_input when no failed phase', () => {
        expect(pick_default_resume_phase([
            { phase: 'a', status: 'completed' },
            { phase: 'b', status: 'awaiting_input' },
            { phase: 'c', status: 'pending' },
        ])).toBe('b');
    });

    it('falls back to the last non-completed phase', () => {
        expect(pick_default_resume_phase([
            { phase: 'a', status: 'completed' },
            { phase: 'b', status: 'completed' },
            { phase: 'c', status: 'pending' },
        ])).toBe('c');
    });

    it('falls back to first phase when everything is completed', () => {
        expect(pick_default_resume_phase([
            { phase: 'a', status: 'completed' },
            { phase: 'b', status: 'succeeded' },
        ])).toBe('a');
    });

    it('returns empty string on empty phase list', () => {
        expect(pick_default_resume_phase([])).toBe('');
    });
});

describe('Run detail page — Resume from phase UX', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
    });

    it('shows the "Resume from…" button on failed runs', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'failed' }));

        render_page();

        const btn = await waitFor(() =>
            screen.getByRole('button', { name: /Resume from…/i }),
        );
        expect(btn).not.toBeDisabled();
    });

    it('shows the "Resume from…" button on awaiting_input runs', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'awaiting_input' }));

        render_page();

        await waitFor(() =>
            screen.getByRole('button', { name: /Resume from…/i }),
        );
    });

    it('does NOT show the button on completed runs (Run again path)', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'completed' }));

        render_page();
        // Give the page a beat to render; use a stable anchor from the header.
        await waitFor(() => screen.getByText(/fixture-run/i));
        expect(screen.queryByRole('button', { name: /Resume from…/i })).toBeNull();
    });

    it('does NOT show the button on running runs (cancel first)', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'running' }));

        render_page();
        await waitFor(() => screen.getByText(/fixture-run/i));
        expect(screen.queryByRole('button', { name: /Resume from…/i })).toBeNull();
    });

    it('opens the phase picker defaulted to the failed phase', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'failed' }));

        render_page();

        const btn = await waitFor(() =>
            screen.getByRole('button', { name: /Resume from…/i }),
        );
        fireEvent.click(btn);

        const select = await waitFor(() =>
            screen.getByTestId('resume-from-phase-select'),
        ) as HTMLSelectElement;
        expect(select.value).toBe('implement');
    });

    it('POSTs to /v1/runs/resume with {run_id, from_phase} on confirm', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'failed' }));

        render_page();

        fireEvent.click(await waitFor(() =>
            screen.getByRole('button', { name: /Resume from…/i }),
        ));
        // Pick a different phase to prove the picker's value flows through.
        fireEvent.change(await waitFor(() => screen.getByTestId('resume-from-phase-select')), {
            target: { value: 'plan' },
        });
        fireEvent.click(screen.getByTestId('resume-from-phase-confirm'));

        await waitFor(() => {
            const call = auth_fetch.mock.calls.find(
                ([url]) => typeof url === 'string' && url.includes('/v1/runs/resume'),
            );
            expect(call).toBeDefined();
            const body = JSON.parse((call![1] as RequestInit).body as string);
            expect(body).toEqual({ run_id: RUN_ID, from_phase: 'plan' });
        });
    });

    it('surfaces API error inline instead of crashing', async () => {
        auth_fetch.mockImplementation(build_fetch({
            state: 'failed',
            resume_response: { ok: false, error: 'daemon offline' },
        }));

        render_page();

        fireEvent.click(await waitFor(() =>
            screen.getByRole('button', { name: /Resume from…/i }),
        ));
        fireEvent.click(await waitFor(() =>
            screen.getByTestId('resume-from-phase-confirm'),
        ));

        await waitFor(() => {
            expect(screen.getByText(/daemon offline/i)).toBeInTheDocument();
        });
    });

    it('replaces the button with a disabled "Resume pending…" pill when a resume is in flight', async () => {
        auth_fetch.mockImplementation(build_fetch({
            state: 'failed',
            pending: {
                tx_id: 'tx-r-1',
                endpoint: '/v1/resume',
                enqueued_at: NOW - 5_000,
                attempts: 1,
                max_attempts: 5,
                delivered_at: null,
                last_error: null,
                ack_status: null,
            },
        }));

        render_page();

        const disabled = await waitFor(() =>
            screen.getByRole('button', { name: /Resume pending…/i }),
        );
        expect(disabled).toBeDisabled();
        // The interactive variant must not co-exist.
        expect(screen.queryByRole('button', { name: /^Resume from…$/i })).toBeNull();
    });
});
