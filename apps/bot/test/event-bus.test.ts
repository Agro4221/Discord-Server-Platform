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
