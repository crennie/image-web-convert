import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAuditPolicy } from './check-audit-policy.mjs';

const advisory = {
    severity: 'high',
    url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
};
const full = {
    metadata: { vulnerabilities: { high: 1, critical: 0 } },
    vulnerabilities: { tool: { severity: 'high', via: [advisory] } },
};
const production = {
    metadata: { vulnerabilities: { high: 0, critical: 0 } },
    vulnerabilities: {},
};
const exceptions = {
    owner: 'PF-17',
    reason: 'Development tool finding awaiting review',
    expires: '2026-11-17',
    devHighAdvisories: ['GHSA-aaaa-bbbb-cccc'],
};

test('accepts only current, dated development exceptions', () => {
    assert.equal(
        checkAuditPolicy(full, production, exceptions, '2026-11-17')
            .exceptionCount,
        1,
    );
    assert.throws(
        () => checkAuditPolicy(full, production, exceptions, '2026-11-18'),
        /expired/,
    );
    assert.throws(
        () =>
            checkAuditPolicy(
                full,
                production,
                { ...exceptions, expires: '2026-99-99' },
                '2026-10-20',
            ),
        /ISO date/,
    );
    assert.throws(
        () =>
            checkAuditPolicy(
                full,
                production,
                {
                    ...exceptions,
                    devHighAdvisories: [],
                },
                '2026-10-20',
            ),
        /Unreviewed/,
    );
    assert.throws(
        () =>
            checkAuditPolicy(
                { ...full, vulnerabilities: {}, metadata: production.metadata },
                production,
                exceptions,
                '2026-10-20',
            ),
        /Retire resolved/,
    );
});

test('fails for production severity or incomplete registry results', () => {
    assert.throws(
        () =>
            checkAuditPolicy(
                full,
                {
                    ...production,
                    metadata: { vulnerabilities: { high: 1, critical: 0 } },
                },
                exceptions,
                '2026-10-20',
            ),
        /Production audit/,
    );
    assert.throws(
        () =>
            checkAuditPolicy(
                { error: { code: 'ENOTFOUND' } },
                production,
                exceptions,
                '2026-10-20',
            ),
        /missing, malformed, or failed/,
    );
});
