const fs=require('fs'), path=require('path');
const {Interp}=require('../src/basic2.js'), {Platter,DiskSystem}=require('../src/platter.js'), {Terminal}=require('../src/wangcrt.js');
const src=process.env.LISTINGS||path.join(__dirname,'..','..','listings');
const disk=new DiskSystem({storage:null}); const p=new Platter('P'); disk.mount('310',p);
for(const n of ['UNS-MAN','UNS-GAME']) p.addProgram(n, fs.readFileSync(path.join(src,n+'.txt'),'latin1'));
const T=new Terminal(); const q=[]; let waiter=null;
const io={poll(){return q.shift()||null;}, next(){ return new Promise(r=>waiter=r); }};
const it=new Interp(T,io,disk); it.patches={'UNS-MAN':{74:'GOTO 70',92:'F=0'},'UNS-GAME':{1570:'GOTO 1620'}};
it.stmtCost=0; it.byteCost=0; it.breakCost=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  it.start('UNS-MAN').catch(e=>console.log('ERR',e.message));
  await sleep(800); q.push({c:49,sp:false});
  for(let k=0;k<6;k++){ await sleep(400); const L=it.prog.lines[it.li]; console.log(it.prog.name,'line',L&&L.no,'si',it.si,'cnt?'); }
  it.reset(); process.exit(0);
})();
