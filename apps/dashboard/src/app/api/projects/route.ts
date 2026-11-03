import { NextRequest } from "next/server";
import { backend } from "@/lib/backend";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = new URLSearchParams();
  for (const name of ["limit", "offset"]) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) query.set(name, value);
  }
  return backend(`/api/projects?${query}`);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  // Compare the browser authority with the actual Host header: the server's
  // internal hostname differs when running standalone behind a port mapping.
  let sameOrigin = true;
  if (origin) {
    try {
      const parsed = new URL(origin);
      sameOrigin =
        ["http:", "https:"].includes(parsed.protocol) &&
        parsed.host === request.headers.get("host");
    } catch {
      sameOrigin = false;
    }
  }
  if (!sameOrigin) {
    return Response.json(
      { error: { code: "invalid_origin" } },
      { status: 403 },
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: { code: "invalid_json" } }, { status: 400 });
  }
  return backend("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
