// Disk images (.bs2 raw sectors and .wvd) built in memory: catalog, tokenized program, data file, mounting, LOAD/RUN.
const { Workstation } = require('../src/shell.js'), { Platter, DiskSystem } = require('../src/platter.js'), { Terminal } = require('../src/wangcrt.js');
const { platterSetFromImage, readCatalog, splitImage, listProgramRecord } = require('../src/image.js');
let fail = 0; const expect = (name, cond) => { console.log((cond ? '  ok  ' : 'FAIL  ') + name); if (!cond) fail++; };

const enc = s => Array.from(s).map(c => c.charCodeAt(0));
const sector = bytes => { const s = new Uint8Array(256); s.set(bytes); return s; };
const nameBytes = n => enc(n.padEnd(8, ' '));
// disk with 5 sectors: 0 = parameter block + catalog, 1-2 = program HELLO, 3 = data file, 4 = a scratched program (ignored)
function makeSectors() {
  const s0 = new Uint8Array(256);
  s0.set([0x00, 1, 0, 5, 0, 5]);                               // index type 0, 1 index sector, current end, end of catalog area
  const entry = (i, state, type, start, end, name) => s0.set([state, type, start >> 8, start & 255, end >> 8, end & 255, 0, 0, ...nameBytes(name)], i * 16);
  entry(1, 0x10, 0x80, 1, 2, 'HELLO');
  entry(2, 0x10, 0x00, 3, 3, 'DATA1');
  entry(3, 0x11, 0x80, 4, 4, 'GONE');
  const header = sector([0x40, ...nameBytes('HELLO'), 0xFD]);
  // trailer record: line 10 PRINT "HI"  /  line 20 FOR I=1 TO 2:PRINT I:NEXT I   (tokens: A0 PRINT, 9E FOR, B2 TO, 9D NEXT)
  const body = sector([0x20,
    0xFF, 0x00, 0x10, 0xA0, ...enc('"HI"'), 0x0D, 0x00, 0x00,
    0xFF, 0x00, 0x20, 0x9E, ...enc('I=1'), 0xB2, ...enc('2:'), 0xA0, ...enc('I:'), 0x9D, ...enc('I'), 0x0D, 0x00, 0x00, 0xFE]);
  const data = sector([0x80, 1, 2, 3]);
  return [s0, header, body, data, sector([0x40, ...nameBytes('GONE'), 0xFD])];
}
const concat = ss => { const b = new Uint8Array(ss.length * 256); ss.forEach((s, i) => b.set(s, i * 256)); return b; };
const bs2 = concat(makeSectors());
const wvd = (() => { const h = new Uint8Array(256); h.set([0x57, 0x41, 0x4E, 0x47, 0, 0, 0, 0, 5, 0, 0, 0]); h.set(enc('TEST DISK'), 16); const b = new Uint8Array(256 + bs2.length); b.set(h); b.set(bs2, 256); return b; })();

const cat = readCatalog(splitImage(bs2, 'T.BS2')[0].sectors);
expect('catalog: type 0, 1 index sector, 3 entries', cat.indexType === 0 && cat.indexSectors === 1 && cat.files.length === 3);
const [p] = platterSetFromImage(bs2, 'TEST.BS2');
expect('mounted platter is read-only and named after the file', p.readOnly && p.label === 'TEST');
expect('scratched file is skipped, program and data file listed', p.list().map(f => f.name).sort().join() === 'DATA1,HELLO');
expect('data file is exposed as raw sectors', p.get('DATA1').raw.length === 256 && p.list().find(f => f.name === 'DATA1').unit === 'sectors');
const text = p.get('HELLO').text;
expect('program is detokenized', /^10PRINT "HI"$/m.test(text) && /^20FOR I=1TO 2:PRINT I:NEXT I$/m.test(text));
expect('header comment carries the file name', /# Sector 1, program filename = 'HELLO'/.test(text));
const [pw] = platterSetFromImage(wvd, 'T.wvd');
expect('.wvd: label from the header, same files', pw.label === 'TEST DISK' && pw.list().length === 2 && pw.get('HELLO').text === text.replace('Sector 1', 'Sector 1'));

// scrambled records are not mistaken for plain text: control byte pattern 0x1x with bit 7 of byte 1 clear
const plain = listProgramRecord(sector([0x00, 0xFF, 0x00, 0x10, 0xA2, ...enc('X'), 0x0D, 0, 0, 0xFD]), 7);
expect('a body record lists as lines', plain.length === 1 && plain[0] === '10REM X');

// mount through the DiskSystem and use it from the prompt
(async () => {
  const disk = new DiskSystem({ storage: null }); disk.mount('310', new Platter('SYSTEM'));
  const used = disk.mountImage(bs2, 'GAMES.BS2');
  expect('mountImage picks the first free address after 310', used.join() === '320' && disk.drives.get('320').readOnly);
  expect('lookup ignores case for image names', disk.find('hello') && disk.find('hello').addr === '320');
  const T = new Terminal(); const q = []; let waiter = null;
  const io = { next() { if (q.length) return Promise.resolve(q.shift()); return new Promise(r => waiter = r); }, poll() { return q.shift() || null; }, abort() {} };
  const push = k => { if (waiter) { const w = waiter; waiter = null; w(k); } else q.push(k); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const type = async s => { for (const ch of s) push({ c: ch.charCodeAt(0), sp: false }); push({ c: 13, sp: false }); await sleep(120); };
  const screen = () => { const o = []; for (let r = 0; r < 24; r++) { let s = ''; for (let c = 0; c < 80; c++) { const x = T.ch[r * 80 + c]; s += String.fromCharCode(x < 32 ? 32 : x); } if (s.trim()) o.push(s.replace(/\s+$/, '')); } return o.join('\n'); };
  const ws = new Workstation(T, io, disk); ws.interp.stmtCost = 0; ws.interp.byteCost = 0; ws.main(); await sleep(80);
  await type('CATALOG 320'); let s = screen();
  expect('CATALOG shows image files', /HELLO\s+PROG/.test(s) && /DATA1\s+DATA\s+1 SECTORS/.test(s));
  await type('LOAD "HELLO"'); await type('RUN'); s = screen();
  expect('a program loaded from an image runs', /LOADED HELLO \(2 LINES\)/.test(s) && /^HI$/m.test(s) && /^ 1\s*$/m.test(s) && /^ 2\s*$/m.test(s));
  await type('SELECT DISK 320'); await type('SAVE "MINE"'); s = screen();
  expect('SAVE onto a read-only image is refused', /ERROR: platter is write-protected/.test(s));
  await type('SELECT DISK 310'); await type('SAVE "MINE"'); s = screen();
  expect('SAVE onto the writable drive works', /SAVED MINE ON DISK 310/.test(s));
  console.log(fail ? '\n' + fail + ' TESTS FAILED' : '\nall tests passed'); process.exit(fail ? 1 : 0);
})();
