import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider } from '@/lib/org_context';
import { Component as RealmDangerPage } from '@/pages/account/realm_danger_page';

const MOCK_ME = {
    ok: true,
    data: {
        user: { id: 1, username: 'sapan', display_name: 'Sapan', email: 's@test.com', role: 'user' },
        scopes: [],
    },
};

const REALM = {
    id: 'rlm_danger',
    slug: 'acme-prod',
    org_slug: 'acme',
    name: 'Acme Production',
    created_by: '1',
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
};

const CONFIRM_SLUG = `${REALM.org_slug}.${REALM.slug}`;

function mock_fetch(opts: {
    remove_ok?: boolean;
    remove_error?: string;
}) {
    const remove_ok = opts.remove_ok ?? true;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/v1/session/get')) {
            return new Response(JSON.stringify(MOCK_ME));
        }
        if (url.includes('/v1/orgs/get')) {
            return new Response(JSON.stringify({ ok: true, orgs: [{ id: 1, slug: 'sapan', display_name: 'Personal' }] }));
        }
        if (url.includes('/v1/realms/get_by_id')) {
            return new Response(JSON.stringify({ ok: true, realm: REALM }));
        }
        if (url.includes('/v1/realms/delete')) {
            if (!remove_ok) {
                return new Response(JSON.stringify({
                    ok: false,
                    error: opts.remove_error ?? 'Cannot delete realm while 1 run(s) are still in progress',
                }));
            }
            return new Response(JSON.stringify({ ok: true }));
        }
        if (url.includes('/v1/hub/activity')) {
            return new Response(JSON.stringify({ ok: true }));
        }
        return new Response(JSON.stringify({ ok: true }));
    });
}

/**
 * Wraps the danger page with a fake realm layout that provides the
 * outlet context the page expects.
 */
function RealmLayoutStub() {
    return <Outlet context={{ realm: REALM, org_slug: REALM.org_slug }} />;
}

function render_page() {
    return render(
        <MemoryRouter initialEntries={[`/o/${REALM.org_slug}/realms/${REALM.slug}/settings/danger`]}>
            <AuthProvider>
                <OrgProvider>
                    <Routes>
                        <Route path="/o/:org/realms/:slug" element={<RealmLayoutStub />}>
                            <Route path="settings/danger" element={<RealmDangerPage />} />
                        </Route>
                        <Route path="/realms" element={<div>Realms list</div>} />
                    </Routes>
                </OrgProvider>
            </AuthProvider>
        </MemoryRouter>,
    );
}

describe('RealmDangerPage', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('gates delete on slug confirm', async () => {
        mock_fetch({});
        render_page();

        await waitFor(() => expect(screen.getByText('Delete realm')).toBeInTheDocument());
        expect(screen.getByText(/Permanently removes/i)).toBeInTheDocument();

        const confirm = screen.getByPlaceholderText(CONFIRM_SLUG);
        const delete_btn = screen.getByRole('button', { name: /Delete this realm/i });
        expect(delete_btn).toBeDisabled();

        fireEvent.change(confirm, { target: { value: 'wrong-slug' } });
        expect(delete_btn).toBeDisabled();

        fireEvent.change(confirm, { target: { value: CONFIRM_SLUG } });
        expect(delete_btn).not.toBeDisabled();
    });

    it('calls delete and navigates to /realms on success', async () => {
        mock_fetch({});
        render_page();

        await waitFor(() => expect(screen.getByText('Delete realm')).toBeInTheDocument());
        fireEvent.change(screen.getByPlaceholderText(CONFIRM_SLUG), {
            target: { value: CONFIRM_SLUG },
        });
        fireEvent.click(screen.getByRole('button', { name: /Delete this realm/i }));

        await waitFor(() => expect(screen.getByText('Realms list')).toBeInTheDocument());

        const remove_calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
            ([url]) => String(url).includes('/v1/realms/delete'),
        );
        expect(remove_calls).toHaveLength(1);
        const body = JSON.parse(String(remove_calls[0][1]?.body ?? '{}')) as { realm_id?: string };
        expect(body.realm_id).toBe(REALM.id);
    });

    it('surfaces API conflict errors without navigating away', async () => {
        mock_fetch({
            remove_ok: false,
            remove_error: 'Cannot delete realm while 1 run(s) are still in progress',
        });
        render_page();

        await waitFor(() => expect(screen.getByText('Delete realm')).toBeInTheDocument());
        fireEvent.change(screen.getByPlaceholderText(CONFIRM_SLUG), {
            target: { value: CONFIRM_SLUG },
        });
        fireEvent.click(screen.getByRole('button', { name: /Delete this realm/i }));

        await waitFor(() =>
            expect(screen.getByText(/still in progress/i)).toBeInTheDocument(),
        );
        expect(screen.queryByText('Realms list')).toBeNull();
    });
});
