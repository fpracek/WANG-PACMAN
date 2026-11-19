# Niakwa BASIC-2C object code ("BC Rev 1.0x")

Source of the findings: a disk image of Niakwa-compiled programs (171 programs) paired with a disk holding the same programs as source
(supplied by a user). Only programs present on both disks were used. The reference implementation is `src/bcdecomp.js`.
This is a partial reverse engineering: the format is not documented by Niakwa, and some constructs are still undecoded.

## Container
- Catalog and sectors as in any 2200 raw image (`image.js`). A compiled program's first sector starts `0E 00 "BC Rev 1.0x.00"`.
- The program is a plain byte stream (sector boundaries mean nothing), then `FF FF 00 00`, then zeros; the last sector of
  the file ends with a time stamp record (`A0 00 02 "1987/11/25 19:02:35"`).
- Revisions seen: 1.01.00 (89 programs), 1.04.00 (80), 1.03.00 (2).

## Line record
`<line no, 2 bytes BCD little endian: 20 00 = line 20> <length, u16 LE> <body of that length>`; the body ends with `77 00 00`.
Optional `D3 nn` first: nn leading blanks of the listing.
Statements in a line: `61 <index 0,1,2..>` + payload. 166 of 171 programs (all with a source) frame correctly.

## Operands (postfix, a stack machine)
| token | meaning |
|---|---|
| `53 01 v` / `53 02 lo hi` / `53 03 lo hi` | integer constant: 1 byte / unsigned 16 / signed 16; `53 09 v` is the same kind used for STEP and AT/BOX arguments |
| `54 d L` | numeric variable; `d` low nibble = digit (0F = none), `L` = letter |
| `59 d L` | string variable (`d` high nibble 1) |
| `56 d L` | whole array `X$()` (high nibble 3 string, 2 numeric) |
| `63 n d L` / `64 n d L` | array element (n indices on the stack first), numeric / string |
| `58 n <n bytes>` | string constant (HEX(..) when not ASCII) |
| `23 f` `C4 f` `92 f` `47 f` | `+ - * /` followed by a type flag byte (08 int, 10 real, 00) |
| `90 f` | MOD |
| `68 x` INT, `6C x` LEN, `89 x y` RND | functions |
| `C0 C1 nn nn C2 C3 nn nn` | STR() pieces: start from stack / literal (zero based), length from stack / literal |

## Statements
- `D2 <len16> <flag> <text>` REM (flag 01 = one leading blank), `B7` RETURN, `8F` END, `69 <line BCD>` GOTO, `6A <line BCD>` GOSUB.
- Assignments: numeric `expr 6D d L`; small integer `6E <u16> d L`; strings / elements: `target expr 73` / `target expr 70`.
- FOR: `var init 70 limit step 5C var`; NEXT `5D d L`.
- IF (cmp token): `lhs rhs 2A|2C code line` = IF numeric|string ... THEN line; `29|2B code skip stmt..` = THEN statement
  (the code is the relation of the *skip* condition, so the source relation is its inverse). Relation codes:
  1 `<`, 2 `=`, 3 `<=`, 4 `>`, 5 `<>`, 6 `>=`. AND / OR are compiled as chains (not decoded yet).
- PRINT: `BC items B4`; each item is an operand followed by an output token: `A5` string, `A2` number, `A0` HEX literal,
  `A1` HEXOF, `A7` comma, `9C 00` AT(r,c), `9D` BOX(r,c); `9F` = newline at the end (no `9F`: trailing `;`); `9E` bare PRINT.
- GOSUB 'n: `5E n argc 00 00 {arg 72}`; DEFFN 'n: `41 <len16> <n16> argc <u16> {var 94} 4F`.

## Verification with the compiler (round trip)

The decompiled source of each program is fed back to `B2C.EXE` (run under DOSBox) and the object code it produces is compared with the object code on the disk,
ignoring the `D4 nn` markers that only B2C 2.00.04 writes and the skip / jump counts that depend on them. A line that compiles to the same bytes was decoded exactly,
whatever the cosmetic differences from the original text. Result on 166 programs: of 9,908 lines, 9,888 decode, **9,764 (98.8% of the 9,884 decodable lines) recompile identically**, 120 differ
and 20 are not decoded. A second disk (45 programs, 2,404 lines, many compiled without statement numbers) reaches 89.3% with about 40 lines undecoded; the 37 lines kept tokenized
by B2C 2.00.04 cannot be verified. Objects may carry `61 nn` / `D4 nn` markers anywhere between statements, or none at all; the decompiler skips them.
The older compiler also omits the unreachable jump after `STOP`/`LOAD`/`GOTO`, merges consecutive PRINTs in one record, and uses `PRINTUSING` flag bits as a mask of `;` separators (bit 0 after the format, bit k after item k). About 33 of the differences are forms that B2C 2.00.04 refuses and keeps tokenized (not verifiable with that compiler); the rest are
compiler choices that cannot be reproduced from text (a TAB in a string literal becomes two blanks, the flag of `MAT COPY`, a `C5` before `A5` in some prints).

Also found with the round trip: opcode `89` selects the numeric function by its first byte (1 RND, 2 LOG, 4 EXP, 5 SIN, 6 COS, 7 TAN, 8 SQR, 9 ARCTAN, 10 ARCSIN, 11 ARCCOS, 0 FIX); `$PACK`/`$UNPACK` = `49 nn 00 kk` + items with `30 xx` (kk 5/4 unpack D/F, 2/1 pack D/F); `$IF` and `VERIFY` follow `BD`; `MAT` operations have their own opcodes (`7C 7E 7F 82 85 87 88 8A AF B1`); `LIST` = `CD 06 00 kind 00 from to`; boolean chains repeat `7A code`. System variables are `5A nn` (0x13 `$DEVICE`, 0x15 `$SCREEN`, 0x16 `$KEYBOARD`, 0x18 `$ENVIRONMENT`, 0x19 `$MACHINE`, 0x1A `$BOXTABLE`, 0x1B `$OPTIONS`); `$SHELL a$` = `D7 01`, `$END` = `8F 14`.

Rules found with the round trip: `D3 nn` = column of the statement (blanks = nn + 2 - current column); `$TRAN` flag 0 = `R`; `ALL(hex)` vs `ALL("c")` by the `DA` flag;
`DSKIP` / `DBACKSPACE` sub-codes 00..05; `SAVE` flag 0 = `SAVE T`, 8 = `SAVE T()`, a non-zero file constant = `SAVE T#n,`; PRINTUSING flag bit 0 = `;` after the format, bit 1 = trailing `;`.

## Coverage
Measured on the 166 programs with a source (eighth pass, loose comparison: blanks, `THEN GOTO`, zero padding, `STR(x,1,n)` =
`STR(x,,n)`, `HEX(20)` = `" "`, which the compiler cannot distinguish): of 9,908 lines, 9,190 (92.8%) come back with the same text
as the source, about 610 decode with differences (redundant parentheses in the original, `ELSE` after `ON..GOTO`, `ALL("0")`
versus `ALL(0)`, `LOAD RUN` without a name, and similar details), and 108 stop at a token not yet understood. On the whole
test disk (including programs with no source) 98% of the lines decode.

Added in the eighth pass: statements kept in Wang tokenized form (record `20 n a b <Wang tokens>`: the engine's Wang token table decodes them),
HEXPRINT (`A1 9E`), RESTORE without a line, real constants written with an exponent (`1E6`), the two-byte AND/OR/XOR assignment form,
and MAT SEARCH relations.

Added in the seventh pass: user functions (`DEFFN T(X)=expr` = `40 n id param expr 4E`, call = `arg 28 id 00 00`, id = letter - 0x37), key macros
(`DEFFN'n"text"`: `41 n fn len text`, told apart from a normal DEFFN by a non-zero second byte), image lines with fields (`CB n tl text`
then `(count,08)` = count `#` characters and `(count,text)` literals, ended by 00), DATA tables with several type masks (one u16 mask per
group of 16 items), MOVE (`BE 8F 08 .. 91 00`), MAT MOVE (`81`), SELECT lists mixing `#n<dev>` and `PRINT <dev>(w)`, $GIO with flag 06, and signed real
constants.

Added in the sixth pass: mixed AND/OR conditions (the chain is flattened: a condition whose skip lands on the start of the THEN body is an
"if true go to THEN" jump with the relation as written and ends an AND group, the others are "if false skip" tests with the inverted
relation; groups are joined by OR), DATA tables longer than 16 items (periodic type mask), COPY (`BE 8F 08 .. BE 8F 08 .. 2F 00`), $OPEN,
$FORMATDISK, SCRATCH DISK (`8F 16/17`), LIST SDC (`8F 24`), DATA SAVE DA (`46 n 37`), DATA SAVE DC CLOSE (`3B`), MAT REDIM (`B3`),
COM CLEAR (`2D`), ROTATE / ROTATEC, SGN (`BF`), `^` (`9B`), multiple assignment of ALL, statements that follow a line-form IF without
their own `61 n` header, and DEFFN parameters that are substrings.

Added in the fifth pass: ABS, VER, unary minus (`93`), `$PSTAT(n)` / `$MSG` (`5A 0D` / `5A 08`), `$RELEASETERMINAL [TO n]` (`4A`),
PACK / UNPACK (`62 n 08|00 n k .. 97 .. 30 0B|0C`), MAT SORT (`86`), MAT ZER (`8F 10`), `$BREAK n` (`8F 13`), RETURN CLEAR ALL
(`8F 01`), ROTATEC (`B8 01`), SELECT P (`5B 02`), ON..GOSUB (entries `6A line` + `26` fillers), VERIFY (`CA`), DBACKSPACE (`3F 01`),
LOAD with a variable name, SAVE with a range (`BA f s e`), AND/OR/XOR function forms (`7A 18`, `7A 06`), SPACEK.

Added in the fourth pass: relative jumps (`26 rel16` = target body start, resolved through the program's line table: GOTO,
KEYIN, IF ... THEN <earlier line>, RESTORE LINE `B6 01 rel`), END / RETURN CLEAR / CLEAR / $CLOSE / $RELEASEPART (`8F nn` as a
statement), NEXT lists, image lines inside a line (`CB`), PRINTUSING (`AB m x y line16`, items closed by `AA`/`AC`, end `A9`),
RESTORE LINE, READ (`AE 70` / `B0 73`), HEXPACK / HEXUNPACK (`5F` / `60`), MAT SEARCH (`84 kind`) and MAT COPY (`7D 00`), INIT with
several targets (`65`.. `66`), SELECT lists and `SELECT #n<dev>` chains, multiple assignment (`74 n 00 .. 73 75`), Boolean and
arithmetic string statements (`4C 73` copy then `7A code` XOR/AND/OR, `79 code` ADD/SUB), MIN / MAX / NUM, POS with its relation,
DIM/COM of numeric arrays (`42`), AND/OR chains (a nested IF whose body ends beyond the first skip = OR), $GIO (`D2` text with
first byte 04, then file, hex words, arrays, `48`), DATA LOAD DA (`46 n 32 ..`), SCRATCH (`8F 15`), SAVE (`BA`), DSKIP (`3F`),
LINPUT variants (`4D 01|03|05|07`: bit 2 = `?`, bit 1 = `-`), ERROR followed by a statement with the same index, and several
small tokens (`#ID`, `#PART`, `#TERM`, `#GOLDKEY`, `ERR`, `TIME`, `DATE`).

Still open: other `BE` sub-codes (`8F 08` COPY, `8F 24` LIST, FORMAT, MOVE, VERIFY), `$IF`, `$TRAN` with its `R` flag, `LOAD RUN`
without a name, image lines with `#` fields, ON ... GOTO tables with unusual layouts, DEFFN with unusual headers, ADD/SUB corner
cases, and a few dozen rare tokens.
