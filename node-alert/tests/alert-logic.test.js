import assert from "node:assert/strict";
import test from "node:test";
import {
  alertSignature,
  filterAlertableNames,
  machineNameFromCells,
  shouldNotify
} from "../scripts/check-tail-nodes.js";

test("filters out Pluralis machines case-insensitively", () => {
  assert.deepEqual(
    filterAlertableNames(["Pluralis Tail A", "tail-runner-01", "pluralis tail b", "Tail West"]),
    ["tail-runner-01", "Tail West"]
  );
});

test("does not notify when no non-Pluralis machines remain", () => {
  const names = filterAlertableNames(["Pluralis Tail A", "Pluralis Tail B"]);
  assert.equal(shouldNotify(names, "").notify, false);
});

test("notifies when the signature is new", () => {
  const names = ["Tail A", "Tail B"];
  const result = shouldNotify(names, "");
  assert.equal(result.notify, true);
  assert.equal(result.signature, "tail a\ntail b");
});

test("dedupes unchanged machine lists", () => {
  const names = ["Tail B", "Tail A"];
  const previous = alertSignature(["Tail A", "Tail B"]);
  const result = shouldNotify(names, previous);
  assert.equal(result.notify, false);
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
