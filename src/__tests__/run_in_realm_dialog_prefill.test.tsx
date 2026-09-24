/**
 * Integration tests for `Run_in_realm_dialog`'s prefill behaviour.
 *
 * The dialog is used by "Run again" on the run detail page to seed
 * the form with the previous run's inputs. Pins:
 *   • declared keys land in their input field
 *   • undeclared keys spill into the Extras textarea as key=value
 *   • run_name gets prefilled with the caller-provided value
 *   • no prefill = blank fields (original behaviour intact)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const auth_fetch = vi.fn();

vi.mock('@/lib/org_context', () => ({
    useOrgFetch: () => auth_fetch,
    useOrg: () => ({
        current_org: { id: 1, slug: 'acme' },
        orgs: [], is_multi_org: false, is_personal: false,
        loading: false, switch_org: vi.fn(),
    }),
}));

import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';

function stub_team_inputs(spec: Array<{ name: string; required?: boolean; description?: string }>) {
    // Response shape matches /v1/teams/get_by_id — the dialog reads
    // `data.data.inputs` first, falling back to `data.inputs`.
    return {
        ok: true,
        data: { inputs: spec },
    };
}

const FIXED_REALM = { id: 'realm-1', slug: 'acme-prod', name: 'Acme Prod' };

function render_dialog(props: Partial<React.ComponentProps<typeof Run_in_realm_dialog>> = {}) {
    return render(
        <MemoryRouter>
            <Run_in_realm_dialog
                scope="acme"
                slug="feature-dev"
                fixed_realm={FIXED_REALM}
                on_close={props.on_close ?? vi.fn()}
                {...props}
            />
        </MemoryRouter>,
    );
}

describe('Run_in_realm_dialog — prefill_from', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
    });

    it('starts with blank fields when no prefill is passed (regression)', async () => {
        auth_fetch.mockResolvedValueOnce({
            json: async () => stub_team_inputs([{ name: 'claim_id' }, { name: 'region' }]),
        });
        render_dialog();
        await waitFor(() => screen.getByText(/team inputs/i));
        const claim_input = document.querySelector<HTMLInputElement>('input[type="text"]');
        // First text input is Run name (also blank), so check by looking
        // at the labeled team inputs section.
        const claim = screen.getByText('claim_id').closest('label');
        const claim_field = claim?.querySelector<HTMLInputElement>('input, textarea');
        expect(claim_field?.value).toBe('');
        expect(claim_input).toBeTruthy();
    });

    it('prefills declared inputs with the previous run\'s values', async () => {
        auth_fetch.mockResolvedValueOnce({
            json: async () => stub_team_inputs([
                { name: 'claim_id', required: true },
                { name: 'region' },
            ]),
        });
        render_dialog({
            prefill_from: {
                inputs: { claim_id: 'CLM-1042', region: 'us-west' },
                run_name: 'prior-run (rerun)',
                source_run_id: 'run-abc12345',
            },
        });

        await waitFor(() => screen.getByText('claim_id'));
        const claim_label = screen.getByText('claim_id').closest('label');
        const claim_input = claim_label?.querySelector<HTMLInputElement>('input');
        expect(claim_input?.value).toBe('CLM-1042');

        const region_label = screen.getByText('region').closest('label');
        const region_input = region_label?.querySelector<HTMLInputElement>('input');
        expect(region_input?.value).toBe('us-west');
    });

    it('spills undeclared prefill keys into the Extras textarea', async () => {
        auth_fetch.mockResolvedValueOnce({
            json: async () => stub_team_inputs([{ name: 'claim_id' }]),
        });
        render_dialog({
            prefill_from: {
                inputs: { claim_id: 'CLM-1', trace_id: 'trace-x', region: 'us-west' },
                source_run_id: 'run-abc',
            },
        });

        await waitFor(() => screen.getByText('claim_id'));
        // Extras textarea holds the two undeclared keys as key=value lines.
        const extras = document.querySelector<HTMLTextAreaElement>(
            'textarea[placeholder*="claim_id"], textarea[placeholder*="region"]',
        );
        expect(extras).toBeTruthy();
        // Order of Object.entries isn't guaranteed — assert both keys present.
        expect(extras!.value).toContain('trace_id=trace-x');
        expect(extras!.value).toContain('region=us-west');
        expect(extras!.value).not.toContain('claim_id=');
    });

    it('prefills the Run name field from prefill_from.run_name', async () => {
        auth_fetch.mockResolvedValueOnce({
            json: async () => stub_team_inputs([]),
        });
        render_dialog({
            prefill_from: {
                inputs: {},
                run_name: 'my-prior-run (rerun)',
            },
        });

        await waitFor(() => screen.getByText(/team inputs/i));
        const run_name_input = document.querySelector<HTMLInputElement>(
            'input[placeholder*="auto-generate"]',
        );
        expect(run_name_input?.value).toBe('my-prior-run (rerun)');
    });

    it('shows the "Inputs prefilled from run <id>" hint', async () => {
        auth_fetch.mockResolvedValueOnce({
            json: async () => stub_team_inputs([{ name: 'a' }]),
        });
        render_dialog({
            prefill_from: {
                inputs: { a: '1' },
                source_run_id: 'run-abcdef1234',
            },
        });

        await waitFor(() => screen.getByTestId('prefill-source-hint'));
        const hint = screen.getByTestId('prefill-source-hint');
        // Just the first 8 chars of the run id — full ULIDs are noisy.
        expect(hint.textContent).toContain('run-abcd');
        expect(hint.textContent).toMatch(/prefilled/i);
    });

    it('does NOT show the prefill hint when no prefill is provided', async () => {
        auth_fetch.mockResolvedValueOnce({
            json: async () => stub_team_inputs([{ name: 'a' }]),
        });
        render_dialog();

        await waitFor(() => screen.getByText(/team inputs/i));
        expect(screen.queryByTestId('prefill-source-hint')).toBeNull();
    });
});
