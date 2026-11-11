/* ================= Dialect profiles: which "BASIC-2" are we running? =================
   Many versions of Wang BASIC exist, from the original 2200 BASIC to Niakwa's BASIC-2C compiler. A profile tells
   the interpreter what to accept. Profiles are DATA, so a new version can be added without touching the parser.

   features:           booleans checked by the parser (see Parser in basic2.js)
     else              IF ... THEN ... ELSE ...
     linput            LINPUT statement
     printAt           AT(row,col[,n]) inside PRINT
     printBox          BOX(h,w) inside PRINT (2236-style terminal graphics)
     remDollarPc       Niakwa extension: "REM $PC <statement>" is executed (a plain REM everywhere else)
   disabledFunctions:  functions the dialect does not have (calling one is a syntax error)
   status:             'reference' (modelled as far as we know) | 'partial' | 'planned' (accepted, but behaves like basic2)

   What the profiles are based on (so they can be checked and extended):
   - WangEmu wvdutil token table (Jim Battle): marks the atoms that exist only in BASIC-2 (FIX(, LGT(, DAC, DSC, SUB,
     LINPUT, VER(, ELSE, SPACE, ROUND(, AT(, HEXOF(, MAX(, MIN(, MOD(, ERR).
   - Niakwa B2C help files and the conversion of a real program (see README): REM $PC extension, compiler options.
   Everything not listed here is NOT modelled yet and is accepted as in basic2. */
const DIALECTS = {
  'wang-basic': {
    id: 'wang-basic',
    name: 'Wang BASIC (2200A/B/T)',
    era: '1973-1980',
    status: 'partial',
    summary: 'The original 2200 BASIC, before BASIC-2: no ELSE, LINPUT, AT(, BOX(, MIN/MAX/MOD, ROUND, HEXOF, VER.',
    features: { else: false, linput: false, printAt: false, printBox: false, remDollarPc: false },
    disabledFunctions: ['MIN', 'MAX', 'MOD'],
    notes: [
      'Gating is by keyword and function only; semantic differences of the original BASIC are not modelled yet.',
      'Single-quoted strings (allowed by the original BASIC) are not supported.',
    ],
  },
  'basic2': {
    id: 'basic2',
    name: 'Wang BASIC-2 (2200 VP/MVP/LVP)',
    era: '1979-1990',
    status: 'reference',
    summary: 'The reference dialect of this interpreter: the language of 2200 VP/MVP programs such as UNS-MAN.',
    features: { else: true, linput: true, printAt: true, printBox: true, remDollarPc: false },
    disabledFunctions: [],
    notes: [],
  },
  'basic2-pc': {
    id: 'basic2-pc',
    name: 'Wang PC BASIC-2',
    era: '1983-1988',
    status: 'planned',
    summary: 'BASIC-2 for the Wang Professional / APC (programs distributed as .BS2 images). Currently identical to basic2.',
    features: { else: true, linput: true, printAt: true, printBox: true, remDollarPc: false },
    disabledFunctions: [],
    notes: ['Differences from the 2200 version (keyboard, screen, file system, speed) are not modelled yet.'],
  },
  'niakwa-2c': {
    id: 'niakwa-2c',
    name: 'Niakwa BASIC-2C (NPL)',
    era: '1986-',
    status: 'partial',
    summary: 'Niakwa BASIC-2C: BASIC-2 compiled for MS-DOS/Unix. Adds "REM $PC" statements; compiler options are not modelled.',
    features: { else: true, linput: true, printAt: true, printBox: true, remDollarPc: true },
    disabledFunctions: [],
    notes: [
      'B2C is a compiler: it reads .SRC files or 2200-format disk images (.BS2) and produces .OBJ files for a RunTime.',
      'Not modelled yet: $-statements specific to NPL, graphics options, compiler options (-NUMBERS, -WARNINGS, -LCASE), error codes.',
    ],
  },
};

const DEFAULT_DIALECT_ID = 'basic2';
const DEFAULT_DIALECT = DIALECTS[DEFAULT_DIALECT_ID];

function getDialect(id){
  const d = DIALECTS[id];
  if (!d) throw new Error('unknown dialect "' + id + '" (available: ' + Object.keys(DIALECTS).join(', ') + ')');
  return d;
}
function listDialects(){ return Object.values(DIALECTS); }

if (typeof module !== 'undefined') module.exports = { DIALECTS, DEFAULT_DIALECT, DEFAULT_DIALECT_ID, getDialect, listDialects };
