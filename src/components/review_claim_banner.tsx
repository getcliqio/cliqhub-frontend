/**
 * ReviewClaimBanner — read-only claim status for multi-reviewer chat.
 * Explicit claim/unclaim endpoints were hard-cut; first message auto-claims.
 */

interface ReviewClaimBannerProps {
    /** Number of distinct reviewer targets. */
    reviewer_count: number;
    /** Current claim holder (null = unclaimed). */
    claimed_by: string | null;
    /** Name of the current claimer (if another user). */
    claimed_by_name?: string;
    /** Current user's ID. */
    current_user_id: string;
    /** Whether the current user has already claimed. */
    is_my_claim: boolean;
}

export function ReviewClaimBanner({
    reviewer_count,
    claimed_by,
    claimed_by_name,
    current_user_id,
    is_my_claim,
}: ReviewClaimBannerProps) {
    /** Don't show the banner for single-reviewer reviews. */
    if (reviewer_count <= 1) return null;

    if (is_my_claim) {
        return (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3">
                <p className="text-sm text-indigo-900">
                    <span className="font-semibold">You claimed this review.</span>{' '}
                    Other reviewers can still view the conversation. Sending the first
                    chat message claims a review automatically.
                </p>
            </div>
        );
    }

    if (claimed_by !== null && claimed_by !== current_user_id) {
        return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-3">
                <p className="text-sm text-amber-900">
                    Claimed by <span className="font-semibold">{claimed_by_name ?? `user #${claimed_by}`}</span>.
                    You can view the chat and submit a verdict, but cannot send messages.
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-3">
            <p className="text-sm font-medium text-slate-800">
                {reviewer_count} reviewers notified
            </p>
            <p className="text-xs text-slate-500">
                Send a chat message to claim this review, or wait for another reviewer.
            </p>
        </div>
    );
}
