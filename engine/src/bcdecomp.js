/* ================= Niakwa BASIC-2C object code ("BC Rev 1.0x") -> BASIC-2 listing =================
   The compiled form of a program is not encrypted: a stream of line records
       <line number: 2 bytes BCD little endian> <length: u16 LE> <body of that length, ending 77 00 00>
   whose bodies are statements (61 <index> ...) written in postfix: operands push text on a stack, operators pop.
   This is a partial decompiler built from pairs of source / object code (see docs/NIAKWA-OBJECT.md): on a test set of
   about 10,000 lines roughly 85% come back with the same text as the source (blanks, HEX(20) versus " " and similar
   details cannot be recovered); lines it does not understand are reported as "not decoded".
   decompileProgram(bytes) -> { text, total, failed, rev }       (text: one "<no><statement>" per line) */

class BcUnknown extends Error {
  constructor(b, pos, why) { super('unknown ' + (b === undefined ? '??' : b.toString(16)) + ' at ' + pos + ' ' + (why || '')); this.b = b; this.pos = pos; this.why = why || ''; }
}

const BC_BIN = { 0x23: '+', 0xc4: '-', 0x92: '*', 0x47: '/', 0x90: 'MOD', 0x91: '^', 0x9b: '^' };
const BC_FUNC = { 0x68: ['INT', 1, 1], 0x6c: ['LEN', 1, 1], 0x89: ['RND', 2, 1], 0x8c: ['MAX', 1, 2], 0x8e: ['MIN', 1, 2], 0x95: ['NUM', 1, 1], 0x21: ['ABS', 1, 1], 0xc9: ['VER', 1, 2], 0xbf: ['SGN', 1, 1] };
const BC_DEVN = { 0: 'TAPE', 1: 'PRINT', 2: 'LIST', 3: 'CO', 4: 'CI', 5: 'INPUT', 20: 'TC' };
const BC_SYSV = { 0x13: 'DEVICE', 0x15: 'SCREEN', 0x16: 'KEYBOARD', 0x18: 'ENVIRONMENT', 0x19: 'MACHINE', 0x1a: 'BOXTABLE', 0x1b: 'OPTIONS' };   // system variables, found with B2C
const BC_RELS = { 1: '<', 2: '=', 3: '<=', 4: '>', 5: '<>', 6: '>=', 7: '<>' };
const BC_INV = { '<': '>=', '=': '<>', '<=': '>', '>': '<=', '<>': '=', '>=': '<' };
const BC_PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
const BC_BOOLN = { 0x06: 'XOR', 0x08: 'AND', 0x0e: 'OR', 0x16: 'XOR', 0x18: 'AND', 0x1e: 'OR' };
const BC_ARITHN = { 0x00: 'ADD', 0x02: 'SUB', 0x08: 'ADD', 0x01: 'ADDC', 0x03: 'SUBC' };

class BcIf {
  /* flat: chain of conditions {raw, inv, tgt, lineForm}; thenStart: where the THEN body begins. A condition whose skip lands on
     thenStart is an "if true, go to THEN" jump (relation as written, ends an AND group); the others are "if false, skip"
     tests (inverted relation, AND elements); the groups are joined by OR. */
  constructor(flat, thenStart, body, els) { this.flat = flat; this.thenStart = thenStart; this.body = body; this.els = els || null; this.coreEnd = 0; }
  condText() {
    const groups = []; let cur = [];
    for (const c of this.flat.slice(0, -1)) {
      if (c.tgt === this.thenStart) { cur.push(c.raw); groups.push(cur); cur = []; } else cur.push(c.inv);
    }
    const last = this.flat[this.flat.length - 1]; cur.push(last.lineForm ? last.raw : last.inv); groups.push(cur);
    return groups.map(g => g.join(' AND ')).join(' OR ');
  }
  toString() {
    let t = 'IF ' + this.condText() + ' THEN ' + this.body;
    if (this.els) t += ': ELSE ' + this.els;
    return t;
  }
}
class BcCat { constructor(x) { this.x = x; } toString() { return String(this.x); } }
class BcSub {
  constructor(s, start, ln) { this.s = s; this.start = start === undefined ? null : start; this.ln = ln === undefined ? null : ln; }
  toString() { const a = [String(this.s), this.start !== null ? this.start : '']; if (this.ln !== null) a.push(this.ln); return 'STR(' + a.map(String).join(',') + ')'; }
}

function bcVname(d, l) {
  const digit = d & 0x0f;
  return String.fromCharCode(l) + (digit === 0x0f ? '' : String(digit)) + (((d >> 4) === 1 || (d >> 4) === 3) ? '$' : '');
}
function bcBcdLine(lo, hi) {
  const h = ('0' + hi.toString(16)).slice(-2) + ('0' + lo.toString(16)).slice(-2);
  if (!/^\d+$/.test(h)) throw new BcUnknown(lo, 0, 'bad line number');
  return parseInt(h, 10);
}
const bcStrip = x => String(x).replace(/^"+|"+$/g, '');
const bcHex = s => Array.from(s).map(c => ('0' + c.charCodeAt(0).toString(16)).slice(-2)).join('').toUpperCase();
const bcIsHex = x => String(x).startsWith('HEX(');

class BcDec {
  constructor(body) { this.b = body; this.p = 0; this.st = []; this.precs = new Map(); this.curline = 0; this.elseEnd = 0; this.base = 0; this.starts = null; this.tokens = null; }
  u8() { if (this.p >= this.b.length) throw new BcUnknown(undefined, this.p, 'end of data'); return this.b[this.p++]; }
  u16() { const v = this.u8(); return v | (this.u8() << 8); }
  u16s() { const v = this.u16(); return v > 32767 ? v - 65536 : v; }
  more() { return this.p < this.b.length; }
  peek() { return this.p < this.b.length ? this.b[this.p] : null; }
  pop() { if (!this.st.length) throw new BcUnknown(undefined, this.p, 'stack empty'); return this.st.pop(); }
  str(n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }

  exprToken(t) {
    const st = this.st;
    if (t === 0x53) {
      const kind = this.u8();
      if (kind === 1 || kind === 9 || kind === 0x11 || kind === 0x19) st.push(String(this.u8()));
      else if (kind === 2 || kind === 0x12 || kind === 0x0a) st.push(String(this.u16()));
      else if (kind === 3 || kind === 0x0b) { const v = this.u16(); st.push(String(v > 32767 ? v - 65536 : v)); }
      else if (kind === 4 || kind === 0x0c) { const v = (this.u16() + this.u16() * 65536); st.push(String(v >= 2147483648 ? v - 4294967296 : v)); }
      else if (kind === 0) {
        let e = this.u16(); if (e > 32767) e -= 65536;
        let m = 0; for (let i = 5; i >= 0; i--) m = m * 256 + this.b[this.p + i]; this.p += 6;
        if (m >= Math.pow(2, 47)) m -= Math.pow(2, 48);
        if (e > 0 && m !== 0) { st.push(m + 'E' + e); return true; }
        const v = e >= 0 ? m * Math.pow(10, e) : m / Math.pow(10, -e);
        let s = Number(v.toPrecision(10)).toString(); if (v > 0 && v < 1) s = s.replace(/^0+/, ''); else if (v < 0 && v > -1) s = '-' + s.slice(1).replace(/^0+/, '');
        st.push(s);
      } else throw new BcUnknown(t, this.p, 'const kind ' + kind);
    } else if (t === 0x54 || t === 0x59) { const d = this.u8(), l = this.u8(); st.push(bcVname(d, l)); }
    else if (t === 0x56 || t === 0x57 || t === 0x52) { const d = this.u8(), l = this.u8(); st.push(bcVname(d, l) + '()'); }
    else if (t === 0x58) {
      const n = this.u8(); const s = this.str(n);
      let ok = true; for (const c of s) { const k = c.charCodeAt(0); if (k < 0x20 || k >= 0x7f) ok = false; }
      st.push(ok && s.indexOf('"') < 0 ? '"' + s + '"' : 'HEX(' + bcHex(s) + ')');
    } else if (t === 0x63 || t === 0x64) {
      const n = this.u8(), d = this.u8(), l = this.u8(); const idx = [];
      for (let i = 0; i < n; i++) idx.unshift(this.pop());
      st.push(bcVname(d, l) + '(' + idx.map(String).join(',') + ')');
    } else if (t === 0xc6) { this.u8(); st.push('VAL(' + this.pop() + ')'); }
    else if (t === 0xc7) { this.u8(); st.push('VAL(' + this.pop() + ',2)'); }
    else if (t === 0xc5) { /* load of a string reference: no text */ }
    else if (t === 0x8f && (this.peek() === 3 || this.peek() === 5) && this.p + 1 < this.b.length && this.b[this.p + 1] === 0x5a) {
      const k = this.u8(); st.push(k === 3 ? 'DATE' : 'TIME'); this.p += 2;
    } else if (t === 0x55 && [5, 6, 0x0b, 0x0c, 0x0d, 0x15, 0x16].indexOf(this.peek()) >= 0 && this.p + 1 < this.b.length && (this.b[this.p + 1] === 0 || this.b[this.p + 1] === 0x10)) {
      const k = this.u8(); this.u8(); st.push({ 5: 'ERR', 6: 'END', 0x0b: '#PART', 0x0c: '#TERM', 0x0d: '#ID', 0x15: 'SPACEK', 0x16: '#GOLDKEY' }[k]);
    } else if (t === 0x28) {
      const fid = this.u8(); this.u16(); st.push('FN' + String.fromCharCode(fid + 0x37) + '(' + this.pop() + ')');
    } else if (t === 0x93) {
      this.u8(); const x = st.pop(), m = this.precs.get(String(x));
      const r = m !== undefined && m < 3 ? '-(' + x + ')' : '-' + x; this.precs.set(r, 3); st.push(r);
    } else if (t === 0x5a && this.peek() === 0x0d) { this.u8(); st.push('$PSTAT(' + this.pop() + ')'); }
    else if (t === 0x5a && this.peek() === 0x08) { this.u8(); st.push('$MSG'); }
    else if (t === 0x9a) { const rc = this.u8(), b = this.pop(), a = this.pop(); st.push('POS(-' + a + (BC_RELS[rc] || '=') + b + ')'); }
    else if (t === 0x99) { const rc = this.u8(), b = this.pop(), a = this.pop(); st.push('POS(' + a + (BC_RELS[rc] || '=') + b + ')'); }
    else if (t === 0x25) st.push('BIN(' + this.pop() + ',2)');
    else if (t === 0x2e) st.push(new BcCat(this.pop()));
    else if (t === 0x24) st.push('BIN(' + this.pop() + ')');
    else if (t === 0xda) {
      this.u8(); const top = st[st.length - 1];
      if (typeof top === 'string' && top.startsWith('"')) st[st.length - 1] = 'HEX(' + bcHex(top.slice(1, -1)) + ')';
    }
    else if (t === 0xc0) { const start = this.pop(); st.push(new BcSub(this.pop(), start)); }
    else if (t === 0xc1) { const v = this.u16(); st.push(new BcSub(this.pop(), String(v + 1))); }
    else if (t === 0xc2) {
      const ln = this.pop(), top = this.pop();
      if (top instanceof BcSub) { top.ln = ln; st.push(top); } else st.push(new BcSub(top, null, ln));
    } else if (t === 0xc3) {
      const v = this.u16(), top = this.pop();
      if (top instanceof BcSub) { if (top.ln !== null) top.bin = true; else top.ln = String(v); st.push(top); } else st.push(new BcSub(top, null, String(v)));
    } else if (BC_BIN[t] !== undefined) { this.u8(); const b = this.pop(), a = this.pop(); st.push(this.binop(t, a, b)); }
    else if ((t === 0xbe || t === 0xbd) && st.length && this.b[this.p] === 0x8f && this.b[this.p + 1] === 0x1f && this.b[this.p + 2] === 0x5a && this.b[this.p + 3] === 0x13) {   // $DEVICE(#n) / $DEVICE(/addr) as a value
      this.p += 4; const a0 = this.pop(); st.push(t === 0xbe ? '$DEVICE(#' + a0 + ')' : '$DEVICE(/' + (String(a0).startsWith('"') ? bcStrip(String(a0)) : a0) + ')');
    }
    else if (t === 0x89) { const f = this.u8(); this.u8(); const nm = { 0: 'FIX', 1: 'RND', 2: 'LOG', 4: 'EXP', 5: 'SIN', 6: 'COS', 7: 'TAN', 8: 'SQR', 9: 'ARCTAN', 10: 'ARCSIN', 11: 'ARCCOS' }[f]; if (!nm) throw new BcUnknown(0x89, this.p - 2, 'function ' + f); st.push(nm + '(' + this.pop() + ')'); }
    else if (BC_FUNC[t]) { const [nm, ex, ar] = BC_FUNC[t]; this.p += ex; const a = []; for (let i = 0; i < ar; i++) a.unshift(this.pop()); st.push(nm + '(' + a.map(String).join(',') + ')'); }
    else return false;
    return true;
  }

  binop(t, a, b) {
    const op = BC_BIN[t];
    if (op === 'MOD') return 'MOD(' + a + ',' + b + ')';
    const pr = BC_PREC[op];
    const wrap = (x, right) => { const m = this.precs.get(String(x)); return m !== undefined && (m < pr || (right && m === pr)) ? '(' + x + ')' : String(x); };
    const r = wrap(a, false) + op + wrap(b, true);
    this.precs.set(r, pr);
    return r;
  }

  operands() {
    const n0 = this.st.length;
    while (this.more()) { const t = this.b[this.p++]; if (!this.exprToken(t)) { this.p--; break; } }
    const out = this.st.splice(n0), res = []; let pend = null;
    for (let it of out) {
      if (it instanceof BcCat) { pend = pend === null ? String(it) : pend + '&' + String(it); continue; }
      if (pend !== null) { it = pend + '&' + String(it); pend = null; }
      res.push(it);
    }
    return res;
  }

  expr() {
    const n0 = this.st.length;
    while (this.more()) { const t = this.b[this.p++]; if (!this.exprToken(t)) { this.p--; break; } }
    if (this.st.length !== n0 + 1) throw new BcUnknown(this.peek() || 0, this.p, 'expr stack');
    return this.pop();
  }

  static cnd(a, rel, b) { return (String(a) === 'END' && String(b) === '1' && rel === '=') ? 'END' : String(a) + rel + String(b); }

  relLine(off) {
    const tgt = this.base + this.p + off;
    if (this.starts === null) {
      if (off < 0 && tgt === this.base) return this.curline;
      throw new BcUnknown(0x26, this.p - 3, 'relative goto');
    }
    if (this.starts.has(tgt)) return this.starts.get(tgt);
    throw new BcUnknown(0x26, this.p - 3, 'relative goto target');
  }

  statement() {
    while (this.more() && (this.peek() === 0x61 || this.peek() === 0xd4) && this.p + 2 < this.b.length && this.b[this.p + 2] !== undefined && (this.nohdr || this.peek() === 0x61)) this.p += 2;
    let t = this.u8();
    if (t === 0xd2) {                                          // REM (or the text of a $GIO)
      const n = this.u16(); const raw = []; for (let i = 0; i < n; i++) raw.push(this.u8());
      if (raw[0] === 4 || raw[0] === 6) { let g = ''; for (let i = 1; i < raw.length; i++) g += (raw[i] >= 1 && raw[i] <= 0x1f) ? ' '.repeat(raw[i]) : String.fromCharCode(raw[i]); return this.gio(g); }
      let s = ''; for (let i = 1; i < raw.length; i++) { const c = raw[i]; s += (c >= 1 && c <= 0x1f) ? ' '.repeat(c) : String.fromCharCode(c); }
      return 'REM ' + s;
    }
    if (t === 0xb7) return 'RETURN';
    if (t === 0x7e || t === 0x7c || t === 0x87 || t === 0x82 || t === 0x88 || t === 0x8a || t === 0x7f) {   // MAT a=b, a=b+c, a=TRN(b), a=INV(b), a=IDN
      if (t === 0x8a) this.u8();
      const nref = (t === 0x7e || t === 0x88 || t === 0x8a) ? 2 : (t === 0x7f ? 1 : 3), r = [];
      for (let i = 0; i < nref; i++) { const d = this.u8(), l = this.u8(); r.push(bcVname(d, l)); }
      const dst = r[nref - 1];
      const rhs = t === 0x7f ? 'IDN' : t === 0x7e ? r[0] : t === 0x88 ? 'TRN(' + r[0] + ')' : t === 0x8a ? 'INV(' + r[0] + ')' : r[1] + ({ 0x7c: '+', 0x87: '-', 0x82: '*' })[t] + r[0];
      return 'MAT ' + dst + '=' + rhs;
    }
    if (t === 0xaf || t === 0xb1) {                            // MAT READ a,b
      this.p--; const names = [];
      while (this.peek() === 0xaf || this.peek() === 0xb1) { this.p++; const d = this.u8(), l = this.u8(); names.push(bcVname(d, l)); }
      return 'MAT READ ' + names.join(',');
    }
    if (t === 0xcd && this.peek() === 0x06) {                  // LIST [S|D] from,to
      this.p += 2; const kd = this.u8(); this.u8(); const a = bcBcdLine(this.u8(), this.u8()), z = bcBcdLine(this.u8(), this.u8());
      const pre = kd === 1 ? 'S' : kd === 2 ? 'D' : '';
      if (a === 0 && z === 9999) return 'LIST' + (pre ? ' ' + pre : '');
      return 'LIST ' + pre + (a === z ? a : a + ',' + z);
    }
    if (t === 0x4a) { this.u8(); return '$RELEASETERMINAL'; }
    if (t === 0x2d) { const d = this.u8(), l = this.u8(); return 'COM CLEAR ' + bcVname(d, l) + (((d >> 4) === 2 || (d >> 4) === 3) ? '()' : ''); }
    if (t === 0x8f && this.peek() === 1) { this.u8(); return 'RETURN CLEAR ALL'; }
    if (t === 0x5b) {
      const a = this.u8(), x = this.operands();
      if (this.u8() !== 0x76 || x.length !== 1) throw new BcUnknown(0x76, this.p - 1, 'select page');
      if (a === 2) return 'SELECT P' + (String(x[0]) === '0' ? '' : x[0]);
      throw new BcUnknown(0x5b, this.p - 2, 'select attr ' + a);
    }
    if (t === 0x62) {                                          // PACK / UNPACK
      const n = this.u8(), fl = this.u8(); let fmt;
      if (fl === 8) fmt = '#'.repeat(n);
      else if (fl === 0) { const n2 = this.u8(), k = this.u8(); fmt = '#'.repeat(n2 - k) + '.' + '#'.repeat(k); }
      else throw new BcUnknown(0x62, this.p - 3, 'pack format');
      const a = this.operands();
      if (this.u8() !== 0x97) throw new BcUnknown(0x97, this.p - 1, 'pack 97');
      const b = this.operands(), k2 = this.u8(), k3 = this.u8();
      if (a.length !== 1 || b.length !== 1) throw new BcUnknown(0x97, this.p - 2, 'pack operands');
      if (k2 === 0x30 && (k3 === 0x0c || k3 === 0x0d)) return 'UNPACK(' + fmt + ')' + a[0] + ' TO ' + b[0];
      if (k2 === 0x30 && k3 === 0x0b) return 'PACK(' + fmt + ')' + a[0] + ' FROM ' + b[0];
      throw new BcUnknown(k2, this.p - 2, 'pack end');
    }
    if (t === 0x3b) { this.u8(); return 'DATA SAVE DC CLOSE ALL'; }
    if (t === 0x51) { this.p += 6; return 'ERROR'; }
    if (t === 0x5a) {
      const i = this.u8(), v = this.operands();
      if (i === 8 && this.peek() === 0x74 && v.length === 1) {
        this.u8(); this.u8(); this.u8(); const val = this.operands();
        if (this.u8() !== 0x73 || this.u8() !== 0x75 || val.length !== 1) throw new BcUnknown(0x74, this.p - 1, 'msg assign');
        return '$MSG,' + v[0] + '=' + val[0];
      }
      const endk = this.u8();
      if ((endk !== 0x73 && !(endk === 0x6f && BC_SYSV[i])) || v.length !== 1) throw new BcUnknown(0x73, this.p - 1, 'select value');
      if (endk === 0x6f) v[0] = String(v[0]).replace(/HEX\(([0-9A-F]+)\)$/, 'ALL($1)');
      if (BC_SYSV[i] && i !== 0x13) { if (i === 0x18 && this.peek() === 0x8f && this.b[this.p + 1] === 0x26) this.p += 2; return '$' + BC_SYSV[i] + '=' + v[0]; }
      if (i === 9) return '$PSTAT=' + v[0];
      let w = '';
      while (this.peek() === 0x5b) {
        this.p++; const a = this.u8(), x = this.operands();
        if (this.u8() !== 0x76) throw new BcUnknown(0x76, this.p - 1, 'select attr');
        if (a === 7 || a === 8) w = '(' + x[0] + ')';
      }
      const devName = d => { d = String(d); return d.startsWith('"') ? bcStrip(d) : '<' + d + '>'; };
      let out = 'SELECT ' + (BC_DEVN[i] || 'DEV' + i) + ' ' + devName(v[0]) + w;
      while (this.peek() === 0x5a) {
        this.p++; const i2 = this.u8(), v2 = this.operands();
        if (this.u8() !== 0x73 || v2.length !== 1) throw new BcUnknown(0x73, this.p - 1, 'select value 2');
        let w2 = '';
        while (this.peek() === 0x5b) { this.p++; const a = this.u8(), x = this.operands(); if (this.u8() !== 0x76) throw new BcUnknown(0x76, this.p - 1, 'select attr 2'); if (a === 7 || a === 8 || a === 9) w2 = '(' + x[0] + ')'; }
        out += ',' + (BC_DEVN[i2] || 'DEV' + i2) + ' ' + devName(v2[0]) + w2;
      }
      return out;
    }
    if (t === 0x26) {
      let off = this.u16(); if (off > 32767) off -= 65536;
      if (off < 0) return 'GOTO ' + this.relLine(off);
      this.elseEnd = this.p + off; return '<ELSE>';
    }
    if (t === 0x6a) { const lo = this.u8(), hi = this.u8(); return 'GOSUB ' + bcBcdLine(lo, hi); }
    if (t === 0x8f) {
      const k = this.u8(); const names = { 0: 'RETURN CLEAR', 2: 'CLEAR', 0x0c: '$CLOSE', 0x14: '$END', 0x19: 'END', 0x1a: '$RELEASEPART' };
      if (names[k] !== undefined) return names[k];
      throw new BcUnknown(0x8f, this.p - 2, 'stmt 8f ' + k.toString(16));
    }
    if (t === 0x69) { const lo = this.u8(), hi = this.u8(); return 'GOTO ' + bcBcdLine(lo, hi); }
    if (t === 0x5d) {
      let d = this.u8(), l = this.u8(); const names = [bcVname(d, l)];
      while (this.peek() === 0x5d) { this.p++; d = this.u8(); l = this.u8(); names.push(bcVname(d, l)); }
      return 'NEXT ' + names.join(',');
    }
    if (t === 0x6e) { const v = this.u16(), d = this.u8(), l = this.u8(); return bcVname(d, l) + '=' + v; }
    if (t === 0xbc) return this.printStmt();
    if (t === 0x5e) {                                          // GOSUB 'n(args)
      const fn = this.u8(), argc = this.u8(); this.p += 2; const args = [];
      for (let i = 0; i < argc; i++) { args.push(this.expr()); if (this.u8() !== 0x72) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'gosub arg end'); }
      return "GOSUB '" + fn + (args.length ? '(' + args.map(String).join(',') + ')' : '');
    }
    if (t === 0x40) {                                          // DEFFN T(X)=expr
      const n = this.u16(), end = this.p + n, fid = this.u8(); const ps = [];
      while ([0x53, 0x54, 0x59, 0x28, 0x93, 0x4e].indexOf(this.peek()) < 0 && this.peek() !== null && this.p + 1 < end) { const d = this.u8(), l = this.u8(); ps.push(bcVname(d, l)); }
      const e = this.operands();
      if (e.length !== 1 || this.u8() !== 0x4e) throw new BcUnknown(0x40, this.p - 1, 'deffn expr');
      this.p = end;
      return 'DEFFN ' + String.fromCharCode(fid + 0x37) + '(' + ps.join(',') + ')=' + e[0];
    }
    if (t === 0x41 && this.p + 3 < this.b.length && this.b[this.p + 3] !== 0) {          // DEFFN 'n"text" (key macro)
      const n = this.u16(), end = this.p + n, fn = this.u8(), ln = this.u8();
      const segs = []; let cur = '';
      for (let i = 0; i < ln; i++) {
        const c = this.u8();
        if (c >= 0x20 && c < 0x7f && c !== 0x22) cur += String.fromCharCode(c);
        else { if (cur) { segs.push('"' + cur + '"'); cur = ''; } segs.push('HEX(' + ('0' + c.toString(16)).slice(-2).toUpperCase() + ')'); }
      }
      if (cur) segs.push('"' + cur + '"');
      this.p = end;
      return "DEFFN'" + fn + segs.join(';');
    }
    if (t === 0x41) {                                          // DEFFN 'n(params)
      const n = this.u16(), end = this.p + n, fn = this.u16(); this.u8(); this.p += 2; const ps = [];
      while (this.p < end) {
        const tt = this.u8();
        if (tt === 0x59 || tt === 0x54) { const d = this.u8(), l = this.u8(); ps.push(bcVname(d, l)); if (this.peek() === 0x94) this.u8(); }
        else if (tt === 0x56) { const d = this.u8(), l = this.u8(); ps.push(bcVname(d, l) + '()'); if (this.peek() === 0x94) this.u8(); }
        else if (tt === 0xc3 && ps.length) { const v = this.u16(); ps[ps.length - 1] = 'STR(' + ps[ps.length - 1] + ',,' + v + ')'; if (this.peek() === 0x94) this.u8(); }
        else if (tt === 0x4f) break;
        else throw new BcUnknown(tt, this.p - 1, 'deffn');
      }
      this.p = end;
      return "DEFFN'" + fn + (ps.length ? '(' + ps.join(',') + ')' : '');
    }
    if (t === 0xcb) { const n = this.u16(), st0 = this.p; const s = this.imageText(st0, n); this.p = st0 + n; return '%' + s; }
    if (t === 0x3e) {                                          // DATA
      const n = this.u16(), end = this.p + n, cnt = this.u8(), mask = this.u16(); const items = [];
      let mk = mask;
      for (let k = 0; k < cnt; k++) {
        if (k && k % 16 === 0) mk = this.u16();
        const l = this.u8(); let s = '', num = 0;
        for (let i = 0; i < l; i++) { const c = this.u8(); s += String.fromCharCode(c); num += c * Math.pow(256, i); }
        items.push((mk >> (k % 16)) & 1 ? '"' + s + '"' : String(num));
      }
      this.p = end;
      return 'DATA ' + items.join(',');
    }
    if (t === 0x67) {                                          // INPUT
      const n = this.u16(), end = this.p + n; let pre = '';
      if (this.peek() === 0x58) {
        this.p++; const l = this.u8(); pre = '"' + this.str(l) + '"';
        if (this.u8() !== 0xa3) throw new BcUnknown(0xa3, this.p - 1, 'input prompt');
      }
      const vs = this.operands(); this.p = end;
      return 'INPUT ' + pre + vs.join(',');
    }
    if (t === 0xb5) {                                          // DIM / COM
      const n = this.u16(), end = this.p + n; let verb = 'DIM'; const items = [];
      while (this.p < end) {
        const tt = this.u8();
        if (tt === 0x22) break;
        if (tt === 0x53 || tt === 0x54 || tt === 0x59) { this.p--; this.exprToken(this.u8()); continue; }
        if (tt === 0x45) { const mode = this.u8(), d = this.u8(), l = this.u8(); verb = mode ? 'COM' : 'DIM'; const ln = this.pop(); items.push(bcVname(d, l) + ln); }
        else if (tt === 0x44) {
          const nd = this.u8(), mode = this.u8(), d = this.u8(), l = this.u8(); verb = mode ? 'COM' : 'DIM';
          const ln = this.pop(), dims = []; for (let i = 0; i < nd; i++) dims.unshift(this.pop());
          items.push(bcVname(d, l) + '(' + dims.join(',') + ')' + ln);
        } else if (tt === 0x43) { const mode = this.u8(), d = this.u8(), l = this.u8(); verb = mode ? 'COM' : 'DIM'; items.push(bcVname(d, l)); }
        else if (tt === 0x42) {
          const nd = this.u8(), mode = this.u8(), d = this.u8(), l = this.u8(); verb = mode ? 'COM' : 'DIM';
          const dims = []; for (let i = 0; i < nd; i++) dims.unshift(this.pop());
          items.push(bcVname(d, l) + '(' + dims.join(',') + ')');
        } else throw new BcUnknown(tt, this.p - 1, 'dim item');
      }
      this.p = end;
      return verb + ' ' + items.join(',');
    }
    this.p--;
    const ops = this.operands();
    t = this.u8();
    if (t === 0x74 && ops.length >= 2) {                       // A$,B$=value
      this.u8(); this.u8(); const v = this.operands();
      const k = this.u8();
      if (v.length !== 1 || (k !== 0x73 && k !== 0x6f) || this.u8() !== 0x75) throw new BcUnknown(0x74, this.p - 1, 'multi assign');
      if (k === 0x6f) { let o = String(v[0]); o = bcIsHex(o) ? o.slice(4, -1) : bcHex(bcStrip(o)); return ops.map(String).join(',') + '=ALL(' + o + ')'; }
      return ops.map(String).join(',') + '=' + v[0];
    }
    if (t === 0xc8 && ops.length === 3) { if (this.u8() !== 0x30) throw new BcUnknown(0xc8, this.p - 1, 'convert expr'); this.u8(); return 'CONVERT ' + ops[0] + ' TO ' + ops[1] + ',(' + ops[2] + ')'; }
    if (t === 0x4c && ops.length === 2) {                      // T=A op B  (copy A to T, then apply op with B)
      const cp = this.u8(); if (cp !== 0x73 && cp !== 0x6f) throw new BcUnknown(0x4c, this.p - 1, 'bool copy');
      if (cp === 0x6f) { const o = String(ops[1]); ops[1] = 'ALL(' + (bcIsHex(o) ? o.slice(4, -1) : o.startsWith('"') ? o : o) + ')'; }
      let res = String(ops[1]);
      for (let first = true; ; first = false) {
        const save = this.p, ssz = this.st.length; let v;
        try { v = this.operands(); } catch (e) { v = []; }
        if (!v.length) { this.p = save; this.st.length = ssz; if (first) throw new BcUnknown(this.peek() || 0, this.p, 'bool operand'); break; }
        let k = this.u8(); if (k === 0x4c) k = this.u8();
        if (k !== 0x79 && k !== 0x7a) { if (first) throw new BcUnknown(k, this.p - 1, 'bool op'); this.p = save; this.st.length = ssz; break; }
        const c = this.u8(), nm = (k === 0x7a ? BC_BOOLN : BC_ARITHN)[c];
        if (nm === undefined) throw new BcUnknown(k, this.p - 2, 'bool code ' + c.toString(16));
        let val = String(v[0]);
        if (c >= 0x10 && c <= 0x1f && (bcIsHex(val) || val.startsWith('"'))) val = 'ALL(' + (bcIsHex(val) ? val.slice(4, -1) : bcHex(bcStrip(val))) + ')';
        res += ' ' + nm + ' ' + val;
      }
      return ops[0] + '=' + res;
    }
    if (t === 0x8f && ops.length === 1) {
      const k = this.u8();
      if (k === 0x10) return 'MAT ' + String(ops[0]).replace('()', '') + '=ZER';
      if (k === 0x11) return 'MAT ' + String(ops[0]).replace('()', '') + '=CON';
      if (k === 0x13) return '$BREAK' + (String(ops[0]) === '1' ? '' : ops[0]);
      if (k === 0x25 && this.u8() === 0x5a && this.u8() === 0x18 && this.u8() === 0x73) return ops[0] + '=$ENVIRONMENT';
      throw new BcUnknown(0x8f, this.p - 2, 'op 8f ' + k.toString(16));
    }
    if (t === 0x4a && ops.length === 1) { this.u8(); return '$RELEASETERMINAL TO ' + ops[0]; }
    if (t === 0xb3 && ops.length === 2) { this.u8(); const d = this.u8(), l = this.u8(); return 'MAT REDIM ' + bcVname(d, l) + '(' + ops[0] + ')' + ops[1]; }
    if (t === 0xb8 && ops.length === 2) { const c = this.u8(); return (c ? 'ROTATEC(' : 'ROTATE(') + ops[0] + ',' + ops[1] + ')'; }
    if (t === 0x86 && ops.length >= 2) {                       // MAT SORT
      this.u8(); const d = this.u8(), l = this.u8(); const src = bcVname(d, l) + '()';
      if (ops.length >= 4) return 'MAT SORT ' + src + ' (' + ops[0] + ',' + ops[1] + ') TO ' + ops.slice(2).map(String).join(',');
      return 'MAT SORT ' + src + ' TO ' + ops.map(String).join(',');
    }
    if (t === 0x7a && ops.length === 2) {
      const c = this.u8(); const o1 = String(ops[1]), tgt = String(ops[0]);
      if (c === 0x14) return 'BOOL4(' + tgt + ',' + (bcIsHex(o1) ? o1.slice(4, -1) : o1) + ')';
      const nm = BC_BOOLN[c];
      if (nm === undefined) throw new BcUnknown(0x7a, this.p - 2, 'bool code ' + c.toString(16));
      const arrayish = tgt.endsWith('()') || tgt.startsWith('STR(');
      if (bcIsHex(o1) || o1.startsWith('"')) {
        const v = bcIsHex(o1) ? o1.slice(4, -1) : bcHex(bcStrip(o1));
        if (arrayish) return c >= 0x10 ? tgt + '=' + nm + ' ALL(' + v + ')' : tgt + '=' + nm + ' HEX(' + v + ')';
        if (v.length > 2 || c < 0x10) return tgt + '=' + nm + ' HEX(' + v + ')';
        return nm + '(' + tgt + ',' + v + ')';
      }
      if (ops[1] instanceof BcSub) return tgt + '=' + nm + ' ' + o1;
      return nm + '(' + tgt + ',' + o1 + ')';
    }
    if (t === 0x79 && ops.length === 2) {
      const c = this.u8(), nm = BC_ARITHN[c];
      if (nm === undefined) throw new BcUnknown(0x79, this.p - 2, 'arith code ' + c.toString(16));
      const o1 = String(ops[1]); const v = bcIsHex(o1) ? o1.slice(4, -1) : o1;
      if (c === 1 || c === 3 || c === 8 || c === 9) return nm + '(' + ops[0] + ',' + v + ')';
      return bcIsHex(o1) ? ops[0] + '=' + nm + ' HEX(' + v + ')' : nm + '(' + ops[0] + ',' + ops[1] + ')';
    }
    if (t === 0x4b && ops.length === 2) { this.u8(); const fl = this.u8(); return '$TRAN(' + ops[0] + ',' + ops[1] + ')' + (fl === 0 ? 'R' : ''); }
    if (t === 0xab) {                                          // PRINTUSING
      const m = this.u8(), x0 = this.u8(), y0 = this.u8(), lo = this.u8(), hi = this.u8(); const smask = x0 | (y0 << 8);   // bit j: a ';' after the format (j=0) or after item j
      let to = '', spec;
      if (m & 4) to = 'TO ' + ops.shift() + ',';
      if (m & 1) spec = ops.length ? String(ops.shift()) : '""'; else spec = String(bcBcdLine(lo, hi));
      const items = [];
      for (;;) {
        if (this.peek() === 0xa9) { this.p++; break; }
        const v = this.operands(), k = this.u8();
        if (k !== 0xaa && k !== 0xac) throw new BcUnknown(k, this.p - 1, 'using item');
        for (const q of v) items.push(String(q));
      }
      let out = 'PRINTUSING ' + to + spec;
      items.forEach((it, i) => { out += ((smask >> i) & 1 ? ';' : ',') + it; });
      if ((smask >> items.length) & 1 && (items.length || !(smask & 1))) out += ';';
      else if (!items.length && (smask & 1)) out += ';';
      return out;
    }
    if (t === 0xb6 && ops.length === 1) {                      // RESTORE LINE n[,k]
      const kind = this.u8(); let ln;
      if (kind === 1) ln = this.relLine(this.u16s()); else { const lo = this.u8(), hi = this.u8(); ln = bcBcdLine(lo, hi); }
      if (ln === 0) return 'RESTORE';
      return 'RESTORE LINE ' + ln + (String(ops[0]) === '1' ? '' : ',' + ops[0]);
    }
    if ((t === 0xae || t === 0xb0) && ops.length === 1) {      // READ
      const tg = [String(ops[0])];
      let k = this.u8(); if (k !== 0x70 && k !== 0x73) throw new BcUnknown(0x70, this.p - 1, 'read store');
      while ([0x53, 0x54, 0x59, 0x56, 0x63, 0x64].indexOf(this.peek()) >= 0) {
        const o2 = this.operands();
        if (o2.length !== 1) throw new BcUnknown(0xae, this.p - 1, 'read list');
        const k1 = this.u8(), k2 = this.u8();
        if ((k1 !== 0xae && k1 !== 0xb0) || (k2 !== 0x70 && k2 !== 0x73)) throw new BcUnknown(0xae, this.p - 1, 'read list');
        tg.push(String(o2[0]));
      }
      return 'READ ' + tg.join(',');
    }
    if (t === 0x5f && ops.length === 2) return 'HEXPACK ' + ops[0] + ' FROM ' + ops[1];
    if (t === 0x60 && ops.length === 2) return 'HEXUNPACK ' + ops[0] + ' TO ' + ops[1];
    if (t === 0x84 && ops.length === 4) {                      // MAT SEARCH
      const kind = this.u8(), rel = BC_RELS[kind] || '=', step = String(ops[3]);
      return 'MAT SEARCH ' + BcDec.matop(ops[0]) + ',' + rel + ops[1] + ' TO ' + BcDec.matop(ops[2]) + (step === '1' ? '' : ' STEP ' + step);
    }
    if (t === 0x81 && ops.length >= 2) {
      this.u8(); this.p += 4;
      const mm = x => (x instanceof BcSub && String(x.s).endsWith('()')) ? x.s + ' (' + (x.start !== null ? x.start : '1') + (x.ln !== null ? ',' + x.ln : '') + ')' : String(x);
      return 'MAT MOVE ' + ops.slice(0, -1).map(mm).join(',') + ' TO ' + mm(ops[ops.length - 1]);
    }
    if (t === 0x85 && ops.length === 1) { const d1 = this.u8(), l1 = this.u8(), d2 = this.u8(), l2 = this.u8(); return 'MAT ' + bcVname(d2, l2) + '=(' + ops[0] + ')*' + bcVname(d1, l1); }
    if (t === 0x7d && ops.length === 2) { this.u8(); return 'MAT COPY ' + BcDec.matop(ops[0]) + ' TO ' + BcDec.matop(ops[1]); }
    if (t === 0x62 && ops.length === 2) {
      const n = this.u8(), fl = this.u8(); let fmt = '';
      if (fl === 8) fmt = '#'.repeat(n);
      else if (fl >= 0x10 && fl <= 0x12) { for (let i = 0; i < n; i++) fmt += String.fromCharCode(this.u8()); this.p += 2; }
      else throw new BcUnknown(0x62, this.p - 2, 'convert format');
      this.p += 2; return 'CONVERT ' + ops[0] + ' TO ' + ops[1] + ',(' + fmt + ')';
    }
    if (t === 0x30 && ops.length === 2) { this.u8(); return 'CONVERT ' + ops[0] + ' TO ' + ops[1]; }
    if (t === 0x6f && ops.length === 2) {
      const o = String(ops[1]);
      return ops[0] + '=ALL(' + (bcIsHex(o) ? o.slice(4, -1) : o) + ')';
    }
    if (t === 0x4d && ops.length === 1) { const f = this.u8(); return 'LINPUT ' + (f & 4 ? '?' : '') + (f & 2 ? '-' : '') + ops[0]; }
    if (t === 0x71 && ops.length >= 2) { this.u16(); return ops.slice(0, -1).map(String).join(',') + '=' + ops[ops.length - 1]; }
    if ((t === 0x65 || t === 0x66) && ops.length === 2) {
      let a0 = String(ops[0]); a0 = bcIsHex(a0) ? a0.slice(4, -1) : bcHex(bcStrip(a0));
      const tg = [String(ops[1])]; let last = t === 0x66;
      while (!last) {
        const o2 = this.operands();
        if (o2.length !== 1) throw new BcUnknown(0x65, this.p - 1, 'init list');
        tg.push(String(o2[0])); const k = this.u8();
        if (k !== 0x65 && k !== 0x66) throw new BcUnknown(k, this.p - 1, 'init list end');
        last = k === 0x66;
      }
      return 'INIT(' + a0 + ')' + tg.join(',');
    }
    if (t === 0x6d && ops.length === 1) { const d = this.u8(), l = this.u8(); return bcVname(d, l) + '=' + ops[0]; }
    if ((t === 0x70 || t === 0x73) && ops.length === 2) {
      let first = ops[0] + '=' + ops[1];
      if (ops[0] instanceof BcSub && ops[0].bin) { let v = String(ops[1]); if (v.startsWith('BIN(') && v.endsWith(')')) v = v.slice(4, -1); first = 'BIN(' + ops[0] + ')=' + v; }
      if (this.more() && this.peek() !== 0x61 && this.peek() !== 0x77) {   // FOR whose limit does not start with a constant or numeric variable
        const save = this.p, ssz = this.st.length; let lim = null;
        try { lim = this.operands(); if (this.u8() !== 0x5c || !lim.length) lim = null; } catch (e) { lim = null; }
        if (lim) { this.u8(); this.u8(); const step = lim.length > 1 ? String(lim[1]) : '1'; return 'FOR ' + first + ' TO ' + lim[0] + (step === '1' ? '' : ' STEP ' + step); }
        this.p = save; this.st.length = ssz;
      }
      return first;
    }
    if ((t === 0x29 || t === 0x2a || t === 0x2b || t === 0x2c) && ops.length === 2) return this.ifStmt(t, ops);
    if (t === 0xa3 && ops.length === 1) {
      const sv = String(ops[0]);
      if ([0x59, 0x54, 0x56, 0x63, 0x64].indexOf(this.peek()) >= 0) {
        const v = this.operands();
        if (v.length === 1 && this.u8() === 0x4d) { const f = this.u8(); return 'LINPUT ' + sv + (f & 4 ? '?' : '') + (f & 2 ? '-' : '') + v[0]; }
        throw new BcUnknown(0x4d, this.p, 'linput end');
      }
      if (this.peek() === 0x4d) {
        this.p += 2; let m = bcStrip(sv);
        if (m.startsWith('HEX(') && m.endsWith(')')) { const h = m.slice(4, -1); m = ''; for (let i = 0; i < h.length; i += 2) m += String.fromCharCode(parseInt(h.substr(i, 2), 16)); }
        return 'STOP ' + this.stopMsg(m);
      }
    }
    if (t === 0x6b && ops.length === 1) {                      // KEYIN var,targets
      const n = this.u8(), tg = []; for (let i = 0; i < n; i++) tg.push(this.target());
      if (n === 0) return 'KEYIN ' + ops[0];
      return 'KEYIN ' + ops[0] + ',' + (n === 2 ? tg[1] : '') + ',' + tg[0];
    }
    if (t === 0x26 && ops.length === 1 && this.peek() !== null) return this.onGoto(ops[0]);
    if (t === 0xbb && ops.length === 2) {
      const one = (a, b) => String(b).startsWith('"') ? '#' + a + ' /' + bcStrip(b) : '#' + a + '<' + b + '>';
      const out = [one(ops[0], ops[1])];
      while (this.peek() === 0x53 || this.peek() === 0x54) {
        const o2 = this.operands();
        if (o2.length !== 2 || this.u8() !== 0xbb) throw new BcUnknown(0xbb, this.p - 1, 'select # chain');
        out.push(one(o2[0], o2[1]));
      }
      while (this.peek() === 0x5a) {
        this.p++; const i2 = this.u8(), v2 = this.operands();
        if (this.u8() !== 0x73 || v2.length !== 1) throw new BcUnknown(0x73, this.p - 1, 'select value 3');
        let w = '';
        while (this.peek() === 0x5b) {
          this.p++; const a = this.u8(), x = this.operands();
          if (this.u8() !== 0x76) throw new BcUnknown(0x76, this.p - 1, 'select attr');
          if (a === 7 || a === 8) w = '(' + x[0] + ')';
        }
        let d2 = String(v2[0]); d2 = d2.startsWith('"') ? bcStrip(d2) : '<' + d2 + '>';
        out.push((BC_DEVN[i2] || 'DEV' + i2) + ' ' + d2 + w);
      }
      return 'SELECT ' + out.join(',');
    }
    if (t === 0xbe && ops.length === 1) return this.diskOp(ops[0]);
    if (t === 0xbe && ops.length === 2 && this.peek() === 0x8f && this.b[this.p + 1] === 0x1f) {   // a$=$DEVICE(#n)
      this.p += 2; if (this.u8() !== 0x5a || this.u8() !== 0x13 || this.u8() !== 0x73) throw new BcUnknown(0xbe, this.p - 1, '$DEVICE read');
      return ops[0] + '=$DEVICE(#' + ops[1] + ')';
    }
    if (t === 0x5a && ops.length === 1 && BC_SYSV[this.peek()] && (this.b[this.p + 1] === 0x73 || this.b[this.p + 1] === 0xc5)) {
      const i = this.u8(); let rhs = '$' + BC_SYSV[i];
      if (this.peek() === 0xc5) {
        this.p++; if (this.u8() !== 0x2e) throw new BcUnknown(0x2e, this.p - 1, 'sysvar concat');
        const v = this.operands(), k = this.u8();
        if ((k !== 0x73 && k !== 0x6f) || v.length !== 1) throw new BcUnknown(k, this.p - 1, 'sysvar concat end');
        let tail = String(v[0]); if (k === 0x6f) tail = tail.replace(/HEX\(([0-9A-F]+)\)$/, 'ALL($1)');
        return ops[0] + '=' + rhs + '&' + tail;
      }
      this.u8(); return ops[0] + '=' + rhs;
    }   // a$=$SCREEN ...
    if (t === 0xd7 && ops.length === 1) { this.u8(); return '$SHELL ' + ops[0]; }
    if (t === 0x49 && ops.length === 2) {                      // $PACK / $UNPACK (fmt) a$ FROM/TO items
      this.u8(); this.u8(); const kk = this.u8(); const its = [];
      for (;;) { const o = this.operands(); if (!o.length) break; if (this.u8() !== 0x30) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'pack item'); this.u8(); its.push(String(o[0])); }
      const w = { 5: ['$UNPACK', 'D'], 4: ['$UNPACK', 'F'], 2: ['$PACK', 'D'], 1: ['$PACK', 'F'] }[kk];
      if (!w || !its.length) throw new BcUnknown(0x49, this.p - 1, 'pack kind');
      return w[0] + '(' + w[1] + '=' + ops[0] + ') ' + ops[1] + (kk >= 4 ? ' TO ' : ' FROM ') + its.join(',');
    }
    if (t === 0xbd && ops.length === 1) {                      // device address /xxx : $IF and VERIFY
      const addr = String(ops[0]).startsWith('"') ? bcStrip(String(ops[0])) : String(ops[0]);
      if (this.peek() === 0x5a && this.b[this.p + 1] === 0x13) {            // $DEVICE(/addr)=value
        this.p += 2; const v = this.operands();
        if (this.u8() !== 0x73 || this.u8() !== 0x8f || this.u8() !== 0x20 || v.length !== 1) throw new BcUnknown(0x5a, this.p - 1, '$DEVICE store');
        return '$DEVICE(/' + addr + ')=' + v[0];
      }
      if (this.peek() === 0x8f) {
        this.p++; if (this.u8() !== 0x07) throw new BcUnknown(0x8f, this.p - 1, '$IF');
        this.p += 3;
        const v = this.operands();
        if (this.u8() !== 0x2a || this.u8() !== 0x02 || v.length !== 1) throw new BcUnknown(0x2a, this.p - 1, '$IF line');
        const lo = this.u8(), hi = this.u8();
        return '$IF ' + (String(v[0]) === '1' ? 'ON' : 'OFF') + ' /' + addr + ',' + bcBcdLine(lo, hi);
      }
      const o2 = this.operands();
      if (this.peek() === 0x48) {
        this.p += 4;
        return '$GIO/' + addr + '(' + o2.map(x => { x = String(x); return bcIsHex(x) ? x.slice(4, -1) : x.startsWith('"') ? bcHex(bcStrip(x)) : x; }).join(',') + ')';
      }
      if (this.u8() !== 0xca) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'verify');
      this.u8();
      return 'VERIFY T/' + addr + (o2.length ? ',' + o2[0] : '');
    }
    throw new BcUnknown(t, this.p - 1, 'after ' + ops.length + ' operands');
  }

  ifStmt(t, ops) {
    const code = this.u8(); const rel = BC_RELS[code];
    if (!rel) throw new BcUnknown(code, this.p - 1, 'relation');
    const raw = BcDec.cnd(ops[0], rel, ops[1]), inv = BcDec.cnd(ops[0], BC_INV[rel], ops[1]);
    if (t === 0x2a || t === 0x2c) {
      const lo = this.u8(), hi = this.u8();
      const io = new BcIf([{ raw, inv, tgt: null, lineForm: true }], null, String(bcBcdLine(lo, hi))); io.coreEnd = this.p; return io;
    }
    const skip = this.u16();
    if (skip >= 0x8000) {                                      // THEN <earlier line>: relative jump back
      const ln = this.relLine(skip - 65536);
      const io = new BcIf([{ raw, inv, tgt: null, lineForm: true }], null, String(ln)); io.coreEnd = this.p; return io;
    }
    const p0 = this.p, end = p0 + skip; const inner = [];
    while (this.p < end) inner.push(this.statement());
    const core = this.p;
    const me = { raw, inv, tgt: end, lineForm: false };
    if (inner.length === 1 && inner[0] instanceof BcIf) {                                       // the chain continues
      const io = inner[0]; const r = new BcIf([me].concat(io.flat), io.thenStart, io.body, io.els); r.coreEnd = io.coreEnd; r.noJump = io.noJump; return r;
    }
    if (inner.length && inner[inner.length - 1] === '<ELSE>') {
      inner.pop(); const ee = this.elseEnd, els = [];
      while (this.p < ee) { if (!this.nohdr) { if (this.u8() !== 0x61) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'else header'); this.u8(); } els.push(this.statement()); }
      const r = new BcIf([me], p0, inner.map(String).join(':'), els.map(String).join(':')); r.coreEnd = core; return r;
    }
    const r = new BcIf([me], p0, inner.map(String).join(':')); r.coreEnd = core;
    r.noJump = inner.length > 0 && /^(LOAD|GOTO|RETURN|END|STOP)(?![A-Z0-9$])/.test(String(inner[inner.length - 1]));   // no jump over an ELSE part was compiled after a statement that never falls through
    return r;
  }

  static matop(x) {
    if (x instanceof BcSub && String(x.s).endsWith('()')) return x.s + '<' + (x.start !== null ? x.start : '1') + (x.ln !== null ? ',' + x.ln : '') + '>';
    return String(x);
  }

  imageText(start, n) {
    const tl = this.u8(); let out = this.str(tl); const end = start + n;
    while (this.p < end) {
      const c = this.u8();
      if (c === 0) break;
      if (this.peek() === 8) { this.p++; out += '#'.repeat(c); } else { const m = Math.min(c, this.b.length - this.p); out += this.str(Math.max(m, 0)); this.p += c - Math.max(m, 0); }
    }
    return out;
  }

  gio(text) {
    let fno = null;
    if (this.peek() === 0x53) {
      const o0 = this.operands();
      if (this.u8() !== 0xbe || o0.length !== 1) throw new BcUnknown(0xbe, this.p - 1, 'gio file');
      fno = o0[0];
    } else if (this.peek() === 0x5a) {
      this.p++; this.u8();
      if (this.u8() !== 0xbd) throw new BcUnknown(0xbd, this.p - 1, 'gio bd');
    } else throw new BcUnknown(this.peek() === null ? undefined : this.peek(), this.p, 'gio start');
    const ops = this.operands();
    if (!ops.length || !bcIsHex(ops[0])) throw new BcUnknown(0x58, this.p, 'gio hex');
    const h = String(ops[0]).slice(4, -1); const words = []; for (let i = 0; i < h.length; i += 4) words.push(h.substr(i, 4));
    let second = [];
    if (this.peek() === 0x26) { this.p += 3; second = this.operands(); }
    if (this.peek() === 0x8f) this.p += 2;
    if (this.u8() !== 0x48) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'gio call');
    this.u8(); const fl = this.u16();
    if (fl === 1) this.u16();
    const fmt = x => x instanceof BcSub ? x.s + '<' + (x.start !== null ? x.start : '1') + ',' + x.ln + '>' : String(x);
    let out = '$GIO ' + text + (fno !== null ? '#' + fno : '') + '(' + words.join(' ');
    if (ops.length > 1) out += ',' + ops.slice(1).map(fmt).join(',');
    out += ')' + second.map(fmt).join('');
    return out;
  }

  dcItems(endTok) {
    const items = [];
    while (this.peek() !== endTok) {
      const v = this.operands();
      if (this.u8() !== 0x30) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'dc item');
      this.u8(); for (const x of v) items.push(String(x));
    }
    this.p++;
    return items;
  }

  diskOp(fno) {
    const ops2 = this.operands(); const t = this.u8();
    if (t === 0x5a && !ops2.length && this.peek() === 0x13) {              // $DEVICE(#n)=value
      this.p++; const v = this.operands();
      if (this.u8() !== 0x73 || this.u8() !== 0x8f || this.u8() !== 0x20 || v.length !== 1) throw new BcUnknown(0x5a, this.p - 1, '$DEVICE store');
      return '$DEVICE(#' + fno + ')=' + v[0];
    }
    if (t === 0x78 && ops2.length === 1) {
      const fl = this.u8();
      const a = bcBcdLine(this.u8(), this.u8()), z = bcBcdLine(this.u8(), this.u8()); const blo = this.u8(), bhi = this.u8();
      const beg = (blo === 0x9a && bhi === 0x99) ? 0 : bcBcdLine(blo, bhi);
      const nm = String(ops2[0]); let out;
      if (nm.startsWith('"') && String(fno) === '0') out = 'LOAD ' + (fl & 1 ? 'RUN ' : '') + 'T' + nm;
      else out = 'LOAD ' + (fl & 1 ? 'RUN ' : '') + 'T#' + fno + ',' + nm + ' ';
      if (!(a === 0 && z === 9999)) out += a + ',' + z;
      if (beg) out += ' BEG ' + beg;
      return out;
    }
    if (t === 0x46 && this.b[this.p + 1] === 0x32) {          // DATA LOAD DA
      this.u8(); this.p++; this.u16(); const items = this.dcItems(0x33);
      return 'DATA LOAD DA T#' + fno + ',(' + ops2.map(String).join(',') + ')' + items.join(',');
    }
    if (t === 0x46 && this.b[this.p + 1] === 0x37) {          // DATA SAVE DA
      this.u8(); this.p++; const items = [];
      while (this.peek() !== 0x61 && this.peek() !== 0x77 && this.peek() !== null) {
        const v = this.operands();
        if (this.u8() !== 0x30) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'da item');
        this.u8(); for (const x of v) items.push(String(x));
      }
      return 'DATA SAVE DA T#' + fno + ',(' + ops2.map(String).join(',') + ')' + items.join(',');
    }
    if (t === 0x46) { this.u8(); const arr = this.operands(), op = this.u8(); return 'DATA ' + ({ 0x31: 'LOAD', 0x36: 'SAVE' }[op] || 'OP' + op.toString(16)) + ' BA T#' + fno + ',(' + ops2.join(',') + ')' + arr[0]; }
    if (t === 0x35 && ops2.length === 1) { this.u8(); return 'DATA LOAD DC OPEN T#' + fno + ',' + ops2[0]; }
    if (t === 0x3d && ops2.length) { this.u8(); return ops2.length === 2 ? 'DATA SAVE DC OPEN T#' + fno + ',(' + ops2[0] + ')' + ops2[1] : 'DATA SAVE DC OPEN T#' + fno + ',' + ops2[0]; }
    if (t === 0x3c) return 'DATA SAVE DC #' + fno + ',END';
    if (t === 0x34) { this.u16(); return 'DATA LOAD DC ' + (String(fno) === '0' ? '' : '#' + fno + ',') + this.dcItems(0x33).join(','); }
    if (t === 0x3a) return 'DATA SAVE DC ' + (String(fno) === '0' ? '' : '#' + fno + ',') + this.dcItems(0x39).join(',');
    if (t === 0x8f) {
      const k = this.u8();
      if (k === 0x15 && ops2.length === 1) return String(fno) === '0' ? 'SCRATCH T' + ops2[0] : 'SCRATCH T#' + fno + ',' + ops2[0];
      if ((k === 0x16 || k === 0x17) && ops2.length === 2) return (k === 0x17 ? "SCRATCH DISK 'T#" : 'SCRATCH DISK T#') + fno + ',LS=' + ops2[0] + ',END =' + ops2[1];
      if (k === 0x0b && !ops2.length) {
        const ns = ['#' + fno];
        while (this.peek() === 0x53 && this.b[this.p + 1] === 1 && this.b[this.p + 3] === 0xbe && this.b[this.p + 4] === 0x8f && this.b[this.p + 5] === 0x0b) { ns.push('#' + this.b[this.p + 2]); this.p += 6; }
        return '$CLOSE' + ns.join(',');
      }
      if (k === 0x12 && !ops2.length) return '$FORMATDISK T#' + fno;
      if (k === 0x24 && !ops2.length) return 'LIST SDC T#' + fno;
      if (k === 0x08 && !ops2.length) {
        if (this.peek() === 0x8f) {                              // $OPEN line,#n
          this.p++; this.u8();
          if (this.peek() !== 0x69) return '$OPEN #' + fno;
          this.p++;
          const lo = this.u8(), hi = this.u8(); return '$OPEN ' + bcBcdLine(lo, hi) + ',#' + fno;
        }
        const src = this.operands();
        if (this.u8() !== 0xbe || this.u8() !== 0x8f || this.u8() !== 0x08) throw new BcUnknown(0xbe, this.p - 1, 'copy to');
        const dst = (this.peek() === 0x2f || this.peek() === 0x91 || this.peek() === 0x8f) ? [] : this.operands(), kend = this.u8();
        if (kend === 0x8f) { if (this.u8() === 0x0a && src.length === 1 && !dst.length) return '$OPEN #' + fno + ',#' + src[0]; throw new BcUnknown(0x8f, this.p - 1, 'open pair'); }
        if (kend !== 0x2f && kend !== 0x91) throw new BcUnknown(kend, this.p - 1, 'copy end');
        this.u8();
        if (!src.length) throw new BcUnknown(0x08, this.p - 2, 'copy source');
        const verb = kend === 0x2f ? 'COPY' : 'MOVE', a1 = src.slice(0, -1).map(String).join(','), a2 = dst.map(String).join(',');
        if (!a1 && !a2) return verb + ' T#' + fno + ', TO T#' + src[src.length - 1] + ',';
        return verb + ' T#' + fno + ',(' + a1 + ') TO T#' + src[src.length - 1] + ',(' + a2 + ')';
      }
      throw new BcUnknown(0x8f, this.p - 2, 'disk 8f ' + k.toString(16));
    }
    if (t === 0x3b) { this.u8(); return 'DATA SAVE DC CLOSE' + (String(fno) === '0' ? '' : '#' + fno); }
    if (t === 0xba && ops2.length) {
      const fl = this.u8(); const a = bcBcdLine(this.u8(), this.u8()), z = bcBcdLine(this.u8(), this.u8());
      const rng = (a === 0 && z === 9999) ? '' : ' ' + a + ',' + z;
      if (ops2.length === 1) return (fl === 0 ? (String(fno) === '0' ? 'SAVE T' : 'SAVE T#' + fno + ',') : 'SAVE T()') + ops2[0] + rng;
      return 'SAVE T#' + fno + ',(' + ops2[0] + ')' + ops2.slice(1).map(String).join(',') + rng;
    }
    if (t === 0x3f && !ops2.length) { const c = this.u8(); const w = c === 4 ? 'DSKIP' : 'DBACKSPACE'; return String(fno) === '0' ? w + ' BEG' : w + ' #' + fno + ',BEG'; }
    if (t === 0xca) {
      const c = this.u8();
      if (c === 1 && ops2.length) return 'VERIFY T#' + fno + ',(' + ops2.slice(0, -1).map(String).join(',') + ')' + ops2[ops2.length - 1];
      return 'VERIFY T#' + fno + ',(' + ops2.map(String).join(',') + ')';
    }
    if (t === 0x3f && ops2.length === 1) {
      const c = this.u8(); const w = (c === 0 || c === 2) ? 'DBACKSPACE' : 'DSKIP', sfx = (c === 2 || c === 5) ? ' S' : '';
      return String(fno) === '0' ? w + ' ' + ops2[0] + sfx : w + ' #' + fno + ',' + ops2[0] + sfx;
    }
    if (t === 0x7b) {
      this.u8(); const vs = [];
      while (this.peek() === 0x54 || this.peek() === 0x59) {
        const v = this.operands();
        if (this.u8() !== 0x55) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'limits item');
        const slot = this.u8() - 0x0f; this.u8();
        if (this.u8() !== 0x70) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'limits store');
        while (vs.length < slot) vs.push('');
        vs[slot] = String(v[0]);
      }
      return 'LIMITS T#' + fno + ',' + ops2[0] + ',' + vs.join(',');
    }
    throw new BcUnknown(t, this.p - 1, 'disk op');
  }

  target() {
    const t = this.u8();
    if (t === 0x69) { const lo = this.u8(), hi = this.u8(); return String(bcBcdLine(lo, hi)); }
    if (t === 0x26) { let off = this.u16(); if (off > 32767) off -= 65536; return off < 0 ? String(this.relLine(off)) : ''; }
    throw new BcUnknown(t, this.p - 1, 'target');
  }

  onGoto(expr) {
    this.u16(); const ents = []; let gosub = false;
    while (this.peek() === 0x69 || this.peek() === 0x6a || this.peek() === 0x26) {
      const pos = this.p;
      if (this.peek() === 0x69 || this.peek() === 0x6a) { if (this.peek() === 0x6a) gosub = true; this.p++; const lo = this.u8(), hi = this.u8(); ents.push([pos, String(bcBcdLine(lo, hi))]); }
      else { this.p += 3; ents.push([pos, '']); }
    }
    if (this.u8() !== 0x96) throw new BcUnknown(0x96, this.p - 1, 'on table');
    const cnt = this.u16(); this.u16(); const tab = this.p; const slots = [];
    for (let k = 0; k < cnt; k++) {
      let w = this.u16(); if (w > 32767) w -= 65536;
      const tgt = tab + 2 * k + 2 + w; const hit = ents.find(e => e[0] === tgt);
      slots.push(hit ? hit[1] : '');
    }
    return 'ON ' + expr + ' ' + (gosub ? 'GOSUB' : 'GOTO') + ' ' + slots.join(',');
  }

  stopMsg(m) {
    if (m.startsWith('\r')) m = m.slice(1);
    if (m.endsWith('\r')) m = m.slice(0, -1);
    if (m.startsWith('STOP ')) m = m.slice(5);
    if (m === '') return '';
    const ln = ('000' + this.curline).slice(-4);
    if (m.endsWith(ln)) return m.length > 4 ? '"' + m.slice(0, -4) + '"#' : '#';
    return '"' + m + '"';
  }

  printStmt() {
    let items = [], matItems = [], matSep = []; let nl = false, saw9e = false; const segs = [];
    const fmt = () => {
      if (matItems.length) { let m = 'MAT PRINT '; matItems.forEach((v, i) => { m += v + (i < matItems.length - 1 ? matSep[i] : (matSep[i] === ';' ? ';' : '')); }); return m; }
      if (saw9e && items.length === 1 && String(items[0]).startsWith('HEXOF(')) return 'HEXPRINT ' + String(items[0]).slice(6, -1);
      let out = '';
      for (const it0 of items) {
        const it = String(it0);
        if (it === ',') { out += ','; continue; }
        out += (out && !out.endsWith(',') ? ';' : '') + it;
      }
      if (items.length && !nl && !out.endsWith(',')) out += ';';
      return ('PRINT ' + out).replace(/\s+$/, '');
    };
    while (this.more()) {
      const t = this.u8();
      if (t === 0xb4) break;
      if (t === 0x9e || t === 0x9f) {                       // end of a PRINT; the compiler may keep the next PRINT in the same record
        nl = true; if (t === 0x9e) saw9e = true;
        if (this.more() && this.peek() !== 0xb4) { segs.push(fmt()); items = []; matItems = []; matSep = []; nl = false; saw9e = false; }
        continue;
      }
      if (t === 0xa7) { items.push(','); continue; }
      if (t === 0xa4) { items.push(''); continue; }
      if (t === 0xa0 || t === 0xa2 || t === 0xa5 || t === 0xa1 || t === 0xc5) {
        if (t === 0xc5) continue;
        let v = this.pop();
        if (t === 0xa0 && typeof v === 'string' && v.startsWith('"')) v = 'HEX(' + bcHex(v.slice(1, -1)) + ')';
        if (t === 0xa5 && typeof v === 'string' && /^HEX\(([0-9A-F]{2})+\)$/.test(v)) { const raw = v.slice(4, -1).match(/../g).map(h => String.fromCharCode(parseInt(h, 16))).join(''); if (raw.indexOf('"') < 0) v = '"' + raw + '"'; }
        items.push(t === 0xa1 ? 'HEXOF(' + v + ')' : v); continue;
      }
      if (t === 0x9c) { const n = this.u8(), args = []; for (let i = 0; i < (n === 2 ? 3 : 2); i++) args.unshift(this.pop()); items.push('AT(' + args.map(String).join(',') + (n === 1 ? ',' : '') + ')'); continue; }
      if (t === 0x9d) { const b = this.pop(), a = this.pop(); items.push('BOX(' + a + ',' + b + ')'); continue; }
      if (t === 0xa6) { items.push('TAB(' + this.pop() + ')'); continue; }
      if (t === 0x83) { const fl = this.u8(), d = this.u8(), l = this.u8(); matItems.push(bcVname(d, l)); matSep.push((fl & 2) ? ',' : ';'); continue; }
      if (this.exprToken(t)) continue;
      throw new BcUnknown(t, this.p - 1, 'print');
    }
    segs.push(fmt());
    return segs.join(':');
  }
}

/* a statement kept in Wang tokenized form: tokens = the TOKENS table of image.js */
function bcTokensText(b, tokens) {
  let out = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 0xff && i + 2 < b.length) { out += String(1000 * (b[i + 1] >> 4) + 100 * (b[i + 1] & 15) + 10 * (b[i + 2] >> 4) + (b[i + 2] & 15)); i += 2; continue; }
    if (c < 128) out += String.fromCharCode(c);
    else if (tokens[c]) out += tokens[c];
    else out += '\\x' + ('0' + c.toString(16)).slice(-2);
  }
  return out;
}

/* one line body -> statement text (throws BcUnknown when it meets something it does not understand).
   base / starts: absolute offset of the body in the program and a Map(offset -> line number) of all bodies, used to
   resolve relative jumps (GOTO / KEYIN / IF ... THEN <earlier line>); optional. */
function decompileBody(body, lineno, base, starts, tokens, nohdr) {
  const d = new BcDec(body); d.nohdr = !!nohdr; d.curline = lineno || 0; d.base = base || 0; d.starts = starts || null; d.tokens = tokens || null; const out = []; let lastIdx = -1, prevIf = false, pend = '', pendNn = -1, merge = false, elseNext = false;
  let indent = '';
  if (body[0] === 0xd3) { indent = ' '.repeat(body[1]); d.p = 2; }
  if (body[d.p] === 0xcb) { d.p++; const n = d.u16(), st0 = d.p; return '%' + d.imageText(st0, n); }
  while (d.more()) {
    const t = d.u8();
    if (t === 0x77) break;
    if (t === 0xd3) { pendNn = d.u8(); continue; }
    if (t === 0xd4 || (nohdr && t === 0x61)) { d.u8(); continue; }
    if (t === 0x20 && d.tokens) {                              // a statement kept in Wang tokenized form
      const q = d.p; d.u16();
      const e = (body.length >= 3 && body[body.length - 3] === 0x77 && body[body.length - 2] === 0 && body[body.length - 1] === 0) ? body.length - 3 : body.length;
      out.push(bcTokensText(body.subarray(q + 6, e), d.tokens)); d.p = e; prevIf = false; continue;
    }
    if (t === 0xcb) { const q = d.p, n = d.u16(); const txt = d.imageText(d.p, n); d.p = q + 2 + n; out.push('%' + txt); continue; }
    let idx;
    if (t !== 0x61) {
      const pcRem = out.length && out[out.length - 1] === 'REM ';
      if (!prevIf && !pcRem && !nohdr) throw new BcUnknown(t, d.p - 1, 'stmt header');
      d.p--; idx = (nohdr && !(out.length && out[out.length - 1] === 'ERROR')) ? lastIdx + 1 : lastIdx; if (pcRem) { merge = true; }
    } else { idx = d.u8(); if (d.peek() === 0x77) continue; }
    const sobj = d.statement(); let s = String(sobj);
    if (elseNext) { elseNext = false; s = 'ELSE ' + s; }
    if (sobj instanceof BcIf && sobj.noJump && !sobj.els && d.more()) {
      let q = d.p; while (q + 1 < body.length && (body[q] === 0x61 || (nohdr && body[q] === 0xd4))) q += 2;
      if (q < body.length && body[q] !== 0x77 && body[q] !== 0x51 && (nohdr || body[d.p] === 0x61)) elseNext = true;
    }
    if (merge) { merge = false; out.pop(); s = 'REM $PC ' + s; }
    if (out.length && out[out.length - 1] === 'ERROR' && idx === lastIdx) { out[out.length - 1] = 'ERROR ' + s; continue; }
    lastIdx = idx; prevIf = s.startsWith('IF ');
    if (pendNn >= 0) { const col = indent.length + out.join(':').length + 1; pend = ' '.repeat(Math.max(pendNn + 2 - col, 0)); pendNn = -1; }
    out.push(pend + s); pend = '';
  }
  return indent + out.join(':');
}

/* characters outside printable ASCII are written as \xHH, as the rest of the listings do */
function bcEscape(s) { return s.replace(/[^\x20-\x7e]/g, c => '\\x' + ('0' + c.charCodeAt(0).toString(16)).slice(-2)).replace(/\\(?!x[0-9a-f]{2})/g, '\\x5c'); }

/* the bytes of a compiled program (starting at "0E 00 BC Rev ...") -> listing */
function decompileProgram(bytes, tokens) {
  let sig = ''; for (let i = 2; i < 16; i++) sig += String.fromCharCode(bytes[i]);
  const recs = []; let p = 16;
  while (p + 4 <= bytes.length) {
    if (bytes[p] === 0xff && bytes[p + 1] === 0xff) break;
    const hex = ('0' + bytes[p + 1].toString(16)).slice(-2) + ('0' + bytes[p].toString(16)).slice(-2);
    if (!/^\d+$/.test(hex)) break;
    const no = parseInt(hex, 10), len = bytes[p + 2] | (bytes[p + 3] << 8);
    recs.push({ no, base: p + 4, body: bytes.subarray(p + 4, p + 4 + len) }); p += 4 + len;
  }
  const starts = new Map(); for (const r of recs) starts.set(r.base, r.no);
  // without the compiler's "statement numbers" option the statements carry no 61 nn header
  let nohdr = false;
  for (const r of recs) { let q = 0; if (r.body[0] === 0xd3) q = 2; const f = r.body[q]; if (f === 0xcb || f === 0x77) continue; if (f !== 0x61 && f !== 0x20 && f !== 0xd4) { nohdr = true; break; } }
  const lines = []; let failed = 0;
  for (const r of recs) {
    let text;
    try { text = bcEscape(decompileBody(r.body, r.no, r.base, starts, tokens, nohdr)); }
    catch (e) { failed++; text = 'REM *** NOT DECODED (' + (e.why || e.message) + ') ***'; }
    lines.push(r.no + text);
  }
  return { text: lines.join('\n') + '\n', total: recs.length, failed, rev: sig.trim() };
}

if (typeof module !== 'undefined') module.exports = { decompileProgram, decompileBody, BcUnknown };
