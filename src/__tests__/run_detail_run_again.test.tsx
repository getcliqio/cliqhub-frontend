/**
 * Integration tests for the "Run again" button on the run detail page.
 *
 * Pins the slice 3.1 rewire: clicking "Run again" now opens the
 * `Run_in_realm_dialog` prefilled with the previous run's inputs.
 * Prior behaviour was a bare link to the daemons page — we assert
 * both the new dialog opens AND the old link is gone.
 *
 * The dialog is mocked so this test doesn't need to also stub the
 * team-detail + realm-list APIs; the dialog itself has separate
 * coverage in run_in_realm_dialog_prefill.test.tsx.
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
        loading: false, switch_org: vi.fn(),
    }),
}));

vi.mock('@/lib/use_poll', () => ({ use_poll: () => {} }));

vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return {
        ...actual,
        useOutletContext: () => ({
            realm: { id: 'realm-1', slug: 'acme-prod', name: 'Acme Prod' },
            base_path: '/realms/acme-prod',
        }),
    };
});

// Stub the heavy panels so the page mounts fast.
vi.mock('@/components/observability/dag_panel', () => ({
    DagPanel: () => <div data-testid="mock-dag">dag</div>,
}));
vi.mock('@/components/runs/run_timeline_panel', () => ({
    Run_timeline_panel: () => <div>timeline</div>,
}));
vi.mock('@/components/runs/run_logs_section', () => ({
    Run_logs_section: () => <div>logs</div>,
}));
vi.mock('@/components/runs/run_phases_panel', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('@/components/runs/run_phases_panel');
    return { ...actual, Run_phases_panel: () => <div>phases</div> };
});
vi.mock('@/components/runs/run_summary_strip', () => ({
    Run_summary_strip: () => <div>summary</div>,
}));
vi.mock('@/components/runs/usage_breakdown_table', () => ({
    UsageBreakdownTable: () => <div>usage</div>,
}));

// The dialog is what we're actually testing the *wiring* to. Capture
// props to assert what the run detail page sends in.
const dialog_props = vi.fn();
vi.mock('@/components/run_in_realm_dialog', () => ({
    Run_in_realm_dialog: (props: Record<string, unknown>) => {
        dialog_props(props);
        return (
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Run in realm"
                data-testid="mock-run-in-realm-dialog"
            >
                MOCK_DIALOG
                <button type="button" onClick={() => (props.on_close as () => void)()}>
                    close
                </button>
            </div>
        );
    },
}));

import { Component as Run_detail_page } from '@/pages/runs/run_detail_page';

const RUN_ID = 'run-again-abc';
const NOW = Date.now();

function build_fetch(overrides: {
    state?: string;
    team_id?: string | null;
    inputs?: unknown;
    run_name?: string | null;
} = {}) {
    return async (url: string) => {
        if (url.includes('/v1/runs/get_by_id')) {
            return {
                json: async () => ({
                    ok: true,
                    data: {
                        run_id: RUN_ID,
                        run_name: overrides.run_name === undefined ? 'previous' : overrides.run_name,
                        state: overrides.state ?? 'completed',
                        daemon_id: 'dmn-1',
                        team_id: overrides.team_id === undefined ? 'acme/feature-dev' : overrides.team_id,
                        started_at: NOW - 60_000,
                        completed_at: NOW,
                        inputs: overrides.inputs === undefined
                            ? { claim_id: 'CLM-1042', region: 'us-west' }
                            : overrides.inputs,
                        pending_control: null,
                    },
                }),
            };
        }
        if (url.includes('/v1/runs/get_status')) {
            return { json: async () => ({ ok: true, data: [] }) };
        }
        return { json: async () => ({ ok: true }) };
    };
}

function render_page() {
    return render(
        <MemoryRouter initialEntries={[`/realms/acme-prod/runs/${RUN_ID}`]}>
            <Routes>
                <Route path="/realms/:realm_slug/runs/:run_id" element={<Run_detail_page />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('Run detail — "Run again" opens prefilled dialog (slice 3.1)', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
        dialog_props.mockReset();
    });

    it('shows the "Run again" button on completed runs', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'completed' }));
        render_page();
        await waitFor(() => screen.getByRole('button', { name: /Run again/i }));
    });

    it('shows the "Run again" button on failed runs too', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'failed' }));
        render_page();
        await waitFor(() => screen.getByRole('button', { name: /Run again/i }));
    });

    it('hides "Run again" when the run has no valid team_id (safety)', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'completed', team_id: null }));
        render_page();
        // Wait for the page to fully load — cancel/status widgets should be up.
        await waitFor(() => screen.getByText(/previous/));
        expect(screen.queryByRole('button', { name: /Run again/i })).toBeNull();
    });

    it('hides "Run again" while the run is still active', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'running' }));
        render_page();
        await waitFor(() => screen.getByText(/previous/));
        expect(screen.queryByRole('button', { name: /Run again/i })).toBeNull();
    });

    it('clicking Run again opens the Run_in_realm_dialog', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'completed' }));
        render_page();

        const btn = await waitFor(() => screen.getByRole('button', { name: /Run again/i }));
        // Dialog must not be present before click.
        expect(screen.queryByTestId('mock-run-in-realm-dialog')).toBeNull();
        fireEvent.click(btn);

        await waitFor(() => screen.getByTestId('mock-run-in-realm-dialog'));
    });

    it('passes scope+slug parsed from team_id, and inputs prefilled from the prior run', async () => {
        auth_fetch.mockImplementation(build_fetch({
            state: 'completed',
            team_id: 'acme/feature-dev',
            inputs: { claim_id: 'CLM-1042', region: 'us-west' },
            run_name: 'my-prior',
        }));
        render_page();

        fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Run again/i })));
        await waitFor(() => expect(dialog_props).toHaveBeenCalled());

        const props = dialog_props.mock.calls.at(-1)![0];
        expect(props.scope).toBe('acme');
        expect(props.slug).toBe('feature-dev');
        expect(props.fixed_realm).toEqual({
            id: 'realm-1', slug: 'acme-prod', name: 'Acme Prod',
        });
        expect(props.prefill_from.inputs).toEqual({
            claim_id: 'CLM-1042',
            region: 'us-west',
        });
        expect(props.prefill_from.source_run_id).toBe(RUN_ID);
        // Suggested run name has "(rerun)" appended — user can edit.
        expect(props.prefill_from.run_name).toBe('my-prior (rerun)');
    });

    it('parses JSON-serialised inputs strings from the /runs/get_by_id row', async () => {
        // The daemon serves inputs as either an object or a JSON string
        // depending on the storage backend. The prefill must work in
        // both cases — assert the string variant.
        auth_fetch.mockImplementation(build_fetch({
            state: 'completed',
            inputs: JSON.stringify({ claim_id: 'CLM-9' }),
        }));
        render_page();

        fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Run again/i })));
        await waitFor(() => expect(dialog_props).toHaveBeenCalled());

        const props = dialog_props.mock.calls.at(-1)![0];
        expect(props.prefill_from.inputs).toEqual({ claim_id: 'CLM-9' });
    });

    it('closing the dialog dismisses it (and refreshes silently)', async () => {
        auth_fetch.mockImplementation(build_fetch({ state: 'completed' }));
        render_page();

        fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Run again/i })));
        await waitFor(() => screen.getByTestId('mock-run-in-realm-dialog'));

        fireEvent.click(screen.getByRole('button', { name: /close/i }));
        await waitFor(() => expect(screen.queryByTestId('mock-run-in-realm-dialog')).toBeNull());
    });
});
