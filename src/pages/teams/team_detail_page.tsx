import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useAuth} from '@/lib/auth_context';
import { useOrgFetch } from '@/lib/org_context';
import { TeamDetailView } from '@/components/team_detail_view';
import type { TeamDetailData } from '@/components/team_detail_view';

export function Component() {
    const { scope, name } = useParams();
    const [search_params] = useSearchParams();
    const { user } = useAuth();
    const api_fetch = useOrgFetch();
    const [data, set_data] = useState<TeamDetailData | null>(null);
    const [loading, set_loading] = useState(true);

    const target_version = search_params.get('v') || undefined;

    useEffect(() => {
        set_loading(true);
        api_fetch('/v1/teams/get_by_id', {
            method: 'POST',
            body: JSON.stringify({
                scope: scope === '_' ? null : scope,
                name,
                version: target_version,
            }),
        })
            .then((res) => res.json())
            .then((d) => {
                if (d.ok) set_data(d.data);
            })
            .finally(() => set_loading(false));
    }, [api_fetch, scope, name, target_version]);

    if (loading) return <div className="flex min-h-[40vh] items-center justify-center"><p className="text-sm text-slate-400">Loading...</p></div>;
    if (!data) return <div className="flex min-h-[40vh] items-center justify-center"><p className="text-sm text-slate-400">Not found</p></div>;

    const base_path = `/browse/${scope}/${name}`;

    const view = (
        <TeamDetailView data={data} base_path={base_path} display_version={target_version ?? data.latest_version} />
    );

    // ProductShell already pads the main column — match authenticated layout width.
    if (user) return view;

    return (
        <div className="mx-auto w-full max-w-6xl px-6 py-12">
            {view}
        </div>
    );
}
