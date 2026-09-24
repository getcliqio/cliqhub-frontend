import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { BuilderProvider } from '@/lib/builder/store';
import { StateRestorer, BuilderContent } from '@/components/builder/builder_shell';
import { Breadcrumbs } from '@/components/ui/breadcrumbs';

export function Component() {
    const [search_params] = useSearchParams();

    const crumbs = useMemo(() => {
        const from = search_params.get('from');
        const is_view = search_params.get('view') === '1';
        const is_fork = search_params.get('fork') === '1';

        if ((is_view || is_fork) && from) {
            const decoded = decodeURIComponent(from);
            const parts = decoded.split('/').filter(Boolean);
            const team_label = parts.length >= 2
                ? `@${parts[parts.length - 2]}/${parts[parts.length - 1]}`
                : 'Team';
            return [
                { label: 'Teams', to: '/teams' },
                { label: team_label, to: decoded },
                { label: is_fork ? 'Fork' : 'Edit' },
            ];
        }

        return [
            { label: 'Teams', to: '/teams' },
            { label: 'Builder' },
        ];
    }, [search_params]);

    return (
        <div className="flex flex-col">
            <Breadcrumbs items={crumbs} />
            <Suspense fallback={
                <div className="flex min-h-[60vh] items-center justify-center">
                    <p className="text-xs text-slate-400">Loading...</p>
                </div>
            }>
                <BuilderProvider>
                    <StateRestorer />
                    <BuilderContent />
                </BuilderProvider>
            </Suspense>
        </div>
    );
}
