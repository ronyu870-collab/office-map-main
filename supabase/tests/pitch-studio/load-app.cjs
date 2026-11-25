// Test-only TypeScript loader, compiling the exact application modules. Production
// imports keep their normal Next boundaries; no substitute workflow is tested.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS preload installs the TypeScript require hook before loading application modules.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const priorResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  return priorResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...rest);
};
require.extensions['.ts'] = function(mod, filename) {
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  mod._compile(js, filename);
};
