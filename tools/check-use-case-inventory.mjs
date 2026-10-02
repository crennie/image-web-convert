import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
const jsonPath = 'docs/testing/use-case-inventory.json';
const summaryPath = 'docs/testing/use-case-inventory.md';
const errors = [];
const fileCache = new Map();
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const compact = (value) => value.replace(/\s+/gu, ' ').trim();

function fail(message) {
    errors.push(message);
}

function repositoryFile(reference, label) {
    if (
        !isText(reference) ||
        path.isAbsolute(reference) ||
        reference.split(/[\\/]/u).includes('..')
    ) {
        fail(`${label}: expected a repository-relative file path`);
        return;
    }
    if (fileCache.has(reference)) return fileCache.get(reference);
    try {
        const resolved = realpathSync(path.resolve(root, reference));
        if (!resolved.startsWith(`${root}${path.sep}`)) {
            fail(`${label}: path leaves the repository: ${reference}`);
            return;
        }
        if (!statSync(resolved).isFile()) {
            fail(`${label}: not a file: ${reference}`);
            return;
        }
        const content = readFileSync(resolved, 'utf8');
        fileCache.set(reference, content);
        return content;
    } catch {
        fail(`${label}: missing or unreadable file: ${reference}`);
    }
}

function cells(line) {
    return line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
}

function catalog(summary) {
    const section = summary
        .split('## Test evidence catalog')[1]
        ?.split('## Coverage limits')[0];
    if (!section) {
        fail('Markdown summary: missing test evidence catalog');
        return new Map();
    }
    const entries = new Map();
    for (const line of section.split('\n')) {
        if (!/^\| E\d+ \|/u.test(line)) continue;
        const row = cells(line);
        const reference = row[2]?.match(/`([^`]+)`\s*—\s*`([^`]+)`/u);
        if (
            row.length !== 4 ||
            !reference ||
            !isText(reference[1]) ||
            !isText(reference[2]) ||
            !isText(row[1]) ||
            !isText(row[3])
        ) {
            fail(`Markdown evidence ${row[0]}: malformed row`);
            continue;
        }
        if (entries.has(row[0])) fail(`Markdown evidence: duplicate ${row[0]}`);
        const content = repositoryFile(
            reference[1],
            `Markdown evidence ${row[0]} test`,
        );
        if (content && !compact(content).includes(compact(reference[2])))
            fail(
                `Markdown evidence ${row[0]}: test title or template not found`,
            );
        entries.set(row[0], {
            layer: row[1],
            file: reference[1],
            name: reference[2],
        });
    }
    return entries;
}

function caseRows(summary) {
    const section = summary
        .split('## Use cases')[1]
        ?.split('## Reconciliation with implementation')[0];
    if (!section) {
        fail('Markdown summary: missing use-case tables');
        return new Map();
    }
    const rows = new Map();
    for (const line of section.split('\n')) {
        if (!/^\| UC-\d+ \|/u.test(line)) continue;
        const row = cells(line);
        if (row.length !== 9) {
            fail(`Markdown case ${row[0]}: expected 9 columns`);
            continue;
        }
        if (rows.has(row[0])) fail(`Markdown cases: duplicate ${row[0]}`);
        rows.set(row[0], {
            evidence:
                row[6] && row[6] !== '—'
                    ? row[6].split(',').map((id) => id.trim())
                    : [],
            coverage: row[8],
        });
    }
    return rows;
}

const source = repositoryFile(jsonPath, 'JSON inventory');
const summary = repositoryFile(summaryPath, 'Markdown summary');
if (source === undefined || summary === undefined) {
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
}

let inventory;
try {
    inventory = JSON.parse(source);
} catch (error) {
    console.error(`Invalid ${jsonPath}: ${error.message}`);
    process.exit(1);
}
if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    console.error(`Invalid ${jsonPath}: expected an object`);
    process.exit(1);
}

if (inventory.schemaVersion !== 1) fail('schemaVersion must be 1');
if (!isText(inventory.scope)) fail('scope must be nonempty');
if (!['pending', 'reviewed'].includes(inventory.testMappingStatus))
    fail('testMappingStatus must be pending or reviewed');
for (const field of ['excluded', 'documentedLimitations']) {
    if (!Array.isArray(inventory[field]) || !inventory[field].every(isText))
        fail(`${field} must be an array of nonempty strings`);
}
if (!Array.isArray(inventory.areas) || inventory.areas.length === 0)
    fail('areas must be a nonempty array');

const evidence = catalog(summary);
const rows = caseRows(summary);
const ids = new Set();
const areas = new Set();
const evidenceIdentity = new Map();
const counts = { covered: 0, partial: 0, missing: 0 };

for (const area of Array.isArray(inventory.areas) ? inventory.areas : []) {
    if (!area || typeof area !== 'object' || Array.isArray(area)) {
        fail('areas must contain objects');
        continue;
    }
    if (!isText(area.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(area.id))
        fail(`area ${area.id}: expected a kebab-case id`);
    if (areas.has(area.id)) fail(`duplicate area id: ${area.id}`);
    areas.add(area.id);
    if (!Array.isArray(area.sources) || area.sources.length === 0)
        fail(`area ${area.id}: sources must be nonempty`);
    for (const reference of Array.isArray(area.sources) ? area.sources : [])
        repositoryFile(reference, `area ${area.id} source`);
    if (!Array.isArray(area.cases) || area.cases.length === 0)
        fail(`area ${area.id}: cases must be nonempty`);

    for (const useCase of Array.isArray(area.cases) ? area.cases : []) {
        if (!useCase || typeof useCase !== 'object' || Array.isArray(useCase)) {
            fail(`area ${area.id}: cases must contain objects`);
            continue;
        }
        const id = useCase.id;
        if (!/^UC-\d{3}$/u.test(id)) fail(`invalid case id: ${id}`);
        if (ids.has(id)) fail(`duplicate case id: ${id}`);
        ids.add(id);
        for (const field of ['actor', 'given', 'when', 'then'])
            if (!isText(useCase[field]))
                fail(`${id}: ${field} must be nonempty`);
        if (!Array.isArray(useCase.sources) || useCase.sources.length === 0)
            fail(`${id}: sources must be nonempty`);
        for (const reference of Array.isArray(useCase.sources)
            ? useCase.sources
            : []) {
            repositoryFile(reference, `${id} source`);
            if (!area.sources?.includes(reference))
                fail(`${id}: source absent from area ${area.id}: ${reference}`);
        }
        if (!Array.isArray(useCase.tests))
            fail(`${id}: tests must be an array`);
        if (!Array.isArray(useCase.gaps)) fail(`${id}: gaps must be an array`);
        const verdict = useCase.coverage;
        if (verdict !== undefined && !Object.hasOwn(counts, verdict))
            fail(`${id}: invalid coverage verdict: ${verdict}`);
        if (inventory.testMappingStatus === 'reviewed') {
            if (!Object.hasOwn(counts, verdict))
                fail(`${id}: reviewed case needs coverage`);
            if (verdict !== 'missing' && !useCase.tests?.length)
                fail(`${id}: ${verdict} case needs test evidence`);
            if (verdict === 'covered' && useCase.gaps?.length)
                fail(`${id}: covered case cannot retain gaps`);
            if (verdict !== 'covered' && !useCase.gaps?.length)
                fail(`${id}: ${verdict} case needs a specific gap`);
        }
        if (Object.hasOwn(counts, verdict)) counts[verdict]++;
        if (Array.isArray(useCase.gaps) && !useCase.gaps.every(isText))
            fail(`${id}: gaps must contain nonempty strings`);

        const row = rows.get(id);
        if (inventory.testMappingStatus === 'reviewed' && !row)
            fail(`${id}: missing from Markdown summary`);
        if (row && verdict !== row.coverage)
            fail(`${id}: Markdown and JSON coverage differ`);
        const testIds = [];
        for (const test of Array.isArray(useCase.tests) ? useCase.tests : []) {
            if (!test || typeof test !== 'object' || Array.isArray(test)) {
                fail(`${id}: tests must contain objects`);
                continue;
            }
            if (!/^E\d+$/u.test(test.evidenceId))
                fail(`${id}: invalid evidence ID: ${test.evidenceId}`);
            testIds.push(test.evidenceId);
            if (testIds.filter((key) => key === test.evidenceId).length > 1)
                fail(`${id}: duplicate evidence ID ${test.evidenceId}`);
            for (const field of ['name', 'layer', 'environment', 'asserts'])
                if (!isText(test[field]))
                    fail(`${id}/${test.evidenceId}: ${field} must be nonempty`);
            const content = repositoryFile(
                test.file,
                `${id}/${test.evidenceId} test`,
            );
            if (
                content &&
                isText(test.name) &&
                !compact(content).includes(compact(test.name))
            )
                fail(
                    `${id}/${test.evidenceId}: test title or template not found`,
                );
            const identity = `${test.file}\u0000${test.name}\u0000${test.layer}`;
            if (
                evidenceIdentity.has(test.evidenceId) &&
                evidenceIdentity.get(test.evidenceId) !== identity
            )
                fail(
                    `${id}/${test.evidenceId}: evidence identity differs between cases`,
                );
            evidenceIdentity.set(test.evidenceId, identity);
            const entry = evidence.get(test.evidenceId);
            if (
                !entry ||
                entry.file !== test.file ||
                entry.name !== test.name ||
                entry.layer !== test.layer
            )
                fail(
                    `${id}/${test.evidenceId}: differs from Markdown evidence catalog`,
                );
        }
        if (
            row &&
            (testIds.length !== row.evidence.length ||
                testIds.some((key, index) => key !== row.evidence[index]))
        )
            fail(`${id}: Markdown and JSON evidence lists differ`);
    }
}

if (inventory.testMappingStatus === 'reviewed')
    for (const id of rows.keys())
        if (!ids.has(id)) fail(`Markdown case ${id} absent from JSON`);

if (errors.length) {
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
}
console.log(
    `Use-case inventory valid: ${ids.size} cases (${Object.entries(counts)
        .map(([name, count]) => `${count} ${name}`)
        .join(', ')}).`,
);
