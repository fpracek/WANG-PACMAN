// GUESS: LINPUT input inside a running program (keystrokes must not be lost)
const {Workstation}=require('../src/shell.js'), {Platter,DiskSystem}=require('../src/platter.js'), {Terminal}=require('../src/wangcrt.js');
const disk=new DiskSystem({storage:null}); const p=disk.mount('310',new Platter('S'));
p.addProgram('GUESS',['0010 N=42:T=0','0020 PRINT "YOUR GUESS? ";:LINPUT G$:CONVERT G$ TO G:T=T+1','0030 IF G=N THEN 60','0040 IF G<N THEN PRINT "TOO LOW": ELSE PRINT "TOO HIGH"','0050 GOTO 20','0060 PRINT "RIGHT IN";T;"TRIES"'].join('\n')+'\n');
const T=new Terminal(); const q=[]; let waiter=null;
const io={ next(){ if(q.length) return Promise.resolve(q.shift()); return new Promise(r=>waiter=r); }, poll(){ return q.shift()||null; },
           abort(){ if(waiter){ const w=waiter; waiter=null; w({c:-1,sp:true,abort:true}); } } };
const push=k=>{ if(waiter){ const w=waiter; waiter=null; w(k); } else q.push(k); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const type=async s=>{ for(const ch of s) push({c:ch.charCodeAt(0),sp:false}); push({c:13,sp:false}); await sleep(150); };
const screen=()=>{ const o=[]; for(let r=0;r<24;r++){ let s=''; for(let c=0;c<80;c++){ const b=T.ch[r*80+c]; s+=String.fromCharCode(b<32?32:b); } if(s.trim()) o.push(s.replace(/\s+$/,'')); } return o.join('\n'); };
(async()=>{
  const ws=new Workstation(T,io,disk); ws.interp.stmtCost=0; ws.interp.byteCost=0; ws.main(); await sleep(100);
  await type('LOAD "GUESS"'); await type('RUN');
  await type('50'); await type('30'); await type('42');
  const s=screen(); console.log(s.split('\n').slice(-8).join('\n'));
  const ok=/YOUR GUESS\? 50/.test(s)&&/TOO HIGH/.test(s)&&/YOUR GUESS\? 30/.test(s)&&/TOO LOW/.test(s)&&/RIGHT IN 3  TRIES/.test(s.replace(/\s+/g,' ').replace('RIGHT IN 3 TRIES','RIGHT IN 3  TRIES'));
  console.log(ok?'ok':'FAIL'); process.exit(ok?0:1);
})();
