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

## Coverage
Measured on the 166 programs with a source (third pass, loose comparison in `metric.py`: blanks, `THEN GOTO`, zero padding,
`STR(x,1,n)`=`STR(x,,n)`, `HEX(20)`=`" "`, which the compiler cannot distinguish): of 9,908 lines, 7,483 (75.5%) decode to the same
text as the source, 508 decode with differences (mostly redundant parentheses and AND/OR corner cases), 1,917 stop at a token not
yet understood (`run1.py` lists them by frequency).

Added in the third pass: ELSE (a forward `26 rel` ends the THEN part, the else statements follow as ordinary `61 n` records),
AND/OR chains (skip-form IF whose skip lands inside the next condition = OR; nested IF filling the whole skip = AND), string
concatenation (`2E` = "append next operand"), `BIN` (`24`), `TIME`/`DATE` (`8F 05`/`8F 03` + `5A`), VAL (`C6` / `C7`=VAL(x,2)),
CONVERT (`62 n 08 30 09`, string to number `30 08`), `ALL` (`6F`), INIT (`66`), LINPUT without prompt (`4D 03`), multiple assignment
(`71`), ERROR (`51 09 00 rel32` + GOTO/GOSUB/STOP), STOP with text (the message string is `CR "STOP " text [line no] CR`; the line
number means `#`), REM (control bytes 1..31 inside the text = that many blanks), and the disk family `BE`: file number, operands,
then a sub-code: `78` LOAD, `46 n arr 31|36` DATA LOAD/SAVE BA, `35 00` DC OPEN, `3D` SAVE DC OPEN, `3C` DC END,
`34 len ..items.. 33` DATA LOAD DC, `3A ..items.. 39` DATA SAVE DC (each item: array/var ref then `30 kind`), `7B` LIMITS.

Still open: `$GIO` (`5A 00 BD`, `D2` text + `04`), the other `BE` sub-codes (`8F xx` COPY/SCRATCH/FORMAT/MOVE, DSKIP `3F`, VERIFY `CA`,
`$OPEN`), MAT, PRINTUSING, READ/RESTORE, HEXPACK (`C5 5F`), `IF END` / `IF #ID` (`55 nn 00`), `BIN(STR())=` stores (`7A`), image lines
with `#` fields, and statements that leave operands on the stack.
