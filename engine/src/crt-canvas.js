/* ================= Canvas renderer (real 2236 font + phosphor effect) ================= */
const glyphCache=new Map();
function glyphRows(ch,alt,under){
  const key=ch|(alt?128:0)|(under?256:0);
  let g=glyphCache.get(key); if(g) return g;
  const t=alt?FONT_A:FONT_N, block=alt&&ch>=0x40; g=new Array(11);
  for(let r=0;r<11;r++){
    let p;
    if(block) p = r<2 ? t[8*ch+(r&1)] : r<10 ? t[8*ch+r-2] : t[8*ch+6+(r&1)];
    else p = (r<2||r>=10) ? 0 : t[8*ch+r-2];
    p<<=1;
    if(block) p |= ((p<<2)&0x200)|((p>>2)&1);   // blocks fill the cell (like the hardware)
    if(under&&ch>=0x10&&r===10) p=0x55<<1;
    g[r]=p;
  }
  glyphCache.set(key,g); return g;
}
/* createCrtRenderer(canvas): returns render(terminal, blinkOn). Requires FONT_N/FONT_A (font.js). */
function createCrtRenderer(cv){
const ctx=cv.getContext('2d');
const img=ctx.createImageData(W,H), lum=new Float32Array(W*H);
return function render(T,blinkOn){
  lum.fill(0);
  for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
    const i=r*COLS+c, f=T.fl[i], ch=T.ch[i], inv=!!(f&FL_INV);
    if(ch===0x20&&!inv&&!(f&FL_ALT)&&!(f&FL_UNDER)) continue;
    if((f&FL_BLINK)&&!blinkOn) continue;
    const I=(f&FL_BRIGHT)?1:0.55, rows=glyphRows(ch,!!(f&FL_ALT),!!(f&FL_UNDER));
    for(let p=0;p<11;p++){
      let v=rows[p]; if(inv) v=~v&0x3FF;
      if(!v) continue;
      const y=r*CH+p*2;
      for(let x=0;x<10;x++) if((v>>(9-x))&1){
        const o=y*W+c*CW+x; lum[o]=I; lum[o+W]=I*0.8;
      }
    }
  }
  // cursor (if on): blinking block under the character
  if(T.cursorVisible && blinkOn){
    for(let p=7;p<11;p++) for(let x=0;x<9;x++){ const o=(T.cy*CH+p*2)*W+T.cx*CW+x; lum[o]=1; lum[o+W]=1; }
  }
  // boxes (BOX) at normal intensity
  const line=(x0,x1,y0,y1)=>{ for(let y=y0;y<y1&&y<H;y++) for(let x=x0;x<x1&&x<W;x++){ const o=y*W+x; if(lum[o]<0.6) lum[o]=0.6; } };
  for(let r=0;r<=ROWS;r++) for(let c=0;c<COLS;c++){
    const b=T.box[r*COLS+c]; if(!b) continue;
    if(b&1) line(c*CW,c*CW+5,r*CH,r*CH+2);
    if(b&2) line(c*CW+5,c*CW+10,r*CH,r*CH+2);
    if(b&4) line(c*CW+4,c*CW+6,r*CH,r*CH+CH+1);
  }
  const d=img.data;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const o=y*W+x;
    let v=lum[o]+0.28*((x>0?lum[o-1]:0)+(x<W-1?lum[o+1]:0)); if(v>1) v=1;
    const q=o*4; d[q]=4+v*116; d[q+1]=10+v*245; d[q+2]=6+v*124; d[q+3]=255;
  }
  ctx.putImageData(img,0,0);
}
}
