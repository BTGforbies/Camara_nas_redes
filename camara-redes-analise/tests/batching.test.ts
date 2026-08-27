import assert from "node:assert/strict";
import test from "node:test";

import {
  groupByCharacterLimit,
  wrapPartialResults,
} from "../lib/batching";

test("agrupa resultados parciais sem ultrapassar o limite", () => {
  const values = Array.from({ length: 12 }, (_, index) =>
    `Resultado ${index + 1}: ${"análise ".repeat(500)}`,
  );
  const groups = groupByCharacterLimit(values, 20_000);

  assert.ok(groups.length > 1);
  assert.equal(groups.flat().length, values.length);
  for (const group of groups) {
    assert.ok(wrapPartialResults(group).length < 21_000);
  }
});

test("identifica resultado parcial individual excessivo", () => {
  assert.throws(
    () => groupByCharacterLimit(["x".repeat(20_000)], 10_000),
    /resultado parcial ficou grande demais/,
  );
});
