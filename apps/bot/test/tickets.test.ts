import test from "node:test";
import assert from "node:assert/strict";
import test from "node:test";
import { Tickets, isOpenTicketConflict, validateTicketFormSubmission, type TicketFormField } from "../src/modules/tickets.js";
import { PlatformEventBus } from "../src/events.js";

test("Tickets performs stale closure recovery during initialization", async () => {
  const queries: string[] = [];
  const db = {
    async query<T>(text: string) {
      queries.push(text);
      return { rows: [] as T[], rowCount: 0 };
    }
  } as unknown as import("../src/database.js").Database;

  const module = new Tickets(db);
  await module.init({
    client: {} as never,
    db,
    auditLog: {} as never,
    events: new PlatformEventBus(),
    identityId: "primary"
  });
  await module.shutdown();

  assert.equal(
    queries.some((query) => query.startsWith("UPDATE tickets SET status='open'")),
    true
  );
});



test("Tickets identifies the concurrent-open-ticket database conflict", () => {
  assert.equal(
    isOpenTicketConflict({
      code: "23505",
      constraint: "uq_open_ticket_per_creator"
    }),
    true
  );
  assert.equal(
    isOpenTicketConflict({
      code: "23505",
      constraint: "tickets_channel_id_key"
    }),
    false
  );
  assert.equal(isOpenTicketConflict(new Error("database unavailable")), false);
});


test("Tickets removes a persisted open row when Discord channel publication fails", async () => {
  const queries: string[] = [];
  const db = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      queries.push(text);
      if (text.startsWith("SELECT enabled,first_response_minutes")) {
        return { rows: [] as T[], rowCount: 0 };
      }
      if (text.startsWith("SELECT enabled,category_id")) {
        return {
          rows: [{
            enabled: true,
            category_id: null,
            staff_role_id: null,
            transcript_channel_id: null
          }] as T[],
          rowCount: 1
        };
      }
      if (text.startsWith("INSERT INTO tickets")) {
        return { rows: [{ id: "77" }] as T[], rowCount: 1 };
      }
      if (text.startsWith("DELETE FROM tickets WHERE id=$1")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error("unexpected query: " + text);
    }
  } as unknown as import("../src/database.js").Database;

  const module = new Tickets(db);
  let deletedChannel = false;
  let reply = "";
  const guild = {
    id: "123456789012345678",
    roles: { everyone: { id: "123456789012345678" } },
    members: {
      me: { permissions: { has: () => true } }
    },
    channels: {
      create: async () => ({
        id: "234567890123456789",
        send: async () => { throw new Error("discord send failed"); },
        delete: async () => { deletedChannel = true; }
      })
    }
  };
  const interaction = {
    guild,
    user: { id: "345678901234567890", username: "tester" },
    fields: {
      getTextInputValue: (name: string) => name === "subject" ? "Subject" : "Details"
    },
    reply: async (payload: { content: string }) => { reply = payload.content; }
  };

  await (module as unknown as { createTicket(interaction: never): Promise<void> }).createTicket(
    interaction as never
  );

  assert.equal(deletedChannel, true);
  assert.equal(reply, "Не удалось создать тикет.");
  assert.equal(
    queries.some((query) => query.startsWith("DELETE FROM tickets WHERE id=$1")),
    true
  );

  await module.shutdown();
});


test("Tickets sanitize custom intake form fields to Discord modal limits", async () => {
  const db = {
    async query<T>(text: string) {
      if (text.startsWith("SELECT enabled,first_response_minutes")) {
        return { rows: [] as T[], rowCount: 0 };
      }
      if (text.startsWith("SELECT enabled,category_id")) {
        return { rows: [{
          enabled: true,
          category_id: null,
          staff_role_id: null,
          transcript_channel_id: null,
          max_open_per_user: 1,
          auto_close_minutes: 0,
          form_fields: [
            { id: "subject", label: "Тема", type: "short", required: true, placeholder: "", maxLength: 100 }
          ]
        }] as T[], rowCount: 1 };
      }
      if (text.startsWith("INSERT INTO ticket_settings(")) return { rows: [], rowCount: 1 } as unknown as { rows: T[] };
      throw new Error("unexpected query: " + text);
    }
  } as unknown as import("../src/database.js").Database;

  const module = new Tickets(db);
  const fields = await module.setFormFields("123456789012345678", [
    { id: "subject", label: "Тема", type: "short", required: true, placeholder: "", maxLength: 100 },
    { id: "details", label: "Описание", type: "paragraph", required: true, placeholder: "", maxLength: 9000 },
    { id: "details", label: "Дубликат", type: "short", required: false, placeholder: "", maxLength: 10 }
  ]);
  assert.equal(fields.length, 2);
  assert.equal(fields[1]?.maxLength, 4000);
  await module.shutdown();
});


test("Tickets normalize persisted customization with safe Discord-facing limits", async () => {
  assert.deepEqual(
    (await import("../src/modules/tickets.js")).normalizeTicketCustomization({
      panelTitle: "",
      panelDescription: "  Custom support panel  ",
      createButtonLabel: " Open ",
      claimButtonLabel: " Claim ",
      closeButtonLabel: " Close "
    }),
    {
      panelTitle: "🎫 Поддержка",
      panelDescription: "Custom support panel",
      createButtonLabel: "Open",
      claimButtonLabel: "Claim",
      closeButtonLabel: "Close"
    }
  );
});

test("ticket form validation enforces required, minimum and maximum lengths", () => {
  const fields: TicketFormField[] = [
    { id: "subject", label: "Тема", type: "short", required: true, placeholder: "", minLength: 3, maxLength: 20 },
    { id: "details", label: "Описание", type: "paragraph", required: true, placeholder: "", minLength: 10, maxLength: 100 }
  ];

  assert.match(validateTicketFormSubmission(fields, { subject: "", details: "0123456789" }) ?? "", /обязательное/);
  assert.match(validateTicketFormSubmission(fields, { subject: "a", details: "0123456789" }) ?? "", /слишком короткое/);
  assert.match(validateTicketFormSubmission(fields, { subject: "ok!", details: "short" }) ?? "", /слишком короткое/);
  assert.match(validateTicketFormSubmission(fields, { subject: "ok!", details: "x".repeat(101) }) ?? "", /слишком длинное/);
  assert.equal(validateTicketFormSubmission(fields, { subject: "Тема", details: "1234567890" }), null);
});
