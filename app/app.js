/* ================= Interfaccia: audio, tastiera, touch ================= */
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
const SPECIAL={ArrowUp:0x46, ArrowDown:0x45, ArrowRight:0x4C, ArrowLeft:0x4D};   // codici dei tasti cursore (tradotti da $TRAN)
const render=createCrtRenderer(cv);
const T=new Terminal(); T.onBell=ding;
// disco: un platter all'indirizzo 310 con i due programmi; i file dati (classifica) persistono in localStorage
const disk=new DiskSystem({prefix:'unsman'});
const platter=disk.mount('310', new Platter('UNS-MAN'));
for(const n in PROGRAMS) platter.addProgram(n, PROGRAMS[n]);
const interp=new Interp(T, io, disk);
interp.patches={
  'UNS-MAN':{74:'GOTO 70', 92:'F=0'},          // niente controllo del disco / checksum della classifica
  'UNS-GAME':{1570:'GOTO 1620'}                // "dead end" del fantasma: resta fermo invece di fermare il programma
};
let SPEED={slow:1.5, normal:1, fast:0.65};   // moltiplicatore del tempo virtuale: ~6 / ~9 / ~14 passi al secondo
const spd=document.getElementById('spd');
spd.onchange=()=>{ interp.speed=SPEED[spd.value]; spd.blur(); };
function restart(){ interp.reset(); io.q.length=0; io.waiter=null; interp.speed=SPEED[spd.value]; interp.start('UNS-MAN').catch(e=>console.error(e)); }

addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  if(e.key==='Escape'){ restart(); return; }
  if(SPECIAL[e.key]){ io.push(SPECIAL[e.key],true); e.preventDefault(); return; }
  if(e.key==='Enter'){ io.push(13); e.preventDefault(); return; }
  if(e.key==='Backspace'){ io.push(8); e.preventDefault(); return; }
  if(e.target&&e.target.id==='kb') return;         // la tastiera virtuale passa da 'input'
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
