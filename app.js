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

let PRODUCTS=[], PRICES={}, IMAGES={}, UPDATED="", PROSCONS={};
let ADMIN_PW=sessionStorage.getItem("apw")||"";   // verified server-side on each write
const LS=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||d);}catch(e){return JSON.parse(d);}};
const lset=(k,v)=>localStorage.setItem(k,JSON.stringify(v));   // device-local only — never synced (2.2)
let TRACK=LS("track","{}"),HIDDEN=LS("hidden","{}"),USER=LS("useritems","[]"),OPEN=LS("accopen","null"),
    PINS=LS("pins","{}"),SEEN=LS("seenDeals","{}"),SEENUP=localStorage.getItem("seenUpdated")||"",
    STATUSOVR=LS("statusovr","{}"),USEROPTS=LS("useropts","{}"),USERQTY=LS("userqty","{}"),
    USERPRICES=LS("userprices","{}"),USERTARGET=LS("usertarget","{}"),USERBOUGHT=LS("userbought","{}");
if(OPEN===null){OPEN={};CATS.forEach(c=>OPEN[c]=true);}
normPins();

const isTracked=id=>TRACK[id]!==false;
const inr=n=>"₹"+(+n||0).toLocaleString("en-IN");
const effStatus=p=>STATUSOVR[p.id]||p.status;
const effOptions=p=>(p.options||[]).concat(USEROPTS[p.id]||[]);
const defaultQty=p=>{const m=String(p.qty||"").match(/\d+/g);return m?+m[m.length-1]:1;};  // upper bound of "5-7" → 7
const effQty=p=>USERQTY[p.id]!=null?USERQTY[p.id]:defaultQty(p);   // = quantity NEEDED
const neededQty=p=>effQty(p);
const boughtQty=p=>+USERBOUGHT[p.id]||0;
const isDone=p=>effStatus(p)==="Owned"||(neededQty(p)>0&&boughtQty(p)>=neededQty(p));
const isToBuy=p=>!HIDDEN[p.id]&&(effStatus(p)==="Buy"||effStatus(p)==="Confirm")&&!isDone(p);
const bestRegion=p=>p.bestRegion||"india";
const pinsOf=id=>Array.isArray(PINS[id])?PINS[id]:(PINS[id]!=null?[PINS[id]]:[]);
const isPinned=(id,i)=>pinsOf(id).includes(i);
const hasPin=id=>pinsOf(id).length>0;
function normPins(){ for(const k in PINS){ const v=PINS[k]; if(!Array.isArray(v)) PINS[k]=(v==null?[]:[v]); if(!PINS[k].length) delete PINS[k]; } }
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const allItems=()=>PRODUCTS.filter(p=>!HIDDEN[p.id]).concat(USER.filter(p=>!HIDDEN[p.id]));
const itemById=id=>allItems().find(p=>String(p.id)===String(id));
const state={q:"",stat:"",deal:false,tracked:false};
let NOTIFS=[], sparks=[], _lastTs=+(localStorage.getItem("lastTs")||0), _pushPending=false;

/* ---------- persistence + sync ---------- */
let _pt=null;
function localState(){ return {track:TRACK,hidden:HIDDEN,useritems:USER,pins:PINS,statusovr:STATUSOVR,useropts:USEROPTS,userqty:USERQTY,userprices:USERPRICES,usertarget:USERTARGET,userbought:USERBOUGHT}; }
function mO(a,b){ return Object.assign({},a||{},b||{}); }
function mItems(a,b){ const m={}; [...(a||[]),...(b||[])].forEach(x=>{ if(x&&x.id!=null)m[x.id]=x; }); return Object.values(m); }
function mOpts(a,b){ const out={}; new Set([...Object.keys(a||{}),...Object.keys(b||{})]).forEach(k=>{ const seen=new Set(),arr=[]; [...((a||{})[k]||[]),...((b||{})[k]||[])].forEach(o=>{ const sig=(o.name||"")+"|"+(o.uk||"")+(o.india||"")+(o.canada||""); if(!seen.has(sig)){seen.add(sig);arr.push(o);} }); if(arr.length)out[k]=arr; }); return out; }
function mPins(a,b){ const out={}; const ar=v=>Array.isArray(v)?v:(v!=null?[v]:[]); new Set([...Object.keys(a||{}),...Object.keys(b||{})]).forEach(k=>{ const s=[...new Set([...ar((a||{})[k]),...ar((b||{})[k])])]; if(s.length)out[k]=s; }); return out; }
function mergeState(r,l){ r=r||{}; l=l||{}; return {track:mO(r.track,l.track),hidden:mO(r.hidden,l.hidden),statusovr:mO(r.statusovr,l.statusovr),userqty:mO(r.userqty,l.userqty),useritems:mItems(r.useritems,l.useritems),useropts:mOpts(r.useropts,l.useropts),pins:mPins(r.pins,l.pins)}; }
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
    if(r.status===409){ console.warn("[sync] newer remote state — adopting it"); _pushPending=false; pullAndRender(); return; }
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
  TRACK=d.track||{};HIDDEN=d.hidden||{};USER=d.useritems||[];PINS=d.pins||{};STATUSOVR=d.statusovr||{};USEROPTS=d.useropts||{};USERQTY=d.userqty||{};USERPRICES=d.userprices||{};USERTARGET=d.usertarget||{};USERBOUGHT=d.userbought||{};
  localStorage.setItem("track",JSON.stringify(TRACK));localStorage.setItem("hidden",JSON.stringify(HIDDEN));localStorage.setItem("useritems",JSON.stringify(USER));localStorage.setItem("pins",JSON.stringify(PINS));localStorage.setItem("statusovr",JSON.stringify(STATUSOVR));localStorage.setItem("useropts",JSON.stringify(USEROPTS));localStorage.setItem("userqty",JSON.stringify(USERQTY));localStorage.setItem("userprices",JSON.stringify(USERPRICES));localStorage.setItem("usertarget",JSON.stringify(USERTARGET));localStorage.setItem("userbought",JSON.stringify(USERBOUGHT));
  normPins(); }
function hasData(r){ return r && (Object.keys(r.pins||{}).length||(r.useritems||[]).length||Object.keys(r.useropts||{}).length||Object.keys(r.track||{}).length||Object.keys(r.statusovr||{}).length||Object.keys(r.userqty||{}).length||Object.keys(r.hidden||{}).length||Object.keys(r.userprices||{}).length||Object.keys(r.usertarget||{}).length||Object.keys(r.userbought||{}).length); }
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
function priceInfo(id){ const h=effPrices(id); const tgt=+USERTARGET[id]||0; if(!h.length)return null;
  const byReg=latestByRegion(id), regs=Object.keys(byReg);
  let cur, region="";
  if(regs.length){ region=buyRec(byReg); cur=byReg[region]; }   // recommended market (cheapest, India-preferred when similar)
  else { const last=h[h.length-1]; cur=recInr(last); region=last.region||""; }
  const cut=Date.now()-CONFIG.AVG_WINDOW_DAYS*864e5; const win=h.filter(x=>x.date>=cut); const arr=win.length?win:h;
  const avg=Math.round(arr.reduce((s,x)=>s+recInr(x),0)/arr.length);
  const isDeal = tgt>0 ? cur<=tgt : (cur<avg && cur<=avg*(1-CONFIG.DEAL_THRESHOLD));
  const pct = tgt>0 ? Math.max(0,Math.round((1-cur/tgt)*100)) : Math.round((1-cur/avg)*100);
  return {cur,avg,target:tgt||null,region,byReg,isDeal,pct}; }

/* ---------- dashboard ---------- */
function imgHtml(p,override){ const ic=CATICON[p.category]||"🍼"; const u=safeUrl(override||p.img||IMAGES[p.id]); return u
  ? `<img src="${esc(u)}" alt="${esc(p.item)}" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(ic)}"/>`
  : `<div class="ph">${ic}</div>`; }
// image of the finalised (pinned) option for an item, if any — else "" (caller falls back to default)
function finalImg(p){ const pins=pinsOf(p.id); if(!pins.length)return ""; const opts=effOptions(p); const i=pins[0]; const o=opts[i]; if(!o)return "";
  return (i===0?(p.img||IMAGES[p.id]||""):(o.img||""))||p.img||IMAGES[p.id]||""; }
function qtyChip(p){ const n=effQty(p); return n>1?`<span class="qchip">×${n}</span>`:""; }

function cardHtml(p){
  const pi=isTracked(p.id)?priceInfo(p.id):null;
  const isDeal=pi&&pi.isDeal, pinned=hasPin(p.id), pri=p.priority||"-";
  const pc=bcls[pri]||"opt", stc={Buy:"buy",Owned:"owned",Confirm:"confirm"}[effStatus(p)]||"opt";
  const opts=effOptions(p), best=opts[0], br=bestRegion(p), bl=best?(best[br]||best.india||best.uk||best.canada):"";
  let price=""; if(pi){ const flag=pi.region&&FLAG[pi.region]?FLAG[pi.region]+" ":""; price=`<div class="pr"><span class="cur">${flag}${inr(pi.cur)}</span> `+(pi.isDeal?`<span class="drop">▼${pi.pct}%</span>`:`<span class="avg">${pi.target?'target '+inr(pi.target):'avg '+inr(pi.avg)}</span>`)+`</div>`; }
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
  if(state.q){const s=(p.item+" "+effOptions(p).map(o=>o.name+" "+(o.why||"")).join(" ")+" "+p.category+" "+(p.owned||"")).toLowerCase(); if(!s.includes(state.q.toLowerCase()))return false;}
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
function recOption(p){ const opts=effOptions(p); if(!opts.length)return null; const pins=pinsOf(p.id).filter(i=>i<opts.length); const i=pins.length?pins[0]:0; return {o:opts[i],i}; }
function bestLinkFor(p){ const r=recOption(p); if(!r)return ""; const o=r.o, br=bestRegion(p); return safeUrl(o[br]||o.india||o.uk||o.canada||""); }
function renderToBuy(){
  const items=allItems().filter(p=>!HIDDEN[p.id]);
  const buy=items.filter(isToBuy);
  const done=items.filter(p=>(effStatus(p)==="Buy"||effStatus(p)==="Confirm"||effStatus(p)==="Owned")&&isDone(p));
  const urg=p=>{const i=URGENCIES.indexOf(p.priority);return i<0?9:i;};
  buy.sort((a,b)=>urg(a)-urg(b)||CATS.indexOf(a.category)-CATS.indexOf(b.category)||(hasPin(b.id)?1:0)-(hasPin(a.id)?1:0));
  const total=buy.length+done.length, pctDone=total?Math.round(done.length/total*100):0;
  document.getElementById("buyHeader").innerHTML=`<div class="buyhead"><div><h2 class="buyh2">Still to buy</h2><div class="buysub">${buy.length} item${buy.length!==1?'s':''} left · ${done.length} handled</div></div><div class="prog"><div class="progbar"><span style="width:${pctDone}%"></span></div><div class="progn">${pctDone}%</div></div></div><div class="buytools"><button class="minibtn" id="refreshBtn">↻ Refresh</button> <a class="lk2" href="${CONFIG.REPO}/actions" target="_blank" rel="noopener">run price job ↗</a></div>`;
  const rb=document.getElementById("refreshBtn"); if(rb)rb.onclick=reloadData;
  const L=document.getElementById("buyList");
  const card=(p,opts,i,pins,ic)=>{ const o=opts[i]; const pc=(PROSCONS[p.id]||{})[o.name]||{};
    const cimg=safeUrl((i===0?(p.img||IMAGES[p.id]):"")||o.img||"");
    const ct=cimg?`<img src="${esc(cimg)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(ic)}">`:`<div class="ph">${ic}</div>`;
    const sub=(pc.pros&&pc.pros[0])?esc(pc.pros[0]):(o.why?esc(o.why):"");
    const isPick=pins.includes(i), l=singleLink(o,p);
    const inner=`<div class="bicardimg">${ct}${isPick?'<span class="pickbadge">★ Picked</span>':''}${l?'<span class="extlink" aria-hidden="true">↗</span>':''}</div><div class="bicardname">${esc(o.name)}</div>${sub?`<div class="bicardwhy">${sub}</div>`:""}`;
    return l?`<a class="bicard ${isPick?'best':''}" href="${esc(l)}" target="_blank" rel="noopener" aria-label="${esc(o.name)} — view product">${inner}</a>`
            :`<div class="bicard ${isPick?'best':''}">${inner}</div>`; };
  L.innerHTML = buy.length ? buy.map(p=>{ const pi=priceInfo(p.id), ic=CATICON[p.category]||"🍼", opts=effOptions(p);
    const need=neededQty(p), got=boughtQty(p), pri=p.priority||"", badge=URGENCIES.includes(pri)?`<span class="b ${bcls[pri]||'opt'}">${pri}</span>`:"";
    const qtyTag=need>1?`<span class="bqty">${got}/${need}</span>`:"";
    const priceTxt = pi?`<span class="bprice ${pi.isDeal?'deal':''}">${pi.region&&FLAG[pi.region]?FLAG[pi.region]+' ':''}${inr(pi.cur)}${pi.isDeal?' 🔥':''}${pi.target&&!pi.isDeal?' · target '+inr(pi.target):''}</span>`:`<span class="bprice none">no price yet</span>`;
    const bl=bestLinkFor(p), buyBtn=bl?`<a class="bestbtn" target="_blank" rel="noopener" href="${esc(bl)}">★ Buy best</a>`:"";
    const gotBtn=need>1?`<button class="trk" data-bought="${esc(p.id)}" data-d="1">+1 bought</button>`:`<button class="trk gotit" data-got="${esc(p.id)}">Got it ✓</button>`;
    const cmpBtn=opts.length>1?`<button class="detbtn" data-compare="${esc(p.id)}">⚖ Compare</button>`:"";
    const pins=pinsOf(p.id).filter(i=>i<opts.length);
    const primaryIdx=pins.length?pins:opts.map((_,i)=>i).slice(0,3);
    const extraIdx=opts.map((_,i)=>i).filter(i=>!primaryIdx.includes(i));
    const primary=primaryIdx.map(i=>card(p,opts,i,pins,ic)).join("")||'<div class="bicard muted">No options yet — add one in Details.</div>';
    const more=extraIdx.length?`<details class="moreopts"><summary>＋ see ${extraIdx.length} more option${extraIdx.length>1?'s':''}</summary><div class="bicards">${extraIdx.map(i=>card(p,opts,i,pins,ic)).join("")}</div></details>`:"";
    return `<section class="buyitem"><div class="bihead"><div class="bihead-l"><span class="bititle">${esc(p.item)}</span> ${qtyTag} ${badge} ${priceTxt}</div><div class="bihead-r">${buyBtn}${cmpBtn}<button class="detbtn" data-open="${esc(p.id)}">Details</button>${gotBtn}</div></div><div class="bicards">${primary}</div>${more}</section>`;
  }).join("") : '<div class="empty">🎉 Nothing left to buy. Open “All items” to add or reopen something.</div>';
  const D=document.getElementById("buyDone");
  if(!done.length){ D.innerHTML=""; }
  else { D.innerHTML=`<div class="donehead" id="doneToggle"><span class="chev">▶</span> Done (${done.length})</div><div class="donebody" id="doneBody">`+done.map(p=>{ const r=recOption(p), nm=r?esc(r.o.name):(p.owned?esc(p.owned):""); return `<div class="donerow"><span class="dn">${esc(p.item)}${nm?` · ${nm}`:''}</span><button class="minibtn" data-got="${esc(p.id)}">Undo</button></div>`; }).join("")+`</div>`;
    const dt=document.getElementById("doneToggle"),db=document.getElementById("doneBody"); if(dt&&db)dt.onclick=()=>{db.classList.toggle("open");dt.classList.toggle("open");}; }
}

/* ---------- item modal ---------- */
function optCard(o,i,p,isUser,userIdx){
  const pinned=isPinned(p.id,i); const ic=CATICON[p.category]||"🍼";
  const img=safeUrl((i===0?(p.img||IMAGES[p.id]||""):"")||o.img||"");
  const thumb=`<div class="optimg">${img?`<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(ic)}">`:`<div class="ph">${ic}</div>`}</div>`;
  const rank=pinned?`<span class="rank fin">★ FINALISED</span>`:(i===0?`<span class="rank">★ BEST</span>`:`<span class="rank alt">ALT ${i+1}</span>`);
  const links=o.multi
    ? ["india","uk","canada"].map(k=>{const u=safeUrl(o[k]);return u?`<a class="lk" target="_blank" rel="noopener" href="${esc(u)}">${FLAG[k]} ${REGION[k]}</a>`:"";}).join("")
    : (()=>{const u=singleLink(o,p);return u?`<a class="lk" target="_blank" rel="noopener" href="${esc(u)}">View product</a>`:"";})();
  return `<div class="opt ${pinned?'pinned':(i===0?'best':'')}">${thumb}<div class="optmain"><div class="otop">${rank}<span class="oname">${esc(o.name)}</span>`+
    `<button class="pinbtn ${pinned?'on':''}" data-pin="${esc(p.id)}" data-pini="${i}">${pinned?'★ Finalised':'★ Finalise'}</button>`+
    (isUser?`<button class="trk" title="Edit option" data-editopt="${esc(p.id)}" data-eidx="${userIdx}">✎</button><button class="trk" style="color:#b15;border-color:#e6c5c5" title="Remove option" data-delopt="${esc(p.id)}" data-optidx="${userIdx}">✕</button>`:"")+`</div>`+
    (o.why?`<div class="owhy">${esc(o.why)}</div>`:"")+`<div class="links">${links}</div></div></div>`;
}
function openItem(id){
  const p=itemById(id); if(!p)return; const pi=priceInfo(id); const opts=effOptions(p); const baseLen=(p.options||[]).length;
  let optsHtml=""; if(opts.length){ let order=opts.map((_,i)=>i); const pin=pinsOf(id).filter(i=>i<opts.length); if(pin.length){ order=[...pin, ...order.filter(i=>!pin.includes(i))]; } optsHtml=order.map(i=>optCard(opts[i],i,p,i>=baseLen,i-baseLen)).join(""); }
  else if(p.owned){ optsHtml=`<div class="opt best"><div class="otop"><span class="rank">✓ OWNED</span><span class="oname">${esc(p.owned)}</span></div></div>`; }
  let price=""; if(pi){ const flag=pi.region&&FLAG[pi.region]?FLAG[pi.region]+" ":""; const sub=pi.isDeal?('· '+pi.pct+'% below '+(pi.target?'target':'avg')):(pi.target?'· target '+inr(pi.target):'· avg '+inr(pi.avg)); price=`<div style="margin:6px 0"><span class="b ${pi.isDeal?'deal':'owned'}">${flag}${inr(pi.cur)} ${sub}</span></div><canvas class="spark" id="mspark"></canvas>`; }
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
    `<div class="mhead"><div class="mimg">${imgHtml(p)}</div><div style="flex:1"><h3 id="mtitle">${esc(p.item)}</h3>`+
    `<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:6px">`+
      (URGENCIES.includes(p.priority)?`<span class="b ${bcls[p.priority]||'opt'}">${p.priority}</span>`:"")+
      `<button class="trk ${isTracked(id)?'on':''}" data-track="${esc(id)}">${isTracked(id)?'Tracking ✓':'Track'}</button>${stbtns}${edititem}${effOptions(p).length>1?`<button class="trk" data-compare="${esc(id)}">⚖ Compare</button>`:""}</div>`+
    `<div class="qtyrow">Need <input class="qnum" id="m_need" inputmode="numeric" value="${neededQty(p)}" data-need="${esc(id)}" aria-label="Quantity needed"> · Bought <button class="qbtn" data-bought="${esc(id)}" data-d="-1" aria-label="Decrease bought">−</button><b id="bval">${boughtQty(p)}</b><button class="qbtn" data-bought="${esc(id)}" data-d="1" aria-label="Increase bought">+</button> <button class="trk gotit ${isDone(p)?'on':''}" data-got="${esc(id)}">${isDone(p)?'✓ Got it':'Got it'}</button></div>`+
    (p.best&&p.best!=="-"?`<div style="font-size:12.5px;color:var(--muted);margin-top:4px">Best market: <b style="color:var(--ink)">${esc(p.best)}</b></div>`:"")+price+`</div></div>`+
    `<div class="mbody">${priceEdit}${optsHtml}<button class="addopt" data-addopt="${esc(id)}">＋ Add another option/link</button>`+(p.notes&&p.notes.trim()?`<div class="notes">${esc(p.notes)}</div>`:"")+`</div>`;
  m.setAttribute("aria-labelledby","mtitle");
  document.getElementById("itemOverlay").classList.add("show"); focusModal("itemOverlay");
  if(pi){ const h=effPrices(id).slice(-20); const el=document.getElementById("mspark");
    if(el) ensureChart().then(Chart=>{ if(Chart&&document.body.contains(el)) new Chart(el,{type:"line",data:{labels:h.map(_=>""),datasets:[{data:h.map(recInr),borderColor:"#6b8caf",borderWidth:2,pointRadius:0,tension:.3}]},options:{plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}},animation:false}}); }).catch(()=>{}); }
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
  const cards=opts.map((o,i)=>{ const data=pc[o.name]||{}; const img=safeUrl((i===0?(p.img||IMAGES[p.id]):"")||o.img||"");
    const thumb=img?`<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(CATICON[p.category]||'🍼')}">`:`<div class="ph">${CATICON[p.category]||'🍼'}</div>`;
    const pros=(data.pros||[]).map(x=>`<li class="pro">${esc(x)}</li>`).join("");
    const cons=(data.cons||[]).map(x=>`<li class="con">${esc(x)}</li>`).join("");
    const body=(pros||cons)?`<ul class="pclist">${pros}${cons}</ul>`:(o.why?`<div class="cmpwhy">${esc(o.why)}</div>`:`<div class="cmpwhy muted">No pros/cons yet — ask to generate.</div>`);
    const u=o.multi?["india","uk","canada"].map(k=>{const l=safeUrl(o[k]);return l?`<a class="lk" target="_blank" rel="noopener" href="${esc(l)}">${FLAG[k]} ${REGION[k]}</a>`:"";}).join(""):(()=>{const l=singleLink(o,p);return l?`<a class="lk" target="_blank" rel="noopener" href="${esc(l)}">View product</a>`:"";})();
    return `<div class="cmpcard ${pins.includes(i)?'best':''}"><div class="cmpimg">${thumb}</div><div class="cmpinfo"><div class="cmpname">${pins.includes(i)?'★ ':''}${esc(o.name)}</div>${body}<div class="cmplinks">${u}</div></div></div>`;
  }).join("")||'<p class="empty">No options to compare yet.</p>';
  const pi=priceInfo(id); const head=pi?`<div class="cmpprice">Best price: <b>${pi.region&&FLAG[pi.region]?FLAG[pi.region]+' ':''}${inr(pi.cur)}</b>${pi.target?` · target ${inr(pi.target)}`:''}${pi.isDeal?' · 🔥 deal':''}</div>`:`<div class="cmpprice muted">No price tracked yet — add one in the item.</div>`;
  const m=document.getElementById("compareModal");
  m.innerHTML=`<button class="mclose" data-close="compareOverlay" aria-label="Close">×</button><div class="mbody"><h3 id="cmptitle">Compare · ${esc(p.item)}</h3>${head}<div class="cmpgrid">${cards}</div></div>`;
  m.setAttribute("aria-labelledby","cmptitle"); document.getElementById("compareOverlay").classList.add("show"); focusModal("compareOverlay"); }
function closeModal(id){ document.getElementById(id).classList.remove("show"); }

/* ---------- actions ---------- */
function toggleTrack(id){ TRACK[id]=isTracked(id)?false:true; save("track",TRACK); stats(); renderDash(); if(document.getElementById("itemOverlay").classList.contains("show"))openItem(id); }
function setStatus(id,st){ const b=(itemById(id)||{}).status; if(st===b)delete STATUSOVR[id]; else STATUSOVR[id]=st; save("statusovr",STATUSOVR); stats(); renderDash(); openItem(id); }
function pinOpt(id,i){ let a=pinsOf(id).slice(); a=a.includes(i)?a.filter(x=>x!==i):a.concat(i); if(a.length)PINS[id]=a; else delete PINS[id]; save("pins",PINS); stats(); renderDash(); renderPending(); openItem(id); }
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
function delOpt(id,userIdx){ if(!USEROPTS[id])return; USEROPTS[id].splice(userIdx,1); if(!USEROPTS[id].length)delete USEROPTS[id]; save("useropts",USEROPTS); renderDash(); openItem(id); }

/* ---------- pending + log ---------- */
function renderPending(){ const w=document.getElementById("pendingList");
  const rows=[]; allItems().forEach(p=>{ pinsOf(p.id).forEach(i=>{ const o=effOptions(p)[i]; if(o) rows.push({p,o,i}); }); });
  const items=rows;
  if(!items.length){ w.innerHTML='<div class="sect" style="text-align:center;padding:40px 20px"><div style="font-size:40px">🎁</div><h3 style="margin:10px 0 6px">No items finalised yet</h3><p style="color:var(--muted);margin:0 0 14px">'+(isAdmin?'Go to the Dashboard, open an item and tap ★ Finalise — it\'ll appear here for your family.':'This registry is being put together — check back soon. 💛')+'</p>'+(isAdmin?'<button class="bestbtn" style="display:inline-block;width:auto;padding:10px 20px" data-showview="dash">Open Dashboard</button>':'')+'</div>'; return; }
  const tot=rows.reduce((s,r)=>{const pi=priceInfo(r.p.id);return s+(pi?pi.cur*effQty(r.p):0);},0);
  w.innerHTML='<div style="font-size:13.5px;color:var(--muted);margin:0 0 14px">'+rows.length+' little favourite'+(rows.length>1?'s':'')+((tot&&isAdmin)?' · approx '+inr(tot)+' total':'')+'</div><div class="regwrap">'+rows.map(r=>{ const p=r.p, o=r.o; const pi=priceInfo(p.id); const ic=CATICON[p.category]||"🍼"; const img=safeUrl(o.img||p.img||IMAGES[p.id]||"");
    const imgEl=img?`<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(ic)}">`:`<div class="ph">${ic}</div>`;
    const qtyText=(USERQTY[p.id]!=null?String(USERQTY[p.id]):(p.qty||"")).trim();
    const links=["india","uk","canada"].map(k=>{const u=safeUrl(o[k]);return u?`<a class="lk" target="_blank" rel="noopener" href="${esc(u)}" aria-label="${REGION[k]}">${FLAG[k]}</a>`:"";}).join("");
    const regflag=pi&&pi.region&&FLAG[pi.region]?FLAG[pi.region]+" ":"";
    return `<div class="regcard"><div class="regimg">${imgEl}</div><div class="regcardbody"><div class="ri-brand">${esc(o.name)}</div><div class="ri-pick">${esc(p.item)}</div>${qtyText?`<div class="ri-qty">Qty · ${esc(qtyText)}</div>`:""}<div class="regcardfoot"><div class="reglinks">${links}</div><span class="regprice">${pi?regflag+inr(pi.cur):'—'}</span></div></div></div>`;
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
function setFields(v){ const g=id=>document.getElementById(id); g("m_item").value=v.item||""; g("m_qty").value=v.qty||""; g("m_pick").value=v.pick||""; g("m_img").value=v.img||""; g("m_in").value=v.india||""; g("m_uk").value=v.uk||""; g("m_ca").value=v.canada||""; const mc=g("m_multi"); if(mc)mc.checked=!!v.multi; }
function openAdd(cat){ _edit=null; _editReturn=null; document.querySelector("#addOverlay h3").textContent="Add product"; showFields(true,true); fillSelects(cat); setFields({}); document.getElementById("m_parent").value=""; document.getElementById("addOverlay").classList.add("show"); focusModal("addOverlay"); }
window.editOpt=(pid,idx)=>{ const o=(USEROPTS[pid]||[])[idx]; if(!o)return; _edit={kind:"opt",pid,idx}; const p=itemById(pid); document.querySelector("#addOverlay h3").textContent="Edit option"; showFields(false,false); fillSelects(p?p.category:"EXTRAS"); setFields({pick:o.name,img:o.img,india:o.india,uk:o.uk,canada:o.canada,multi:o.multi}); document.getElementById("m_parent").value=pid; _editReturn=pid; document.getElementById("addOverlay").classList.add("show"); };
window.editItem=(id)=>{ const p=USER.find(x=>String(x.id)===String(id)); if(!p)return; const o=(p.options||[])[0]||{}; _edit={kind:"item",id}; document.querySelector("#addOverlay h3").textContent="Edit item"; showFields(false,true); fillSelects(p.category); setFields({item:p.item,qty:p.qty,pick:o.name,img:o.img||p.img,india:o.india,uk:o.uk,canada:o.canada,multi:o.multi}); document.getElementById("m_parent").value=""; _editReturn=id; document.getElementById("addOverlay").classList.add("show"); };
function saveAdd(){
  const g=id=>document.getElementById(id).value.trim();
  const parent=g("m_parent"), name=g("m_pick")||g("m_item"); if(!name){alert("Enter a name");return;}
  const qq=encodeURIComponent(name);
  let india=g("m_in"),uk=g("m_uk"),canada=g("m_ca");
  if(!india&&!uk&&!canada){ india="https://www.amazon.in/s?k="+qq; }   // only fall back if user gave no link
  const opt={name,why:"",img:g("m_img"),india,uk,canada,multi:!!(document.getElementById("m_multi")||{}).checked};
  if(_edit){
    if(_edit.kind==="opt" && USEROPTS[_edit.pid] && USEROPTS[_edit.pid][_edit.idx]){ USEROPTS[_edit.pid][_edit.idx]=opt; save("useropts",USEROPTS); }
    else if(_edit.kind==="item"){ const it=USER.find(x=>String(x.id)===String(_edit.id)); if(it){ it.item=g("m_item")||name; it.qty=g("m_qty"); it.img=g("m_img"); it.options=[opt]; save("useritems",USER); } }
    _edit=null; closeModal("addOverlay"); stats(); renderDash(); renderPending(); if(_editReturn){const r=_editReturn;_editReturn=null;openItem(r);} return;
  }
  if(parent){ (USEROPTS[parent]=USEROPTS[parent]||[]).push(opt); save("useropts",USEROPTS); }
  else { USER.push({id:"u"+((crypto.randomUUID&&crypto.randomUUID())||Date.now()),category:g("m_cat")||"EXTRAS",item:g("m_item")||name,priority:"Later",status:"Buy",qty:g("m_qty"),best:"-",bestRegion:"india",notes:"Added by you.",owned:"",img:g("m_img"),options:[opt]}); save("useritems",USER); }
  closeModal("addOverlay"); stats(); renderDash(); renderPending(); if(_editReturn){const r=_editReturn;_editReturn=null;openItem(r);}
}

/* ---------- export / import ---------- */
function exportEdits(){ const blob=new Blob([JSON.stringify({track:TRACK,hidden:HIDDEN,useritems:USER,pins:PINS,statusovr:STATUSOVR,useropts:USEROPTS,userqty:USERQTY},null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="baby-tracker-edits.json"; a.click(); }
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
  if((el=c("[data-compare]"))) { e.stopPropagation(); return openCompare(el.dataset.compare); }
  if((el=c("[data-open]"))&&!t.closest("[data-del]")&&!t.closest("a")&&!t.closest(".bestbtn")&&!t.closest("[data-got]")&&!t.closest("[data-bought]")&&!t.closest("[data-compare]")) return openItem(el.dataset.open);
  if((el=c("[data-del]"))) { e.stopPropagation(); return delItem(el.dataset.del); }
  if((el=c("[data-add]"))) { e.stopPropagation(); return openAdd(el.dataset.add); }
  if((el=c("[data-stat]"))) { state.stat=state.stat===el.dataset.stat?"":el.dataset.stat; stats(); return renderDash(); }
  if((el=c("[data-close]"))) return closeModal(el.dataset.close);
  if((el=c("[data-showview]"))) return showView(el.dataset.showview);
  if((el=c("[data-track]"))) return toggleTrack(el.dataset.track);
  if((el=c("[data-setstatus]"))) return setStatus(el.dataset.setstatus,el.dataset.st);
  if((el=c("[data-pin]"))) return pinOpt(el.dataset.pin,+el.dataset.pini);
  if((el=c("[data-bought]"))) return setBought(el.dataset.bought,+el.dataset.d);
  if((el=c("[data-got]"))) return markGot(el.dataset.got);
  if((el=c("[data-saveprice]"))) return setPrice(el.dataset.saveprice);
  if((el=c("[data-delopt]"))) return delOpt(el.dataset.delopt,+el.dataset.optidx);
  if((el=c("[data-editopt]"))) return editOpt(el.dataset.editopt,+el.dataset.eidx);
  if((el=c("[data-edititem]"))) return editItem(el.dataset.edititem);
  if((el=c("[data-addopt]"))) { const p=itemById(el.dataset.addopt); openAdd(p?p.category:"EXTRAS"); _editReturn=el.dataset.addopt; document.getElementById("m_parent").value=el.dataset.addopt; return; }
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
  await Promise.all([getFX(),loadPrices(),loadProsCons()]); await syncPull();
  stats(); renderDash(); buildNotifs(); applyAdminUI();
  if(!UPDATED)(document.getElementById("updated")||{}).textContent="loaded "+new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  // instant cross-device sync: Supabase Realtime (push) + 5s poll fallback
  try{ if(window.supabase){ const sb=window.supabase.createClient(SUPA.url,SUPA.key); sb.channel("ts").on("postgres_changes",{event:"*",schema:"public",table:"tracker_state"},()=>pullAndRender()).subscribe(); } }catch(e){}
  setInterval(()=>{ if(!document.hidden)pullAndRender(); }, 5000);
})();
