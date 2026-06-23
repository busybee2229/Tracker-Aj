// Suggestion engine: for any item where finalised picks < quantity needed, ask
// Gemini for a few FRESH, good candidate products (name + why + pros/cons +
// estimated ₹), excluding ones already listed or previously suggested. Builds
// broad retailer search links so you can explore + finalise. Writes suggestions.json.
// Needs GEMINI_API_KEY. Reads your finalised picks/needs from the Supabase shared row.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ─── EDIT THIS: your situation, so suggestions are tailored ───────────────────
const CONTEXT = "Newborn arriving Oct/Nov (winter). Family based in India — buy in INR ₹; for higher quality they may also buy from the UK or Canada. Prefer practical, safe, well-reviewed, widely-available products.";
const PER_ITEM = 3;            // how many fresh suggestions per under-filled item
// Each model has its OWN separate daily quota on the same API key, so we spread requests
// across many free models, ordered best-quota-first. A 429 on one just moves to the next.
// ⚠️ Confirm exact IDs against Google AI Studio's "Get code" snippet — some may differ.
const MODELS = [
  "gemini-3.1-flash-lite",   // ~500/day — primary workhorse (Gemini model, supports JSON response mode)
  "gemma-4-26b-it",          // ~1500/day — deep backup (Gemma may reject JSON mode; confirm ID)
  "gemma-4-31b-it",          // ~1500/day — deep backup (same caveat)
  "gemini-2.5-flash",        // ~20/day
  "gemini-3-flash-preview",  // ~20/day — note the -preview suffix
  "gemini-3.5-flash",        // ~20/day — confirm exact ID
  "gemini-2.5-flash-lite"    // ~20/day
];
// ──────────────────────────────────────────────────────────────────────────────

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.log("No GEMINI_API_KEY — skipping."); process.exit(0); }
const SUPA_URL = "https://nrpjtychwmuecmskehyj.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ycGp0eWNod211ZWNtc2tlaHlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNDMyMDUsImV4cCI6MjA5NzYxOTIwNX0.g-WGgUyrHLwql4ZqcNjVvCuT1TzcNIo1z6NNIdVNE9s";

const products = JSON.parse(readFileSync("products.json", "utf8"));
const out = existsSync("suggestions.json") ? JSON.parse(readFileSync("suggestions.json", "utf8")) : {};
const byId = {}; products.forEach(p => byId[String(p.id)] = p);

let shared = {};
try { const r = await fetch(SUPA_URL + "/rest/v1/tracker_state?id=eq.shared&select=data", { headers: { apikey: ANON, Authorization: "Bearer " + ANON } });
  shared = ((await r.json())[0] || {}).data || {}; } catch (e) { console.log("supabase read failed", e.message); }

const PINS = shared.pins || {}, UQ = shared.userqty || {}, UO = shared.useropts || {}, HID = shared.hiddenopts || {}, USER = shared.useritems || [];
const SUGHIDE = shared.sughide || {}, SUGGADD = shared.suggadd || {};   // dismissed names + on-demand fetched (don't re-suggest these)
USER.forEach(p => byId[String(p.id)] = p);
const pinsOf = id => Array.isArray(PINS[id]) ? PINS[id] : (PINS[id] != null ? [PINS[id]] : []);
const neededQty = p => { if (UQ[p.id] != null) return +UQ[p.id]; const m = String(p.qty || "").match(/\d+/g); return m ? +m[m.length - 1] : 1; };
const optionNames = p => (p.options || []).filter(o => !((HID[p.id] || []).includes(o.name))).map(o => o.name).concat((UO[p.id] || []).map(o => o.name));

const linksFor = name => { const q = encodeURIComponent(name); return { india: `https://www.amazon.in/s?k=${q}`, uk: `https://www.next.co.uk/search?w=${q}`, canada: `https://www.amazon.ca/s?k=${q}` }; };

// call Gemini across models: a 429 (that model's daily quota) marks it done and falls through
// to the next; 503/500 (busy) and any other error (e.g. a wrong/unsupported model ID) also try
// the next model. We only give up once EVERY model has hit its daily 429.
const dead = new Set();
const allDead = () => dead.size >= MODELS.length;
async function callGemini(body) {
  if (allDead()) return null;
  for (const model of MODELS) {
    if (dead.has(model)) continue;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) return await res.json();
      if (res.status === 429) { console.log(`  ${model} 429 — daily quota reached; next model (resets midnight PT)`); dead.add(model); continue; }
      if (res.status === 503 || res.status === 500) { console.log(`  ${model} ${res.status} busy — next model`); continue; }
      console.log(`  ${model}`, res.status, (await res.text()).slice(0, 120), "— next model"); continue;
    } catch (e) { console.log("  net", e.message, "— next model"); }
  }
  return null;
}
async function suggest(p, exclude) {
  const prompt = `You help a parent finalise baby-product purchases.\nContext: ${CONTEXT}\nThey still need more options for: "${p.item}" (category ${p.category || ""}).\nDo NOT repeat any of these already-considered products: ${exclude.join("; ") || "none"}.\nSuggest ${PER_ITEM} DIFFERENT, genuinely good, real products for this need. For each: name (brand + product), a one-line why, 2 short pros, 1 short con, and an estimated price in INR (integer).\nReply ONLY as JSON: [{"name":"","why":"","pros":["",""],"cons":[""],"price":0}]`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 700, responseMimeType: "application/json" } };
  const j = await callGemini(body);
  if (!j) return [];
  try {
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content.parts[0].text || "[]";
    const arr = JSON.parse(txt);
    return (Array.isArray(arr) ? arr : []).filter(s => s && s.name).map(s => ({
      name: String(s.name).slice(0, 80), why: String(s.why || "").slice(0, 120),
      pros: (s.pros || []).slice(0, 2).map(String), cons: (s.cons || []).slice(0, 1).map(String),
      price: Math.round(+s.price) || 0, currency: "INR", links: linksFor(s.name)
    }));
  } catch (e) { console.log("  parse/gen fail", e.message); return []; }
}

// Ideas now show on EVERY item (not just under-filled). Cover items WITHOUT suggestions
// first so all items get filled over successive runs, then refresh the rest.
const items = products.concat(USER).slice().sort((a, b) => {
  const A = (out[String(a.id)] && (out[String(a.id)].list || []).length) ? 1 : 0;
  const B = (out[String(b.id)] && (out[String(b.id)].list || []).length) ? 1 : 0;
  return A - B; });
const CAP = 60;   // covers all items in one run (gemini-3.1-flash-lite ~500/day, 15 RPM; ~57 items at 5s = ~12/min)
let n = 0, processed = 0;
for (const p of items) {
  if (allDead() || processed >= CAP) break;
  const need = neededQty(p), done = pinsOf(p.id).length;
  const prev = (out[String(p.id)] && out[String(p.id)].seen) || [];
  const dismissed = (SUGHIDE[String(p.id)] || []), fetched = (SUGGADD[String(p.id)] || []).map(s => s && s.name).filter(Boolean);
  const exclude = [...new Set([...optionNames(p), ...prev, ...dismissed, ...fetched])];
  const list = await suggest(p, exclude); processed++;
  if (list.length) { out[String(p.id)] = { ts: new Date().toISOString().slice(0, 10), seen: [...new Set([...prev, ...list.map(s => s.name)])].slice(-40), list }; n += list.length; console.log(`ok  ${p.id} ${p.item}: ${list.length} (${done}/${need})`); }
  await new Promise(r => setTimeout(r, 5000));   // ~5s between calls to stay under per-minute (RPM) limits
}
writeFileSync("suggestions.json", JSON.stringify(out, null, 1));
console.log(`done — ${n} suggestions`);
