import { useRef, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import { validate_slug } from '@/lib/validation';

interface Props {
    scope: string;
    name: string;
    author_id?: string;
}

/**
 * Renders the team name heading with an optional "rename" link.
 * Owners and admins see a subtle "rename" text button next to the name;
 * clicking it turns the name into an inline editable input.
 */
export function RenameTeamButton({ scope, name, author_id }: Props) {
    const { user } = useAuth();
    const authFetch = useOrgFetch();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const input_ref = useRef<HTMLInputElement>(null);

    const [editing, setEditing] = useState(false);
    const [new_name, setNewName] = useState(name);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const is_owner = user && author_id && user.id === author_id;
    const is_admin = user && user.role === 'admin';
    const can_rename = is_owner || is_admin;

    const scope_prefix = scope ? `@${scope}/` : '';

    useEffect(() => {
        if (editing && input_ref.current) {
            input_ref.current.focus();
            input_ref.current.select();
        }
    }, [editing]);

    async function handle_save() {
        const trimmed = new_name.trim().toLowerCase();
        if (!trimmed || trimmed === name) {
            setEditing(false);
            setNewName(name);
            return;
        }

        const slug_error = validate_slug(trimmed);
        if (slug_error) {
            setError(slug_error);
            return;
        }

        setSaving(true);
        setError('');

        try {
            const res = await authFetch('/v1/teams/rename', {
                method: 'POST',
                body: JSON.stringify({ scope, name, new_name: trimmed }),
            });
            const data = await res.json();

            if (!data.ok) {
                setError(data.error?.message || 'Rename failed');
                setSaving(false);
                return;
            }

            /* Stay within the current layout context (admin, account, or public). */
            let base = '/browse';
            if (pathname.startsWith('/admin/')) base = '/admin/teams';
            if (pathname.startsWith('/teams')) base = '/teams';
            if (pathname.startsWith('/browse')) base = '/browse';
            navigate(`${base}/${scope}/${trimmed}`);
        } catch {
            setError('Network error');
            setSaving(false);
        }
    }

    function handle_keydown(e: React.KeyboardEvent) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handle_save();
        }
        if (e.key === 'Escape') {
            setEditing(false);
            setNewName(name);
            setError('');
        }
    }

    function start_editing() {
        setNewName(name);
        setError('');
        setEditing(true);
    }

    if (editing) {
        return (
            <div>
                <div className="flex items-center gap-2">
                    <h1 className="flex items-baseline text-3xl font-extrabold">
                        <span>{scope_prefix}</span>
                        <input
                            ref={input_ref}
                            value={new_name}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={handle_keydown}
                            disabled={saving}
                            className="w-auto border-b-2 border-indigo-400 bg-transparent text-3xl font-extrabold text-inherit outline-none focus:border-indigo-600"
                            style={{ minWidth: '4ch', width: `${Math.max(new_name.length, 4)}ch` }}
                        />
                    </h1>
                    <button
                        onClick={handle_save}
                        disabled={saving}
                        className="rounded-lg bg-indigo-600 px-3 py-1 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {saving ? '...' : 'Save'}
                    </button>
                    <button
                        onClick={() => { setEditing(false); setNewName(name); setError(''); }}
                        className="text-sm text-slate-500 hover:text-slate-700"
                    >
                        Cancel
                    </button>
                </div>
                {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
            </div>
        );
    }

    return (
        <h1 className="flex items-baseline gap-2 text-3xl font-extrabold">
            <span>{scope_prefix}{name}</span>
            {can_rename && (
                <button
                    onClick={start_editing}
                    className="text-xs font-normal text-slate-400 hover:text-indigo-500"
                >
                    rename
                </button>
            )}
        </h1>
    );
}
