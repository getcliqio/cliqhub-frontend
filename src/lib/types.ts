export interface User {
  id: string;
  username: string;
  display_name: string;
  email: string;
  role: 'user' | 'admin';
  suspended_at: string | null;
  suspended_reason: string;
  created_at: string;
  preferences: Record<string, unknown>;
}

export interface Org {
  id: number;
  slug: string;
  display_name: string;
  created_at: string;
}

export interface OrgMember {
  org_id: string;
  user_id: string;
  role: 'admin' | 'member';
}

export interface Scope {
  id: number;
  slug: string;
  display_name: string;
  owner_id: string;
  org_id: string | null;
  visibility: 'public' | 'private';
  scope_type: 'user' | 'org';
  created_at: string;
}

export interface ApiToken {
  id: number;
  user_id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface Team {
  id: number;
  name: string;
  scope: string | null;
  scope_type: 'user' | 'org' | null;
  description: string;
  author_id: number | null;
  license: string;
  visibility: 'public' | 'private' | 'draft';
  listed: number;
  created_at: string;
  updated_at: string;
  install_count: number;
}

export interface TeamVersion {
  id: number;
  team_id: number;
  version: string;
  changelog: string;
  package_path: string;
  cliq_version: string | null;
  tools: string[];
  published_at: string;
}

export interface TeamTag {
  team_id: number;
  tag: string;
}

export interface TeamListItem {
  name: string;
  scope: string | null;
  description: string;
  author: string | null;
  latest_version: string;
  install_count: number;
  tags: string[];
  listed?: boolean;
  has_agents?: boolean;
  updated_at?: string;
}

export interface SourceEntry {
  name: string;
  ref?: string;
  url?: string;
  headers?: Record<string, string>;
  method?: string;
  [key: string]: unknown;
}

export interface TargetEntry {
  name: string;
  file: string;
  ref?: string;
  url?: string;
  headers?: Record<string, string>;
  method?: string;
  mode?: 'create' | 'append' | 'replace';
  [key: string]: unknown;
}

/** HUG review configuration (gate + agent: hug). */
export interface ReviewBlock {
  reviewer?: string | string[];
  artifacts?: string[];
  timeout?: string;
  remind_every?: string;
}

export interface WorkflowPhase {
  name: string;
  type: 'standard' | 'gate' | 'team';
  depends_on?: string[];
  commands?: { name: string; run: string; scope?: string; if?: string; escalate_on_fail?: boolean }[];
  max_iterations?: number;
  agent?: string;
  sources?: SourceEntry[];
  target_entries?: TargetEntry[];
  action?: string;
  model?: string;
  role?: string;
  review?: ReviewBlock;
  team?: string;
  inputs?: Record<string, string>;
  is_support?: boolean;
}

export interface RoleDetail {
  name: string;
  content_md: string;
}

export interface TeamParam {
  name: string;
  description?: string;
}

export interface AgentDef {
  entry?: string;
  env?: string[];
}

export interface TeamDetail extends TeamListItem {
  license: string;
  visibility: 'public' | 'private' | 'draft';
  created_at: string;
  updated_at: string;
  versions: { version: string; changelog: string; published_at: string }[];
  roles: RoleDetail[];
  workflow: { phases: WorkflowPhase[]; support?: WorkflowPhase[] };
  agents: Record<string, AgentDef>;
  readme: string;
  cliq_version: string | null;
  tools: string[];
  inputs?: TeamParam[];
  use_when?: string[];
  not_for?: string[];
}

export interface Draft {
  id: number;
  user_id: string;
  title: string;
  team_json: string;
  created_at: string;
  updated_at: string;
}

export interface DraftListItem {
  id: number;
  title: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: number;
  admin_id: number;
  admin_username?: string;
  action: string;
  target_type: string;
  target_id: string;
  details: string;
  created_at: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface AuthContext {
  user: User | null;
  org_slugs: string[];
  scopes: Scope[];
}
