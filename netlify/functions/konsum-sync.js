import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function bad(message, status = 400) {
  return json({ error: message }, { status });
}

function normalizeEntry(e) {
  const dt = String(e?.dt || "");
  const updated_at = String(e?.updated_at || dt || new Date(0).toISOString());
  return {
    id: String(e?.id || ""),
    dt,
    substance: String(e?.substance || ""),
    dose_mg: Number(e?.dose_mg),
    updated_at,
  };
}

function normalizeDeletedMap(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[String(k)] = String(v || "");
  return out;
}

function latestUpdatedAt(entries) {
  let best = "";
  for (const e of entries || []) {
    const t = String(e?.updated_at || "");
    if (t > best) best = t;
  }
  return best || new Date(0).toISOString();
}

function latestDeletedAt(deletedMap) {
  let best = "";
  for (const t of Object.values(deletedMap || {})) {
    const s = String(t || "");
    if (s > best) best = s;
  }
  return best || new Date(0).toISOString();
}

function syncRevision(entries, deletedMap) {
  const a = latestUpdatedAt(entries);
  const b = latestDeletedAt(deletedMap);
  return a > b ? a : b;
}

function mergeDeleted(a, b) {
  const out = { ...(a || {}) };
  for (const [id, t] of Object.entries(b || {})) {
    if (!out[id] || String(t) > String(out[id])) out[id] = String(t);
  }
  return out;
}

function mergeEntries(localEntries, remoteEntries, deletedMap = {}) {
  const map = new Map();
  for (const e of (localEntries || []).map(normalizeEntry)) {
    if (e.id) map.set(e.id, e);
  }
  for (const e of (remoteEntries || []).map(normalizeEntry)) {
    if (!e.id) continue;
    const cur = map.get(e.id);
    if (!cur) map.set(e.id, e);
    else {
      const a = String(cur.updated_at || "");
      const b = String(e.updated_at || "");
      map.set(e.id, b > a ? e : cur);
    }
  }
  return [...map.values()].filter((e) => {
    if (!(e.id && e.dt && e.substance && Number.isFinite(e.dose_mg))) return false;
    const tomb = deletedMap[e.id];
    if (!tomb) return true;
    return String(e.updated_at || "") > String(tomb || "");
  });
}

async function getStoreAdapter() {
  try {
    const mod = await import("@netlify/blobs");
    const store = mod.getStore({ name: "konsum-sync", consistency: "strong" });
    return {
      async getJSON(key) {
        const raw = await store.get(key, { consistency: "strong" });
        return raw ? JSON.parse(raw) : null;
      },
      async setJSON(key, value) {
        await store.setJSON(key, value);
      },
    };
  } catch {
    const dir = join(tmpdir(), "konsum-tracker-sync-store");
    await mkdir(dir, { recursive: true });
    const filePath = (key) => join(dir, key.replace(/[^\w.-]+/g, "_") + ".json");
    return {
      async getJSON(key) {
        try {
          const raw = await readFile(filePath(key), "utf8");
          return JSON.parse(raw);
        } catch {
          return null;
        }
      },
      async setJSON(key, value) {
        await writeFile(filePath(key), JSON.stringify(value, null, 2), "utf8");
      },
    };
  }
}

export default async (req, context) => {
  const url = new URL(req.url);
  const vault = url.searchParams.get("vault") || "";
  if (!/^[a-f0-9]{64}$/i.test(vault)) return bad("Missing or invalid vault", 400);

  const store = await getStoreAdapter();
  const key = `vault-${vault}`;

  if (req.method === "GET") {
    const existing = await store.getJSON(key);
    if (!existing) return bad("Not found", 404);
    return json(existing, { status: 200 });
  }

  if (req.method === "PUT") {
    let body;
    try {
      body = await req.json();
    } catch {
      return bad("Invalid JSON", 400);
    }

    const incomingEntries = Array.isArray(body?.entries)
      ? body.entries.map(normalizeEntry).filter((e) => e.id && e.dt && e.substance && Number.isFinite(e.dose_mg))
      : [];
    const incomingDeleted = normalizeDeletedMap(body?.deleted);
    const existing = (await store.getJSON(key)) || { version: 3, updatedAt: new Date(0).toISOString(), entries: [], deleted: {} };

    const mergedDeleted = mergeDeleted(normalizeDeletedMap(existing.deleted), incomingDeleted);
    const mergedEntries = mergeEntries(existing.entries || [], incomingEntries, mergedDeleted);
    const updatedAt = syncRevision(mergedEntries, mergedDeleted);

    const payload = {
      version: 3,
      updatedAt,
      savedAt: new Date().toISOString(),
      entries: mergedEntries,
      deleted: mergedDeleted,
    };

    await store.setJSON(key, payload);
    return json(payload, { status: 200 });
  }

  return bad("Method not allowed", 405);
};
