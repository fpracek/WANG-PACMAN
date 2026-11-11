/* ================= Program loader =================
   The page can be built WITHOUT the original UNS-MAN program (it is not distributed). This module extracts the programs
   the game needs from files the user provides:
     - text listings named after the program (UNS-MAN.txt, UNS-GAME.txt): one BASIC line per line, bytes as \xHH
     - Wang disk images (.bs2 raw sectors or .wvd) that contain the programs (read with image.js)
   collectPrograms(files, wanted) -> { programs: {name: listingText}, missing: [names], notes: [messages] }
   files: [{name: 'UNS-MAN.txt', bytes: Uint8Array}] */
const _IMG = (typeof module !== 'undefined') ? require('../engine/src/image.js') : { platterSetFromImage };

function latin1(bytes){
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return s;
}

function collectPrograms(files, wanted){
  const programs = {}, notes = [];
  const wantedUpper = wanted.map(w => w.toUpperCase());
  for (const f of files) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext === 'bs2' || ext === 'wvd' || ext === 'img') {
      try {
        const set = _IMG.platterSetFromImage(f.bytes, f.name);
        let found = 0;
        for (const pl of set) for (const info of pl.list()) {
          const i = wantedUpper.indexOf(info.name.toUpperCase());
          if (i >= 0 && info.kind === 'program' && !programs[wanted[i]]) { programs[wanted[i]] = pl.get(info.name).text; found++; }
        }
        if (!found) notes.push(f.name + ': no ' + wanted.join(' / ') + ' program found on this disk');
      } catch (e) { notes.push(f.name + ': ' + e.message); }
    } else {
      const base = f.name.replace(/[.][^.]*$/, '').toUpperCase();
      const i = wantedUpper.indexOf(base);
      if (i >= 0) programs[wanted[i]] = latin1(f.bytes);
      else notes.push('ignored ' + f.name + ' (expected ' + wanted.map(w => w + '.txt').join(' and ') + ' or a disk image)');
    }
  }
  return { programs, missing: wanted.filter(w => !programs[w]), notes };
}

if (typeof module !== 'undefined') module.exports = { collectPrograms, latin1 };
