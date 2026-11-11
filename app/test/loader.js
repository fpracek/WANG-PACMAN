// The loader extracts UNS-MAN and UNS-GAME from files the user provides (listings or disk images).
// Everything here is synthetic: no original program data is used.
const { collectPrograms, latin1 } = require('../loader.js');
let fail = 0; const expect = (name, cond) => { console.log((cond ? '  ok  ' : 'FAIL  ') + name); if (!cond) fail++; };
const WANTED = ['UNS-MAN', 'UNS-GAME'];
const enc = s => Array.from(s).map(c => c.charCodeAt(0));
const bytes = s => new Uint8Array(enc(s));

// a tiny disk: sector 0 = parameter block + catalog, then header + trailer sector per program
function makeImage(names) {
  const sectors = [new Uint8Array(256)];
  sectors[0].set([0x00, 1, 0, 1 + names.length * 2, 0, 1 + names.length * 2]);
  names.forEach((n, i) => {
    const start = 1 + i * 2;
    sectors[0].set([0x10, 0x80, start >> 8, start & 255, 0, start + 1, 0, 0, ...enc(n.padEnd(8, ' '))], (i + 1) * 16);
    const h = new Uint8Array(256); h.set([0x40, ...enc(n.padEnd(8, ' ')), 0xFD]);
    const b = new Uint8Array(256); b.set([0x20, 0xFF, 0x00, 0x10, 0xA2, ...enc(n), 0x0D, 0x00, 0x00, 0xFE]);   // 10REM <name>
    sectors.push(h, b);
  });
  const img = new Uint8Array(sectors.length * 256); sectors.forEach((s, i) => img.set(s, i * 256));
  return img;
}
const toWvd = img => { const h = new Uint8Array(256); h.set([0x57, 0x41, 0x4E, 0x47, 0, 0, 0, 0, img.length / 256 & 255, img.length / 256 >> 8, 0, 0]); h.set(enc('GAMES'), 16); const b = new Uint8Array(256 + img.length); b.set(h); b.set(img, 256); return b; };

let r = collectPrograms([{ name: 'UNS-MAN.txt', bytes: bytes('10REM MAN\n') }, { name: 'UNS-GAME.txt', bytes: bytes('10REM GAME\n') }], WANTED);
expect('two listings are collected', r.missing.length === 0 && r.programs['UNS-MAN'] === '10REM MAN\n' && r.programs['UNS-GAME'] === '10REM GAME\n');

r = collectPrograms([{ name: 'uns-man.TXT', bytes: bytes('x') }, { name: 'Uns-Game.txt', bytes: bytes('y') }], WANTED);
expect('file names are matched ignoring case', r.missing.length === 0);

r = collectPrograms([{ name: 'DISK.BS2', bytes: makeImage(['OTHER', 'UNS-MAN', 'UNS-GAME']) }], WANTED);
expect('a .bs2 image provides both programs', r.missing.length === 0 && /^10REM UNS-MAN$/m.test(r.programs['UNS-MAN']) && /^10REM UNS-GAME$/m.test(r.programs['UNS-GAME']));

r = collectPrograms([{ name: 'disk.wvd', bytes: toWvd(makeImage(['UNS-GAME', 'UNS-MAN'])) }], WANTED);
expect('a .wvd image provides both programs', r.missing.length === 0 && /REM UNS-MAN/.test(r.programs['UNS-MAN']));

r = collectPrograms([{ name: 'UNS-MAN.txt', bytes: bytes('a') }], WANTED);
expect('one listing only: the other is reported missing', r.missing.join() === 'UNS-GAME');

r = collectPrograms([{ name: 'UNS-MAN.txt', bytes: bytes('a') }, { name: 'DISK.BS2', bytes: makeImage(['UNS-GAME']) }], WANTED);
expect('listing + image can be combined', r.missing.length === 0 && r.programs['UNS-MAN'] === 'a' && /REM UNS-GAME/.test(r.programs['UNS-GAME']));

r = collectPrograms([{ name: 'notes.txt', bytes: bytes('hello') }], WANTED);
expect('an unrelated file is ignored with a note', r.missing.length === 2 && r.notes.some(n => /ignored notes\.txt/.test(n)));

r = collectPrograms([{ name: 'EMPTY.BS2', bytes: makeImage(['SOMETHING']) }], WANTED);
expect('an image without the programs gives a note', r.missing.length === 2 && r.notes.some(n => /no UNS-MAN \/ UNS-GAME program found/.test(n)));

r = collectPrograms([{ name: 'BAD.BS2', bytes: new Uint8Array([9, 9, 9]) }], WANTED);
expect('a broken image does not throw', r.missing.length === 2 && r.notes.length === 1);

expect('latin1 keeps every byte value', latin1(Uint8Array.from([0xE8, 0x00, 0x7F, 0xFF])) === String.fromCharCode(0xE8, 0, 0x7F, 0xFF));

console.log(fail ? '\n' + fail + ' TESTS FAILED' : '\nall tests passed'); process.exit(fail ? 1 : 0);
