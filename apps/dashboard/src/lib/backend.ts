import "server-only";
import { NextRequest } from "next/server";

const paths =
  /^(auth\/(login|logout|me)|users(\/[0-9a-f-]{36})?|roles|configuration|coding-workers(\/[0-9a-f-]{36})?|worker\/(claim|executions\/[0-9a-f-]{36}\/(heartbeat|complete))|executions\/[0-9a-f-]{36}\/release|webhooks\/gitlab|projects(\/[0-9a-f-]{36}(\/runs)?)?|runs\/[0-9a-f-]{36}(\/(events|stream|approval|retry|cancel))?|status)$/;

export async function proxy(
  request: NextRequest,
  path: string,
): Promise<Response> {
  if (!paths.test(path)) return new Response(null, { status: 404 });
  const origin = request.headers.get("origin");
  if (request.method !== "GET" && origin) {
    try {
      const url = new URL(origin);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.host !== request.headers.get("host")
      )
        return Response.json(
          { error: { message: "invalid_origin" } },
          { status: 403 },
        );
    } catch {
      return new Response(null, { status: 403 });
    }
  }
  const headers = new Headers();
  for (const name of [
    "cookie",
    "x-csrf-token",
    "origin",
    "last-event-id",
    "authorization",
    "x-gitlab-token",
    "x-gitlab-event",
    "x-gitlab-event-uuid",
  ])
    if (request.headers.has(name))
      headers.set(name, request.headers.get(name)!);
  headers.set("Content-Type", "application/json");
  const query = new URLSearchParams();
  for (const name of ["limit", "offset", "after"]) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) query.set(name, value);
  }
  const streaming = path.endsWith("/stream");
  try {
    const upstream = await fetch(
      `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:18000"}/${path === "status" ? "readyz" : "api/" + path}?${query}`,
      {
        method: request.method,
        headers,
        body: request.method === "GET" ? undefined : await request.text(),
        cache: "no-store",
        redirect: "error",
        signal: streaming
          ? request.signal
          : AbortSignal.any([
              request.signal,
              AbortSignal.timeout(path.startsWith("worker/") ? 120000 : 30000),
            ]),
      },
    );
    const outgoing = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const name of ["content-type", "x-request-id", "x-accel-buffering"])
      if (upstream.headers.has(name))
        outgoing.set(name, upstream.headers.get(name)!);
    for (const cookie of upstream.headers.getSetCookie())
      outgoing.append("Set-Cookie", cookie);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      { error: { message: "backend_unavailable" } },
      { status: 503 },
    );
  }
}
