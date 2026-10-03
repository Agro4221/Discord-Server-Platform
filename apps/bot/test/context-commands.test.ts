import test from "node:test";
import assert from "node:assert/strict";
import { ApplicationCommandType } from "discord.js";
import { buildContextCommands, CONTEXT_COMMAND_NAMES } from "../src/context-commands.js";

test("context menu commands expose user and message actions", () => {
  const commands = buildContextCommands().map((command) => command.toJSON());

  assert.equal(commands.length, 5);
  assert.deepEqual(
    commands.map((command) => ({ name: command.name, type: command.type })),
    [
      { name: CONTEXT_COMMAND_NAMES.userInfo, type: ApplicationCommandType.User },
      { name: CONTEXT_COMMAND_NAMES.moderationHistory, type: ApplicationCommandType.User },
      { name: CONTEXT_COMMAND_NAMES.avatar, type: ApplicationCommandType.User },
      { name: CONTEXT_COMMAND_NAMES.quoteMessage, type: ApplicationCommandType.Message },
      { name: CONTEXT_COMMAND_NAMES.deleteMessage, type: ApplicationCommandType.Message }
    ]
  );
});

test("moderation context commands declare Discord permission hints", () => {
  const commands = buildContextCommands().map((command) => command.toJSON());
  const history = commands.find((command) => command.name === CONTEXT_COMMAND_NAMES.moderationHistory);
  const deleteMessage = commands.find((command) => command.name === CONTEXT_COMMAND_NAMES.deleteMessage);

  assert.equal(typeof history?.default_member_permissions, "string");
  assert.equal(typeof deleteMessage?.default_member_permissions, "string");
});
