import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrgFetch } from '@/lib/org_context';
import { ApiErrorBanner } from '@/components/ui/api_error';

interface Mesh_settings_field {
    key: string;
    label: string;
    type: 'string' | 'secret' | 'enum' | 'boolean' | 'url';
    required?: boolean;
    description?: string;
    options?: Array<{ value: string; label: string }>;
    default?: unknown;
}

interface Mesh_adapter_info {
    id: string;
    label: string;
    settings_schema: Mesh_settings_field[];
}

interface Org_mesh_settings {
    org_id?: string;
    org_slug?: string;
    active_provider_id: string | null;
    providers: Record<string, Record<string, unknown>>;
    auto_enable_a2a_on_realm_create: boolean;
    adapters: Mesh_adapter_info[];
}

/** Org-scoped mesh defaults. Uses the active org from OrgContext. */
export function Account_mesh_settings_panel({ org_id }: { org_id?: string }) {
    const auth_fetch = useOrgFetch();
    const [settings, set_settings] = useState<Org_mesh_settings | null>(null);
    const [form, set_form] = useState<Record<string, string>>({});
    const [error, set_error] = useState<string | null>(null);
    const [busy, set_busy] = useState(false);
    const [msg, set_msg] = useState<string | null>(null);

    const load = useCallback(async () => {
        set_error(null);
        const path = org_id != null ? '/v1/orgs/mesh/get' : '/v1/account/mesh/get';
        const body = org_id != null ? { org_id } : {};
        try {
            const res = await auth_fetch(path, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            const text = await res.text();
            let data: Record<string, unknown>;
            try {
                data = JSON.parse(text) as Record<string, unknown>;
            } catch {
                set_error(
                    res.status >= 500
                        ? `Mesh API unavailable (${res.status}). Try again in a moment.`
                        : `Unexpected response (${res.status}) from mesh API.`,
                );
                return;
            }
            if (!data.ok) {
                const err = data.error as { message?: string } | string | undefined;
                const msg = typeof err === 'object' && err?.message
                    ? err.message
                    : (typeof err === 'string' ? err : 'Failed to load mesh settings');
                set_error(msg);
                return;
            }
            set_settings(data as unknown as Org_mesh_settings);
            const provider_id = data.active_provider_id as string | null;
            const providers = (data.providers ?? {}) as Record<string, Record<string, unknown>>;
            const blob = (provider_id && providers[provider_id]) || {};
            const next: Record<string, string> = {};
            for (const [k, v] of Object.entries(blob)) {
                if (k.endsWith('_set')) continue;
                next[k] = v == null ? '' : String(v);
            }
            set_form(next);
        } catch {
            set_error('Network error loading mesh settings');
        }
    }, [auth_fetch, org_id]);

    useEffect(() => {
        void load();
    }, [load]);

    const selected = useMemo(
        () => settings?.adapters.find((a) => a.id === settings.active_provider_id) ?? null,
        [settings],
    );

    async function save(patch: Record<string, unknown>) {
        set_busy(true);
        set_error(null);
        set_msg(null);
        try {
            const path = org_id != null ? '/v1/orgs/mesh/update' : '/v1/account/mesh/update';
            const res = await auth_fetch(path, {
                method: 'POST',
                body: JSON.stringify(org_id != null ? { org_id, ...patch } : patch),
            });
            const text = await res.text();
            let data: Record<string, unknown>;
            try {
                data = JSON.parse(text) as Record<string, unknown>;
            } catch {
                set_error(
                    res.status >= 500
                        ? `Mesh API unavailable (${res.status}). Try again in a moment.`
                        : `Unexpected response (${res.status}) from mesh API.`,
                );
                set_busy(false);
                return;
            }
            if (!data.ok) {
                const err = data.error as { message?: string } | string | undefined;
                const msg = typeof err === 'object' && err?.message
                    ? err.message
                    : (typeof err === 'string' ? err : 'Save failed');
                set_error(msg);
                set_busy(false);
                return;
            }
            set_msg('Saved.');
            await load();
        } catch {
            set_error('Network error');
        }
        set_busy(false);
    }

    if (!settings) {
        return error
            ? <ApiErrorBanner error={error} onDismiss={() => set_error(null)} />
            : <p className="text-sm text-slate-500">Loading A2A settings…</p>;
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-slate-900">A2A</h2>
                <p className="mt-1 text-sm text-slate-600">
                    A2A lets each realm advertise itself as an Agent so other agents can discover and call it.
                    Set org-wide defaults here; realms inherit them unless they override.
                    {settings.org_slug ? (
                        <>
                            {' '}Current org: <code>{settings.org_slug}</code>
                        </>
                    ) : null}
                </p>
            </div>

            {error ? <ApiErrorBanner error={error} onDismiss={() => set_error(null)} /> : null}
            {msg ? <p className="text-sm text-emerald-600">{msg}</p> : null}

            <label className="flex items-center gap-2 text-sm text-slate-800">
                <input
                    type="checkbox"
                    checked={settings.auto_enable_a2a_on_realm_create}
                    disabled={busy}
                    onChange={(e) => void save({ auto_enable_a2a_on_realm_create: e.target.checked })}
                />
                Auto-enable A2A on new realms in this org
            </label>

            <label className="block text-sm font-medium text-slate-800">
                Active mesh provider
                <select
                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
                    value={settings.active_provider_id ?? ''}
                    disabled={busy}
                    onChange={(e) => void save({
                        active_provider_id: e.target.value || null,
                    })}
                >
                    <option value="">None</option>
                    {(settings.adapters ?? []).map((a) => (
                        <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                </select>
            </label>

            {selected ? (
                <div className="space-y-3 rounded-lg border border-slate-200 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">{selected.label} settings</h3>
                    {selected.settings_schema.map((field) => (
                        <label key={field.key} className="block text-sm text-slate-800">
                            {field.label}
                            {field.type === 'enum' ? (
                                <select
                                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                                    value={form[field.key] ?? String(field.default ?? '')}
                                    disabled={busy}
                                    onChange={(e) => set_form((f) => ({ ...f, [field.key]: e.target.value }))}
                                >
                                    {(field.options ?? []).map((o) => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type={field.type === 'secret' ? 'password' : 'text'}
                                    className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
                                    value={form[field.key] ?? ''}
                                    disabled={busy}
                                    placeholder={field.description}
                                    onChange={(e) => set_form((f) => ({ ...f, [field.key]: e.target.value }))}
                                />
                            )}
                        </label>
                    ))}
                    <button
                        type="button"
                        className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                        disabled={busy || !settings.active_provider_id}
                        onClick={() => void save({
                            provider_id: settings.active_provider_id,
                            provider_settings: form,
                        })}
                    >
                        Save provider settings
                    </button>
                </div>
            ) : null}
        </div>
    );
}
