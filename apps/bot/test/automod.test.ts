import test from 'node:test';
import assert from 'node:assert/strict';
import { AutoMod } from '../src/modules/automod.js';

test('AutoMod configure persists all extended settings', async () => {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    async query<T>(_text: string, _values: readonly unknown[] = []) {
      queries.push({ text: _text, values: _values });
      if (_text.includes('SELECT enabled,blocked_words')) {
        return {
          rows: [{
            enabled: true,
            blocked_words: [],
            max_mentions: 6,
            max_caps_ratio: 0.85,
            max_repeated_messages: 5,
            repeated_window_seconds: 10,
            block_links: false,
            block_invites: false,
            max_links: 3,
            max_emojis: 20,
            max_line_length: 1000,
            exempt_channel_ids: '',
            exempt_role_ids: '',
            delete_message: true,
            timeout_minutes: 0
          }] as T[],
          rowCount: 1
        };
      }
      return { rows: [] as T[], rowCount: 1 };
    }
  } as unknown as import('../src/database.js').Database;

  const automod = new AutoMod(db);
  await automod.configure('guild-1', {
    blockedWords: ['spam'],
    blockLinks: true,
    blockInvites: true,
    maxLinks: 1,
    maxEmojis: 5,
    maxLineLength: 500,
    exemptChannelIds: 'channel-1',
    exemptRoleIds: 'role-1',
    timeoutMinutes: 10
  });

  const update = queries.find((entry) => entry.text.includes('INSERT INTO automod_settings'));
  assert.ok(update);
  assert.equal(update.values.length, 16);
  assert.equal(update.values[7], true);
  assert.equal(update.values[8], true);
  assert.equal(update.values[9], 1);
  assert.equal(update.values[10], 5);
  assert.equal(update.values[11], 500);
  assert.equal(update.values[12], 'channel-1');
  assert.equal(update.values[13], 'role-1');
  assert.equal(update.values[15], 10);
});
