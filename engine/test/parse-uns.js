// Compila i listati originali di UNS-MAN e UNS-GAME: verifica che il parser accetti ogni riga.
const fs=require('fs'), path=require('path');
const {Interp}=require('../src/basic2.js'), {Platter,DiskSystem}=require('../src/platter.js');
const src=process.argv[2]||process.env.LISTINGS||path.join(__dirname,'..','..','listings');
const disk=new DiskSystem({storage:null}); const p=new Platter('PACMAN'); disk.mount('310',p);
for(const n of ['UNS-MAN','UNS-GAME']) p.addProgram(n, fs.readFileSync(path.join(src,n+'.txt'),'latin1'));
const it=new Interp({}, {}, disk);
it.patches={'UNS-MAN':{74:'GOTO 70',92:'F=0'},'UNS-GAME':{1570:'GOTO 1620'}};
let bad=0;
for(const n of ['UNS-MAN','UNS-GAME']){
  try{ const pr=it.compile(n); console.log(n,'OK',pr.lines.length,'righe,',pr.data.length,'dati,',pr.deffn.size,'DEFFN'); }
  catch(e){ console.log(n,'ERRORE:',e.message); bad++; }
}
process.exit(bad?1:0);
