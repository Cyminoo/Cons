import { getStore } from "@netlify/blobs";

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function bad(message, status = 400) {
  return json({ error: message }, { status });
}

function safeStr(x) { return String(x ?? ""); }

function sanitizeState(body) {
  const version = Number(body?.version) || 1;
  const updatedAt = safeStr(body?.updatedAt || new Date(0).toISOString());

  const entriesIn = Array.isArray(body?.entries) ? body.entries : [];
  const entries = entriesIn.map((e) => ({
    id: safeStr(e?.id),
    dt: safeStr(e?.dt),
    substance: safeStr(e?.substance),
    dose_mg: (e?.substance === "Alkohol") ? undefined : Number(e?.dose_mg),
    medical: Boolean(e?.medical),
    alcohol_drinks: Array.isArray(e?.alcohol_drinks) ? e.alcohol_drinks : (Array.isArray(e?.drinks) ? e.drinks : []),
    alcohol_total_ml: Number(e?.alcohol_total_ml),
    alcohol_pure_ml: Number(e?.alcohol_pure_ml),
    updated_at: safeStr(e?.updated_at || e?.dt || new Date(0).toISOString()),
  })).filter(e => e.id && e.dt && e.substance);

  // Normalize deleted map
  const deletedIn = (body?.deleted && typeof body.deleted === "object" && !Array.isArray(body.deleted)) ? body.deleted : {};
  const deleted = {};
  for (const [k, v] of Object.entries(deletedIn)) deleted[safeStr(k)] = safeStr(v);

  return { version, updatedAt, entries, deleted };
}

export default async (request) => {
  const url = new URL(request.url);
  const vault = url.searchParams.get("vault");
  if (!vault || vault.length < 20) return bad("missing vault", 400);

  let store;
  try {
    store = getStore({ name: "konsum-tracker", consistency: "strong" });
  } catch (err) {
    return json({ error: "blobs_unavailable", details: String(err) }, { status: 500 });
  }
  const key = `vault:${vault}`;

  if (request.method === "OPTIONS") {
    return new Response("", {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  if (request.method === "HEAD") {
    // treat as GET existence check
    const state = await store.get(key, { type: "json" });
    return new Response("", { status: state ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  }

  if (request.method === "GET") {
    const state = await store.get(key, { type: "json" });
    if (!state) return bad("not found", 404);
    return json(state, { status: 200 });
  }

  if (request.method === "PUT") {
    let body;
    let raw = "";
    try {
      raw = await request.text();
      body = JSON.parse(raw);
    } catch (err) {
      return json({
        error: "invalid_json",
        message: "Body must be valid JSON. Client should send JSON.stringify(payload).",
        received: raw.slice(0, 200)
      }, { status: 400 });
    }

    const incoming = sanitizeState(body);
    const current = await store.get(key, { type: "json" });

    // Prevent stale overwrite
    if (current && safeStr(current.updatedAt) > safeStr(incoming.updatedAt)) {
      return json({ ...current, note: "server_newer" }, { status: 200 });
    }

    await store.set(key, incoming);
    return json(incoming, { status: 200 });
  }

  if (request.method === "DELETE") {
    await store.delete(key);
    return json({ ok: 1 }, { status: 200 });
  }

  return bad("method not allowed", 405);
};
