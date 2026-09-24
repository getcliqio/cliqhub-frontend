import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppTopBar } from '@/components/app_top_bar';
import { AppSidebar } from '@/components/app_sidebar';
import { ImpersonationRibbon } from '@/components/impersonation_ribbon';
import { HubActivityProvider } from '@/lib/hub_activity_context';

interface ProductShellProps {
	children: ReactNode;
	/** When true, content renders directly on the canvas (no card wrapper). */
	bleed?: boolean;
}

/** Slot node above the card — used by <Shell_above_card> to portal breadcrumbs. */
const AboveCardSlotContext = createContext<HTMLDivElement | null>(null);

/**
 * Renders children into the slot above the app card (canvas area) via a portal.
 * Use for breadcrumbs so they sit above the floating panel, not inside it.
 * When mounted outside a ProductShell (tests, standalone), falls back to
 * rendering inline so callers don't disappear.
 */
export function Shell_above_card({ children }: { children: ReactNode }) {
	const slot = useContext(AboveCardSlotContext);
	if (!slot) return <>{children}</>;
	return createPortal(children, slot);
}

/** Full-viewport product chrome — top bar, side rail, and a floating content card. */
export function ProductShell({ children, bleed = false }: ProductShellProps) {
	const [slot, set_slot] = useState<HTMLDivElement | null>(null);

	return (
		<HubActivityProvider>
			<div className="app-shell">
				<div className="app-top flex flex-col">
					<ImpersonationRibbon />
					<AppTopBar />
				</div>
				<AppSidebar />
				<main className="app-main">
					<div className="app-main-inner">
						<div
							ref={set_slot}
							className="app-above-card"
							aria-label="Breadcrumb region"
						/>
						<AboveCardSlotContext.Provider value={slot}>
							{bleed ? children : <div className="app-card">{children}</div>}
						</AboveCardSlotContext.Provider>
					</div>
				</main>
			</div>
		</HubActivityProvider>
	);
}
