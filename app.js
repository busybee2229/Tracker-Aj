"use strict";
/* Baby Deal Tracker — app logic (data lives in products.json; this is the only app file). */
const CONFIG = { FX:{GBP:108,CAD:62,USD:85,INR:1}, DEAL_THRESHOLD:0.0, AVG_WINDOW_DAYS:30,
  REPO:"https://github.com/busybee2229/Tracker-Aj" };
const SUPA = { url:"https://nrpjtychwmuecmskehyj.supabase.co",
  key:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ycGp0eWNod211ZWNtc2tlaHlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNDMyMDUsImV4cCI6MjA5NzYxOTIwNX0.g-WGgUyrHLwql4ZqcNjVvCuT1TzcNIo1z6NNIdVNE9s",
  h:e=>Object.assign({apikey:SUPA.key,Authorization:"Bearer "+SUPA.key},e||{}) };

const FLAG={india:"🇮🇳",uk:"🇬🇧",canada:"🇨🇦"};
const CATS=["CLOTHING","HYGIENE & HEALTH","BASICS & GEAR","EXTRAS"];
const CATICON={"CLOTHING":"👕","HYGIENE & HEALTH":"🧴","BASICS & GEAR":"🍼","EXTRAS":"🧸"};
const URGENCIES=["Day 1","Day 1*","First weeks","Later"];
const bcls={"Day 1":"day1","Day 1*":"day1","First weeks":"weeks","Later":"later","Optional":"opt","Owned":"owned","-":"opt"};

let PRODUCTS=[], PRICES={}, IMAGES={}, UPDATED="";
const LS=(k,d)=>{try{return JSON.parse(localStorage.getItem(k)||d);}catch(e){return JSON.parse(d);}};
let TRACK=LS("track","{}"),HIDDEN=LS("hidden","{}"),USER=LS("useritems","[]"),OPEN=LS("accopen","null"),
    PINS=LS("pins","{}"),SEEN=LS("seenDeals","{}"),SEENUP=localStorage.getItem("seenUpdated")||"",
    STATUSOVR=LS("statusovr","{}"),USEROPTS=LS("useropts","{}"),USERQTY=LS("userqty","{}");
if(OPEN===null){OPEN={};CATS.forEach(c=>OPEN[c]=true);}
normPins();

const isTracked=id=>TRACK[id]!==false;
const inr=n=>"₹"+(+n||0).toLocaleString("en-IN");
const effStatus=p=>STATUSOVR[p.id]||p.status;
const effOptions=p=>(p.options||[]).concat(USEROPTS[p.id]||[]);
const defaultQty=p=>{const m=String(p.qty||"").match(/\d+/);return m?+m[0]:1;};
const effQty=p=>USERQTY[p.id]!=null?USERQTY[p.id]:defaultQty(p);
const bestRegion=p=>p.bestRegion||"india";
const pinsOf=id=>Array.isArray(PINS[id])?PINS[id]:(PINS[id]!=null?[PINS[id]]:[]);
const isPinned=(id,i)=>pinsOf(id).includes(i);
const hasPin=id=>pinsOf(id).length>0;
function normPins(){ for(const k in PINS){ const v=PINS[k]; if(!Array.isArray(v)) PINS[k]=(v==null?[]:[v]); if(!PINS[k].length) delete PINS[k]; } }
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

const allItems=()=>PRODUCTS.filter(p=>!HIDDEN[p.id]).concat(USER.filter(p=>!HIDDEN[p.id]));
const itemById=id=>allItems().find(p=>String(p.id)===String(id));
const state={q:"",stat:"",deal:false,tracked:false};
let NOTIFS=[], sparks=[], _lastSig="";

/* ---------- persistence + sync ---------- */
let _pt=null;
function localState(){ return {track:TRACK,hidden:HIDDEN,useritems:USER,pins:PINS,statusovr:STATUSOVR,useropts:USEROPTS,userqty:USERQTY}; }
function mO(a,b){ return Object.assign({},a||{},b||{}); }
function mItems(a,b){ const m={}; [...(a||[]),...(b||[])].forEach(x=>{ if(x&&x.id!=null)m[x.id]=x; }); return Object.values(m); }
function mOpts(a,b){ const out={}; new Set([...Object.keys(a||{}),...Object.keys(b||{})]).forEach(k=>{ const seen=new Set(),arr=[]; [...((a||{})[k]||[]),...((b||{})[k]||[])].forEach(o=>{ const sig=(o.name||"")+"|"+(o.uk||"")+(o.india||"")+(o.canada||""); if(!seen.has(sig)){seen.add(sig);arr.push(o);} }); if(arr.length)out[k]=arr; }); return out; }
function mPins(a,b){ const out={}; const ar=v=>Array.isArray(v)?v:(v!=null?[v]:[]); new Set([...Object.keys(a||{}),...Object.keys(b||{})]).forEach(k=>{ const s=[...new Set([...ar((a||{})[k]),...ar((b||{})[k])])]; if(s.length)out[k]=s; }); return out; }
function mergeState(r,l){ r=r||{}; l=l||{}; return {track:mO(r.track,l.track),hidden:mO(r.hidden,l.hidden),statusovr:mO(r.statusovr,l.statusovr),userqty:mO(r.userqty,l.userqty),useritems:mItems(r.useritems,l.useritems),useropts:mOpts(r.useropts,l.useropts),pins:mPins(r.pins,l.pins)}; }
async function getRemote(){ try{ const r=await fetch(SUPA.url+"/rest/v1/tracker_state?id=eq.shared&select=data",{headers:SUPA.h(),cache:"no-store"}); if(!r.ok)return {}; const j=await r.json(); return (j&&j[0]&&j[0].data)||{}; }catch(e){ return {}; } }
function pushState(){ if(!SUPA.url)return; clearTimeout(_pt); _pt=setTimeout(async()=>{
  const merged=mergeState(await getRemote(), localState()); applyShared(merged); _lastSig=JSON.stringify(merged);
  fetch(SUPA.url+"/rest/v1/tracker_state",{method:"POST",headers:SUPA.h({"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"}),body:JSON.stringify({id:"shared",data:merged})}).catch(()=>{});
  try{ stats(); renderDash(); renderPending(); }catch(e){}
},700); }
function applyShared(d){ if(!d||typeof d!=="object")return;
  const map={track:v=>TRACK=v,hidden:v=>HIDDEN=v,useritems:v=>USER=v,pins:v=>PINS=v,statusovr:v=>STATUSOVR=v,useropts:v=>USEROPTS=v,userqty:v=>USERQTY=v};
  Object.keys(map).forEach(k=>{ if(d[k]!=null){ map[k](d[k]); localStorage.setItem(k==="useritems"?"useritems":k==="statusovr"?"statusovr":k, JSON.stringify(d[k])); } }); normPins(); }
async function syncPull(){ if(!SUPA.url)return; const remote=await getRemote(); _lastSig=JSON.stringify(remote); applyShared(mergeState(remote, localState())); }
async function pullAndRender(){ if(!SUPA.url)return; const remote=await getRemote(); const sig=JSON.stringify(remote); if(sig===_lastSig)return; _lastSig=sig; applyShared(mergeState(remote, localState())); try{ stats(); renderDash(); renderPending(); buildNotifs(); }catch(e){} }
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
function priceInfo(id){ const h=PRICES[id]||[]; if(!h.length)return null; const cur=h[h.length-1].inr;
  const cut=Date.now()-CONFIG.AVG_WINDOW_DAYS*864e5; const win=h.filter(x=>x.date>=cut); const arr=win.length?win:h;
  const avg=Math.round(arr.reduce((s,x)=>s+x.inr,0)/arr.length);
  return {cur,avg,isDeal:cur<avg&&cur<=avg*(1-CONFIG.DEAL_THRESHOLD),pct:Math.round((1-cur/avg)*100)}; }

/* ---------- dashboard ---------- */
function imgHtml(p){ const ic=CATICON[p.category]||"🍼"; return p.img
  ? `<img src="${esc(p.img)}" alt="${esc(p.item)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML='<div class=ph>'+${JSON.stringify(ic)}+'</div>'"/>`
  : `<div class="ph">${ic}</div>`; }
function qtyChip(p){ const n=effQty(p); return n>1?`<span class="qchip">×${n}</span>`:""; }

function cardHtml(p){
  const pi=isTracked(p.id)?priceInfo(p.id):null;
  const isDeal=pi&&pi.isDeal, pinned=hasPin(p.id), pri=p.priority||"-";
  const pc=bcls[pri]||"opt", stc={Buy:"buy",Owned:"owned",Confirm:"confirm"}[effStatus(p)]||"opt";
  const opts=effOptions(p), best=opts[0], br=bestRegion(p), bl=best?(best[br]||best.india||best.uk||best.canada):"";
  let price=""; if(pi){ price=`<div class="pr"><span class="cur">${inr(pi.cur)}</span> `+(pi.isDeal?`<span class="drop">▼${pi.pct}%</span>`:`<span class="avg">avg ${inr(pi.avg)}</span>`)+`</div>`; }
  const have=p.owned?`<div class="have">✓ ${esc(p.owned)}</div>`:"";
  const pk=(best&&best.name&&effStatus(p)!=="Owned")?`<div class="pk">${esc(best.name)}</div>`:"";
  const badges=`<div class="cbadge">`+(isDeal?`<span class="b deal">🔥</span>`:"")+(pinned?`<span class="b pinned">📌</span>`:"")+
    (URGENCIES.includes(pri)?`<span class="b ${pc}">${pri}</span>`:"")+`<span class="b ${stc}">${effStatus(p)}</span></div>`;
  let foot=`<div class="cfoot">`;
  if(best&&bl&&effStatus(p)!=="Owned") foot+=`<a class="bestbtn" target="_blank" rel="noopener" href="${esc(bl)}" onclick="event.stopPropagation()">★ Buy best</a>`;
  foot+=`<span class="detbtn">Details</span></div>`;
  return `<div class="card ${isDeal?'isdeal':''}" role="button" tabindex="0" aria-label="${esc(p.item)}" data-open="${esc(p.id)}">`+
    `<div class="imgwrap">${imgHtml(p)}${badges}${qtyChip(p)}<button class="delc" title="Delete ${esc(p.item)}" aria-label="Delete ${esc(p.item)}" data-del="${esc(p.id)}">✕</button></div>`+
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
    const toggle=()=>{acc.classList.toggle("open");OPEN[cat]=acc.classList.contains("open");save("accopen",OPEN);};
    head.addEventListener("click",e=>{ if(e.target.closest("[data-add]"))return; toggle(); });
    head.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){e.preventDefault();toggle();} });
    acc.querySelector(".grid").innerHTML=list.map(cardHtml).join("")||'<p class="empty">No items.</p>';
    L.appendChild(acc);
  });
  if(!shown)L.innerHTML='<p class="empty">No items match.</p>';
  const jb=document.getElementById("jumpbar");
  if(jb){ const present=CATS.filter(cat=>items.some(p=>p.category===cat&&passFilter(p)));
    jb.innerHTML=present.map(cat=>`<button class="jumpchip" data-jump="cat${CATS.indexOf(cat)}">${CATICON[cat]} ${cat[0]+cat.slice(1).toLowerCase()}</button>`).join("");
    jb.style.display=present.length>1?"flex":"none"; }
  document.getElementById("foot").innerHTML=`Showing ${shown} items · FX £1=₹${CONFIG.FX.GBP}, C$1=₹${CONFIG.FX.CAD} ${CONFIG._fx?"(live)":""} · <span class="lk2" id="exportBtn">Export</span> · <span class="lk2" id="importBtn">Import</span> · <a href="${CONFIG.REPO}" target="_blank" rel="noopener">repo</a><input type="file" id="impFile" accept="application/json" style="display:none"/>`;
  document.getElementById("exportBtn").onclick=exportEdits;
  document.getElementById("importBtn").onclick=()=>document.getElementById("impFile").click();
  document.getElementById("impFile").onchange=importEdits;
}

/* ---------- item modal ---------- */
function optCard(o,i,p,isUser,userIdx){
  const pinned=isPinned(p.id,i); const ic=CATICON[p.category]||"🍼";
  const img=(i===0&&p.img)?p.img:(o.img||"");
  const thumb=`<div class="optimg">${img?`<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML='<div class=ph>'+${JSON.stringify(ic)}+'</div>'">`:`<div class="ph">${ic}</div>`}</div>`;
  const rank=pinned?`<span class="rank fin">★ FINALISED</span>`:(i===0?`<span class="rank">★ BEST</span>`:`<span class="rank alt">ALT ${i+1}</span>`);
  const links=["india","uk","canada"].map(k=>o[k]?`<a class="lk" target="_blank" rel="noopener" href="${esc(o[k])}">${FLAG[k]} ${k[0].toUpperCase()+k.slice(1)}</a>`:"").join("");
  return `<div class="opt ${pinned?'pinned':(i===0?'best':'')}">${thumb}<div class="optmain"><div class="otop">${rank}<span class="oname">${esc(o.name)}</span>`+
    `<button class="pinbtn ${pinned?'on':''}" data-pin="${esc(p.id)}" data-pini="${i}">${pinned?'★ Finalised':'★ Finalise'}</button>`+
    (isUser?`<button class="trk" style="color:#b15;border-color:#e6c5c5" title="Remove option" data-delopt="${esc(p.id)}" data-optidx="${userIdx}">✕</button>`:"")+`</div>`+
    (o.why?`<div class="owhy">${esc(o.why)}</div>`:"")+`<div class="links">${links}</div></div></div>`;
}
function openItem(id){
  const p=itemById(id); if(!p)return; const pi=priceInfo(id); const opts=effOptions(p); const baseLen=(p.options||[]).length;
  let optsHtml=""; if(opts.length){ let order=opts.map((_,i)=>i); const pin=pinsOf(id).filter(i=>i<opts.length); if(pin.length){ order=[...pin, ...order.filter(i=>!pin.includes(i))]; } optsHtml=order.map(i=>optCard(opts[i],i,p,i>=baseLen,i-baseLen)).join(""); }
  else if(p.owned){ optsHtml=`<div class="opt best"><div class="otop"><span class="rank">✓ OWNED</span><span class="oname">${esc(p.owned)}</span></div></div>`; }
  let price=""; if(pi){ price=`<div style="margin:6px 0"><span class="b ${pi.isDeal?'deal':'owned'}">${inr(pi.cur)} ${pi.isDeal?'· '+pi.pct+'% below avg':'· avg '+inr(pi.avg)}</span></div><canvas class="spark" id="mspark"></canvas>`; }
  const qn=effQty(p);
  const stbtns=["Buy","Owned","Confirm"].map(st=>`<button class="trk ${effStatus(p)===st?'on':''}" data-setstatus="${esc(id)}" data-st="${st}">${st==="Buy"?"To buy":st}</button>`).join("");
  const m=document.getElementById("itemModal");
  m.innerHTML=`<button class="mclose" data-close="itemOverlay" aria-label="Close">×</button>`+
    `<div class="mhead"><div class="mimg">${imgHtml(p)}</div><div style="flex:1"><h3>${esc(p.item)}</h3>`+
    `<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:6px">`+
      (URGENCIES.includes(p.priority)?`<span class="b ${bcls[p.priority]||'opt'}">${p.priority}</span>`:"")+
      `<button class="trk ${isTracked(id)?'on':''}" data-track="${esc(id)}">${isTracked(id)?'Tracking ✓':'Track'}</button>${stbtns}</div>`+
    `<div class="qtyrow">Qty: <button class="qbtn" data-qty="${esc(id)}" data-d="-1" aria-label="Decrease">−</button><b id="qval">${qn}</b><button class="qbtn" data-qty="${esc(id)}" data-d="1" aria-label="Increase">+</button></div>`+
    (p.best&&p.best!=="-"?`<div style="font-size:12.5px;color:var(--muted);margin-top:4px">Best market: <b style="color:var(--ink)">${esc(p.best)}</b></div>`:"")+price+`</div></div>`+
    `<div class="mbody">${optsHtml}<button class="addopt" data-addopt="${esc(id)}">＋ Add another option/link</button>`+(p.notes&&p.notes.trim()?`<div class="notes">${esc(p.notes)}</div>`:"")+`</div>`;
  document.getElementById("itemOverlay").classList.add("show"); focusModal("itemOverlay");
  if(pi){ const h=(PRICES[id]||[]).slice(-20); const el=document.getElementById("mspark");
    if(el&&window.Chart) new Chart(el,{type:"line",data:{labels:h.map(_=>""),datasets:[{data:h.map(x=>x.inr),borderColor:"#6b8caf",borderWidth:2,pointRadius:0,tension:.3}]},options:{plugins:{legend:{display:false}},scales:{x:{display:false},y:{display:false}},animation:false}}); }
}
function closeModal(id){ document.getElementById(id).classList.remove("show"); }

/* ---------- actions ---------- */
function toggleTrack(id){ TRACK[id]=isTracked(id)?false:true; save("track",TRACK); stats(); renderDash(); if(document.getElementById("itemOverlay").classList.contains("show"))openItem(id); }
function setStatus(id,st){ const b=(itemById(id)||{}).status; if(st===b)delete STATUSOVR[id]; else STATUSOVR[id]=st; save("statusovr",STATUSOVR); stats(); renderDash(); openItem(id); }
function pinOpt(id,i){ let a=pinsOf(id).slice(); a=a.includes(i)?a.filter(x=>x!==i):a.concat(i); if(a.length)PINS[id]=a; else delete PINS[id]; save("pins",PINS); stats(); renderDash(); renderPending(); openItem(id); }
function setQty(id,d){ const cur=effQty(itemById(id)); USERQTY[id]=Math.max(0,cur+d); save("userqty",USERQTY); renderDash(); openItem(id); renderPending(); }
function delItem(id){ if(!confirm("Remove this item?"))return; if(String(id).startsWith("u")){USER=USER.filter(x=>String(x.id)!==String(id));save("useritems",USER);}else{HIDDEN[id]=1;save("hidden",HIDDEN);} stats();renderDash();renderPending();closeModal("itemOverlay"); }
function delOpt(id,userIdx){ if(!USEROPTS[id])return; USEROPTS[id].splice(userIdx,1); if(!USEROPTS[id].length)delete USEROPTS[id]; save("useropts",USEROPTS); renderDash(); openItem(id); }

/* ---------- pending + log ---------- */
function renderPending(){ const w=document.getElementById("pendingList");
  const rows=[]; allItems().forEach(p=>{ pinsOf(p.id).forEach(i=>{ const o=effOptions(p)[i]; if(o) rows.push({p,o,i}); }); });
  const items=rows;
  if(!items.length){ w.innerHTML='<div class="sect" style="text-align:center;padding:40px 20px"><div style="font-size:40px">🎁</div><h3 style="margin:10px 0 6px">No items finalised yet</h3><p style="color:var(--muted);margin:0 0 14px">'+(isAdmin?'Go to the Dashboard, open an item and tap ★ Finalise — it\'ll appear here for your family.':'This registry is being put together — check back soon. 💛')+'</p>'+(isAdmin?'<button class="bestbtn" style="display:inline-block;width:auto;padding:10px 20px" onclick="showView(\'dash\')">Open Dashboard</button>':'')+'</div>'; return; }
  const tot=rows.reduce((s,r)=>{const pi=priceInfo(r.p.id);return s+(pi?pi.cur*effQty(r.p):0);},0);
  w.innerHTML='<div style="font-size:13.5px;color:var(--muted);margin:0 0 14px">'+rows.length+' pick'+(rows.length>1?'s':'')+' chosen'+(tot?' · approx '+inr(tot)+' total':'')+'</div><div class="regwrap">'+rows.map(r=>{ const p=r.p, o=r.o; const pi=priceInfo(p.id); const ic=CATICON[p.category]||"🍼"; const img=o.img||p.img||"";
    const imgEl=img?`<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML='<div class=ph>'+${JSON.stringify(ic)}+'</div>'">`:`<div class="ph">${ic}</div>`;
    const q=effQty(p);
    const links=["india","uk","canada"].map(k=>o[k]?`<a class="lk" target="_blank" rel="noopener" href="${esc(o[k])}">${FLAG[k]}</a>`:"").join("");
    return `<div class="regcard"><div class="regimg">${imgEl}${q>1?`<span class="qbadge">×${q}</span>`:""}</div><div class="regcardbody"><div class="ri-brand">${esc(p.item)}</div><div class="ri-pick">${esc(o.name)}</div><div class="regcardfoot"><div class="reglinks">${links}</div><span class="regprice">${pi?inr(pi.cur):'—'}</span></div></div></div>`;
  }).join('')+'</div>'; }
function renderLog(){ document.getElementById("logMeta").textContent=UPDATED?("Last updated "+UPDATED):"No price data yet.";
  const rows=[]; allItems().forEach(p=>{ (PRICES[p.id]||[]).forEach(x=>rows.push({item:p.item,...x})); }); rows.sort((a,b)=>b.date-a.date);
  const t=document.getElementById("logTable");
  t.innerHTML=rows.length?`<table><thead><tr><th>Date</th><th>Item</th><th>Market</th><th>Local</th><th>₹</th></tr></thead><tbody>`+rows.slice(0,300).map(r=>`<tr><td>${r.ds||""}</td><td>${esc(r.item)}</td><td>${FLAG[r.region]||""} ${r.region}</td><td>${r.currency||""} ${r.local??""}</td><td><b>${inr(r.inr)}</b></td></tr>`).join("")+`</tbody></table>`:'<p class="empty">Price history will appear here.</p>'; }

/* ---------- notifications ---------- */
function buildNotifs(){ NOTIFS=[]; allItems().forEach(p=>{ if(!isTracked(p.id))return; const pi=priceInfo(p.id); if(pi&&pi.isDeal){ const key=p.id+"@"+pi.cur; NOTIFS.push({key,item:p.item,msg:`now ${inr(pi.cur)} — ${pi.pct}% below average`,isNew:!SEEN[key]}); } });
  if(UPDATED&&UPDATED!==SEENUP&&Object.keys(PRICES).length) NOTIFS.unshift({key:"upd@"+UPDATED,item:"Prices refreshed",msg:"new data synced "+UPDATED,isNew:true});
  const n=NOTIFS.filter(x=>x.isNew).length; const bdg=document.getElementById("bdg"); if(n){bdg.style.display="";bdg.textContent=n;}else bdg.style.display="none"; }
function openNotifs(){ document.getElementById("notifList").innerHTML=NOTIFS.length?NOTIFS.map(x=>`<div class="notif"><div class="nm">${x.isNew?"🟢 ":""}${esc(x.item)}</div><div class="nt">${esc(x.msg)}</div></div>`).join(""):'<p class="empty">No notifications yet.</p>'; document.getElementById("notifOverlay").classList.add("show"); }

/* ---------- add (new item OR option under existing) ---------- */
function openAdd(cat){
  const sel=document.getElementById("m_parent");
  const opts=['<option value="">— New standalone item —</option>'].concat(
    CATS.map(c=>`<optgroup label="${c}">`+PRODUCTS.filter(p=>p.category===c&&!HIDDEN[p.id]).map(p=>`<option value="${esc(p.id)}">${esc(p.item)}</option>`).join("")+`</optgroup>`));
  sel.innerHTML=opts.join("");
  document.getElementById("m_cat").innerHTML=CATS.map(c=>`<option ${c===cat?'selected':''}>${c}</option>`).join("");
  ["m_item","m_pick","m_img","m_in","m_uk","m_ca"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("addOverlay").classList.add("show"); focusModal("addOverlay");
}
function saveAdd(){
  const g=id=>document.getElementById(id).value.trim();
  const parent=g("m_parent"), name=g("m_pick")||g("m_item"); if(!name){alert("Enter a name");return;}
  const qq=encodeURIComponent(name);
  let india=g("m_in"),uk=g("m_uk"),canada=g("m_ca");
  if(!india&&!uk&&!canada){ india="https://www.amazon.in/s?k="+qq; }   // only fall back if user gave no link
  const opt={name,why:"",img:g("m_img"),india,uk,canada};
  if(parent){ (USEROPTS[parent]=USEROPTS[parent]||[]).push(opt); save("useropts",USEROPTS); }
  else { USER.push({id:"u"+Date.now(),category:g("m_cat")||"EXTRAS",item:g("m_item")||name,priority:"Later",status:"Buy",qty:"",best:"-",bestRegion:"india",notes:"Added by you.",owned:"",img:g("m_img"),options:[opt]}); save("useritems",USER); }
  closeModal("addOverlay"); stats(); renderDash(); renderPending();
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
  document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("on",b.dataset.v===v)); if(v==="pending")renderPending(); if(v==="log")renderLog(); }

/* ---------- global event wiring (delegation) ---------- */
document.addEventListener("click",e=>{
  const t=e.target, c=s=>t.closest(s);
  let el;
  if((el=c("[data-open]"))&&!t.closest("[data-del]")&&!t.closest("a")&&!t.closest(".bestbtn")) return openItem(el.dataset.open);
  if((el=c("[data-del]"))) { e.stopPropagation(); return delItem(el.dataset.del); }
  if((el=c("[data-add]"))) { e.stopPropagation(); return openAdd(el.dataset.add); }
  if((el=c("[data-stat]"))) { state.stat=state.stat===el.dataset.stat?"":el.dataset.stat; stats(); return renderDash(); }
  if((el=c("[data-close]"))) return closeModal(el.dataset.close);
  if((el=c("[data-track]"))) return toggleTrack(el.dataset.track);
  if((el=c("[data-setstatus]"))) return setStatus(el.dataset.setstatus,el.dataset.st);
  if((el=c("[data-pin]"))) return pinOpt(el.dataset.pin,+el.dataset.pini);
  if((el=c("[data-qty]"))) return setQty(el.dataset.qty,+el.dataset.d);
  if((el=c("[data-delopt]"))) return delOpt(el.dataset.delopt,+el.dataset.optidx);
  if((el=c("[data-addopt]"))) { closeModal("itemOverlay"); const p=itemById(el.dataset.addopt); openAdd(p?p.category:"EXTRAS"); document.getElementById("m_parent").value=el.dataset.addopt; return; }
  if((el=c("[data-jump]"))) { const t=document.getElementById(el.dataset.jump); if(t){ t.classList.add("open"); const ci=+el.dataset.jump.replace("cat",""); if(CATS[ci])OPEN[CATS[ci]]=true; t.scrollIntoView({behavior:"smooth",block:"start"}); } return; }
});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){document.querySelectorAll(".overlay.show").forEach(o=>o.classList.remove("show"));}
  const card=e.target.closest&&e.target.closest("[data-open]");
  if(card&&(e.key==="Enter"||e.key===" ")&&!e.target.closest("button")&&!e.target.closest("a")){e.preventDefault();openItem(card.dataset.open);}
});
document.querySelectorAll(".overlay").forEach(o=>o.addEventListener("click",e=>{ if(e.target===o)o.classList.remove("show"); }));
document.querySelectorAll("#nav button").forEach(b=>b.onclick=()=>showView(b.dataset.v));
document.getElementById("bell").onclick=openNotifs;
document.getElementById("notifClose").onclick=()=>closeModal("notifOverlay");
document.getElementById("notifClear").onclick=()=>{ NOTIFS.forEach(x=>SEEN[x.key]=1); save("seenDeals",SEEN); if(UPDATED){SEENUP=UPDATED;localStorage.setItem("seenUpdated",UPDATED);} buildNotifs(); openNotifs(); };
document.getElementById("q").oninput=e=>{state.q=e.target.value;renderDash();};
document.querySelectorAll("[data-f]").forEach(el=>el.onclick=()=>{state[el.dataset.f]=!state[el.dataset.f];el.classList.toggle("on");renderDash();});
document.getElementById("expandAll").onclick=()=>{CATS.forEach(c=>OPEN[c]=true);save("accopen",OPEN);renderDash();};
document.getElementById("collapseAll").onclick=()=>{CATS.forEach(c=>OPEN[c]=false);save("accopen",OPEN);renderDash();};
document.getElementById("m_cancel").onclick=()=>closeModal("addOverlay");
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
const ADMIN_HASH="ac03b24268491327fe765d9e0f6061150213d0367c4bf48993aefe93f0018e94";
let isAdmin=localStorage.getItem("admin")==="1";
async function sha(t){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function applyAdminUI(){
  document.body.classList.toggle("admin",isAdmin);
  const ab=document.getElementById("adminBtn"); if(ab)ab.textContent=isAdmin?"🔓 Log out":"🔒 Admin";
  showView(isAdmin?"dash":"pending");
}
(function(){ const ab=document.getElementById("adminBtn"); if(!ab)return;
  ab.onclick=async()=>{ if(isAdmin){localStorage.removeItem("admin");isAdmin=false;applyAdminUI();return;}
    const pw=prompt("Admin password:"); if(pw==null)return;
    if(await sha(pw)===ADMIN_HASH){localStorage.setItem("admin","1");isAdmin=true;applyAdminUI();}
    else alert("Wrong password."); }; })();


/* ---------- boot ---------- */
(async()=>{
  (document.getElementById("updated")||{}).textContent="loading…";
  try{ const r=await fetch("./products.json?v=5",{cache:"no-store"}); PRODUCTS=await r.json(); }catch(e){ document.getElementById("list").innerHTML='<p class="empty">Could not load products.json</p>'; return; }
  await Promise.all([getFX(),loadPrices()]); await syncPull(); pushState();
  stats(); renderDash(); buildNotifs(); applyAdminUI();
  if(!UPDATED)(document.getElementById("updated")||{}).textContent="loaded "+new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
  // instant cross-device sync: Supabase Realtime (push) + 5s poll fallback
  try{ if(window.supabase){ const sb=window.supabase.createClient(SUPA.url,SUPA.key); sb.channel("ts").on("postgres_changes",{event:"*",schema:"public",table:"tracker_state"},()=>pullAndRender()).subscribe(); } }catch(e){}
  setInterval(()=>{ if(!document.hidden)pullAndRender(); }, 5000);
})();
