import { useEffect, useRef } from 'react';

/**
 * Calls `callback` on an interval while the component is mounted and
 * the browser tab is visible. Pauses when the tab is hidden to avoid
 * wasting bandwidth in the background.
 */
export function use_poll(callback: () => void, interval_ms: number, enabled = true): void {
    const saved_cb = useRef(callback);
    saved_cb.current = callback;

    useEffect(() => {
        if (!enabled) return;

        let timer: ReturnType<typeof setInterval> | null = null;

        function start() {
            if (timer) return;
            timer = setInterval(() => saved_cb.current(), interval_ms);
        }

        function stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }

        function on_visibility_change() {
            if (document.hidden) {
                stop();
                return;
            }
            saved_cb.current();
            start();
        }

        start();
        document.addEventListener('visibilitychange', on_visibility_change);

        return () => {
            stop();
            document.removeEventListener('visibilitychange', on_visibility_change);
        };
    }, [interval_ms, enabled]);
}
