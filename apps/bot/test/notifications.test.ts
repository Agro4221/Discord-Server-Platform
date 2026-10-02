import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp } from '../src/modules/notifications.js';

test('notification feed network guard rejects private and mapped addresses', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.8'), true);
  assert.equal(isPrivateIp('100.64.0.1'), true);
  assert.equal(isPrivateIp('172.16.10.20'), true);
  assert.equal(isPrivateIp('192.168.1.10'), true);
  assert.equal(isPrivateIp('::1'), true);
  assert.equal(isPrivateIp('fe80::1'), true);
  assert.equal(isPrivateIp('fd00::1'), true);
  assert.equal(isPrivateIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateIp('::ffff:7f00:1'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('2001:4860:4860::8888'), false);
});
