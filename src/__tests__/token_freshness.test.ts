/**
 * Unit tests for the token freshness classifier.
 *
 * The badge on the tokens page depends entirely on this pure
 * function, so we pin the boundary behaviour (exactly-at-window,
 * grace-period for freshly-minted tokens, malformed dates) rather
 * than only the happy paths.
 */
import { describe, it, expect } from 'vitest';
import {
    classify_token_freshness,
    token_freshness_meta,
    ACTIVE_WINDOW_MS,
    STALE_WINDOW_MS,
    UNUSED_GRACE_MS,
} from '@/lib/token_freshness';

const NOW = new Date('2026-09-08T12:00:00Z').getTime();

function iso_ago(ms: number): string {
    return new Date(NOW - ms).toISOString();
}

describe('classify_token_freshness — used tokens', () => {
    it('returns "active" for a token used just now', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(30 * 24 * 60 * 60 * 1000), last_used_at: iso_ago(0) },
            NOW,
        )).toBe('active');
    });

    it('returns "active" for a token used 3 days ago', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(60 * 24 * 60 * 60 * 1000), last_used_at: iso_ago(3 * 24 * 3600_000) },
            NOW,
        )).toBe('active');
    });

    it('returns "active" at exactly the active-window boundary', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(60 * 24 * 3600_000), last_used_at: iso_ago(ACTIVE_WINDOW_MS) },
            NOW,
        )).toBe('active');
    });

    it('returns "stale" one second past the active window', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(60 * 24 * 3600_000), last_used_at: iso_ago(ACTIVE_WINDOW_MS + 1000) },
            NOW,
        )).toBe('stale');
    });

    it('returns "stale" for a token used 20 days ago', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(60 * 24 * 3600_000), last_used_at: iso_ago(20 * 24 * 3600_000) },
            NOW,
        )).toBe('stale');
    });

    it('returns "stale" at exactly the stale-window boundary', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(60 * 24 * 3600_000), last_used_at: iso_ago(STALE_WINDOW_MS) },
            NOW,
        )).toBe('stale');
    });

    it('returns "inactive" past the stale window', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(120 * 24 * 3600_000), last_used_at: iso_ago(STALE_WINDOW_MS + 1000) },
            NOW,
        )).toBe('inactive');
    });

    it('returns "inactive" for a token last used a year ago', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(400 * 24 * 3600_000), last_used_at: iso_ago(365 * 24 * 3600_000) },
            NOW,
        )).toBe('inactive');
    });
});

describe('classify_token_freshness — never-used tokens', () => {
    it('returns "active" for a freshly-minted token (within grace window)', () => {
        // A just-minted token shouldn't wear a scarlet "unused" badge
        // — the user hasn't had time to install it in their CI yet.
        expect(classify_token_freshness(
            { created_at: iso_ago(60 * 60 * 1000), last_used_at: null },
            NOW,
        )).toBe('active');
    });

    it('returns "active" at exactly the unused-grace boundary', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(UNUSED_GRACE_MS), last_used_at: null },
            NOW,
        )).toBe('active');
    });

    it('returns "unused" past the grace window', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(UNUSED_GRACE_MS + 1000), last_used_at: null },
            NOW,
        )).toBe('unused');
    });

    it('returns "unused" for an old token that was never used', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(90 * 24 * 3600_000), last_used_at: null },
            NOW,
        )).toBe('unused');
    });
});

describe('classify_token_freshness — malformed data', () => {
    it('falls back to "unused" when created_at is unparseable and there\'s no last_used_at', () => {
        expect(classify_token_freshness(
            { created_at: 'not-a-date', last_used_at: null },
            NOW,
        )).toBe('unused');
    });

    it('ignores an unparseable last_used_at (treats as never-used)', () => {
        expect(classify_token_freshness(
            { created_at: iso_ago(UNUSED_GRACE_MS + 1000), last_used_at: 'bogus' },
            NOW,
        )).toBe('unused');
    });
});

describe('token_freshness_meta', () => {
    it('returns a label + tailwind classes for every bucket', () => {
        for (const bucket of ['active', 'stale', 'inactive', 'unused'] as const) {
            const m = token_freshness_meta(bucket);
            expect(m.label).toBe(bucket);
            expect(m.class_name).toMatch(/bg-|text-/);
            expect(m.description.length).toBeGreaterThan(0);
        }
    });

    it('flags "unused" with a warning-toned palette to draw the eye', () => {
        // Softer buckets ("active" / "inactive") should not use rose.
        expect(token_freshness_meta('unused').class_name).toMatch(/rose|red/);
        expect(token_freshness_meta('active').class_name).not.toMatch(/rose|red/);
    });
});
