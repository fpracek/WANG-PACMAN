/* ================= Compatibility patches, by program name =================
   Some programs use statements this engine does not model. A patch replaces ONE line (by number) with a statement of ours
   that has the same effect in the web environment. The table is keyed by program name (as stored on the disk) and is applied
   whenever a program of that name is compiled: a LOAD/RUN typed in the workstation, or a chained LOAD T"name" from a program.
   The replacement statements are our own code; no original listing text is stored here. */
const COMPAT = {
  'UNS-MAN':  { 74: 'GOTO 70', 92: 'F=0' },
  'UNS-GAME': { 1570: 'GOTO 1620' },
};

/* "UNS-MAN_listd.txt" / "UNS-MAN (1).txt" -> "UNS-MAN" */
function programNameFromFile(fileName){
  return fileName.replace(/[.][^.]*$/, '').toUpperCase().replace(/\s*\(\d+\)\s*$/, '').replace(/[ _.-]*(LISTD|LIST|LST)$/, '').trim();
}

if (typeof module !== 'undefined') module.exports = { COMPAT, programNameFromFile };
