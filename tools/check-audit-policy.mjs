import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const advisoryId = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
const severe = new Set(['high', 'critical']);

function validateAudit(report, label) {
    if (
        !report ||
        report.error ||
        !report.vulnerabilities ||
        !report.metadata?.vulnerabilities
    ) {
        throw new Error(`${label} audit is missing, malformed, or failed`);
    }
    return report.metadata.vulnerabilities;
}

export function checkAuditPolicy(full, production, exceptions, today) {
    const fullCounts = validateAudit(full, 'Full');
    const productionCounts = validateAudit(production, 'Production');
    const expiryTime = Date.parse(`${exceptions.expires}T00:00:00Z`);
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(exceptions.expires) ||
        Number.isNaN(expiryTime) ||
        new Date(expiryTime).toISOString().slice(0, 10) !== exceptions.expires
    )
        throw new Error('Audit exception expiry must be an ISO date');
    if (!exceptions.owner || !exceptions.reason)
        throw new Error('Audit exceptions need an owner and reason');
    if (!Array.isArray(exceptions.devHighAdvisories))
        throw new Error('Audit exception IDs must be an array');
    const allowed = new Set(exceptions.devHighAdvisories);
    if (
        allowed.size !== exceptions.devHighAdvisories.length ||
        [...allowed].some((id) => !advisoryId.test(id))
    ) {
        throw new Error('Audit exception IDs must be unique GHSA IDs');
    }
    if (productionCounts.high || productionCounts.critical)
        throw new Error('Production audit has high or critical findings');
    const current = new Set();
    for (const finding of Object.values(full.vulnerabilities)) {
        if (!severe.has(finding.severity)) continue;
        for (const via of finding.via) {
            if (!via || typeof via !== 'object' || !severe.has(via.severity))
                continue;
            const id = via.url?.split('/').at(-1);
            if (!advisoryId.test(id))
                throw new Error(
                    'Full audit has an unrecognized severe advisory',
                );
            current.add(id);
        }
    }
    if ((fullCounts.high || fullCounts.critical) && !current.size)
        throw new Error('Full audit has severe findings without advisory IDs');
    const unexpected = [...current].filter((id) => !allowed.has(id));
    if (unexpected.length)
        throw new Error(
            `Unreviewed high/critical advisories: ${unexpected.join(', ')}`,
        );
    const stale = [...allowed].filter((id) => !current.has(id));
    if (stale.length)
        throw new Error(
            `Retire resolved audit exceptions: ${stale.join(', ')}`,
        );
    if (allowed.size && today > exceptions.expires)
        throw new Error(`Audit exceptions expired on ${exceptions.expires}`);
    return { fullCounts, productionCounts, exceptionCount: allowed.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const [fullPath, productionPath] = process.argv.slice(2);
        if (!fullPath || !productionPath)
            throw new Error(
                'Usage: check-audit-policy.mjs FULL_JSON PRODUCTION_JSON',
            );
        const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
        const result = checkAuditPolicy(
            readJson(fullPath),
            readJson(productionPath),
            readJson(
                fileURLToPath(
                    new URL('./audit-exceptions.json', import.meta.url),
                ),
            ),
            new Date().toISOString().slice(0, 10),
        );
        console.log(
            `Audit policy passed: production ${result.productionCounts.high} high/${result.productionCounts.critical} critical; full ${result.fullCounts.high} high/${result.fullCounts.critical} critical with ${result.exceptionCount} dated development exceptions.`,
        );
    } catch (error) {
        console.error(`Audit policy failed: ${error.message}`);
        process.exitCode = 1;
    }
}
