import test from "node:test";
import assert from "node:assert/strict";
import { matchesAutoResponder, renderAutoResponder } from "../src/modules/autoresponder.js";

test("AutoResponder matching supports exact, contains, starts-with and regex", () => {
  assert.equal(matchesAutoResponder({ trigger: "hello", matchType: "exact" }, "Hello"), true);
  assert.equal(matchesAutoResponder({ trigger: "hello", matchType: "exact" }, "hello world"), false);
  assert.equal(matchesAutoResponder({ trigger: "hello", matchType: "contains" }, "well, hello!"), true);
  assert.equal(matchesAutoResponder({ trigger: "hello", matchType: "starts-with" }, "Hello there"), true);
  assert.equal(matchesAutoResponder({ trigger: "^hello\\s+\\d+$", matchType: "regex" }, "hello 42"), true);
  assert.equal(matchesAutoResponder({ trigger: "[", matchType: "regex" }, "hello"), false);
});

test("AutoResponder renders bounded template variables", () => {
  assert.equal(
    renderAutoResponder("Hi {user} {mention} on {server} / {channel}", {
      user: "Jostik",
      mention: "<@1>",
      server: "DSP",
      channel: "general"
    }),
    "Hi Jostik <@1> on DSP / general"
  );
  assert.equal(renderAutoResponder("x".repeat(2200), {
    user: "u", mention: "<@1>", server: "s", channel: "c"
  }).length, 2000);
});
