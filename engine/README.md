# BASIC2-JS

A **Wang BASIC-2** interpreter in plain JavaScript for the browser (and Node, for tests), with **platters**
(virtual disks), an emulated Wang 2236 terminal and an interactive BASIC-2 prompt. It was built to run original
listings unchanged: the first client is `UNS-MAN` (Steve McGarry's 1981 Pac-Man clone), which runs **as is**, with only
two optional patches for lines that touch hardware. That game lives in its own repository,
[WANG-PACMAN](https://github.com/fpracek/WANG-PACMAN); its original listing is not distributed anywhere here.

## Quick start

### Run the Workstation (no installation)

1. Download **`workstation.html`** from the [latest release](https://github.com/fpracek/WANG-BASIC2/releases/latest)
   (it is also in this repository as `dist/workstation.html`).
2. Open it in a modern browser (double-click). It is a single self-contained file; nothing is sent anywhere.
3. You get a Wang-style green screen with a BASIC-2 prompt. Try:

```
10 FOR I=1 TO 5:PRINT "LINE";I:NEXT I
RUN
LOAD "PRIMES"
RUN
LIST
```

Things to try next: `CATALOG` (disk 310 holds samples: `HELLO`, `PRIMES`, `BOXES`, `GUESS`), `SAVE "MINE"`,
`HELP`, `DIALECT` (choose the BASIC version), Esc (HALT a running program), the **Editor** tab (edit a program as text),
the **Disks** tab (**Mount disk image** loads a `.bs2` or `.wvd` disk read-only) and the **Printers** tab
(`SELECT PRINT 215` then `RUN` prints to a virtual printer; **Download PDF** saves the output).

### Use it from JavaScript / Node

```js
const { Workstation } = require('./src/shell.js'), { Platter, DiskSystem } = require('./src/platter.js');
const { Terminal } = require('./src/wangcrt.js');
// terminal, keyboard {next(), poll()} and a DiskSystem are passed in: see "Architecture" below
```

Run the tests with `node test/shell.js` (and the others listed under *Tests*). Rebuild the single-file page with
`python tools/build-workstation.py`.

## Architecture

```
src/
  dialects.js   dialect profiles: which BASIC-2 version the interpreter emulates (data, not code)
  basic2.js     the language: Parser (text -> AST) + Interp (execution, variables, FOR/GOSUB, I/O, devices, run outcomes)
  platter.js    Platter (a disk with files) + DiskSystem (mounted drives, lookup, persistence)
  image.js      reads Wang disk images (.bs2 raw sectors, .wvd) and detokenizes their programs
  printer.js    Printer: virtual line printer (any width) with PDF output
  wangcrt.js    Terminal: 80x24 screen model with the 2236 control bytes (no DOM)
  crt-canvas.js createCrtRenderer(canvas): drawing with the real font + phosphor effect, blinking cursor
  shell.js      Workstation: the interactive BASIC-2 prompt (enter lines, LIST, RUN, LOAD/SAVE, CATALOG, ...)
  font.js       character-generator tables (from WangEmu, MIT)
test/           Node tests: prompt, dialects, disk images, printing, LINPUT, PDF writer
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

### Disk images (.bs2 and .wvd)

`DiskSystem.mountImage(bytes, fileName)` mounts a Wang disk image as **read-only** platters (the first free address from
`320`; a `.wvd` with several platters mounts one drive each). Two formats are recognised:

- `.bs2`: raw 256-byte sectors (the format Niakwa BASIC-2C uses for its "disk image files with a 2200 directory structure").
- `.wvd`: WangEmu virtual disks (256-byte `WANG` header, label, platters).

Sector 0 describes the disk; the first sectors are the catalog (16-byte entries: state, program/data, first and last
sector, 8-character name). Programs are stored **tokenized** (atoms from `0x80`, BCD line numbers) and are detokenized
to the same listing text WangEmu's `wvdutil list` produces, including the unscrambling of protected programs. They then
behave like any other file: `CATALOG 320`, `LOAD "NAME"`, `LIST`, `RUN`. Data files are exposed as raw sectors.
Names are matched ignoring case. Scratched entries are skipped.

Limits: images are read-only (writing back to an image is not implemented), data-file records are not decoded
(`DATA LOAD DC` on an image data file loads nothing), and a program can be listed even when the interpreter does not
implement every statement it uses.

Verified against real disks: all 19 programs of a 1401-sector `.bs2` match the listings extracted with `wvdutil`,
and a 28-file `.wvd` reads correctly.

### Printers and PDF output

Output goes to any *device* attached to the interpreter. The CRT is device `005`; a `Printer` (width 80 or 132 columns,
66 lines per page) can be attached at an address such as `215`:

```js
const prn = new Printer({cols: 132, rows: 66, paper: 'letter', greenbar: false});
interp.attach('215', prn);
```

From BASIC (or from the prompt): `SELECT PRINT 215` sends `PRINT` / `PRINTUSING` output to the printer, `SELECT LIST 215`
sends `LIST`, and `SELECT PRINT 005` returns to the screen. `PRINT HEX(0C)` is a form feed. The printer honours CR, LF,
form feed, backspace (overstrike: underline or bold in the PDF) and tabs; screen addressing (`AT`, `BOX`) is ignored.
`prn.getText()` returns the text and `prn.toPDF()` a `Uint8Array` with a hand-written PDF-1.4 file (Courier, Letter or
A4, landscape automatically for wide forms, optional greenbar shading). No dependencies; it works in the browser.

### The prompt

Type numbered lines to build a program (a number alone deletes the line). Commands: `LIST [a[,b]]`, `RUN [n]`,
`CONTINUE`, `NEW`, `CLEAR [P]`, `LOAD [RUN] "name"`, `SAVE "name"`, `SCRATCH "name"`, `CATALOG [disk]`,
`SELECT DISK n`, `SELECT PRINT n`, `SELECT LIST n`, `DELETE a[,b]`, `HELP`, and the workstation extension `DIALECT [id]`.
Anything else is a direct statement (`PRINT 2+3*4`, `A=5`, `PRINT A`).
Up/down arrows recall the command history; `ws.halt()` interrupts a running program.

### The Workstation web app

`dist/workstation.html` is a single self-contained page (build it with `python tools/build-workstation.py`): the
emulated CRT with the BASIC-2 prompt and four panels/controls:

- **BASIC** selector (header): the dialect profile (see below).
- **Disks**: drives, catalog, load / export / delete, **Import listing**, new disk, export / import a whole disk as
  JSON, and **Mount disk image** for `.bs2` / `.wvd` files (read-only, with Eject). Import accepts listings in both
  WangEmu formats: `wvdutil list` (one line per BASIC line) and the pretty-printed `listd` (lines wrapped at 78 columns,
  each statement after a colon on its own line); the continuation lines are joined back automatically, including the
  space that `listd` loses when a wrap falls exactly on one. Prefer `list` when you can: it is exact.
  Both file buttons recognise what the file really is: a disk image chosen in **Import listing** is mounted instead of being
  loaded as one line of garbage, and a listing chosen in **Mount disk image** is imported. A file with no BASIC lines gets an
  explanation. When a name exists on several drives, the current drive wins: `SELECT DISK 330` first.
- **Printers**: one card per printer (columns, paper, greenbar), text preview and **Download PDF**; add more printers.
- **Editor**: edit the program as text, send it to the workstation, run it.

`Esc` or the HALT button interrupts a running program. Drive `310` holds a few sample programs (`HELLO`, `PRIMES`,
`BOXES` for box and block graphics, `GUESS` for keyboard input); drive `320` is yours and is kept in the browser.

## Dialects: choosing the BASIC-2 version

Many versions of Wang BASIC exist. A **dialect profile** (`src/dialects.js`) says what the interpreter accepts, and is
chosen with the BASIC selector, with `DIALECT id` at the prompt, or in code with `interp.setDialect(id)`:

| id | Version | Status | What is modelled |
|---|---|---|---|
| `wang-basic` | Wang BASIC (2200A/B/T) | partial | keyword and function gating: no `ELSE`, `LINPUT`, `AT(`, `BOX(`, `MIN`/`MAX`/`MOD` |
| `basic2` | Wang BASIC-2 (2200 VP/MVP/LVP) | reference | the language of 2200 VP/MVP programs (default) |
| `basic2-pc` | Wang PC BASIC-2 | planned | accepted as `basic2`; PC-specific differences not modelled yet |
| `niakwa-2c` | Niakwa BASIC-2C (NPL) | partial | adds `REM $PC <statement>` (executed); compiler options and `$`-statements not modelled |

Profiles are data (feature flags plus a list of disabled functions), so a version can be added without touching the
parser. The path towards BASIC-2C is to extend the `niakwa-2c` profile as differences are documented: Niakwa's compiler
reads `.SRC` text or `.BS2` disk images (already readable here), adds NPL-specific `$` statements, and has compiler options
(`-NUMBERS`, `-WARNINGS`, `-LCASE`) and its own error codes. Differences found while converting real programs are
recorded in the profile `notes`.

## Dialect coverage

Statements: `REM` (and `%`), `DIM`, `COM`, implicit `LET` (also multiple `A,B=0` and `STR(..)=`), `IF..THEN..ELSE`,
`FOR/NEXT [STEP]`, `GOTO`, `GOSUB`/`RETURN [CLEAR [ALL]]`, `ON..GOTO/GOSUB`, `DEFFN'n` + `GOSUB 'n(..)`,
`DATA`/`READ`/`RESTORE [LINE n[,k]]`, `MAT ZER/CON/copy/READ`, `PRINT` (`AT`, `AT(r,c,n)`, `TAB`, `BOX`, `HEX`, `;`),
`PRINTUSING`, `KEYIN`, `LINPUT`, `INPUT`, `CONVERT`, `LOAD T"name"` (chaining with `COM` variables), `LOAD RUN`, `LIMITS`,
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
2. Disks: writing to images, decoding data-file records (`DATA LOAD DC` on image files), sector-level platters, `COPY`/`MOVE`,
   `$OPEN/$CLOSE`, saving programs back in tokenized form.
3. Dialects: document and model the real differences between the versions (semantics, limits, statements), starting
   with Niakwa BASIC-2C and Wang PC BASIC-2.
4. Error codes (`ERR nn`), `ON ERROR`.
5. Devices: serial, several terminals, printer control codes and fonts; `SELECT` for devices other than PRINT/LIST is a no-op.
6. Numbers: 13-digit decimal arithmetic (currently `double`), full `PRINTUSING` pictures.
7. Missing statements: `INPUT` with formats and several prompts, `MAT` arithmetic / `INV` / `TRN`, `REDIM`, `$PACK/$UNPACK`, string functions (`VAL`, `NUM`).

## Tests

```
node test/shell.js          # the prompt: entering lines, LIST, RUN, STOP/CONTINUE/HALT, SAVE/LOAD/CATALOG, errors
node test/guess.js          # LINPUT inside a running program (no keystroke is lost)
node test/listd.js          # pretty-printed (listd) listings, INPUT, LOAD RUN, RESTORE LINE n,k, <>=, ";;", DEFFN with a space
node test/dialects.js       # what each dialect accepts, REM $PC, the DIALECT command
node test/image.js          # disk images built in memory: .bs2 and .wvd, catalog, tokenized programs, mounting
node test/printing.js       # SELECT PRINT / SELECT LIST routing, form feed, PDF output
node test/printer.js        # the Printer device and the PDF writer (structure, xref offsets, overstrike, greenbar)
python tools/build-workstation.py   # rebuild dist/workstation.html
```

The tests that run original programs (UNS-MAN listing parsing, a full game, Hall of Fame, key handling) need the
original listings, which are not distributed, and live in the [WANG-PACMAN](https://github.com/fpracek/WANG-PACMAN)
repository.

## License

The code in this repository is released under the [MIT License](LICENSE): use it, modify it and redistribute it anywhere.
Wang BASIC-2 programs run by the interpreter belong to their respective authors and are not covered by this license.

## Credits

Terminal font tables: [WangEmu](https://github.com/jimbattle/wangemu) by Jim Battle (MIT), see [NOTICE](NOTICE).
Wang BASIC-2 and the Wang 2200 are products of Wang Laboratories.
