/**
 * The agent settings form follows the daemon's rule for the git agent: provider defaults to github,
 * so only the GitHub token is asked for and counted; the bitbucket keys appear only for bitbucket.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Agent_field, Agent_settings_view } from '@/lib/agents';

vi.mock('@/lib/auth_context', () => ({ useAuth: () => ({ user: null }), useAuthFetch: () => fetch }));
import { Settings_form } from '@/components/graphite/g_agents';

const f = (key: string, over: Partial<Agent_field> = {}): Agent_field => ({ key, description: null, default: null, when: null, required: true, secret: false, value: null, set: false, source: null, org_value: null, ...over });
const view = (fields: Agent_field[]): Agent_settings_view => ({ scope: 'org', realm: null, fields, required_total: 2, required_configured: 1, ready: false });
const GIT = (token_set: boolean) => view([
	f('provider', { default: 'github' }),
	f('github.token', { when: { provider: 'github' }, secret: true, set: token_set, value: token_set ? '••••abcd' : null, source: token_set ? 'org' : null }),
	f('bitbucket.email', { when: { provider: 'bitbucket' } }),
	f('bitbucket.api_token', { when: { provider: 'bitbucket' }, secret: true }),
	f('bitbucket.workspace', { when: { provider: 'bitbucket' } }),
]);

describe('agent settings form — when + defaults', () => {
	it('GitHub token saved: nothing missing (provider is defaulted, bitbucket keys hidden)', () => {
		render(<Settings_form view={GIT(true)} org_id="o" agent_id="a" on_saved={() => {}} />);
		expect(screen.queryByText(/required keys? still missing/)).toBeNull();
		expect(screen.queryByText('bitbucket.email')).toBeNull();
	});
	it('nothing saved: only the GitHub token is missing', () => {
		render(<Settings_form view={GIT(false)} org_id="o" agent_id="a" on_saved={() => {}} />);
		expect(screen.getByText('1 required key still missing')).toBeInTheDocument();
	});
	it('provider switched to bitbucket in the form: the bitbucket keys show and count', () => {
		render(<Settings_form view={GIT(true)} org_id="o" agent_id="a" on_saved={() => {}} />);
		fireEvent.change(screen.getByLabelText('provider'), { target: { value: 'bitbucket' } });
		expect(screen.getByLabelText('bitbucket.email')).toBeInTheDocument();
		expect(screen.getByText(/3 required keys still missing/)).toBeInTheDocument();
	});
});
