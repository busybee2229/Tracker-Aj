// Edge Function: save-state
// The ONLY way the shared registry row may be written. RLS denies anon writes;
// this function verifies the admin password (kept as a server-side secret) and
// writes with the service-role key. Friends (no password) can read but never write.
//
// Deploy:  supabase functions deploy save-state
// Secrets: supabase secrets set ADMIN_PASSWORD='<your password>'
//          (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

// constant-time-ish string compare to avoid trivial timing leaks
function eq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { password?: string; data?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const password = typeof body.password === "string" ? body.password : "";
  if (!ADMIN_PASSWORD || !eq(password, ADMIN_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 500)); // slow brute-force
    return json({ error: "unauthorized" }, 401);
  }

  const data = body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "bad data" }, 400);
  if (JSON.stringify(data).length > 1_000_000) return json({ error: "payload too large" }, 413);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Optimistic concurrency: reject writes older than what's already stored,
  // so an in-flight stale write can't clobber a newer one. (Deletes still win
  // because a delete is simply a newer state with the item removed.)
  const incomingTs = Number((data as { ts?: number }).ts) || 0;
  const { data: existing } = await sb
    .from("tracker_state").select("data").eq("id", "shared").maybeSingle();
  const existingTs = Number((existing?.data as { ts?: number } | undefined)?.ts) || 0;
  if (incomingTs && existingTs && incomingTs < existingTs) {
    return json({ error: "stale", existingTs }, 409);
  }

  const { error } = await sb.from("tracker_state").upsert({ id: "shared", data });
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
