/** Response and body helpers. No CORS headers anywhere: no browser calls this function. */

const BASE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...BASE_HEADERS, ...headers },
  });
}

export function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...BASE_HEADERS, ...headers } });
}

export type Body = { ok: true; value: unknown; raw: string } | { ok: false; status: number };

/** Read a JSON body of at most `max` bytes; an empty body is `null`. */
export async function readJson(req: Request, max: number): Promise<Body> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) return { ok: false, status: 413 };
  let raw = "";
  if (req.body) {
    const reader = req.body.getReader();
    const dec = new TextDecoder();
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        return { ok: false, status: 413 };
      }
      raw += dec.decode(value, { stream: true });
    }
    raw += dec.decode();
  }
  if (raw.trim() === "") return { ok: true, value: null, raw };
  try {
    return { ok: true, value: JSON.parse(raw), raw };
  } catch {
    return { ok: false, status: 400 };
  }
}
