// Empaqueta el Master MCP (host/src/host.ts) en host/host.cjs. @ngrok/ngrok queda externo (módulo nativo).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [resolve(root, 'host/src/host.ts')],
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['@ngrok/ngrok'], outfile: resolve(root, 'host/host.cjs'), logLevel: 'warning'
});
console.log('host/host.cjs listo');
