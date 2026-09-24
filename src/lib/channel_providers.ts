import type { LucideIcon } from 'lucide-react';
import {
    ArrowUpRight,
    Bell,
    Globe,
    Inbox,
    Mail,
    MessageSquare,
    TicketCheck,
    Webhook,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Destination types (v2 multi-destination model)
// ---------------------------------------------------------------------------

export type DestinationType =
    | 'slack'
    | 'email'
    | 'webhook'
    | 'http'
    | 'jira'
    | 'channel_ref'
    | 'cliqhub';

export interface DestinationTypeMeta {
    id: DestinationType;
    label: string;
    description: string;
    icon: LucideIcon;
}

export const DESTINATION_TYPE_META: DestinationTypeMeta[] = [
    {
        id: 'slack',
        label: 'Slack',
        description: 'Incoming webhook to a Slack channel',
        icon: MessageSquare,
    },
    {
        id: 'email',
        label: 'Email',
        description: 'Hub sends mail — you only pick recipients',
        icon: Mail,
    },
    {
        id: 'webhook',
        label: 'Webhook',
        description: 'POST JSON to your HTTP endpoint',
        icon: Webhook,
    },
    {
        id: 'http',
        label: 'HTTP',
        description: 'POST or PUT JSON to any URL with custom headers',
        icon: Globe,
    },
    {
        id: 'jira',
        label: 'Jira',
        description: 'Create a Jira issue on delivery',
        icon: TicketCheck,
    },
    {
        id: 'channel_ref',
        label: 'Channel Reference',
        description: 'Fan out to another channel',
        icon: ArrowUpRight,
    },
    {
        id: 'cliqhub',
        label: 'In-app',
        description: 'Shows in the Hub Notifications inbox',
        icon: Inbox,
    },
];

/** Destination types users may add to a channel. */
export const USER_DESTINATION_TYPES = DESTINATION_TYPE_META.filter(
    (d) => d.id !== 'cliqhub',
);

export function destination_type_meta(type: string): DestinationTypeMeta {
    const found = DESTINATION_TYPE_META.find((d) => d.id === type);
    if (found) return found;
    return {
        id: 'cliqhub',
        label: type || 'Unknown',
        description: '',
        icon: Bell,
    };
}

export function destination_type_icon(type: string): LucideIcon {
    return destination_type_meta(type).icon;
}

// ---------------------------------------------------------------------------
// Per-type form field definitions
// ---------------------------------------------------------------------------

export interface DestinationField {
    key: string;
    label: string;
    type: 'text' | 'url' | 'select' | 'key_value';
    required: boolean;
    placeholder?: string;
    /** For select fields, the options list. */
    options?: string[];
}

/** Returns the editable form fields for a destination type. */
export function destination_fields(type: DestinationType): DestinationField[] {
    switch (type) {
        case 'slack':
            return [
                { key: 'webhook_url', label: 'Webhook URL', type: 'url', required: true, placeholder: 'https://hooks.slack.com/services/…' },
            ];
        case 'email':
            return [
                { key: 'address', label: 'To', type: 'text', required: true, placeholder: 'ops@example.com' },
                { key: 'cc', label: 'Cc', type: 'text', required: false, placeholder: 'team@example.com' },
                { key: 'bcc', label: 'Bcc', type: 'text', required: false, placeholder: '' },
            ];
        case 'webhook':
            return [
                { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://example.com/hook' },
                { key: 'headers', label: 'Headers', type: 'key_value', required: false },
            ];
        case 'http':
            return [
                { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://api.example.com/notify' },
                { key: 'method', label: 'Method', type: 'select', required: false, options: ['POST', 'PUT'] },
                { key: 'headers', label: 'Headers', type: 'key_value', required: false },
            ];
        case 'jira':
            return [
                { key: 'url', label: 'Jira URL', type: 'url', required: true, placeholder: 'https://yourco.atlassian.net' },
                { key: 'project_key', label: 'Project Key', type: 'text', required: true, placeholder: 'OPS' },
                { key: 'issue_type', label: 'Issue Type', type: 'text', required: true, placeholder: 'Task' },
                { key: 'auth_header', label: 'Auth Header', type: 'text', required: false, placeholder: 'Basic …' },
            ];
        case 'channel_ref':
            return [
                { key: 'name', label: 'Channel Name', type: 'text', required: true, placeholder: 'ops-alerts' },
            ];
        case 'cliqhub':
            return [];
    }
}

// ---------------------------------------------------------------------------
// Legacy compat — single-provider types (used by old code paths)
// ---------------------------------------------------------------------------

export type Channel_provider = 'slack' | 'email' | 'webhook' | 'cliqhub';

export interface Channel_provider_meta {
    id: Channel_provider;
    label: string;
    description: string;
    icon: LucideIcon;
}

export const CHANNEL_PROVIDER_META: Channel_provider_meta[] = [
    {
        id: 'cliqhub',
        label: 'In-app',
        description: 'Shows in the Hub Notifications inbox',
        icon: Inbox,
    },
    {
        id: 'slack',
        label: 'Slack',
        description: 'Incoming webhook to a Slack channel',
        icon: MessageSquare,
    },
    {
        id: 'email',
        label: 'Email',
        description: 'Hub sends mail — you only pick recipients',
        icon: Mail,
    },
    {
        id: 'webhook',
        label: 'Webhook',
        description: 'POST JSON to your HTTP endpoint',
        icon: Webhook,
    },
];

export const USER_CHANNEL_PROVIDERS = CHANNEL_PROVIDER_META.filter((p) => p.id !== 'cliqhub');

export function provider_meta(provider: string): Channel_provider_meta {
    const found = CHANNEL_PROVIDER_META.find((p) => p.id === provider);
    if (found) return found;
    return {
        id: 'cliqhub',
        label: provider || 'Channel',
        description: '',
        icon: Bell,
    };
}

export function provider_icon(provider: string): LucideIcon {
    return provider_meta(provider).icon;
}

export function empty_provider_config(provider: Channel_provider): Record<string, string> {
    if (provider === 'slack') return { webhook_url: '' };
    if (provider === 'email') {
        return {
            to: '',
            cc: '',
            bcc: '',
        };
    }
    if (provider === 'webhook') return { url: '' };
    return {};
}

export function build_provider_config(
    provider: Channel_provider,
    fields: Record<string, string>,
): Record<string, unknown> {
    if (provider === 'slack') {
        return { webhook_url: fields.webhook_url?.trim() ?? '' };
    }
    if (provider === 'email') {
        const config: Record<string, unknown> = {
            to: fields.to?.trim() ?? '',
        };
        if (fields.cc?.trim()) config.cc = fields.cc.trim();
        if (fields.bcc?.trim()) config.bcc = fields.bcc.trim();
        return config;
    }
    if (provider === 'webhook') {
        return { url: fields.url?.trim() ?? '' };
    }
    return {};
}
