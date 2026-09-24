/**
 * Unit tests for the phase→DAG adapter.
 *
 * Pins the normalisation behaviour that lets the run detail page
 * render a DAG even when `/v1/runs/get_status` returns the flat
 * legacy shape (no `depends_on`, no `phase_type`).
 */
import { describe, it, expect } from 'vitest';
import { normalize_phases_for_dag } from '@/pages/runs/phase_dag_adapter';

describe('normalize_phases_for_dag', () => {
    it('drops rows with no phase / name', () => {
        expect(normalize_phases_for_dag([
            { phase: '', status: 'completed' },
            { status: 'completed' },
            { phase: 'ok', status: 'completed' },
        ])).toHaveLength(1);
    });

    it('coalesces `name` and `phase` — `name` wins when both are present', () => {
        const out = normalize_phases_for_dag([{ name: 'named', phase: 'phased', status: 'ok' }]);
        expect(out[0].name).toBe('named');
    });

    it('synthesises linear `depends_on` when the backend omits it', () => {
        const out = normalize_phases_for_dag([
            { phase: 'a', status: 'completed', sequence: 0 },
            { phase: 'b', status: 'running', sequence: 1 },
            { phase: 'c', status: 'pending', sequence: 2 },
        ]);
        expect(out[0].depends_on).toEqual([]);
        expect(out[1].depends_on).toEqual(['a']);
        expect(out[2].depends_on).toEqual(['b']);
    });

    it('preserves declared `depends_on` when the backend provides it', () => {
        const out = normalize_phases_for_dag([
            { phase: 'a', status: 'completed' },
            { phase: 'b', status: 'running', depends_on: ['a'] },
            // Fan-in: `c` waits on both `a` and `b`, not just the previous row.
            { phase: 'c', status: 'pending', depends_on: ['a', 'b'] },
        ]);
        expect(out[2].depends_on).toEqual(['a', 'b']);
    });

    it('defaults phase_type to "standard" when missing', () => {
        const out = normalize_phases_for_dag([{ phase: 'a', status: 'ok' }]);
        expect(out[0].phase_type).toBe('standard');
    });

    it('preserves phase_type when present', () => {
        const out = normalize_phases_for_dag([
            { phase: 'gate', status: 'ok', phase_type: 'gate' },
        ]);
        expect(out[0].phase_type).toBe('gate');
    });

    it('uses row index as sequence fallback', () => {
        const out = normalize_phases_for_dag([
            { phase: 'a', status: 'ok' },
            { phase: 'b', status: 'ok' },
        ]);
        expect(out[0].sequence).toBe(0);
        expect(out[1].sequence).toBe(1);
    });

    it('filters out non-string entries in depends_on', () => {
        const out = normalize_phases_for_dag([
            { phase: 'a', status: 'ok' },
            { phase: 'b', status: 'ok', depends_on: ['a', 42, null, ''] as unknown[] },
        ]);
        expect(out[1].depends_on).toEqual(['a']);
    });

    it('falls back to the linear predecessor when depends_on collapses to empty', () => {
        // If `depends_on` was `[]` on the wire (explicit "no deps") we
        // still fall back to the linear predecessor — matches the
        // previous run_observability_page behaviour so we don't
        // silently drop the fallback when we extract the helper.
        const out = normalize_phases_for_dag([
            { phase: 'a', status: 'ok' },
            { phase: 'b', status: 'ok', depends_on: [] },
        ]);
        expect(out[1].depends_on).toEqual(['a']);
    });

    it('leaves max_iterations / iteration undefined when absent', () => {
        const out = normalize_phases_for_dag([{ phase: 'a', status: 'ok' }]);
        expect(out[0].max_iterations).toBeUndefined();
        expect(out[0].iteration).toBeUndefined();
    });

    it('preserves numeric max_iterations / iteration when present', () => {
        const out = normalize_phases_for_dag([
            { phase: 'gate', status: 'ok', max_iterations: 3, iteration: 2 },
        ]);
        expect(out[0].max_iterations).toBe(3);
        expect(out[0].iteration).toBe(2);
    });

    it('handles empty input', () => {
        expect(normalize_phases_for_dag([])).toEqual([]);
    });
});
