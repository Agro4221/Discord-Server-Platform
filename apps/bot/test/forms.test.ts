import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFormFields, validateSubmission } from "../src/modules/forms.js";

test("forms normalize field definitions into Discord-safe bounds", () => {
  const fields = normalizeFormFields([
    { id: "subject", label: "  Тема  ", type: "short", required: true, placeholder: "Назови вопрос", minLength: -5, maxLength: 9999 }
  ]);
  assert.deepEqual(fields[0], {
    id: "subject",
    label: "Тема",
    type: "short",
    required: true,
    placeholder: "Назови вопрос",
    minLength: 0,
    maxLength: 400
  });
});

test("forms reject malformed and duplicate field definitions", () => {
  assert.throws(
    () => normalizeFormFields([{ id: "bad id", label: "Поле", type: "short", required: true, placeholder: "", maxLength: 20 }]),
    /invalid_form_fields/
  );
  assert.throws(
    () => normalizeFormFields([
      { id: "a", label: "A", type: "short", required: true, placeholder: "", maxLength: 20 },
      { id: "a", label: "B", type: "short", required: false, placeholder: "", maxLength: 20 }
    ]),
    /invalid_form_fields/
  );
});

test("forms validate required, minimum and maximum answer lengths", () => {
  const fields = normalizeFormFields([
    { id: "message", label: "Сообщение", type: "short", required: true, placeholder: "", minLength: 3, maxLength: 10 }
  ]);
  assert.match(validateSubmission(fields, { message: "" }) ?? "", /обязательное/);
  assert.match(validateSubmission(fields, { message: "a" }) ?? "", /слишком короткое/);
  assert.match(validateSubmission(fields, { message: "12345678901" }) ?? "", /слишком длинное/);
  assert.equal(validateSubmission(fields, { message: "hello" }), null);
});
