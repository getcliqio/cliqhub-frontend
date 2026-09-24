/**
 * Unit tests for slice 5.5 (`sort_tokens` + option helpers).
 */
import { describe, it, expect } from 'vitest';
import {
	sort_tokens,
	is_token_sort_option,
	TOKEN_SORT_OPTIONS,
} from '@/lib/token_sort';

interface T {
	id: string;
	created_at: string;
	last_used_at: string | null;
}

function tok(id: string, created_at: string, last_used_at: string | null = null): T {
	return { id, created_at, last_used_at };
}

describe('is_token_sort_option', () => {
	it('accepts the three declared options', () => {
		expect(is_token_sort_option('newest')).toBe(true);
		expect(is_token_sort_option('oldest')).toBe(true);
		expect(is_token_sort_option('least_recently_used')).toBe(true);
	});
	it('rejects unknown values and null / undefined', () => {
		expect(is_token_sort_option('mru')).toBe(false);
		expect(is_token_sort_option('')).toBe(false);
		expect(is_token_sort_option(null)).toBe(false);
		expect(is_token_sort_option(undefined)).toBe(false);
	});
});

describe('TOKEN_SORT_OPTIONS', () => {
	it('exposes exactly the three declared options in menu order', () => {
		expect(TOKEN_SORT_OPTIONS.map((o) => o.id)).toEqual([
			'newest',
			'oldest',
			'least_recently_used',
		]);
	});
	it('every id round-trips through the type guard', () => {
		for (const opt of TOKEN_SORT_OPTIONS) {
			expect(is_token_sort_option(opt.id)).toBe(true);
		}
	});
});

describe('sort_tokens — newest', () => {
	it('orders by created_at DESC', () => {
		const tokens = [
			tok('a', '2026-08-01T00:00:00Z'),
			tok('b', '2026-08-05T00:00:00Z'),
			tok('c', '2026-08-03T00:00:00Z'),
		];
		const out = sort_tokens(tokens, 'newest').map((t) => t.id);
		expect(out).toEqual(['b', 'c', 'a']);
	});
	it('is a pure function (does not mutate input)', () => {
		const input = [
			tok('a', '2026-08-01T00:00:00Z'),
			tok('b', '2026-08-05T00:00:00Z'),
		];
		const snapshot = input.map((t) => t.id).join(',');
		sort_tokens(input, 'newest');
		expect(input.map((t) => t.id).join(',')).toBe(snapshot);
	});
});

describe('sort_tokens — oldest', () => {
	it('orders by created_at ASC', () => {
		const tokens = [
			tok('a', '2026-08-01T00:00:00Z'),
			tok('b', '2026-08-05T00:00:00Z'),
			tok('c', '2026-08-03T00:00:00Z'),
		];
		const out = sort_tokens(tokens, 'oldest').map((t) => t.id);
		expect(out).toEqual(['a', 'c', 'b']);
	});
});

describe('sort_tokens — least_recently_used', () => {
	it('puts never-used tokens (null last_used_at) before ever-used', () => {
		const tokens = [
			tok('used-recent', '2026-08-01T00:00:00Z', '2026-08-15T00:00:00Z'),
			tok('never-a', '2026-08-01T00:00:00Z', null),
			tok('used-old', '2026-08-01T00:00:00Z', '2026-07-20T00:00:00Z'),
			tok('never-b', '2026-08-02T00:00:00Z', null),
		];
		const out = sort_tokens(tokens, 'least_recently_used').map((t) => t.id);
		// never-* first, then used-old (older last_used), then used-recent
		expect(out.slice(0, 2).sort()).toEqual(['never-a', 'never-b']);
		expect(out.slice(2)).toEqual(['used-old', 'used-recent']);
	});
	it('tiebreaks two never-used tokens by oldest created_at first', () => {
		const tokens = [
			tok('newer-mint', '2026-08-10T00:00:00Z', null),
			tok('older-mint', '2026-08-01T00:00:00Z', null),
		];
		const out = sort_tokens(tokens, 'least_recently_used').map((t) => t.id);
		// older-mint = "more likely revoke candidate" surfaces first.
		expect(out).toEqual(['older-mint', 'newer-mint']);
	});
	it('tiebreaks two same-last_used_at tokens by oldest created_at', () => {
		const tokens = [
			tok('young', '2026-08-10T00:00:00Z', '2026-08-15T00:00:00Z'),
			tok('old',   '2026-08-01T00:00:00Z', '2026-08-15T00:00:00Z'),
		];
		const out = sort_tokens(tokens, 'least_recently_used').map((t) => t.id);
		expect(out).toEqual(['old', 'young']);
	});
	it('orders ever-used tokens by oldest last_used_at first', () => {
		const tokens = [
			tok('mid',    '2026-08-01T00:00:00Z', '2026-08-10T00:00:00Z'),
			tok('recent', '2026-08-01T00:00:00Z', '2026-08-20T00:00:00Z'),
			tok('early',  '2026-08-01T00:00:00Z', '2026-08-05T00:00:00Z'),
		];
		const out = sort_tokens(tokens, 'least_recently_used').map((t) => t.id);
		expect(out).toEqual(['early', 'mid', 'recent']);
	});
});

describe('sort_tokens — resilience', () => {
	it('handles malformed / unparseable ISO dates without throwing', () => {
		const tokens = [
			tok('a', 'garbage', 'also-garbage'),
			tok('b', '2026-08-05T00:00:00Z', null),
		];
		expect(() => sort_tokens(tokens, 'newest')).not.toThrow();
		expect(() => sort_tokens(tokens, 'least_recently_used')).not.toThrow();
	});
	it('handles empty arrays', () => {
		expect(sort_tokens([], 'newest')).toEqual([]);
		expect(sort_tokens([], 'oldest')).toEqual([]);
		expect(sort_tokens([], 'least_recently_used')).toEqual([]);
	});
	it('handles single-element arrays', () => {
		const single = [tok('only', '2026-08-01T00:00:00Z', null)];
		expect(sort_tokens(single, 'newest').map((t) => t.id)).toEqual(['only']);
		expect(sort_tokens(single, 'least_recently_used').map((t) => t.id)).toEqual(['only']);
	});
});
