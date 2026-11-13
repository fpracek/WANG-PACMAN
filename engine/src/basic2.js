/* ================= BASIC2-JS: Wang BASIC-2 interpreter (subset, growing) =================
   Core semantics of the dialect:
   - IF..THEN governs ONE statement only (or a line number); statements after the colon always run.
     ": ELSE ..." belongs to the preceding IF.
   - KEYIN K$,l1,l2 does not block; with no key K$ is left unchanged; normal key -> l1, special key (arrows) -> l2.
     KEYIN K$ (without line numbers) waits for a key instead.
   - Strings have fixed length (padded with spaces); STR(v,a,n) works both as a value and as a destination.
   - Time is "virtual": every statement and every byte sent to the terminal costs a few microseconds,
     and execution is slowed down accordingly (the game's pace depended only on the speed of the 2200). */
const _DL = (typeof module !== 'undefined') ? require('./dialects.js') : { DEFAULT_DIALECT, getDialect };
class BasicError extends Error {}
class AllFill { constructor(b){ this.b=b; } }
/* control outcomes: not errors, they make run() finish with a status */
class ProgramEnd { constructor(direct){ this.direct=!!direct; } }
class ProgramStop { constructor(line){ this.line=line; } }
class ProgramHalt { constructor(){} }

const STMT_KW = ['PRINTUSING','PRINT','KEYIN','LINPUT','INPUT','LET','GOSUB','GOTO','RESTORE','RETURN','CONVERT','DBACKSPACE',
  'LIMITS','SELECT','DEFFN','DIM','COM','MAT','READ','DATA','FOR','NEXT','IF','ON','STOP','LOAD','REM',
  '$GIO/005(A000)','$BREAK','$TRAN'];
const NUMFN = ['INT','MOD','MIN','MAX','ABS','RND','SGN','LEN','SQR','EXP','LOG','SIN','COS','TAN','ATN'];

class Parser {
  constructor(src, dialect){ this.s=src; this.i=0; this.d=dialect||_DL.DEFAULT_DIALECT; }
  need(feature, what){ if(!this.d.features[feature]) this.err(what+' is not available in '+this.d.name); }
  ws(){ while(this.s.charCodeAt(this.i)===32) this.i++; }
  eof(){ this.ws(); return this.i>=this.s.length; }
  peek(w){ this.ws(); return this.s.startsWith(w,this.i); }
  eat(w){ if(this.peek(w)){ this.i+=w.length; return true; } return false; }
  expect(w){ if(!this.eat(w)) this.err('expected "'+w+'"'); }
  err(m){ throw new BasicError(m+' @'+this.i+' in: '+this.s.slice(0,120)); }

  /* ---------- statements ---------- */
  parseLine(){
    const out=[];
    for(;;){
      this.ws(); if(this.i>=this.s.length) break;
      if(this.s[this.i]===':'){ this.i++; continue; }
      const from=this.i; const st=this.parseStatement(); if(st) out.push(st);
      if(this.i<=from) this.err('statement not understood');
      this.ws();
      if(this.i<this.s.length && this.s[this.i]!==':') this.err('unexpected statement');
    }
    return out;
  }
  parseStatement(){
    this.ws(); const s=this.s;
    if(s[this.i]==='%'){ this.i=s.length; return null; }
    if(this.d.features.remDollarPc && s.startsWith('REM $PC',this.i)){ this.i+=7; this.ws(); return this.i<s.length ? this.parseStatement() : null; }
    for(const kw of STMT_KW) if(s.startsWith(kw,this.i)) return this.stmt(kw);
    return this.assign();
  }
  stmt(kw){
    const s=this.s; this.i+=kw.length;
    switch(kw){
      case 'REM': this.i=s.length; return null;
      case 'PRINT': return this.print();
      case 'PRINTUSING': { const f=this.expr(); this.expect(','); const e=this.expr(); let nl=true; if(this.eat(';')) nl=false;
        return {t:'using', f, e, nl}; }
      case 'IF': { const c=this.expr(); this.expect('THEN'); const th=this.thenPart(); let el=null;
        const save=this.i; this.ws();
        if(s[this.i]===':'){ let j=this.i+1; while(s[j]===' ') j++; if(s.startsWith('ELSE',j)){ this.need('else','ELSE'); this.i=j+4; el=this.thenPart(); } else this.i=save; }
        else if(s.startsWith('ELSE',this.i)){ this.need('else','ELSE'); this.i+=4; el=this.thenPart(); }
        return {t:'if', c, th, el}; }
      case 'FOR': { const v=this.varName(); this.expect('='); const a=this.expr(); this.expect('TO'); const b=this.expr();
        let st=null; if(this.eat('STEP')) st=this.expr(); return {t:'for', v, a, b, st}; }
      case 'NEXT': { this.ws(); let v=null; if(/[A-Z]/.test(s[this.i]||'')) v=this.varName(); return {t:'next', v}; }
      case 'GOTO': return {t:'goto', n:this.lineNo()};
      case 'GOSUB': { this.ws(); if(s[this.i]==="'"){ this.i++; const n=this.lineNo(); const args=[];
          if(this.eat('(')){ if(!this.eat(')')){ do{ args.push(this.expr()); } while(this.eat(',')); this.expect(')'); } }
          return {t:'gosubfn', n, args}; }
        return {t:'gosub', n:this.lineNo()}; }
      case 'RETURN': { let k='one'; if(this.eat('CLEAR')){ k = this.eat('ALL') ? 'all' : 'clear'; } return {t:'return', k}; }
      case 'RESTORE': { let n=null, k=null; if(this.eat('LINE')){ n=this.lineNo(); if(this.eat(',')) k=this.expr(); } return {t:'restore', n, k}; }
      case 'READ': { const lv=[]; do{ lv.push(this.lvalue()); } while(this.eat(',')); return {t:'read', lv}; }
      case 'DATA': return this.dataStmt();
      case 'MAT': return this.mat();
      case 'CONVERT': { const e=this.expr(); this.expect('TO'); const lv=this.lvalue(); let pic=null;
        if(this.eat(',')){ this.expect('('); const j=s.indexOf(')',this.i); pic=s.slice(this.i,j); this.i=j+1; }
        return {t:'convert', e, lv, pic}; }
      case 'KEYIN': { const lv=this.lvalue(); let l1=null,l2=null; if(this.eat(',')){ l1=this.lineNo(); if(this.eat(',')) l2=this.lineNo(); }
        return {t:'keyin', lv, l1, l2}; }
      case 'LET': return this.assign();
      case 'INPUT': { this.ws(); let prompt=null; if(s[this.i]==='"'){ prompt=this.expr(); this.ws(); if(s[this.i]===';'||s[this.i]===',') this.i++; }
        const lv=[]; do{ lv.push(this.lvalue()); } while(this.eat(',')); return {t:'input', prompt, lv}; }
      case 'LINPUT': { this.need('linput','LINPUT'); this.ws(); while(s[this.i]==='-'||s[this.i]==='?') this.i++; return {t:'linput', lv:this.lvalue()}; }
      case 'DIM': case 'COM': return {t:'dim', com:kw==='COM', decl:this.decls()};
      case 'ON': { const e=this.expr(); const kind=this.eat('GOTO')?'goto':(this.expect('GOSUB'),'gosub'); const list=[];
        for(;;){ this.ws(); if(/\d/.test(s[this.i]||'')) list.push(this.lineNo()); else list.push(null);
          if(!this.eat(',')) break; }
        return {t:'on', e, kind, list}; }
      case 'STOP': { this.ws(); if(s[this.i]==='"') this.i=s.indexOf('"',this.i+1)+1; return {t:'stop'}; }
      case 'LOAD': { this.ws(); if(s.startsWith('RUN',this.i)){ this.i+=3; return {t:'loadrun'}; }
        if(s[this.i]==='T') this.i++; this.ws(); if(s[this.i]!=='"') this.err('file name expected'); const j=s.indexOf('"',this.i+1); const name=s.slice(this.i+1,j); this.i=j+1; return {t:'load', name}; }
      case 'SELECT': { this.ws(); const rest=s.slice(this.i);
        const m2=/^(PRINT|LIST|CO|INPUT|CI)\s*\/?(\d{3})/.exec(rest) || /^(P)\s+\/?(\d{3})/.exec(rest);
        if(m2){ this.i+=m2[0].length; while(this.i<s.length && s[this.i]!==':') this.i++; return {t:'select', kind:(m2[1]==='P'?'PRINT':m2[1]), addr:m2[2]}; }
        const m=/^P(\d?)/.exec(rest); let dev='P'; if(m) dev='P'+m[1];
        while(this.i<s.length && s[this.i]!==':') this.i++; return {t:'select', dev}; }
      case 'DEFFN': { this.ws(); if(s[this.i]==="'"){ this.i++; const n=this.lineNo(); const params=[];
          this.ws();
          if(s[this.i]==='('){ this.i++; do{ params.push(this.varName()); } while(this.eat(',')); this.expect(')'); }
          else this.i=s.length;                         // DEFFN'31"..." : function key, ignored
          return {t:'deffn', n, params}; } this.i=s.length; return null; }
      case 'LIMITS': { this.ws(); if(s[this.i]==='T') this.i++; this.ws(); const j=s.indexOf('"',this.i+1); const name=s.slice(this.i+1,j); this.i=j+1;
        const lv=[]; while(this.eat(',')) lv.push(this.lvalue()); return {t:'limits', name, lv}; }
      case 'DBACKSPACE': { while(this.i<s.length && s[this.i]!==':') this.i++; return {t:'nop'}; }
      case '$GIO/005(A000)': return {t:'gio', e:this.expr()};
      case '$BREAK': { while(/\d/.test(s[this.i]||'')) this.i++; return {t:'break'}; }
      case '$TRAN': { this.expect('('); const lv=this.lvalue(); this.expect(','); const tb=this.expr(); this.expect(')'); this.eat('R'); return {t:'tran', lv, tb}; }
    }
    this.err('unknown statement '+kw);
  }
  thenPart(){ this.ws(); if(/\d/.test(this.s[this.i]||'')) return {t:'goto', n:this.lineNo()}; return this.parseStatement(); }
  lineNo(){ this.ws(); const m=/^\d+/.exec(this.s.slice(this.i)); if(!m) this.err('line number expected'); this.i+=m[0].length; return +m[0]; }
  print(){
    const items=[]; let nl=true; const s=this.s;
    for(;;){
      this.ws(); if(this.i>=s.length || s[this.i]===':' || s.startsWith('ELSE',this.i)) break;
      if(s[this.i]===';'||s[this.i]===','){ this.i++; nl=false; continue; }     // tolerate an empty item (";;")
      nl=true;
      if(this.eat('AT(')){ this.need('printAt','AT('); const a=[this.expr()]; while(this.eat(',')) a.push(this.expr()); this.expect(')'); items.push({k:'at', a}); }
      else if(this.eat('TAB(')){ const a=this.expr(); this.expect(')'); items.push({k:'tab', a}); }
      else if(this.eat('BOX(')){ this.need('printBox','BOX('); const a=this.expr(); this.expect(','); const b=this.expr(); this.expect(')'); items.push({k:'box', a, b}); }
      else items.push({k:'e', e:this.expr()});
      this.ws();
      if(s[this.i]===';'||s[this.i]===','){ this.i++; nl=false; } else break;
    }
    return {t:'print', items, nl};
  }
  dataStmt(){
    const s=this.s; this.ws();
    if(s.startsWith('LOAD',this.i)||s.startsWith('SAVE',this.i)){
      let j=this.i; while(j<s.length && s[j]!==':') j++;
      const txt=s.slice(this.i,j); this.i=j;
      const load=txt.startsWith('LOAD'); const m=/"([^"]*)"/.exec(txt);
      if(m) return {t:'dc', op:'open', name:m[1]};
      if(/H\$\(\)/.test(txt)) return {t:'dc', op:load?'load':'save'};
      return {t:'dc', op:'nop'};
    }
    const items=[]; const rest=s.slice(this.i); this.i=s.length;
    const re=/\s*(?:"([^"]*)"|(-?[0-9.]+))\s*(?:,|$)/y; let m; re.lastIndex=0;
    while(re.lastIndex<rest.length && (m=re.exec(rest))){ items.push(m[1]!==undefined ? m[1] : parseFloat(m[2])); }
    return {t:'data', items};
  }
  mat(){
    this.ws();
    if(this.eat('READ')){ return {t:'matread', name:this.arrName()}; }
    const name=this.arrName(); this.expect('=');
    if(this.eat('ZER')) return {t:'matset', name, v:0};
    if(this.eat('CON')) return {t:'matset', name, v:1};
    return {t:'matcopy', name, src:this.arrName()};
  }
  arrName(){ this.ws(); const m=/^[A-Z]\d?\$?/.exec(this.s.slice(this.i)); if(!m) this.err('array name expected'); this.i+=m[0].length; return m[0]; }
  decls(){
    const out=[];
    do{
      const name=this.arrName(); let dims=null, len=null;
      if(this.eat('(')){ dims=[]; do{ dims.push(this.numLit()); } while(this.eat(',')); this.expect(')'); }
      this.ws(); if(/\d/.test(this.s[this.i]||'')) len=this.numLit();
      out.push({name, dims, len});
    } while(this.eat(','));
    return out;
  }
  numLit(){ this.ws(); const m=/^\d+/.exec(this.s.slice(this.i)); if(!m) this.err('number expected'); this.i+=m[0].length; return +m[0]; }
  assign(){
    const lvs=[this.lvalue()];
    while(this.eat(',')) lvs.push(this.lvalue());
    this.expect('=');
    this.ws(); const s=this.s;
    for(const op of ['XOR','OR','AND']) if(s.startsWith(op+' BIN(',this.i)){
      this.i+=op.length; this.ws(); const e=this.primary(); return {t:'assign', lvs, v:{t:'bitop', op, e}};
    }
    return {t:'assign', lvs, v:this.expr()};
  }
  /* ---------- variables ---------- */
  varName(){ this.ws(); const m=/^[A-Z]\d?\$?/.exec(this.s.slice(this.i)); if(!m) this.err('variable expected'); this.i+=m[0].length; return m[0]; }
  lvalue(){
    this.ws();
    if(this.s.startsWith('STR(',this.i)){
      this.i+=4; const base=this.varRef(); let a=null,b=null;
      if(this.eat(',')){ this.ws(); if(this.s[this.i]!==',' && this.s[this.i]!==')') a=this.expr();
        if(this.eat(',')){ this.ws(); if(this.s[this.i]!==')') b=this.expr(); } }
      this.expect(')'); return {t:'str', base, a, b};
    }
    return this.varRef();
  }
  varRef(){
    const name=this.varName();
    if(this.s[this.i]==='('){
      this.i++; this.ws();
      if(this.s[this.i]===')'){ this.i++; return {t:'arr', name}; }
      const subs=[this.expr()]; while(this.eat(',')) subs.push(this.expr()); this.expect(')');
      return {t:'el', name, subs};
    }
    return {t:'var', name};
  }
  /* ---------- expressions ---------- */
  expr(){ return this.orE(); }
  orE(){ let l=this.andE(); for(;;){ this.ws(); if(this.s.startsWith('OR',this.i)){ this.i+=2; l={t:'bool',op:'OR',l,r:this.andE()}; } else return l; } }
  andE(){ let l=this.rel(); for(;;){ this.ws(); if(this.s.startsWith('AND',this.i)){ this.i+=3; l={t:'bool',op:'AND',l,r:this.rel()}; } else return l; } }
  rel(){
    let l=this.add();
    for(;;){
      this.ws(); const s=this.s; let op=null;
      for(const o of ['<>','<=','>=','=','<','>']) if(s.startsWith(o,this.i)){ op=o; break; }
      if(!op) return l;
      if(op==='<>' && s[this.i+2]==='=') this.i++;          // some listings contain "<>=": same meaning as "<>"
      this.i+=op.length; l={t:'cmp', op, l, r:this.add()};
    }
  }
  add(){
    let l=this.mul();
    for(;;){ this.ws(); const c=this.s[this.i];
      if(c==='+'||c==='-'){ this.i++; l={t:'arith',op:c,l,r:this.mul()}; }
      else if(c==='&'){ this.i++; l={t:'cat',l,r:this.mul()}; }
      else return l; }
  }
  mul(){ let l=this.pow(); for(;;){ this.ws(); const c=this.s[this.i]; if(c==='*'||c==='/'){ this.i++; l={t:'arith',op:c,l,r:this.pow()}; } else return l; } }
  pow(){ const l=this.unary(); this.ws(); if(this.s[this.i]==='^'){ this.i++; return {t:'arith',op:'^',l,r:this.pow()}; } return l; }
  unary(){ this.ws(); const c=this.s[this.i];
    if(c==='-'){ this.i++; return {t:'neg', e:this.unary()}; }
    if(c==='+'){ this.i++; return this.unary(); }
    return this.primary(); }
  primary(){
    this.ws(); const s=this.s, i=this.i, c=s[i];
    if(c==='('){ this.i++; const e=this.expr(); this.expect(')'); return e; }
    if(c==='"'){ const j=s.indexOf('"',i+1); this.i=j+1; return {t:'lit', v:s.slice(i+1,j)}; }
    if(/[0-9.]/.test(c)){ const m=/^\d*\.?\d+|^\d+\.?/.exec(s.slice(i)); this.i+=m[0].length; return {t:'lit', v:parseFloat(m[0])}; }
    if(s.startsWith('HEX(',i)){ const j=s.indexOf(')',i); const h=s.slice(i+4,j); this.i=j+1; let r=''; for(let k=0;k<h.length;k+=2) r+=String.fromCharCode(parseInt(h.substr(k,2),16)); return {t:'lit', v:r}; }
    if(s.startsWith('ALL(',i)){ const j=s.indexOf(')',i); const h=s.slice(i+4,j); this.i=j+1; return {t:'all', b:parseInt(h,16)}; }
    if(s.startsWith('BIN(',i)){ this.i+=4; const e=this.expr(); this.expect(')'); return {t:'bin', e}; }
    if(s.startsWith('STR(',i)){ this.i+=4; const e=this.expr(); let a=null,b=null;
      if(this.eat(',')){ this.ws(); if(s[this.i]!==','&&s[this.i]!==')') a=this.expr(); if(this.eat(',')){ this.ws(); if(s[this.i]!==')') b=this.expr(); } }
      this.expect(')'); return {t:'strf', e, a, b}; }
    if(s.startsWith('POS(',i)){ this.i+=4; this.ws(); let rev=false; if(s[this.i]==='-'){ rev=true; this.i++; }
      const x=this.add(); this.ws(); let op=null; for(const o of ['<>','<=','>=','=','<','>']) if(s.startsWith(o,this.i)){ op=o; break; }
      this.i+=op.length; const y=this.add(); this.expect(')'); return {t:'pos', rev, x, op, y}; }
    if(s.startsWith('ADDC',i)){ this.i+=4; return {t:'addc', e:this.primary()}; }
    if(s.startsWith('$PSTAT(',i)){ const j=s.indexOf(')',i); this.i=j+1; return {t:'lit', v:' '.repeat(16)}; }
    for(const f of NUMFN) if(s.startsWith(f+'(',i)){ if(this.d.disabledFunctions.includes(f)) this.err(f+'( is not available in '+this.d.name); this.i+=f.length+1; const a=[this.expr()]; while(this.eat(',')) a.push(this.expr()); this.expect(')'); return {t:'fn', f, a}; }
    return this.varRef();
  }
}

/* ================= Interprete ================= */
class Interp {
  /* term: CRT device (see wangcrt.js); io: keyboard {poll(),next()}; disk: DiskSystem (platter.js) */
  constructor(term, io, disk){
    this.T=term; this.io=io; this.disk=disk;
    this.devices=new Map([['005',term]]);          // address -> device (CRT = 005); printers are attached by the host
    this.printDev=term; this.listDev=term; this.devByteCost=100;
    this.nums=new Map(); this.strs=new Map(); this.slen=new Map(); this.arrs=new Map(); this.com=new Set();
    this.curFile=null;
    this.runId=0; this.stmtCost=100; this.byteCost=500; this.breakCost=20000; this.speed=1; this.slow=false;
    this.cache=new Map();
    this.dialect=_DL.getDialect('basic2');
    this.reportErrors=true;     // true: a runtime error is written at the bottom of the screen and rethrown ('game' use)
    this.returnErrors=false;    // true: run() returns {status:'error',...} ('shell' use)
    this.haltReq=false; this.dIdx=-1; this.dFresh=false; this.canContinue=false;
    this.prog=this.buildProgram('(empty)',[]); this.li=0; this.si=0; this.gstack=[]; this.fstack=[]; this.dpos=0;
  }
  /* ---------- programs ---------- */
  /* entries: [{no, src}] with src already decoded (real bytes). Builds the AST + tables (DATA, DEFFN). */
  buildProgram(name, entries, patches={}){
    const lines=[], lineMap=new Map(), data=[], dataStart=new Map(), deffn=new Map();
    for(const e of entries){
      const no=e.no; const src = patches[no]!==undefined ? patches[no] : e.src;
      let stmts;
      try{ stmts=new Parser(src,this.dialect).parseLine(); }catch(err){ const x=new BasicError(name+' line '+no+': '+err.message); x.line=no; throw x; }
      const idx=lines.length; lines.push({no, stmts}); lineMap.set(no,idx);
      stmts.forEach((st,si)=>{
        if(st.t==='data'){ if(!dataStart.has(no)) dataStart.set(no,data.length); for(const d of st.items) data.push(d); }
        else if(st.t==='deffn'){ deffn.set(st.n,{li:idx,si:si+1,params:st.params}); }
      });
    }
    return {name, lines, lineMap, data, dataStart, deffn};
  }
  /* reads a text listing: "NNN statements" per line, non-printable bytes as \xHH */
  /* WangEmu's `wvdutil listd` pretty-prints: lines are wrapped at 78 columns ("     " + rest) and every statement after
     a colon starts a new line ("   : stmt"). Join them back. When a wrap fell exactly on a space the space is lost: a physical
     line of 77 characters followed by a continuation had its next character dropped, so it is restored. */
  static joinListd(lines){
    const out=[]; let lastLen=0;
    for(const raw of lines){
      if(!raw) continue;
      if(raw[0]==='#' || /^\d/.test(raw)){ out.push(raw); lastLen=raw.length; continue; }
      const i=out.length-1; if(i<0 || out[i][0]==='#') continue;
      let m=/^ {3}: ?(.*)$/.exec(raw);
      if(m){ out[i]+=':'+m[1]; lastLen=raw.length; continue; }
      m=/^ {5}(.*)$/.exec(raw);
      if(m){ out[i]+=(lastLen===77?' ':'')+m[1]; lastLen=raw.length; }
    }
    return out;
  }
  static parseListing(text){
    const out=[];
    for(let raw of Interp.joinListd(text.split('\n').map(r=>r.replace(/\r$/,'')))){
      if(!raw||raw[0]==='#') continue;
      const m=/^(\d+)(.*)$/.exec(raw); if(!m) continue;
      out.push({no:+m[1], src:m[2].replace(/\\x([0-9a-fA-F]{2})/g,(a,h)=>String.fromCharCode(parseInt(h,16)))});
    }
    return out;
  }
  static toListing(entries){
    const esc=t=>t.replace(/[^\x20-\x7e]|\\/g,c=>'\\x'+c.charCodeAt(0).toString(16).padStart(2,'0'));
    return entries.map(e=>String(e.no).padStart(4,'0')+esc(e.src)).join('\n')+'\n';
  }
  compile(name){
    const src=this.disk.readProgram(name); if(!src) throw new BasicError('unknown program '+name);
    const hit=this.cache.get(src.key); if(hit && hit.version===src.version) return hit.prog;
    const prog=this.buildProgram(name, Interp.parseListing(src.text), this.patches?.[name]||{});
    this.cache.set(src.key,{version:src.version,prog}); return prog;
  }
  load(name){
    this.prog=this.compile(name);
    this.li=0; this.si=0; this.gstack=[]; this.fstack=[]; this.dpos=0;
    // non-COM variables are cleared by loading (program chaining)
    for(const k of [...this.nums.keys()]) if(!this.com.has(k)) this.nums.delete(k);
    for(const k of [...this.strs.keys()]) if(!this.com.has(k)){ this.strs.delete(k); this.slen.delete(k); }
    for(const k of [...this.arrs.keys()]) if(!this.com.has('('+k)) this.arrs.delete(k);
  }
  start(name){
    this.runId++; this.nums.clear(); this.strs.clear(); this.slen.clear(); this.arrs.clear(); this.com.clear();
    this.T.clear(); this.T.hex('0F'); this.slow=false; this.printDev=this.T; this.listDev=this.T; this.disk.restore();
    this.load(name); return this.run();
  }
  reset(){ this.runId++; }
  /* ---------- execution ---------- */
  /* devices: any object with out(byte), cx, cols, at(), atClear(), drawBox() (a Printer, see printer.js) */
  attach(addr, dev){ this.devices.set(String(addr), dev); }
  detach(addr){ const d=this.devices.get(String(addr)); this.devices.delete(String(addr)); if(this.printDev===d) this.printDev=this.T; if(this.listDev===d) this.listDev=this.T; }
  device(addr){ const d=this.devices.get(String(addr)); if(!d) throw new BasicError('no device at address '+addr); return d; }
  setDialect(id){ this.dialect=_DL.getDialect(id); this.cache.clear(); }
  curLineNo(){ const L=this.prog.lines[this.li]; return L ? L.no : null; }
  halt(){ this.haltReq=true; if(this.io.abort) this.io.abort(); }
  /* run() returns {status:'end'|'stop'|'halt'|'error'|'reset', line, msg}; with reportErrors (game mode) it rethrows errors */
  async run(){
    const id=this.runId; let cnt=0; this.vt=0; this.t0=performance.now(); let slice=performance.now(); this.haltReq=false;
    try{
      while(id===this.runId){
        if(this.haltReq){ this.haltReq=false; return {status:'halt', line:this.curLineNo()}; }
        const r=this.step(); if(r) { await r; this.vt=0; this.t0=performance.now(); }
        if((++cnt&31)===0){
          const now=performance.now(), ahead=this.vt/1000-(now-this.t0);
          if(ahead>3){ await new Promise(r=>setTimeout(r,ahead)); slice=performance.now(); }
          else if(ahead<-300){ this.vt=0; this.t0=now; }
          if(now-slice>10){ await new Promise(r=>setTimeout(r,0)); slice=performance.now(); }
        }
      }
      return {status:'reset'};
    }catch(e){
      if(e instanceof ProgramEnd) return {status:'end', direct:e.direct};
      if(e instanceof ProgramStop) return {status:'stop', line:e.line};
      if(e instanceof ProgramHalt) return {status:'halt', line:this.curLineNo()};
      const line=this.curLineNo();
      if(this.returnErrors) return {status:'error', line, msg:e.message||String(e)};
      console.error(e);
      if(this.reportErrors){ this.T.at(23,0); this.T.atClear(23,0,80); this.T.print('ERROR '+(line??'?')+': '+(e.message||e).slice(0,60)); }
      throw e;
    }
  }
  /* ---------- use as an environment: program in memory, RUN, direct statements ---------- */
  clearVars(){ this.nums.clear(); this.strs.clear(); this.slen.clear(); this.arrs.clear(); this.com.clear(); this.curFile=null; }
  setProgram(entries){ this.prog=this.buildProgram('PROGRAM',entries); this.li=0; this.si=0; this.gstack=[]; this.fstack=[]; this.dpos=0; this.canContinue=false; }
  async runFrom(startLine){
    this.clearVars(); this.gstack=[]; this.fstack=[]; this.dpos=0; this.canContinue=false;
    if(startLine!=null) this.jump(startLine); else { this.li=0; this.si=0; }
    this.runId++; const r=await this.run(); this.canContinue=(r.status==='stop'||r.status==='halt'); return r;
  }
  async continueRun(){ this.runId++; const r=await this.run(); this.canContinue=(r.status==='stop'||r.status==='halt'); return r; }
  /* direct statement (no line number): runs as a line appended at the end; variables shared with the program */
  async execDirect(src){
    const stmts=new Parser(src,this.dialect).parseLine();
    const saved={prog:this.prog, li:this.li, si:this.si, g:this.gstack, f:this.fstack, dpos:this.dpos};
    const lines=this.prog.lines.concat([{no:-1,stmts}]); const lineMap=new Map(this.prog.lineMap); lineMap.set(-1,lines.length-1);
    this.prog={...this.prog, lines, lineMap}; this.dIdx=lines.length-1; this.dFresh=true;
    this.li=this.dIdx; this.si=0; this.gstack=[]; this.fstack=[]; this.runId++;
    const res=await this.run();
    this.dIdx=-1;
    if(res.status==='end' && !res.direct){ this.canContinue=false; this.prog={...saved.prog}; }   // the program ran to the end
    else { this.prog=saved.prog; this.li=saved.li; this.si=saved.si; this.gstack=saved.g; this.fstack=saved.f; this.dpos=saved.dpos; }
    return res;
  }
  step(){
    const L=this.prog.lines[this.li];
    if(!L){ throw new ProgramEnd(false); }
    if(this.li===this.dIdx){
      if(this.si===0 && !this.dFresh) throw new ProgramEnd(false);   // the flow "fell" into the direct line
      this.dFresh=false;
      if(this.si>=L.stmts.length) throw new ProgramEnd(true);
    }
    if(this.si>=L.stmts.length){ this.li++; this.si=0; return; }
    const st=L.stmts[this.si++];
    this.vt+=this.stmtCost*this.speed;
    return this.exec(st);
  }
  jump(n){
    let idx=this.prog.lineMap.get(n);
    if(idx===undefined){ idx=this.prog.lines.findIndex(l=>l.no>=n); if(idx<0) throw new BasicError('line '+n+' does not exist'); }
    this.li=idx; this.si=0;
  }
  exec(st){
    switch(st.t){
      case 'assign': { const v=this.assignValue(st); for(const lv of st.lvs) this.setLv(lv, v, st.v); return; }
      case 'if': { const c=this.ev(st.c); const p=(typeof c==='number')?c!==0:(c!==''); const b = p ? st.th : st.el; if(b) return this.exec(b); return; }
      case 'goto': this.jump(st.n); return;
      case 'gosub': this.gstack.push({li:this.li,si:this.si}); this.jump(st.n); return;
      case 'gosubfn': { const d=this.prog.deffn.get(st.n); if(!d) throw new BasicError('DEFFN '+st.n);
        const vals=st.args.map(a=>this.ev(a)); d.params.forEach((p,k)=>this.setLv({t:'var',name:p}, vals[k]));
        this.gstack.push({li:this.li,si:this.si}); this.li=d.li; this.si=d.si; return; }
      case 'return': { if(st.k==='all'){ this.gstack.length=0; this.fstack.length=0; return; }
        const r=this.gstack.pop(); if(!r) throw new BasicError('RETURN without GOSUB');
        if(st.k==='clear') return; this.li=r.li; this.si=r.si; return; }
      case 'for': { const a=this.ev(st.a), b=this.ev(st.b), s=st.st?this.ev(st.st):1;
        this.setLv({t:'var',name:st.v}, a);
        const i=this.fstack.findIndex(f=>f.v===st.v); if(i>=0) this.fstack.splice(i,1);
        this.fstack.push({v:st.v, end:b, step:s, li:this.li, si:this.si}); if(this.fstack.length>200) this.fstack.shift(); return; }
      case 'next': { let k=this.fstack.length-1;
        if(st.v){ while(k>=0 && this.fstack[k].v!==st.v) k--; if(k<0) throw new BasicError('NEXT without FOR'); this.fstack.length=k+1; }
        else if(k<0) throw new BasicError('NEXT without FOR');
        const f=this.fstack[k]; const v=this.nums.get(f.v)+f.step; this.nums.set(f.v,v);
        if(f.step>=0 ? v<=f.end : v>=f.end){ this.li=f.li; this.si=f.si; } else this.fstack.pop(); return; }
      case 'print': return this.doPrint(st);
      case 'using': { const f=this.str(this.ev(st.f)); const v=this.ev(st.e); const w=(f.match(/#/g)||[]).length;
        let t=String(Math.round(v)); if(t.length>w) t='*'.repeat(w); this.emit(t.padStart(w,' ')); if(st.nl) this.emit('\r\n'); return; }
      case 'gio': this.emit(this.str(this.ev(st.e))); return;
      case 'break': this.vt+=this.breakCost*this.speed; return;
      case 'select':
        if(st.kind){ if(st.kind==='PRINT') this.printDev=this.device(st.addr); else if(st.kind==='LIST') this.listDev=this.device(st.addr); return; }
        this.slow=(st.dev==='P1'); return;
      case 'keyin': {
        // KEYIN K$ without line numbers WAITS for a key; with line numbers it does not block (K$ is unchanged if there is no key)
        if(st.l1==null && st.l2==null) return (async()=>{ const k=await this.io.next(); if(k.abort) throw new ProgramHalt(); this.setLv(st.lv, String.fromCharCode(k.c)); })();
        const k=this.io.poll(); if(!k) return;
        this.setLv(st.lv, String.fromCharCode(k.c)); const l=k.sp?st.l2:st.l1; if(l!=null) this.jump(l); return; }
      case 'linput': return this.doLinput(st);
      case 'input': return this.doInput(st);
      case 'convert': return this.doConvert(st);
      case 'on': { const k=Math.floor(this.ev(st.e)); const l=st.list[k-1];
        if(l!=null){ if(st.kind==='gosub') this.gstack.push({li:this.li,si:this.si}); this.jump(l); } return; }
      case 'restore': { let p0 = st.n==null ? 0 : (this.prog.dataStart.get(st.n) ?? 0); if(st.k) p0 += Math.max(0, Math.floor(this.ev(st.k))-1); this.dpos=p0; return; }
      case 'read': for(const lv of st.lv){ if(this.dpos>=this.prog.data.length) throw new BasicError('out of DATA'); this.setLv(lv,this.prog.data[this.dpos++]); } return;
      case 'matread': { const a=this.arr(st.name); for(let k=0;k<a.data.length;k++){ if(this.dpos>=this.prog.data.length) throw new BasicError('out of DATA');
          a.data[k]=a.isStr ? this.fit(String(this.prog.data[this.dpos++]),a.len) : this.prog.data[this.dpos++]; } return; }
      case 'matset': this.arr(st.name).data.fill(st.v); return;
      case 'matcopy': { const a=this.arr(st.name), b=this.arr(st.src); for(let k=0;k<a.data.length;k++) a.data[k]=b.data[k]; return; }
      case 'dim': for(const d of st.decl) this.declare(d,st.com); return;
      case 'load': this.load(st.name); return;
      case 'loadrun':   // LOAD RUN: start the program again from its first line, with clean variables
        if(this.disk.status(this.prog.name)===1) this.load(this.prog.name);
        else { this.clearVars(); this.gstack=[]; this.fstack=[]; this.dpos=0; this.li=0; this.si=0; }
        return;
      case 'limits': { const s = this.disk.status(st.name);
        st.lv.forEach((lv,k)=>this.setLv(lv, k===st.lv.length-1 ? s : 0)); return; }
      case 'dc': return this.doDc(st);
      case 'tran': { const t=this.str(this.ev(st.tb)); let v=this.str(this.ev(st.lv)); let o='';
        for(const ch of v){ let r=ch; for(let k=0;k+1<t.length;k+=2) if(t[k+1]===ch){ r=t[k]; break; } o+=r; }
        this.setLv(st.lv,o); return; }
      case 'stop': throw new ProgramStop(this.curLineNo());
      case 'data': case 'deffn': case 'nop': return;
    }
    throw new BasicError('exec '+st.t);
  }
  /* ---------- I/O ---------- */
  emit(s){
    const T=this.printDev;
    for(let i=0;i<s.length;i++) T.out(s.charCodeAt(i));
    this.vt+=s.length*(T===this.T ? (this.slow?25000:this.byteCost) : this.devByteCost)*this.speed;
  }
  doPrint(st){
    const T=this.printDev;
    for(const it of st.items){
      switch(it.k){
        case 'at': { const r=this.ev(it.a[0]), c=this.ev(it.a[1]);
          if(it.a.length>2){ T.atClear(r,c,this.ev(it.a[2])); this.vt+=3*this.byteCost*this.speed; } else { T.at(r,c); this.vt+=3*this.byteCost*this.speed; } break; }
        case 'tab': { // TAB(n) fills with SPACES up to n characters on the line (erases, does not just move the cursor)
          const n=Math.min(this.ev(it.a), T.cols||80); let k=n-T.cx; while(k-- >0) this.emit(' '); break; }
        case 'box': { const h=this.ev(it.a), w=this.ev(it.b); const erase=(h<0||w<0||Object.is(h,-0)||Object.is(w,-0));
          T.drawBox(T.cy,T.cx,Math.abs(h),Math.abs(w),!erase); this.vt+=6*this.byteCost*this.speed; break; }
        default: { const v=this.ev(it.e);
          this.emit(typeof v==='number' ? ((v<0?'-':' ')+Math.abs(v)+' ') : this.str(v)); }
      }
    }
    if(st.nl) this.emit('\r\n');
  }
  /* read one line from the keyboard with echo; Enter ends it. Throws ProgramHalt when interrupted. */
  async readLine(lenMax){
    let s='';
    for(;;){
      const k=await this.io.next();
      if(k.abort) throw new ProgramHalt();
      if(k.sp) continue;
      if(k.c===13) break;
      if(k.c===8){ if(s.length){ s=s.slice(0,-1); this.T.out(8); this.T.out(0x20); this.T.out(8); } continue; }
      if(k.c>=32 && s.length<lenMax){ s+=String.fromCharCode(k.c); this.T.out(k.c); }
    }
    this.emit('\r\n');
    return s;
  }
  /* INPUT: shows the prompt ("?" if none), reads one line per variable; an unreadable number leaves the variable unchanged */
  doInput(st){
    return (async()=>{
      this.emit(st.prompt ? this.str(this.ev(st.prompt)) : '?');
      for(const lv of st.lv){
        const isStr = (lv.t==='var'||lv.t==='el') ? lv.name.endsWith('$') : true;
        const s=await this.readLine(isStr ? this.lvLen(lv) : 24);
        if(isStr) this.setLv(lv,s); else { const v=parseFloat(s); if(!isNaN(v)) this.setLv(lv,v); }
      }
    })();
  }
  doLinput(st){
    return (async()=>{
      let s=''; const lenMax=this.lvLen(st.lv);
      for(;;){
        const k=await this.io.next();
        if(k.abort) throw new ProgramHalt();
        if(k.sp) continue;
        if(k.c===13) break;
        if(k.c===8){ if(s.length){ s=s.slice(0,-1); this.T.out(8); this.T.out(0x20); this.T.out(8); } continue; }
        if(k.c>=32 && s.length<lenMax){ s+=String.fromCharCode(k.c); this.T.out(k.c); }
      }
      this.setLv(st.lv,s); this.emit('\r\n');
    })();
  }
  doConvert(st){
    const v=this.ev(st.e);
    if(typeof v==='string'){ this.setLv(st.lv, parseFloat(v.trim())||0); return; }
    const w=st.pic ? (st.pic.match(/#/g)||[]).length : 0;
    this.setLv(st.lv, st.pic ? String(Math.round(Math.abs(v))).padStart(w,'0').slice(-w) : String(v));
  }
  doDc(st){
    if(st.op==='open'){ this.curFile=st.name; return; }
    if(st.op==='load'){ const r=this.disk.readData(this.curFile); const a=this.arr('H$'); if(r) for(let k=0;k<a.data.length&&k<r.length;k++) a.data[k]=this.fit(r[k],a.len); return; }
    if(st.op==='save'){ this.disk.writeData(this.curFile, this.arr('H$').data.slice()); }
  }
  /* ---------- variables ---------- */
  declare(d,com){
    const isStr=d.name.endsWith('$');
    if(d.dims){
      const size=d.dims.reduce((a,b)=>a*b,1), len=isStr?(d.len||16):0;
      this.arrs.set(d.name,{dims:d.dims, isStr, len, data: isStr ? new Array(size).fill(' '.repeat(len)) : new Array(size).fill(0)});
      if(com) this.com.add('('+d.name);
    } else {
      if(isStr){ this.slen.set(d.name,d.len||16); this.strs.set(d.name,' '.repeat(d.len||16)); } else this.nums.set(d.name,0);
      if(com) this.com.add(d.name);
    }
  }
  arr(name){ const a=this.arrs.get(name); if(!a) throw new BasicError('array not dimensioned '+name); return a; }
  idx(a,subs,name){
    let k=0;
    for(let d=0;d<a.dims.length;d++){ const v=Math.floor(this.ev(subs[d])); if(v<0||v>a.dims[d]) throw new BasicError('index '+name+'('+v+')'); k=k*a.dims[d]+Math.max(v-1,0); }
    return k;
  }
  fit(s,len){ s=String(s); return s.length>=len ? s.slice(0,len) : s+' '.repeat(len-s.length); }
  str(v){ if(typeof v==='string') return v; if(v instanceof AllFill) return String.fromCharCode(v.b); return String(v); }
  lvLen(lv){
    if(lv.t==='var') return this.slen.get(lv.name)||16;
    if(lv.t==='el') return this.arr(lv.name).len;
    if(lv.t==='str'){ return lv.b ? this.ev(lv.b) : this.lvLen(lv.base); }
    return 16;
  }
  getVar(n){
    switch(n.t){
      case 'var': if(n.name.endsWith('$')){ let v=this.strs.get(n.name); if(v===undefined){ const l=this.slen.get(n.name)||16; v=' '.repeat(l); this.strs.set(n.name,v);} return v; }
        { const v=this.nums.get(n.name); return v===undefined?0:v; }
      case 'el': { const a=this.arr(n.name); return a.data[this.idx(a,n.subs,n.name)]; }
    }
    throw new BasicError('getVar '+n.t);
  }
  setLv(lv,v,srcNode){
    if(srcNode && srcNode.t==='addc') v=this.addc(lv,v);
    if(lv.t==='var'){
      if(lv.name.endsWith('$')){ const l=this.slen.get(lv.name)||16; if(!this.slen.has(lv.name)) this.slen.set(lv.name,l);
        this.strs.set(lv.name, v instanceof AllFill ? String.fromCharCode(v.b).repeat(l) : this.fit(this.str(v),l)); }
      else this.nums.set(lv.name, typeof v==='number' ? v : parseFloat(v)||0);
      return;
    }
    if(lv.t==='el'){ const a=this.arr(lv.name); const k=this.idx(a,lv.subs,lv.name);
      a.data[k]= a.isStr ? (v instanceof AllFill ? String.fromCharCode(v.b).repeat(a.len) : this.fit(this.str(v),a.len)) : (typeof v==='number'?v:parseFloat(v)||0); return; }
    if(lv.t==='arr'){ const a=this.arr(lv.name);
      if(v instanceof AllFill){ a.data.fill(String.fromCharCode(v.b).repeat(a.len)); }
      else { const s=this.str(v); for(let k=0;k<a.data.length;k++) a.data[k]=this.fit(s.substr(k*a.len,a.len),a.len); } return; }
    if(lv.t==='str'){
      const cur=this.str(this.getVar(lv.base)); const a=lv.a?Math.floor(this.ev(lv.a)):1;
      const n=lv.b?Math.floor(this.ev(lv.b)):cur.length-a+1;
      if(a<1||n<=0||a+n-1>cur.length) return;
      let piece = v instanceof AllFill ? String.fromCharCode(v.b).repeat(n) : this.fit(this.str(v),n);
      if(srcNode && srcNode.t==='bitop'){ const o=cur.substr(a-1,n); piece=''; const m=v; // v is the byte
        for(let k=0;k<n;k++){ const x=o.charCodeAt(k); piece+=String.fromCharCode(srcNode.op==='XOR'?x^m:srcNode.op==='OR'?x|m:x&m); } }
      this.setLv(lv.base, cur.slice(0,a-1)+piece+cur.slice(a-1+n)); return;
    }
    throw new BasicError('setLv '+lv.t);
  }
  assignValue(st){
    const v=st.v;
    if(v.t==='bitop') return this.ev(v.e).charCodeAt(0);     // the byte to combine
    return this.ev(v);
  }
  addc(lv,v){   // 16-bit add with carry (hall of fame checksum)
    const cur=this.str(this.ev(lv)); const n=((cur.charCodeAt(0)||0)<<8|(cur.charCodeAt(1)||0));
    const t=(n+(this.str(v).charCodeAt(0)||0))&0xFFFF; return String.fromCharCode(t>>8,t&255);
  }
  /* ---------- evaluation ---------- */
  cmp(op,a,b){
    let r;
    if(typeof a==='string'||typeof b==='string'){
      a=this.str(a); b=this.str(b); const L=Math.max(a.length,b.length); a=a.padEnd(L,' '); b=b.padEnd(L,' ');
      r = a<b?-1:a>b?1:0;
    } else r = a<b?-1:a>b?1:0;
    switch(op){ case '=':return r===0?1:0; case '<>':return r!==0?1:0; case '<':return r<0?1:0; case '>':return r>0?1:0; case '<=':return r<=0?1:0; case '>=':return r>=0?1:0; }
  }
  ev(n){
    switch(n.t){
      case 'lit': return n.v;
      case 'var': case 'el': return this.getVar(n);
      case 'cmp': return this.cmp(n.op,this.ev(n.l),this.ev(n.r));
      case 'bool': { const a=this.truth(this.ev(n.l)); if(n.op==='AND'){ return a&&this.truth(this.ev(n.r))?1:0; } return a||this.truth(this.ev(n.r))?1:0; }
      case 'arith': { const a=this.ev(n.l), b=this.ev(n.r);
        switch(n.op){ case '+': return a+b; case '-': return a-b; case '*': return a*b; case '/': if(b===0) throw new BasicError('DIVISION BY ZERO'); return a/b; case '^': return Math.pow(a,b); } break; }
      case 'neg': return -this.ev(n.e);
      case 'cat': return this.str(this.ev(n.l))+this.str(this.ev(n.r));
      case 'all': return new AllFill(n.b);
      case 'bin': return String.fromCharCode(Math.floor(this.ev(n.e))&255);
      case 'strf': { const s=this.str(this.ev(n.e)); let a=n.a?Math.floor(this.ev(n.a)):1; if(a<1) a=1;
        return n.b ? s.substr(a-1,Math.floor(this.ev(n.b))) : s.substr(a-1); }
      case 'pos': { const s=this.str(this.ev(n.x)); const y=this.str(this.ev(n.y)); const c=y.length?y[0]:' ';
        let res=0; for(let k=0;k<s.length;k++){ const kk=n.rev?s.length-1-k:k; if(this.cmp(n.op,s[kk],c)){ res=kk+1; break; } } return res; }
      case 'addc': return this.ev(n.e);
      case 'fn': { const a=n.a.map(x=>this.ev(x));
        switch(n.f){ case 'INT': return Math.floor(a[0]); case 'MOD': return a[0]-Math.floor(a[0]/a[1])*a[1]; case 'MIN': return Math.min(a[0],a[1]);
          case 'MAX': return Math.max(a[0],a[1]); case 'ABS': return Math.abs(a[0]); case 'RND': return Math.random(); case 'SGN': return Math.sign(a[0]);
          case 'LEN': return this.str(a[0]).length;
          case 'SQR': if(a[0]<0) throw new BasicError('SQR OF NEGATIVE'); return Math.sqrt(a[0]);
          case 'EXP': return Math.exp(a[0]); case 'LOG': if(a[0]<=0) throw new BasicError('LOG OF NON-POSITIVE'); return Math.log(a[0]);
          case 'SIN': return Math.sin(a[0]); case 'COS': return Math.cos(a[0]); case 'TAN': return Math.tan(a[0]); case 'ATN': return Math.atan(a[0]); } break; }
      case 'str': return this.ev({t:'strf', e:n.base, a:n.a, b:n.b});   // STR() used as a value
      case 'arr': throw new BasicError('whole array in expression');
    }
    throw new BasicError('ev '+n.t);
  }
  truth(v){ return typeof v==='number' ? v!==0 : v!==''; }
}

if(typeof module!=='undefined') module.exports={Interp,Parser,BasicError,AllFill,ProgramEnd,ProgramStop,ProgramHalt};
