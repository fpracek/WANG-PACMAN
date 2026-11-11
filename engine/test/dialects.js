// Dialect profiles: what each BASIC version accepts.
const { Parser, Interp } = require('../src/basic2.js');
const { getDialect, listDialects } = require('../src/dialects.js');
const { Workstation } = require('../src/shell.js'), { Platter, DiskSystem } = require('../src/platter.js'), { Terminal } = require('../src/wangcrt.js');
let fail = 0; const expect = (name, cond) => { console.log((cond ? '  ok  ' : 'FAIL  ') + name); if (!cond) fail++; };
const parses = (src, id) => { try { new Parser(src, getDialect(id)).parseLine(); return true; } catch (e) { return String(e.message); } };
const rejects = (src, id, what) => { const r = parses(src, id); return r !== true && new RegExp(what).test(r) && r.includes(getDialect(id).name); };

expect('four profiles are registered', listDialects().length >= 4 && ['wang-basic', 'basic2', 'basic2-pc', 'niakwa-2c'].every(i => getDialect(i)));
expect('unknown dialect is an error', (() => { try { getDialect('nope'); return false; } catch (e) { return /unknown dialect/.test(e.message); } })());

const ELSE = 'IF A=1 THEN PRINT "X": ELSE PRINT "Y"', LIN = 'LINPUT A$', AT = 'PRINT AT(1,1);"X"', BOX = 'PRINT BOX(3,4);', MOD = 'X=MOD(5,3)', MAXF = 'X=MAX(1,2)', LET = 'LET A=5';
for (const id of ['basic2', 'basic2-pc', 'niakwa-2c']) expect(id + ' accepts ELSE, LINPUT, AT(, BOX(, MOD(, LET', [ELSE, LIN, AT, BOX, MOD, LET].every(x => parses(x, id) === true));
expect('wang-basic rejects ELSE', rejects(ELSE, 'wang-basic', 'ELSE'));
expect('wang-basic rejects LINPUT', rejects(LIN, 'wang-basic', 'LINPUT'));
expect('wang-basic rejects AT(', rejects(AT, 'wang-basic', 'AT\\('));
expect('wang-basic rejects BOX(', rejects(BOX, 'wang-basic', 'BOX\\('));
expect('wang-basic rejects MOD( and MAX(', rejects(MOD, 'wang-basic', 'MOD\\(') && rejects(MAXF, 'wang-basic', 'MAX\\('));
expect('wang-basic still accepts the common language', ['A=1+2*3', 'PRINT "HI";A', 'FOR I=1 TO 3:NEXT I', 'IF A=1 THEN 100', 'LET A=5', 'DIM B(10)'].every(x => parses(x, 'wang-basic') === true));

// REM $PC: executed by Niakwa, a plain comment elsewhere
(async () => {
  const run = async id => {
    const disk = new DiskSystem({ storage: null }); disk.mount('310', new Platter('S'));
    const T = new Terminal(); const io = { next: () => new Promise(() => {}), poll: () => null };
    const it = new Interp(T, io, disk); it.reportErrors = false; it.returnErrors = true; it.setDialect(id);
    it.setProgram([{ no: 10, src: 'REM $PC PRINT "NPL"' }, { no: 20, src: 'PRINT "END"' }]);
    const res = await it.runFrom(null);
    let s = ''; for (let r = 0; r < 4; r++) { for (let c = 0; c < 20; c++) { const b = T.ch[r * 80 + c]; s += String.fromCharCode(b < 32 ? 32 : b); } s += '|'; }
    return { res, s };
  };
  const a = await run('niakwa-2c'), b = await run('basic2');
  expect('niakwa-2c executes REM $PC', /NPL/.test(a.s) && /END/.test(a.s));
  expect('basic2 treats REM $PC as a comment', !/NPL/.test(b.s) && /END/.test(b.s));

  // the DIALECT command in the prompt
  const disk = new DiskSystem({ storage: null }); disk.mount('310', new Platter('S'));
  const T = new Terminal(); const q = []; let waiter = null;
  const io = { next() { if (q.length) return Promise.resolve(q.shift()); return new Promise(r => waiter = r); }, poll() { return q.shift() || null; }, abort() {} };
  const push = k => { if (waiter) { const w = waiter; waiter = null; w(k); } else q.push(k); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const type = async s => { for (const ch of s) push({ c: ch.charCodeAt(0), sp: false }); push({ c: 13, sp: false }); await sleep(100); };
  const screen = () => { const o = []; for (let r = 0; r < 24; r++) { let s = ''; for (let c = 0; c < 80; c++) { const x = T.ch[r * 80 + c]; s += String.fromCharCode(x < 32 ? 32 : x); } if (s.trim()) o.push(s.replace(/\s+$/, '')); } return o.join('\n'); };
  const ws = new Workstation(T, io, disk); ws.interp.stmtCost = 0; ws.interp.byteCost = 0; ws.main(); await sleep(80);
  await type('DIALECT'); let s = screen();
  expect('DIALECT lists the profiles and marks the current one', /\* basic2/.test(s) && /niakwa-2c/.test(s));
  await type('DIALECT wang-basic'); await type('10 LINPUT A$'); s = screen();
  expect('in wang-basic a LINPUT line is refused at entry', /DIALECT: Wang BASIC/.test(s) && /ERROR: SYNTAX.*not available in Wang BASIC/.test(s));
  await type('DIALECT niakwa-2c'); await type('10 REM $PC PRINT "NPL OK"'); await type('RUN'); s = screen();
  expect('DIALECT niakwa-2c then RUN executes REM $PC', /NPL OK/.test(s.split('RUN').pop()));
  await type('DIALECT bogus'); s = screen(); expect('unknown dialect is reported', /ERROR: unknown dialect/.test(s));
  console.log(fail ? '\n' + fail + ' TESTS FAILED' : '\nall tests passed'); process.exit(fail ? 1 : 0);
})();
