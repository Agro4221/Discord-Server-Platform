import test from "node:test";
import assert from "node:assert/strict";
import { buildCommands } from "../src/discord/commands.js";

function assertRequiredOptionsFirst(node: unknown, path: string): void {
  if (!node || typeof node !== "object") return;
  const item = node as Record<string, unknown>;

  if (Array.isArray(item.options)) {
    let sawOptional = false;
    for (const [index, option] of item.options.entries()) {
      if (!option || typeof option !== "object") continue;
      const current = option as Record<string, unknown>;
      if (current.required === true) {
        assert.equal(
          sawOptional,
          false,
          `${path}.options[${index}]: required option must be placed before optional options`
        );
      } else if (current.required === false || current.required === undefined) {
        sawOptional = true;
      }
    }
  }

  if (Array.isArray(item.options)) {
    for (const [index, child] of item.options.entries()) {
      assertRequiredOptionsFirst(child, `${path}.options[${index}]`);
    }
  }
}

test("all Discord application command option lists keep required options before optional ones", () => {
  const commands = buildCommands().map((command) => command.toJSON());

  for (const command of commands) {
    assertRequiredOptionsFirst(command, command.name);
  }

  assert.deepEqual(
    commands.find((command) => command.name === "giveaway")?.options?.[0]?.options?.map((option) => ({
      name: option.name,
      required: option.required
    })),
    [
      { name: "minutes", required: true },
      { name: "prize", required: true },
      { name: "winners", required: false },
      { name: "required-role", required: false },
      { name: "min-level", required: false },
      { name: "template", required: false }
    ]
  );

  const afk = commands.find((command) => command.name === "afk");
  assert.equal(afk?.description, "Set or clear AFK status");
  assert.deepEqual(
    afk?.options?.map((option) => ({ name: option.name, required: option.required })),
    [{ name: "reason", required: false }]
  );

  const streamAlertCreate = commands.find((command) => command.name === "streamalert")?.options?.find((option) => option.name === "create");
  assert.deepEqual(
    streamAlertCreate?.options?.map((option) => ({ name: option.name, required: option.required })),
    [
      { name: "platform", required: true },
      { name: "target", required: true },
      { name: "channel", required: true },
      { name: "mention-role", required: false },
      { name: "interval", required: false }
    ]
  );

  assert.deepEqual(
    commands.find((command) => command.name === "automation")?.options?.find((option) => option.name === "create")?.options?.map((option) => ({
      name: option.name,
      required: option.required
    })),
    [
      { name: "name", required: true },
      { name: "event", required: true },
      { name: "response-channel", required: true },
      { name: "response", required: true },
      { name: "channel", required: false },
      { name: "match", required: false }
    ]
  );
});


test("utility info commands expose both prefix and slash entry points", () => {
  const commands = buildCommands().map((command) => command.toJSON());
  for (const name of ["serverinfo","userinfo","roleinfo","channelinfo"]) {
    const command = commands.find((item) => item.name === name);
    assert.ok(command);
    assert.equal(Boolean(command?.description), true);
  }
});


test("Music play and search expose YouTube, Yandex Music and Spotify providers", () => {
  const commands = buildCommands().map((command) => command.toJSON());

  const topLevelPlay = commands.find((command) => command.name === "play");
  assert.deepEqual(
    topLevelPlay?.options?.map((option) => option.name),
    ["query", "provider"]
  );
  assert.deepEqual(
    topLevelPlay?.options?.find((option) => option.name === "provider")?.choices?.map((choice) => choice.value),
    ["youtube", "yandex", "spotify", "applemusic", "deezer", "vkmusic", "tidal", "qobuz", "jiosaavn"]
  );

  const music = commands.find((command) => command.name === "music");
  const play = music?.options?.find((option) => option.name === "play");
  const search = music?.options?.find((option) => option.name === "search");
  assert.deepEqual(
    play?.options?.map((option) => option.name),
    ["query", "provider"]
  );
  assert.deepEqual(
    search?.options?.map((option) => option.name),
    ["query", "provider"]
  );
});


test("Music lyrics command exposes show/status action", () => {
  const commands = buildCommands().map((command) => command.toJSON());
  const music = commands.find((command) => command.name === "music");
  const lyrics = music?.options?.find((option) => option.name === "lyrics");

  assert.ok(lyrics);
  assert.deepEqual(
    lyrics?.options?.find((option) => option.name === "action")?.choices?.map((choice) => choice.value),
    ["show", "status"]
  );
});
