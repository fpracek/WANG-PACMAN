const fs=require('fs'), path=require('path');
const {Interp}=require('../src/basic2.js'), {Platter,DiskSystem}=require('../src/platter.js'), {Terminal}=require('../src/wangcrt.js');
const src=process.env.LISTINGS||path.join(__dirname,'..','..','listings');
const store={}; const storage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v;}};
const disk=new DiskSystem({storage,prefix:'t'}); const p=new Platter('P'); disk.mount('310',p);
for(const n of ['UNS-MAN','UNS-GAME']) p.addProgram(n, fs.readFileSync(path.join(src,n+'.txt'),'latin1'));
const T=new Terminal(); const q=[]; let waiter=null, polls=0;
const io={poll(){polls++; return q.shift()||null;}, next(){ if(q.length) return Promise.resolve(q.shift()); return new Promise(r=>waiter=r); }};
const key=(c,sp=false)=>{ const k={c:typeof c==='string'?c.charCodeAt(0):c,sp}; if(waiter){const w=waiter;waiter=null;w(k);} else q.push(k); };
const it=new Interp(T,io,disk); it.patches={'UNS-MAN':{74:'GOTO 70',92:'F=0'},'UNS-GAME':{1570:'GOTO 1620'}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rows=(a,b)=>{ let o=[]; for(let r=a;r<=b;r++){ let s=''; for(let c=0;c<80;c++){ const x=T.ch[r*80+c]; s+=String.fromCharCode(x<32?32:x); } o.push(s.replace(/\s+$/,'')); } return o.join('\n'); };
(async()=>{
  // 1) pace: start a game and count KEYINs per second in the main loop
  it.start('UNS-MAN').catch(e=>console.log('ERR',e.message)); await sleep(800); key('1'); await sleep(9000);
  polls=0; const t0=Date.now(); await sleep(4000); console.log('KEYIN/s in game ~', Math.round(polls/((Date.now()-t0)/1000)));
  // 2) leaderboard: load the game with a high score and jump to routine 5000
  it.reset(); await sleep(50);
  it.runId++; it.load('UNS-MAN'); it.nums.clear(); it.strs.clear(); it.arrs.clear(); it.com.clear();
  it.start('UNS-MAN').catch(()=>{}); await sleep(300); // initializes COM
  it.reset(); await sleep(50);
  it.load('UNS-GAME'); it.arr('S0').data[0]=12345; it.arr('S0').data[1]=0; it.nums.set('P1',1);
  it.jump(5000); it.run().catch(e=>console.log('ERR run',e.message)); await sleep(500);
  console.log(rows(7,12));
  for(const ch of 'FAUSTO') key(ch); key(13); await sleep(1500);
  console.log('after the name, program:', it.prog.name);
  console.log('file on platter:', JSON.stringify(disk.readData('UNS-HOF')?.slice(0,2).map(s=>s.slice(0,40))));
  console.log('persisted:', Object.keys(store));
  await sleep(2500); console.log(rows(10,14));
  it.reset(); process.exit(0);
})();
