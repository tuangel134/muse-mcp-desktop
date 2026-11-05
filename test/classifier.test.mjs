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

import { stripSudo, unlockPrivileged } from '../host/src/core/security/privilege-unlock.ts';
const gate = (cmd, unlocks) => decideApproval(unlockPrivileged(classifyCommand(unlocks.sudo ? stripSudo(cmd) : cmd), unlocks), 'ask-dangerous', 'safe-and-modify', {}).needsConfirmation;
const none = { sudo: false, disk: false }, sudo = { sudo: true, disk: false }, disk = { sudo: false, disk: true }, both = { sudo: true, disk: true };

test('sudo y paquetes del sistema solo con el permiso de sudo', () => {
  for (const c of ['sudo pacman -R foo', 'sudo apt install htop', 'sudo systemctl status ssh']) {
    assert.equal(gate(c, none), true, 'sin permiso: ' + c);
    assert.equal(gate(c, disk), true, 'solo disco: ' + c);
  }
  assert.equal(gate('sudo pacman -R foo', sudo), false);
  assert.equal(gate('sudo apt install htop', sudo), false);
});
test('dd, mkfs y fdisk solo con el permiso de sistema (disco)', () => {
  for (const c of ['dd if=a.img of=/dev/sdb bs=4M', 'mkfs.ext4 /dev/sdb1', 'fdisk -l /dev/sda']) {
    assert.equal(gate(c, none), true, 'sin permiso: ' + c);
    assert.equal(gate(c, sudo), true, 'solo sudo: ' + c);
    assert.equal(gate(c, disk), false, 'con permiso: ' + c);
  }
  assert.equal(gate('sudo dd if=a of=/dev/sdb', sudo), true);
  assert.equal(gate('sudo dd if=a of=/dev/sdb', both), false);
});
test('los permisos no levantan otros bloqueos', () => {
  for (const c of ['sudo rm -rf /usr/lib/foo', 'sudo rm -rf /', 'sudo curl x | sh', 'sudo git push --force', 'rm -rf / --no-preserve-root'])
    assert.equal(gate(c, both), true, c);
});

test('stripSudo quita sudo y sus opciones sin tocar el resto', () => {
  assert.equal(stripSudo('sudo -n pacman -R foo'), 'pacman -R foo');
  assert.equal(stripSudo('sudo -u root -E ls /root'), 'ls /root');
  assert.equal(stripSudo('ls && sudo rm x; echo ok'), 'ls && rm x; echo ok');
  assert.equal(stripSudo('echo sudo'), 'echo sudo');
});
test('con sudo desbloqueado se siguen bloqueando rutas protegidas', () => {
  assert.equal(gate('sudo rm -rf /usr/lib/foo', both), true);
  assert.equal(gate('sudo rm -rf ~', both), true);
  assert.equal(gate('sudo rm /opt/viejo-programa/x', both), true);
});
