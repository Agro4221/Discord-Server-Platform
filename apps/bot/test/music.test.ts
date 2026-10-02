import test from 'node:test';
import assert from 'node:assert/strict';
import { canControlMusic } from '../src/modules/music.js';

test('music controls require the same voice channel unless Manage Server is granted', () => {
  assert.equal(canControlMusic('voice-1', 'voice-1', false), true);
  assert.equal(canControlMusic('voice-1', 'voice-2', false), false);
  assert.equal(canControlMusic(null, 'voice-1', false), false);
  assert.equal(canControlMusic('voice-2', null, false), false);
  assert.equal(canControlMusic(null, 'voice-1', true), true);
  assert.equal(canControlMusic('voice-2', 'voice-1', true), true);
});
