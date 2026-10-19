import "server-only";
import { notFound, redirect } from "next/navigation";
import { devAuthUser } from "./session";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message: string; issues?: { path: string; message: string }[] };

async function authHeader(): Promise<Record<string, string>> {
  if (devAuthUser) return {};
  const { auth } = await import("@clerk/nextjs/server");
  const token = await (await auth()).getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Calls the API as the signed-in user. Never throws on HTTP errors. */
export async function apiCall<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(await authHeader()) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) redirect("/sign-in");
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { ok: true, data: body as T };
  return {
    ok: false,
    status: res.status,
    error: String(body.error ?? "error"),
    message: String(body.message ?? (res.status === 400 ? "Please check the highlighted fields." : "Something went wrong")),
    issues: body.issues as { path: string; message: string }[] | undefined,
  };
}

/** For pages: returns data, 404s on not-found, throws otherwise (rendered by the error boundary). */
export async function apiGet<T>(path: string): Promise<T> {
  const r = await apiCall<T>(path);
  if (r.ok) return r.data;
  if (r.status === 404) notFound();
  throw new Error(r.message);
}
