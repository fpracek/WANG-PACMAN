/* ================= Platter: dischi virtuali del Wang 2200 =================
   Un Platter è un "disco" con un catalogo di file. Il 2200 chiamava platter ogni superficie
   montabile di un'unità (es. fissa/rimovibile all'indirizzo 310, 320, ...).
   Questo modulo non conosce il linguaggio BASIC: offre solo cataloghi e dati; l'interprete lo usa tramite DiskSystem.

   File: { name, kind: 'program' | 'data', text?: string (listato), records?: any[] }
     - program: listato testuale (una riga BASIC per riga, "NNN istruzioni")
     - data   : file dati a record (array di stringhe/numeri), usato da DATA LOAD DC / DATA SAVE DC
*/
class Platter {
  constructor(label, opts={}){
    this.label=label; this.readOnly=!!opts.readOnly; this.files=new Map(); this.version=0;
  }
  addProgram(name,text){ this.files.set(name,{name,kind:'program',text}); this.version++; return this; }
  putData(name,records){ this.files.set(name,{name,kind:'data',records:records.slice(),user:true}); this.version++; }
  putProgram(name,text){ this.files.set(name,{name,kind:'program',text,user:true}); this.version++; }   // salvato dall'utente: persiste
  has(name){ return this.files.has(name); }
  get(name){ return this.files.get(name)||null; }
  remove(name){ const r=this.files.delete(name); if(r) this.version++; return r; }
  list(){ return [...this.files.values()].map(f=>({name:f.name,kind:f.kind,size:f.kind==='program'?f.text.length:f.records.length})); }
  /* serializzazione: i platter a sola lettura non vengono salvati (i loro file arrivano dal codice) */
  toJSON(){ const o={label:this.label,files:[]}; for(const f of this.files.values()) o.files.push(f); return o; }
  static fromJSON(j){ const p=new Platter(j.label); for(const f of j.files) p.files.set(f.name,f); return p; }
}

/* DiskSystem: unità montate + ricerca dei file + persistenza (localStorage per default).
   Gli indirizzi seguono lo stile Wang: '310' = unità 1 (disco 0), '320', '330'... */
class DiskSystem {
  constructor(opts={}){
    this.drives=new Map();            // indirizzo -> Platter
    this.current='310';               // unità predefinita ("SELECT DISK")
    this.prefix=opts.prefix||'wang2200';
    // localStorage può non esistere o lanciare eccezioni (iframe sandbox, URL data:, modalità privata):
    // in quel caso i dati restano solo in memoria.
    let st=opts.storage;
    if(st===undefined){ try{ st = typeof localStorage!=='undefined' ? localStorage : null; if(st){ st.getItem('__t'); } }catch(e){ st=null; } }
    this.storage=st;
  }
  mount(addr,platter){ this.drives.set(addr,platter); return platter; }
  unmount(addr){ this.drives.delete(addr); }
  select(addr){ if(!this.drives.has(addr)) throw new Error('unità '+addr+' non montata'); this.current=addr; }
  /* cerca prima nell'unità corrente, poi nelle altre */
  find(name){
    const cur=this.drives.get(this.current);
    if(cur&&cur.has(name)) return {addr:this.current,platter:cur,file:cur.get(name)};
    for(const [addr,p] of this.drives) if(p.has(name)) return {addr,platter:p,file:p.get(name)};
    return null;
  }
  status(name){ const f=this.find(name); return !f ? 0 : (f.file.kind==='program' ? 1 : 2); }
  readProgram(name){ const f=this.find(name); if(!f||f.file.kind!=='program') return null; return {text:f.file.text, version:f.platter.version, key:f.addr+':'+name}; }
  readData(name){ const f=this.find(name); return (f&&f.file.kind==='data') ? f.file.records.slice() : null; }
  writeData(name,records,addr){
    const f=this.find(name); const p= f ? f.platter : this.drives.get(addr||this.current);
    if(!p) throw new Error('nessun platter'); if(p.readOnly) throw new Error('platter protetto da scrittura');
    p.putData(name,records); this.persist();
  }
  /* persistenza: salva solo i file creati dall'utente (user:true) di ogni platter */
  persist(){
    if(!this.storage) return;
    try{ for(const [addr,p] of this.drives){
      const files=[...p.files.values()].filter(f=>f.user);              // solo i file dell'utente: i listati forniti dal codice no
      this.storage.setItem(this.prefix+':'+addr, JSON.stringify({label:p.label,files}));
    } }catch(e){}
  }
  /* ripristina il contenuto dei platter scrivibili già montati (dati utente salvati in precedenza) */
  restore(){
    if(!this.storage) return;
    for(const [addr,p] of this.drives){
      try{ const j=JSON.parse(this.storage.getItem(this.prefix+':'+addr)||'null'); if(j) for(const f of j.files) if(f.user) p.files.set(f.name,f); }catch(e){}
    }
  }
  writeProgram(name,text,addr){
    const f=this.find(name); const p=f ? f.platter : this.drives.get(addr||this.current);
    if(!p) throw new Error('nessun platter'); if(p.readOnly) throw new Error('platter protetto da scrittura');
    p.putProgram(name,text); this.persist();
  }
  remove(name){ const f=this.find(name); if(!f) return false; if(f.platter.readOnly) throw new Error('platter protetto da scrittura'); f.platter.remove(name); this.persist(); return true; }
  /* esporta/importa un platter come stringa JSON (per scaricare/caricare "dischi") */
  exportPlatter(addr){ return JSON.stringify(this.drives.get(addr).toJSON()); }
  importPlatter(addr,json){ this.mount(addr,Platter.fromJSON(JSON.parse(json))); this.persist(); }
}
if(typeof module!=='undefined') module.exports={Platter,DiskSystem};
