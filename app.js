"use strict";
/* Baby Deal Tracker — app logic (data lives in products.json; this is the only app file). */
const CONFIG = { FX:{GBP:108,CAD:62,USD:85,INR:1}, DEAL_THRESHOLD:0.05, AVG_WINDOW_DAYS:30,
  REPO:"https://github.com/busybee2229/Tracker-Aj" };
const SUPA = { url:"https://nrpjtychwmuecmskehyj.supabase.co",
  key:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ycGp0eWNod211ZWNtc2tlaHlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNDMyMDUsImV4cCI6MjA5NzYxOTIwNX0.g-WGgUyrHLwql4ZqcNjVvCuT1TzcNIo1z6NNIdVNE9s",
  saveFn:"https://nrpjtychwmuecmskehyj.supabase.co/functions/v1/save-state",
  h:e=>Object.assign({apikey:SUPA.key,Authorization:"Bearer "+SUPA.key},e||{}) };

const FLAG={india:"🇮🇳",uk:"🇬🇧",canada:"🇨🇦"};
const REGION={india:"India",uk:"UK",canada:"Canada"};       // proper display names (3.5)
// only allow http/https URLs to become href/src — blocks javascript:/data: XSS (1.4)
const safeUrl=u=>{ if(!u)return ""; try{ const x=new URL(u,location.href); return (x.protocol==="http:"||x.protocol==="https:")?x.href:""; }catch(e){ return ""; } };
// convert a local price to ₹ using the CURRENT FX rate (3.4 — don't trust baked-in ₹)
const toINR=(p,c)=>Math.round((+p||0)*(CONFIG.FX[String(c||"INR").toUpperCase()]||1));
const CATS=["CLOTHING","HYGIENE & HEALTH","BASICS & GEAR","EXTRAS"];
const CATICON={"CLOTHING":"👕","HYGIENE & HEALTH":"🧴","BASICS & GEAR":"🍼","EXTRAS":"🧸"};
const URGENCIES=["Day 1","Day 1*","First weeks","Later"];
const bcls={"Day 1":"day1","Day 1*":"day1","First weeks":"weeks","Later":"later","Optional":"opt","Owned":"owned","-":"opt"};

let PRODUCTS=[], PRICES={}, IMAGES={}, UPDATED="", PROSCONS={}, OPTDATA={}, SUGGEST={};
let ADMIN_PW=sessionStorage.getItem("apw")||"";   // verified server-side on each write
const LS=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||d);}catch(e){return JSON.parse(d);}};
const lset=(k,v)=>localStorage.setItem(k,JSON.stringify(v));   // device-local only — never synced (2.2)
let TRACK=LS("track","{}"),HIDDEN=LS("hidden","{}"),USER=LS("useritems","[]"),OPEN=LS("accopen","null"),
    PINS=LS("pins","{}"),SEEN=LS("seenDeals","{}"),SEENUP=localStorage.getItem("seenUpdated")||"",
    STATUSOVR=LS("statusovr","{}"),USEROPTS=LS("useropts","{}"),USERQTY=LS("userqty","{}"),
    USERPRICES=LS("userprices","{}"),USERTARGET=LS("usertarget","{}"),USERBOUGHT=LS("userbought","{}"),
    HIDDENOPTS=LS("hiddenopts","{}"),OPTOVERRIDE=LS("optoverride","{}");
if(OPEN===null){OPEN={};CATS.forEach(c=>OPEN[c]=true);}
let OPENTB=LS("tbopen","null"); if(OPENTB===null){OPENTB={};CATS.forEach(c=>OPENTB[c]=true);}   // To-Buy category groups, collapsed-state per device
normPins();

const isTracked=id=>TRACK[id]!==false;
const inr=n=>"₹"+(+n||0).toLocaleString("en-IN");
const effStatus=p=>STATUSOVR[p.id]||p.status;
// base catalogue options (with per-user hide + edit overrides applied, tagged _orig) then user-added options
const rid=()=>"o"+((crypto.randomUUID&&crypto.randomUUID())||(Date.now()+""+Math.random()));
// base catalogue options (hide + override applied, tagged _orig) then user options; every option carries a STABLE _key for pins
const effOptions=p=>{ const ov=OPTOVERRIDE[p.id]||{}, hid=HIDDENOPTS[p.id]||[], od=OPTDATA[p.id]||{};
  const merge=(m,name)=>{ const d=od[name]; if(d&&!m.img&&d.img)m.img=d.img; return m; };
  const base=(p.options||[]).filter(o=>!hid.includes(o.name)).map(o=>{ const m=ov[o.name]?Object.assign({},o,ov[o.name]):Object.assign({},o); m._orig=o.name; m._key="b:"+o.name; return merge(m,o.name); });
  const user=(USEROPTS[p.id]||[]).map(o=>{ const m=Object.assign({},o); m._key="u:"+(o.oid||o.name); return merge(m,o.name); });
  return base.concat(user); };
const defaultQty=p=>{const m=String(p.qty||"").match(/\d+/g);return m?+m[m.length-1]:1;};  // upper bound of "5-7" → 7
const effQty=p=>USERQTY[p.id]!=null?USERQTY[p.id]:defaultQty(p);   // = quantity NEEDED
const neededQty=p=>effQty(p);
const boughtQty=p=>+USERBOUGHT[p.id]||0;
const isDone=p=>effStatus(p)==="Owned"||(neededQty(p)>0&&boughtQty(p)>=neededQty(p));
// pack size: units one pick provides. Parsed from the product name as a DEFAULT
// (e.g. "5 Pack", "3-pk", "pack of 6", "2 pairs"); an explicit option.units overrides it.
function parseUnits(name){ const s=String(name||"");
  const m=s.match(/pack\s*of\s*(\d+)/i)||s.match(/(\d+)\s*-?\s*(?:pk|packs?|pairs?|pcs?|pieces?|count|ct)\b/i)||s.match(/(\d+)\s*x\b/i);
  const n=m?parseInt(m[1],10):1; return n>0?n:1; }
const optUnits=o=>{ const u=o&&o.units; return (u!=null&&u!=="")?Math.max(1,parseInt(u,10)||1):parseUnits(o&&o.name); };
// total units across an item's finalised picks (planning view; completeness is driven by bought)
function chosenUnits(p){ const opts=effOptions(p); return pinsOf(p.id).reduce((s,k)=>{ const o=opts.find(x=>x._key===k); return s+(o?optUnits(o):0); },0); }
const isToBuy=p=>!HIDDEN[p.id]&&(effStatus(p)==="Buy"||effStatus(p)==="Confirm")&&!isDone(p);
const bestRegion=p=>p.bestRegion||"india";
const pinsOf=id=>Array.isArray(PINS[id])?PINS[id]:(PINS[id]!=null?[PINS[id]]:[]);
const isPinned=(id,key)=>pinsOf(id).includes(key);
const hasPin=id=>pinsOf(id).length>0;
function normPins(){ for(const k in PINS){ const v=PINS[k]; if(!Array.isArray(v)) PINS[k]=(v==null?[]:[v]); if(!PINS[k].length) delete PINS[k]; } }
// one-time: give user options stable ids, and convert any legacy numeric (index-based) pins to stable keys
function migrateToKeys(){ let ch=false;
  for(const id in USEROPTS){ (USEROPTS[id]||[]).forEach(o=>{ if(o&&!o.oid){ o.oid=rid(); ch=true; } }); }
  for(const id in PINS){ const arr=pinsOf(id); if(arr.some(x=>typeof x==="number")){ const p=itemById(id);
    if(p){ const opts=effOptions(p); PINS[id]=arr.map(x=> typeof x==="number"?(opts[x]&&opts[x]._key):x).filter(Boolean); }
    else PINS[id]=arr.filter(x=>typeof x!=="number"); ch=true; } }
  if(ch){ localStorage.setItem("useropts",JSON.stringify(USEROPTS)); localStorage.setItem("pins",JSON.stringify(PINS)); }
  return ch; }
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const allItems=()=>PRODUCTS.filter(p=>!HIDDEN[p.id]).concat(USER.filter(p=>!HIDDEN[p.id]));
const itemById=id=>allItems().find(p=>String(p.id)===String(id));
const state={q:"",stat:"",deal:false,tracked:false,bq:""};
// shared text match for an item (used by Dashboard filter + To-Buy search)
function itemMatches(p,q){ if(!q)return true; const s=(p.item+" "+effOptions(p).map(o=>o.name+" "+(o.why||"")).join(" ")+" "+p.category+" "+(p.owned||"")+" "+(p.kw||"")).toLowerCase(); return s.includes(String(q).toLowerCase()); }
let NOTIFS=[], sparks=[], _lastTs=+(localStorage.getItem("lastTs")||0), _pushPending=false;

/* ---------- persistence + sync ---------- */
let _pt=null;
function localState(){ return {track:TRACK,hidden:HIDDEN,useritems:USER,pins:PINS,statusovr:STATUSOVR,useropts:USEROPTS,userqty:USERQTY,userprices:USERPRICES,usertarget:USERTARGET,userbought:USERBOUGHT,hiddenopts:HIDDENOPTS,optoverride:OPTOVERRIDE}; }
function mO(a,b){ return Object.assign({},a||{},b||{}); }
function mItems(a,b){ const m={}; [...(a||[]),...(b||[])].forEach(x=>{ if(x&&x.id!=null)m[x.id]=x; }); return Object.values(m); }
function mOpts(a,b){ const out={}; new Set([...Object.keys(a||{}),...Object.keys(b||{})]).forEach(k=>{ const seen=new Set(),arr=[]; [...((a||{})[k]||[]),...((b||{})[k]||[])].forEach(o=>{ const sig=(o.name||"")+"|"+(o.uk||"")+(o.india||"")+(o.canada||""); if(!seen.has(sig)){seen.add(sig);arr.push(o);} }); if(arr.length)out[k]=arr; }); return out; }
function mPins(a,b){ const out={}; const ar=v=>Array.isArray(v)?v:(v!=null?[v]:[]); new Set([...Object.keys(a||{}),...Object.keys(b||{})]).forEach(k=>{ const s=[...new Set([...ar((a||{})[k]),...ar((b||{})[k])])]; if(s.length)out[k]=s; }); return out; }
// merge per-id arrays of price records, dedup by date+region+inr (for userprices)
function mArr(a,b){ const out={}; new Set([...Object.keys(a||{}),...Object.keys(b||{})]).forEach(k=>{ const seen=new Set(),arr=[]; [...((a||{})[k]||[]),...((b||{})[k]||[])].forEach(o=>{ const sig=(o.date||"")+"|"+(o.region||"")+"|"+(o.inr||""); if(!seen.has(sig)){seen.add(sig);arr.push(o);} }); if(arr.length)out[k]=arr; }); return out; }
// merge ALL synced keys (local wins on scalar maps) — used to reconcile a stale-write 409 without dropping the local edit
function mergeState(r,l){ r=r||{}; l=l||{}; return {track:mO(r.track,l.track),hidden:mO(r.hidden,l.hidden),statusovr:mO(r.statusovr,l.statusovr),userqty:mO(r.userqty,l.userqty),usertarget:mO(r.usertarget,l.usertarget),userbought:mO(r.userbought,l.userbought),useritems:mItems(r.useritems,l.useritems),useropts:mOpts(r.useropts,l.useropts),userprices:mArr(r.userprices,l.userprices),pins:mPins(r.pins,l.pins),hiddenopts:mO(r.hiddenopts,l.hiddenopts),optoverride:mO(r.optoverride,l.optoverride)}; }
async function getRemote(){ try{ const r=await fetch(SUPA.url+"/rest/v1/tracker_state?id=eq.shared&select=data",{headers:SUPA.h(),cache:"no-store"}); if(!r.ok)return {}; const j=await r.json(); return (j&&j[0]&&j[0].data)||{}; }catch(e){ return {}; } }
let _recovering=false;
async function recoverAdminPw(){ if(_recovering||ADMIN_PW)return; _recovering=true;
  const pw=prompt("Your admin session needs the password again to save changes:");
  _recovering=false; if(pw==null)return;
  if(await sha(pw)===ADMIN_HASH){ ADMIN_PW=pw; sessionStorage.setItem("apw",pw); pushState(); }
  else alert("Wrong password — your change wasn't saved."); }
function pushState(){ if(!SUPA.url)return;
  if(!ADMIN_PW){ if(isAdmin) recoverAdminPw(); return; } // friends never write; a stale admin session re-prompts instead of failing silently
  _pushPending=true; clearTimeout(_pt); _pt=setTimeout(async()=>{
  const data=localState(); data.ts=Date.now(); bumpTs(data.ts);
  try{ const r=await fetch(SUPA.saveFn,{method:"POST",headers:SUPA.h({"Content-Type":"application/json"}),body:JSON.stringify({password:ADMIN_PW,data})});
    if(r.status===409){ console.warn("[sync] stale write — merging with remote instead of discarding");
      const remote=await getRemote(); const merged=mergeState(remote,data); applyShared(merged); merged.ts=Date.now(); bumpTs(merged.ts);
      try{ const r2=await fetch(SUPA.saveFn,{method:"POST",headers:SUPA.h({"Content-Type":"application/json"}),body:JSON.stringify({password:ADMIN_PW,data:merged})});
        if(!r2.ok){ console.warn("[sync] merge re-write failed",r2.status); syncToast("Sync conflict — your changes are saved on this device; reopen to retry."); } }
      catch(e){ console.warn("[sync] merge re-write error",e); }
      try{ refreshAll(); }catch(e){} _pushPending=false; return; }
    if(r.status===401){ syncToast("Save failed — admin session expired. Log in again."); console.warn("[sync] write unauthorized"); }
    else if(!r.ok){ syncToast("Couldn't save changes — will retry on next edit."); console.warn("[sync] write failed",r.status); }
  }catch(e){ syncToast("Offline — changes saved locally, not synced yet."); console.warn("[sync] write error",e); }
  _pushPending=false;
},700); }
let _toastT=null;
function syncToast(msg){ let el=document.getElementById("syncToast");
  if(!el){ el=document.createElement("div"); el.id="syncToast"; el.setAttribute("role","status");
    el.style.cssText="position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:var(--ink);color:var(--bg);font-size:13px;font-weight:560;padding:10px 16px;border-radius:980px;box-shadow:var(--sh-2);z-index:80;max-width:90vw;text-align:center";
    document.body.appendChild(el); }
  el.textContent=msg; el.style.display="block"; clearTimeout(_toastT); _toastT=setTimeout(()=>el.style.display="none",4000); }
function applyShared(d){ if(!d||typeof d!=="object")return;
  TRACK=d.track||{};HIDDEN=d.hidden||{};USER=d.useritems||[];PINS=d.pins||{};STATUSOVR=d.statusovr||{};USEROPTS=d.useropts||{};USERQTY=d.userqty||{};USERPRICES=d.userprices||{};USERTARGET=d.usertarget||{};USERBOUGHT=d.userbought||{};HIDDENOPTS=d.hiddenopts||{};OPTOVERRIDE=d.optoverride||{};
  localStorage.setItem("hiddenopts",JSON.stringify(HIDDENOPTS));localStorage.setItem("optoverride",JSON.stringify(OPTOVERRIDE));
  localStorage.setItem("track",JSON.stringify(TRACK));localStorage.setItem("hidden",JSON.stringify(HIDDEN));localStorage.setItem("useritems",JSON.stringify(USER));localStorage.setItem("pins",JSON.stringify(PINS));localStorage.setItem("statusovr",JSON.stringify(STATUSOVR));localStorage.setItem("useropts",JSON.stringify(USEROPTS));localStorage.setItem("userqty",JSON.stringify(USERQTY));localStorage.setItem("userprices",JSON.stringify(USERPRICES));localStorage.setItem("usertarget",JSON.stringify(USERTARGET));localStorage.setItem("userbought",JSON.stringify(USERBOUGHT));
  normPins(); migrateToKeys(); }
function hasData(r){ return r && (Object.keys(r.pins||{}).length||(r.useritems||[]).length||Object.keys(r.useropts||{}).length||Object.keys(r.track||{}).length||Object.keys(r.statusovr||{}).length||Object.keys(r.userqty||{}).length||Object.keys(r.hidden||{}).length||Object.keys(r.userprices||{}).length||Object.keys(r.usertarget||{}).length||Object.keys(r.userbought||{}).length||Object.keys(r.hiddenopts||{}).length||Object.keys(r.optoverride||{}).length); }
function bumpTs(t){ _lastTs=t; localStorage.setItem("lastTs",_lastTs); }
async function syncPull(){ if(!SUPA.url)return; const r=await getRemote(); const rt=r.ts||0;
  if(rt>_lastTs && hasData(r)){ applyShared(r); bumpTs(rt); }
  else if(_lastTs>rt && hasData(localState())){ pushState(); } }
// don't yank the UI out from under an active interaction (2.1)
function uiBusy(){ if(document.querySelector(".overlay.show"))return true; const a=document.activeElement; return !!(a&&(a.tagName==="INPUT"||a.tagName==="SELECT"||a.tagName==="TEXTAREA")); }
async function pullAndRender(){ if(!SUPA.url||_pushPending||uiBusy())return; const r=await getRemote(); const rt=r.ts||0; if(rt<=_lastTs)return; applyShared(r); bumpTs(rt); try{ stats(); renderDash(); renderPending(); buildNotifs(); }catch(e){ console.warn("[sync] render after pull failed",e); } }
const save=(k,v)=>{ localStorage.setItem(k,JSON.stringify(v)); pushState(); };

/* ---------- prices ---------- */
async function getFX(){ try{ const r=await fetch("https://open.er-api.com/v6/latest/INR"); const j=await r.json();
  if(j&&j.rates){ if(j.rates.GBP)CONFIG.FX.GBP=+(1/j.rates.GBP).toFixed(1); if(j.rates.CAD)CONFIG.FX.CAD=+(1/j.rates.CAD).toFixed(1); CONFIG._fx=1; } }catch(e){} }
async function loadPrices(){ const b=document.getElementById("livebanner");
  try{ const r=await fetch("./prices.json",{cache:"no-store"}); if(r.ok){ const j=await r.json(); const it=j.items||{}; IMAGES=j.images||{}; UPDATED=j.updated||"";
    for(const id in it){ PRICES[id]=it[id].map(x=>({date:new Date(x.date).getTime(),ds:x.date,inr:+x.inr,region:x.region||"",local:x.local,currency:x.currency})).filter(x=>!isNaN(x.date)&&x.inr); }
    Object.values(PRICES).forEach(a=>a.sort((x,y)=>x.date-y.date));
    if(Object.keys(PRICES).length){ b.style.display="none"; if(UPDATED)(document.getElementById("updated")||{}).textContent="updated "+UPDATED; return; } }
  }catch(e){}
  b.textContent="📊 Live prices fill in as the GitHub Action reads each product page. Photos, plan, options and links work now.";
}
async function loadProsCons(){ try{ const r=await fetch("./proscons.json",{cache:"no-store"}); if(r.ok)PROSCONS=await r.json(); }catch(e){ console.warn("[proscons] load failed",e); } }
async function loadOptData(){ try{ const r=await fetch("./optdata.json",{cache:"no-store"}); if(r.ok)OPTDATA=await r.json(); }catch(e){ } }
async function loadSuggest(){ try{ const r=await fetch("./suggestions.json",{cache:"no-store"}); if(r.ok)SUGGEST=await r.json(); }catch(e){ } }
const suggList=id=>((SUGGEST[id]||{}).list)||[];
const suggFor=p=>{ const have=new Set(effOptions(p).map(o=>o.name)); return suggList(p.id).filter(s=>!have.has(s.name)); };  // hide suggestions already added as options
const underFilled=p=>pinsOf(p.id).length<neededQty(p);
// total ₹ committed = sum of each finalised pick's price (once each); tracks priced vs unpriced
function committedTotal(){ let total=0,priced=0,count=0; allItems().forEach(p=>{ const opts=effOptions(p); pinsOf(p.id).forEach(key=>{ const o=opts.find(x=>x._key===key); if(o){ count++; const v=optPriceINR(p.id,o); if(v>0){total+=v;priced++;} } }); }); return {total,priced,count,unpriced:count-priced}; }
function itemCommitted(p){ let t=0; const opts=effOptions(p); pinsOf(p.id).forEach(k=>{ const o=opts.find(x=>x._key===k); if(o)t+=optPriceINR(p.id,o); }); return t; }   // ₹ committed on THIS item's finalised picks
// first item with a finalised pick that has no price yet (for the "N need a price" jump)
function firstUnpricedId(){ let found=null; allItems().some(p=>{ const opts=effOptions(p); return pinsOf(p.id).some(k=>{ const o=opts.find(x=>x._key===k); if(o&&optPriceINR(p.id,o)<=0){found=p.id;return true;} return false; }); }); return found; }
// pros/cons for an option: catalogue file first, else the option's own (e.g. added from a suggestion)
const pcOf=(id,o)=>((PROSCONS[id]||{})[o._orig||o.name])||((o.pros||o.cons)?{pros:o.pros||[],cons:o.cons||[]}:{});
// ₹ price for one option: manual option.price (₹) wins, else auto-fetched optdata (local→₹)
function optPriceINR(id,o){ if(o.price!=null&&o.price!==""){ const n=+o.price; if(n>0)return Math.round(n); }
  const od=(OPTDATA[id]||{})[o._orig||o.name]; if(od&&+od.price>0)return toINR(+od.price,od.currency||"INR"); return 0; }
// ₹ for a record: prefer converting the stored LOCAL price at the current FX rate
// (so history/averages aren't polluted by old FX); fall back to legacy stored inr (3.4)
const recInr=x=>(x.local!=null&&x.currency)?toINR(x.local,x.currency):x.inr;
// auto prices (prices.json) + manual prices (admin-entered, synced), merged & sorted
function effPrices(id){ const man=(USERPRICES[id]||[]).map(x=>({date:new Date(x.date).getTime(),ds:x.date,inr:+x.inr,local:x.local!=null?x.local:+x.inr,currency:x.currency||"INR",region:x.region||"manual"})).filter(x=>!isNaN(x.date)&&x.inr);
  return (PRICES[id]||[]).concat(man).sort((a,b)=>a.date-b.date); }
// latest ₹ per market for an item (most recent record wins per region)
function latestByRegion(id){ const o={}; effPrices(id).forEach(x=>{ if(x.region==="india"||x.region==="uk"||x.region==="canada") o[x.region]=recInr(x); }); return o; }
const SIMILAR_PCT=0.07; // within 7% counts as "similar" → prefer India
// which market to buy from: cheapest, but prefer India when it's within ~7% of cheapest
function buyRec(byReg){ const regs=Object.keys(byReg); if(!regs.length)return null;
  const cheapest=regs.reduce((a,b)=>byReg[b]<byReg[a]?b:a);
  if(byReg.india!=null && byReg.india<=byReg[cheapest]*(1+SIMILAR_PCT)) return "india";
  return cheapest; }
function priceInfo(id){ const tgt=+USERTARGET[id]||0; const h=effPrices(id); const byReg=latestByRegion(id);
  const p=itemById(id); const opts=p?effOptions(p):[];
  // candidate "current" prices: latest item-level per region + each option's own price → take the cheapest
  const cands=[]; Object.keys(byReg).forEach(r=>cands.push({inr:byReg[r],region:r}));
  opts.forEach(o=>{ const v=optPriceINR(id,o); if(v>0)cands.push({inr:v,region:""}); });
  if(!cands.length&&!h.length)return null;
  let cur,region="";
  if(cands.length){ const best=cands.reduce((a,b)=>b.inr<a.inr?b:a); cur=best.inr; region=best.region||""; }
  else { const last=h[h.length-1]; cur=recInr(last); region=last.region||""; }
  const cut=Date.now()-CONFIG.AVG_WINDOW_DAYS*864e5; const win=h.filter(x=>x.date>=cut); const arr=win.length?win:h;
  const avg=arr.length?Math.round(arr.reduce((s,x)=>s+recInr(x),0)/arr.length):cur;
  const isDeal = tgt>0 ? cur<=tgt : (arr.length>1 && cur<avg && cur<=avg*(1-CONFIG.DEAL_THRESHOLD));
  const pct = tgt>0 ? Math.max(0,Math.round((1-cur/tgt)*100)) : (avg?Math.round((1-cur/avg)*100):0);
  return {cur,avg,target:tgt||null,region,byReg,isDeal,pct,hasAvg:arr.length>1}; }
// "Best value" = quality that justifies its price (not just cheapest). Quality = pros−cons;
// value = quality ÷ (price relative to your target, or the median price). Only when 2+ options.
const _median=a=>{ a=a.slice().sort((x,y)=>x-y); const m=a.length>>1; return a.length%2?a[m]:(a[m-1]+a[m])/2; };
const _qScore=(id,o)=>{ const d=(PROSCONS[id]||{})[o._orig||o.name]||{}; return 1+((d.pros||[]).length)-((d.cons||[]).length); };
function bestValueKey(id){ const p=itemById(id); if(!p)return null; const opts=effOptions(p); if(opts.length<2)return null;
  const priced=opts.map(o=>({o,price:optPriceINR(id,o)})).filter(x=>x.price>0);
  let best=null, bestScore=-Infinity;
  if(priced.length>=2){ const tgt=+USERTARGET[id]||0, ref=tgt>0?tgt:_median(priced.map(x=>x.price));
    priced.forEach(({o,price})=>{ const s=Math.max(0.25,_qScore(id,o))*ref/price; if(s>bestScore){bestScore=s;best=o;} }); }
  else { opts.forEach(o=>{ const s=_qScore(id,o); if(s>bestScore){bestScore=s;best=o;} }); }
  return best?best._key:null; }

/* ---------- dashboard ---------- */
function imgHtml(p,override){ const ic=CATICON[p.category]||"🍼"; const u=safeUrl(override||p.img||IMAGES[p.id]); return u
  ? `<img src="${esc(u)}" alt="${esc(p.item)}" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(ic)}"/>`
  : `<div class="ph">${ic}</div>`; }
// image of the finalised (pinned) option for an item, if any — else "" (caller falls back to default)
function finalImg(p){ const pins=pinsOf(p.id); if(!pins.length)return ""; const opts=effOptions(p); const i=opts.findIndex(o=>pins.includes(o._key)); if(i<0)return ""; const o=opts[i];
  return o.img||p.img||IMAGES[p.id]||""; }
function qtyChip(p){ const n=effQty(p); return n>1?`<span class="qchip">×${n}</span>`:""; }

/* ---------- shared option helpers (defined once, used by every screen) ---------- */
const LABEL={ finalised:"★ Finalised", bestValue:"★ Best value" };
// option photo first, then the item photo, then the category emoji — same rule on every screen
const optImg=(p,o)=>safeUrl((o&&o.img)||(p&&p.img)||IMAGES[p.id]||"");
const thumbEl=(url,ic)=>url?`<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(ic)}">`:`<div class="ph">${ic}</div>`;
// one option's own ₹ as a small tag (faint "—" when no price known yet)
const optPriceTag=(id,o,cls)=>{ const v=optPriceINR(id,o); const c=cls||"oprice"; return v>0?`<span class="${c}">${inr(v)}</span>`:`<span class="${c} none">—</span>`; };
// a link is a REAL product link only if it isn't a search/listing page (those are useless per-region)
const isRealLink=u=>{ const s=safeUrl(u); if(!s)return false; return !/[?&](k|q|w|query|search)=/i.test(s) && !/\/s\?|\/search\b/i.test(s); };
// region links for one option — show per-region flags ONLY when the SAME product has a real
// product link in 2+ regions; otherwise a single "View" to the best available link. (multi is derived, not a manual flag)
function optLinks(p,o){ const regs=["india","uk","canada"].filter(k=>isRealLink(o[k]));
  if(regs.length>=2){ return regs.map(k=>`<a class="lk" target="_blank" rel="noopener" href="${esc(safeUrl(o[k]))}" aria-label="${REGION[k]}">${FLAG[k]}</a>`).join(""); }
  const one=regs.length?safeUrl(o[regs[0]]):singleLink(o,p);
  return one?`<a class="lk" target="_blank" rel="noopener" href="${esc(one)}">View</a>`:""; }
// pros/cons list, falling back to the one-line why
function pcBlock(data,why){ const pros=((data&&data.pros)||[]).map(x=>`<li class="pro">${esc(x)}</li>`).join(""); const cons=((data&&data.cons)||[]).map(x=>`<li class="con">${esc(x)}</li>`).join("");
  return (pros||cons)?`<ul class="pclist">${pros}${cons}</ul>`:(why?`<div class="cmpwhy">${esc(why)}</div>`:""); }

function cardHtml(p){
  const pi=isTracked(p.id)?priceInfo(p.id):null;
  const isDeal=pi&&pi.isDeal, pinned=hasPin(p.id), pri=p.priority||"-";
  const pc=bcls[pri]||"opt", stc={Buy:"buy",Owned:"owned",Confirm:"confirm"}[effStatus(p)]||"opt";
  const opts=effOptions(p), best=opts[0], br=bestRegion(p), bl=best?(best[br]||best.india||best.uk||best.canada):"";
  // coverage + committed instead of a single (misleading) price — see CLAUDE.md purpose
  const need=neededQty(p), bought=boughtQty(p), comm=itemCommitted(p), hasPk=hasPin(p.id);
  let price="";
  if(!hasPk && !bought && effStatus(p)!=="Owned"){ price=`<div class="pr none">not chosen yet</div>`; }
  else { const bits=[]; if(comm>0)bits.push(`<span class="cur">${inr(comm)}</span> committed`); if(need>1)bits.push(`${bought}/${need} bought`); if(bits.length)price=`<div class="pr">${bits.join(" · ")}</div>`; }
  const have=p.owned?`<div class="have">✓ ${esc(p.owned)}</div>`:"";
  const pk=(best&&best.name&&effStatus(p)!=="Owned")?`<div class="pk">${esc(best.name)}</div>`:"";
  const badges=`<div class="cbadge">`+(isDeal?`<span class="b deal">🔥</span>`:"")+(pinned?`<span class="b pinned">📌</span>`:"")+
    (URGENCIES.includes(pri)?`<span class="b ${pc}">${pri}</span>`:"")+`<span class="b ${stc}">${effStatus(p)}</span></div>`;
  let foot=`<div class="cfoot">`;
  const blSafe=safeUrl(bl);
  if(best&&blSafe&&effStatus(p)!=="Owned") foot+=`<a class="bestbtn" target="_blank" rel="noopener" href="${esc(blSafe)}">★ Buy best</a>`;
  foot+=`<span class="detbtn">Details</span></div>`;
  return `<div class="card ${isDeal?'isdeal':''}" role="button" tabindex="0" aria-label="${esc(p.item)}" data-open="${esc(p.id)}">`+
    `<div class="imgwrap">${imgHtml(p,finalImg(p))}${badges}${qtyChip(p)}<button class="delc" title="Delete ${esc(p.item)}" aria-label="Delete ${esc(p.item)}" data-del="${esc(p.id)}">✕</button></div>`+
    `<div class="cbody"><div class="ttl">${esc(p.item)}</div>${pk}${have}${price}</div>${foot}</div>`;
}
function passFilter(p){
  if(state.q&&!itemMatches(p,state.q))return false;
  if(state.deal&&!(isTracked(p.id)&&priceInfo(p.id)?.isDeal))return false;
  if(state.tracked&&!isTracked(p.id))return false;
  if(state.stat==="day1"&&!(p.priority||"").startsWith("Day 1"))return false;
  if(state.stat==="buy"&&effStatus(p)!=="Buy")return false;
  if(state.stat==="owned"&&effStatus(p)!=="Owned")return false;
  if(state.stat==="pinned"&&!hasPin(p.id))return false;
  if(state.stat==="deal"&&!(isTracked(p.id)&&priceInfo(p.id)?.isDeal))return false;
  return true;
}
function renderDash(){
  const L=document.getElementById("list"); L.innerHTML="";
  const items=allItems(); let shown=0;
  CATS.forEach(cat=>{
    const list=items.filter(p=>p.category===cat&&passFilter(p));
    list.sort((a,b)=>(PINS[b.id]!=null?1:0)-(PINS[a.id]!=null?1:0));
    if(!list.length&&(state.q||state.deal||state.tracked||state.stat))return;
    shown+=list.length;
    const open=OPEN[cat]!==false||!!(state.q||state.stat||state.deal);
    const acc=document.createElement("div"); acc.className="acc"+(open?" open":""); acc.id="cat"+CATS.indexOf(cat);
    acc.innerHTML=`<div class="head" role="button" tabindex="0"><span class="chev">▶</span><h2>${CATICON[cat]} ${cat}</h2><span class="cnt">${list.length}</span><button class="minibtn" data-add="${cat}">＋ Add</button></div><div class="body"><div class="grid"></div></div>`;
    const head=acc.querySelector(".head");
    const toggle=()=>{acc.classList.toggle("open");OPEN[cat]=acc.classList.contains("open");lset("accopen",OPEN);};
    head.addEventListener("click",e=>{ if(e.target.closest("[data-add]"))return; toggle(); });
    head.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle();} });
    acc.querySelector(".grid").innerHTML=list.map(cardHtml).join("")||'<p class="empty">No items.</p>';
    L.appendChild(acc);
  });
  if(!shown)L.innerHTML='<p class="empty">No items match.</p>';
  const jb=document.getElementById("jumpbar"); if(jb)jb.style.display="none";
  document.getElementById("foot").innerHTML=`Showing ${shown} items · FX £1=₹${CONFIG.FX.GBP}, C$1=₹${CONFIG.FX.CAD} ${CONFIG._fx?"(live)":""} · <span class="lk2" id="exportBtn">Export</span> · <span class="lk2" id="importBtn">Import</span> · <a href="${CONFIG.REPO}" target="_blank" rel="noopener">repo</a><input type="file" id="impFile" accept="application/json" style="display:none"/>`;
  document.getElementById("exportBtn").onclick=exportEdits;
  document.getElementById("importBtn").onclick=()=>document.getElementById("impFile").click();
  document.getElementById("impFile").onchange=importEdits;
}

/* ---------- To-Buy checklist (default admin view) ---------- */
function recOption(p){ const opts=effOptions(p); if(!opts.length)return null; const pins=pinsOf(p.id); let i=opts.findIndex(o=>pins.includes(o._key)); if(i<0)i=0; return {o:opts[i],i}; }
function bestLinkFor(p){ const r=recOption(p); if(!r)return ""; const o=r.o, br=bestRegion(p); return safeUrl(o[br]||o.india||o.uk||o.canada||""); }
function renderToBuy(){
  const q=state.bq||"";
  const items=allItems().filter(p=>!HIDDEN[p.id]);
  const buyAll=items.filter(isToBuy);
  const buy=buyAll.filter(p=>itemMatches(p,q));
  const done=items.filter(p=>(effStatus(p)==="Buy"||effStatus(p)==="Confirm"||effStatus(p)==="Owned")&&isDone(p));
  const urg=p=>{const i=URGENCIES.indexOf(p.priority);return i<0?9:i;};
  const total=buyAll.length+done.length, pctDone=total?Math.round(done.length/total*100):0;
  const ct=committedTotal(); const ctLine=ct.total?` · ${inr(ct.total)} committed${ct.unpriced?` · <span class="needprice" data-needprice="1" role="button" tabindex="0" title="Open the first item missing a price">${ct.unpriced} need a price</span>`:''}`:"";
  document.getElementById("buyHeader").innerHTML=`<div class="buyhead"><div><h2 class="buyh2">Still to buy</h2><div class="buysub">${buyAll.length} item${buyAll.length!==1?'s':''} left · ${done.length} handled${ctLine}</div></div><div class="prog"><div class="progbar"><span style="width:${pctDone}%"></span></div><div class="progn">${pctDone}%</div></div></div>`;
  const L=document.getElementById("buyList");
  const card=(p,opts,i,ic)=>{ const o=opts[i]; const pc=pcOf(p.id,o);
    const ct=thumbEl(optImg(p,o),ic);
    const sub=(pc.pros&&pc.pros[0])?esc(pc.pros[0]):(o.why?esc(o.why):"");
    const isPick=isPinned(p.id,o._key), l=singleLink(o,p);
    const inner=`<div class="bicardimg">${ct}${isPick?`<span class="pickbadge">${LABEL.finalised}</span>`:''}${l?'<span class="extlink" aria-hidden="true">↗</span>':''}</div><div class="bicardname">${esc(o.name)}</div>${optPriceTag(p.id,o,'bprice')}${sub?`<div class="bicardwhy">${sub}</div>`:""}`;
    return l?`<a class="bicard ${isPick?'best':''}" href="${esc(l)}" target="_blank" rel="noopener" aria-label="${esc(o.name)} — view product">${inner}</a>`
            :`<div class="bicard ${isPick?'best':''}">${inner}</div>`; };
  const buyItemHtml=(p)=>{ const pi=priceInfo(p.id), ic=CATICON[p.category]||"🍼", opts=effOptions(p);
    const need=neededQty(p), got=boughtQty(p), pri=p.priority||"", badge=URGENCIES.includes(pri)?`<span class="b ${bcls[pri]||'opt'}">${pri}</span>`:"";
    const qtyTag=need>1?`<span class="bqty">${got}/${need}</span>`:"";
    const finN=pinsOf(p.id).length, comm=finN?itemCommitted(p):0;
    const priceTxt = finN
      ? (comm?`<span class="bprice">${inr(comm)} committed</span>`:`<span class="bprice none">finalised — add prices</span>`)
      : (pi?`<span class="bprice ${pi.isDeal?'deal':''}">from ${pi.region&&FLAG[pi.region]?FLAG[pi.region]+' ':''}${inr(pi.cur)}${pi.isDeal?' 🔥':''}${pi.target?' · target '+inr(pi.target):''}</span>`:`<span class="bprice none">no price yet</span>`);
    const bl=bestLinkFor(p), buyBtn=bl?`<a class="bestbtn" target="_blank" rel="noopener" href="${esc(bl)}">★ Buy best</a>`:"";
    const gotBtn=need>1?`<button class="trk" data-bought="${esc(p.id)}" data-d="1">+1 bought</button>`:`<button class="trk gotit" data-got="${esc(p.id)}">Got it ✓</button>`;
    const cmpBtn=opts.length>1?`<button class="detbtn" data-compare="${esc(p.id)}">⚖ Compare</button>`:"";
    const pk=pinsOf(p.id), pinnedIdx=opts.map((_,i)=>i).filter(i=>pk.includes(opts[i]._key));
    const primaryIdx=pinnedIdx.length?pinnedIdx:opts.map((_,i)=>i).slice(0,3);
    const extraIdx=opts.map((_,i)=>i).filter(i=>!primaryIdx.includes(i));
    const primary=primaryIdx.map(i=>card(p,opts,i,ic)).join("")||'<div class="bicard muted">No options yet — add one in Details.</div>';
    const more=extraIdx.length?`<details class="moreopts"><summary>＋ see ${extraIdx.length} more option${extraIdx.length>1?'s':''}</summary><div class="bicards">${extraIdx.map(i=>card(p,opts,i,ic)).join("")}</div></details>`:"";
    const nSugg=suggFor(p).length; const ideas=nSugg?`<button class="suggchip" data-open="${esc(p.id)}">💡 ${nSugg} ideas</button>`:"";
    return `<section class="buyitem">${badge?`<div class="biurg">${badge}</div>`:""}<div class="bihead"><div class="bihead-l"><span class="bititle">${esc(p.item)}</span> ${qtyTag} ${priceTxt} ${ideas}</div><div class="bihead-r">${buyBtn}${cmpBtn}<button class="detbtn" data-open="${esc(p.id)}">Details</button>${gotBtn}</div></div><div class="bicards">${primary}</div>${more}</section>`;
  };
  if(!buy.length){
    L.innerHTML = q ? `<div class="empty">No matches for “${esc(q)}”.</div>` : '<div class="empty">🎉 Nothing left to buy. Open “All items” to add or reopen something.</div>';
  } else {
    let html="";
    CATS.forEach(cat=>{ const list=buy.filter(p=>p.category===cat).sort((a,b)=>urg(a)-urg(b)||(hasPin(b.id)?1:0)-(hasPin(a.id)?1:0));
      if(!list.length)return;
      const open=OPENTB[cat]!==false||!!q;
      html+=`<div class="acc tb${open?' open':''}" data-tbcat="${esc(cat)}"><div class="head" role="button" tabindex="0"><span class="chev">▶</span><h2>${CATICON[cat]} ${cat}</h2><span class="cnt">${list.length}</span></div><div class="body"><div class="buygroup">${list.map(buyItemHtml).join("")}</div></div></div>`;
    });
    L.innerHTML=html;
    L.querySelectorAll(".acc.tb").forEach(acc=>{ const cat=acc.getAttribute("data-tbcat"); const head=acc.querySelector(".head");
      const toggle=()=>{acc.classList.toggle("open");OPENTB[cat]=acc.classList.contains("open");lset("tbopen",OPENTB);};
      head.addEventListener("click",toggle);
      head.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle();}}); });
  }
  const D=document.getElementById("buyDone");
  if(!done.length){ D.innerHTML=""; }
  else { D.innerHTML=`<div class="donehead" id="doneToggle"><span class="chev">▶</span> Done (${done.length})</div><div class="donebody" id="doneBody">`+done.map(p=>{ const r=recOption(p), nm=r?esc(r.o.name):(p.owned?esc(p.owned):""); return `<div class="donerow"><span class="dn">${esc(p.item)}${nm?` · ${nm}`:''}</span><button class="minibtn" data-got="${esc(p.id)}">Undo</button></div>`; }).join("")+`</div>`;
    const dt=document.getElementById("doneToggle"),db=document.getElementById("doneBody"); if(dt&&db)dt.onclick=()=>{db.classList.toggle("open");dt.classList.toggle("open");}; }
}

/* ---------- item modal ---------- */
function optCard(o,i,p,isUser,userIdx,bestKey){
  const pinned=isPinned(p.id,o._key); const ic=CATICON[p.category]||"🍼";
  const thumb=`<div class="optimg">${thumbEl(optImg(p,o),ic)}</div>`;
  const rank=pinned?`<span class="rank fin">${LABEL.finalised}</span>`:(o._key===bestKey?`<span class="rank">${LABEL.bestValue}</span>`:"");
  const un=optUnits(o);
  return `<div class="opt ${pinned?'pinned':(i===0?'best':'')}">${thumb}<div class="optmain"><div class="otop">${rank}<span class="oname">${esc(o.name)}</span>${optPriceTag(p.id,o)}${un>1?`<span class="ounits" title="pack of ${un}">×${un}</span>`:""}`+
    `<button class="pinbtn ${pinned?'on':''}" data-pin="${esc(p.id)}" data-pinkey="${esc(o._key)}">${pinned?'★ Finalised':'★ Finalise'}</button>`+
    `<button class="trk" title="Mark a pack bought (+${un} bought)" data-bought="${esc(p.id)}" data-d="${un}">🛒 +${un}</button>`+
    (isUser
      ?`<button class="trk" title="Edit option" data-editopt="${esc(p.id)}" data-eidx="${userIdx}">✎</button><button class="trk" style="color:#b15;border-color:#e6c5c5" title="Remove option" data-delopt="${esc(p.id)}" data-optidx="${userIdx}">✕</button>`
      :`<button class="trk" title="Edit option" data-editbase="${esc(p.id)}" data-oname="${esc(o._orig||o.name)}">✎</button><button class="trk" style="color:#b15;border-color:#e6c5c5" title="Remove option" data-delbase="${esc(p.id)}" data-oname="${esc(o._orig||o.name)}">✕</button>`)+`</div>`+
    pcBlock(pcOf(p.id,o),o.why)+`<div class="links">${optLinks(p,o,'view')}</div></div></div>`;
}
function openItem(id){
  const p=itemById(id); if(!p)return; const pi=priceInfo(id); const opts=effOptions(p); const baseLen=opts.filter(o=>o._key&&o._key[0]==="b").length;  // base options first, then user (u:) options
  const bestKey=bestValueKey(id);
  let optsHtml=""; if(opts.length){ let order=opts.map((_,i)=>i); const pk=pinsOf(id); const pinnedIdx=order.filter(i=>pk.includes(opts[i]._key)); if(pinnedIdx.length){ order=[...pinnedIdx, ...order.filter(i=>!pk.includes(opts[i]._key))]; } optsHtml=order.map(i=>optCard(opts[i],i,p,i>=baseLen,i-baseLen,bestKey)).join(""); }
  else if(p.owned){ optsHtml=`<div class="opt best"><div class="otop"><span class="rank">✓ OWNED</span><span class="oname">${esc(p.owned)}</span></div></div>`; }
  let price=""; if(pi){ const flag=pi.region&&FLAG[pi.region]?FLAG[pi.region]+" ":""; const sub=pi.isDeal?('· '+pi.pct+'% below target'):(pi.target?'· target '+inr(pi.target):''); const _spv=effPrices(id).map(recInr), _spark=_spv.length>1&&new Set(_spv).size>1;
    price=`<div style="margin:6px 0"><span class="b ${pi.isDeal?'deal':'owned'}">${flag}${inr(pi.cur)} ${sub}</span></div>${_spark?'<div class="sparkwrap"><canvas id="mspark"></canvas></div>':''}`; }
  const tgtVal=(USERTARGET[id]!=null?USERTARGET[id]:""), lbr=latestByRegion(id), pv=r=>lbr[r]!=null?lbr[r]:"";
  const priceEdit=`<details class="pricedetails"><summary>＋ Prices &amp; target</summary><div class="priceedit"><span class="pelbl">Prices ₹</span>`+
    `<label>🇮🇳<input id="m_price_india" inputmode="decimal" placeholder="—" value="${pv('india')}"></label>`+
    `<label>🇬🇧<input id="m_price_uk" inputmode="decimal" placeholder="—" value="${pv('uk')}"></label>`+
    `<label>🇨🇦<input id="m_price_canada" inputmode="decimal" placeholder="—" value="${pv('canada')}"></label>`+
    `<label title="Flag a deal when the cheapest price drops to/below this">🎯<input id="m_target" inputmode="decimal" placeholder="target" value="${tgtVal}"></label>`+
    `<button class="minibtn" data-saveprice="${esc(id)}">Save</button></div></details>`;
  const qn=effQty(p);
  const stbtns=["Buy","Owned","Confirm"].map(st=>`<button class="trk ${effStatus(p)===st?'on':''}" data-setstatus="${esc(id)}" data-st="${st}">${st==="Buy"?"To buy":st}</button>`).join("");
  const edititem=String(id).startsWith("u")?`<button class="trk" data-edititem="${esc(id)}">✎ Edit</button>`:"";
  const m=document.getElementById("itemModal");
  m.innerHTML=`<button class="mclose" data-close="itemOverlay" aria-label="Close">×</button>`+
    `<div class="mhead"><div class="mimg">${imgHtml(p)}</div><div style="flex:1"><h3 id="mtitle">${esc(p.item)}</h3>${p.kw?`<div class="msub">${esc(p.kw)}</div>`:""}`+
    `<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:6px">`+
      (URGENCIES.includes(p.priority)?`<span class="b ${bcls[p.priority]||'opt'}">${p.priority}</span>`:"")+
      `<button class="trk ${isTracked(id)?'on':''}" data-track="${esc(id)}">${isTracked(id)?'Tracking ✓':'Track'}</button>${stbtns}${edititem}${effOptions(p).length>1?`<button class="trk" data-compare="${esc(id)}">⚖ Compare</button>`:""}</div>`+
    `<div class="qtyrow">Need <input class="qnum" id="m_need" inputmode="numeric" value="${neededQty(p)}" data-need="${esc(id)}" aria-label="Quantity needed"> · Bought <button class="qbtn" data-bought="${esc(id)}" data-d="-1" aria-label="Decrease bought">−</button><b id="bval">${boughtQty(p)}</b><button class="qbtn" data-bought="${esc(id)}" data-d="1" aria-label="Increase bought">+</button> <button class="trk gotit ${isDone(p)?'on':''}" data-got="${esc(id)}">${isDone(p)?'✓ Got it':'Got it'}</button></div>`+
    (p.best&&p.best!=="-"?`<div style="font-size:12.5px;color:var(--muted);margin-top:4px">Best market: <b style="color:var(--ink)">${esc(p.best)}</b></div>`:"")+price+`</div></div>`+
    `<div class="mbody">${priceEdit}${optsHtml}<button class="addopt" data-addopt="${esc(id)}">＋ Add another option/link</button>`+suggHtml(id,p)+((HIDDENOPTS[id]||[]).length?`<div class="hiddenopts"><span>Removed:</span> ${(HIDDENOPTS[id]||[]).map(n=>`<button class="restorechip" data-restoreopt="${esc(id)}" data-oname="${esc(n)}">↩ ${esc(n)}</button>`).join("")}</div>`:"")+(p.notes&&p.notes.trim()?`<div class="notes">${esc(p.notes)}</div>`:"")+`</div>`;
  m.setAttribute("aria-labelledby","mtitle");
  document.getElementById("itemOverlay").classList.add("show"); focusModal("itemOverlay");
  if(pi){ const h=effPrices(id).slice(-20); const el=document.getElementById("mspark");
    if(el) ensureChart().then(Chart=>{ if(Chart&&document.body.contains(el)) new Chart(el,{type:"line",data:{labels:h.map(_=>""),datasets:[{data:h.map(recInr),borderColor:"#6b8caf",borderWidth:2,pointRadius:0,tension:.3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}},animation:false}}); }).catch(()=>{}); }
}
let _chartP=null;
function ensureChart(){ if(window.Chart)return Promise.resolve(window.Chart); if(_chartP)return _chartP;
  _chartP=new Promise((res,rej)=>{ const s=document.createElement("script");
    s.src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
    s.integrity="sha384-9nhczxUqK87bcKHh20fSQcTGD4qq5GhayNYSYWqwBkINBhOfQLg/P5HG5lF1urn4"; s.crossOrigin="anonymous";
    s.onload=()=>res(window.Chart); s.onerror=()=>{ _chartP=null; rej(new Error("chart load failed")); }; document.head.appendChild(s); });
  return _chartP; }

/* ---------- compare modal (separate from item detail) ---------- */
const singleLink=(o,p)=>{ const br=bestRegion(p); return safeUrl(o[br]||o.india||o.uk||o.canada||""); };
function openCompare(id){ const p=itemById(id); if(!p)return; const opts=effOptions(p); const pc=PROSCONS[p.id]||{}; const pins=pinsOf(id);
  const allP=opts.map(o=>optPriceINR(id,o)).filter(v=>v>0); const minP=allP.length?Math.min(...allP):0; const bestKey=bestValueKey(id);
  const cards=opts.map((o,i)=>{ const data=pcOf(id,o); const prc=optPriceINR(id,o);
    const thumb=thumbEl(optImg(p,o),CATICON[p.category]||'🍼');
    const body=pcBlock(data,o.why)||`<div class="cmpwhy muted">No pros/cons yet — ask to generate.</div>`;
    const u=optLinks(p,o,'view');
    const prcEl=prc?`<div class="cmpprc">${inr(prc)}${prc===minP&&minP>0&&allP.length>1?' <span class="cheap">cheapest</span>':''}</div>`:`<div class="cmpprc none">no price</div>`;
    const bv=(!pins.includes(o._key)&&o._key===bestKey)?`<span class="bestval">${LABEL.bestValue}</span>`:"";
    return `<div class="cmpcard ${pins.includes(o._key)?'best':''}"><div class="cmpimg">${thumb}</div><div class="cmpinfo"><div class="cmpname">${pins.includes(o._key)?'★ ':''}${esc(o.name)}${bv}</div>${prcEl}${body}<div class="cmplinks">${u}</div></div></div>`;
  }).join("")||'<p class="empty">No options to compare yet.</p>';
  const pi=priceInfo(id); const head=pi?`<div class="cmpprice">Best price: <b>${pi.region&&FLAG[pi.region]?FLAG[pi.region]+' ':''}${inr(pi.cur)}</b>${pi.target?` · target ${inr(pi.target)}`:''}${pi.isDeal?' · 🔥 deal':''}</div>`:`<div class="cmpprice muted">No price tracked yet — add one in the item.</div>`;
  const m=document.getElementById("compareModal");
  const sgList=suggFor(p); const sg=sgList.length?`<div class="suggh" style="margin-top:18px">💡 More to consider — ${pinsOf(id).length}/${neededQty(p)} chosen</div><div class="suggwrap">${sgList.map(s=>suggCardHtml(id,s,"＋ Add to compare")).join("")}</div>`:"";
  m.innerHTML=`<button class="mclose" data-close="compareOverlay" aria-label="Close">×</button><div class="mbody"><h3 id="cmptitle">Compare · ${esc(p.item)}</h3>${head}<div class="cmpgrid">${cards}</div>${sg}</div>`;
  m.setAttribute("aria-labelledby","cmptitle"); document.getElementById("compareOverlay").classList.add("show"); focusModal("compareOverlay"); }
function closeModal(id){ document.getElementById(id).classList.remove("show"); }
// suggestions strip (shown when finalised < needed) — review & "Add" to compare/finalise
function suggCardHtml(id,s,addLabel){ const pros=(s.pros||[]).map(x=>`<li class="pro">${esc(x)}</li>`).join(""); const cons=(s.cons||[]).map(x=>`<li class="con">${esc(x)}</li>`).join("");
  const body=(pros||cons)?`<ul class="pclist">${pros}${cons}</ul>`:(s.why?`<div class="cmpwhy">${esc(s.why)}</div>`:"");
  const links=["india","uk","canada"].map(k=>{const u=safeUrl((s.links||{})[k]);return u?`<a class="lk" target="_blank" rel="noopener" href="${esc(u)}" aria-label="${REGION[k]}">${FLAG[k]}</a>`:"";}).join("");
  return `<div class="suggcard"><div class="suggmain"><div class="suggname">${esc(s.name)}${s.price?` · <b>${inr(s.price)}</b>`:""}</div>${body}<div class="cmplinks">${links}</div></div><button class="minibtn" data-addsugg="${esc(id)}" data-sname="${esc(s.name)}">${addLabel||"＋ Add"}</button></div>`; }
function suggHtml(id,p){ const list=suggFor(p); if(!list.length)return "";
  return `<div class="suggwrap"><div class="suggh">💡 Suggestions to finalise — ${pinsOf(id).length}/${neededQty(p)} chosen</div>`+list.map(s=>suggCardHtml(id,s)).join("")+`</div>`; }

/* ---------- actions ---------- */
function toggleTrack(id){ TRACK[id]=isTracked(id)?false:true; save("track",TRACK); stats(); renderDash(); if(document.getElementById("itemOverlay").classList.contains("show"))openItem(id); }
function setStatus(id,st){ const b=(itemById(id)||{}).status; if(st===b)delete STATUSOVR[id]; else STATUSOVR[id]=st; save("statusovr",STATUSOVR); stats(); renderDash(); openItem(id); }
function pinOpt(id,key){ let a=pinsOf(id).slice(); a=a.includes(key)?a.filter(x=>x!==key):a.concat(key); if(a.length)PINS[id]=a; else delete PINS[id]; save("pins",PINS); refreshAll(); openItem(id); }
function refreshAll(){ stats(); renderDash(); renderPending(); if(document.getElementById("v-tobuy"))renderToBuy(); buildNotifs(); }
async function reloadData(){ syncToast("Refreshing prices…"); try{ await Promise.all([getFX(),loadPrices(),loadProsCons()]); const r=await getRemote(); if(r&&r.ts){applyShared(r);bumpTs(r.ts);} }catch(e){ console.warn("[refresh]",e); } refreshAll(); syncToast("Prices refreshed"); }
function reopenIfModal(id){ if(document.getElementById("itemOverlay").classList.contains("show"))openItem(id); }
function setNeed(id,val){ USERQTY[id]=Math.max(0,Math.round(parseFloat(val)||0)); save("userqty",USERQTY); refreshAll(); }
function setBought(id,d){ const cur=boughtQty(itemById(id)); USERBOUGHT[id]=Math.max(0,cur+(+d||0)); save("userbought",USERBOUGHT); refreshAll(); reopenIfModal(id); }
function markGot(id){ const p=itemById(id); USERBOUGHT[id]=isDone(p)?0:Math.max(1,neededQty(p)); save("userbought",USERBOUGHT); refreshAll(); reopenIfModal(id); }
function setPrice(id){ const g=s=>{const el=document.getElementById(s); const n=parseFloat(String(el?el.value:"").replace(/[^\d.]/g,"")); return isNaN(n)?0:n;};
  const today=new Date().toISOString().slice(0,10); let arr=(USERPRICES[id]||[]).slice();
  ["india","uk","canada"].forEach(r=>{ const v=g("m_price_"+r); if(v>0){ arr=arr.filter(x=>!(x.manual&&x.region===r&&x.date===today)); arr.push({date:today,inr:Math.round(v),local:Math.round(v),currency:"INR",region:r,manual:true}); } });
  if(arr.length){USERPRICES[id]=arr;save("userprices",USERPRICES);}
  const tv=g("m_target"); if(tv>0)USERTARGET[id]=Math.round(tv); else delete USERTARGET[id]; save("usertarget",USERTARGET);
  stats(); renderDash(); buildNotifs(); if(document.getElementById("v-log").classList.contains("on"))renderLog(); openItem(id); }
function delItem(id){ if(!confirm("Remove this item?"))return; if(String(id).startsWith("u")){USER=USER.filter(x=>String(x.id)!==String(id));save("useritems",USER);}else{HIDDEN[id]=1;save("hidden",HIDDEN);} stats();renderDash();renderPending();closeModal("itemOverlay"); }
function delOpt(id,userIdx){ if(!USEROPTS[id])return; const removed=USEROPTS[id][userIdx]; USEROPTS[id].splice(userIdx,1); if(!USEROPTS[id].length)delete USEROPTS[id]; save("useropts",USEROPTS);
  if(removed){ const key="u:"+(removed.oid||removed.name); const pins=pinsOf(id).filter(x=>x!==key); if(pins.length)PINS[id]=pins; else delete PINS[id]; save("pins",PINS); }
  refreshAll(); openItem(id); }
// hide a built-in catalogue option (by its original name); migrate finalised-pin indices so they stay aligned
function removeBaseOpt(id,oname){ if(!confirm("Remove this option?"))return;
  HIDDENOPTS[id]=(HIDDENOPTS[id]||[]).concat(oname); save("hiddenopts",HIDDENOPTS);
  const key="b:"+oname; const pins=pinsOf(id).filter(x=>x!==key); if(pins.length)PINS[id]=pins; else delete PINS[id]; save("pins",PINS);
  refreshAll(); reopenIfModal(id); }
function editBaseOpt(id,oname){ const p=itemById(id); if(!p)return; const o=effOptions(p).find(x=>x._orig===oname); if(!o)return;
  _edit={kind:"baseopt",id,name:oname}; _editReturn=id;
  document.querySelector("#addOverlay h3").textContent="Edit option"; showFields(false,false); fillSelects(p.category);
  setFields({pick:o.name,img:o.img,india:o.india,uk:o.uk,canada:o.canada,units:o.units,price:o.price});
  document.getElementById("m_parent").value=id; document.getElementById("addOverlay").classList.add("show"); focusModal("addOverlay"); }
function restoreBaseOpt(id,oname){ HIDDENOPTS[id]=(HIDDENOPTS[id]||[]).filter(n=>n!==oname); if(!HIDDENOPTS[id].length)delete HIDDENOPTS[id]; save("hiddenopts",HIDDENOPTS); refreshAll(); reopenIfModal(id); }
function addSuggestion(id,name){ const s=suggList(id).find(x=>x.name===name); if(!s)return; const L=s.links||{};
  const o={oid:rid(),name:s.name,why:s.why||"",img:"",india:L.india||"",uk:L.uk||"",canada:L.canada||"",multi:false,price:s.price?String(s.price):"",pros:s.pros||[],cons:s.cons||[]};
  (USEROPTS[id]=USEROPTS[id]||[]).push(o); save("useropts",USEROPTS);
  const cmpO=document.getElementById("compareOverlay").classList.contains("show"); refreshAll();
  if(cmpO)openCompare(id); else reopenIfModal(id); }

/* ---------- pending + log ---------- */
function renderPending(){ const w=document.getElementById("pendingList");
  const rows=[]; allItems().forEach(p=>{ const opts=effOptions(p); pinsOf(p.id).forEach(key=>{ const o=opts.find(x=>x._key===key); if(o) rows.push({p,o}); }); });
  const items=rows;
  if(!items.length){ w.innerHTML='<div class="sect" style="text-align:center;padding:40px 20px"><div style="font-size:40px">🎁</div><h3 style="margin:10px 0 6px">No items finalised yet</h3><p style="color:var(--muted);margin:0 0 14px">'+(isAdmin?'Go to the Dashboard, open an item and tap ★ Finalise — it\'ll appear here for your family.':'This registry is being put together — check back soon. 💛')+'</p>'+(isAdmin?'<button class="bestbtn" style="display:inline-block;width:auto;padding:10px 20px" data-showview="dash">Open Dashboard</button>':'')+'</div>'; return; }
  const ct=committedTotal();
  const totLine=(isAdmin&&ct.total)?` · ${inr(ct.total)} committed${ct.unpriced?` · <span class="needprice" data-needprice="1" role="button" tabindex="0" title="Open the first item missing a price">${ct.unpriced} need a price</span>`:''}`:"";
  w.innerHTML='<div style="font-size:13.5px;color:var(--muted);margin:0 0 14px">'+rows.length+' little favourite'+(rows.length>1?'s':'')+totLine+'</div><div class="regwrap">'+rows.map(r=>{ const p=r.p, o=r.o; const pi=priceInfo(p.id); const ic=CATICON[p.category]||"🍼";
    const imgEl=thumbEl(optImg(p,o),ic);
    const need=neededQty(p);
    const prc=optPriceINR(p.id,o);   // this pick's OWN price, not the item's cheapest
    const isDeal=!!(pi&&pi.isDeal);
    // tap the whole card to open the shop link. Multi-region picks keep per-region flags (no single destination).
    const real=["india","uk","canada"].filter(k=>isRealLink(o[k])), multi=real.length>=2;
    const href=multi?"":(real.length?safeUrl(o[real[0]]):singleLink(o,p));
    const foot=`<div class="regcardfoot">${multi?`<div class="reglinks">${optLinks(p,o)}</div>`:(href?`<span class="reglink-hint" aria-hidden="true">↗</span>`:`<span></span>`)}<span class="regprice${isDeal?' deal':''}">${prc?inr(prc):'—'}${isDeal?' 🔥':''}</span></div>`;
    const inner=`<div class="regimg">${imgEl}</div><div class="regcardbody"><div class="ri-brand">${esc(o.name)}</div><div class="ri-pick">${esc(p.item)}</div>${need>1?`<div class="ri-qty">Qty · ${need}</div>`:""}${foot}</div>`;
    return href?`<a class="regcard" href="${esc(href)}" target="_blank" rel="noopener" aria-label="${esc(o.name)} — view product">${inner}</a>`:`<div class="regcard">${inner}</div>`;
  }).join('')+'</div>'; }
function renderLog(){ document.getElementById("logMeta").textContent=UPDATED?("Auto-prices last updated "+UPDATED+" · add your own per item"):"Add India/UK/Canada prices in any item, or let the job fetch them.";
  const t=document.getElementById("logTable");
  const rows=allItems().map(p=>({p,byReg:latestByRegion(p.id)})).filter(r=>Object.keys(r.byReg).length);
  if(!rows.length){ t.innerHTML='<p class="empty">No prices yet. Open an item → enter 🇮🇳/🇬🇧/🇨🇦 prices, or wait for the price job.</p>'; return; }
  const cell=(byReg,rec,r)=>{ if(byReg[r]==null)return '<td class="na">—</td>'; return `<td class="${r===rec?'win':''}">${inr(byReg[r])}${r===rec?' ✓':''}</td>`; };
  const recCell=byReg=>{ const rec=buyRec(byReg); if(!rec)return '<td>—</td>'; const lbl=rec==="india"?"🇮🇳 India":(rec==="uk"?"🇬🇧 UK":"🇨🇦 Canada");
    const note=(rec==="india"&&Object.keys(byReg).length>1)?'<span class="rnote">similar — buy local</span>':''; return `<td class="rec">${lbl}${note}</td>`; };
  t.innerHTML=`<table class="cmp"><thead><tr><th>Item</th><th>🇮🇳 India</th><th>🇬🇧 UK</th><th>🇨🇦 Canada</th><th>Best buy</th></tr></thead><tbody>`+
    rows.map(({p,byReg})=>{ const rec=buyRec(byReg); return `<tr><td class="it">${esc(p.item)}</td>${cell(byReg,rec,"india")}${cell(byReg,rec,"uk")}${cell(byReg,rec,"canada")}${recCell(byReg)}</tr>`; }).join("")+
    `</tbody></table><p class="cmpnote">“Best buy” = cheapest market, but prefers 🇮🇳 India when it’s within ~7% of the cheapest (saves shipping/customs).</p>`; }

/* ---------- notifications ---------- */
function buildNotifs(){ NOTIFS=[]; allItems().forEach(p=>{ if(!isTracked(p.id))return; const pi=priceInfo(p.id); if(pi&&pi.isDeal){ const key=p.id+"@"+pi.cur; const m=pi.region&&FLAG[pi.region]?FLAG[pi.region]+" ":""; NOTIFS.push({key,item:p.item,msg:`now ${m}${inr(pi.cur)} — ${pi.pct}% below ${pi.target?'target':'average'}`,isNew:!SEEN[key]}); } });
  if(UPDATED&&UPDATED!==SEENUP&&Object.keys(PRICES).length) NOTIFS.unshift({key:"upd@"+UPDATED,item:"Prices refreshed",msg:"new data synced "+UPDATED,isNew:true});
  const n=NOTIFS.filter(x=>x.isNew).length; const bdg=document.getElementById("bdg"); if(n){bdg.style.display="";bdg.textContent=n;}else bdg.style.display="none"; }
function openNotifs(){ document.getElementById("notifList").innerHTML=NOTIFS.length?NOTIFS.map(x=>`<div class="notif"><div class="nm">${x.isNew?"🟢 ":""}${esc(x.item)}</div><div class="nt">${esc(x.msg)}</div></div>`).join(""):'<p class="empty">No notifications yet.</p>'; document.getElementById("notifOverlay").classList.add("show"); }

/* ---------- add (new item OR option under existing) ---------- */
let _edit=null,_editReturn=null;
function fillSelects(cat){
  document.getElementById("m_parent").innerHTML=['<option value="">— New standalone item —</option>'].concat(
    CATS.map(c=>`<optgroup label="${c}">`+allItems().filter(p=>p.category===c).map(p=>`<option value="${esc(p.id)}">${esc(p.item)}</option>`).join("")+`</optgroup>`)).join("");
  document.getElementById("m_cat").innerHTML=CATS.map(c=>`<option ${c===cat?'selected':''}>${c}</option>`).join("");
}
function showFields(parent,item){ const p=document.getElementById("f_parent"),i=document.getElementById("f_item"); if(p)p.style.display=parent?"":"none"; if(i)i.style.display=item?"":"none"; }
function setFields(v){ const g=id=>document.getElementById(id); g("m_item").value=v.item||""; g("m_qty").value=v.qty||""; g("m_pick").value=v.pick||""; g("m_img").value=v.img||""; g("m_in").value=v.india||""; g("m_uk").value=v.uk||""; g("m_ca").value=v.canada||""; const mu=g("m_units"); if(mu)mu.value=v.units!=null?v.units:""; const mp=g("m_price_opt"); if(mp)mp.value=v.price!=null?v.price:""; }
function openAdd(cat){ _edit=null; _editReturn=null; document.querySelector("#addOverlay h3").textContent="Add product"; showFields(true,true); fillSelects(cat); setFields({}); const mp=document.getElementById("m_parent"); mp.value=""; mp.onchange=()=>showFields(true,!mp.value); document.getElementById("addOverlay").classList.add("show"); focusModal("addOverlay"); }
window.editOpt=(pid,idx)=>{ const o=(USEROPTS[pid]||[])[idx]; if(!o)return; _edit={kind:"opt",pid,idx}; const p=itemById(pid); document.querySelector("#addOverlay h3").textContent="Edit option"; showFields(false,false); fillSelects(p?p.category:"EXTRAS"); setFields({pick:o.name,img:o.img,india:o.india,uk:o.uk,canada:o.canada,units:o.units,price:o.price}); document.getElementById("m_parent").value=pid; _editReturn=pid; document.getElementById("addOverlay").classList.add("show"); };
window.editItem=(id)=>{ const p=USER.find(x=>String(x.id)===String(id)); if(!p)return; const o=(p.options||[])[0]||{}; _edit={kind:"item",id}; document.querySelector("#addOverlay h3").textContent="Edit item"; showFields(false,true); fillSelects(p.category); setFields({item:p.item,qty:p.qty,pick:o.name,img:o.img||p.img,india:o.india,uk:o.uk,canada:o.canada,units:o.units,price:o.price}); document.getElementById("m_parent").value=""; _editReturn=id; document.getElementById("addOverlay").classList.add("show"); };
function saveAdd(){
  const g=id=>document.getElementById(id).value.trim();
  const parent=g("m_parent"), name=g("m_pick")||g("m_item"); if(!name){alert("Enter a name");return;}
  const qq=encodeURIComponent(name);
  let india=g("m_in"),uk=g("m_uk"),canada=g("m_ca");
  if(!india&&!uk&&!canada){ india="https://www.amazon.in/s?k="+qq; }   // only fall back if user gave no link
  const opt={name,why:"",img:g("m_img"),india,uk,canada,units:g("m_units"),price:g("m_price_opt")};
  if(_edit){
    if(_edit.kind==="opt" && USEROPTS[_edit.pid] && USEROPTS[_edit.pid][_edit.idx]){ opt.oid=USEROPTS[_edit.pid][_edit.idx].oid||rid(); USEROPTS[_edit.pid][_edit.idx]=opt; save("useropts",USEROPTS); }
    else if(_edit.kind==="baseopt"){ const it=itemById(_edit.id); const orig=((it&&it.options)||[]).find(o=>o.name===_edit.name)||{}; (OPTOVERRIDE[_edit.id]=OPTOVERRIDE[_edit.id]||{})[_edit.name]={name,why:orig.why||"",img:g("m_img"),india,uk,canada,units:g("m_units"),price:g("m_price_opt")}; save("optoverride",OPTOVERRIDE); }
    else if(_edit.kind==="item"){ const it=USER.find(x=>String(x.id)===String(_edit.id)); if(it){ it.item=g("m_item")||name; it.qty=g("m_qty"); it.img=g("m_img"); it.options=[opt]; save("useritems",USER); } }
    _edit=null; closeModal("addOverlay"); refreshAll(); if(_editReturn){const r=_editReturn;_editReturn=null;openItem(r);} return;
  }
  if(parent){ opt.oid=rid(); (USEROPTS[parent]=USEROPTS[parent]||[]).push(opt); save("useropts",USEROPTS); }
  else { USER.push({id:"u"+((crypto.randomUUID&&crypto.randomUUID())||Date.now()),category:g("m_cat")||"EXTRAS",item:g("m_item")||name,priority:"Later",status:"Buy",qty:g("m_qty"),best:"-",bestRegion:"india",notes:"Added by you.",owned:"",img:g("m_img"),options:[opt]}); save("useritems",USER); }
  closeModal("addOverlay"); refreshAll(); if(_editReturn){const r=_editReturn;_editReturn=null;openItem(r);}
}

/* ---------- export / import ---------- */
// full state (incl. userprices/usertarget/userbought) so a backup round-trips without dropping data
function exportEdits(){ const blob=new Blob([JSON.stringify(localState(),null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="baby-tracker-edits.json"; a.click(); }
function importEdits(e){ const f=e.target.files[0]; if(!f)return; const r=new FileReader();
  r.onload=()=>{ try{ applyShared(JSON.parse(r.result)); pushState(); stats(); renderDash(); renderPending(); alert("Imported & synced."); }catch(x){ alert("Invalid file"); } }; r.readAsText(f); }

/* ---------- stats + shell ---------- */
function stats(){ const items=allItems();
  const c={items:items.length,day1:items.filter(p=>(p.priority||"").startsWith("Day 1")).length,buy:items.filter(p=>effStatus(p)==="Buy").length,owned:items.filter(p=>effStatus(p)==="Owned").length,pinned:items.filter(p=>hasPin(p.id)).length,deal:items.filter(p=>isTracked(p.id)&&priceInfo(p.id)?.isDeal).length};
  const defs=[["","items","Items"],["day1","day1","Day-1"],["buy","buy","To buy"],["owned","owned","Owned"],["pinned","pinned","📌 Final"],["deal","deal","🔥 Deals"]];
  document.getElementById("stats").innerHTML=defs.map(([k,key,l])=>`<button class="stat ${key==='deal'?'deal':''} ${key==='pinned'?'pin':''} ${state.stat===k?'active':''}" data-stat="${k}"><div class="n">${c[key]}</div><div class="l">${l}</div></button>`).join("");
}
function showView(v){ document.querySelectorAll(".view").forEach(x=>x.classList.remove("on")); document.getElementById("v-"+v).classList.add("on");
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.v===v)); if(v==="pending")renderPending(); if(v==="tobuy")renderToBuy(); if(v==="log")renderLog(); }

/* ---------- global event wiring (delegation) ---------- */
document.addEventListener("click",e=>{
  const t=e.target, c=s=>t.closest(s);
  let el;
  if((el=c("[data-needprice]"))) { e.stopPropagation(); const u=firstUnpricedId(); if(u)openItem(u); return; }
  if((el=c("[data-compare]"))) { e.stopPropagation(); return openCompare(el.dataset.compare); }
  if((el=c("[data-open]"))&&!t.closest("[data-del]")&&!t.closest("a")&&!t.closest(".bestbtn")&&!t.closest("[data-got]")&&!t.closest("[data-bought]")&&!t.closest("[data-compare]")) return openItem(el.dataset.open);
  if((el=c("[data-del]"))) { e.stopPropagation(); return delItem(el.dataset.del); }
  if((el=c("[data-add]"))) { e.stopPropagation(); return openAdd(el.dataset.add); }
  if((el=c("[data-stat]"))) { state.stat=state.stat===el.dataset.stat?"":el.dataset.stat; stats(); return renderDash(); }
  if((el=c("[data-close]"))) return closeModal(el.dataset.close);
  if((el=c("[data-showview]"))) return showView(el.dataset.showview);
  if((el=c("[data-track]"))) return toggleTrack(el.dataset.track);
  if((el=c("[data-setstatus]"))) return setStatus(el.dataset.setstatus,el.dataset.st);
  if((el=c("[data-pin]"))) return pinOpt(el.dataset.pin,el.dataset.pinkey);
  if((el=c("[data-bought]"))) return setBought(el.dataset.bought,+el.dataset.d);
  if((el=c("[data-got]"))) return markGot(el.dataset.got);
  if((el=c("[data-saveprice]"))) return setPrice(el.dataset.saveprice);
  if((el=c("[data-delopt]"))) return delOpt(el.dataset.delopt,+el.dataset.optidx);
  if((el=c("[data-editopt]"))) return editOpt(el.dataset.editopt,+el.dataset.eidx);
  if((el=c("[data-delbase]"))) return removeBaseOpt(el.dataset.delbase,el.dataset.oname);
  if((el=c("[data-editbase]"))) return editBaseOpt(el.dataset.editbase,el.dataset.oname);
  if((el=c("[data-restoreopt]"))) return restoreBaseOpt(el.dataset.restoreopt,el.dataset.oname);
  if((el=c("[data-addsugg]"))) return addSuggestion(el.dataset.addsugg,el.dataset.sname);
  if((el=c("[data-edititem]"))) return editItem(el.dataset.edititem);
  if((el=c("[data-addopt]"))) { const p=itemById(el.dataset.addopt); openAdd(p?p.category:"EXTRAS"); _editReturn=el.dataset.addopt; document.getElementById("m_parent").value=el.dataset.addopt; showFields(true,false); return; }
  if((el=c("[data-jump]"))) { const t=document.getElementById(el.dataset.jump); if(t){ t.classList.add("open"); const ci=+el.dataset.jump.replace("cat",""); if(CATS[ci])OPEN[CATS[ci]]=true; t.scrollIntoView({behavior:"smooth",block:"start"}); } return; }
});
// broken image → swap for the emoji placeholder (replaces inline onerror, CSP-safe)
document.addEventListener("error",e=>{ const img=e.target; if(img&&img.tagName==="IMG"&&img.dataset&&img.dataset.ph!==undefined){ const d=document.createElement("div"); d.className="ph"; d.textContent=img.dataset.ph||"🍼"; img.replaceWith(d); } },true);
// typeable "Need" quantity input
document.addEventListener("change",e=>{ const el=e.target.closest&&e.target.closest("[data-need]"); if(el)setNeed(el.dataset.need,el.value); });
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){document.querySelectorAll(".overlay.show").forEach(o=>o.classList.remove("show"));}
  const card=e.target.closest&&e.target.closest("[data-open]");
  if(card&&(e.key==="Enter"||e.key===" ")&&!e.target.closest("button")&&!e.target.closest("a")){e.preventDefault();openItem(card.dataset.open);}
});
document.querySelectorAll(".overlay").forEach(o=>o.addEventListener("click",e=>{ if(e.target===o)o.classList.remove("show"); }));
document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>showView(b.dataset.v));
document.getElementById("bell").onclick=openNotifs;
document.getElementById("notifClose").onclick=()=>closeModal("notifOverlay");
document.getElementById("notifClear").onclick=()=>{ NOTIFS.forEach(x=>SEEN[x.key]=1); lset("seenDeals",SEEN); if(UPDATED){SEENUP=UPDATED;localStorage.setItem("seenUpdated",UPDATED);} buildNotifs(); openNotifs(); };
let _qT=null; document.getElementById("q").oninput=e=>{state.q=e.target.value;clearTimeout(_qT);_qT=setTimeout(renderDash,150);};
let _bqT=null; const _bq=document.getElementById("bq"); if(_bq)_bq.oninput=e=>{state.bq=e.target.value;clearTimeout(_bqT);_bqT=setTimeout(renderToBuy,150);};
// admin "⋯" menu (Refresh / run price job)
(function(){ const btn=document.getElementById("adminMenuBtn"), panel=document.getElementById("adminMenuPanel"); if(!btn||!panel)return;
  const close=()=>{panel.hidden=true;btn.setAttribute("aria-expanded","false");};
  btn.addEventListener("click",e=>{e.stopPropagation(); const open=panel.hidden; panel.hidden=!open; btn.setAttribute("aria-expanded",open?"true":"false");});
  document.addEventListener("click",e=>{ if(!panel.hidden&&!panel.contains(e.target)&&e.target!==btn)close(); });
  const rb=document.getElementById("refreshBtn"); if(rb)rb.onclick=()=>{close();reloadData();}; })();
document.querySelectorAll("[data-f]").forEach(el=>el.onclick=()=>{state[el.dataset.f]=!state[el.dataset.f];el.classList.toggle("on");renderDash();});
document.getElementById("expandAll").onclick=()=>{CATS.forEach(c=>OPEN[c]=true);lset("accopen",OPEN);renderDash();};
document.getElementById("collapseAll").onclick=()=>{CATS.forEach(c=>OPEN[c]=false);lset("accopen",OPEN);renderDash();};
document.getElementById("m_cancel").onclick=()=>{ closeModal("addOverlay"); if(_editReturn){const r=_editReturn;_editReturn=null;openItem(r);} };
document.getElementById("m_save").onclick=saveAdd;
function applyTheme(t){ document.documentElement.setAttribute("data-theme",t); const b=document.getElementById("themeBtn"); if(b)b.textContent=(t==="dark")?"☀️":"🌙"; }
let theme=localStorage.getItem("theme")||"light"; applyTheme(theme);
(function(){ const tb=document.getElementById("themeBtn"); if(tb)tb.onclick=()=>{ theme=(theme==="dark")?"light":"dark"; localStorage.setItem("theme",theme); applyTheme(theme); }; })();

/* focus trap within open modal */
document.addEventListener("keydown",e=>{ if(e.key!=="Tab")return; const ov=document.querySelector(".overlay.show"); if(!ov)return;
  const f=[...ov.querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(x=>x.offsetParent!==null);
  if(!f.length)return; const first=f[0],last=f[f.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();} });
document.addEventListener("visibilitychange",()=>{ if(!document.hidden)pullAndRender(); });
function focusModal(id){ setTimeout(()=>{ const ov=document.getElementById(id); const b=ov&&ov.querySelector("button,a,input,select"); if(b)b.focus(); },30); }

/* ---------- admin gate (friends = read-only registry) ---------- */
const ADMIN_HASH="72822ef23d9410a1845543fa7f5a0a4ec565412abd3785aeae424fc9cc0eb41a";
let isAdmin=localStorage.getItem("admin")==="1";
async function sha(t){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function applyAdminUI(){
  document.body.classList.toggle("admin",isAdmin);
  const ab=document.getElementById("adminBtn");
  if(ab){ ab.innerHTML=isAdmin?'<span aria-hidden="true">🔓</span> <span class="lbl">Log out</span>':'<span aria-hidden="true">🔒</span> <span class="lbl">Admin</span>';
    ab.setAttribute("aria-label",isAdmin?"Log out of admin":"Admin login"); }
  showView(isAdmin?"tobuy":"pending");
}
(function(){ const ab=document.getElementById("adminBtn"); if(!ab)return;
  ab.onclick=async()=>{ if(isAdmin){localStorage.removeItem("admin");isAdmin=false;ADMIN_PW="";sessionStorage.removeItem("apw");applyAdminUI();return;}
    const pw=prompt("Admin password:"); if(pw==null)return;
    if(await sha(pw)===ADMIN_HASH){ ADMIN_PW=pw; sessionStorage.setItem("apw",pw); localStorage.setItem("admin","1"); isAdmin=true; applyAdminUI(); }
    else alert("Wrong password."); }; })();


/* ---------- boot ---------- */
(async()=>{
  (document.getElementById("updated")||{}).textContent="loading…";
  try{ const r=await fetch("./products.json?v=5",{cache:"no-store"}); PRODUCTS=await r.json(); }catch(e){ document.getElementById("list").innerHTML='<p class="empty">Could not load products.json</p>'; return; }
  await Promise.all([getFX(),loadPrices(),loadProsCons(),loadOptData(),loadSuggest()]); await syncPull();
  if(migrateToKeys()&&ADMIN_PW)pushState();   // convert legacy index pins → stable keys (persist once if admin)
  stats(); renderDash(); buildNotifs(); applyAdminUI();
  if(!UPDATED)(document.getElementById("updated")||{}).textContent="loaded "+new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  // instant cross-device sync: Supabase Realtime (push) + 5s poll fallback
  try{ if(window.supabase){ const sb=window.supabase.createClient(SUPA.url,SUPA.key); sb.channel("ts").on("postgres_changes",{event:"*",schema:"public",table:"tracker_state"},()=>pullAndRender()).subscribe(); } }catch(e){}
  setInterval(()=>{ if(!document.hidden)pullAndRender(); }, 5000);
})();
