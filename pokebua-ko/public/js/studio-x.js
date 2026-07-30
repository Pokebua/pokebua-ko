const $ = id => document.getElementById(id);
const socket = io();
const state = {
  current: null,
  queue: [],
  currentStartedAt: Number(sessionStorage.getItem("pxCurrentStartedAt")) || 0,
  lastCurrentId: sessionStorage.getItem("pxCurrentId") || null,
  finished: Number(sessionStorage.getItem("pxFinished")) || 0,
  selectedId: null,
  activities: JSON.parse(sessionStorage.getItem("pxActivities") || "[]")
};
const settings = Object.assign({confirmFinish:true,sounds:true,showBoot:true}, JSON.parse(localStorage.getItem("pxSettings") || "{}"));
const pageInfo = {
  dashboard:["CONTROL CENTER","Dashboard"], queue:["SMART QUEUE","Kø"], giveaway:["EVENT CONTROL","Giveaways"],
  overlay:["STREAM OUTPUT","Overlay"], soundboard:["AUDIO CONTROL","Soundboard"], analytics:["SESSION DATA","Analytics"], settings:["SYSTEM","Innstillinger"]
};

function escapeHtml(value="") { return String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function firstName(value="") { return String(value).trim().split(/\s+/)[0] || "Kunde"; }
function cleanTwitch(value="") {
  return String(value).trim().replace(/^https?:\/\/(www\.)?twitch\.tv\//i,"").replace(/^@/,"").split(/[/?#]/)[0].trim();
}
function safeDisplayName(entry={}) {
  const twitch = cleanTwitch(entry.twitchName || entry.twitch || entry.streamName || "");
  return twitch || firstName(entry.displayName || entry.name || "Kunde");
}
function formatAge(createdAt) {
  if (!createdAt) return "nå";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (mins < 1) return "nå";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins/60)}t ${mins%60}m`;
}
function api(url, options={}) {
  return fetch(url, {headers:{"Content-Type":"application/json",...(options.headers||{})},...options}).then(async r => {
    if (!r.ok) throw new Error((await r.json().catch(()=>({}))).error || `Feil ${r.status}`);
    return r.status === 204 ? null : r.json();
  });
}
function post(url, body) { return api(url,{method:"POST",body:body ? JSON.stringify(body) : undefined}); }
function saveSettings(){
  settings.confirmFinish=$('confirmFinish').checked; settings.sounds=$('studioSounds').checked; settings.showBoot=$('showBoot').checked;
  localStorage.setItem("pxSettings",JSON.stringify(settings));
}
function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`));
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $('pageEyebrow').textContent=pageInfo[name][0]; $('pageTitle').textContent=pageInfo[name][1]; $('sidebar').classList.remove('open');
}
function toast(title, detail=""){
  const item=document.createElement('div'); item.className='toast'; item.innerHTML=`<strong>${escapeHtml(title)}</strong>${detail?`<small>${escapeHtml(detail)}</small>`:""}`;
  $('toastHost').append(item); setTimeout(()=>item.remove(),3600);
}
function addActivity(text, icon="●"){
  state.activities.unshift({text,icon,time:new Date().toISOString()}); state.activities=state.activities.slice(0,80);
  sessionStorage.setItem("pxActivities",JSON.stringify(state.activities)); renderActivity();
}
function renderActivity(){
  $('activityFeed').classList.toggle('empty-state',!state.activities.length);
  $('activityFeed').innerHTML=state.activities.length ? state.activities.map(x=>`<div class="activity-item"><b>${x.icon}</b><div><strong>${escapeHtml(x.text)}</strong><small>${new Date(x.time).toLocaleTimeString('no-NO',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small></div></div>`).join('') : 'Ingen aktivitet ennå.';
}
function playSound(type){
  if(!settings.sounds) return;
  const ctx=new (window.AudioContext||window.webkitAudioContext)(); const tones={order:[520,690],skip:[740,980],giveaway:[440,660,880],finish:[620]}[type]||[520];
  tones.forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain(); o.frequency.value=f;o.type='sine';g.gain.setValueAtTime(.0001,ctx.currentTime+i*.09);g.gain.exponentialRampToValueAtTime(.08,ctx.currentTime+i*.09+.015);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+i*.09+.18);o.connect(g).connect(ctx.destination);o.start(ctx.currentTime+i*.09);o.stop(ctx.currentTime+i*.09+.2)});
}
function queueCard(entry,index,compact=false){
  const name=safeDisplayName(entry); const priority=entry.skipTheLine||entry.priority; const classes=priority?'priority':entry.giveaway?'giveaway':'';
  return `<article class="queue-card ${classes}" draggable="true" data-id="${entry.id}">
    <div class="queue-main"><div class="queue-title"><span class="queue-position">${index+1}</span><strong>${priority?'⚡ ':entry.giveaway?'✦ ':''}${escapeHtml(name)}</strong></div>
    <div class="queue-meta">${escapeHtml([entry.order,entry.items].filter(Boolean).join(' • '))}${entry.createdAt?` · ⏱ ${formatAge(entry.createdAt)}`:''}</div>
    <div class="tags">${priority?'<span class="tag skip">Skip the Line</span>':''}${entry.giveaway?'<span class="tag give">Giveaway</span>':''}</div></div>
    <div class="queue-actions"><button class="small-button" data-action="open">▶ Åpne</button>${compact?'':`<button class="small-button" data-action="top">Topp</button><button class="small-button" data-action="skip">⚡ Skip</button><button class="small-button" data-action="delete">Fjern</button>`}</div>
  </article>`;
}
function filteredQueue(){
  const q=$('queueSearch').value.trim().toLowerCase(),f=$('queueFilter').value;
  return state.queue.filter(x=>{const text=`${safeDisplayName(x)} ${x.order||''} ${x.items||''}`.toLowerCase(),skip=x.skipTheLine||x.priority;return text.includes(q)&&(f==='all'||(f==='skip'&&skip)||(f==='giveaway'&&x.giveaway)||(f==='normal'&&!skip&&!x.giveaway));});
}
function renderQueueLists(){
  const dash=state.queue.slice(0,10); $('dashboardQueue').innerHTML=dash.length?dash.map((x,i)=>queueCard(x,i,true)).join(''):'<div class="empty-state">Køen er tom.</div>';
  const full=filteredQueue(); $('fullQueue').innerHTML=full.length?full.map(x=>queueCard(x,state.queue.findIndex(y=>String(y.id)===String(x.id)))).join(''):'<div class="empty-state">Ingen ordre matcher.</div>';
  $('queueCount').textContent=`${state.queue.length} ${state.queue.length===1?'ordre':'ordrer'} i kø`;
  const gives=state.queue.filter(x=>x.giveaway); $('giveawayList').innerHTML=gives.length?gives.map(x=>queueCard(x,state.queue.findIndex(y=>String(y.id)===String(x.id)),true)).join(''):'<div class="empty-state">Ingen aktive giveaways.</div>';
  bindDragAndDrop();
}
function animateNumber(id,target){const el=$(id),start=Number(el.textContent)||0,diff=target-start,t0=performance.now();function tick(t){const p=Math.min(1,(t-t0)/260);el.textContent=Math.round(start+diff*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(tick)}requestAnimationFrame(tick)}
function render(){
  const currentName=state.current?safeDisplayName(state.current):'Ingen aktiv ordre'; $('heroName').textContent=currentName;
  $('heroMeta').textContent=state.current?[state.current.order,state.current.items].filter(Boolean).join('\n'):'Start neste kunde når du er klar.';
  $('heroCard').classList.toggle('has-current',!!state.current);
  const mini=state.queue.slice(0,5); $('miniQueue').classList.toggle('empty-state',!mini.length); $('miniQueue').innerHTML=mini.length?mini.map((x,i)=>`<div class="mini-row"><b>${i+1}</b><div><strong>${escapeHtml(safeDisplayName(x))}</strong><small>${escapeHtml([x.order,x.items].filter(Boolean).join(' • '))}</small></div></div>`).join(''):'Køen er tom.';
  animateNumber('statQueue',state.queue.length); animateNumber('statSkip',state.queue.filter(x=>x.skipTheLine||x.priority).length); animateNumber('statGive',state.queue.filter(x=>x.giveaway).length);
  $('queueBadge').textContent=state.queue.length;$('previewCount').textContent=state.queue.length;
  animateNumber('analyticsOrders',state.queue.length+(state.current?1:0)+state.finished);animateNumber('analyticsFinished',state.finished);animateNumber('analyticsSkip',state.queue.filter(x=>x.skipTheLine||x.priority).length);animateNumber('analyticsGive',state.queue.filter(x=>x.giveaway).length);
  renderQueueLists(); updateTimer();
}
function updateState(data,detect=true){
  const oldIds=new Set(state.queue.map(x=>String(x.id))); const oldCurrent=state.current;
  state.current=data.current||null; state.queue=Array.isArray(data.queue)?data.queue:[];
  if(state.current){if(String(state.current.id)!==String(state.lastCurrentId)){state.currentStartedAt=Date.now();state.lastCurrentId=String(state.current.id);sessionStorage.setItem('pxCurrentStartedAt',state.currentStartedAt);sessionStorage.setItem('pxCurrentId',state.lastCurrentId)}}else{state.currentStartedAt=0;state.lastCurrentId=null;sessionStorage.removeItem('pxCurrentStartedAt');sessionStorage.removeItem('pxCurrentId')}
  if(detect) state.queue.forEach(x=>{if(!oldIds.has(String(x.id))) addActivity(`Ny ordre: ${safeDisplayName(x)}`,x.skipTheLine||x.priority?'⚡':x.giveaway?'🎁':'🟢')});
  if(oldCurrent&&!state.current){} render();
}
function updateTimer(){
  if(!state.current||!state.currentStartedAt){$('heroTimer').textContent='00:00';return} const sec=Math.floor((Date.now()-state.currentStartedAt)/1000); $('heroTimer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
}
async function next(){if(!state.queue.length)return toast('Køen er tom');const name=safeDisplayName(state.queue[0]);try{await post('/api/next');addActivity(`Startet ordre: ${name}`,'📦');toast('Åpnes nå',name);playSound('order')}catch(e){toast('Kunne ikke starte',e.message)}}
async function finish(){if(!state.current)return toast('Ingen aktiv ordre');const name=safeDisplayName(state.current);if(settings.confirmFinish&&!confirm(`Marker ${name} som ferdig?`))return;try{await post('/api/finish');state.finished++;sessionStorage.setItem('pxFinished',state.finished);addActivity(`Ferdig: ${name}`,'✅');toast('Ordre ferdig',name);playSound('finish')}catch(e){toast('Kunne ikke fullføre',e.message)}}
async function act(id,action){const entry=state.queue.find(x=>String(x.id)===String(id));if(!entry)return;const name=safeDisplayName(entry);try{
  if(action==='delete'){if(!confirm(`Fjerne ${name}?`))return;await api(`/api/queue/${id}`,{method:'DELETE'});addActivity(`Fjernet: ${name}`,'🗑');return}
  if(action==='open'){await post(`/api/queue/${id}/top`);await post('/api/next');addActivity(`Åpnet direkte: ${name}`,'📦');toast('Åpnes nå',name);playSound('order');return}
  await post(`/api/queue/${id}/${action}`);addActivity(`${action==='skip'?'Skip aktivert':'Flyttet til topp'}: ${name}`,action==='skip'?'⚡':'↕'); if(action==='skip')playSound('skip');
}catch(e){toast('Handling feilet',e.message)}}
function handleQueueClick(e){const button=e.target.closest('[data-action]'),card=e.target.closest('.queue-card');if(!button||!card)return;act(card.dataset.id,button.dataset.action)}
function bindDragAndDrop(){
  document.querySelectorAll('.queue-card[draggable=true]').forEach(card=>{
    card.ondragstart=()=>{card.classList.add('dragging');state.selectedId=card.dataset.id};
    card.ondragend=()=>{card.classList.remove('dragging');document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'))};
    card.ondragover=e=>{e.preventDefault();card.classList.add('drop-target')};
    card.ondragleave=()=>card.classList.remove('drop-target');
    card.ondrop=async e=>{e.preventDefault();card.classList.remove('drop-target');const from=state.queue.findIndex(x=>String(x.id)===String(state.selectedId)),to=state.queue.findIndex(x=>String(x.id)===String(card.dataset.id));if(from<0||to<0||from===to)return;const ids=state.queue.map(x=>x.id);const [moved]=ids.splice(from,1);ids.splice(to,0,moved);try{await post('/api/queue/reorder',{ids});addActivity('Køen ble omorganisert','↕')}catch(err){toast('Kunne ikke flytte',err.message)}};
    card.oncontextmenu=e=>{e.preventDefault();state.selectedId=card.dataset.id;const menu=$('contextMenu');menu.hidden=false;menu.style.left=`${Math.min(e.clientX,innerWidth-215)}px`;menu.style.top=`${Math.min(e.clientY,innerHeight-190)}px`};
  });
}

document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
document.querySelectorAll('[data-view-link]').forEach(b=>b.onclick=()=>switchView(b.dataset.viewLink));
document.querySelectorAll('[data-command=next]').forEach(b=>b.onclick=next);document.querySelectorAll('[data-command=finish]').forEach(b=>b.onclick=finish);
$('menuBtn').onclick=()=>$('sidebar').classList.toggle('open');
$('dashboardQueue').onclick=handleQueueClick;$('fullQueue').onclick=handleQueueClick;$('giveawayList').onclick=handleQueueClick;
$('queueSearch').oninput=renderQueueLists;$('queueFilter').onchange=renderQueueLists;
$('clearFeed').onclick=()=>{state.activities=[];sessionStorage.removeItem('pxActivities');renderActivity()};
$('clearQueue').onclick=async()=>{if(!confirm('Tømme hele ventelisten?'))return;try{await api('/api/queue',{method:'DELETE'});addActivity('Køen ble tømt','🧹')}catch(e){toast('Kunne ikke tømme køen',e.message)}};
$('addManual').onclick=async()=>{const name=$('manualName').value.trim(),twitchName=cleanTwitch($('manualTwitch').value),order=$('manualOrder').value.trim(),items=$('manualItems').value.trim();if(!name&&!twitchName)return toast('Skriv inn navn eller Twitch-navn');try{await post('/api/queue',{name:name||twitchName,twitchName,order,items,skipTheLine:$('manualSkip').checked,giveaway:$('manualGive').checked});['manualName','manualTwitch','manualOrder','manualItems'].forEach(id=>$(id).value='');$('manualSkip').checked=$('manualGive').checked=false}catch(e){toast('Kunne ikke legge til',e.message)}};
$('addGiveaway').onclick=async()=>{const name=$('giveName').value.trim()||'Pokebua Giveaway',order=$('giveOrder').value.trim(),items=$('giveItems').value.trim();if(!items)return toast('Skriv inn premien');try{await post('/api/queue',{name,order,items,giveaway:true});['giveName','giveOrder','giveItems'].forEach(id=>$(id).value='')}catch(e){toast('Kunne ikke legge til giveaway',e.message)}};
$('openOverlay').onclick=()=>window.open('/overlay.html','_blank');$('copyOverlay').onclick=async()=>{await navigator.clipboard.writeText(`${location.origin}/overlay.html`);toast('Overlay-URL kopiert')};$('testAlert').onclick=()=>{toast('Studio-varsel','Powered by Pokebua');playSound('skip')};
document.querySelectorAll('[data-sound]').forEach(b=>b.onclick=()=>playSound(b.dataset.sound));
['confirmFinish','studioSounds','showBoot'].forEach(id=>$(id).onchange=saveSettings);$('confirmFinish').checked=settings.confirmFinish;$('studioSounds').checked=settings.sounds;$('showBoot').checked=settings.showBoot;
$('contextMenu').onclick=e=>{const b=e.target.closest('[data-context]');if(b){act(state.selectedId,b.dataset.context);$('contextMenu').hidden=true}};document.addEventListener('click',e=>{if(!e.target.closest('#contextMenu'))$('contextMenu').hidden=true});
document.addEventListener('keydown',e=>{if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.code==='Space'){e.preventDefault();next()}else if(e.key.toLowerCase()==='f')finish();else if(e.key.toLowerCase()==='q')switchView('queue')});
socket.on('connect',()=>{$('statusDot').classList.add('online');$('statusText').textContent='Tilkoblet';$('statStatus').textContent='ONLINE'});socket.on('disconnect',()=>{$('statusDot').classList.remove('online');$('statusText').textContent='Frakoblet';$('statStatus').textContent='OFFLINE'});socket.on('queue:update',d=>updateState(d,true));
socket.on('order:alert',p=>{toast('Ny ordre',safeDisplayName(p));playSound('order')});socket.on('skip:alert',p=>{toast('Skip the Line',safeDisplayName(p));playSound('skip')});socket.on('giveaway:alert',p=>{toast('Giveaway',safeDisplayName(p));playSound('giveaway')});
renderActivity();setInterval(updateTimer,1000);setInterval(renderQueueLists,60000);api('/api/queue').then(d=>updateState(d,false)).catch(e=>toast('Kunne ikke hente køen',e.message));
if(settings.showBoot){const steps=['Initializing Studio','Connecting Queue','Loading Overlay','Privacy Check','Connected'];let i=0;const timer=setInterval(()=>{$('bootText').textContent=steps[Math.min(++i,steps.length-1)];if(i>=steps.length-1){clearInterval(timer);setTimeout(()=>$('boot').classList.add('hidden'),300)}},250)}else{$('boot').classList.add('hidden')}
