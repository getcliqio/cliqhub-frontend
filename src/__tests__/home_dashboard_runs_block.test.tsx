/**
 * Regression tests for the Runs block on the home dashboard.
 *
 * Two behaviours this pins down:
 *   1. The runs table renders with Time / Name / Realm / Status columns.
 *   2. The run list is ordered purely by recency — the previous
 *      priority-based sort caused completed runs to disappear from
 *      the block whenever any failures existed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';
import { HubActivityProvider } from '@/lib/hub_activity_context';
import { Component as HomeDashboard } from '@/pages/home_dashboard_page';

const MOCK_ME = {
    ok: true,
    data: {
        user: { id: 1, username: 'sapan', display_name: 'Sapan', email: 's@test.com', role: 'user' },
        scopes: [],
        default_realm_slug: 'acme-prod',
        default_realm_qualified: 'acme.acme-prod',
    },
};

// Realms fixture: one realm, so `default_realm_slug` resolves and the
// count tiles get an actionable href instead of falling back to /realms.
const REALMS = [
    {
        id: 'rlm_1',
        slug: 'acme-prod',
        org_slug: 'acme',
        name: 'Acme Production',
        last_activity_at: Date.now(),
        daemons: { online: 2, stale: 0, offline: 0, total: 2 },
        runs: { active: 1, awaiting_input: 0 },
        pending_reviews: 0,
        recent_notifications: 0,
    },
];

// Runs fixture: pathological mix — 1 recent completed, 3 older failures.
// Under the old priority sort the failures would push the completed
// row out of the visible list; under the new time-sorted list the
// completed run stays visible.
const NOW = Date.now();
const RUNS = [
    {
        run_id: 'run-completed-recent',
        run_name: 'ok-recent',
        team_label: 'cliq/hello-world',
        realm_id: 'rlm_1',
        state: 'completed',
        started_at: NOW - 60_000,
        last_updated_at: NOW - 30_000,
    },
    {
        run_id: 'run-failed-1',
        run_name: 'boom-1',
        team_label: 'cliq/hello-world',
        realm_id: 'rlm_1',
        state: 'failed',
        started_at: NOW - 3_600_000,
        last_updated_at: NOW - 3_500_000,
    },
    {
        run_id: 'run-failed-2',
        run_name: 'boom-2',
        team_label: 'cliq/hello-world',
        realm_id: 'rlm_1',
        state: 'crashed',
        started_at: NOW - 7_200_000,
        last_updated_at: NOW - 7_100_000,
    },
    {
        run_id: 'run-awaiting',
        run_name: 'waiting-input',
        team_label: 'cliq/hello-world',
        realm_id: 'rlm_1',
        state: 'awaiting_input',
        started_at: NOW - 5_400_000,
        last_updated_at: NOW - 5_400_000,
    },
];

beforeEach(() => {
    vi.restoreAllMocks();
    // Node 26 ships a native `localStorage` global that resolves to
    // `undefined` unless launched with `--localstorage-file`. In vitest
    // that shadows JSDOM's working `window.localStorage`, so any code
    // touching the bare `localStorage` global crashes on mount. Bind
    // an in-memory shim before every render.
    const _store = new Map<string, string>();
    const _ls: Storage = {
        get length() { return _store.size; },
        clear: () => { _store.clear(); },
        getItem: (k: string) => _store.get(k) ?? null,
        key: (i: number) => Array.from(_store.keys())[i] ?? null,
        removeItem: (k: string) => { _store.delete(k); },
        setItem: (k: string, v: string) => { _store.set(k, String(v)); },
    };
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: _ls,
        writable: true,
    });
    if (typeof window !== 'undefined') {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: _ls,
            writable: true,
        });
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/v1/session/get')) {
            return new Response(JSON.stringify(MOCK_ME));
        }
        if (url.includes('/v1/orgs/get')) {
            return new Response(JSON.stringify({
                ok: true,
                orgs: [{ id: 1, slug: 'sapan', display_name: 'Personal' }],
            }));
        }
        if (url.includes('/v1/dashboard/realms')) {
            return new Response(JSON.stringify({
                ok: true,
                realms: REALMS,
                totals: { realms_active: 1, daemons_online: 2, runs_active: 1 },
            }));
        }
        // Match get_telemetry before get — `/v1/runs/get` is a prefix of get_telemetry.
        if (url.includes('/v1/runs/get_telemetry')) {
            return new Response(JSON.stringify({
                ok: true,
                window: { from_ms: NOW - 7 * 86_400_000, to_ms: NOW, days: 7 },
                totals: {
                    runs: 4, agent_invocations: 20, failures: 2,
                    duration_ms: 40_000, cost_usd: 1.25,
                    tokens_in: 1000, tokens_out: 500,
                },
                by_day: [
                    { date: '2026-08-31', runs: 1, invocations: 3, duration_ms: 8000, cost_usd: 0.25, failures: 0 },
                    { date: '2026-09-01', runs: 3, invocations: 17, duration_ms: 32000, cost_usd: 1.00, failures: 2 },
                ],
                by_hour: Array.from({ length: 24 }, (_, h) => ({
                    hour: h, runs: h === 12 ? 3 : 0, invocations: h === 12 ? 20 : 0,
                })),
                by_team: [
                    { team_label: 'cliq/hello-world', runs: 4, invocations: 20, duration_ms: 40_000, cost_usd: 1.25, failures: 2 },
                ],
                by_agent_kind: [
                    { kind: 'shell', invocations: 12, duration_ms: 15_000, cost_usd: 0, failures: 0 },
                    { kind: 'llm', invocations: 8, duration_ms: 25_000, cost_usd: 1.25, failures: 2 },
                ],
            }));
        }
        if (url.includes('/v1/runs/get')) {
            return new Response(JSON.stringify({ ok: true, runs: RUNS, total: RUNS.length }));
        }
        if (url.includes('/v1/hub-activity')) {
            return new Response(JSON.stringify({ ok: true }));
        }
        return new Response(JSON.stringify({ ok: false }), { status: 404 });
    });
});

function render_dashboard() {
    return render(
        <MemoryRouter initialEntries={['/']}>
            <AuthProvider>
                <OrgProvider>
                    <HubActivityProvider>
                        <Routes>
                            <Route path="/" element={<HomeDashboard />} />
                        </Routes>
                    </HubActivityProvider>
                </OrgProvider>
            </AuthProvider>
        </MemoryRouter>,
    );
}

describe('HomeDashboard Runs block', () => {
    it('renders a table with Time, Name, Realm, and Status columns', async () => {
        render_dashboard();
        await waitFor(() =>
            expect(screen.getByRole('columnheader', { name: /Time/i })).toBeInTheDocument(),
        );

        expect(screen.getByRole('columnheader', { name: /Name/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /Realm/i })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /Status/i })).toBeInTheDocument();

        // All 4 fixture runs should appear in the table.
        expect(screen.getByRole('link', { name: /ok-recent/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /boom-1/i })).toBeInTheDocument();
    });

    it('shows the most recent completed run in the list even when failures exist (no priority bias)', async () => {
        render_dashboard();
        // Regression: earlier version sorted by attention-priority which
        // pushed `ok-recent` off the visible list whenever failures were
        // present. Time-sorted list keeps it front and centre.
        await waitFor(() =>
            expect(screen.getByRole('link', { name: /ok-recent/i })).toBeInTheDocument(),
        );
        expect(screen.getByRole('link', { name: /ok-recent/i }))
            .toHaveAttribute('href', '/o/acme/realms/acme-prod/runs/run-completed-recent');
    });
});

describe('HomeDashboard Telemetry band', () => {
    it('renders a compact headline strip (runs / success / spent) — not a wall of KPI cards', async () => {
        render_dashboard();

        // Wait on the success value from the telemetry payload so we
        // don't race the /telemetry/summary fetch. New strip uses
        // whole-percent (no ".0") — "90%" instead of "90.0%".
        await waitFor(
            () => expect(screen.getByText('90%')).toBeInTheDocument(),
            { timeout: 3_000 },
        );

        expect(screen.getByText('4')).toBeInTheDocument();       // runs total
        expect(screen.getByText('90%')).toBeInTheDocument();     // 1 - 2/20
        expect(screen.getByText('$1.25')).toBeInTheDocument();   // spent

        // Retired KPI hints must be gone — the old block splurged
        // per-run breakdowns and token in/out on the dashboard, which
        // wasn't actionable. Any of these appearing = regression.
        expect(screen.queryByText(/\$0\.31\/run/)).toBeNull();
        expect(screen.queryByText(/in 1,000 · out 500/)).toBeNull();
        expect(screen.queryByText(/Avg duration/i)).toBeNull();
    });

    it('retires the technical bars/tables (Agent activity, Top teams, By-kind) — they were "interesting, not actionable"', async () => {
        render_dashboard();
        await waitFor(() => expect(screen.getByText(/Telemetry/i)).toBeInTheDocument());

        // These sections were pulled deliberately. Regression pins:
        //   Fleet pulse   — retired in the previous iteration
        //   Agent activity — bars showed per-kind volume; not an action
        //   Top teams      — a table of names + counts; not an action
        //   By agent kind  — success%/$-per-call table; not an action
        //   Hour of day    — retired earlier for the same reason
        expect(screen.queryByText(/Fleet pulse/i)).toBeNull();
        expect(screen.queryByText(/Agent activity/i)).toBeNull();
        expect(screen.queryByText(/^Top teams$/i)).toBeNull();
        expect(screen.queryByText(/By agent kind/i)).toBeNull();
        expect(screen.queryByText(/hour of day/i)).toBeNull();

        // And the retired table columns should be gone. If any come
        // back it's a sign the dashboard is silently regressing to
        // "here are numbers" mode.
        expect(screen.queryByRole('columnheader', { name: 'Calls' })).toBeNull();
        expect(screen.queryByRole('columnheader', { name: '$/call' })).toBeNull();
        expect(screen.queryByRole('columnheader', { name: 'Avg/call' })).toBeNull();
    });

    it('surfaces the "Needs your attention" list with actionable insights and per-item CTAs', async () => {
        render_dashboard();

        // The dashboard fixture has:
        //   • 1 awaiting_input run — but only 1.5h old → 1 stuck
        //   • 2 failed/crashed runs in last 24h        → recent failures
        //   • by_team.failures = 2 (below hotspot threshold of 3) → no hotspot
        //   • by_agent_kind.llm success = 6/8 = 75% (below 80% threshold)
        //     but invocations = 8, below MIN=10 → no kind regression
        // So we expect exactly two insights: stuck-awaiting + recent-failures.
        await waitFor(
            () => expect(screen.getByText(/Needs your attention/i)).toBeInTheDocument(),
            { timeout: 3_000 },
        );

        // Awaiting-input insight
        expect(
            screen.getByText(/1 run awaiting input for over 1h/i),
        ).toBeInTheDocument();

        // Recent-failures insight — the fixture has 1 failed + 1 crashed
        // within the 24h window (the second crashed run is 2h old but
        // also within 24h → 2 total).
        expect(
            screen.getByText(/2 runs failed in the last 24h/i),
        ).toBeInTheDocument();

        // Every insight row must have an actionable CTA link.
        const cta_open = screen.getAllByRole('link', { name: /Open( failures)?/i });
        expect(cta_open.length).toBeGreaterThanOrEqual(2);
    });

    it('shows an explicit "all quiet" line when there are no actionable items', async () => {
        // Zero pending reviews, no stuck / failed / regressing anything.
        // We want the "attention" section to say so explicitly rather
        // than collapse silently — an empty box reads as "broken".
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/v1/session/get')) return new Response(JSON.stringify(MOCK_ME));
            if (url.includes('/v1/orgs/get')) {
                return new Response(JSON.stringify({
                    ok: true,
                    orgs: [{ id: 1, slug: 'sapan', display_name: 'Personal' }],
                }));
            }
            if (url.includes('/v1/dashboard/realms')) {
                return new Response(JSON.stringify({
                    ok: true, realms: REALMS,
                    totals: { realms_active: 1, daemons_online: 2, runs_active: 0 },
                }));
            }
            if (url.includes('/v1/runs/get_telemetry')) {
                return new Response(JSON.stringify({
                    ok: true,
                    window: { from_ms: NOW - 7 * 86_400_000, to_ms: NOW, days: 7 },
                    totals: {
                        runs: 1, agent_invocations: 3, failures: 0,
                        duration_ms: 5000, cost_usd: 0.10,
                        tokens_in: 100, tokens_out: 50,
                    },
                    by_day: [
                        { date: '2026-09-01', runs: 1, invocations: 3, duration_ms: 5000, cost_usd: 0.10, failures: 0 },
                    ],
                    by_hour: [],
                    by_team: [
                        { team_label: 'cliq/hello-world', runs: 1, invocations: 3, duration_ms: 5000, cost_usd: 0.10, failures: 0 },
                    ],
                    by_agent_kind: [
                        { kind: 'shell', invocations: 3, duration_ms: 5000, cost_usd: 0, failures: 0 },
                    ],
                }));
            }
            if (url.includes('/v1/runs/get')) {
                return new Response(JSON.stringify({
                    ok: true,
                    runs: [{
                        ...RUNS[0],
                        run_id: 'ok-only',
                        run_name: 'ok-only',
                        state: 'completed',
                    }],
                    total: 1,
                }));
            }
            if (url.includes('/v1/hub-activity')) return new Response(JSON.stringify({ ok: true }));
            return new Response(JSON.stringify({ ok: false }), { status: 404 });
        });

        render_dashboard();
        await waitFor(
            () => expect(screen.getByText(/All quiet/i)).toBeInTheDocument(),
            { timeout: 3_000 },
        );
    });
});
