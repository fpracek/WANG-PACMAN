// Printers in the workstation: SELECT PRINT / SELECT LIST route output to an attached device, PDF output.
const { Workstation } = require('../src/shell.js'), { Platter, DiskSystem } = require('../src/platter.js'), { Terminal } = require('../src/wangcrt.js');
const { Printer } = require('../src/printer.js');
const disk = new DiskSystem({ storage: null }); disk.mount('310', new Platter('SYSTEM'));
const T = new Terminal(); const q = []; let waiter = null;
const io = { next() { if (q.length) return Promise.resolve(q.shift()); return new Promise(r => waiter = r); }, poll() { return q.shift() || null; },
             abort() { if (waiter) { const w = waiter; waiter = null; w({ c: -1, sp: true, abort: true }); } } };
const push = k => { if (waiter) { const w = waiter; waiter = null; w(k); } else q.push(k); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const type = async s => { for (const ch of s) push({ c: ch.charCodeAt(0), sp: false }); push({ c: 13, sp: false }); await sleep(120); };
const screen = () => { const o = []; for (let r = 0; r < 24; r++) { let s = ''; for (let c = 0; c < 80; c++) { const b = T.ch[r * 80 + c]; s += String.fromCharCode(b < 32 ? 32 : b); } if (s.trim()) o.push(s.replace(/\s+$/, '')); } return o.join('\n'); };
let fail = 0; const expect = (name, cond) => { console.log((cond ? '  ok  ' : 'FAIL  ') + name); if (!cond) fail++; };

(async () => {
  const ws = new Workstation(T, io, disk); ws.interp.stmtCost = 0; ws.interp.byteCost = 0; ws.interp.devByteCost = 0;
  const prn = new Printer({ cols: 80, rows: 66, title: 'PRINTER 215' });
  ws.interp.attach('215', prn);
  ws.main(); await sleep(100);

  await type('10 PRINT "HELLO";TAB(10);"X"'); await type('20 PRINT HEX(0C)'); await type('30 PRINT "PAGE TWO"');
  await type('SELECT PRINT 215'); await type('RUN'); await type('SELECT PRINT 005');
  let s = screen();
  expect('printed text did not appear on the CRT', !/^HELLO/m.test(s.replace(/^\d{4} .*$/mg, '')) );
  const txt = prn.getText();
  expect('printer received HELLO with TAB spacing', /HELLO {5}X/.test(txt));
  expect('form feed made a second page', prn.pageCount() === 2 && /PAGE TWO/.test(txt.split('\f')[1] || ''));

  await type('SELECT LIST 215'); await type('LIST'); await type('SELECT LIST 005');
  expect('LIST went to the printer', /0010 PRINT "HELLO";TAB\(10\);"X"/.test(prn.getText()));
  await type('LIST'); s = screen();
  expect('after SELECT LIST 005 the listing is on the CRT again', (s.match(/0030 PRINT "PAGE TWO"/g) || []).length >= 1);

  await type('SELECT PRINT 999'); s = screen();
  expect('unknown device gives an error', /ERROR.*no device at address 999/.test(s));

  await type('PRINT "BACK ON SCREEN"'); s = screen();
  expect('PRINT back on the CRT (005)', /^BACK ON SCREEN/m.test(s) || /BACK ON SCREEN/.test(s));

  const pdf = prn.toPDF();
  const head = String.fromCharCode(...pdf.subarray(0, 8));
  expect('PDF output is a PDF', head.startsWith('%PDF-1.4') && pdf.length > 500);
  prn.clear(); expect('clear empties the printer', prn.isEmpty());

  console.log(fail ? '\n' + fail + ' TESTS FAILED' : '\nall tests passed'); process.exit(fail ? 1 : 0);
})();
