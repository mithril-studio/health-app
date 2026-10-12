type Row = { [key: string]: unknown };
const present = (row: Row | undefined, key: string) =>
  typeof row?.[key] === "number" && Number.isFinite(row[key]);
/** Indexes whose value has no recorded neighbour, so a line cannot draw them. */
export function isolatedIndexes(rows: Row[], key: string): Set<number> {
  const result = new Set<number>();
  rows.forEach((row, i) => {
    if (
      present(row, key) &&
      !present(rows[i - 1], key) &&
      !present(rows[i + 1], key)
    )
      result.add(i);
  });
  return result;
}
