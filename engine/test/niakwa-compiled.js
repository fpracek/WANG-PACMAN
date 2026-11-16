// Niakwa BASIC-2C object code ("BC Rev ...") is recognised; what can be decompiled becomes a listing. Synthetic image only.
const I = require('../src/image.js'), BD = require('../src/bcdecomp.js'), { Workstation } = require('../src/shell.js'), { Platter, DiskSystem } = require('../src/platter.js'), { Terminal } = require('../src/wangcrt.js');
let fail = 0; const expect = (n, c) => { console.log((c ? '  ok  ' : 'FAIL  ') + n); if (!c) fail++; };
const enc = s => Array.from(s).map(c => c.charCodeAt(0));
const hdr = [0x0e, 0x00, ...enc('BC Rev 1.01.00')];
// line 10: REM - @BACK ; line 20: unknown token ; line 30: GOTO 10 ; end marker
const prog = [...hdr,
  0x10, 0x00, 0x10, 0x00, 0x61, 0x00, 0xd2, 0x08, 0x00, 0x00, ...enc('- @BACK'), 0x77, 0x00, 0x00,
  0x20, 0x00, 0x06, 0x00, 0x61, 0x00, 0xee, 0x77, 0x00, 0x00,
  0x30, 0x00, 0x08, 0x00, 0x61, 0x00, 0x69, 0x10, 0x00, 0x77, 0x00, 0x00,
  0xff, 0xff, 0x00, 0x00];
const secs = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
secs[0].set([0x00, 1, 0, 4, 0, 4]);
secs[0].set([0x10, 0x80, 0, 1, 0, 1, 0, 0, ...enc('DEC     ')], 16);        // decodable
secs[0].set([0x10, 0x80, 0, 2, 0, 2, 0, 0, ...enc('STUB    ')], 32);       // header only
secs[0].set([0x10, 0x80, 0, 4, 0, 4, 0, 0, ...enc('PLAIN   ')], 48);       // ordinary tokenized program
secs[1].set(prog);
secs[2].set([0x0e, 0x00, ...enc('BC Rev 1.04.00'), 0xff, 0xff, 0, 0]);
secs[4].set([0x20, 0xff, 0x00, 0x10, 0xa2, ...enc('HI'), 0x0d, 0, 0, 0xfe]);
const img = new Uint8Array(5 * 256); secs.forEach((s, i) => img.set(s, i * 256));
const pl = I.platterSetFromImage(img, 'T.BS2')[0];
expect('compiled programs are flagged with their revision', pl.get('DEC').compiled === 'BC Rev 1.01.00' && pl.get('STUB').compiled === 'BC Rev 1.04.00');
expect('ordinary program is not flagged', !pl.get('PLAIN').compiled);
const d = BD.decompileProgram(Uint8Array.from(prog));
expect('decompiler: 3 lines, 1 not decoded', d.total === 3 && d.failed === 1);
expect('decompiler: REM and GOTO come back', /^10REM - @BACK$/m.test(d.text) && /^30GOTO 10$/m.test(d.text) && /^20REM \*\*\* NOT DECODED/m.test(d.text));
expect('platter holds the decompiled text', /^30GOTO 10$/m.test(pl.get('DEC').text) && pl.get('DEC').decompiled.failed === 1);
const disk = new DiskSystem({ storage: null }); disk.mount('310', new Platter('S')); disk.mountImage(img, 'T.BS2');
const T = new Terminal(), q = []; let w = null;
const io = { next() { if (q.length) return Promise.resolve(q.shift()); return new Promise(r => w = r); }, poll() { return q.shift() || null; }, abort() {} };
const push = k => { if (w) { const x = w; w = null; x(k); } else q.push(k); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const type = async s => { for (const ch of s) push({ c: ch.charCodeAt(0), sp: false }); push({ c: 13, sp: false }); await sleep(200); };
const screen = () => Array.from(T.ch).map(b => String.fromCharCode(b < 32 ? 32 : b)).join('');
(async () => {
  const ws = new Workstation(T, io, disk); ws.main(); await sleep(100);
  await type('LOAD "DEC"');
  let s = screen(); expect('LOAD gives the decompiled lines and says so', /LOADED DEC \(3 LINES\)/.test(s) && /DECOMPILED FROM NIAKWA OBJECT CODE: 1 OF 3/.test(s));
  await type('NEW'); await type('LOAD "STUB"');
  s = screen(); expect('LOAD of an undecodable program explains why not', /NIAKWA COMPILED PROGRAM/.test(s) && !/LOADED STUB/.test(s));
  console.log(fail ? '\n' + fail + ' TESTS FAILED' : '\nall tests passed'); process.exit(fail ? 1 : 0);
})();
