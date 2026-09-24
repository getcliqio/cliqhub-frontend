import { useCallback, useState } from 'react';

/** Per-key busy flag so one dispatch action does not lock the whole page. */
export function use_busy() {
	const [busy_keys, set_busy_keys] = useState<Set<string>>(() => new Set());

	const is_busy = useCallback((key: string) => busy_keys.has(key), [busy_keys]);

	const any_busy = busy_keys.size > 0;

	const run_busy = useCallback(async (key: string, fn: () => Promise<void>) => {
		set_busy_keys((prev) => {
			const next = new Set(prev);
			next.add(key);
			return next;
		});
		try {
			await fn();
		} finally {
			set_busy_keys((prev) => {
				const next = new Set(prev);
				next.delete(key);
				return next;
			});
		}
	}, []);

	return { is_busy, any_busy, run_busy };
}
