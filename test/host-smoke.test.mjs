import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostPath = join(root, 'host/host.cjs');
const TOKEN = 'x'.repeat(64);

test('el host arranca, exige token, rechaza Origin y levanta el gateway local', { skip: !existsSync(hostPath) && 'ejecuta npm run build:host' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'muse-mcp-'));
  const work = join(dir, 'proyecto'); mkdirSync(work);
  const port = 41000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [hostPath], { env: { ...process.env, MUSE_MCP_DATA: join(dir, 'data'), MUSE_MCP_PORT: String(port), MUSE_MCP_TOKEN: TOKEN, MUSE_MCP_APP_DIR: root }, stdio: 'ignore' });
  const call = (path, body, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Hub-Token': TOKEN, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { try { up = (await call('/state')).ok; } catch { await new Promise((r) => setTimeout(r, 200)); } }
    assert.ok(up, 'el host no arrancó');
    assert.equal((await fetch(`http://127.0.0.1:${port}/state`)).status, 401, 'sin token debe ser 401');
    assert.equal((await call('/state', undefined, { Origin: 'https://evil.example' })).status, 403, 'con Origin debe ser 403');
    const ws = await (await call('/workspace/add', { path: work })).json();
    assert.ok(JSON.stringify(ws).includes('proyecto'), 'carpeta añadida');
    const st = await (await call('/settings', { enabled: true, mode: 'local', domain: '' })).json();
    assert.equal(st.masterMcp.running, true);
    const health = await fetch(st.masterMcp.localUrl + '/health');
    assert.equal((await health.json()).status, 'ok');
    const meta = await fetch(st.masterMcp.localUrl + '/.well-known/oauth-authorization-server');
    assert.equal(meta.status, 200);
    assert.equal((await fetch(st.masterMcp.localUrl + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'MCP sin OAuth debe ser 401');
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});
