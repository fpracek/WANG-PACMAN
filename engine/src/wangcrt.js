/* ================= Wang 2236 terminal (80x24): model only, no DOM =================
   Interprets the CRT control bytes (clear, cursor, attributes, alternate set, BOX).
   Drawing is in crt-canvas.js. */
const COLS=80, ROWS=24, W=800, H=550, CW=10, CH=22;
const FL_ALT=1, FL_BRIGHT=2, FL_BLINK=4, FL_INV=8, FL_UNDER=16;

class Terminal {
  constructor(){
    this.ch=new Uint8Array(COLS*ROWS).fill(0x20);
    this.fl=new Uint8Array(COLS*ROWS);
    this.box=new Uint8Array(COLS*(ROWS+1));   // 1=left half 2=right half 4=vertical
    this.cx=0; this.cy=0; this.dirty=true; this.cols=COLS; this.rows=ROWS; this.cursorVisible=false;
    this.alt=false; this.bright=false; this.blink=false; this.inv=false; this.under=false;
    this.on=false; this.temp=false; this.seq=[]; this.onBell=null;
  }
  at(r,c){ this.cy=Math.max(0,Math.min(ROWS-1,r|0)); this.cx=Math.max(0,Math.min(COLS-1,c|0)); }
  // AT(r,c,n): erases n characters starting at (r,c), wrapping around; the cursor stays at (r,c)
  atClear(r,c,n){
    r=r|0; c=c|0; n=n|0;
    let rr=r, cc=c;
    for(let i=0;i<n;i++){
      if(rr>=0&&rr<ROWS&&cc>=0&&cc<COLS){ this.ch[rr*COLS+cc]=0x20; this.fl[rr*COLS+cc]=0; }
      if(++cc>=COLS){ cc=0; rr++; }
    }
    this.at(r,c); this.dirty=true;
  }
  hex(h){ for(let i=0;i<h.length;i+=2) this.out(parseInt(h.substr(i,2),16)); }   // sends bytes from a hex string
  print(t){ for(let i=0;i<t.length;i++) this.out(t.charCodeAt(i)); }
  clear(){ this.ch.fill(0x20); this.fl.fill(0); this.box.fill(0); this.cx=0; this.cy=0; this.dirty=true; }
  out(b){
    if(this.seq.length){ this.seqByte(b); return; }
    switch(b){
      case 0x02: this.seq=[2]; return;
      case 0x0D: this.temp=false; this.cx=0; return;
      case 0x0E: this.on=false; this.temp=true; return;
      case 0x0F: this.on=false; this.temp=false; return;
      case 0x03: this.clear(); return;
      case 0x01: this.cx=0; this.cy=0; return;
      case 0x05: this.cursorVisible=true; this.dirty=true; return;
      case 0x06: this.cursorVisible=false; this.dirty=true; return;
      case 0x00: case 0x04: case 0x0B: return;
      case 0x07: if(this.onBell) this.onBell(); return;
      case 0x08: if(this.cx>0) this.cx--; return;
      case 0x09: if(this.cx<COLS-1) this.cx++; return;
      case 0x0A: if(this.cy<ROWS-1) this.cy++; else this.scroll(); return;
      case 0x0C: if(this.cy>0) this.cy--; return;
    }
    if(b<0x10) return;
    this.put(b);
  }
  seqByte(b){
    const s=this.seq; s.push(b);
    const term=(b===0x0E||b===0x0F);
    if(!term && s.length<8) return;
    if(s[1]===0x02){ this.alt = s.length>=4 && s[2]!==0; }
    else if(s[1]===0x04 && s.length===5){
      const ok=v=>v===0||v===2||v===4||v===0x0B, a=s[2], c=s[3];
      if(ok(a)&&ok(c)){
        this.bright=(a===2||a===0x0B); this.blink=(a===4||a===0x0B);
        this.inv=(c===2||c===0x0B); this.under=(c===4||c===0x0B);
        this.on=(s[4]===0x0E); this.temp=false;
      }
    }
    this.seq=[];
  }
  put(b){
    const useAlt=b>=0x80&&this.alt;
    const under=(b>=0x90&&!useAlt)||(this.under&&(this.on||this.temp));
    const e=this.on||this.temp;
    let f=0;
    if(useAlt) f|=FL_ALT; if(under) f|=FL_UNDER;
    if(e){ if(this.bright) f|=FL_BRIGHT; if(this.blink) f|=FL_BLINK; if(this.inv) f|=FL_INV; }
    const i=this.cy*COLS+this.cx; this.ch[i]=b&0x7F; this.fl[i]=f;
    if(++this.cx>=COLS){ this.cx=0; if(this.cy<ROWS-1) this.cy++; else this.scroll(); }
    this.dirty=true;
  }
  scroll(){
    this.ch.copyWithin(0,COLS); this.fl.copyWithin(0,COLS);
    this.ch.fill(0x20,COLS*(ROWS-1)); this.fl.fill(0,COLS*(ROWS-1)); this.dirty=true;
  }
  // BOX(h,w): draws on the top edge of the rows and at mid-column; "draw=false" erases.
  // The cursor does not move.
  drawBox(r,c,h,w,draw){
    r|=0; c|=0;
    const set=(row,col,bit)=>{ if(row<0||row>ROWS||col<0||col>=COLS) return; const i=row*COLS+col; this.box[i]=draw?(this.box[i]|bit):(this.box[i]&~bit); };
    if(w!==0) for(const row of (h===0?[r]:[r,r+h])){
      set(row,c,2); for(let x=c+1;x<c+w;x++) set(row,x,3); set(row,c+w,1);
    }
    if(h!==0) for(let row=r;row<r+h;row++){ set(row,c,4); set(row,c+w,4); }
    this.dirty=true;
  }
}


if(typeof module!=='undefined') module.exports={Terminal,COLS,ROWS,W,H,CW,CH,FL_ALT,FL_BRIGHT,FL_BLINK,FL_INV,FL_UNDER};
