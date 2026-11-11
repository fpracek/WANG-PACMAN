// Compiles the original UNS-MAN and UNS-GAME listings: checks that the parser accepts every line.
const fs=require('fs'), path=require('path');
const {Interp}=require('../src/basic2.js'), {Platter,DiskSystem}=require('../src/platter.js');
const src=process.argv[2]||process.env.LISTINGS||path.join(__dirname,'..','..','listings');
const disk=new DiskSystem({storage:null}); const p=new Platter('PACMAN'); disk.mount('310',p);
for(const n of ['UNS-MAN','UNS-GAME']) p.addProgram(n, fs.readFileSync(path.join(src,n+'.txt'),'latin1'));
const it=new Interp({}, {}, disk);
it.patches={'UNS-MAN':{74:'GOTO 70',92:'F=0'},'UNS-GAME':{1570:'GOTO 1620'}};
let bad=0;
for(const n of ['UNS-MAN','UNS-GAME']){
  try{ const pr=it.compile(n); console.log(n,'OK',pr.lines.length,'lines,',pr.data.length,'data items,',pr.deffn.size,'DEFFN'); }
  catch(e){ console.log(n,'ERROR:',e.message); bad++; }
}
process.exit(bad?1:0);
