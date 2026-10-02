/** Run events → gate route-backs, verdict counts, attempts and the phase feed; the inspector and graph that show them. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { feed_line, gate_progress, local_phase, merge_events, phase_attempts, run_routes, to_run_event, type Run_event } from '@/lib/run_events';
import { Phase_inspector, Run_artifacts, Run_kpis, fmt_bytes } from '@/components/graphite/g_run_parts';
import { Workflow_graph } from '@/components/graphite/g_workflow_graph';
import type { Team_phase } from '@/lib/team_page';

vi.mock('@/components/graphite/g_run_logs', () => ({ G_run_logs: ({ initial_query }: { initial_query?: string }) => <div data-testid="logs">{initial_query ?? 'all'}</div> }));

let n = 0;
const ev = (type: string, phase: string | null, payload: Record<string, unknown> = {}, at = 1000 + n): Run_event => ({ id: `e${n++}`, type, phase, agent: null, payload, at });
const EVENTS: Run_event[] = [
	ev('phase.started', 'implement'),
	ev('thinking', 'implement', { text: 'Timestamp tolerance must be checked first' }),
	ev('tool_call', 'implement', { name: 'edit', input: { path: 'src/webhooks/sign.ts' } }),
	ev('phase.completed', 'implement'),
	ev('phase.started', 'check'),
	ev('gate_verdict', 'check', { outcome: 'ROUTE', reason: '3 tests failing', target: 'implement', iteration: 1, max_iterations: 3 }),
	ev('phase.started', 'implement', { routed_by: 'check', route_reason: '3 tests failing', iteration: 1, max_iterations: 3 }),
];

describe('run events', () => {
	it('parses stream events, local phase names and string payloads', () => {
		expect(local_phase('parent.child')).toBe('child');
		expect(to_run_event({ id: 'u1', event_type: 'thinking', phase: 'a.b', agent: 'cursor', payload: '{"text":"hi"}', timestamp: 5 })).toEqual({ id: 'u1', type: 'thinking', phase: 'b', agent: 'cursor', payload: { text: 'hi' }, at: 5 });
	});
	it('merges without duplicates, oldest first', () => {
		const a = ev('thinking', 'x', {}, 20); const b = ev('thinking', 'x', {}, 10);
		expect(merge_events([a], [b, a]).map((e) => e.id)).toEqual([b.id, a.id]);
	});
	it('finds route-backs with their reason, gate verdict counts and attempts', () => {
		expect(run_routes(EVENTS)).toEqual([{ gate: 'check', to: 'implement', reason: '3 tests failing', iteration: 1, max: 3, at: EVENTS[6].at }]);
		expect(gate_progress(EVENTS)).toEqual({ check: { iteration: 1, max: 3, outcome: 'ROUTE', reason: '3 tests failing' } });
		expect(phase_attempts(EVENTS)).toEqual({ implement: 2, check: 1 });
	});
	it('turns events into feed lines', () => {
		expect(feed_line(EVENTS[2])).toMatchObject({ kind: 'tool', title: 'edit', text: 'src/webhooks/sign.ts' });
		expect(feed_line(EVENTS[5])).toMatchObject({ kind: 'verdict', title: 'Verdict: ROUTE (1 of 3) → implement', text: '3 tests failing' });
		expect(feed_line(EVENTS[6])).toMatchObject({ kind: 'route', title: 'Sent back by check' });
		expect(feed_line(ev('usage_delta', 'x'))).toBeNull();
		expect(fmt_bytes(6100)).toBe('6.0 KB');
	});
});

describe('phase inspector', () => {
	const props = {
		phase: 'implement', run_phase: { phase: 'implement', status: 'running', agent: 'cursor', started_at: 1000, completed_at: null, error: null } as never,
		tel: null, events: EVENTS.filter((e) => e.phase === 'implement'), route: run_routes(EVENTS)[0], run_inputs: { ticket: 'PROJ-491' },
		artifacts: [{ artifact_id: 'a1', phase: 'implement', name: 'diff.patch', description: '14 files', mime_type: 'text/x-diff', size_bytes: 2048, download_url: 'https://x/a1', created_at: 1 }],
		depends_on: ['tests', 'security-scan'], attempt: 2, max_attempts: 3, live: true, run_id: 'r1', realm_id: 'realm-1',
	};
	it('shows why it was sent back, then its activity; tabs for output, input and logs', () => {
		const on_tab = vi.fn(); const on_rerun = vi.fn();
		const { rerender } = render(<Phase_inspector {...props} tab="live" on_tab={on_tab} on_rerun={on_rerun} />);
		const box = screen.getByTestId('phase-inspector');
		expect(box).toHaveTextContent('cursor · attempt 2 of 3 · after tests, security-scan');
		expect(screen.getByTestId('route-banner')).toHaveTextContent('Sent back by check (check 1 of 3)3 tests failing');
		const feed = screen.getByRole('list', { name: 'Activity' });
		expect(within(feed).getByText('Thinking')).toBeInTheDocument();
		expect(within(feed).getByText('src/webhooks/sign.ts')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /Rerun from here/ }));
		expect(on_rerun).toHaveBeenCalled();
		fireEvent.click(screen.getByRole('tab', { name: 'Output' }));
		expect(on_tab).toHaveBeenCalledWith('output');
		rerender(<Phase_inspector {...props} tab="output" on_tab={on_tab} />);
		expect(screen.getByRole('link', { name: 'Download diff.patch' })).toHaveAttribute('href', 'https://x/a1');
		rerender(<Phase_inspector {...props} tab="input" on_tab={on_tab} />);
		expect(screen.getByRole('tabpanel')).toHaveTextContent('Gets the output of tests, security-scan and the feedback from check');
		expect(screen.getByText('PROJ-491')).toBeInTheDocument();
		rerender(<Phase_inspector {...props} tab="logs" log_query="[matcher]" on_tab={on_tab} />);
		expect(screen.getByTestId('logs')).toHaveTextContent('[matcher]');
	});
});

describe('run summary and artifacts', () => {
	it('key numbers: progress, gate checks, waiting on people', () => {
		render(<Run_kpis elapsed_ms={862_000} done={5} total={7} t={null} gates={{ check: { iteration: 1, max: 3, outcome: 'ROUTE', reason: null } }} human_phases={[{ name: 'design-review', ms: 360_000 }]} />);
		const k = screen.getByTestId('run-kpis');
		expect(k).toHaveTextContent('5 / 7 phases');
		expect(k).toHaveTextContent('check 1 / 3route');
		expect(k).toHaveTextContent('6m 0sdesign-review');
	});
	it('artifacts link to their phase and download', () => {
		const on_phase = vi.fn();
		render(<MemoryRouter><Run_artifacts items={[{ artifact_id: 'a1', phase: 'architect', name: 'design.md', description: 'HMAC design', mime_type: 'text/markdown', size_bytes: 6100, download_url: 'https://x/1', created_at: 1 }]} failed={false} on_phase={on_phase} /></MemoryRouter>);
		fireEvent.click(screen.getByRole('button', { name: 'architect' }));
		expect(on_phase).toHaveBeenCalledWith('architect');
		expect(screen.getByText('HMAC design')).toBeInTheDocument();
	});
});

describe('workflow graph with a run', () => {
	const ph = (name: string, type: string, depends_on: string[], max_iterations: number | null = null): Team_phase => ({ name, type, agent: type === 'gate' ? null : 'cursor', depends_on, review: false, reviewers: null, max_iterations, commands: [], sources: [], targets: [], team: null, role: null, support: false });
	it('labels the route back with the reason, counts gate checks and repeat attempts', () => {
		const { container } = render(<Workflow_graph phases={[ph('implement', 'standard', []), ph('check', 'gate', ['implement'], 3)]} statuses={{ implement: 'running' }}
			subs={{ implement: 'running · 3:10' }} attempts={{ implement: 2 }} gate_counts={{ check: '1/3' }} loop_labels={{ check: '↺ check sent back 1/3 · 3 tests failing' }} />);
		expect(container.querySelector('[data-loop="check->implement"]')!.textContent).toContain('3 tests failing');
		expect(container.querySelector('[data-gate-count="1/3"]')).not.toBeNull();
		expect(container.querySelector('[data-attempts="2"]')).not.toBeNull();
		expect(container.textContent).toContain('running · 3:10');
	});
});
