# BASIC2-JS

A **Wang BASIC-2** interpreter in plain JavaScript for the browser (and Node, for tests), with **platters**
(virtual disks), an emulated Wang 2236 terminal and an interactive BASIC-2 prompt. It was built to run original
listings unchanged: the first client is `UNS-MAN` (Steve McGarry's 1981 Pac-Man clone; the listing is not included),
which runs **as is**, with only two optional patches for lines that touch hardware.

## Architecture

```
src/
  basic2.js     the language: Parser (text -> AST) + Interp (execution, variables, FOR/GOSUB, I/O, run outcomes)
  platter.js    Platter (a disk with files) + DiskSystem (mounted drives, lookup, persistence)
  wangcrt.js    Terminal: 80x24 screen model with the 2236 control bytes (no DOM)
  crt-canvas.js createCrtRenderer(canvas): drawing with the real font + phosphor effect, blinking cursor
  shell.js      Workstation: the interactive BASIC-2 prompt (enter lines, LIST, RUN, LOAD/SAVE, CATALOG, ...)
  font.js       character-generator tables (from WangEmu, MIT)
test/           Node tests: prompt, parser on listings, execution, Hall of Fame on a platter, key handling
```

The engine does **not know the DOM**: it talks to three devices passed to the constructor.

```js
const interp = new Interp(term, io, disk);
interp.start('UNS-MAN');                 // "game mode": load a program from disk and run it
const ws = new Workstation(term, io, disk);
ws.main();                               // "workstation mode": the BASIC-2 prompt
```

| Device | Contract |
|---|---|
| `term` (CRT) | `out(byte)`, `at(r,c)`, `atClear(r,c,n)`, `drawBox(r,c,h,w,draw)`, `cx/cy/cols`, `clear()`, `hex(str)`, `print(str)` |
| `io` (keyboard) | `poll()` -> `{c,sp}` or `null` (non-blocking); `next()` -> `Promise<{c,sp}>`; optional `abort()`. `sp:true` marks special keys (cursors) |
| `disk` | `DiskSystem`: `readProgram`, `writeProgram`, `readData`, `writeData`, `remove`, `status`, `restore` |

### Run outcomes

`interp.run()` resolves to `{status, line, msg}` where `status` is `end`, `stop` (a `STOP` statement; `CONTINUE`
resumes), `halt` (user interruption via `interp.halt()`), `error` or `reset`. Direct statements (without a line
number) run with `interp.execDirect(src)` and share variables with the program.

### Platters

A `Platter` is a disk with two kinds of file: `program` (a text listing, one BASIC line per line, non-printable bytes as
`\xHH`) and `data` (records for `DATA LOAD DC` / `DATA SAVE DC`). `DiskSystem` mounts platters at Wang-style addresses
(`'310'`, `'320'`, ...), keeps a current drive and searches it first. Persistence uses `localStorage` for **user-created
files only** and degrades to memory-only where it is unavailable (sandboxed iframes, `data:` URLs).

```js
const disk = new DiskSystem({prefix: 'mydisk'});
const p = disk.mount('310', new Platter('GAMES'));
p.addProgram('UNS-MAN', listingText);
```

### The prompt

Type numbered lines to build a program (a number alone deletes the line). Commands: `LIST [a[,b]]`, `RUN [n]`,
`CONTINUE`, `NEW`, `CLEAR [P]`, `LOAD [RUN] "name"`, `SAVE "name"`, `SCRATCH "name"`, `CATALOG [disk]`,
`SELECT DISK n`, `DELETE a[,b]`, `HELP`. Anything else is a direct statement (`PRINT 2+3*4`, `A=5`, `PRINT A`).
Up/down arrows recall the command history; `ws.halt()` interrupts a running program.

## Dialect coverage

Statements: `REM` (and `%`), `DIM`, `COM`, implicit `LET` (also multiple `A,B=0` and `STR(..)=`), `IF..THEN..ELSE`,
`FOR/NEXT [STEP]`, `GOTO`, `GOSUB`/`RETURN [CLEAR [ALL]]`, `ON..GOTO/GOSUB`, `DEFFN'n` + `GOSUB 'n(..)`,
`DATA`/`READ`/`RESTORE [LINE n]`, `MAT ZER/CON/copy/READ`, `PRINT` (`AT`, `AT(r,c,n)`, `TAB`, `BOX`, `HEX`, `;`),
`PRINTUSING`, `KEYIN`, `LINPUT`, `CONVERT`, `LOAD T"name"` (chaining with `COM` variables), `LIMITS`,
`DATA LOAD/SAVE DC` (on platters), `SELECT`, `STOP`, `$GIO/005`, `$BREAK`, `$TRAN`.
Functions: `INT MOD MIN MAX ABS RND SGN LEN SQR EXP LOG SIN COS TAN ATN POS STR HEX ALL BIN ADDC`; operators
`+ - * / ^ &`, relational, `AND OR`.

Semantics that matter (found on real listings):

- **`IF..THEN` governs ONE statement**; statements after the colon always run. `: ELSE ...` belongs to the `IF`.
- **Fixed-length strings** (space-padded, 16 if undeclared); `STR(v,a,n)` works as a value and as a target; comparisons
  pad the shorter string with spaces; `ALL(hh)` fills, `HEX(..)` yields bytes.
- **`KEYIN K$`** without line numbers *waits* for a key. **`KEYIN K$,l1,l2`** does not block: with no key `K$` is left
  unchanged; an ordinary key jumps to `l1`, a special key (cursor) to `l2` (with `l1` = the line itself it drains the buffer).
- Listings contain **no spaces** (`IF X1(G)<>XOR Y1(G)<>YTHEN`): the parser works on raw text and decides by context
  whether `XOR` is really `X OR`. Variables are letter + digit + `$`.
- Numbers print as `" 12 "` (sign position and trailing space), so `PRINT H0;HEX(08)` erases the trailing space.
- `TAB(n)` **fills with spaces** up to column `n`. A `PRINT` without a final `;` emits `CR LF` (the CR cancels the
  temporary attribute `HEX(0E)`); at the bottom of the screen the LF scrolls.
- **Virtual time**: each statement and each byte sent to the terminal costs microseconds (`stmtCost`, `byteCost`,
  `breakCost`, scaled by `speed`) and execution is slowed accordingly. The pace of many games depended only on the
  slowness of the 2200, so it is adjustable. `SELECT P1` = slow output (animations).

## Roadmap

1. Editor: `RENUMBER`, `EDIT`, function keys (`SF`), immediate-mode tracing.
2. Real disk commands: sector-based platters, reading WangEmu `.wvd` images, tokenized program files, `COPY`/`MOVE`, `$OPEN/$CLOSE`.
3. Error codes (`ERR nn`), `ON ERROR`.
4. Devices: printer, serial, several terminals; `SELECT` is mostly a no-op today.
5. Numbers: 13-digit decimal arithmetic (currently `double`), full `PRINTUSING` pictures.
6. Missing statements: `INPUT`, `MAT` arithmetic / `INV` / `TRN`, `REDIM`, `$PACK/$UNPACK`, string functions (`VAL`, `NUM`).

## Tests

```
node test/shell.js          # the prompt: entering lines, LIST, RUN, STOP/CONTINUE/HALT, SAVE/LOAD/CATALOG, errors
node test/parse-uns.js      # the parser accepts every line of UNS-MAN and UNS-GAME (needs the listings)
node test/run-uns.js        # runs the title and a game, prints the screen (needs the listings)
node test/hof-and-speed.js  # Hall of Fame on a platter (name entry + reread) and game pace (needs the listings)
node test/title-keys.js     # keys on the title screen (blocking and non-blocking KEYIN)
```

## License and credits

Code: MIT, see the repository `LICENSE`. Terminal font tables: [WangEmu](https://github.com/jimbattle/wangemu) by Jim
Battle (MIT). UNS-MAN / UNS-GAME: Steve McGarry, Wang Laboratories, 1981 (not distributed here).
