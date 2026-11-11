# WANG-PACMAN

**UNS-MAN**, the Pac-Man clone written for the Wang 2200 in BASIC-2 (Steve McGarry, Wang Laboratories, 1981), running
in a web browser. It does not reimplement the game: it runs the **original BASIC-2 program** with a BASIC-2
interpreter written in JavaScript, a Wang 2236 terminal emulator (with the real character-generator font) and a
virtual disk ("platter") that stores the Hall of Fame.

Runs on desktop and mobile browsers, as a single self-contained HTML file, with no installation.

## Quick start

The original program is **not included** in this repository (see below), so the page you download asks you for your own
copy the first time.

1. Download **`uns-man-loader.html`** from the [latest release](https://github.com/fpracek/WANG-PACMAN/releases/latest)
   (it is also in this repository as `app/uns-man-loader.html`).
2. Open it in a modern browser (double-click the file).
3. Give it your copy of UNS-MAN, either way:
   - the two listing files **`UNS-MAN.txt`** and **`UNS-GAME.txt`** (text listings, one BASIC line per line, non-printable
     bytes written as `\xHH`, as produced by WangEmu's `wvdutil list`), or
   - a Wang **disk image** (`.bs2` raw sectors or WangEmu `.wvd`) that contains the programs `UNS-MAN` and `UNS-GAME`.

   Use the *Choose files* button or drop the files on the page. They stay in your browser (nothing is uploaded) and are
   remembered there, so you only do this once; the *forget game* button removes them.
4. Press `1` or `2` for the number of players, or any other key for the instructions.

Controls: arrow keys or `8` `4` `6` `2` to move, `5` to stop, `Enter` to confirm, `Esc` to restart. Touch devices get
on-screen buttons. A speed selector is available (the original pace depended only on how slow the interpreter and terminal
were, so it is adjustable).

## The original program is not included

The header of `UNS-MAN` asks that nobody distributes the program in an unprotected form. For that reason the original
BASIC listings are **not part of this repository** and are not inside the release files. You need to supply them yourself
(from a disk image you own, for example). The engine and the web page are not tied to this game: UNS-MAN is simply the
first program they were built for.

## Build from source

```
python app/tools/build.py --loader   # app/uns-man-loader.html: no program inside, asks for it (safe to share)
python app/tools/build.py            # app/index.html: embeds listings/UNS-MAN.txt and listings/UNS-GAME.txt (keep it private)
```

For the second form put the two listing files in a `listings/` folder (ignored by git) or point the `LISTINGS`
environment variable to the folder that contains them. Tests (Node):

```
node engine/test/shell.js          # interactive-prompt tests
node app/test/loader.js            # the program loader (listings and disk images)
node engine/test/parse-uns.js      # parser tests on the original listings (needs the listings)
```

## What is in this repository

| Folder | Contents |
|---|---|
| `engine/` | **BASIC2-JS**: the BASIC-2 interpreter, platter (virtual disk) system, disk-image reader, Wang terminal model/renderer, printer with PDF output and an interactive BASIC-2 prompt (`Workstation`). See [`engine/README.md`](engine/README.md); the engine also lives in its own repository, [WANG-BASIC2](https://github.com/fpracek/WANG-BASIC2). |
| `app/` | The web page (`template.html`, `app.js`, `loader.js`), the build script and the loader build `uns-man-loader.html`. |

## How it works

- **Interpreter**: a recursive-descent parser works directly on the raw listing (Wang listings contain no spaces, e.g.
  `IF X1(G)<>XOR Y1(G)<>YTHEN`), and a tree-walking interpreter executes it with BASIC-2 semantics: `IF..THEN`
  governs a single statement, fixed-length strings with `STR()` as both value and target, `MAT`, `ON..GOTO`,
  `DATA`/`READ`, program chaining with `COM` variables, and more.
- **Virtual time**: every statement and every byte sent to the terminal has a cost, and execution is slowed accordingly,
  which reproduces the pacing of the original machine.
- **Terminal**: the 80x24 Wang 2236 screen model (alternate character set with block graphics, bright / blink /
  underline / inverse attributes, `BOX` overlays) and a canvas renderer using the real character-generator ROM dump.
- **Platters**: virtual disks with a file catalog; user files (such as the Hall of Fame) are saved in the browser's
  `localStorage` when it is available.

## License

The code in this repository (interpreter, platter system, terminal emulation, web application, tests, build scripts)
is released under the [MIT License](LICENSE): you can use, modify and redistribute it anywhere.

The original UNS-MAN program is **not** covered by this license and is not distributed here; its rights remain with its
author. The MIT license of this repository cannot grant rights over it.

## Credits

- UNS-MAN: Steve McGarry, Wang Laboratories (1981).
- Terminal character-generator tables: [WangEmu](https://github.com/jimbattle/wangemu) by Jim Battle (MIT, see `NOTICE`).
