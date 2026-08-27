export function normalizeQualitativeRanking(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const plain = line
        .trim()
        .replace(/^\*\*\s*/, "")
        .replace(/\s*\*\*$/, "")
        .trim();
      const heading = plain.match(/^(\d+)\s*-\s*(.+?)\s*\|\s*(.+)$/);
      if (!heading) return line;

      const publicTitle = heading[2]
        .split(/\s*\/\s*/)[0]
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleUpperCase("pt-BR");
      const metrics = heading[3].replace(/\s*\*\*$/, "").trim();

      return `**${heading[1]} - ${publicTitle} | ${metrics}**`;
    })
    .join("\n")
    .trim();
}
