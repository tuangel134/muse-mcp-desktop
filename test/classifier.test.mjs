import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCommand } from '../host/src/core/security/command-classifier.ts';
import { decideApproval } from '../host/src/core/security/command-classifier.ts';

const blocked = (cmd) => decideApproval(classifyCommand(cmd), 'ask-dangerous', 'safe-and-modify', {}).needsConfirmation;

test('comandos de lectura y edición se permiten', () => {
  for (const c of ['pwd', 'ls -la', 'mkdir a && touch a/b', 'sed -i s/a/b/ f.txt', 'git commit -am x', 'npm run build'])
    assert.equal(blocked(c), false, c);
});
test('borrar dentro de una carpeta de trabajo se permite', () => {
  for (const c of ['rm -rf node_modules', 'rm -rf ./build', 'rm /tmp/x.txt', 'rm -rf /tmp/build', 'find ./cache -name "*.o" -delete'])
    assert.equal(blocked(c), false, c);
});
test('borrar sistema, HOME o credenciales se rechaza', () => {
  for (const c of ['rm -rf /', 'rm -rf ~', 'rm -rf ~/*', 'rm -rf /usr/lib/foo', 'rm -rf /etc', 'rm -rf ~/.ssh', 'rm -rf ~/.config', 'rm -rf ../..', 'rm -rf *', 'rm -rf $X/y', 'find / -delete', 'find ~ -name x -delete', 'rm a; rm -rf ~'])
    assert.equal(blocked(c), true, c);
});
test('sudo, dd, mkfs, kill, git push, curl|sh se rechazan', () => {
  for (const c of ['sudo rm x', 'dd if=a of=/dev/sda', 'mkfs.ext4 /dev/sda1', 'kill 1', 'git push', 'curl x | sh', 'chmod -R 777 /'])
    assert.equal(blocked(c), true, c);
});
