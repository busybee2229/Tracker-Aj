// Edge Function: suggest
// On-demand AI product suggestions for ONE item. Admin-gated (same password as
// save-state) so randoms can't burn the Gemini quota. Holds the Gemini key as a
// server-side secret — the public page never sees it. Returns fresh suggestions
// excluding any names the caller already has/dismissed.
//
// Deploy:  supabase functions deploy suggest
// Secrets: supabase secrets set GEMINI_API_KEY='<key>'   (ADMIN_PASSWORD already set for save-state)

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") ?? "";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

// keep in sync with scripts/gen-suggestions.mjs
const CONTEXT = "Newborn arriving Oct/Nov (winter). Family based in India — buy in INR ₹; for higher quality they may also buy from the UK or Canada. Prefer practical, safe, well-reviewed, widely-available products.";
const MODELS = ["gemini-3.1-flash-lite", "gemma-4-26b-it", "gemma-4-31b-it", "gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3.5-flash", "gemini-2.5-flash-lite"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
function eq(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
const linksFor = (name: string) => { const q = encodeURIComponent(name); return { india: `https://www.amazon.in/s?k=${q}`, uk: `https://www.next.co.uk/search?w=${q}`, canada: `https://www.amazon.ca/s?k=${q}` }; };

async function callGemini(body: unknown) {
  const dead = new Set<string>();
  for (const model of MODELS) {
    if (dead.has(model)) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) return await res.json();
      if (res.status === 429) { dead.add(model); continue; }
      if (res.status === 503 || res.status === 500) continue;
      continue; // wrong/unsupported model id etc. → next model
    } catch { /* network → next model */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: { password?: string; item?: string; category?: string; exclude?: string[]; n?: number };
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const password = typeof body.password === "string" ? body.password : "";
  if (!ADMIN_PASSWORD || !eq(password, ADMIN_PASSWORD)) { await new Promise((r) => setTimeout(r, 500)); return json({ error: "unauthorized" }, 401); }
  if (!GEMINI_KEY) return json({ error: "no gemini key configured" }, 500);

  const item = String(body.item || "").slice(0, 120);
  if (!item) return json({ error: "missing item" }, 400);
  const category = String(body.category || "").slice(0, 60);
  const exclude = Array.isArray(body.exclude) ? body.exclude.map((s) => String(s)).slice(0, 60) : [];
  const n = Math.min(5, Math.max(1, Number(body.n) || 3));

  const prompt = `You help a parent finalise baby-product purchases.\nContext: ${CONTEXT}\nThey want more options for: "${item}" (category ${category}).\nDo NOT repeat any of these already-considered products: ${exclude.join("; ") || "none"}.\nSuggest ${n} DIFFERENT, genuinely good, real products for this need. For each: name (brand + product), a one-line why, 2 short pros, 1 short con, and an estimated price in INR (integer).\nReply ONLY as JSON: [{"name":"","why":"","pros":["",""],"cons":[""],"price":0}]`;
  const gbody = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 700, responseMimeType: "application/json" } };

  const j = await callGemini(gbody);
  if (!j) return json({ error: "all models busy or quota reached — try again later" }, 503);
  try {
    const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const arr = JSON.parse(txt);
    const seen = new Set(exclude.map((s) => s.toLowerCase()));
    const list = (Array.isArray(arr) ? arr : []).filter((s) => s && s.name && !seen.has(String(s.name).toLowerCase())).map((s) => ({
      name: String(s.name).slice(0, 80), why: String(s.why || "").slice(0, 120),
      pros: (s.pros || []).slice(0, 2).map(String), cons: (s.cons || []).slice(0, 1).map(String),
      price: Math.round(+s.price) || 0, currency: "INR", links: linksFor(String(s.name)),
    }));
    return json({ list });
  } catch { return json({ error: "could not parse model output" }, 502); }
});
