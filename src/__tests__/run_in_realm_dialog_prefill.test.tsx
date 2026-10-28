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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const auth_fetch = vi.fn();

vi.mock('@/lib/org_context', () => ({
    useOrgFetch: () => auth_fetch,
    useOrg: () => ({
        current_org: { id: 'org-acme', slug: 'acme' },
        current_id: 'org-acme',
        orgs: [], is_multi_org: false, is_personal: false,
        loading: false, switch_org: vi.fn(),
    }),
}));

import { Run_in_realm_dialog } from '@/components/run_in_realm_dialog';

function stub_team_inputs(spec: Array<{ name: string; required?: boolean; description?: string; type?: string; default?: unknown }>) {
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

describe('Run_in_realm_dialog — channel inputs (PLAN-notifications-v2 B4.2)', () => {
    beforeEach(() => {
        auth_fetch.mockReset();
    });

    it('the channel picker lists the channels the run\'s realm can use (sends the realm)', async () => {
        auth_fetch.mockImplementation(async (url: string) => ({
            json: async () => (url === '/v1/orgs/get_reviewable_targets'
                ? { ok: true, data: { people: { items: [], total: 0 }, channels: { items: [{ id: 'c1', name: 'ops', level: 'realm' }], total: 1 } } }
                : stub_team_inputs([{ name: 'reviewers', type: 'channel', required: true }])),
        }));
        render_dialog();
        const picker = await screen.findByPlaceholderText('Search channels…');
        fireEvent.focus(picker);
        await waitFor(() => {
            const call = auth_fetch.mock.calls.find((c) => c[0] === '/v1/orgs/get_reviewable_targets');
            expect(call).toBeTruthy();
            expect(JSON.parse(call![1].body)).toMatchObject({ org_id: 'org-acme', realm_id: 'realm-1' });
        });
        expect(await screen.findByText('ops')).toBeTruthy();
    });
});

describe('Run_in_realm_dialog — typed team inputs', () => {
    beforeEach(() => auth_fetch.mockReset());

    it('a boolean is a checkbox (sent as true / false; untouched = the team default), a number a number, a select a dropdown', async () => {
        auth_fetch.mockImplementation(async (url: string) => ({
            json: async () => (url === '/v1/runs/enqueue'
                ? { ok: true, data: { run_id: 'r1' } }
                : { ok: true, data: { inputs: [
                    { name: 'index', type: 'boolean', default: false },
                    { name: 'strict', type: 'boolean', default: true, required: true },
                    { name: 'limit', type: 'number' },
                    { name: 'mode', type: 'select', choices: ['sync', 'ensure'] },
                ] } }),
        }));
        render_dialog();
        const index = await screen.findByTestId('input-index');
        expect(within(index).getByRole('checkbox')).not.toBeChecked();
        expect(within(screen.getByTestId('input-strict')).getByRole('checkbox')).toBeChecked();
        fireEvent.click(within(index).getByRole('checkbox'));
        fireEvent.change(screen.getByText('limit').closest('label')!.querySelector('input')!, { target: { value: '3' } });
        fireEvent.change(screen.getByText('mode').closest('label')!.querySelector('select')!, { target: { value: 'ensure' } });
        fireEvent.click(screen.getByRole('button', { name: /Start run/ }));
        await waitFor(() => expect(auth_fetch.mock.calls.some((c) => c[0] === '/v1/runs/enqueue')).toBe(true));
        const body = JSON.parse(auth_fetch.mock.calls.find((c) => c[0] === '/v1/runs/enqueue')![1].body);
        expect(body.payload.inputs).toEqual({ index: true, strict: true, limit: 3, mode: 'ensure' });
    });
});

describe('Run_in_realm_dialog — required, optional and field kind', () => {
    beforeEach(() => auth_fetch.mockReset());

    it('reads required as cliq does, marks the rest optional, shows defaults, and keeps long help on one line', async () => {
        auth_fetch.mockResolvedValueOnce({
            json: async () => stub_team_inputs([
                { name: 'item_ids', description: 'x'.repeat(300) },
                { name: 'parsers_branch', required: false, default: 'master' },
                { name: 'root', default: '/opt/parser2.0' },
                { name: 'prompt_text' },
                { name: 'notes', type: 'textarea' },
            ]),
        });
        render_dialog();
        await waitFor(() => screen.getByText('item_ids'));
        const field = (name: string) => screen.getByText(name).closest('label')!;
        // No `required:` → required (as cliq reads it); a default or required: false → optional.
        expect(within(field('item_ids')).getByTitle('Required')).toBeTruthy();
        expect(within(field('parsers_branch')).getByText('optional')).toBeTruthy();
        expect(within(field('root')).getByText('optional')).toBeTruthy();
        expect(field('root').querySelector('input')?.placeholder).toBe('Default: /opt/parser2.0');
        // A long description no longer makes a text area; the name or `type: textarea` does.
        expect(field('item_ids').querySelector('textarea')).toBeNull();
        expect(field('prompt_text').querySelector('textarea')).toBeTruthy();
        expect(field('notes').querySelector('textarea')).toBeTruthy();
    });
});

describe('Run_in_realm_dialog — a page refresh keeps what was typed', () => {
    beforeEach(() => auth_fetch.mockReset());

    it('a rebuilt but identical fixed_realm does not reload the inputs or clear the fields', async () => {
        auth_fetch.mockResolvedValue({ json: async () => stub_team_inputs([{ name: 'item_ids' }]) });
        const view = (realm: { id: string; slug: string; name: string }) => (
            <MemoryRouter>
                <Run_in_realm_dialog scope="acme" slug="feature-dev" fixed_realm={realm} on_close={vi.fn()} />
            </MemoryRouter>
        );
        const { rerender } = render(view({ ...FIXED_REALM }));
        await waitFor(() => screen.getByText('item_ids'));
        const field = () => screen.getByText('item_ids').closest('label')!.querySelector('input')!;
        fireEvent.change(field(), { target: { value: 'itm_A,itm_B' } });
        const calls = auth_fetch.mock.calls.length;
        // The page re-renders on a background refresh and passes a new object with the same values.
        rerender(view({ ...FIXED_REALM }));
        rerender(view({ ...FIXED_REALM }));
        await new Promise((r) => setTimeout(r, 0));
        expect(auth_fetch.mock.calls.length).toBe(calls);
        expect(field().value).toBe('itm_A,itm_B');
    });
});
