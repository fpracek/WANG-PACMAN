// Runs UNS-MAN without a browser, with simulated keys, and prints the screen (pure CRT model).
const fs=require('fs'), path=require('path');
const {Interp}=require('../src/basic2.js'), {Platter,DiskSystem}=require('../src/platter.js'), {Terminal}=require('../src/wangcrt.js');
const src=process.env.LISTINGS||path.join(__dirname,'..','..','listings');
const disk=new DiskSystem({storage:null}); const p=new Platter('PACMAN'); disk.mount('310',p);
for(const n of ['UNS-MAN','UNS-GAME']) p.addProgram(n, fs.readFileSync(path.join(src,n+'.txt'),'latin1'));
const T=new Terminal(); const q=[]; let waiter=null;
const io={poll(){return q.shift()||null;}, next(){ if(q.length) return Promise.resolve(q.shift()); return new Promise(r=>waiter=r); }};
const key=(c,sp=false)=>{ const k={c:typeof c==='string'?c.charCodeAt(0):c,sp}; if(waiter){const w=waiter;waiter=null;w(k);} else q.push(k); };
const it=new Interp(T,io,disk);
it.patches={'UNS-MAN':{74:'GOTO 70',92:'F=0'},'UNS-GAME':{1570:'GOTO 1620'}};
function dump(title){
  console.log('\n=== '+title+' ===');
  for(let r=0;r<24;r++){ let s=''; for(let c=0;c<80;c++){ const b=T.ch[r*80+c], f=T.fl[r*80+c];
      s+= (f&1) ? (b===0x20?' ':(b>=0x40?'#':'.')) : String.fromCharCode(b<32?32:b); } console.log(s.replace(/\s+$/,'')); }
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  it.start('UNS-MAN').catch(e=>{ console.log('interpreter ERROR:',e.message); });
  await sleep(1000); key('1');
  await sleep(9000); dump('game, ~9s after key 1');
  key(0x4D,true); await sleep(2500); dump('after left arrow');
  await sleep(3000); dump('3s later');
  it.reset(); process.exit(0);
})();
