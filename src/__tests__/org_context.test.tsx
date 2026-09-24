/**
 * Tests for OrgProvider / useOrg / useOrgFetch — org context lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AuthProvider } from '@/lib/auth_context';
import { OrgProvider, useOrg, useOrgFetch } from '@/lib/org_context';

const MOCK_ME = {
    ok: true,
    data: {
        user: { id: '1', username: 'alice', display_name: 'Alice', email: 'alice@test.com', role: 'user' },
        scopes: [],
    },
};

const MOCK_ORGS_SINGLE = {
    ok: true,
    data: {
        orgs: [{ id: '10', slug: 'alice', display_name: 'Alice' }],
    },
};

const MOCK_ORGS_MULTI = {
    ok: true,
    data: {
        orgs: [
            { id: '10', slug: 'alice', display_name: 'Alice' },
            { id: '20', slug: 'acme', display_name: 'Acme Corp' },
        ],
    },
};

function mock_fetch(orgs_response: unknown) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/v1/orgs/get')) {
            return new Response(JSON.stringify(orgs_response), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response(JSON.stringify(MOCK_ME), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    });
}

/** Test component that renders org context values. */
function OrgDisplay() {
    const { current_org, orgs, is_multi_org, is_personal, switch_org } = useOrg();
    return (
        <div>
            <span data-testid="org-count">{orgs.length}</span>
            <span data-testid="current-slug">{current_org?.slug ?? 'none'}</span>
            <span data-testid="is-multi">{String(is_multi_org)}</span>
            <span data-testid="is-personal">{String(is_personal)}</span>
            <button onClick={() => switch_org('20')}>switch</button>
        </div>
    );
}

/** Test component that uses useOrgFetch to verify header injection. */
function FetchTester() {
    const { current_org, loading } = useOrg();
    const org_fetch = useOrgFetch();
    async function do_fetch() {
        await org_fetch('/v1/test', { method: 'POST', body: '{}' });
    }
    return (
        <div>
            <span data-testid="ft-ready">{!loading && current_org ? 'ready' : 'loading'}</span>
            <button onClick={do_fetch}>fetch</button>
        </div>
    );
}

function render_with_providers(orgs: unknown, children: React.ReactNode) {
    mock_fetch(orgs);
    return render(
        <MemoryRouter>
            <AuthProvider>
                <OrgProvider>
                    {children}
                </OrgProvider>
            </AuthProvider>
        </MemoryRouter>,
    );
}

describe('OrgContext', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('loads orgs and defaults to personal org', async () => {
        render_with_providers(MOCK_ORGS_SINGLE, <OrgDisplay />);
        await waitFor(() => expect(screen.getByTestId('current-slug').textContent).toBe('alice'));
        expect(screen.getByTestId('org-count').textContent).toBe('1');
        expect(screen.getByTestId('is-multi').textContent).toBe('false');
        expect(screen.getByTestId('is-personal').textContent).toBe('true');
    });

    it('detects multi-org and defaults to personal', async () => {
        render_with_providers(MOCK_ORGS_MULTI, <OrgDisplay />);
        await waitFor(() => expect(screen.getByTestId('current-slug').textContent).toBe('alice'));
        expect(screen.getByTestId('org-count').textContent).toBe('2');
        expect(screen.getByTestId('is-multi').textContent).toBe('true');
        expect(screen.getByTestId('is-personal').textContent).toBe('true');
    });

    it('switch_org changes the active org', async () => {
        render_with_providers(MOCK_ORGS_MULTI, <OrgDisplay />);
        await waitFor(() => expect(screen.getByTestId('current-slug').textContent).toBe('alice'));

        await act(async () => {
            screen.getByText('switch').click();
        });

        expect(screen.getByTestId('current-slug').textContent).toBe('acme');
        expect(screen.getByTestId('is-personal').textContent).toBe('false');
    });

    it('useOrgFetch injects X-Org-Id header', async () => {
        const spy = mock_fetch(MOCK_ORGS_MULTI);
        render(
            <MemoryRouter>
                <AuthProvider>
                    <OrgProvider>
                        <FetchTester />
                    </OrgProvider>
                </AuthProvider>
            </MemoryRouter>,
        );

        await waitFor(() => expect(screen.getByTestId('ft-ready').textContent).toBe('ready'));

        await act(async () => {
            screen.getByText('fetch').click();
        });

        const test_call = spy.mock.calls.find(
            ([input]) => typeof input === 'string' && input.includes('/v1/test'),
        );
        expect(test_call).toBeTruthy();
        const [, init] = test_call!;
        const headers = new Headers((init as RequestInit).headers);
        expect(headers.get('X-Org-Id')).toBe('10');
    });
});
