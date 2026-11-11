/* ================= UNS-MAN web page: audio, keyboard, touch, program loader ================= */
let actx=null;
function ding(){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();
    if(actx.state==='suspended') actx.resume();
    const o=actx.createOscillator(), g=actx.createGain();
    o.type='square'; o.frequency.value=1000; g.gain.setValueAtTime(0.08,actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,actx.currentTime+0.09);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime+0.1);
  }catch(e){}
}
const io={
  q:[], waiter:null,
  poll(){ return this.q.shift()||null; },
  next(){ if(this.q.length) return Promise.resolve(this.q.shift()); return new Promise(r=>{ this.waiter=r; }); },
  push(c,sp=false){
    if(actx&&actx.state==='suspended') actx.resume();
    const k={c,sp};
    if(this.waiter){ const w=this.waiter; this.waiter=null; w(k); } else { this.q.push(k); if(this.q.length>6) this.q.shift(); }
  }
};
const SPECIAL={ArrowUp:0x46, ArrowDown:0x45, ArrowRight:0x4C, ArrowLeft:0x4D};   // cursor key codes (translated by the game's $TRAN)
const render=createCrtRenderer(cv);
const T=new Terminal(); T.onBell=ding;

/* disk: one platter at address 310 with the two programs; data files (the Hall of Fame) persist in localStorage */
const disk=new DiskSystem({prefix:'unsman'});
const platter=disk.mount('310', new Platter('UNS-MAN'));
const WANTED=['UNS-MAN','UNS-GAME'];
const SAVED_KEY='unsman:programs';
function installPrograms(map){ for(const n in map) platter.addProgram(n, map[n]); }
function haveGame(){ return WANTED.every(n=>platter.has(n)); }
installPrograms(PROGRAMS);                      // the full build embeds the programs; the loader build has none
let fromLoader=false;
if(!haveGame()){                                // loader build: try the copy remembered in this browser
  try{ const saved=JSON.parse(localStorage.getItem(SAVED_KEY)||'null'); if(saved){ installPrograms(saved); fromLoader=haveGame(); } }catch(e){}
}

const interp=new Interp(T, io, disk);
interp.patches={
  'UNS-MAN':{74:'GOTO 70', 92:'F=0'},          // no disk check / Hall of Fame checksum
  'UNS-GAME':{1570:'GOTO 1620'}                // ghost "dead end": it stays put instead of stopping the program
};
let SPEED={slow:1.5, normal:1, fast:0.65};   // virtual-time multiplier: about 6 / 9 / 14 steps per second
const spd=document.getElementById('spd');
spd.onchange=()=>{ interp.speed=SPEED[spd.value]; spd.blur(); };
function restart(){
  if(!haveGame()){ showLoader(); return; }
  interp.reset(); io.q.length=0; io.waiter=null; interp.speed=SPEED[spd.value]; interp.start('UNS-MAN').catch(e=>console.error(e));
}

/* ---- loader screen (only when the game programs are not embedded) ---- */
const loaderEl=document.getElementById('loader'), loaderMsg=document.getElementById('loaderMsg'), forgetBtn=document.getElementById('forget');
function showLoader(msg){ interp.reset(); loaderEl.hidden=false; loaderMsg.textContent=msg||''; }
async function handleFiles(list){
  const files=[]; for(const f of list) files.push({name:f.name, bytes:new Uint8Array(await f.arrayBuffer())});
  const r=collectPrograms(files, WANTED);
  installPrograms(r.programs);
  if(!haveGame()){
    showLoader('Still missing: '+WANTED.filter(n=>!platter.has(n)).join(', ')+(r.notes.length?'\n'+r.notes.join('\n'):''));
    return;
  }
  fromLoader=true; forgetBtn.hidden=false;
  try{ const o={}; for(const n of WANTED) o[n]=platter.get(n).text; localStorage.setItem(SAVED_KEY, JSON.stringify(o)); }catch(e){}
  loaderEl.hidden=true; restart();
}
document.getElementById('loaderFiles').onchange=e=>{ handleFiles(e.target.files); e.target.value=''; };
for(const ev of ['dragenter','dragover']) loaderEl.addEventListener(ev,e=>{ e.preventDefault(); loaderEl.classList.add('over'); });
for(const ev of ['dragleave','drop']) loaderEl.addEventListener(ev,e=>{ e.preventDefault(); loaderEl.classList.remove('over'); });
loaderEl.addEventListener('drop',e=>{ if(e.dataTransfer&&e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
forgetBtn.hidden=!fromLoader;
forgetBtn.onclick=()=>{ try{ localStorage.removeItem(SAVED_KEY); }catch(e){} location.reload(); };

addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  if(!loaderEl.hidden) return;
  if(e.key==='Escape'){ restart(); return; }
  if(SPECIAL[e.key]){ io.push(SPECIAL[e.key],true); e.preventDefault(); return; }
  if(e.key==='Enter'){ io.push(13); e.preventDefault(); return; }
  if(e.key==='Backspace'){ io.push(8); e.preventDefault(); return; }
  if(e.target&&e.target.id==='kb') return;         // the on-screen keyboard goes through 'input'
  if(e.key.length===1){ io.push(e.key.charCodeAt(0)); e.preventDefault(); }
});
const kb=document.getElementById('kb');
kb.addEventListener('input',()=>{ for(const ch of kb.value) io.push(ch.charCodeAt(0)); kb.value=''; });
document.querySelectorAll('#pad button').forEach(b=>{
  b.addEventListener('pointerdown',e=>{
    e.preventDefault(); const k=b.dataset.k;
    if(k==='KB'){ kb.focus(); return; }
    if(k==='ENTER') io.push(13); else if(k==='BKSP') io.push(8); else io.push(k.charCodeAt(0));
  });
});
cv.addEventListener('pointerdown',()=>{ if(matchMedia('(pointer:coarse)').matches) kb.focus(); });
document.getElementById('fs').onclick=()=>{ const d=document.documentElement; (document.fullscreenElement?document.exitFullscreen():d.requestFullscreen&&d.requestFullscreen()); };

let blinkOn=true, lastBlink=true;
function loop(ts){
  blinkOn=Math.floor(ts/450)%2===0;
  if(T.dirty||blinkOn!==lastBlink){ T.dirty=false; lastBlink=blinkOn; render(T,blinkOn); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
restart();
