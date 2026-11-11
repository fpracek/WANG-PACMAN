/* ================= Virtual line printer with PDF output: model only, no DOM =================
   Mirrors the CRT device interface (out/print/at/atClear/drawBox/clear/cx/cy/cols/rows)
   so the interpreter can send bytes to it exactly as it does to the screen.
   toPDF() writes a hand-made PDF-1.4 file (Courier, no embedding, no dependencies).
   MIT licensed. */

class Printer {
  constructor(opts){
    const o=opts||{};
    this.cols=o.cols>0?(o.cols|0):132;
    this.rows=o.rows>0?(o.rows|0):66;
    this.title=o.title!==undefined?String(o.title):'PRINTER';
    this.paper=o.paper||'letter';
    this.orientation=o.orientation||'auto';
    this.greenbar=!!o.greenbar;
    this.margin=o.margin!==undefined?+o.margin:36;
    this.clear();
  }
  // empties the printer: all pages are discarded
  clear(){
    this.pages=[];          // each page: {rows:[], used:false, last:-1}; row = sparse array of cells {c,b,u}
    this.cx=0; this.cy=0;
    this.pendingPage=false; // a new page was started (FF / overflow) but nothing is on it yet
  }
  // no-ops: a printer has no addressable screen
  at(r,c){}
  atClear(r,c,n){}
  drawBox(r,c,h,w,draw){}
  print(t){ t=String(t); for(let i=0;i<t.length;i++) this.out(t.charCodeAt(i)); }

  out(b){
    b&=0xFF;
    switch(b){
      case 0x0D: this.cx=0; return;
      case 0x0A: this.lineFeed(); return;
      case 0x0C: this.formFeed(); return;
      case 0x08: if(this.cx>0) this.cx--; return;
      case 0x09: this.cx=Math.min(this.cols,(this.cx>>3)*8+8); return;
    }
    if(b>=0x80) b=0x2E;
    if(b<0x20||b>0x7E) return;
    this.put(b);
  }
  lineFeed(){
    this.cy++;
    if(this.cy>=this.rows){ this.cy=0; this.pendingPage=true; }
  }
  formFeed(){
    const p=this.pages.length?this.pages[this.pages.length-1]:null;
    if(!this.pendingPage && p && p.used) this.pendingPage=true;
    this.cy=0;
  }
  curPage(){
    if(!this.pages.length || this.pendingPage){
      this.pages.push({rows:[],used:false,last:-1});
      this.pendingPage=false;
    }
    return this.pages[this.pages.length-1];
  }
  put(b){
    if(this.cx>=this.cols){ this.cx=0; this.lineFeed(); }   // wrap at the right margin
    if(b===0x20){ this.cx++; return; }                      // a space never strikes the paper
    const p=this.curPage();
    const row=p.rows[this.cy]||(p.rows[this.cy]=[]);
    const ch=String.fromCharCode(b), cell=row[this.cx];
    if(!cell) row[this.cx]={c:ch,b:false,u:false};
    else if(ch==='_' && cell.c!=='_') cell.u=true;                 // underscore over a letter = underline
    else if(cell.c==='_' && ch!=='_'){ cell.c=ch; cell.u=true; }   // letter over underscore = underline
    else{ cell.c=ch; cell.b=true; }                                // any other repeat = bold (last char shown)
    p.used=true; if(this.cy>p.last) p.last=this.cy;
    this.cx++;
  }

  pageCount(){ return this.pages.length; }
  lineCount(){ let n=0; for(const p of this.pages) n+=p.last+1; return n; }
  isEmpty(){ return this.pages.length===0; }

  lineText(row){
    let s='';
    if(row) for(let i=0;i<row.length;i++) s+=row[i]?row[i].c:' ';
    return s.replace(/\s+$/,'');
  }
  // all pages as text, lines right-trimmed, pages separated by a real form feed character
  getText(){
    const out=[];
    for(const p of this.pages){
      const ls=[];
      for(let i=0;i<=p.last;i++) ls.push(this.lineText(p.rows[i]));
      out.push(ls.join('\n'));
    }
    return out.join('\f');
  }

  // returns a PDF-1.4 file as Uint8Array (portable: no DOM, no Node APIs)
  toPDF(opts){
    const o=opts||{};
    const paper=o.paper||this.paper, margin=o.margin!==undefined?+o.margin:this.margin;
    const greenbar=o.greenbar!==undefined?!!o.greenbar:this.greenbar;
    const title=o.title!==undefined?String(o.title):this.title;
    const cols=this.cols, rows=this.rows;
    let orient=o.orientation||this.orientation;
    if(orient==='auto') orient=cols>96?'landscape':'portrait';
    let pw=612, ph=792;
    if(paper==='a4'){ pw=595.28; ph=841.89; }
    if(orient==='landscape'){ const t=pw; pw=ph; ph=t; }
    const uw=pw-2*margin, uh=ph-2*margin;
    const lineH=uh/rows;
    const fs=Math.min(uw/(cols*0.6),lineH*0.95);
    const cw=fs*0.6;
    const left=margin;
    const num=n=>{ let s=n.toFixed(3); if(s.indexOf('.')>=0) s=s.replace(/0+$/,'').replace(/\.$/,''); return s==='-0'?'0':s; };
    const esc=s=>s.replace(/[\\()]/g,m=>'\\'+m);
    const ascii=s=>s.replace(/[^\x20-\x7E]/g,'?');

    const pages=this.pages.length?this.pages:[{rows:[],used:false,last:-1}];
    const streams=[];
    for(const p of pages){
      let c='';
      if(greenbar){
        c+='0.84 0.95 0.84 rg\n';
        for(let i=3;i<rows;i+=6){
          const h=Math.min(3,rows-i);
          c+=num(left)+' '+num(ph-margin-(i+h)*lineH)+' '+num(cols*cw)+' '+num(h*lineH)+' re f\n';
        }
        c+='0 g\n';
      }
      c+='0 g 0 G '+num(Math.max(0.3,fs*0.05))+' w\n';
      for(let i=0;i<=p.last;i++){
        const row=p.rows[i]; if(!row) continue;
        let txt='', bold='', hasBold=false;
        const base=ph-margin-i*lineH-lineH*0.5-fs*0.3;
        for(let k=0;k<row.length;k++){
          const cell=row[k];
          if(!cell){ txt+=' '; bold+=' '; continue; }
          txt+=cell.c;
          if(cell.b){ bold+=cell.c; hasBold=true; } else bold+=' ';
          if(cell.u){
            const y=base-fs*0.12;
            c+=num(left+k*cw)+' '+num(y)+' m '+num(left+(k+1)*cw)+' '+num(y)+' l S\n';
          }
        }
        txt=txt.replace(/ +$/,'');
        if(txt) c+='BT /F1 '+num(fs)+' Tf '+num(left)+' '+num(base)+' Td ('+esc(txt)+') Tj ET\n';
        if(hasBold){
          bold=bold.replace(/ +$/,'');
          c+='BT /F1 '+num(fs)+' Tf '+num(left+0.3)+' '+num(base)+' Td ('+esc(bold)+') Tj ET\n';
        }
      }
      streams.push(c);
    }

    // objects: 1 catalog, 2 pages tree, 3 font, 4 info, then (page, content) pairs
    const objs=[];
    const kids=[];
    for(let i=0;i<pages.length;i++) kids.push((5+2*i)+' 0 R');
    objs[1]='<< /Type /Catalog /Pages 2 0 R >>';
    objs[2]='<< /Type /Pages /Kids ['+kids.join(' ')+'] /Count '+pages.length+' >>';
    objs[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
    objs[4]='<< /Title ('+esc(ascii(title))+') /Producer (BASIC2-JS) >>';
    for(let i=0;i<pages.length;i++){
      objs[5+2*i]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+num(pw)+' '+num(ph)+'] '+
        '/Resources << /Font << /F1 3 0 R >> /ProcSet [/PDF /Text] >> /Contents '+(6+2*i)+' 0 R >>';
      objs[6+2*i]='<< /Length '+streams[i].length+' >>\nstream\n'+streams[i]+'endstream';
    }
    const n=objs.length;
    let pdf='%PDF-1.4\n';
    const offs=[];
    for(let i=1;i<n;i++){
      offs[i]=pdf.length;
      pdf+=i+' 0 obj\n'+objs[i]+'\nendobj\n';
    }
    const xref=pdf.length;
    pdf+='xref\n0 '+n+'\n0000000000 65535 f \n';
    for(let i=1;i<n;i++) pdf+=String(offs[i]).padStart(10,'0')+' 00000 n \n';
    pdf+='trailer\n<< /Size '+n+' /Root 1 0 R /Info 4 0 R >>\nstartxref\n'+xref+'\n%%EOF';
    const bytes=new Uint8Array(pdf.length);
    for(let i=0;i<pdf.length;i++) bytes[i]=pdf.charCodeAt(i)&0xFF;
    return bytes;
  }
}

if(typeof module!=='undefined') module.exports={Printer};
