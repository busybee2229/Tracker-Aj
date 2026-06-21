// Free, accurate price reader. Reads EXACT prices from product pages that expose
// machine-readable data: Shopify (product URL + ".json"), JSON-LD Product offers,
// or product:price meta tags. Only items in products.json with a "producturl" are
// priced (those are brand-accurate matches). Amazon is intentionally not used.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const today = new Date().toISOString().slice(0,10);
const products = JSON.parse(readFileSync("products.json","utf8"));
const out = existsSync("prices.json") ? JSON.parse(readFileSync("prices.json","utf8")) : {items:{}};
out.items ||= {}; out.images ||= {};
const FX = { INR:1, GBP:108, CAD:62, USD:85 };

async function getFX(){ try{ const r=await fetch("https://open.er-api.com/v6/latest/INR"); const j=await r.json();
  if(j&&j.rates){ if(j.rates.GBP)FX.GBP=1/j.rates.GBP; if(j.rates.CAD)FX.CAD=1/j.rates.CAD; if(j.rates.USD)FX.USD=1/j.rates.USD; } }catch{} }
const toINR=(p,c)=>Math.round(p*(FX[(c||"INR").toUpperCase()]||1));
async function getText(u){ try{ const r=await fetch(u,{headers:{"user-agent":"Mozilla/5.0 (compatible; BabyTrackerBot/1.0)"},redirect:"follow"}); if(!r.ok)return""; return await r.text(); }catch{ return ""; } }

function fromShopify(txt){ try{ const j=JSON.parse(txt); const v=j.product&&j.product.variants&&j.product.variants[0];
  if(v&&v.price) return {price:parseFloat(v.price), currency:v.price_currency||"INR"}; }catch{} return null; }
function fromJsonLd(html){ const blocks=[...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
  for(const b of blocks){ try{ const d=JSON.parse(b[1].trim()); const arr=Array.isArray(d)?d:(d["@graph"]||[d]);
    for(const node of arr){ let off=node.offers; if(Array.isArray(off))off=off[0];
      if(off&&off.price) return {price:parseFloat(off.price), currency:off.priceCurrency||"INR"}; } }catch{} } return null; }
function fromMeta(html){ const p=html.match(/<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([\d.,]+)["']/i);
  const c=html.match(/<meta[^>]+(?:property|name)=["'](?:product:price:currency|og:price:currency|priceCurrency)["'][^>]+content=["']([A-Za-z]{3})["']/i);
  if(p) return {price:parseFloat(p[1].replace(/,/g,"")), currency:c?c[1].toUpperCase():"INR"}; return null; }
function fromOgImage(html){ const m=html.match(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
  || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
  return (m && /^https?:\/\//i.test(m[1])) ? m[1] : null; }

const targets = products.filter(p=>p.producturl && (p.status==="Buy"||p.status==="Confirm"));
console.log(`Reading ${targets.length} product pages…`);
await getFX();
let n=0;
for(const p of targets){
  const url=p.producturl, region=p.producturl_region||"india";
  let res=null, html="";
  if(/\/products\//.test(url)){ const j=await getText(url.split("?")[0].replace(/\/$/,"")+".json"); if(j) res=fromShopify(j); }
  // fetch the page if we still need a price, or to capture an og:image we don't have yet
  if(!res || !out.images[p.id]){ html=await getText(url); }
  if(!res && html){ res=fromJsonLd(html)||fromMeta(html); }
  if(html && !out.images[p.id]){ const og=fromOgImage(html); if(og){ out.images[p.id]=og; console.log(`img  ${p.id} ${p.item}: ${og}`); } }
  if(res && res.price>0){
    const inr=toINR(res.price,res.currency);
    (out.items[p.id] ||= []).push({date:today,inr,region,local:res.price,currency:res.currency});
    if(out.items[p.id].length>120) out.items[p.id]=out.items[p.id].slice(-120);
    n++; console.log(`ok   ${p.id} ${p.item}: ${res.currency} ${res.price} -> ₹${inr}`);
  } else console.log(`skip ${p.id} ${p.item} (no readable price)`);
  await new Promise(r=>setTimeout(r,350));
}
out.updated=new Date().toISOString().slice(0,16).replace("T"," ");
writeFileSync("prices.json", JSON.stringify(out));
console.log(`done — ${n} priced`);
