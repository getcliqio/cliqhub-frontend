/**
 * `Quick_run_panel` reads a daemon's live teams and workspaces through Core:
 *
 *   teams/get {daemon_id}       `{ ok, data: { items, total, … } }`
 *   workspaces/get {daemon_id}  `{ ok, data: { workspaces } }` (the daemon's `data`)
 *
 * Pins both reads (the teams read used to look for a daemon envelope and
 * never found the installed team).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { Quick_run_panel } from '@/components/dispatch/run_dialogs';

/** A fetch Response double. */
function json(body: unknown) {
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function auth_fetch_for(teams: unknown, workspaces: unknown) {
    return vi.fn(async (path: string) => {
        if (path === '/v1/teams/get_by_id') return json({ ok: true, data: { inputs: [] } });
        if (path === '/v1/daemons/get') return json({ ok: true, data: { items: [{ id: 'd-1', name: 'laptop', status: 'online' }] } });
        if (path === '/v1/teams/get') return json(teams);
        if (path === '/v1/workspaces/get') return json(workspaces);
        throw new Error(`unexpected ${path}`);
    });
}

const TARGET = { label: 'Dev', scope: 'acme', name: 'dev', last_daemon_id: 'd-1' };

function render_panel(auth_fetch: ReturnType<typeof auth_fetch_for>) {
    return render(
        <MemoryRouter>
            <Quick_run_panel target={TARGET} auth_fetch={auth_fetch as never} submitting={false} on_submit={vi.fn()} on_cancel={vi.fn()} />
        </MemoryRouter>,
    );
}

describe('Quick_run_panel daemon reads', () => {
    it('finds the installed team in data.items and lists data.workspaces', async () => {
        const auth_fetch = auth_fetch_for(
            { ok: true, data: { items: [{ team_id: 't-1', scope: 'acme', slug: 'dev' }], total: 1, offset: 0, limit: 50 } },
            { ok: true, data: { workspaces: [{ workspace_id: 'w-1', workspace_dir: '/proj', name: 'proj', teams: [{ scope: 'acme', slug: 'dev' }] }] } },
        );
        render_panel(auth_fetch);
        await waitFor(() => expect(screen.getByText('proj · assembled')).toBeTruthy());
        expect(screen.queryByText(/Install this team on the/)).toBeNull();
        expect(screen.queryByText(/is not installed on this daemon/)).toBeNull();
    });

    it('says the team is not installed when data.items lacks it', async () => {
        const auth_fetch = auth_fetch_for(
            { ok: true, data: { items: [], total: 0, offset: 0, limit: 50 } },
            { ok: true, data: { workspaces: [{ workspace_id: 'w-1', workspace_dir: '/proj', name: 'proj', teams: [] }] } },
        );
        render_panel(auth_fetch);
        await waitFor(() => expect(screen.getByText(/is not installed on this daemon/)).toBeTruthy());
    });
});
