// Free, accurate price reader. Reads EXACT prices from product pages that expose
// machine-readable data: Shopify (product URL + ".json"), JSON-LD Product offers,
// product:price meta tags, or price objects embedded in __NEXT_DATA__ / state JSON.
// Each item may list MULTIPLE urls (one per market) so India/UK/Canada can be
// compared. Amazon is intentionally not used (it blocks automated readers).
//
// products.json per item supports either/both:
//   "producturl": "...", "producturl_region": "india"
//   "producturls": [ {"url":"...","region":"uk"}, {"url":"...","region":"canada"} ]
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const today = new Date().toISOString().slice(0,10);
const products = JSON.parse(readFileSync("products.json","utf8"));
const out = existsSync("prices.json") ? JSON.parse(readFileSync("prices.json","utf8")) : {items:{}};
out.items ||= {}; out.images ||= {};
const FX = { INR:1, GBP:108, CAD:62, USD:85 };

const HEADERS = {
  "user-agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language":"en-US,en;q=0.9",
};

async function getFX(){ try{ const r=await fetch("https://open.er-api.com/v6/latest/INR"); const j=await r.json();
  if(j&&j.rates){ if(j.rates.GBP)FX.GBP=1/j.rates.GBP; if(j.rates.CAD)FX.CAD=1/j.rates.CAD; if(j.rates.USD)FX.USD=1/j.rates.USD; } }catch{} }
const toINR=(p,c)=>Math.round(p*(FX[(c||"INR").toUpperCase()]||1));
async function getText(u){ for(let i=0;i<2;i++){ try{ const r=await fetch(u,{headers:HEADERS,redirect:"follow"}); if(r.ok) return await r.text(); }catch{} await new Promise(r=>setTimeout(r,400)); } return ""; }

function fromShopify(txt){ try{ const j=JSON.parse(txt); const v=j.product&&j.product.variants&&j.product.variants[0];
  if(v&&v.price) return {price:parseFloat(v.price), currency:v.price_currency||"INR"}; }catch{} return null; }
function fromJsonLd(html){ const blocks=[...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for(const b of blocks){ try{ const d=JSON.parse(b[1].trim()); const arr=Array.isArray(d)?d:(d["@graph"]||[d]);
    for(const node of arr){ let off=node.offers; if(Array.isArray(off))off=off[0];
      if(off&&off.price) return {price:parseFloat(off.price), currency:off.priceCurrency||"INR"}; } }catch{} } return null; }
function fromMeta(html){ const p=html.match(/<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([\d.,]+)["']/i);
  const c=html.match(/<meta[^>]+(?:property|name)=["'](?:product:price:currency|og:price:currency|priceCurrency)["'][^>]+content=["']([A-Za-z]{3})["']/i);
  if(p) return {price:parseFloat(p[1].replace(/,/g,"")), currency:c?c[1].toUpperCase():"INR"}; return null; }
// many modern sites (Next.js etc.) embed a schema-like {price, priceCurrency} object in a JSON blob
function deepFindOffer(o,depth){ if(depth>8||!o||typeof o!=="object")return null;
  if(o.price!=null&&(o.priceCurrency||o.currency)){ const pr=parseFloat(o.price); if(pr>0) return {price:pr,currency:String(o.priceCurrency||o.currency||"INR").toUpperCase()}; }
  for(const k in o){ const v=o[k]; if(v&&typeof v==="object"){ const r=deepFindOffer(v,depth+1); if(r) return r; } } return null; }
function fromEmbeddedJson(html){ const blocks=[];
  const nd=html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i); if(nd) blocks.push(nd[1]);
  for(const mm of html.matchAll(/window\.__(?:INITIAL_STATE|PRELOADED_STATE|APOLLO_STATE|NUXT)__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/gi)) blocks.push(mm[1]);
  for(const b of blocks){ try{ const r=deepFindOffer(JSON.parse(b),0); if(r) return r; }catch{} } return null; }
function fromOgImage(html){ const m=html.match(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
  || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
  return (m && /^https?:\/\//i.test(m[1])) ? m[1] : null; }

function urlsFor(p){ const list=[];
  if(p.producturl) list.push({url:p.producturl, region:p.producturl_region||"india"});
  (p.producturls||[]).forEach(u=>{ if(u&&u.url) list.push({url:u.url, region:u.region||"india"}); });
  return list; }

const targets = products.filter(p=>(p.producturl||(p.producturls&&p.producturls.length)) && (p.status==="Buy"||p.status==="Confirm"));
console.log(`Reading ${targets.length} items…`);
await getFX();
let n=0;
for(const p of targets){
  out.items[p.id] ||= [];
  for(const {url,region} of urlsFor(p)){
    let res=null, html="";
    if(/\/products\//.test(url)){ const j=await getText(url.split("?")[0].replace(/\/$/,"")+".json"); if(j) res=fromShopify(j); }
    if(!res || !out.images[p.id]){ html=await getText(url); }
    if(!res && html){ res=fromJsonLd(html)||fromMeta(html)||fromEmbeddedJson(html); }
    if(html && !out.images[p.id]){ const og=fromOgImage(html); if(og){ out.images[p.id]=og; console.log(`img  ${p.id} ${p.item}: ${og}`); } }
    if(res && res.price>0){
      const inr=toINR(res.price,res.currency);
      out.items[p.id]=out.items[p.id].filter(x=>!(x.date===today&&x.region===region));  // one record per region per day
      out.items[p.id].push({date:today,inr,region,local:res.price,currency:res.currency});
      n++; console.log(`ok   ${p.id} ${region} ${p.item}: ${res.currency} ${res.price} -> ₹${inr}`);
    } else console.log(`skip ${p.id} ${region} ${p.item} (no readable price)`);
    await new Promise(r=>setTimeout(r,350));
  }
  if(out.items[p.id].length>240) out.items[p.id]=out.items[p.id].slice(-240);
  if(!out.items[p.id].length) delete out.items[p.id];
}
out.updated=new Date().toISOString().slice(0,16).replace("T"," ");
writeFileSync("prices.json", JSON.stringify(out));
console.log(`done — ${n} price points`);
