/** Onboarding progress from `POST /v1/getting_started/get` (BFF composition). */
export interface Getting_started_realm_ref {
	org_slug: string;
	slug: string;
}

export interface Getting_started_data {
	cli: { done: boolean };
	daemon: { done: boolean; online: number; total: number; realm: Getting_started_realm_ref | null };
	team: { done: boolean; realm: Getting_started_realm_ref | null };
	run: { done: boolean; run_id: string | null; realm: Getting_started_realm_ref | null };
	realm: Getting_started_realm_ref | null;
	done_count: number;
	total: number;
	partial: boolean;
}
