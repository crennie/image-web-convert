import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const runner = resolve(root, 'node_modules/.bin/vite-node');
const worker = resolve(root, 'apps/api/tools/image-budget.worker.ts');
const config = resolve(root, 'apps/api/vite.config.ts');

async function measure(name) {
    const child = spawn(runner, ['--script', '--config', config, worker], {
        cwd: root,
        env: { ...process.env, IMAGE_BUDGET_CASE: name },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
        stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
        stderr += chunk;
    });
    const deadline = setTimeout(() => child.kill('SIGKILL'), 30_000);
    try {
        const { code, signal } = await new Promise((resolve, reject) => {
            child.once('error', reject);
            child.once('close', (code, signal) => resolve({ code, signal }));
        });
        if (code !== 0)
            throw new Error(
                `${name} exited ${code ?? signal}: ${stderr || stdout}`,
            );
        const line = stdout.trim().split('\n').at(-1);
        const result = JSON.parse(line);
        if (result.name !== name)
            throw new Error(`Unexpected result for ${name}`);
        console.log(JSON.stringify(result));
    } finally {
        clearTimeout(deadline);
    }
}

for (const name of ['heic-12mp', 'png-20mp']) await measure(name);
