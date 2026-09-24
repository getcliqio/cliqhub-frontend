interface ApiErrorAction {
    /** Button label, e.g. "Run again". */
    label: string;
    /** Click handler. */
    on_click: () => void;
    /** When true, renders the button in a disabled/busy state. */
    busy?: boolean;
}

interface ApiErrorBannerProps {
    error: string | null | undefined;
    className?: string;
    onDismiss?: () => void;
    /**
     * Optional quick-action button (e.g. "Run again" for daemon-stranded
     * errors). Renders inline on the right side of the banner so the
     * user's next step is one click away instead of hunting for it in
     * the header.
     */
    action?: ApiErrorAction;
}

/**
 * Coerce anything a caller might set into state (raw `{code, message}`
 * envelopes, Error instances, arbitrary objects) into a printable string.
 * Prevents React error #31 ("Objects are not valid as a React child") from
 * killing the whole app when an upstream forgets to unwrap `data.error`.
 */
function _to_text(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    if (value instanceof Error) return value.message;
    if (typeof value === 'object') {
        const rec = value as Record<string, unknown>;
        const m = rec.message;
        if (typeof m === 'string' && m.trim()) return m;
        try { return JSON.stringify(value); } catch { return String(value); }
    }
    return String(value);
}

export function ApiErrorBanner({
    error,
    className = '',
    onDismiss,
    action,
}: ApiErrorBannerProps) {
    if (!error) return null;
    const text = _to_text(error);
    if (!text) return null;

    return (
        <div
            role="alert"
            className={`rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 ${className}`}
        >
            <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1">{text}</p>
                <div className="flex shrink-0 items-center gap-2">
                    {action && (
                        <button
                            type="button"
                            onClick={action.on_click}
                            disabled={action.busy}
                            className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {action.busy ? '…' : action.label}
                        </button>
                    )}
                    {onDismiss && (
                        <button
                            type="button"
                            onClick={onDismiss}
                            className="shrink-0 text-red-400 hover:text-red-600"
                            aria-label="Dismiss error"
                        >
                            &times;
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
