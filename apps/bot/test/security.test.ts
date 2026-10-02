import test from 'node:test';
import assert from 'node:assert/strict';
import { Security } from '../src/modules/security.js';

test('Security configure persists destructive thresholds', async () => {
  const queries: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    async query<T>(_text: string, _values: readonly unknown[] = []) {
      queries.push({ text: _text, values: _values });
      if (_text.includes('SELECT enabled,max_joins')) {
        return {
          rows: [{
            enabled: false,
            max_joins: 10,
            window_seconds: 20,
            max_destructive_actions: 5,
            destructive_window_seconds: 20,
            quarantine_role_id: null,
            log_channel_id: null
          }] as T[],
          rowCount: 1
        };
      }
      return { rows: [] as T[], rowCount: 1 };
    }
  } as unknown as import('../src/database.js').Database;

  const security = new Security(db);
  await security.configure('guild-1', {
    enabled: true,
    maxJoins: 25,
    windowSeconds: 30,
    maxDestructiveActions: 8,
    destructiveWindowSeconds: 45,
    quarantineRoleId: 'role-1',
    logChannelId: 'channel-1'
  });

  const update = queries.find((entry) => entry.text.includes('INSERT INTO security_settings'));
  assert.ok(update);
  assert.deepEqual(update.values, [
    'guild-1',
    true,
    25,
    30,
    8,
    45,
    'role-1',
    'channel-1'
  ]);
});
