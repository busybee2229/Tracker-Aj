// Per-option auto-fetch: for every product option whose link is on a scrapable
// retailer (NOT Amazon/Next, which block bots), read price + image + title and
// write them to optdata.json (itemId -> optionName -> {price,currency,img,name}).
// The app merges this; a manual price you type on an option always wins.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SUPA_URL = "https://nrpjtychwmuecmskehyj.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ycGp0eWNod211ZWNtc2tlaHlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNDMyMDUsImV4cCI6MjA5NzYxOTIwNX0.g-WGgUyrHLwql4ZqcNjVvCuT1TzcNIo1z6NNIdVNE9s";
const HEADERS = { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36", "accept": "text/html,application/xhtml+xml", "accept-language": "en-GB,en;q=0.9" };
const FX = { INR: 1, GBP: 108, CAD: 62, USD: 85 };

const products = JSON.parse(readFileSync("products.json", "utf8"));
const out = existsSync("optdata.json") ? JSON.parse(readFileSync("optdata.json", "utf8")) : {};

async function getFX(){ try{ const r=await fetch("https://open.er-api.com/v6/latest/INR"); const j=await r.json(); if(j&&j.rates){ if(j.rates.GBP)FX.GBP=1/j.rates.GBP; if(j.rates.CAD)FX.CAD=1/j.rates.CAD; if(j.rates.USD)FX.USD=1/j.rates.USD; } }catch{} }
async function getText(u){ for(let i=0;i<2;i++){ try{ const r=await fetch(u,{headers:HEADERS,redirect:"follow"}); if(r.ok)return await r.text(); }catch{} await new Promise(r=>setTimeout(r,400)); } return ""; }
const isBlocked = u => /amazon\.|\/\/www\.next\.|\.next\.co/i.test(u||"");
function fromShopify(t){ try{ const j=JSON.parse(t); const v=j.product&&j.product.variants&&j.product.variants[0]; if(v&&v.price)return{price:parseFloat(v.price),currency:v.price_currency||"INR"}; }catch{} return null; }
function fromJsonLd(html){ for(const b of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)){ try{ const d=JSON.parse(b[1].trim()); const arr=Array.isArray(d)?d:(d["@graph"]||[d]); for(const n of arr){ let o=n.offers; if(Array.isArray(o))o=o[0]; if(o&&o.price)return{price:parseFloat(o.price),currency:o.priceCurrency||"INR"}; } }catch{} } return null; }
function fromMeta(html){ const p=html.match(/<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([\d.,]+)["']/i); const c=html.match(/<meta[^>]+(?:property|name)=["'](?:product:price:currency|og:price:currency)["'][^>]+content=["']([A-Za-z]{3})["']/i); if(p)return{price:parseFloat(p[1].replace(/,/g,"")),currency:c?c[1].toUpperCase():"INR"}; return null; }
function ogImage(html){ const m=html.match(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i); return (m&&/^https?:\/\//i.test(m[1]))?m[1]:""; }
function ogTitle(html){ const m=html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i); return m?m[1].slice(0,80):""; }

let shared={}; try{ const r=await fetch(SUPA_URL+"/rest/v1/tracker_state?id=eq.shared&select=data",{headers:{apikey:ANON,Authorization:"Bearer "+ANON}}); const j=await r.json(); shared=(j&&j[0]&&j[0].data)||{}; }catch(e){ console.log("supabase read failed",e.message); }

// item -> {bestRegion, options:[{name,india,uk,canada}]}
const items=[];
products.forEach(p=>{ const opts=(p.options||[]).concat((shared.useropts||{})[p.id]||[]); items.push({id:String(p.id),br:p.bestRegion||"india",opts}); });
(shared.useritems||[]).forEach(p=>items.push({id:String(p.id),br:p.bestRegion||"india",opts:p.options||[]}));

await getFX();
let n=0;
for(const it of items){ for(const o of it.opts){ const link=o[it.br]||o.india||o.uk||o.canada; if(!link||isBlocked(link))continue;
  let res=null, html="", img="", name="";
  if(/\/products\//.test(link)){ const j=await getText(link.split("?")[0].replace(/\/$/,"")+".json"); if(j)res=fromShopify(j); }
  html=await getText(link);
  if(html){ if(!res)res=fromJsonLd(html)||fromMeta(html); img=ogImage(html); name=ogTitle(html); }
  if(res||img){ const rec=(out[it.id]=out[it.id]||{})[o.name]||{};
    if(res&&res.price>0){ rec.price=res.price; rec.currency=res.currency; }
    if(img)rec.img=img; if(name)rec.name=name; out[it.id][o.name]=rec; n++;
    console.log(`ok ${it.id} ${o.name}: ${res?res.currency+" "+res.price:"(no price)"} ${img?"img":""}`); }
  else console.log(`skip ${it.id} ${o.name}`);
  await new Promise(r=>setTimeout(r,350));
} }
writeFileSync("optdata.json", JSON.stringify(out));
console.log(`done — ${n} options updated`);
