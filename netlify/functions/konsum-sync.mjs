import { getStore } from "@netlify/blobs";

const store = getStore({ name: "konsum-tracker", consistency: "strong" });

function json(status, obj, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const vault = (url.searchParams.get("vault") || "").toLowerCase();

  // Restrict keys: avoid arbitrary user-controlled keys
  if (!/^[a-f0-9]{64}$/.test(vault)) {
    return json(400, { error: "bad_vault" });
  }

  const key = `vault/${vault}.json`;

  if (req.method === "GET") {
    const data = await store.get(key);
    if (data === null) return json(404, { error: "not_found" });
    try {
      return json(200, JSON.parse(data));
    } catch {
      return json(500, { error: "corrupt_blob" });
    }
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "bad_json" });
    }

    // Minimal validation
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const updatedAt = typeof body.updatedAt === "string" ? body.updatedAt : "";
    const version = body.version || 2;

    const payload = { version, updatedAt, entries, savedAt: new Date().toISOString() };

    await store.setJSON(key, payload);

    return json(200, { ok: true });
  }

  return json(405, { error: "method_not_allowed" }, { "Allow": "GET, PUT" });
};
