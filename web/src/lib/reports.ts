import { record, text } from "./data";
/** The pinned conversation id for the read-only scheduled Reports view. */
export const REPORTS = "reports";
export type ReportKind = "morning" | "evening" | "activity" | "report";
export type Report = {
  id: number;
  kind: ReportKind;
  content: string;
  createdAt: string;
};
const KNOWN_KINDS = new Set<ReportKind>(["morning", "evening", "activity"]);
/** Defensive parse of /api/reports; an unexpected kind becomes a generic "report". */
export function parseReports(value: unknown): Report[] {
  const root = record(value);
  if (!Array.isArray(root.reports))
    throw new Error("Invalid reports response");
  return root.reports.flatMap((value) => {
    const row = record(value);
    const content = text(row.content);
    if (!content) return [];
    const kind = text(row.kind);
    const id = typeof row.id === "number" ? row.id : Number(text(row.id));
    return [
      {
        id: Number.isFinite(id) ? id : 0,
        kind: (KNOWN_KINDS.has(kind as ReportKind)
          ? kind
          : "report") as ReportKind,
        content,
        createdAt: text(row.created_at),
      },
    ];
  });
}
