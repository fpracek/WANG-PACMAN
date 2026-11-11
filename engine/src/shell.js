/* ================= Workstation: il "prompt" BASIC-2 sopra Interp =================
   Gestisce lo schermo come un 2200: si digitano righe numerate (programma in memoria) o comandi/istruzioni dirette.
   Comandi:  LIST [a[,b]]  RUN [n]  CONTINUE  NEW  CLEAR [P]  LOAD [RUN] [T]"nome"  SAVE [T]"nome"
             SCRATCH [T]"nome"  CATALOG [unità]  SELECT DISK unità  DELETE a[,b]  HELP
   Qualunque altra cosa è un'istruzione diretta: PRINT 2+3*4,  A=5,  FOR I=1 TO 3:PRINT I:NEXT I ...
   Dipendenze: Interp (basic2.js), un DiskSystem (platter.js), un CRT (wangcrt.js), una tastiera {next()} con codici
   dei cursori su/giù = 0x46/0x45 (sp:true) per la cronologia. */
const _B = (typeof module!=='undefined') ? require('./basic2.js') : {Interp, Parser};
class Workstation {
  constructor(term, io, disk, opts={}){
    this.T=term; this.io=io; this.disk=disk;
    this.interp=new _B.Interp(term,io,disk); this.interp.reportErrors=false; this.interp.returnErrors=true;
    this.lines=new Map();            // numero riga -> testo sorgente (istruzioni)
    this.history=[]; this.running=false; this.dirty=true;
    this.title=opts.title||'WANG BASIC-2  (BASIC2-JS)';
    this.onChange=opts.onChange||(()=>{});     // notifica la UI (programma / dischi cambiati)
  }
  /* ---------- schermo ---------- */
  out(s){ this.T.print(s); }
  nl(){ if(this.T.cx>0) this.out('\r\n'); }
  say(s){ this.nl(); this.out(s+'\r\n'); }
  err(s){ this.say('ERROR: '+s); }
  resetModes(){ this.T.hex('0202000F020400000F05'); }     // set normale, attributi spenti, cursore acceso
  /* ---------- vita ---------- */
  async main(){
    this.T.clear(); this.resetModes();
    this.T.hex('020402000F'); this.out(this.title+'\r\n'); this.T.hex('020400000F');
    this.out('Type HELP for commands.\r\nREADY\r\n');
    for(;;){
      this.resetModes();
      const line=await this.readLine();
      try{ await this.process(line); }catch(e){ this.err(e.message||String(e)); }
    }
  }
  halt(){ if(this.running) this.interp.halt(); }
  async readLine(){
    let s='', hi=this.history.length;
    const show=t=>{ for(let i=0;i<s.length;i++){ this.T.out(8); this.T.out(32); this.T.out(8); } s=t; this.out(s); };
    for(;;){
      const k=await this.io.next();
      if(k.abort) continue;
      if(k.sp){
        if(k.c===0x46 && hi>0){ hi--; show(this.history[hi]); }
        else if(k.c===0x45){ if(hi<this.history.length-1){ hi++; show(this.history[hi]); } else { hi=this.history.length; show(''); } }
        continue;
      }
      if(k.c===13){ this.out('\r\n'); break; }
      if(k.c===8){ if(s.length){ s=s.slice(0,-1); this.T.out(8); this.T.out(32); this.T.out(8); } continue; }
      if(k.c>=32 && s.length<400){ s+=String.fromCharCode(k.c); this.T.out(k.c); }
    }
    return s;
  }
  /* maiuscole fuori dalle virgolette (il parser è sensibile alle maiuscole) */
  upper(t){ let q=false, o=''; for(const c of t){ if(c==='"') q=!q; o+= q ? c : c.toUpperCase(); } return o; }
  entries(){ return [...this.lines.keys()].sort((a,b)=>a-b).map(no=>({no, src:this.lines.get(no)})); }
  changed(){ this.dirty=true; this.interp.canContinue=false; this.onChange(); }
  fileName(s){ return s.toUpperCase(); }
  /* ---------- elaborazione di una riga ---------- */
  async process(raw){
    const text=raw.trim(); if(!text) return;
    if(this.history[this.history.length-1]!==raw) this.history.push(raw);
    const up=this.upper(text);
    let m=/^(\d+)\s*(.*)$/.exec(up);
    if(m) return this.editLine(+m[1], m[2]);
    const kw=(/^[A-Z]+/.exec(up)||[''])[0];
    switch(kw){
      case 'LIST':    return this.cmdList(up);
      case 'RUN':     return this.cmdRun(up);
      case 'CONTINUE': case 'CONT': return this.cmdCont();
      case 'NEW':     this.lines.clear(); this.interp.clearVars(); this.changed(); return;
      case 'CLEAR':   if(/^CLEAR\s*P/.test(up)){ this.lines.clear(); this.changed(); } else this.interp.clearVars(); return;
      case 'LOAD':    return this.cmdLoad(up);
      case 'SAVE':    return this.cmdSave(up);
      case 'SCRATCH': return this.cmdScratch(up);
      case 'CATALOG': case 'CAT': case 'DIR': return this.cmdCatalog(up);
      case 'DELETE':  return this.cmdDelete(up);
      case 'HELP':    return this.cmdHelp();
      case 'RENUMBER': return this.err('RENUMBER not implemented yet');
      case 'SELECT':  if(/^SELECT\s+DISK/.test(up)) return this.cmdSelect(up); // altrimenti è un'istruzione SELECT
    }
    return this.direct(up);
  }
  editLine(no,rest){
    if(!rest){ if(this.lines.delete(no)) this.changed(); return; }
    try{ new _B.Parser(rest).parseLine(); }catch(e){ this.err('SYNTAX '+e.message.split(' @')[0]); return; }
    this.lines.set(no,rest); this.changed();
  }
  cmdList(up){
    const m=/^LIST\s*(\d+)?\s*[,-]?\s*(\d+)?/.exec(up); const a=m&&m[1]!==undefined?+m[1]:-Infinity, b=m&&m[2]!==undefined?+m[2]:(m&&m[1]!==undefined&&!/[,-]/.test(up)?+m[1]:Infinity);
    let n=0; for(const e of this.entries()) if(e.no>=a && e.no<=b){ this.out(String(e.no).padStart(4,'0')+' '+e.src+'\r\n'); n++; }
    if(!n) this.say('NO PROGRAM');
  }
  buildForRun(){
    try{ this.interp.setProgram(this.entries()); this.dirty=false; return true; }
    catch(e){ this.say('ERROR IN LINE '+(e.line??'?')+': '+(e.message||'').replace(/^.*riga \d+: /,'')); return false; }
  }
  report(res){
    switch(res.status){
      case 'end': this.nl(); break;
      case 'stop': this.say('STOP AT LINE '+String(res.line??0).padStart(4,'0')); break;
      case 'halt': this.say('HALT AT LINE '+String(res.line??0).padStart(4,'0')); break;
      case 'error': this.say('ERROR IN LINE '+(res.line==null||res.line<0?'(DIRECT)':String(res.line).padStart(4,'0'))+': '+res.msg); break;
    }
    this.onChange();
  }
  async cmdRun(up){
    const m=/^RUN\s*(\d+)?/.exec(up);
    if(!this.lines.size){ this.say('NO PROGRAM'); return; }
    if(!this.buildForRun()) return;
    if(m&&m[1]!==undefined && !this.interp.prog.lineMap.has(+m[1])){ this.err('NO SUCH LINE '+m[1]); return; }
    this.running=true; let res;
    try{ res=await this.interp.runFrom(m&&m[1]!==undefined?+m[1]:null); } finally { this.running=false; }
    this.report(res);
  }
  async cmdCont(){
    if(!this.interp.canContinue){ this.err("CAN'T CONTINUE"); return; }
    this.running=true; let res;
    try{ res=await this.interp.continueRun(); } finally { this.running=false; }
    this.report(res);
  }
  async direct(up){
    if(this.dirty && !this.buildForRun()){ try{ this.interp.setProgram([]); }catch(e){} }
    this.running=true; let res;
    try{ res=await this.interp.execDirect(up); }
    catch(e){ this.running=false; this.err('SYNTAX '+String(e.message||e).split(' @')[0]); return; }
    finally { this.running=false; }
    this.report(res);
  }
  /* ---------- per la UI: testo del programma e iniezione di comandi ---------- */
  getProgramText(){ return this.entries().map(e=>String(e.no).padStart(4,'0')+' '+e.src).join('\n')+(this.lines.size?'\n':''); }
  /* sostituisce il programma con un testo "NNN istruzioni"; restituisce l'elenco degli errori (programma invariato se ce ne sono) */
  setProgramText(text){
    const errs=[], map=new Map();
    text.split(/\r?\n/).forEach((raw,i)=>{
      const t=raw.trim(); if(!t) return;
      const m=/^(\d+)\s*(.*)$/.exec(this.upper(t)); if(!m){ errs.push('riga '+(i+1)+': manca il numero di riga'); return; }
      if(!m[2]) return;
      try{ new _B.Parser(m[2]).parseLine(); }catch(e){ errs.push('riga '+(i+1)+' ('+m[1]+'): '+String(e.message).split(' @')[0]); return; }
      map.set(+m[1],m[2]);
    });
    if(!errs.length){ this.lines=map; this.changed(); }
    return errs;
  }
  /* ---------- dischi ---------- */
  nameArg(up){ const m=/"([^"]*)"/.exec(up); return m ? this.fileName(m[1]) : null; }
  cmdLoad(up){
    const name=this.nameArg(up); if(!name){ this.err('FILE NAME REQUIRED'); return; }
    const src=this.disk.readProgram(name); if(!src){ this.err('FILE NOT FOUND: '+name); return; }
    this.lines.clear(); for(const e of _B.Interp.parseListing(src.text)) this.lines.set(e.no,e.src);
    this.interp.clearVars(); this.changed(); this.say('LOADED '+name+' ('+this.lines.size+' LINES)');
    if(/^LOAD\s+RUN/.test(up)) return this.cmdRun('RUN');
  }
  cmdSave(up){
    const name=this.nameArg(up); if(!name){ this.err('FILE NAME REQUIRED'); return; }
    if(!this.lines.size){ this.err('NO PROGRAM'); return; }
    this.disk.writeProgram(name, _B.Interp.toListing(this.entries())); this.onChange(); this.say('SAVED '+name+' ON DISK '+this.disk.find(name).addr);
  }
  cmdScratch(up){
    const name=this.nameArg(up); if(!name){ this.err('FILE NAME REQUIRED'); return; }
    if(this.disk.remove(name)){ this.onChange(); this.say('SCRATCHED '+name); } else this.err('FILE NOT FOUND: '+name);
  }
  cmdSelect(up){
    const m=/(\d+)/.exec(up.replace(/^SELECT\s+DISK/,'')); const addr=m?m[1]:null;
    if(!addr){ this.say('CURRENT DISK '+this.disk.current); return; }
    try{ this.disk.select(addr); this.onChange(); this.say('DISK '+addr+' SELECTED'); }catch(e){ this.err(e.message); }
  }
  cmdCatalog(up){
    const m=/(\d+)/.exec(up); const addr=m?m[1]:this.disk.current; const p=this.disk.drives.get(addr);
    if(!p){ this.err('NO DISK AT '+addr); return; }
    this.say('DISK '+addr+'  '+p.label+(addr===this.disk.current?'  (CURRENT)':''));
    const l=p.list().sort((a,b)=>a.name<b.name?-1:1);
    if(!l.length) this.out('  (EMPTY)\r\n');
    for(const f of l) this.out('  '+f.name.padEnd(12)+(f.kind==='program'?'PROG  ':'DATA  ')+String(f.size).padStart(6)+(f.kind==='program'?' CHARS':' RECS')+'\r\n');
  }
  cmdDelete(up){
    const m=/^DELETE\s*(\d+)\s*[,-]?\s*(\d+)?/.exec(up); if(!m){ this.err('DELETE a[,b]'); return; }
    const a=+m[1], b=m[2]!==undefined?+m[2]:a; let n=0; for(const no of [...this.lines.keys()]) if(no>=a&&no<=b){ this.lines.delete(no); n++; }
    this.changed(); this.say(n+' LINE(S) DELETED');
  }
  cmdHelp(){
    this.say('PROGRAM:  10 PRINT "HI"   (number+text = enter line, number alone = delete)');
    this.out('LIST [a[,b]]   RUN [n]   CONTINUE   DELETE a[,b]   NEW   CLEAR [P]\r\n');
    this.out('LOAD [RUN] "name"   SAVE "name"   SCRATCH "name"\r\n');
    this.out('CATALOG [disk]   SELECT DISK 310\r\n');
    this.out('Anything else runs immediately: PRINT 2+3*4   A=5   PRINT A\r\n');
    this.out('Up/Down arrows = command history.   Esc = HALT a running program.\r\n');
  }
}
if(typeof module!=='undefined') module.exports={Workstation};
