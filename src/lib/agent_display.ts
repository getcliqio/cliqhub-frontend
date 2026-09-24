/**
 * Human-friendly display name for an agent slug.
 *
 * Ported from the desktop app so the hub uses the same labels agents
 * are known by in the electron settings panel and CLI output.
 */

const display_overrides: Record<string, string> = {
    'claude-code': 'Claude Code',
    'claude-api': 'Claude API',
    'gemini-api': 'Gemini API',
    'openai-api': 'OpenAI API',
    'auto-gate': 'Auto Gate',
    'gdrive': 'Google Drive',
    's3': 'S3',
    'hug': 'HUG',
};

export function agent_display_name(name: string): string {
    if (display_overrides[name]) return display_overrides[name];
    return name
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}
