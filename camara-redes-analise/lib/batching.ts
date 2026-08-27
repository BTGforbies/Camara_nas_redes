export function groupByCharacterLimit(
  values: string[],
  maxCharacters: number,
) {
  if (!Number.isFinite(maxCharacters) || maxCharacters < 10_000) {
    throw new Error("O limite de consolidação da análise é inválido.");
  }

  const groups: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const value of values) {
    const itemLength = value.length + 80;
    if (itemLength > maxCharacters) {
      throw new Error(
        "Um resultado parcial ficou grande demais para a consolidação automática.",
      );
    }
    if (current.length && currentLength + itemLength > maxCharacters) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(value);
    currentLength += itemLength;
  }

  if (current.length) groups.push(current);
  return groups;
}

export function wrapPartialResults(values: string[]) {
  return values
    .map(
      (content, index) =>
        `<RESULTADO_PARCIAL_${index + 1}>\n${content}\n</RESULTADO_PARCIAL_${index + 1}>`,
    )
    .join("\n\n");
}
