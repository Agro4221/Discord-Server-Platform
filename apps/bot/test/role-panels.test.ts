import test from "node:test";
import assert from "node:assert/strict";
import { RolePanels } from "../src/modules/role-panels.js";

test("Role panel same-channel DB failure restores the previous Discord message", async () => {
  const calls: string[] = [];
  let listCalls = 0;

  const db = {
    async query<T>(text: string) {
      calls.push(text);
      if (text.startsWith("SELECT id,guild_id,channel_id")) {
        listCalls += 1;
        return {
          rows: [{
            id: "7",
            guild_id: "123",
            channel_id: "456",
            message_id: "789",
            title: "Old",
            roles: [{ roleId: "999", label: "Old role" }]
          }] as T[]
        };
      }
      if (text.startsWith("UPDATE role_panels SET title=")) {
        throw new Error("database unavailable");
      }
      throw new Error("unexpected query");
    }
  } as unknown as import("../src/database.js").Database;

  const module = new RolePanels(db);
  const edited: string[] = [];
  const callbacks = {
    editMessage: async (_channelId: string, _messageId: string, content: string, _components: unknown[]) => {
      edited.push(content);
    },
    deleteMessage: async () => undefined,
    sendMessage: async () => "1000"
  };

  await assert.rejects(
    (module as unknown as {
      updatePanel(
        guildId: string,
        panelId: number,
        channelId: string,
        roles: { roleId: string; label: string }[],
        title: string,
        callbacks: unknown
      ): Promise<unknown>
    }).updatePanel(
      "123",
      7,
      "456",
      [{ roleId: "1000", label: "New role" }],
      "New",
      callbacks
    ),
    /database unavailable/
  );

  assert.equal(listCalls, 1);
  assert.deepEqual(edited, ["🎭 **New**", "🎭 **Old**"]);
  assert.ok(calls.some((query) => query.startsWith("UPDATE role_panels SET title=")));
});

test("Role panel list returns stored component type", async () => {
  const db = {
    async query<T>(text: string) {
      if (text.startsWith("SELECT id,guild_id,channel_id")) {
        return {
          rows: [{
            id: "8",
            guild_id: "123",
            channel_id: "456",
            message_id: "789",
            title: "Select roles",
            roles: [{ roleId: "999", label: "Blue" }],
            selection_mode: "max",
            max_selections: 1,
            duration_minutes: 60,
            component_type: "select"
          }] as T[]
        };
      }
      throw new Error("unexpected query");
    }
  } as unknown as import("../src/database.js").Database;

  const module = new RolePanels(db);
  const panels = await module.list("123");
  assert.equal(panels[0]?.componentType, "select");
  assert.equal(panels[0]?.selectionMode, "max");
});
