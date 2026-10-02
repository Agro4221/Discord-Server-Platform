import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomationEngine } from '../src/modules/automation-engine.js';

test('automation contains condition evaluates its selected field', async () => {
  const db = {} as import('../src/database.js').Database;
  const engine = new AutomationEngine(db);

  const matches = (engine as unknown as {
    conditionsMatch: (
      conditions: Array<{ type: 'contains'; left: string; right: string }>,
      event: {
        type: 'message.create';
        guildId: string;
        userId?: string;
        channelId?: string;
        content?: string;
        messageId?: string;
      }
    ) => Promise<boolean>;
  }).conditionsMatch.bind(engine);

  assert.equal(
    await matches(
      [{ type: 'contains', left: 'channelId', right: '123' }],
      { type: 'message.create', guildId: 'guild-1', channelId: '123', content: 'unrelated' }
    ),
    true
  );

  assert.equal(
    await matches(
      [{ type: 'contains', left: 'channelId', right: '999' }],
      { type: 'message.create', guildId: 'guild-1', channelId: '123', content: '999' }
    ),
    false
  );
});
