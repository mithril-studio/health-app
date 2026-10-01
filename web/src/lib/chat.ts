import { array, record, text } from "./data";
export type ChatMessage = { role: "user" | "assistant"; content: string; createdAt: string };
export function chatMessages(value: unknown): ChatMessage[] {
  const root = record(value);
  if (!Array.isArray(root.messages)) throw new Error("Invalid chat response");
  return root.messages.flatMap(value => {
    const row=record(value); const role=row.role; const content=text(row.content);
    return (role==="user"||role==="assistant")&&content ? [{role,content,createdAt:text(row.created_at)}] : [];
  });
}
export type Deletion = { token: string; name: string; date: string; description: string; expiresAt: string };
export function pendingDeletions(value: unknown): Deletion[] {
  return array(record(value).pending).flatMap(value => {
    const row=record(value); const snapshot=record(row.snapshot); const token=text(row.token);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(token)) return [];
    return [{ token, name:text(snapshot.name), date:text(snapshot.start_date_local).slice(0,10), description:text(snapshot.description), expiresAt:text(row.expires_at) }];
  });
}
