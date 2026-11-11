// Prova della Workstation (prompt BASIC-2): si digita come un utente e si legge lo schermo.
const {Workstation}=require('../src/shell.js'), {Platter,DiskSystem}=require('../src/platter.js'), {Terminal}=require('../src/wangcrt.js');
const disk=new DiskSystem({storage:null}); disk.mount('310',new Platter('SYSTEM')); disk.mount('320',new Platter('USER'));
const T=new Terminal(); const q=[]; let waiter=null;
const io={ next(){ if(q.length) return Promise.resolve(q.shift()); return new Promise(r=>waiter=r); }, poll(){ return q.shift()||null; },
           abort(){ if(waiter){ const w=waiter; waiter=null; w({c:-1,sp:true,abort:true}); } } };
const push=k=>{ if(waiter){ const w=waiter; waiter=null; w(k); } else q.push(k); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const type=async s=>{ for(const ch of s) push({c:ch.charCodeAt(0),sp:false}); push({c:13,sp:false}); await sleep(120); };
const screen=()=>{ const o=[]; for(let r=0;r<24;r++){ let s=''; for(let c=0;c<80;c++){ const b=T.ch[r*80+c]; s+=String.fromCharCode(b<32?32:b); } o.push(s.replace(/\s+$/,'')); } while(o.length&&!o[o.length-1]) o.pop(); return o.join('\n'); };
let fail=0; const expect=(name,cond)=>{ console.log((cond?'  ok  ':'FAIL  ')+name); if(!cond) fail++; };

(async()=>{
  const ws=new Workstation(T,io,disk); ws.interp.stmtCost=0; ws.interp.byteCost=0; ws.interp.breakCost=0;
  ws.main(); await sleep(100);
  await type('10 PRINT "HELLO"');
  await type('20 for i=1 to 3:print i;:next i');          // minuscole: il programma le normalizza
  await type('30 PRINT');
  await type('LIST'); await type('RUN');
  let s=screen(); expect('LIST mostra le righe', /0010 PRINT "HELLO"/.test(s) && /0020 FOR I=1 TO 3/.test(s));
  expect('RUN stampa HELLO e 1 2 3', /HELLO/.test(s) && /1  2  3/.test(s));
  await type('PRINT 2+3*4'); await type('A=7'); await type('PRINT A*A');
  s=screen(); expect('istruzione diretta PRINT 2+3*4 = 14', /\b14\b/.test(s)); expect('variabile diretta A*A = 49', /\b49\b/.test(s));
  await type('SAVE "T1"'); await type('NEW'); await type('LIST');
  s=screen(); expect('SAVE e NEW: LIST dice NO PROGRAM', /SAVED T1 ON DISK 310/.test(s) && /NO PROGRAM/.test(s));
  await type('LOAD "t1"'); await type('CATALOG');
  s=screen(); expect('LOAD ricarica 3 righe', /LOADED T1 \(3 LINES\)/.test(s)); expect('CATALOG elenca T1', /T1\s+PROG/.test(s));
  await type('10 PRINT "X"'); await type('20'); await type('LIST');
  s=screen(); expect('riga sostituita e cancellata', /0010 PRINT "X"/.test(s));
  await type('SELECT DISK 320'); await type('SAVE "B"'); await type('CATALOG 320');
  s=screen(); expect('SELECT DISK 320 + SAVE su 320', /SAVED B ON DISK 320/.test(s));
  await type('SCRATCH "T1"'); await type('CATALOG 310');
  s=screen(); expect('SCRATCH toglie T1', /SCRATCHED T1/.test(s) && /\(EMPTY\)/.test(s));
  // errori: sintassi e riga inesistente
  await type('40 PRINT ((('); s=screen(); expect('errore di sintassi in immissione', /ERROR: SYNTAX/.test(s));
  await type('NEW');
  // STOP / CONTINUE / HALT
  await type('10 FOR I=1 TO 3:PRINT I:NEXT I'); await type('20 STOP'); await type('30 PRINT "DOPO"'); await type('RUN');
  s=screen(); expect('STOP interrompe', /STOP AT LINE 0020/.test(s) && !/^DOPO$/m.test(s));
  await type('PRINT I'); s=screen(); expect('dopo STOP si leggono le variabili (I=4)', /\b4\b/.test(s));
  await type('CONTINUE'); s=screen(); expect('CONTINUE prosegue', /^DOPO$/m.test(s));
  await type('NEW'); await type('10 GOTO 10'); await type('RUN'); await sleep(200); ws.halt(); await sleep(200);
  s=screen(); expect('HALT interrompe un ciclo infinito', /HALT AT LINE 0010/.test(s));
  await type('NEW'); await type('10 A=1/0'); await type('RUN'); s=screen(); expect('divisione per zero: errore con la riga', /ERROR IN LINE 0010: DIVISION BY ZERO/.test(s));
  await type('NEW'); await type('10 PRINT B$(3)'); await type('RUN'); s=screen(); expect('array non dimensionato: errore', /ERROR IN LINE 0010: array non dimensionato/.test(s));
  console.log('\n--- schermo finale ---\n'+screen());
  console.log(fail?('\n'+fail+' PROVE FALLITE'):'\ntutte le prove superate'); process.exit(fail?1:0);
})();
