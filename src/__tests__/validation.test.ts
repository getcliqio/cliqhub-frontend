import { describe, it, expect } from 'vitest';
import {
    validate_slug,
    validate_email,
    validate_password,
    validate_display_name,
    validate_required,
    RESERVED_SLUGS,
} from '@/lib/validation';

describe('validate_slug', () => {
    it('accepts valid slugs', () => {
        expect(validate_slug('alice')).toBeNull();
        expect(validate_slug('my-team')).toBeNull();
        expect(validate_slug('ab')).toBeNull();
        expect(validate_slug('a1-b2')).toBeNull();
    });

    it('rejects empty slug', () => {
        expect(validate_slug('')).toBe('Slug is required');
    });

    it('rejects too short', () => {
        expect(validate_slug('a')).toContain('at least 2');
    });

    it('rejects uppercase', () => {
        expect(validate_slug('Alice')).toContain('lowercase');
    });

    it('rejects leading number', () => {
        expect(validate_slug('1abc')).toContain('start with a letter');
    });

    it('rejects reserved slugs', () => {
        for (const slug of RESERVED_SLUGS) {
            expect(validate_slug(slug)).toContain('reserved');
        }
    });

    it('rejects special characters', () => {
        expect(validate_slug('my_team')).toContain('lowercase');
        expect(validate_slug('my.team')).toContain('lowercase');
        expect(validate_slug('my team')).toContain('lowercase');
    });
});

describe('validate_email', () => {
    it('accepts valid emails', () => {
        expect(validate_email('alice@example.com')).toBeNull();
        expect(validate_email('a+b@test.co')).toBeNull();
    });

    it('rejects empty', () => {
        expect(validate_email('')).toBe('Email is required');
    });

    it('rejects invalid format', () => {
        expect(validate_email('not-an-email')).toContain('Invalid');
        expect(validate_email('a@')).toContain('Invalid');
        expect(validate_email('@b.com')).toContain('Invalid');
    });
});

describe('validate_password', () => {
    it('accepts valid passwords', () => {
        expect(validate_password('Passw0rd!')).toBeNull();
        expect(validate_password('Str0ng!Pwd' + 'aA1!'.repeat(29))).toBeNull();
    });

    it('rejects empty', () => {
        expect(validate_password('')).toBe('Password is required');
    });

    it('rejects too short', () => {
        expect(validate_password('1234567')).toContain('at least 8');
    });

    it('rejects too long', () => {
        expect(validate_password('a'.repeat(129))).toContain('at most 128');
    });
});

describe('validate_display_name', () => {
    it('accepts valid names', () => {
        expect(validate_display_name('Alice')).toBeNull();
    });

    it('rejects empty', () => {
        expect(validate_display_name('')).toContain('required');
        expect(validate_display_name('   ')).toContain('required');
    });

    it('rejects too long', () => {
        expect(validate_display_name('a'.repeat(101))).toContain('at most 100');
    });
});

describe('validate_required', () => {
    it('passes for non-empty', () => {
        expect(validate_required('hello', 'Field')).toBeNull();
    });

    it('fails for empty/null/undefined', () => {
        expect(validate_required('', 'Name')).toBe('Name is required');
        expect(validate_required(null, 'Name')).toBe('Name is required');
        expect(validate_required(undefined, 'Name')).toBe('Name is required');
    });
});
