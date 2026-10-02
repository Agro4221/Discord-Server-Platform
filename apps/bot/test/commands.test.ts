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
      { name: "winners", required: false }
    ]
  );

  assert.deepEqual(
    commands.find((command) => command.name === "automation")?.options?.[0]?.options?.map((option) => ({
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
