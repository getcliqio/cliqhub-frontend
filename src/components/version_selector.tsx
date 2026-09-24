import { useNavigate } from 'react-router';

interface Props {
    versions: { version: string }[];
    selected: string;
    base_path: string;
}

/**
 * Shows the current version in the header row.
 * Single version: static label. Multiple versions: dropdown selector.
 */
export function VersionSelector({ versions, selected, base_path }: Props) {
    const navigate = useNavigate();
    const latest = versions[0]?.version;

    if (versions.length <= 1) {
        return (
            <span className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700">
                v{selected}
            </span>
        );
    }

    function handle_change(e: React.ChangeEvent<HTMLSelectElement>) {
        const v = e.target.value;
        if (v === latest) {
            navigate(base_path);
            return;
        }
        navigate(`${base_path}?v=${v}`);
    }

    return (
        <select
            value={selected}
            onChange={handle_change}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-700 outline-none hover:border-slate-300 focus:border-indigo-400"
        >
            {versions.map((v) => (
                <option key={v.version} value={v.version}>
                    v{v.version}{v.version === latest ? ' (latest)' : ''}
                </option>
            ))}
        </select>
    );
}
