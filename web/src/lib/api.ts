import { copy } from "./i18n";
import { record } from "./data";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
    timeout?: number;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeout ?? 45000);
  try {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
        ? AbortSignal.any([timeout, options.signal])
        : timeout,
    });
    if (!response.ok) {
      if (response.status === 401 && !path.endsWith("/login"))
        window.dispatchEvent(new Event("reachy:unauthorized"));
      if (response.status === 503 && path.split("?")[0] === "/api/chat") {
        const body = record(await response.json().catch(() => null));
        if (
          typeof body.code === "string" &&
          Object.hasOwn(copy.errors.coaching, body.code)
        ) {
          throw new ApiError(
            response.status,
            copy.errors.coaching[
              body.code as keyof typeof copy.errors.coaching
            ],
          );
        }
      }
      throw new ApiError(
        response.status,
        response.status === 401
          ? copy.errors.unauthorized
          : response.status === 429
            ? copy.errors.rateLimit
            : copy.errors.generic,
      );
    }
    if (response.status === 204) return undefined as T;
    const result: unknown = await response.json();
    if (record(result).error)
      throw new ApiError(response.status, copy.errors.generic);
    return result as T;
  } catch (error) {
    if (error instanceof ApiError || options.signal?.aborted) throw error;
    if (timeout.aborted) throw new ApiError(408, copy.errors.timeout);
    throw new ApiError(0, copy.errors.offline);
  }
}
export const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : copy.errors.invalid;
