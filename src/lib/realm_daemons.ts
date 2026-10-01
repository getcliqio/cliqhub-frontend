/** Realm › Daemons — types for `POST /v1/realm_daemons/get`. */
export interface Realm_daemon_row {
	id: string;
	name: string | null;
	hostname: string | null;
	owner_email: string | null;
	status: string;
	last_heartbeat: number | null;
	capacity: number | null;
	running: number;
	teams_ready: number | null;
}

export interface Realm_daemons_data {
	realm: { id: string; slug: string; name: string; org_slug: string | null };
	items: Realm_daemon_row[];
	counts: { all: number; online: number; stale: number; offline: number };
	teams_total: number | null;
	truncated: boolean;
	partial: boolean;
}
