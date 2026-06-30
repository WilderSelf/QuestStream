// The phone-facing remote control page, served as a single self-contained HTML string
// by RemoteServer. On load it exchanges the one-time pairing code in its URL (?pair=…,
// from the QR) for a bearer token via POST /api/pair, stores the token in localStorage,
// and strips the code from the URL. It then polls /api/state and POSTs commands to
// /api/cmd with the token in an Authorization header (never in a URL). Nord-themed.
//
// CSP note: `script-src 'unsafe-inline'` is required because this is a single
// self-contained static document with no bundler. It is safe: the page loads no remote
// resources, and every dynamic value (titles, scene/soundboard labels) is HTML-escaped
// via esc()/textContent before insertion, so there is no injection surface.

import { DEFAULT_VOLUME } from '../../shared/constants'

export const REMOTE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'" />
<title>QuestStream Remote</title>
<style>
  :root { --bg:#2e3440; --bg2:#3b4252; --fg:#eceff4; --mut:#81a1c1; --acc:#88c0d0; --grn:#a3be8c; --red:#bf616a; --yel:#ebcb8b; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family:system-ui,sans-serif; padding:14px; }
  h1 { font-size:15px; color:var(--acc); letter-spacing:.08em; margin:0 0 12px; }
  .np { background:var(--bg2); border-radius:10px; padding:14px; margin-bottom:12px; }
  .np .t { font-weight:600; font-size:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .np .s { color:var(--mut); font-size:12px; margin-top:4px; }
  .row { display:flex; gap:8px; margin-bottom:12px; }
  button { flex:1; background:var(--bg2); color:var(--fg); border:0; border-radius:10px; padding:14px; font-size:18px; }
  button:active { background:#434c5e; }
  button.big { background:var(--acc); color:#2e3440; font-weight:700; }
  button.on { outline:2px solid var(--yel); }
  input[type=range] { width:100%; accent-color:var(--acc); }
  .sec { font-size:11px; color:var(--mut); text-transform:uppercase; letter-spacing:.08em; margin:14px 0 6px; }
  .grid { display:flex; flex-wrap:wrap; gap:8px; }
  .grid button { flex:0 1 calc(50% - 4px); font-size:13px; padding:12px; }
  .err { color:var(--red); font-size:12px; min-height:14px; }
  .q button { text-align:left; font-size:13px; padding:10px 12px; }
  .q button.cur { color:var(--grn); }
</style>
</head>
<body>
<h1>♪ QUESTSTREAM REMOTE</h1>
<div id="err" class="err"></div>
<div class="np"><div class="t" id="title">—</div><div class="s" id="sub"></div></div>
<div class="row">
  <button onclick="cmd({action:'prev'})">⏮</button>
  <button class="big" onclick="cmd({action:'togglePlay'})">⏯</button>
  <button onclick="cmd({action:'next'})">⏭</button>
  <button id="duck" onclick="toggleDuck()">🎙</button>
</div>
<input type="range" min="0" max="1" step="0.01" id="vol" onchange="cmd({action:'setVolume',volume:parseFloat(this.value)})" />
<div class="sec">Scenes</div><div class="grid" id="scenes"></div>
<div class="sec">Soundboard</div><div class="grid" id="sfx"></div>
<div class="sec">Queue</div><div class="grid q" id="queue"></div>
<script>
  var KEY = 'qs.remote.token';
  var token = localStorage.getItem(KEY) || '';
  var ducking = false, dragging = false, timer = null;
  function setErr(m){ document.getElementById('err').textContent = m || ''; }
  function authHeaders(){ return { 'Authorization': 'Bearer ' + token }; }
  function cmd(c){ if(!token) return; fetch('/api/cmd', {method:'POST', headers:Object.assign({'content-type':'application/json'}, authHeaders()), body:JSON.stringify(c)}).catch(function(){}); }
  function toggleDuck(){ ducking = !ducking; cmd({action:'duck', on:ducking}); document.getElementById('duck').classList.toggle('on', ducking); }
  function esc(s){ var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
  function btns(elId, items, onClick, curId){
    var el = document.getElementById(elId); el.innerHTML='';
    items.forEach(function(it){
      var b=document.createElement('button'); b.innerHTML=esc(it.label);
      if (curId && it.id===curId) b.className='cur';
      b.onclick=function(){ onClick(it); }; el.appendChild(b);
    });
  }
  function repair(){ localStorage.removeItem(KEY); token=''; if(timer){clearInterval(timer);timer=null;} setErr('Session ended — rescan the QR code to re-pair.'); }
  function poll(){
    if(!token) return;
    fetch('/api/state', {headers:authHeaders()}).then(function(r){
      if(r.status===401){ repair(); throw new Error('unauthorized'); }
      if(!r.ok) throw new Error('Error '+r.status); return r.json();
    }).then(function(s){
      setErr('');
      document.getElementById('title').textContent = s.title || 'Nothing playing';
      document.getElementById('sub').textContent = (s.paused?'Paused':s.playing?'Playing':'Idle');
      ducking = !!s.ducking; document.getElementById('duck').classList.toggle('on', ducking);
      if(!dragging) document.getElementById('vol').value = s.volume!=null? s.volume : ${DEFAULT_VOLUME};
      btns('scenes', (s.scenes||[]).map(function(x){return {id:x.id,label:'🎬 '+x.name};}), function(it){ cmd({action:'recallScene',id:it.id}); });
      btns('sfx', (s.soundboard||[]).map(function(x){return {id:x.id,label:x.label+(x.hotkey?' ['+x.hotkey+']':'')};}), function(it){ cmd({action:'triggerSfx',id:it.id}); });
      btns('queue', (s.queue||[]).map(function(x){return {id:x.uid,label:x.title};}), function(it){ cmd({action:'playQueueItem',uid:it.id}); }, (s.queue.find(function(q){return q.current;})||{}).uid);
    }).catch(function(){});
  }
  function start(){ poll(); if(!timer) timer=setInterval(poll, 1500); }
  // Exchange a pairing code (from the QR URL) for a bearer token, then scrub it from the URL.
  var pair = new URLSearchParams(location.search).get('pair');
  if (pair && !token) {
    fetch('/api/pair', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({code:pair})})
      .then(function(r){ if(!r.ok) throw new Error('pair'); return r.json(); })
      .then(function(d){ token=d.token; localStorage.setItem(KEY, token); history.replaceState(null,'',location.pathname); start(); })
      .catch(function(){ setErr('Pairing failed or expired — rescan the QR code.'); });
  } else if (token) {
    start();
  } else {
    setErr('Open this page by scanning the QR code in QuestStream → Settings.');
  }
  var v=document.getElementById('vol'); v.addEventListener('touchstart',function(){dragging=true;}); v.addEventListener('touchend',function(){dragging=false;});
</script>
</body>
</html>`
