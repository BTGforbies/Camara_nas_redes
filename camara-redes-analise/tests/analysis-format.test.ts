import assert from "node:assert/strict";
import test from "node:test";

import { normalizeQualitativeRanking } from "../lib/analysis-format";

test("coloca o título do ranking em caixa alta e remove alias", () => {
  const content = `**1 - pressão dos Estados Unidos / PressãoEUA | 2 ocorrências (66,67%)**
Argumento aponta influência externa.

**Postagem representativa:**
"Comentário original."`;

  assert.equal(
    normalizeQualitativeRanking(content),
    `**1 - PRESSÃO DOS ESTADOS UNIDOS | 2 ocorrências (66,67%)**
Argumento aponta influência externa.

**Postagem representativa:**
"Comentário original."`,
  );
});
