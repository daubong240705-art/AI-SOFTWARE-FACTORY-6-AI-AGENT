import "server-only";

export async function backend(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const base = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:18000";
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: { code: "backend_unavailable", message: "API unavailable" } },
      { status: 503 },
    );
  }
}
