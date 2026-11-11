// Workstation (BASIC-2 prompt) test: type like a user and read the screen.
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
  await type('20 for i=1 to 3:print i;:next i');          // lowercase: the program normalizes it
  await type('30 PRINT');
  await type('LIST'); await type('RUN');
  let s=screen(); expect('LIST shows the lines', /0010 PRINT "HELLO"/.test(s) && /0020 FOR I=1 TO 3/.test(s));
  expect('RUN prints HELLO and 1 2 3', /HELLO/.test(s) && /1  2  3/.test(s));
  await type('PRINT 2+3*4'); await type('A=7'); await type('PRINT A*A');
  s=screen(); expect('direct statement PRINT 2+3*4 = 14', /\b14\b/.test(s)); expect('direct variable A*A = 49', /\b49\b/.test(s));
  await type('SAVE "T1"'); await type('NEW'); await type('LIST');
  s=screen(); expect('SAVE and NEW: LIST says NO PROGRAM', /SAVED T1 ON DISK 310/.test(s) && /NO PROGRAM/.test(s));
  await type('LOAD "t1"'); await type('CATALOG');
  s=screen(); expect('LOAD reloads 3 lines', /LOADED T1 \(3 LINES\)/.test(s)); expect('CATALOG lists T1', /T1\s+PROG/.test(s));
  await type('10 PRINT "X"'); await type('20'); await type('LIST');
  s=screen(); expect('line replaced and deleted', /0010 PRINT "X"/.test(s));
  await type('SELECT DISK 320'); await type('SAVE "B"'); await type('CATALOG 320');
  s=screen(); expect('SELECT DISK 320 + SAVE on 320', /SAVED B ON DISK 320/.test(s));
  await type('SCRATCH "T1"'); await type('CATALOG 310');
  s=screen(); expect('SCRATCH removes T1', /SCRATCHED T1/.test(s) && /\(EMPTY\)/.test(s));
  // errors: syntax and nonexistent line
  await type('40 PRINT ((('); s=screen(); expect('syntax error on entry', /ERROR: SYNTAX/.test(s));
  await type('NEW');
  // STOP / CONTINUE / HALT
  await type('10 FOR I=1 TO 3:PRINT I:NEXT I'); await type('20 STOP'); await type('30 PRINT "AFTER"'); await type('RUN');
  s=screen(); expect('STOP interrupts', /STOP AT LINE 0020/.test(s) && !/^AFTER$/m.test(s));
  await type('PRINT I'); s=screen(); expect('after STOP the variables can be read (I=4)', /\b4\b/.test(s));
  await type('CONTINUE'); s=screen(); expect('CONTINUE resumes', /^AFTER$/m.test(s));
  await type('NEW'); await type('10 GOTO 10'); await type('RUN'); await sleep(200); ws.halt(); await sleep(200);
  s=screen(); expect('HALT interrupts an infinite loop', /HALT AT LINE 0010/.test(s));
  await type('NEW'); await type('10 A=1/0'); await type('RUN'); s=screen(); expect('division by zero: error with the line', /ERROR IN LINE 0010: DIVISION BY ZERO/.test(s));
  await type('NEW'); await type('10 PRINT B$(3)'); await type('RUN'); s=screen(); expect('array not dimensioned: error', /ERROR IN LINE 0010: array not dimensioned/.test(s));
  console.log('\n--- final screen ---\n'+screen());
  console.log(fail?('\n'+fail+' TESTS FAILED'):'\nall tests passed'); process.exit(fail?1:0);
})();
