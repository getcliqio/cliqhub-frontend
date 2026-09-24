export const SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const RESERVED_SLUGS = new Set([
  'local', 'prebuilt', 'cliq', 'admin', 'api', 'bff',
  'new', 'settings', 'login', 'signup', 'logout',
]);

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_SLUG_LENGTH = 2;
export const MAX_SLUG_LENGTH = 64;

export function validate_slug(value: string): string | null {
  if (!value) return 'Slug is required';
  if (value.length < MIN_SLUG_LENGTH) {
    return `Slug must be at least ${MIN_SLUG_LENGTH} characters`;
  }
  if (value.length > MAX_SLUG_LENGTH) {
    return `Slug must be at most ${MAX_SLUG_LENGTH} characters`;
  }
  if (!SLUG_PATTERN.test(value)) {
    return 'Slug must start with a letter and contain only lowercase letters, numbers, and hyphens';
  }
  if (RESERVED_SLUGS.has(value)) {
    return `"${value}" is a reserved name`;
  }
  return null;
}

export function validate_email(value: string): string | null {
  if (!value) return 'Email is required';
  if (!EMAIL_PATTERN.test(value)) return 'Invalid email format';
  return null;
}

export function validate_password(value: string): string | null {
  if (!value) return 'Password is required';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(value)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(value)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[0-9]/.test(value)) {
    return 'Password must contain at least one number';
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    return 'Password must contain at least one special character';
  }
  return null;
}

export function validate_display_name(value: string): string | null {
  if (!value || !value.trim()) return 'Display name is required';
  if (value.trim().length > 100) {
    return 'Display name must be at most 100 characters';
  }
  return null;
}

export function validate_required(
  value: string | null | undefined,
  field_name: string,
): string | null {
  if (!value || !value.trim()) return `${field_name} is required`;
  return null;
}
