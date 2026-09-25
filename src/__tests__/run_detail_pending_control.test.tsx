/**
 * Regression tests for the run detail page's "cancel pending" UX.
 *
 * The bug this pins: after the operator clicked Cancel on a run
 * whose daemon was offline, the toast fired once, the Cancel button
 * stayed hot, and the state pill kept reading "running" — with no
 * way to tell whether the cancel was queued, delivered, retrying,
 * or silently dropped. Users would click again and again, then ping
 * the daemon owner asking "why won't this cancel?".
 *
 * The fix (backend: `RunService.load_pending_control`; SPA: the
 * `Pending_control_banner` + disabled `Cancel pending…` button) is
 * pinned here by mocking the run response with a `pending_control`
 * payload and asserting that:
 *   1. The banner renders with attempts and last-error visible
 *   2. The Cancel button becomes disabled "Cancel pending…"
 *   3. When `pending_control` is null, the button is interactive
 *      (regression: don't accidentally disable Cancel on a healthy
 *      run because of a stale banner check).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

const auth_fetch = vi.fn();

vi.mock('@/lib/org_context', () => ({
    useOrgFetch: () => auth_fetch,
    useOrg: () => ({
        current_org: { id: 1, slug: 'acme' },
        orgs: [], is_multi_org: false, is_personal: false,
        loading: false, switch_org: () => {},
    }),
}));

// use_poll's timer fires while the component is mounted — silence it
// so the mock fetch queue doesn't get called an unpredictable number
// of times and drown out the first-load assertions.
vi.mock('@/lib/use_poll', () => ({ use_poll: () => {} }));

// Outlet context (realm + base_path) is what the real page reads
// from the realm layout. Stub it so the page can mount standalone.
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

const RUN_ID = 'run-abc-123';
const DAEMON_ID = 'dmn-krupali-laptop';
const NOW = Date.now();

interface Fixture_run_overrides {
    pending?: unknown;
    force_terminate?: unknown;
    state?: string;
}

function _fetch_with_pending(pending: unknown, overrides?: Fixture_run_overrides): (url: string, init?: unknown) => Promise<unknown>;
function _fetch_with_pending(overrides: Fixture_run_overrides): (url: string, init?: unknown) => Promise<unknown>;
function _fetch_with_pending(
    arg1: unknown,
    arg2?: Fixture_run_overrides,
): (url: string, init?: unknown) => Promise<unknown> {
    const overrides: Fixture_run_overrides = typeof arg1 === 'object' && arg1 !== null
        && !Array.isArray(arg1) && ('pending' in (arg1 as object) || 'force_terminate' in (arg1 as object) || 'state' in (arg1 as object))
        ? (arg1 as Fixture_run_overrides)
        : { pending: arg1, ...(arg2 ?? {}) };

    // The page fires three requests in parallel on mount:
    //   • /v1/runs/get_by_id   → the run + pending_control + force_terminate
    //   • /v1/runs/get_status  → phases (empty is fine)
    //   • /v1/runs/get         → sibling runs (empty is fine)
    return async (url: string, init?: unknown) => {
        // The force-terminate button POSTs to /v1/runs/force_terminate;
        // returning { ok: true } is enough — the follow-up load() call
        // re-fetches get_by_id which the test controls per case.
        if (url.includes('/v1/runs/force_terminate')) {
            void init;
            return { json: async () => ({ ok: true, data: { force_terminated: true, run_id: RUN_ID } }) };
        }
        if (url.includes('/v1/runs/get_by_id')) {
            return {
                json: async () => ({
                    ok: true,
                    data: {
                        run_id: RUN_ID,
                        run_name: 'ok-recent',
                        state: overrides.state ?? 'running',
                        daemon_id: DAEMON_ID,
                        started_at: NOW - 3600_000,
                        pending_control: overrides.pending ?? null,
                        force_terminate: overrides.force_terminate ?? null,
                    },
                }),
            };
        }
        if (url.includes('/v1/runs/get_status')) {
            return { json: async () => ({ ok: true, data: [] }) };
        }
        if (url.includes('/v1/runs/get')) {
            return { json: async () => ({ ok: true, data: { items: [], total: 0 } }) };
        }
        return { json: async () => ({ ok: true }) };
    };
}

function _render() {
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

describe('Run detail page — cancel pending UX', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
    });

    it('renders a persistent "cancel pending" banner with attempts and last error when the outbox row is in flight', async () => {
        auth_fetch.mockImplementation(_fetch_with_pending({
            tx_id: 'tx-1',
            endpoint: '/v1/cancel',
            enqueued_at: NOW - 45_000,
            attempts: 3,
            max_attempts: 5,
            delivered_at: null,
            last_error: 'connection timeout',
            ack_status: null,
        }));

        _render();

        // Banner is the whole point — it must appear whenever a
        // pending control row exists. Regression: a UI-only check
        // (e.g. "is_busy('cancel')") wouldn't survive a page reload
        // because that state is transient. The banner is fed from
        // the backend so it survives reloads and cross-tab views.
        const banner = await waitFor(() => screen.getByTestId('pending-control-banner'));
        expect(banner).toBeInTheDocument();

        // The banner must call out the daemon and quantify the
        // problem (attempts + last error). Without this, the
        // operator has no clue whether the daemon is offline,
        // wedged, or just slow.
        expect(banner).toHaveTextContent(/Cancel pending/i);
        expect(banner).toHaveTextContent(DAEMON_ID);
        expect(banner).toHaveTextContent(/3\/5 delivery attempts/i);
        expect(banner).toHaveTextContent(/connection timeout/i);
    });

    it('replaces the interactive Cancel button with a disabled "Cancel pending…" pill when a cancel is already in flight', async () => {
        auth_fetch.mockImplementation(_fetch_with_pending({
            tx_id: 'tx-1',
            endpoint: '/v1/cancel',
            enqueued_at: NOW - 10_000,
            attempts: 1,
            max_attempts: 5,
            delivered_at: null,
            last_error: null,
            ack_status: null,
        }));

        _render();

        // Disabled variant appears with the "…" affordance so double-
        // clicks don't enqueue a second identical cancel — the
        // pre-fix behaviour was to happily accept every click and
        // pile duplicate rows into the outbox.
        const disabled = await waitFor(() =>
            screen.getByRole('button', { name: /Cancel pending…/i }),
        );
        expect(disabled).toBeDisabled();
        // The plain "Cancel" button (the one that opens the confirm
        // dialog) must not co-exist — only one variant at a time.
        expect(screen.queryByRole('button', { name: /^Cancel$/ })).toBeNull();
    });

    it('keeps the Cancel button interactive on a healthy running run (no pending control row)', async () => {
        auth_fetch.mockImplementation(_fetch_with_pending(null));

        _render();

        const cancel_btn = await waitFor(() =>
            screen.getByRole('button', { name: /^Cancel$/ }),
        );
        expect(cancel_btn).not.toBeDisabled();
        // And no banner — nothing pending means no attention-grabbing
        // amber strip cluttering the top of the page.
        expect(screen.queryByTestId('pending-control-banner')).toBeNull();
    });
});

describe('Run detail page — hub cancel escalate UX', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
    });

    it('does NOT show a separate Force terminate button (cancel owns escalate)', async () => {
        auth_fetch.mockImplementation(_fetch_with_pending({
            pending: {
                tx_id: 'tx-1', endpoint: '/v1/cancel',
                enqueued_at: NOW - 5_000, attempts: 0, max_attempts: 5,
                delivered_at: null, last_error: null, ack_status: null,
            },
            force_terminate: {
                already_terminated: false,
                terminated_at: null,
                terminated_by_user_id: null,
                terminated_reason: null,
                eligible: true,
                trigger: 'stale_cancel',
                blocker: null,
            },
        }));

        _render();
        await waitFor(() => screen.getByTestId('pending-control-banner'));
        expect(screen.queryByTestId('force-terminate-button')).toBeNull();
    });

    it('hints to click Cancel again when delivery is stuck', async () => {
        auth_fetch.mockImplementation(_fetch_with_pending({
            pending: {
                tx_id: 'tx-1', endpoint: '/v1/cancel',
                enqueued_at: NOW - 10 * 60 * 1000, attempts: 4, max_attempts: 5,
                delivered_at: null, last_error: 'connection timeout', ack_status: null,
            },
            force_terminate: {
                already_terminated: false,
                terminated_at: null,
                terminated_by_user_id: null,
                terminated_reason: null,
                eligible: true,
                trigger: 'stale_cancel',
                blocker: null,
            },
        }));

        _render();
        await waitFor(() => screen.getByTestId('pending-control-banner'));
        expect(screen.getByText(/Click Cancel again/i)).toBeInTheDocument();
    });

    it('flips to the slate Hub-cancelled banner once cancel escalated', async () => {
        auth_fetch.mockImplementation(_fetch_with_pending({
            state: 'cancelled',
            pending: null,
            force_terminate: {
                already_terminated: true,
                terminated_at: NOW - 30_000,
                terminated_by_user_id: 'user-1',
                terminated_reason: null,
                eligible: false,
                trigger: null,
                blocker: null,
            },
        }));

        _render();
        await waitFor(() => screen.getByTestId('force-terminated-banner'));
        expect(screen.queryByTestId('pending-control-banner')).toBeNull();
        expect(screen.getByText(/Cancelled on the Hub/i)).toBeInTheDocument();
        expect(screen.getByText(/user user-1/i)).toBeInTheDocument();
    });
});
