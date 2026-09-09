import assert from "node:assert/strict";
import test from "node:test";

import { roundConfigSchema } from "./rules";
import { gameFormats, roundTemplates } from "./templates";

const templateKeys = new Set(roundTemplates.map((template) => template.key));

test("every round template carries a valid config and bilingual title", () => {
  for (const template of roundTemplates) {
    assert.doesNotThrow(
      () => roundConfigSchema.parse(template.config),
      `template ${template.key} has an invalid config`,
    );
    assert.ok(template.title.en.trim().length > 0, `${template.key} missing en title`);
    assert.ok(template.title.fr.trim().length > 0, `${template.key} missing fr title`);
  }
});

test("template keys are unique", () => {
  assert.equal(templateKeys.size, roundTemplates.length);
});

test("built-in formats only reference real templates and end on a finale", () => {
  for (const format of ["quick", "weekend"] as const) {
    const steps = gameFormats[format];
    assert.ok(steps.length > 0, `${format} format is empty`);
    for (const key of steps) {
      assert.ok(templateKeys.has(key), `${format} references unknown template ${key}`);
    }
    assert.equal(steps.at(-1), "finale", `${format} should finish with the finale`);
  }
});

test("custom format ships empty so hosts compose it themselves", () => {
  assert.deepEqual(gameFormats.custom, []);
});
