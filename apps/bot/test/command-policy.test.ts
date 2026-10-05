import test from "node:test";
import assert from "node:assert/strict";
import { CommandPolicyService } from "../src/command-policy.js";

function member(roleIds: string[] = [], permissions: string[] = []) {
  return {
    roles: { cache: new Map(roleIds.map((id) => [id, { id }])) },
    permissions: { has: (permission: string) => permissions.includes(permission) }
  } as never;
}

test("command policy allows controller action by default", async () => {
  const db = {
    query: async () => ({ rows: [] })
  } as never;

  const policy = new CommandPolicyService(db);
  assert.equal(
    await policy.checkMemberAction(
      "123456789012345678",
      "skip",
      member(["123456789012345679"]),
      "123456789012345680"
    ),
    true
  );
});

test("command policy blocks a denied role or channel", async () => {
  const rows = new Map<string, unknown>([
    ["skip", {
      enabled: true,
      prefix_enabled: true,
      slash_enabled: true,
      cooldown_seconds: 0,
      allowed_role_ids: [],
      denied_role_ids: ["123456789012345679"],
      allowed_channel_ids: [],
      denied_channel_ids: ["123456789012345680"],
      help_visible: true
    }]
  ]);
  const db = {
    query: async (_sql: string, params: unknown[]) => ({ rows: rows.has(String(params[1])) ? [rows.get(String(params[1]))] : [] })
  } as never;

  const policy = new CommandPolicyService(db);
  assert.equal(
    await policy.checkMemberAction(
      "123456789012345678",
      "skip",
      member(["123456789012345679"]),
      "123456789012345681"
    ),
    false
  );
  assert.equal(
    await policy.checkMemberAction(
      "123456789012345678",
      "skip",
      member([]),
      "123456789012345680"
    ),
    false
  );
});

test("command policy blocks disabled controller action", async () => {
  const row = {
    enabled: false,
    prefix_enabled: true,
    slash_enabled: true,
    cooldown_seconds: 0,
    allowed_role_ids: [],
    denied_role_ids: [],
    allowed_channel_ids: [],
    denied_channel_ids: [],
    help_visible: true
  };
  const db = {
    query: async () => ({ rows: [row] })
  } as never;

  const policy = new CommandPolicyService(db);
  assert.equal(
    await policy.checkMemberAction(
      "123456789012345678",
      "volume",
      member(),
      "123456789012345680"
    ),
    false
  );
});
