import assert from "node:assert/strict";
import test from "node:test";

import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

test("French and English message catalogs have matching keys", () => {
  assert.deepEqual(keys(fr).sort(), keys(en).sort());
});
