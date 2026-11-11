'use strict';
// Tests for src/printer.js (plain Node, no framework)
const fs=require('fs'), os=require('os'), path=require('path'), cp=require('child_process');
const {Printer}=require('../src/printer.js');

let fails=0, total=0;
function ok(cond,msg){ total++; if(!cond){ fails++; console.log('FAIL: '+msg); } }
function eq(a,b,msg){ ok(a===b,msg+' (got '+JSON.stringify(a)+', expected '+JSON.stringify(b)+')'); }
const str=u8=>{ let s=''; for(let i=0;i<u8.length;i++) s+=String.fromCharCode(u8[i]); return s; };

// --- text model ---
let p=new Printer({cols:20,rows:5});
ok(p.isEmpty(),'new printer is empty');
eq(p.pageCount(),0,'empty pageCount');
p.print('HELLO\r\nWORLD\r\n');
eq(p.getText(),'HELLO\nWORLD','CR/LF text');
eq(p.lineCount(),2,'lineCount');
eq(p.pageCount(),1,'pageCount 1');
ok(!p.isEmpty(),'not empty');

// LF alone keeps the column; CR alone does not advance (overprint)
p=new Printer({cols:20,rows:5});
p.print('AB\nCD');
eq(p.getText(),'AB\n  CD','LF keeps column');
p=new Printer({cols:20,rows:5});
p.print('ABC\rX');
eq(p.getText(),'XBC','CR overwrites in place');
eq(p.cx,1,'cx after CR+char');

// backspace
p=new Printer({cols:20,rows:5});
p.print('AB\x08\x08\x08\x08Z');
eq(p.getText(),'ZB','backspace clamps at 0');

// tab
p=new Printer({cols:40,rows:5});
p.print('A\tB\t\tC');
eq(p.getText(),'A       B               C','tab to multiples of 8');

// ignored controls, high bytes
p=new Printer({cols:20,rows:5});
[0x01,0x02,0x03,0x07,0x0B,0x0E,0x1B,0x1F,0x7F].forEach(b=>p.out(b));
ok(p.isEmpty(),'ignored control bytes print nothing');
p.out(0x41); p.out(0x01); p.out(0xFF); p.out(0x80); p.out(0x42);
eq(p.getText(),'A..B','ignored controls and >=0x80 -> "."');

// form feed
p=new Printer({cols:20,rows:5});
p.print('P1\f\rP2');
eq(p.pageCount(),2,'FF starts a new page');
eq(p.getText(),'P1\fP2','page separation uses a real form feed');
ok(p.getText().indexOf(String.fromCharCode(12))>0,'form feed char 0x0C present');
p=new Printer({cols:20,rows:5});
p.print('\f\f');
ok(p.isEmpty(),'FF on empty printer creates no page');
p.print('A\f\f\fB');
eq(p.pageCount(),2,'repeated FF does not create empty pages');
eq(p.cy,0,'cy after FF');

// automatic page break
p=new Printer({cols:10,rows:3});
p.print('1\r\n2\r\n3\r\n4\r\n');
eq(p.pageCount(),2,'auto page break after rows lines (no trailing empty page)');
eq(p.getText(),'1\n2\n3\f4','auto page text');
p.print('5');
eq(p.getText(),'1\n2\n3\f4\n5','continues on page 2');

// wrapping
p=new Printer({cols:5,rows:10});
p.print('ABCDEFGHIJK');
eq(p.getText(),'ABCDE\nFGHIJ\nK','wrap at cols');
p=new Printer({cols:5,rows:10});
p.print('ABCDE\r\nF');
eq(p.getText(),'ABCDE\nF','CR LF after full line gives no blank line');
p=new Printer({cols:5,rows:2});
p.print('ABCDEFGHIJK');
eq(p.getText(),'ABCDE\nFGHIJ\fK','wrap on last line starts a new page');

// CRT-compatible no-ops and properties
p=new Printer({cols:20,rows:5});
p.at(3,4); p.atClear(1,1,5); p.drawBox(0,0,3,3,true);
ok(p.isEmpty(),'at/atClear/drawBox are harmless');
eq(p.cols,20,'cols'); eq(p.rows,5,'rows');
p.cx=7; p.out(0x58);
eq(p.getText(),'       X','cx is writable');
p.clear();
ok(p.isEmpty() && p.cx===0 && p.cy===0,'clear empties');
p=new Printer();
eq(p.cols,132,'default cols'); eq(p.rows,66,'default rows');

// overstrike model
p=new Printer({cols:20,rows:5});
p.print('A\x08_');
eq(p.getText(),'A','underline keeps letter');
eq(p.pages[0].rows[0][0].u,true,'underline flag');
p.print('\rB\x08B');
eq(p.pages[0].rows[0][0].b,true,'bold flag on repeat');
eq(p.pages[0].rows[0][0].c,'B','last char shown');

// --- PDF structure ---
function checkPDF(pdf,label){
  const s=str(pdf);
  ok(s.startsWith('%PDF-1.4'),label+': header');
  ok(s.endsWith('%%EOF'),label+': ends with %%EOF');
  ok(/^[\x00-\x7F]*$/.test(s),label+': ASCII only');
  const sx=/startxref\n(\d+)\n%%EOF$/.exec(s);
  ok(!!sx,label+': startxref');
  if(!sx) return s;
  const xo=+sx[1];
  ok(s.substr(xo,4)==='xref',label+': startxref points at xref');
  const m=/^xref\n0 (\d+)\n/.exec(s.substr(xo));
  ok(!!m,label+': xref header');
  const n=+m[1];
  const tr=/trailer\n<< \/Size (\d+) \/Root (\d+) 0 R/.exec(s);
  ok(tr && +tr[1]===n && +tr[2]===1,label+': trailer /Size and /Root');
  const tab=s.substr(xo+m[0].length);
  ok(tab.substr(0,20)==='0000000000 65535 f \n',label+': free entry is 20 bytes');
  for(let i=1;i<n;i++){
    const e=tab.substr(i*20,20);
    ok(/^\d{10} 00000 n \n$/.test(e),label+': xref entry '+i+' format');
    const off=+e.substr(0,10);
    ok(s.substr(off,(i+' 0 obj').length)===i+' 0 obj',label+': offset of object '+i);
  }
  // stream lengths
  const re=/<< \/Length (\d+) >>\nstream\n/g; let mm;
  while((mm=re.exec(s))){
    const st=mm.index+mm[0].length, len=+mm[1];
    ok(s.substr(st+len,10)==='endstream\n'.substr(0,10)||s.substr(st+len,9)==='endstream',label+': stream /Length exact');
  }
  return s;
}

p=new Printer({cols:20,rows:5,title:'My (test) \\ job'});
p.print('Hello (world) \\ back\r\nline 2\f\r');
p.print('page two');
let pdf=p.toPDF();
ok(pdf instanceof Uint8Array,'toPDF returns Uint8Array');
let s=checkPDF(pdf,'basic');
ok(new RegExp('/Count '+p.pageCount()+' ').test(s),'/Count equals pageCount');
eq((s.match(/\/Type \/Page /g)||[]).length,p.pageCount(),'one page object per page');
ok(s.indexOf('(Hello \\(world\\) \\\\ back) Tj')>0,'text escaped in content stream');
ok(s.indexOf('(line 2) Tj')>0,'second line present');
ok(s.indexOf('(page two) Tj')>0,'page 2 text present');
ok(s.indexOf('/Title (My \\(test\\) \\\\ job)')>0,'title escaped');
ok(s.indexOf('/BaseFont /Courier')>0 && s.indexOf('/WinAnsiEncoding')>0,'Courier WinAnsi');
ok(s.indexOf('/FontFile')<0,'font not embedded');
ok(s.indexOf('/Title (Custom)')<0 && /\/Title \(Over\)/.test(str(p.toPDF({title:'Over'}))),'opts.title override');

// page sizes and orientation
const box=pdfBytes=>{ const m=/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(str(pdfBytes)); return [+m[1],+m[2]]; };
let b=box(new Printer({cols:80,rows:60}).toPDF());
eq(b.join(','),'612,792','auto portrait letter for 80 cols');
b=box(new Printer({cols:132,rows:66}).toPDF());
eq(b.join(','),'792,612','auto landscape letter for 132 cols');
b=box(new Printer({cols:96,rows:66}).toPDF());
eq(b.join(','),'612,792','96 cols is still portrait');
b=box(new Printer({cols:80,paper:'a4'}).toPDF());
eq(b.join(','),'595.28,841.89','a4 portrait');
b=box(new Printer({cols:80,paper:'a4',orientation:'landscape'}).toPDF());
eq(b.join(','),'841.89,595.28','a4 landscape');
b=box(new Printer({cols:132}).toPDF({orientation:'portrait'}));
eq(b.join(','),'612,792','toPDF orientation override');

// greenbar
p=new Printer({cols:20,rows:9});
p.print('x\n');
ok(str(p.toPDF()).indexOf('0.84 0.95 0.84 rg')<0,'no shading by default');
s=str(p.toPDF({greenbar:true}));
ok(s.indexOf('0.84 0.95 0.84 rg')>0 && / re f\n/.test(s),'greenbar adds shading ops');
eq((s.match(/ re f\n/g)||[]).length,1,'9 rows -> one shaded band of 3 lines');
p=new Printer({cols:20,rows:9,greenbar:true}); p.print('x');
ok(str(p.toPDF()).indexOf('0.84 0.95 0.84 rg')>0,'greenbar from constructor');

// overstrike in PDF
p=new Printer({cols:20,rows:5});
p.print('U\x08_ B\x08B');
s=str(p.toPDF());
ok(/ m [\d.]+ [\d.]+ l S\n/.test(s),'underline drawn as a line');
eq((s.match(/ Tj ET/g)||[]).length,2,'main text + bold pass');
p=new Printer({cols:20,rows:5}); p.print('plain');
eq((str(p.toPDF()).match(/ Tj ET/g)||[]).length,1,'no bold pass for plain text');

// empty printer
p=new Printer();
pdf=p.toPDF();
s=checkPDF(pdf,'empty');
ok(/\/Count 1 /.test(s),'empty printer has 1 page');

// many pages
p=new Printer({cols:10,rows:2});
for(let i=0;i<7;i++) p.print('L'+i+'\n');
pdf=p.toPDF(); s=checkPDF(pdf,'multi');
ok(new RegExp('/Count '+p.pageCount()+' ').test(s) && p.pageCount()===4,'multi-page count');

// --- optional pypdf verification ---
function havePypdf(){
  for(const py of ['python','python3','py']){
    try{ const r=cp.spawnSync(py,['-c','import pypdf'],{stdio:'ignore'}); if(r.status===0) return py; }catch(e){}
  }
  return null;
}
const py=havePypdf();
if(!py) console.log('pypdf not available: skipping external PDF verification');
else{
  p=new Printer({cols:40,rows:10,title:'T'});
  p.print('First (page) \\ ok\r\nSecond line\f\rSecond page');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'prn-'));
  const f=path.join(tmp,'t.pdf'), script=path.join(tmp,'chk.py');
  fs.writeFileSync(f,p.toPDF());
  fs.writeFileSync(script,
    'import sys, pypdf\n'+
    'r = pypdf.PdfReader(sys.argv[1])\n'+
    'print(len(r.pages))\n'+
    'for pg in r.pages:\n'+
    '    print(repr(pg.extract_text()))\n');
  const r=cp.spawnSync(py,[script,f],{encoding:'utf8'});
  const lines=(r.stdout||'').split(/\r?\n/);
  eq(r.status,0,'pypdf ran ('+(r.stderr||'').trim().slice(0,200)+')');
  eq(lines[0],'2','pypdf page count');
  ok((lines[1]||'').indexOf('First (page) \\\\ ok')>=0,'pypdf text page 1: '+lines[1]);
  ok((lines[1]||'').indexOf('Second line')>=0,'pypdf text page 1 line 2');
  ok((lines[2]||'').indexOf('Second page')>=0,'pypdf text page 2: '+lines[2]);
  try{ fs.rmSync(tmp,{recursive:true,force:true}); }catch(e){}
}

if(fails){ console.log(fails+' TESTS FAILED'); process.exit(1); }
console.log('all tests passed ('+total+' checks)');
