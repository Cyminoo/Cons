const VERSION = "v14";

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Konsum-Sync-Version", VERSION);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export default async (_request) => {
  return json({ ok: 1, version: VERSION }, { status: 200 });
};
