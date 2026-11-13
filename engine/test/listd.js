// Pretty-printed ("listd") listings and the statements a real program needed. All data here is synthetic.
const { Interp, Parser } = require('../src/basic2.js'), { Platter, DiskSystem } = require('../src/platter.js'), { Terminal } = require('../src/wangcrt.js');
let fail = 0; const expect = (name, cond) => { console.log((cond ? '  ok  ' : 'FAIL  ') + name); if (!cond) fail++; };

/* ---- joining continuation lines ---- */
const wrap78 = '0200 PRINT "' + 'X'.repeat(66);                 // 78 characters: the wrap did not eat a space
const wrap77 = '0210 PRINT "' + 'X'.repeat(65);                 // 77 characters: the wrap ate a space
const lines = [
  '# Sector 1, program filename = \'T\'',
  '0010 REM first',
  wrap78, '     Y";AT(1,1);"Z"',
  wrap77, '     Y"',
  '0220 IF A=1 THEN PRINT "ONE"',
  '   : ELSE PRINT "OTHER"',
  '   : A=5',
  '0230 DIM A(4),B(4),B1(4),C(4),C1(4),C2(4),A1(4),A2(4),D(5),D1(5),D2(5),E(5),F(',
  '     5),M(80)',
];
const joined = Interp.joinListd(lines);
expect('header comment and plain lines are kept', joined[0][0] === '#' && joined[1] === '0010 REM first');
expect('78-column wrap is joined without a space', joined[2] === wrap78 + 'Y";AT(1,1);"Z"');
expect('77-column wrap gets the lost space back', joined[3] === wrap77 + ' Y"');
expect('"   : stmt" continuation becomes ":stmt"', joined[4] === '0220 IF A=1 THEN PRINT "ONE":ELSE PRINT "OTHER":A=5');
expect('a statement cut in the middle is rejoined', joined[5].endsWith('F(5),M(80)'));
const clean = '10REM A\n20PRINT "X"\n';
expect('clean listings (list format) are untouched', JSON.stringify(Interp.parseListing(clean)) === JSON.stringify([{ no: 10, src: 'REM A' }, { no: 20, src: 'PRINT "X"' }]));

/* ---- running a pretty-printed program ---- */
const listd = [
  '0010 DIM A(4),B$5,C(3),',
  '     D(3)',
  '0020 DATA 11,12,10,10',
  '0030 RESTORE LINE 20,3',
  '0040 READ X',
  '0050 PRINT "X=";X',
  '0060 IF X<>=10 THEN PRINT "DIFF"',
  '   : ELSE PRINT "SAME"',
  '0070 PRINT AT(5,0);;"TWO SEMIS"',
  '0080 GOSUB \'31 (7)',
  '0090 PRINT "Y2=";Y2',
  '0100 INPUT "NUM";Z',
  '0110 PRINT "Z=";Z',
  '0120 STOP',
  '0130 DEFFN \'31 (Q)',
  '0140 Y2=Q*2',
  '0150 RETURN',
].join('\n');

function machine() {
  const disk = new DiskSystem({ storage: null }); disk.mount('310', new Platter('S'));
  const T = new Terminal(); const q = []; let waiter = null;
  const io = { next() { if (q.length) return Promise.resolve(q.shift()); return new Promise(r => waiter = r); }, poll() { return q.shift() || null; },
               abort() { if (waiter) { const w = waiter; waiter = null; w({ c: -1, sp: true, abort: true }); } } };
  const push = k => { if (waiter) { const w = waiter; waiter = null; w(k); } else q.push(k); };
  const it = new Interp(T, io, disk); it.reportErrors = false; it.returnErrors = true; it.stmtCost = 0; it.byteCost = 0;
  const screen = () => { const o = []; for (let r = 0; r < 24; r++) { let s = ''; for (let c = 0; c < 80; c++) { const b = T.ch[r * 80 + c]; s += String.fromCharCode(b < 32 ? 32 : b); } if (s.trim()) o.push(s.replace(/\s+$/, '')); } return o.join('\n'); };
  return { it, T, push, screen };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let m = machine();
  m.it.setProgram(Interp.parseListing(listd));
  const run = m.it.runFrom(null);
  await sleep(100); for (const ch of '42') m.push({ c: ch.charCodeAt(0) }); m.push({ c: 13 });
  const res = await run; const s = m.screen();
  expect('the whole program runs to its STOP', res.status === 'stop' && res.line === 120);
  expect('RESTORE LINE 20,3 starts at the third DATA item (10)', /X= 10/.test(s));
  expect('<>= means <> (10<>10 is false -> SAME)', /SAME/.test(s) && !/DIFF/.test(s));
  expect('";;" between PRINT items is tolerated', /TWO SEMIS/.test(s));
  expect('DEFFN \'31 (Q) with a space keeps its parameter', /Y2= 14/.test(s));
  expect('INPUT shows the prompt and reads a number', /NUM42?/.test(s.replace(/\s+/g, '')) || /NUM/.test(s));
  expect('INPUT stored the value', /Z= 42/.test(s));

  // the parser always makes progress, LOAD RUN parses, LOAD without a name is an error (it used to hang)
  expect('LOAD RUN parses to its own statement', JSON.stringify(new Parser('LOAD RUN').parseLine()) === JSON.stringify([{ t: 'loadrun' }]));
  let msg = ''; try { new Parser('LOAD').parseLine(); } catch (e) { msg = e.message; }
  expect('LOAD without a file name is an error, not an endless loop', /file name expected/.test(msg));

  // LOAD RUN restarts the program in memory
  m = machine();
  m.it.setProgram(Interp.parseListing('0010 PRINT "RUN"\n0020 LOAD RUN\n'));
  const p2 = m.it.runFrom(null); await sleep(150); m.it.halt(); await p2;
  const n = (m.screen().match(/RUN/g) || []).length + (m.T.cy > 0 ? 0 : 0);
  expect('LOAD RUN starts again from line 10 (the program printed more than once)', n >= 2 || m.T.cy >= 2);

  console.log(fail ? '\n' + fail + ' TESTS FAILED' : '\nall tests passed'); process.exit(fail ? 1 : 0);
})();
