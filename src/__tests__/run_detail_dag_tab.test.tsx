/**
 * Integration tests for the DAG tab on the unified run detail page.
 *
 * The DAG tab replaces the standalone /runs/:id/live page — clicking
 * it renders the DAG inline. The tab is deep-linkable via `?tab=dag`
 * so the legacy /live URL can redirect users straight to it.
 *
 * We mock DagPanel because its @xyflow/react dependency does its own
 * DOM layout math that isn't meaningful under jsdom; the important
 * thing to pin is that the run detail page mounts it with the
 * correctly-normalised phases and correctly-selected phase.
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

// DagPanel pulls in @xyflow/react — heavy for a tab-visibility test.
// The mock records the props it was rendered with so we can assert
// the adapter fed it the right shape.
const dag_panel_props = vi.fn();
vi.mock('@/components/observability/dag_panel', () => ({
    DagPanel: (props: Record<string, unknown>) => {
        dag_panel_props(props);
        return <div data-testid="mock-dag-panel">MOCK_DAG:{JSON.stringify((props.phases as unknown[]).map((p: unknown) => (p as { name: string }).name))}</div>;
    },
}));

// Timeline + logs pulled in only for tab-switch smoke; stub for speed.
vi.mock('@/components/runs/run_timeline_panel', () => ({
    Run_timeline_panel: () => <div data-testid="mock-timeline">TIMELINE</div>,
}));
vi.mock('@/components/runs/run_logs_section', () => ({
    Run_logs_section: () => <div data-testid="mock-logs">LOGS</div>,
}));

import { Component as Run_detail_page } from '@/pages/runs/run_detail_page';

const RUN_ID = 'run-dag-abc';
const NOW = Date.now();

function build_fetch(overrides: {
    state?: string;
    phases?: readonly Record<string, unknown>[];
} = {}) {
    const phases = overrides.phases ?? [
        { phase: 'plan', status: 'completed', sequence: 0 },
        { phase: 'implement', status: 'running', sequence: 1 },
        { phase: 'verify', status: 'pending', sequence: 2 },
    ];
    return async (url: string) => {
        if (url.includes('/v1/runs/get_by_id')) {
            return {
                json: async () => ({
                    ok: true,
                    run: {
                        run_id: RUN_ID,
                        run_name: 'dag-fixture',
                        state: overrides.state ?? 'running',
                        daemon_id: 'dmn-1',
                        started_at: NOW - 60_000,
                        pending_control: null,
                    },
                }),
            };
        }
        if (url.includes('/v1/runs/get_status')) {
            return { json: async () => ({ ok: true, phases }) };
        }
        if (url.includes('/v1/runs/get')) {
            return { json: async () => ({ ok: true, runs: [], total: 0 }) };
        }
        return { json: async () => ({ ok: true }) };
    };
}

function render_page(initial_url = `/realms/acme-prod/runs/${RUN_ID}`) {
    return render(
        <MemoryRouter initialEntries={[initial_url]}>
            <Routes>
                <Route
                    path="/realms/:realm_slug/runs/:run_id"
                    element={<Run_detail_page />}
                />
            </Routes>
        </MemoryRouter>,
    );
}

describe('Run detail page — DAG tab (unified view)', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
        dag_panel_props.mockReset();
    });

    it('renders three tabs: Logs / Timeline / DAG', async () => {
        auth_fetch.mockImplementation(build_fetch());
        render_page();

        await waitFor(() => screen.getByRole('tab', { name: /logs/i }));
        expect(screen.getByRole('tab', { name: /timeline/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /dag/i })).toBeInTheDocument();
    });

    it('defaults to the timeline tab when no ?tab= is present', async () => {
        auth_fetch.mockImplementation(build_fetch());
        render_page();

        await waitFor(() => screen.getByTestId('mock-timeline'));
        expect(screen.queryByTestId('mock-dag-panel')).toBeNull();
    });

    it('opens the DAG tab when the URL has ?tab=dag (legacy /live redirect target)', async () => {
        auth_fetch.mockImplementation(build_fetch());
        render_page(`/realms/acme-prod/runs/${RUN_ID}?tab=dag`);

        await waitFor(() => screen.getByTestId('mock-dag-panel'));
        expect(screen.queryByTestId('mock-timeline')).toBeNull();

        // The DAG must be mounted with the normalised phase list —
        // adapter smoke-check that the page → adapter → panel wiring
        // is intact and no phases dropped on the floor.
        expect(dag_panel_props).toHaveBeenCalled();
        const last_props = dag_panel_props.mock.calls.at(-1)![0];
        const names = (last_props.phases as { name: string }[]).map((p) => p.name);
        expect(names).toEqual(['plan', 'implement', 'verify']);
    });

    it('clicking the DAG tab switches away from timeline', async () => {
        auth_fetch.mockImplementation(build_fetch());
        render_page();

        // Timeline is the default; wait for that to prove page mounted.
        await waitFor(() => screen.getByTestId('mock-timeline'));
        fireEvent.click(screen.getByRole('tab', { name: /dag/i }));

        await waitFor(() => screen.getByTestId('mock-dag-panel'));
        expect(screen.queryByTestId('mock-timeline')).toBeNull();
    });

    it('ignores unknown ?tab= values and falls back to timeline', async () => {
        auth_fetch.mockImplementation(build_fetch());
        render_page(`/realms/acme-prod/runs/${RUN_ID}?tab=bogus`);

        await waitFor(() => screen.getByTestId('mock-timeline'));
    });

    it('DAG tab still renders when phase list is empty (no crash)', async () => {
        auth_fetch.mockImplementation(build_fetch({ phases: [] }));
        render_page(`/realms/acme-prod/runs/${RUN_ID}?tab=dag`);

        await waitFor(() => screen.getByTestId('mock-dag-panel'));
        const last_props = dag_panel_props.mock.calls.at(-1)![0];
        expect(last_props.phases).toEqual([]);
    });
});
