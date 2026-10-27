/**
 * The overview reloads when something changes its counts: answering a Hug marks it stale, and every
 * mounted overview (the nav's HUG count among them) reloads now and again while the Hug closes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { single_org_overview } from './fixtures_overview';

const auth_fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: single_org_overview() })));
vi.mock('@/lib/auth_context', () => ({ useAuthFetch: () => auth_fetch }));

import { mark_overview_stale, use_overview } from '@/lib/overview';

describe('use_overview — stale', () => {
	afterEach(() => { vi.useRealTimers(); auth_fetch.mockClear(); });

	it('reloads at once on mark_overview_stale, then after 3s and 10s; stops when unmounted', async () => {
		vi.useFakeTimers();
		const { unmount } = renderHook(() => use_overview(0));
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		expect(auth_fetch).toHaveBeenCalledTimes(1);

		act(() => mark_overview_stale());
		await act(async () => { await vi.advanceTimersByTimeAsync(0); });
		expect(auth_fetch).toHaveBeenCalledTimes(2);
		await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
		expect(auth_fetch).toHaveBeenCalledTimes(3);
		await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
		expect(auth_fetch).toHaveBeenCalledTimes(4);

		act(() => mark_overview_stale());
		unmount();
		await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
		expect(auth_fetch).toHaveBeenCalledTimes(4);
	});
});
