// Compatibility patches by program name, in the workstation and in chained LOADs. Synthetic programs only.
const {Workstation}=require('../src/shell.js'), {Platter,DiskSystem}=require('../src/platter.js'), {Terminal}=require('../src/wangcrt.js');
const {programNameFromFile}=require('../src/compat.js');
const disk=new DiskSystem({storage:null}); disk.mount('310',new Platter('SYSTEM')); disk.mount('320',new Platter('USER'));
const T=new Terminal(); const q=[]; let waiter=null;
const io={ next(){ if(q.length) return Promise.resolve(q.shift()); return new Promise(r=>waiter=r); }, poll(){ return q.shift()||null; }, abort(){} };
const push=k=>{ if(waiter){ const w=waiter; waiter=null; w(k); } else q.push(k); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const type=async s=>{ for(const ch of s) push({c:ch.charCodeAt(0),sp:false}); push({c:13,sp:false}); await sleep(150); };
const screen=()=>{ const o=[]; for(let r=0;r<24;r++){ let s=''; for(let c=0;c<80;c++){ const b=T.ch[r*80+c]; s+=String.fromCharCode(b<32?32:b); } o.push(s.replace(/\s+$/,'')); } return o.join('\n'); };
let fail=0; const expect=(name,cond)=>{ console.log((cond?'  ok  ':'FAIL  ')+name); if(!cond) fail++; };

expect('file name -> program name', programNameFromFile('UNS-MAN_listd.txt')==='UNS-MAN' && programNameFromFile('uns-game (2).txt')==='UNS-GAME' && programNameFromFile('Demo.bas')==='DEMO' && programNameFromFile('UNS-MAN.list.txt')==='UNS-MAN');

(async()=>{
  const p=disk.drives.get('320');
  p.putProgram('UNS-MAN','10 PRINT "MAN"\n20 LOAD T"UNS-GAME"\n');
  p.putProgram('UNS-GAME','10 GOTO 1570\n1570 PRINT "GAMERAW":END\n1620 PRINT "GAMEFIXED":END\n');
  p.putProgram('OTHER','10 GOTO 74\n70 PRINT "FIXED":END\n74 PRINT "RAW":END\n');
  const ws=new Workstation(T,io,disk); ws.interp.stmtCost=0; ws.interp.byteCost=0; ws.interp.breakCost=0;
  ws.main(); await sleep(100);
  await type('SELECT DISK 320');
  await type('LOAD "OTHER"'); await type('RUN');
  expect('an unknown program runs unpatched', /RAW/.test(screen()) && !/FIXED/.test(screen()) && !/ERROR/.test(screen()));
  await type('NEW'); await type('LOAD "UNS-GAME"'); await type('RUN');
  let s=screen(); expect('UNS-GAME line 1570 is patched when loaded in the workstation', /GAMEFIXED/.test(s) && !/GAMERAW/.test(s) && !/ERROR/.test(s));
  await type('NEW'); await type('CLEAR'); await type('10 GOTO 1570'); await type('1570 PRINT "NEWPROG":END'); await type('RUN');
  expect('after NEW the program name is forgotten (no patch)', /NEWPROG/.test(screen()) && ws.programName===null);
  await type('NEW'); await type('LOAD "UNS-MAN"'); await type('RUN');
  s=screen(); expect('a chained LOAD T picks up the patches of the next program too', /GAMEFIXED/.test(s) && !/GAMERAW/.test(s) && !/ERROR/.test(s));
  console.log(fail?'\n'+fail+' TESTS FAILED':'\nall tests passed'); process.exit(fail?1:0);
})();
