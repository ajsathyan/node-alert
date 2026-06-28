import assert from "node:assert/strict";
import test from "node:test";
import {
  alertStateSignature,
  buildAlertState,
  filterAlertableNames,
  filterPluralisNames,
  formatAlertEmail,
  machineNameFromCells,
  shouldNotify
} from "../scripts/check-tail-nodes.js";

test("filters out Pluralis machines case-insensitively", () => {
  assert.deepEqual(
    filterAlertableNames(["Pluralis Tail A", "tail-runner-01", "pluralis tail b", "Tail West"]),
    ["tail-runner-01", "Tail West"]
  );
});

test("identifies Pluralis machines case-insensitively", () => {
  assert.deepEqual(
    filterPluralisNames(["Pluralis tail-a", "tail-runner-01", "pluralis tail-b", "Tail West"]),
    ["Pluralis tail-a", "pluralis tail-b"]
  );
});

test("does not notify when no non-Pluralis machines remain", () => {
  const state = buildAlertState(["Pluralis Tail A", "Pluralis Tail B"]);
  assert.equal(shouldNotify(state, "").notify, false);
});

test("notifies when the signature is new", () => {
  const state = buildAlertState(["Tail A", "Tail B"]);
  const result = shouldNotify(state, "");
  assert.equal(result.notify, true);
  assert.equal(result.signature, "nonPluralis:\ntail a\ntail b");
});

test("dedupes unchanged machine lists", () => {
  const state = buildAlertState(["Tail B", "Tail A"]);
  const previous = alertStateSignature(buildAlertState(["Tail A", "Tail B"]));
  const result = shouldNotify(state, previous);
  assert.equal(result.notify, false);
});

test("notifies when more than two Pluralis Tail machines are online", () => {
  const state = buildAlertState(["Pluralis tail-a", "Pluralis tail-b", "Pluralis tail-c"]);
  const result = shouldNotify(state, "");
  assert.equal(result.notify, true);
  assert.deepEqual(state.reasons, ["pluralisTailCount"]);
  assert.equal(result.signature, "pluralis>2:\npluralis tail-a\npluralis tail-b\npluralis tail-c");
});

test("dedupes unchanged Pluralis threshold alerts", () => {
  const state = buildAlertState(["Pluralis tail-c", "Pluralis tail-a", "Pluralis tail-b"]);
  const previous = alertStateSignature(buildAlertState(["Pluralis tail-a", "Pluralis tail-b", "Pluralis tail-c"]));
  const result = shouldNotify(state, previous);
  assert.equal(result.notify, false);
});

test("notifies with both alert reasons when both conditions are met", () => {
  const state = buildAlertState(["Pluralis tail-a", "Pluralis tail-b", "Pluralis tail-c", "outside tail"]);
  const result = shouldNotify(state, "");
  assert.equal(result.notify, true);
  assert.deepEqual(state.reasons, ["nonPluralisTail", "pluralisTailCount"]);
});

test("formats count and names for Pluralis threshold email", () => {
  const state = buildAlertState(["Pluralis tail-a", "Pluralis tail-b", "Pluralis tail-c"]);
  const email = formatAlertEmail(state, new Date("2026-06-28T04:00:00.000Z"));
  assert.equal(email.subject, "Agora Tail node alert: 3 Pluralis");
  assert.match(email.body, /3 Online Tail machines included Pluralis/);
  assert.match(email.body, /- Pluralis tail-a/);
  assert.match(email.body, /- Pluralis tail-b/);
  assert.match(email.body, /- Pluralis tail-c/);
});

test("extracts a displayed machine name from an Online Tail table row", () => {
  assert.equal(
    machineNameFromCells(["Online", "Pluralis", "tail-6-koP3sY-9052", "RTX PRO 6000"]),
    "Pluralis tail-6-koP3sY-9052"
  );
});

test("ignores Offline Tail table rows", () => {
  assert.equal(
    machineNameFromCells(["Offline", "tiredpods", "tail-6-9KSvwp-0650", "RTX PRO 6000"]),
    ""
  );
});
