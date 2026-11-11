# WANG-PACMAN

**UNS-MAN**, the Pac-Man clone written for the Wang 2200 in BASIC-2 (Steve McGarry, Wang Laboratories, 1981), running
in a web browser. It does not reimplement the game: it runs the **original BASIC-2 program** with a BASIC-2
interpreter written in JavaScript, a Wang 2236 terminal emulator (with the real character-generator font) and a
virtual disk ("platter") that stores the Hall of Fame.

Runs on desktop and mobile browsers, as a single self-contained HTML file, with no installation.

## What is in this repository

| Folder | Contents |
|---|---|
| `engine/` | **BASIC2-JS** - the reusable BASIC-2 interpreter, platter (virtual disk) system, Wang terminal model/renderer and an interactive BASIC-2 prompt (`Workstation`). See [`engine/README.md`](engine/README.md). |
| `app/` | The web page (`template.html`, `app.js`) and the build script that produces a single `index.html`. |

### The original program is not included

The header of `UNS-MAN` asks that nobody distributes the program in an unprotected form. For that reason the original
BASIC listings are **not part of this repository**. To build the game you must supply `UNS-MAN.txt` and
`UNS-GAME.txt` yourself (text listings, one BASIC line per line, non-printable bytes written as `\xHH`), either in a
`listings/` folder or through the `LISTINGS` environment variable. The engine and the app are not tied to this game:
UNS-MAN is simply the first program they were built for.

## Build and run

```
python app/tools/build.py          # produces app/index.html (a single file, not versioned)
node engine/test/shell.js          # interactive-prompt tests (no listings needed)
node engine/test/parse-uns.js      # parser tests on the original listings (needs the listings)
```

Open `app/index.html` in a browser.

## Controls

Arrow keys or `8` `4` `6` `2` to move, `5` to stop, `1` / `2` to choose the number of players, `Enter` to confirm,
`Esc` to restart. Touch devices get on-screen buttons. A speed selector is available (the original pace depended only
on how slow the interpreter and terminal were, so it is adjustable).

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
