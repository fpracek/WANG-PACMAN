/* ================= Niakwa BASIC-2C object code ("BC Rev 1.0x") -> BASIC-2 listing =================
   The compiled form of a program is not encrypted: a stream of line records
       <line number: 2 bytes BCD little endian> <length: u16 LE> <body of that length, ending 77 00 00>
   whose bodies are statements (61 <index> ...) written in postfix: operands push text on a stack, operators pop.
   This is a partial decompiler built from pairs of source / object code (see docs/NIAKWA-OBJECT.md): about three
   quarters of the lines come back identical to the source, the others are reported as "not decoded".
   decompileProgram(bytes) -> { text, total, failed, rev }       (text: one "<no><statement>" per line) */

class BcUnknown extends Error {
  constructor(b, pos, why) { super('unknown ' + (b === undefined ? '??' : b.toString(16)) + ' at ' + pos + ' ' + (why || '')); this.b = b; this.pos = pos; this.why = why || ''; }
}

const BC_BIN = { 0x23: '+', 0xc4: '-', 0x92: '*', 0x47: '/', 0x90: 'MOD', 0x91: '^' };
const BC_FUNC = { 0x68: ['INT', 1, 1], 0x6c: ['LEN', 1, 1], 0x89: ['RND', 2, 1] };
const BC_RELS = { 1: '<', 2: '=', 3: '<=', 4: '>', 5: '<>', 6: '>=' };
const BC_INV = { '<': '>=', '=': '<>', '<=': '>', '>': '<=', '<>': '=', '>=': '<' };
const BC_PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };

class BcIf {
  constructor(conds, body, els) { this.conds = conds; this.body = body; this.els = els || null; }
  toString() {
    let t = 'IF ';
    for (const [c, j] of this.conds) t += c + (j === 'LAST' ? '' : ' ' + j + ' ');
    t += ' THEN ' + this.body;
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
function bcG10(v) {                                   // Python's '%.10g'
  let s = Number(v.toPrecision(10)).toString();
  if (/e/.test(s)) return s;
  return s;
}
const bcStrip = x => String(x).replace(/^"+|"+$/g, '');
const bcHex = s => Array.from(s).map(c => ('0' + c.charCodeAt(0).toString(16)).slice(-2)).join('').toUpperCase();

class BcDec {
  constructor(body) { this.b = body; this.p = 0; this.st = []; this.precs = new Map(); this.curline = 0; this.elseEnd = 0; }
  u8() { if (this.p >= this.b.length) throw new BcUnknown(undefined, this.p, 'end of data'); return this.b[this.p++]; }
  u16() { const v = this.u8(); return v | (this.u8() << 8); }
  more() { return this.p < this.b.length; }
  peek() { return this.p < this.b.length ? this.b[this.p] : null; }
  pop() { if (!this.st.length) throw new BcUnknown(undefined, this.p, 'stack empty'); return this.st.pop(); }
  str(n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }

  exprToken(t) {
    const st = this.st;
    if (t === 0x53) {
      const kind = this.u8();
      if (kind === 1 || kind === 9 || kind === 0x11 || kind === 0x19) st.push(String(this.u8()));
      else if (kind === 2 || kind === 0x12) st.push(String(this.u16()));
      else if (kind === 3 || kind === 0x0b) { const v = this.u16(); st.push(String(v > 32767 ? v - 65536 : v)); }
      else if (kind === 4) { const v = (this.u16() + this.u16() * 65536); st.push(String(v >= 2147483648 ? v - 4294967296 : v)); }
      else if (kind === 0) {
        let e = this.u16(); if (e > 32767) e -= 65536;
        let m = 0; for (let i = 5; i >= 0; i--) m = m * 256 + this.b[this.p + i]; this.p += 6;
        const v = e >= 0 ? m * Math.pow(10, e) : m / Math.pow(10, -e);
        let s = bcG10(v); if (v > 0 && v < 1) s = s.replace(/^0+/, '');
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
    else if (t === 0x8f) {
      const k = this.u8(); st.push(k === 3 ? 'DATE' : k === 5 ? 'TIME' : 'SYS' + k);
      if (this.peek() === 0x5a) this.p += 2;
    } else if (t === 0x2e) st.push(new BcCat(this.pop()));
    else if (t === 0x24) st.push('BIN(' + this.pop() + ')');
    else if (t === 0xda) this.u8();
    else if (t === 0xc0) { const start = this.pop(); st.push(new BcSub(this.pop(), start)); }
    else if (t === 0xc1) { const v = this.u16(); st.push(new BcSub(this.pop(), String(v + 1))); }
    else if (t === 0xc2) {
      const ln = this.pop(), top = this.pop();
      if (top instanceof BcSub) { top.ln = ln; st.push(top); } else st.push(new BcSub(top, null, ln));
    } else if (t === 0xc3) {
      const v = this.u16(), top = this.pop();
      if (top instanceof BcSub) { top.ln = String(v); st.push(top); } else st.push(new BcSub(top, null, String(v)));
    } else if (BC_BIN[t] !== undefined) { this.u8(); const b = this.pop(), a = this.pop(); st.push(this.binop(t, a, b)); }
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

  statement() {
    let t = this.u8();
    if (t === 0xd2) {                                          // REM
      const n = this.u16(); let s = '';
      for (let i = 0; i < n; i++) { const c = this.u8(); if (i === 0) continue; s += (c >= 1 && c <= 0x1f) ? ' '.repeat(c) : String.fromCharCode(c); }
      return 'REM ' + s;
    }
    if (t === 0xb7) return 'RETURN';
    if (t === 0x51) { this.p += 6; return 'ERROR'; }
    if (t === 0x5a) {
      const i = this.u8(), v = this.operands();
      if (this.u8() !== 0x73 || v.length !== 1) throw new BcUnknown(0x73, this.p - 1, 'select value');
      if (i === 9) return '$PSTAT=' + v[0];
      let w = '';
      while (this.peek() === 0x5b) {
        this.p++; const a = this.u8(), x = this.operands();
        if (this.u8() !== 0x76) throw new BcUnknown(0x76, this.p - 1, 'select attr');
        if (a === 7 || a === 8) w = '(' + x[0] + ')';
      }
      let dev = String(v[0]); dev = dev.startsWith('"') ? bcStrip(dev) : '<' + dev + '>';
      return 'SELECT ' + ({ 0: 'TAPE', 1: 'PRINT', 2: 'LIST' }[i] || 'DEV' + i) + ' ' + dev + w;
    }
    if (t === 0x26) {
      let off = this.u16(); if (off > 32767) off -= 65536;
      if (off < 0) return 'GOTO ' + this.curline;
      this.elseEnd = this.p + off; return '<ELSE>';
    }
    if (t === 0x6a) { const lo = this.u8(), hi = this.u8(); return 'GOSUB ' + bcBcdLine(lo, hi); }
    if (t === 0x8f) return 'END';
    if (t === 0x69) { const lo = this.u8(), hi = this.u8(); return 'GOTO ' + bcBcdLine(lo, hi); }
    if (t === 0x5d) { const d = this.u8(), l = this.u8(); return 'NEXT ' + bcVname(d, l); }
    if (t === 0x6e) { const v = this.u16(), d = this.u8(), l = this.u8(); return bcVname(d, l) + '=' + v; }
    if (t === 0xbc) return this.printStmt();
    if (t === 0x5e) {                                          // GOSUB 'n(args)
      const fn = this.u8(), argc = this.u8(); this.p += 2; const args = [];
      for (let i = 0; i < argc; i++) { args.push(this.expr()); if (this.u8() !== 0x72) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'gosub arg end'); }
      return "GOSUB '" + fn + (args.length ? '(' + args.join(',') + ')' : '');
    }
    if (t === 0x41) {                                          // DEFFN 'n(params)
      const n = this.u16(), end = this.p + n, fn = this.u16(); this.u8(); this.p += 2; const ps = [];
      while (this.p < end) {
        const tt = this.u8();
        if (tt === 0x59 || tt === 0x54) { const d = this.u8(), l = this.u8(); ps.push(bcVname(d, l)); if (this.peek() === 0x94) this.u8(); }
        else if (tt === 0x4f) break;
        else throw new BcUnknown(tt, this.p - 1, 'deffn');
      }
      this.p = end;
      return "DEFFN'" + fn + (ps.length ? '(' + ps.join(',') + ')' : '');
    }
    if (t === 0xcb) { const n = this.u16(), tl = this.u8(); const s = this.str(tl); this.p += n - 1 - tl; return '%' + s; }
    if (t === 0x3e) {                                          // DATA
      const n = this.u16(), end = this.p + n, cnt = this.u8(), mask = this.u16(); const items = [];
      for (let k = 0; k < cnt; k++) {
        const l = this.u8(); let s = '', num = 0;
        for (let i = 0; i < l; i++) { const c = this.u8(); s += String.fromCharCode(c); num += c * Math.pow(256, i); }
        items.push((mask >> k) & 1 ? '"' + s + '"' : String(num));
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
        else throw new BcUnknown(tt, this.p - 1, 'dim item');
      }
      this.p = end;
      return verb + ' ' + items.join(',');
    }
    this.p--;
    const ops = this.operands();
    t = this.u8();
    if (t === 0x62 && ops.length === 2) { const n = this.u8(); this.p += 3; return 'CONVERT ' + ops[0] + ' TO ' + ops[1] + ',(' + '#'.repeat(n) + ')'; }
    if (t === 0x30 && ops.length === 2) { this.u8(); return 'CONVERT ' + ops[0] + ' TO ' + ops[1]; }
    if (t === 0x6f && ops.length === 2) {
      const o = String(ops[1]);
      return ops[0] + '=ALL(' + (o.startsWith('"') ? bcStrip(o) : o.startsWith('HEX(') ? o.slice(4, -1) : o) + ')';
    }
    if (t === 0x4d && ops.length === 1 && this.peek() === 3) { this.u8(); return 'LINPUT -' + ops[0]; }
    if (t === 0x71 && ops.length >= 2) { this.u16(); return ops.slice(0, -1).join(',') + '=' + ops[ops.length - 1]; }
    if (t === 0x66 && ops.length === 2) {
      let a0 = String(ops[0]); a0 = a0.startsWith('HEX(') ? a0.slice(4, -1) : bcHex(bcStrip(a0));
      return 'INIT(' + a0 + ')' + ops[1];
    }
    if (t === 0x6d && ops.length === 1) { const d = this.u8(), l = this.u8(); return bcVname(d, l) + '=' + ops[0]; }
    if ((t === 0x70 || t === 0x73) && ops.length === 2) {
      const first = ops[0] + '=' + ops[1];
      if (this.peek() === 0x53 || this.peek() === 0x54) {      // FOR: limit, step, 5c var
        const lim = this.operands();
        if (this.u8() !== 0x5c) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'for end');
        this.u8(); this.u8(); const step = lim.length > 1 ? String(lim[1]) : '1';
        return 'FOR ' + first + ' TO ' + lim[0] + (step === '1' ? '' : ' STEP ' + step);
      }
      return first;
    }
    if ((t === 0x29 || t === 0x2a || t === 0x2b || t === 0x2c) && ops.length === 2) {
      const code = this.u8(); const rel = BC_RELS[code];
      if (!rel) throw new BcUnknown(code, this.p - 1, 'relation');
      if (t === 0x2a || t === 0x2c) { const lo = this.u8(), hi = this.u8(); return new BcIf([[ops[0] + rel + ops[1], 'LAST']], String(bcBcdLine(lo, hi))); }
      const skip = this.u16(), end = this.p + skip; const inner = [];
      while (this.p < end) inner.push(this.statement());
      if (this.p > end && inner.length === 1 && inner[0] instanceof BcIf) {                // OR chain
        const io = inner[0]; return new BcIf([[ops[0] + rel + ops[1], 'OR']].concat(io.conds), io.body, io.els);
      }
      const ct = ops[0] + BC_INV[rel] + ops[1];
      if (inner.length && inner[inner.length - 1] === '<ELSE>') {
        inner.pop(); const ee = this.elseEnd, els = [];
        while (this.p < ee) { if (this.u8() !== 0x61) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'else header'); this.u8(); els.push(this.statement()); }
        return new BcIf([[ct, 'LAST']], inner.map(String).join(':'), els.map(String).join(':'));
      }
      if (inner.length === 1 && inner[0] instanceof BcIf && !inner[0].els) { const io = inner[0]; return new BcIf([[ct, 'AND']].concat(io.conds), io.body, io.els); }
      return new BcIf([[ct, 'LAST']], inner.map(String).join(':'));
    }
    if (t === 0xa3 && ops.length === 1) {
      const sv = String(ops[0]);
      if (this.peek() === 0x59 || this.peek() === 0x54) {
        this.u8(); const d = this.u8(), l = this.u8(); const v = bcVname(d, l);
        if (this.u8() === 0x4d && this.u8() === 3) return 'LINPUT ' + sv + '-' + v;
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
      return 'KEYIN ' + ops[0] + ',' + (n === 2 ? tg[1] : '') + ',' + tg[0];
    }
    if (t === 0x26 && ops.length === 1 && this.peek() !== null) return this.onGoto(ops[0]);
    if (t === 0xbb && ops.length === 2) return String(ops[1]).startsWith('"') ? 'SELECT #' + ops[0] + ' /' + bcStrip(ops[1]) : 'SELECT #' + ops[0] + '<' + ops[1] + '>';
    if (t === 0xbe && ops.length === 1) return this.diskOp(ops[0]);
    throw new BcUnknown(t, this.p - 1, 'after ' + ops.length + ' operands');
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
    if (t === 0x78 && ops2.length === 1 && String(ops2[0]).startsWith('"')) {
      const name = bcStrip(ops2[0]); const fl = this.u8();
      const a = bcBcdLine(this.u8(), this.u8()), z = bcBcdLine(this.u8(), this.u8()), beg = bcBcdLine(this.u8(), this.u8());
      let out = 'LOAD ' + (fl & 1 ? 'RUN ' : '') + 'T"' + name + '"';
      if (!(a === 0 && z === 9999)) out += a + ',' + z;
      if (beg) out += 'BEG ' + beg;
      return out;
    }
    if (t === 0x46) { this.u8(); const arr = this.operands(), op = this.u8(); return 'DATA ' + ({ 0x31: 'LOAD', 0x36: 'SAVE' }[op] || 'OP' + op.toString(16)) + ' BA T#' + fno + ',(' + ops2.join(',') + ')' + arr[0]; }
    if (t === 0x35 && ops2.length === 1) { this.u8(); return 'DATA LOAD DC OPEN T#' + fno + ',' + ops2[0]; }
    if (t === 0x3d && ops2.length) { this.u8(); return ops2.length === 2 ? 'DATA SAVE DC OPEN T#' + fno + ',(' + ops2[0] + ')' + ops2[1] : 'DATA SAVE DC OPEN T#' + fno + ',' + ops2[0]; }
    if (t === 0x3c) return 'DATA SAVE DC #' + fno + ',END';
    if (t === 0x34) { this.u16(); return 'DATA LOAD DC #' + fno + ',' + this.dcItems(0x33).join(','); }
    if (t === 0x3a) return 'DATA SAVE DC #' + fno + ',' + this.dcItems(0x39).join(',');
    if (t === 0x7b) {
      this.u8(); const vs = [];
      while (this.peek() === 0x54 || this.peek() === 0x59) {
        const v = this.operands(); vs.push(String(v[0]));
        if (this.u8() !== 0x55) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'limits item');
        this.p += 2;
        if (this.u8() !== 0x70) throw new BcUnknown(this.b[this.p - 1], this.p - 1, 'limits store');
      }
      return 'LIMITS T#' + fno + ',' + ops2[0] + ',' + vs.join(',');
    }
    throw new BcUnknown(t, this.p - 1, 'disk op');
  }

  target() {
    const t = this.u8();
    if (t === 0x69) { const lo = this.u8(), hi = this.u8(); return String(bcBcdLine(lo, hi)); }
    if (t === 0x26) { const off = this.u16(); return off > 32767 ? String(this.curline) : ''; }
    throw new BcUnknown(t, this.p - 1, 'target');
  }

  onGoto(expr) {
    this.u16(); const ents = [];
    while (this.peek() === 0x69 || this.peek() === 0x26) {
      const pos = this.p;
      if (this.peek() === 0x69) { this.p++; const lo = this.u8(), hi = this.u8(); ents.push([pos, String(bcBcdLine(lo, hi))]); }
      else { this.p += 3; ents.push([pos, '']); }
    }
    if (this.u8() !== 0x96) throw new BcUnknown(0x96, this.p - 1, 'on table');
    const cnt = this.u16(); this.u16(); const tab = this.p; const slots = [];
    for (let k = 0; k < cnt; k++) {
      let w = this.u16(); if (w > 32767) w -= 65536;
      const tgt = tab + 2 * k + 2 + w; const hit = ents.find(e => e[0] === tgt);
      slots.push(hit ? hit[1] : '');
    }
    return 'ON ' + expr + ' GOTO ' + slots.join(',');
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
    const items = []; let nl = false;
    while (this.more()) {
      const t = this.u8();
      if (t === 0xb4) break;
      if (t === 0x9e || t === 0x9f) { nl = true; continue; }
      if (t === 0xa7) { items.push(','); continue; }
      if (t === 0xa0 || t === 0xa2 || t === 0xa5 || t === 0xa1 || t === 0xc5) {
        if (t === 0xc5) continue;
        const v = this.pop(); items.push(t === 0xa1 ? 'HEXOF(' + v + ')' : v); continue;
      }
      if (t === 0x9c) { const n = this.u8(), args = []; for (let i = 0; i < (n === 0 ? 2 : 3); i++) args.unshift(this.pop()); items.push('AT(' + args.join(',') + ')'); continue; }
      if (t === 0x9d) { const b = this.pop(), a = this.pop(); items.push('BOX(' + a + ',' + b + ')'); continue; }
      if (t === 0xa6) { items.push('TAB(' + this.pop() + ')'); continue; }
      if (this.exprToken(t)) continue;
      throw new BcUnknown(t, this.p - 1, 'print');
    }
    let out = '';
    for (const it0 of items) {
      const it = String(it0);
      if (it === ',') { out += ','; continue; }
      out += (out && !out.endsWith(',') ? ';' : '') + it;
    }
    if (items.length && !nl && !out.endsWith(',')) out += ';';
    return ('PRINT ' + out).replace(/\s+$/, '');
  }
}

/* one line body -> statement text (throws BcUnknown when it meets something it does not understand) */
function decompileBody(body, lineno) {
  const d = new BcDec(body); d.curline = lineno || 0; const out = [];
  if (body[0] === 0xd3) d.p = 2;
  if (body[d.p] === 0xcb) { d.p++; const n = d.u16(), tl = d.u8(); return '%' + d.str(tl); }
  while (d.more()) {
    const t = d.u8();
    if (t === 0x77) break;
    if (t !== 0x61) throw new BcUnknown(t, d.p - 1, 'stmt header');
    d.u8();
    const s = String(d.statement());
    if (out.length && out[out.length - 1] === 'ERROR' && s.startsWith('GOTO')) { out[out.length - 1] = 'ERROR ' + s; continue; }
    out.push(s);
  }
  return out.join(':');
}

/* the bytes of a compiled program (starting at "0E 00 BC Rev ...") -> listing */
function decompileProgram(bytes) {
  let sig = ''; for (let i = 2; i < 16; i++) sig += String.fromCharCode(bytes[i]);
  const lines = []; let p = 16, total = 0, failed = 0;
  while (p + 4 <= bytes.length) {
    if (bytes[p] === 0xff && bytes[p + 1] === 0xff) break;
    const hex = ('0' + bytes[p + 1].toString(16)).slice(-2) + ('0' + bytes[p].toString(16)).slice(-2);
    if (!/^\d+$/.test(hex)) break;
    const no = parseInt(hex, 10), len = bytes[p + 2] | (bytes[p + 3] << 8), body = bytes.subarray(p + 4, p + 4 + len);
    p += 4 + len; total++;
    let text;
    try { text = decompileBody(body, no); }
    catch (e) { failed++; text = 'REM *** NOT DECODED (' + (e.why || e.message) + ') ***'; }
    lines.push(no + text);
  }
  return { text: lines.join('\n') + '\n', total, failed, rev: sig.trim() };
}

if (typeof module !== 'undefined') module.exports = { decompileProgram, decompileBody, BcUnknown };
