/**
 * Build org-scoped realm URLs.
 *
 * The canonical realm URL is: /o/:org/realms/:slug/...
 * This helper ensures consistent URL generation across the app.
 */

/** Build the base realm path: /o/{org}/realms/{slug} */
export function realm_path(org_slug: string, realm_slug: string): string {
    return `/o/${org_slug}/realms/${realm_slug}`;
}

/**
 * Human-readable qualified realm label: `org.slug`
 *
 * Falls back to bare slug when org_slug is unavailable.
 */
export function realm_qualified_label(org_slug: string | null | undefined, realm_slug: string): string {
    if (org_slug) return `${org_slug}.${realm_slug}`;
    return realm_slug;
}

/** Build a realm sub-path: /o/{org}/realms/{slug}/{sub} */
export function realm_sub_path(
    org_slug: string,
    realm_slug: string,
    sub: string,
): string {
    return `${realm_path(org_slug, realm_slug)}/${sub}`;
}
