const fs=require('fs'), path=require('path');
const {Interp}=require('../src/basic2.js'), {Platter,DiskSystem}=require('../src/platter.js'), {Terminal}=require('../src/wangcrt.js');
const src=process.env.LISTINGS||path.join(__dirname,'..','..','listings');
const disk=new DiskSystem({storage:null}); const p=new Platter('P'); disk.mount('310',p);
for(const n of ['UNS-MAN','UNS-GAME']) p.addProgram(n, fs.readFileSync(path.join(src,n+'.txt'),'latin1'));
const T=new Terminal(); const q=[]; const io={poll(){return q.shift()||null;}, next(){return new Promise(()=>{});}};
const it=new Interp(T,io,disk); it.patches={'UNS-MAN':{74:'GOTO 70',92:'F=0'},'UNS-GAME':{1570:'GOTO 1620'}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const first=()=>{ for(let r=0;r<24;r++){ let s=''; for(let c=0;c<80;c++){ const x=T.ch[r*80+c]; s+=String.fromCharCode(x<32?32:x);} if(s.trim()) return r+': '+s.trim().slice(0,60); } return '(vuoto)'; };
(async()=>{
  it.start('UNS-MAN').catch(e=>console.log('ERR',e.message));
  for(const delay of [1200, 3500, 5000]){
    await sleep(delay); q.push({c:55,sp:false});
    const trace=[]; for(let k=0;k<12;k++){ await sleep(200); trace.push(it.prog.lines[it.li]?.no); }
    console.log('dopo "7" a',delay,'ms -> righe:',[...new Set(trace)].join(','),'| prima riga schermo:',first());
  }
  it.reset(); process.exit(0);
})();
