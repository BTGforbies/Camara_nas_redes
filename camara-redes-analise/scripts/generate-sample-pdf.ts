import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { generateReportPdf } from "../lib/pdf";

const ranking = `### Totais
- Total bruto de postagens do arquivo: 1.248
- Total de postagens analisadas: 1.248
- Total offtopic: 184
- Total repetidos: 67
- Total relevantes: 997

### Ranking para gráfico
| Termo | Ocorrências | Percentual % |
|---|---:|---:|
| Aprovar com urgência | 312 | 31,3% |
| Reforçar a fiscalização | 228 | 22,9% |
| Proteger o público afetado | 184 | 18,5% |
| Rever o impacto financeiro | 129 | 12,9% |
| Ampliar o debate público | 81 | 8,1% |
| Outras opiniões sobre o assunto | 63 | 6,3% |

### Transparência
Os sinônimos foram reunidos apenas quando mantinham a mesma direção do argumento. Textos idênticos do mesmo autor foram contados uma vez.`;

const qualitative = Array.from(
  { length: 18 },
  (_, index) =>
    `**${index + 1} - ARGUMENTO REPRESENTATIVO | ${70 - index} ocorrências**\nAs postagens apresentam um ponto objetivo sobre a proposta e explicam o efeito esperado para o público relacionado. O texto mantém a imparcialidade e usa somente os dados fornecidos.\n**Postagem representativa:**\n\"É preciso avaliar o texto com cuidado e dar uma resposta clara.\"`,
).join("\n\n");

const bytes = await generateReportPdf({
  projectName: "PL 1234/2026 - Projeto de demonstração",
  generatedAt: new Date("2026-08-25T12:00:00-03:00"),
  sections: [
    { title: "Classificação, contagens e ranking", content: ranking },
    { title: "Análise qualitativa dos argumentos", content: qualitative },
    {
      title: "O que dizem",
      content:
        "A maior parte das postagens pede uma resposta clara e rápida. Outros argumentos defendem fiscalização, proteção do público e revisão dos impactos. O debate reúne posições distintas, mas permanece concentrado nos efeitos práticos da proposta.",
    },
    {
      title: "Canal de destaque",
      content:
        "O Instagram concentrou a maior parcela dos pontos de engajamento. X e Facebook também contribuíram, mas com participação menor no resultado do período.",
    },
    {
      title: "Quem mobilizou",
      content:
        "Poucos perfis reuniram a maior parte dos pontos de engajamento, enquanto a quantidade de postagens ficou distribuída entre vários autores.",
    },
    {
      title: "O que mobilizou",
      content:
        "A proximidade da votação pode ter ampliado a participação. As postagens associaram o debate aos efeitos práticos e à necessidade de uma decisão clara.",
    },
    {
      title: "Resumo executivo",
      content:
        "O debate destacou urgência, fiscalização e proteção do público. A mobilização cresceu perto da votação e ficou mais forte no Instagram, com pontos de engajamento concentrados em poucos perfis.",
    },
  ],
});

const directory = resolve("output/pdf");
await mkdir(directory, { recursive: true });
const output = resolve(directory, "Relatorio_Validacao_Visual.pdf");
await writeFile(output, bytes);
console.log(output);

