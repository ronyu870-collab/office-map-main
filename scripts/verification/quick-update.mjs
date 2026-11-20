import { execFileSync } from 'node:child_process';
import { getScope } from './ci-scope.mjs';

const base = execFileSync('git', ['rev-parse', '--verify', process.argv[2] || process.env.CI_COMPARISON_SHA || 'origin/main'], { encoding: 'utf8' }).trim();
const scope = getScope(base, { quickRequested: true });
if (!scope.quickOnly) throw new Error('Change exceeds quick-update scope; use the normal verification workflow.');
const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
const code = scope.paths.filter(path => /\.tsx?$/.test(path));
run('npm', ['run', 'typecheck']);
if (code.length) run('npx', ['--no-install', 'eslint', ...code]);
// Vitest includes changed tests themselves and tests importing the changed source.
run('npx', ['--no-install', 'vitest', 'related', '--run', '--passWithNoTests', ...scope.paths.filter(path => path.startsWith('src/'))]);
