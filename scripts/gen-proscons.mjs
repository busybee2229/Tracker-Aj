// Auto-generate pros/cons for any product (catalogue or your added picks) that
// doesn't have them yet, using Gemini Flash (free tier). Results are cached in
// proscons.json — already-filled products are never re-generated. Needs the
// GEMINI_API_KEY secret. Reads your added items from the Supabase shared row.
import { readFileSync, writeFileSync } from "node:fs";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.log("No GEMINI_API_KEY set — skipping."); process.exit(0); }

const SUPA_URL = "https://nrpjtychwmuecmskehyj.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ycGp0eWNod211ZWNtc2tlaHlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNDMyMDUsImV4cCI6MjA5NzYxOTIwNX0.g-WGgUyrHLwql4ZqcNjVvCuT1TzcNIo1z6NNIdVNE9s";
const MODEL = "gemini-2.5-flash-lite";   // free tier: 30 RPM, 1500/day (gemini-2.0-flash was retired Jun 2026)

const products = JSON.parse(readFileSync("products.json", "utf8"));
const pc = JSON.parse(readFileSync("proscons.json", "utf8"));
const byId = {}; products.forEach(p => byId[String(p.id)] = p);

let shared = {};
try { const r = await fetch(SUPA_URL + "/rest/v1/tracker_state?id=eq.shared&select=data", { headers: { apikey: ANON, Authorization: "Bearer " + ANON } });
  const j = await r.json(); shared = (j && j[0] && j[0].data) || {}; } catch (e) { console.log("Supabase read failed:", e.message); }

// every option that still lacks pros/cons (catalogue defaults + your added options/items)
const targets = [];
const add = (id, item, cat, name) => { if (name && !((pc[String(id)] || {})[name])) targets.push({ id: String(id), item, cat, name }); };
products.forEach(p => (p.options || []).forEach(o => add(p.id, p.item, p.category, o.name)));
Object.entries(shared.useropts || {}).forEach(([id, arr]) => { const p = byId[id]; (arr || []).forEach(o => add(id, p ? p.item : id, p ? p.category : "", o.name)); });
(shared.useritems || []).forEach(p => (p.options || []).forEach(o => add(p.id, p.item, p.category, o.name)));

console.log(`${targets.length} option(s) need pros/cons`);
if (!targets.length) process.exit(0);

async function gen(t) {
  const prompt = `For the baby product "${t.name}" (used as: ${t.item}${t.cat ? ", category " + t.cat : ""}), give concise buying pros and cons for new parents choosing between options. Reply ONLY as JSON: {"pros":["..."],"cons":["..."]} with 1-2 short pros and 1 short con. No extra text.`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 200, responseMimeType: "application/json" } };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;
  let j = null;
  for (let a = 0; a < 3 && !j; a++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) { j = await res.json(); break; }
      if (res.status === 429) { console.log("  429 rate limit — waiting 60s"); await new Promise(r => setTimeout(r, 60000)); continue; }
      console.log("  gemini error", res.status, (await res.text()).slice(0, 160)); return null;
    } catch (e) { console.log("  net", e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
  if (!j) return null;
  try {
    const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts[0].text || "";
    const o = JSON.parse(txt);
    if (Array.isArray(o.pros) && o.pros.length) return { pros: o.pros.slice(0, 2), cons: (o.cons || []).slice(0, 2) };
  } catch (e) { console.log("  parse fail:", e.message); }
  return null;
}

let n = 0;
for (const t of targets) {
  const out = await gen(t);
  if (out) { (pc[t.id] = pc[t.id] || {})[t.name] = out; n++; console.log(`ok   [${t.id}] ${t.name}`); }
  else console.log(`skip [${t.id}] ${t.name}`);
  await new Promise(r => setTimeout(r, 2500)); // ~24 req/min, under Flash-Lite's 30 RPM cap
}
if (n) writeFileSync("proscons.json", JSON.stringify(pc, null, 2));
console.log(`done — ${n} generated`);
