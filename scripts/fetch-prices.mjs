// Free, dependency-free price + image fetcher for the Baby Deal Tracker.
// Runs in GitHub Actions (Node 20+). Reads products.json, tries to capture a
// current price (-> INR) and the product image for each Buy/Confirm item's
// BEST option, and appends to prices.json. Resilient: skips what it can't read.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Price fetching from retailer SEARCH pages is unreliable (wrong numbers), so it is
// disabled until a real price API is configured. Set the PRICE_API_KEY secret to enable,
// and implement the API call where extractPrice is used. This prevents inaccurate prices.
if(!process.env.PRICE_API_KEY){
  console.log("No PRICE_API_KEY set — skipping price fetch to avoid inaccurate data. Images are curated in products.json.");
  process.exit(0);
}

const FX = { GBP: 108, CAD: 62, USD: 85, INR: 1 };           // fallback rates
const today = new Date().toISOString().slice(0, 10);
const products = JSON.parse(readFileSync("products.json", "utf8"));
const out = existsSync("prices.json")
  ? JSON.parse(readFileSync("prices.json", "utf8")) : { items: {}, images: {} };
out.items ||= {}; out.images ||= {}; 
const bestRegion = (b="") => {
  b = b.toLowerCase();
  if (b.includes("india")) return "india";
  if (/uk|m&s|next|boots/.test(b)) return "uk";
  if (/ca|canada|costco|carter/.test(b)) return "canada";
  return "india";
};
const cur = { india:"INR", uk:"GBP", canada:"CAD" };

async function getRates(){
  try{ const r=await fetch("https://api.exchangerate.host/latest?base=GBP&symbols=INR");
    const j=await r.json(); if(j?.rates?.INR) FX.GBP=Math.round(j.rates.INR);}catch{}
  try{ const r=await fetch("https://api.exchangerate.host/latest?base=CAD&symbols=INR");
    const j=await r.json(); if(j?.rates?.INR) FX.CAD=Math.round(j.rates.INR);}catch{}
}
async function fetchHtml(url){
  try{ const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; BabyTrackerBot/1.0)"},redirect:"follow"});
    if(!r.ok) return ""; return await r.text(); }catch{ return ""; }
}
function extractImage(html){
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1] : "";
}
function extractPrice(html, currency){
  // very best-effort: look for a currency-tagged number
  const sym = currency==="INR" ? "₹|Rs\\.?|INR" : currency==="GBP" ? "£|GBP" : "\\$|CAD|C\\$";
  const re = new RegExp(`(?:${sym})\\s?([0-9][0-9,]{1,7}(?:\\.[0-9]{1,2})?)`, "i");
  const m = html.match(re);
  if(!m) return null;
  const n = parseFloat(m[1].replace(/,/g,""));
  return isFinite(n) && n>0 ? n : null;
}

const targets = products.filter(p => (p.status==="Buy"||p.status==="Confirm") && p.options?.length);
console.log(`Pricing ${targets.length} items…`);

await getRates();
for (const p of targets){
  const best = p.options[0]; const region = bestRegion(p.best);
  const url = best[region] || best.india || best.uk || best.canada;
  if(!url) continue;
  const html = await fetchHtml(url);
  if(!html) { console.log(`skip ${p.id} ${p.item} (no html)`); continue; }
  const local = extractPrice(html, cur[region]);
  if(local && local>=1){
    const inr = Math.round(local * (FX[cur[region]]||1));
    (out.items[p.id] ||= []).push({date:today, inr, region, local, currency:cur[region]});
    if(out.items[p.id].length>120) out.items[p.id]=out.items[p.id].slice(-120);
    console.log(`ok   ${p.id} ${p.item}: ${cur[region]} ${local} -> ₹${inr}`);
  } else {
    console.log(`img  ${p.id} ${p.item}: image=${img?"yes":"no"}, price=none`);
  }
  await new Promise(r=>setTimeout(r,400)); // be polite
}
out.updated = new Date().toISOString().slice(0,16).replace("T"," ");
writeFileSync("prices.json", JSON.stringify(out));
console.log("Wrote prices.json @", out.updated);
