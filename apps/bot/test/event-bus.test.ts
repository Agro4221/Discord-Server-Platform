import test from "node:test";
import assert from "node:assert/strict";
import { PlatformEventBus } from "../src/events.js";

test("event bus delivers payload to subscribers", async () => {
  const events = new PlatformEventBus();
  const seen: string[] = [];

  const unsubscribe = events.on("message.create", (message) => {
    seen.push(message.id);
  });

  await events.emit("message.create", { id: "message-1" } as never);

  assert.deepEqual(seen, ["message-1"]);
  unsubscribe();
});

test("event bus isolates one rejected listener", async () => {
  const events = new PlatformEventBus();
  let healthy = false;

  events.on("member.add", async () => {
    throw new Error("intentional");
  });
  events.on("member.add", () => {
    healthy = true;
  });

  await events.emit("member.add", { id: "member-1" } as never);
  assert.equal(healthy, true);
});


test("event bus extracts guild id from member ban events", async () => {
  const bus = new PlatformEventBus();
  const received: string[] = [];
  bus.on("member.ban", (member) => {
    received.push(member.guildId);
  });

  const payload = { guildId: "123456789012345777", userId: "123456789012345778" };
  await bus.emit("member.ban", payload);
  assert.deepEqual(received, ["123456789012345777"]);
});


test("guild filter scopes passive guild events", async () => {
  const foreignGuild = "111111111111111111";
  const ownedGuild = "222222222222222222";
  const passiveEvents: Array<[keyof import("../src/events.js").PlatformEventMap, unknown]> = [
    ["message.bulk-delete", { guildId: foreignGuild, channelId: "333333333333333333", messages: [] }],
    ["channel.create", { guildId: foreignGuild }],
    ["channel.delete", { guildId: foreignGuild }],
    ["channel.update", { oldChannel: { guildId: foreignGuild }, newChannel: { guildId: foreignGuild } }],
    ["role.create", { guild: { id: foreignGuild } }],
    ["role.delete", { guild: { id: foreignGuild } }],
    ["role.update", { oldRole: { guild: { id: foreignGuild } }, newRole: { guild: { id: foreignGuild } } }],
    ["member.unban", { guildId: foreignGuild, userId: "444444444444444444" }],
    ["security.incident", { guildId: foreignGuild, incidentId: 1, eventType: "raid" }]
  ];

  const bus = new PlatformEventBus((guildId) => guildId === ownedGuild);
  const received: string[] = [];

  for (const [event, payload] of passiveEvents) {
    bus.on(event as never, () => {
      received.push(String(event));
    });
    await bus.emit(event as never, payload as never);
  }

  assert.deepEqual(received, []);

  for (const [event, payload] of passiveEvents) {
    const ownedPayload =
      event === "channel.create" || event === "channel.delete"
        ? { ...(payload as { guildId: string }), guildId: ownedGuild }
        : event === "channel.update"
          ? { oldChannel: { guildId: ownedGuild }, newChannel: { guildId: ownedGuild } }
          : event === "role.create" || event === "role.delete"
            ? { guild: { id: ownedGuild } }
            : event === "role.update"
              ? { oldRole: { guild: { id: ownedGuild } }, newRole: { guild: { id: ownedGuild } } }
              : { ...(payload as Record<string, unknown>), guildId: ownedGuild };

    await bus.emit(event as never, ownedPayload as never);
  }

  assert.equal(received.length, passiveEvents.length);
});
