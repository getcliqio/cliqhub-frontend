import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useAuthFetch } from '@/lib/auth_context';
import { TeamDetailView } from '@/components/team_detail_view';
import type { TeamDetailData } from '@/components/team_detail_view';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

export function Component() {
    const { scope, name } = useParams();
    const [search_params] = useSearchParams();
    const api_fetch = useAuthFetch();
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

    if (loading) {
        return (
            <div>
                <Breadcrumbs items={[{ label: 'Admin', to: '/admin' }, { label: 'Teams', to: '/admin/teams' }, { label: '…' }]} />
                <div className="flex min-h-[40vh] items-center justify-center"><p className="text-sm text-slate-400">Loading...</p></div>
            </div>
        );
    }
    if (!data) {
        return (
            <div>
                <Breadcrumbs items={[{ label: 'Admin', to: '/admin' }, { label: 'Teams', to: '/admin/teams' }, { label: 'Not found' }]} />
                <div className="flex min-h-[40vh] items-center justify-center"><p className="text-sm text-slate-400">Not found</p></div>
            </div>
        );
    }

    const base_path = `/admin/teams/${scope}/${name}`;
    const team_label = scope && scope !== '_' ? `@${scope}/${name}` : (name ?? 'Team');

    return (
        <div>
            <Breadcrumbs
                items={[
                    { label: 'Admin', to: '/admin' },
                    { label: 'Teams', to: '/admin/teams' },
                    { label: team_label },
                ]}
            />
            <TeamDetailView data={data} base_path={base_path} display_version={target_version ?? data.latest_version} />
        </div>
    );
}
