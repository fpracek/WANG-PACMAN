/* ================= Wang disk images: raw sector dumps (.bs2) and WangEmu virtual disks (.wvd) =================
   An image is a sequence of 256-byte sectors. Sector 0 describes the disk; the first N sectors are the catalog
   (16-byte entries); programs are stored tokenized, one record per sector.

     sector 0:   byte0 = index type (0/1: 2-byte sector addresses, 2: 3-byte), byte1 = number of index sectors
                 (type 2: bytes 1,2), then the "current end" and "end of catalog area" (the first 16 bytes
                 are the disk parameter block and take the place of catalog entry 0)
     entry:      [0] state (0x10 valid, 0x11 scratched, 0x21 recycled)   [1] type (0x80 program, 0x00 data)
                 [2..3] first sector   [4..5] last sector   [8..15] name (8 chars, space padded)
     program:    header sector (control byte 0x40, name, 0xFD), body sectors (0x00), trailer sector (0x20, ends with 0xFE).
                 Each line is: 0xFF, two BCD bytes (line number), tokens/text, 0x0D 0x00 0x00.
                 Tokens are bytes >= 0x80 (see TOKENS). "Protected" programs may also be scrambled sector by sector.

   Detokenizing follows the listing rules of WangEmu's wvdutil (Jim Battle, MIT), so the text produced here is the same
   as `wvdutil list`: "NNNstatements", non-printable bytes inside strings written as \xHH.
   Images mount as READ-ONLY platters: programs appear as listing files, data files as raw sector files. */

const TOKENS = (function(){
  const t = new Array(256).fill('');
  const set = (base, list) => list.forEach((s, i) => { t[base + i] = s; });
  set(0x80, ['LIST ','CLEAR ','RUN ','RENUMBER ','CONTINUE ','SAVE ','LIMITS ','COPY ','KEYIN ','DSKIP ','AND ','OR ','XOR ','TEMP','DISK ','TAPE ']);
  set(0x90, ['TRACE ','LET ','FIX(','DIM ','ON ','STOP ','END ','DATA ','READ ','INPUT ','GOSUB ','RETURN ','GOTO ','NEXT ','FOR ','IF ']);
  set(0xA0, ['PRINT ','LOAD ','REM ','RESTORE ','PLOT ','SELECT ','COM ','PRINTUSING ','MAT ','REWIND ','SKIP ','BACKSPACE ','SCRATCH ','MOVE ','CONVERT ','PLOT ']);
  set(0xB0, ['STEP ','THEN ','TO ','BEG ','OPEN ','CI ','R ','D ','CO ','LGT(','OFF ','DBACKSPACE ','VERIFY ','DA ','BA ','DC ']);
  set(0xC0, ['FN','ABS(','SQR(','COS(','EXP(','INT(','LOG(','SIN(','SGN(','RND(','TAN(','ARC','#PI','TAB(','DEFFN','TAN(']);
  set(0xD0, ['SIN(','COS(','HEX(','STR(','ATN(','LEN(','RE','#','%','P','BT','G','VAL(','NUM(','BIN(','POS(']);
  set(0xE0, ['LS=','ALL','PACK','CLOSE','INIT','HEX','UNPACK','BOOL','ADD','ROTATE','$','ERROR','ERR','DAC ','DSC ','SUB']);
  set(0xF0, ['LINPUT ','VER(',' ELSE ','SPACE','ROUND(','AT(','HEXOF(','MAX(','MIN(','MOD(']);
  return t;
})();

const _P = (typeof module !== 'undefined') ? require('./platter.js') : { Platter };
const hex2 = n => n.toString(16).padStart(2, '0');

/* 8-character names: trailing spaces / 0xFF removed, odd bytes shown as \xHH */
function cleanName(bytes){
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0xFF || bytes[end - 1] === 0x20)) end--;
  let s = '';
  for (let i = 0; i < end; i++) s += (bytes[i] >= 32 && bytes[i] < 128) ? String.fromCharCode(bytes[i]) : '\\x' + hex2(bytes[i]).toUpperCase();
  return s;
}

/* Undo the sector scrambling of "SAVE !" programs (algorithm from the Wang MVP OS 3.5 DCRYPT routine). Returns a copy. */
function unscrambleSector(block){
  const s = Uint8Array.from(block);
  const byte0 = s[0], byte1 = s[1];
  let offset = (byte1 & 0x60) + 5;
  const key = s[offset];
  s[0] = (byte0 & 0xF0) | ((byte1 & 0xF0) >> 4);
  s[1] = key;
  s[offset] = ((byte0 & 0x0F) << 4) | (byte1 & 0x0F);
  /* pass 2 */
  offset = 0x100 - 0x22;
  let endidx = offset;
  let pair = (s[offset] << 8) | s[offset + 1];
  offset = offset + 26;
  while (offset !== endidx) {
    const seed = ((pair << 1) | (pair >> 15)) & 0xFFFF;
    const nibs = (seed & 0xF00F) | ((seed & 0x00F0) << 4) | ((seed & 0x0F00) >> 4);
    pair = (s[offset] << 8) | s[offset + 1];
    const tmp = pair + (0xFFFF ^ nibs);
    s[offset] = (tmp >> 8) & 0xFF;
    s[offset + 1] = tmp & 0xFF;
    offset += 26;
    if (offset >= 256) offset = (offset + 2) & 0xFF;
  }
  /* pass 1 */
  offset = 0x22; endidx = 0; pair = s[1];
  while (offset !== endidx) {
    const seed = ((pair << 1) | (pair >> 15)) & 0xFFFF;
    const nibs = (seed & 0xF00F) | ((seed & 0x00F0) << 4) | ((seed & 0x0F00) >> 4);
    pair = (s[offset] << 8) | s[offset + 1];
    const tmp = pair + (0xFFFF ^ nibs);
    s[offset] = (tmp >> 8) & 0xFF;
    s[offset + 1] = tmp & 0xFF;
    offset = (offset + 34) & 0xFF;
  }
  const b0 = s[0];
  s[0] = b0 & 0xF0;
  s[1] = 0xFE | (b0 & 0x01);
  return s;
}

/* List one program sector as an array of text lines (header sectors give a "# ..." comment line). */
function listProgramRecord(blk, secnum){
  const out = [];
  if ((blk[0] & 0xC0) === 0x00 && (blk[0] & 0x10) === 0x10 && (blk[1] & 0x80) === 0x00) blk = unscrambleSector(blk);
  if ((blk[0] & 0xC0) === 0x40) {
    out.push('# Sector ' + secnum + ", program filename = '" + cleanName(blk.subarray(1, 9)) + "'" + ((blk[0] & 0x10) === 0x10 ? ', protected file' : ''));
    return out;
  }
  if ((blk[0] & 0xC0) !== 0x00) { out.push("# " + secnum + " doesn't look like a program record"); return out; }
  const ATOMIC = 0, QUOTES = 1, REM = 2, IMAGE = 3;
  let cp = 1, line = '', state = ATOMIC;
  while (cp < 255 && blk[cp] !== 0xFD && blk[cp] !== 0xFE) {
    const c = blk[cp];
    if (c === 0x0D) { out.push(line); line = ''; state = ATOMIC; cp += 3; continue; }
    if (c < 128) line += String.fromCharCode(c);
    else if (c === 0xFF && cp < 254) {
      const n = 1000 * (blk[cp + 1] >> 4) + 100 * (blk[cp + 1] & 15) + 10 * (blk[cp + 2] >> 4) + (blk[cp + 2] & 15);
      cp += 2; line += String(n);
    } else if (state !== ATOMIC || TOKENS[c] === '') line += '\\x' + hex2(c);
    else line += TOKENS[c];
    if (c === 0xA2 && state === ATOMIC) state = REM;
    else if (c === 0xD8 && state === ATOMIC) state = IMAGE;
    else if (c === 0x22 && state === ATOMIC) state = QUOTES;
    else if (c === 0x22 && state === QUOTES) state = ATOMIC;
    else if (c === 0x3A && state === REM) state = ATOMIC;
    cp++;
  }
  return out;
}

/* ---- image parsing ---- */
class DiskImageError extends Error {}

/* sectors: array of Uint8Array(256). Returns {indexType, files:[{name,state,type,start,end}]} */
function readCatalog(sectors){
  if (!sectors.length) throw new DiskImageError('empty image');
  const s0 = sectors[0], type = s0[0] & 0x7F;
  if (type > 2) throw new DiskImageError('no catalog (index type ' + type + '): raw sectors?');
  const nIdx = type === 2 ? ((s0[1] << 8) | s0[2]) : s0[1];
  if (nIdx < 1 || nIdx > sectors.length) throw new DiskImageError('bad catalog size ' + nIdx);
  const mask = sectors.length > 32768 ? 0xFFFF : 0x7FFF;
  const files = [];
  for (let s = 0; s < nIdx; s++) for (let i = (s === 0 ? 1 : 0); i < 16; i++) {
    const e = sectors[s].subarray(i * 16, i * 16 + 16);
    if (e[0] !== 0x10 && e[0] !== 0x11) continue;
    const start = type < 2 ? (((e[2] << 8) | e[3]) & mask) : ((e[2] << 16) | (e[3] << 8) | e[4]);
    const end = type < 2 ? (((e[4] << 8) | e[5]) & mask) : ((e[5] << 16) | (e[6] << 8) | e[7]);
    files.push({ name: cleanName(e.subarray(8, 16)), state: e[0], type: e[1], start, end, catalogSector: s });
  }
  return { indexType: type, indexSectors: nIdx, files };
}

/* tokenized program file -> listing text ("NNNstatements" per line, escapes as \xHH) */
function programText(sectors, f){
  const lines = [];
  for (let n = f.start; n <= f.end && n < sectors.length; n++) {
    if (sectors[n][0] === 0xA0) break;                       // trailer record of a data-style file: nothing more to list
    for (const l of listProgramRecord(sectors[n], n)) lines.push(l);
  }
  return lines.join('\n') + '\n';
}

/* bytes -> [{label, sectors}]  (one entry per platter) */
function splitImage(bytes, fileName){
  const isWvd = bytes.length >= 256 && bytes[0] === 0x57 && bytes[1] === 0x41 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0;
  const platters = [];
  if (isWvd) {
    const numSectors = bytes[8] + 256 * bytes[9], numPlatters = bytes[11] + 1;
    let label = ''; for (let i = 16; i < 256 && bytes[i]; i++) label += String.fromCharCode(bytes[i]);
    for (let p = 0; p < numPlatters; p++) {
      const sectors = [];
      for (let n = 0; n < numSectors; n++) { const o = 256 + (p * numSectors + n) * 256; if (o + 256 <= bytes.length) sectors.push(bytes.subarray(o, o + 256)); }
      platters.push({ label: (label || fileName) + (numPlatters > 1 ? ' P' + p : ''), sectors });
    }
  } else {
    const sectors = [];
    for (let o = 0; o + 256 <= bytes.length; o += 256) sectors.push(bytes.subarray(o, o + 256));
    platters.push({ label: fileName, sectors });
  }
  return platters;
}

/* Build a read-only Platter (see platter.js) from one parsed disk. */
function platterFromSectors(label, sectors){
  const cat = readCatalog(sectors);
  const p = new _P.Platter(label.toUpperCase().replace(/[.][^.]*$/, ''), { readOnly: true });
  p.image = { indexType: cat.indexType, sectors: sectors.length, files: cat.files.length };
  for (const f of cat.files) {
    if (f.state !== 0x10 || f.start > f.end || f.end >= sectors.length) continue;      // skip scratched / damaged entries
    if (p.files.has(f.name)) continue;
    if (f.type === 0x80) {
      p.files.set(f.name, { name: f.name, kind: 'program', text: programText(sectors, f), image: true });
    } else {
      const raw = new Uint8Array((f.end - f.start + 1) * 256);
      for (let n = f.start; n <= f.end; n++) raw.set(sectors[n], (n - f.start) * 256);
      p.files.set(f.name, { name: f.name, kind: 'data', records: [], raw, image: true });
    }
  }
  p.version++;
  return p;
}

/* bytes of a .bs2 / .wvd file -> array of Platters */
function platterSetFromImage(bytes, fileName){
  return splitImage(bytes, fileName).map(d => platterFromSectors(d.label, d.sectors));
}

/* true when the bytes are a Wang disk image (a .wvd with its WANG header, or raw sectors with a valid catalog in sector 0)
   rather than a text listing. Lets the user choose a disk in the "wrong" file button without loading garbage as a program. */
function isDiskImage(bytes) {
  if (!bytes || bytes.length < 512) return false;
  if (bytes[0] === 0x57 && bytes[1] === 0x41 && bytes[2] === 0x4E && bytes[3] === 0x47 && bytes[4] === 0) return true;     // "WANG\0"
  try { return readCatalog(splitImage(bytes, 'x')[0].sectors).files.length > 0; } catch (e) { return false; }
}

if (typeof module !== 'undefined') module.exports = { TOKENS, unscrambleSector, listProgramRecord, readCatalog, programText, splitImage, platterFromSectors, platterSetFromImage, isDiskImage, DiskImageError };
