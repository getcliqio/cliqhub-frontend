import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

export const EXPLORER_PAGE_LIMIT = 50;

export type Time_preset = '1h' | '6h' | '24h' | '7d' | 'all';

const TIME_PRESETS: ReadonlyArray<Time_preset> = ['1h', '6h', '24h', '7d', 'all'];

function parse_preset(raw: string | null): Time_preset {
	if (raw && TIME_PRESETS.includes(raw as Time_preset)) return raw as Time_preset;
	return '24h';
}

export function since_ms_for_preset(preset: Time_preset): number | undefined {
	if (preset === 'all') return undefined;
	const hours: Record<Exclude<Time_preset, 'all'>, number> = {
		'1h': 1,
		'6h': 6,
		'24h': 24,
		'7d': 24 * 7,
	};
	return Date.now() - hours[preset] * 60 * 60 * 1000;
}

export function csv_set(raw: string | null): Set<string> {
	if (!raw?.trim()) return new Set();
	return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

export function set_to_csv(values: Set<string>): string {
	return [...values].sort().join(',');
}

/** URL-synced explorer filters (q, time, offset, multi-value facets). */
export function use_explorer_params(facet_keys: readonly string[]) {
	const [search_params, set_search_params] = useSearchParams();

	const q = search_params.get('q') ?? '';
	const time = parse_preset(search_params.get('time'));
	const offset = Math.max(0, Number(search_params.get('offset') ?? '0') || 0);
	const live = search_params.get('live') === '1';

	const facets = useMemo(() => {
		const out: Record<string, Set<string>> = {};
		for (const key of facet_keys) {
			out[key] = csv_set(search_params.get(key));
		}
		return out;
	}, [facet_keys, search_params]);

	/** Stable window start for the selected preset — do not recompute every render. */
	const since_ms = useMemo(() => since_ms_for_preset(time), [time]);

	const patch = useCallback((updates: Record<string, string | null | undefined>) => {
		set_search_params((prev) => {
			const next = new URLSearchParams(prev);
			for (const [key, value] of Object.entries(updates)) {
				if (value == null || value === '') {
					next.delete(key);
					continue;
				}
				next.set(key, value);
			}
			return next;
		}, { replace: true });
	}, [set_search_params]);

	const set_q = useCallback((value: string) => {
		patch({ q: value.trim() || null, offset: '0' });
	}, [patch]);

	const set_time = useCallback((preset: Time_preset) => {
		patch({ time: preset === '24h' ? null : preset, offset: '0' });
	}, [patch]);

	const set_offset = useCallback((value: number) => {
		patch({ offset: value <= 0 ? null : String(value) });
	}, [patch]);

	const set_live = useCallback((on: boolean) => {
		patch({ live: on ? '1' : null });
	}, [patch]);

	const toggle_facet = useCallback((key: string, value: string) => {
		const current = csv_set(search_params.get(key));
		if (current.has(value)) current.delete(value);
		else current.add(value);
		patch({ [key]: set_to_csv(current) || null, offset: '0' });
	}, [patch, search_params]);

	const clear_facet = useCallback((key: string) => {
		patch({ [key]: null, offset: '0' });
	}, [patch]);

	return {
		q,
		time,
		offset,
		live,
		facets,
		since_ms,
		set_q,
		set_time,
		set_offset,
		set_live,
		toggle_facet,
		clear_facet,
		patch,
	};
}
