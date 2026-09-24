/**
 * Unit tests for the "Run again" prefill helpers.
 *
 * `split_prefill_by_spec` decides which prefill keys land in declared
 * team inputs and which spill into the Extras textarea. This is the
 * hinge for "does the user get the previous run's inputs back". The
 * round-trip through the extras parser also matters — a prefill →
 * submit cycle must preserve keys the team didn't declare.
 *
 * `parse_team_id` is the guard that hides the Run again button when
 * the run row's team_id is malformed / missing, so we can't open a
 * dialog that can't function.
 */
import { describe, it, expect } from 'vitest';
import { split_prefill_by_spec } from '@/components/run_in_realm_dialog';
import { parse_team_id } from '@/pages/runs/run_detail_page';
import { parse_run_inputs_text } from '@/lib/realm_teams_coverage';

describe('split_prefill_by_spec', () => {
    it('routes declared keys into the declared bucket', () => {
        const out = split_prefill_by_spec(
            { inputs: { claim_id: 'CLM-1', region: 'us-west' } },
            [{ name: 'claim_id' }, { name: 'region' }],
        );
        expect(out.declared).toEqual({ claim_id: 'CLM-1', region: 'us-west' });
        expect(out.extras_text).toBe('');
    });

    it('routes undeclared keys into extras as key=value lines', () => {
        const out = split_prefill_by_spec(
            { inputs: { claim_id: 'CLM-1', trace_id: 'abc' } },
            [{ name: 'claim_id' }],
        );
        expect(out.declared).toEqual({ claim_id: 'CLM-1' });
        expect(out.extras_text).toBe('trace_id=abc');
    });

    it('mixes declared and undeclared correctly', () => {
        const out = split_prefill_by_spec(
            { inputs: { a: '1', b: '2', c: '3' } },
            [{ name: 'a' }, { name: 'c' }],
        );
        expect(out.declared).toEqual({ a: '1', c: '3' });
        // Order isn't guaranteed by Object.entries across JS engines,
        // so parse the extras back and compare as a set.
        expect(parse_run_inputs_text(out.extras_text)).toEqual({ b: '2' });
    });

    it('coerces numbers and booleans to strings', () => {
        const out = split_prefill_by_spec(
            { inputs: { count: 42, enabled: true } },
            [{ name: 'count' }, { name: 'enabled' }],
        );
        expect(out.declared).toEqual({ count: '42', enabled: 'true' });
    });

    it('JSON-stringifies nested objects and arrays', () => {
        const out = split_prefill_by_spec(
            { inputs: { config: { key: 'v' }, tags: ['a', 'b'] } },
            [{ name: 'config' }, { name: 'tags' }],
        );
        expect(out.declared).toEqual({
            config: '{"key":"v"}',
            tags: '["a","b"]',
        });
    });

    it('renders null values as empty strings (not the literal "null")', () => {
        // Blank fields on the previous run should remain blank on the
        // new form, not populate a literal "null" the user has to
        // delete.
        const out = split_prefill_by_spec(
            { inputs: { skipped: null } },
            [{ name: 'skipped' }],
        );
        expect(out.declared.skipped).toBe('');
    });

    it('extras round-trip through parse_run_inputs_text', () => {
        // What matters most: a Run again → submit cycle must recover
        // exactly the extras the user had. Assert the extras half of
        // the split re-parses to the original object.
        const inputs = { claim_id: 'CLM-1', trace_id: 'xyz', region: 'us-west' };
        const out = split_prefill_by_spec(
            { inputs },
            [{ name: 'claim_id' }],
        );
        expect(parse_run_inputs_text(out.extras_text))
            .toEqual({ trace_id: 'xyz', region: 'us-west' });
    });

    it('handles an empty inputs object without crashing', () => {
        const out = split_prefill_by_spec(
            { inputs: {} },
            [{ name: 'a' }],
        );
        expect(out.declared).toEqual({});
        expect(out.extras_text).toBe('');
    });

    it('handles an empty spec — everything spills to extras', () => {
        const out = split_prefill_by_spec(
            { inputs: { a: '1', b: '2' } },
            [],
        );
        expect(out.declared).toEqual({});
        expect(parse_run_inputs_text(out.extras_text)).toEqual({ a: '1', b: '2' });
    });
});

describe('parse_team_id', () => {
    it('returns scope/slug for a well-formed team_id', () => {
        expect(parse_team_id('acme/feature-dev')).toEqual({
            scope: 'acme',
            slug: 'feature-dev',
        });
    });

    it('returns null when team_id is null / empty', () => {
        expect(parse_team_id(null)).toBeNull();
        expect(parse_team_id(undefined)).toBeNull();
        expect(parse_team_id('')).toBeNull();
        expect(parse_team_id('   ')).toBeNull();
    });

    it('returns null when scope or slug is missing', () => {
        expect(parse_team_id('/slug')).toBeNull();
        expect(parse_team_id('scope/')).toBeNull();
        expect(parse_team_id('/')).toBeNull();
    });

    it('rejects team_ids with the wrong number of segments', () => {
        // Three segments could look like a legit scope/subscope/slug
        // but the underlying `/v1/teams/get_by_id` only accepts
        // scope+name so we must not offer to run one we can't dispatch.
        expect(parse_team_id('a/b/c')).toBeNull();
        expect(parse_team_id('no-slash-here')).toBeNull();
    });
});
