import test from "node:test";
import assert from "node:assert/strict";
import { buildCommands } from "../src/discord/commands.js";
import { COMMAND_DEFINITIONS } from "../src/command-policy.js";
import { BUILTIN_PREFIX_COMMANDS } from "../src/discord/prefix-commands.js";

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

test("temporary voice control command exposes owner controls", () => {
  const command = buildCommands().find((item) => item.name === "voice");
  assert.ok(command);
  const options = command.toJSON().options ?? [];
  assert.deepEqual(options.map((option) => option.name), ["info", "lock", "unlock", "limit", "name", "transfer", "permit", "reject"]);
  assert.equal(options.find((option) => option.name === "limit")?.options?.[0]?.required, true);
  assert.equal(options.find((option) => option.name === "name")?.options?.[0]?.required, true);
  assert.equal(options.find((option) => option.name === "transfer")?.options?.[0]?.required, true);
});

test("utility slash commands are registered with expected options", () => {
  const commands = buildCommands().map((command) => command.toJSON());

  assert.ok(commands.some((command) => command.name === "serverinfo"));
  assert.ok(commands.some((command) => command.name === "userinfo"));
  assert.ok(commands.some((command) => command.name === "avatar"));
  assert.ok(commands.some((command) => command.name === "membercount"));
  assert.ok(commands.some((command) => command.name === "roleinfo"));
  assert.ok(commands.some((command) => command.name === "channelinfo"));

  const roleInfo = commands.find((command) => command.name === "roleinfo");
  assert.equal(roleInfo?.options?.[0]?.name, "role");
  assert.equal(roleInfo?.options?.[0]?.required, true);

  const afk = commands.find((command) => command.name === "afk");
  assert.deepEqual(
    afk?.options?.map((option) => option.name),
    ["set", "clear", "status"]
  );
  assert.equal(afk?.options?.[0]?.options?.[0]?.required, false);
});



test("community tool slash commands preserve required-before-optional ordering", () => {
  const commands = buildCommands().map((command) => command.toJSON());

  const poll = commands.find((command) => command.name === "poll");
  assert.deepEqual(
    poll?.options?.map((option) => ({
      name: option.name,
      required: option.required
    })),
    [
      { name: "question", required: true },
      { name: "option1", required: true },
      { name: "option2", required: true },
      { name: "option3", required: false },
      { name: "option4", required: false },
      { name: "option5", required: false },
      { name: "minutes", required: false }
    ]
  );

  const sticky = commands.find((command) => command.name === "sticky");
  assert.deepEqual(
    sticky?.options?.map((option) => option.name),
    ["set", "clear"]
  );
});


test("automation slash command exposes server and security events", () => {
  const command = buildCommands().find((item) => item.name === "automation");
  assert.ok(command);
  const json = command.toJSON();
  const eventOption = json.options?.[0]?.options?.find((option) => option.name === "event");
  const values = eventOption?.choices?.map((choice) => String(choice.value)) ?? [];
  for (const value of ["channel.create", "channel.delete", "role.create", "role.delete", "member.ban", "member.unban"]) {
    assert.ok(values.includes(value), value);
  }
});


test("command policy names are unique and cover every top-level slash command", () => {
  const commands = buildCommands().map((command) => command.toJSON());
  const topLevelNames = commands.map((command) => command.name);
  const uniqueTopLevelNames = new Set(topLevelNames);
  assert.equal(uniqueTopLevelNames.size, topLevelNames.length, "duplicate top-level Discord command name");

  const policyNames = new Set(COMMAND_DEFINITIONS.map((definition) => definition.name));
  for (const name of uniqueTopLevelNames) {
    assert.ok(policyNames.has(name), "Missing command policy definition for /" + name);
  }

  const definitionNames = COMMAND_DEFINITIONS.map((definition) => definition.name);
  assert.equal(
    new Set(definitionNames).size,
    definitionNames.length,
    "duplicate command policy definition"
  );
});


test("prefix command allowlist covers all policy-defined prefix commands", () => {
  const policyPrefixNames = COMMAND_DEFINITIONS
    .filter((definition) => definition.prefix)
    .map((definition) => definition.name);

  for (const name of policyPrefixNames) {
    assert.ok(BUILTIN_PREFIX_COMMANDS.has(name), "Missing built-in prefix routing for " + name);
  }

  for (const name of BUILTIN_PREFIX_COMMANDS) {
    const definition = COMMAND_DEFINITIONS.find((item) => item.name === name);
    assert.ok(definition?.prefix, "Prefix allowlist contains non-prefix command " + name);
  }
});
