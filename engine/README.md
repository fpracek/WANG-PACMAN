# BASIC2-JS

Interprete **Wang BASIC-2** in JavaScript puro, pensato per girare nel browser (e in Node per i test),
con **platter** (dischi virtuali) e un terminale Wang 2236 emulato. Nato per eseguire i listati originali
senza riscriverli: il primo client è `UNS-MAN` (clone di Pac-Man di Steve McGarry, 1981; il listato non è incluso), che gira
**così com'è**, senza modifiche al sorgente BASIC (solo due "patch" opzionali per righe che toccano l'hardware).

## Architettura

```
src/
  basic2.js     linguaggio: Parser (testo -> AST) + Interp (esecuzione, variabili, FOR/GOSUB, I/O)
  platter.js    Platter (un disco con file) + DiskSystem (unità montate, ricerca, persistenza)
  wangcrt.js    Terminal: modello dello schermo 80x24 con i byte di controllo del 2236 (nessun DOM)
  crt-canvas.js createCrtRenderer(canvas): disegno con il font reale + effetto fosforo
  font.js       tabelle del character generator (da WangEmu, MIT)
test/           prove in Node: parser sui listati, esecuzione, classifica su platter, tasti
```

Il motore **non conosce il DOM**: parla con tre dispositivi che si passano al costruttore.

```js
const interp = new Interp(term, io, disk);
interp.start('UNS-MAN');        // carica il programma dal disco e lo esegue
interp.reset();                 // ferma (RESET)
```

| Dispositivo | Contratto |
|---|---|
| `term` (CRT) | `out(byte)`, `at(r,c)`, `atClear(r,c,n)`, `drawBox(r,c,h,w,draw)`, `cx/cy/cols`, `clear()`, `hex(str)`, `print(str)` |
| `io` (tastiera) | `poll()` -> `{c,sp}` o `null` (non blocca); `next()` -> `Promise<{c,sp}>`. `sp:true` = tasto speciale (frecce) |
| `disk` | `DiskSystem`: `readProgram(nome)`, `readData(nome)`, `writeData(nome,record)`, `status(nome)`, `restore()` |

### Platter

Un `Platter` è un disco con file di due tipi: `program` (listato testuale, una riga BASIC per riga) e
`data` (record per `DATA LOAD DC` / `DATA SAVE DC`). `DiskSystem` monta i platter agli indirizzi stile Wang
(`'310'`, `'320'`, ...), tiene l'unità corrente e cerca i file prima lì e poi nelle altre.
La persistenza usa `localStorage` **solo per i file dati** (i listati arrivano sempre dal codice) e degrada
a "solo memoria" dove `localStorage` non è disponibile (iframe sandbox, URL `data:`). Un platter si può
esportare/importare come JSON (`exportPlatter` / `importPlatter`).

```js
const disk = new DiskSystem({prefix: 'miodisco'});
const p = disk.mount('310', new Platter('GIOCHI'));
p.addProgram('UNS-MAN', testoDelListato);
```

## Il dialetto: cosa è implementato

Istruzioni: `REM` (e `%`), `DIM`, `COM`, `LET` implicito (anche multiplo `A,B=0`, `STR(..)=`),
`IF..THEN..ELSE`, `FOR/NEXT [STEP]`, `GOTO`, `GOSUB`/`RETURN [CLEAR [ALL]]`, `ON..GOTO/GOSUB`, `DEFFN'n` + `GOSUB 'n(..)`,
`DATA`/`READ`/`RESTORE [LINE n]`, `MAT ZER/CON/copia/READ`, `PRINT` (`AT`, `AT(r,c,n)`, `TAB`, `BOX`, `HEX`, `;`),
`PRINTUSING`, `KEYIN`, `LINPUT`, `CONVERT`, `LOAD T"nome"` (concatenamento con variabili `COM`), `LIMITS`,
`DATA LOAD/SAVE DC` (su platter), `SELECT`, `STOP`, `$GIO/005`, `$BREAK`, `$TRAN`.
Funzioni: `INT MOD MIN MAX ABS RND SGN LEN POS STR HEX ALL BIN ADDC`, operatori `+ - * / ^ &`, relazionali, `AND OR`.

Punti di semantica che contano (scoperti sui listati reali):

- **`IF..THEN` governa UNA sola istruzione**; le istruzioni dopo i due punti girano sempre. `: ELSE ...` appartiene all'IF.
- **Stringhe a lunghezza fissa** (riempite di spazi, 16 se non dichiarate); `STR(v,a,n)` vale come valore e come destinazione;
  i confronti riempiono la stringa più corta con spazi; `ALL(hh)` riempie, `HEX(..)` dà byte.
- **`KEYIN K$`** senza numeri di riga **attende** un tasto. **`KEYIN K$,l1,l2`** non blocca: senza tasto `K$` resta
  invariato; con un tasto normale salta a `l1`, con un tasto speciale (cursori) a `l2` (con `l1` = la riga stessa si svuota il buffer).
- Il listato è **senza spazi** (`IF X1(G)<>XOR Y1(G)<>YTHEN`): il parser lavora sul testo grezzo e decide per contesto
  se `XOR` è `X OR`. Le variabili sono lettera+cifra+`$`.
- Numeri stampati come `" 12 "` (segno e spazio finale): `PRINT H0;HEX(08)` cancella lo spazio finale.
- `PRINT` senza `;` finale emette `CR LF` (il CR spegne l'attributo temporaneo `HEX(0E)`); a fine schermo lo `LF` scorre.
- **Tempo virtuale**: ogni istruzione e ogni byte al terminale costano microsecondi (`stmtCost`, `byteCost`, `breakCost`,
  moltiplicati da `speed`); l'esecuzione viene rallentata in proporzione. Il ritmo di molti giochi dipendeva solo dalla
  lentezza del 2200, quindi è regolabile. `SELECT P1` = uscita lenta (animazioni).

## Cosa manca per un emulatore BASIC-2 completo (roadmap)

1. **Modo immediato / prompt**: `LIST`, `RUN`, `CONT`, `CLEAR`, `EDIT`, inserimento di righe, `RENUMBER`, tasti funzione (`SF`).
2. **Comandi disco veri**: `SAVE`, `LOAD`, `SCRATCH`, `CATALOG`, `COPY`, `MOVE`, `DATASAVE/DATALOAD BA` con settori, `SELECT DISK/#n`,
   `$OPEN/$CLOSE`, `LIMITS` reale (settori inizio/fine). Il modello `Platter` oggi ha cataloghi ma non settori da 256 byte:
   il passo naturale è leggere i `.wvd` di WangEmu (header + settori) e il formato dei programmi tokenizzati.
3. **Errori** con i codici BASIC-2 (`ERR nn`), `ON ERROR`, `ERROR`.
4. **Dispositivi**: stampante (`215`/`SELECT PRINT`), seriale, più terminali; `SELECT` oggi è quasi tutto un no-op.
5. **Numeri**: precisione decimale a 13 cifre (ora `double`), formati di `PRINTUSING` completi (`.`, `,`, `$`, `-`, esponente).
6. **Istruzioni mancanti**: `INPUT`, `PRINT USING` con più campi, `MAT` aritmetiche/`INV`/`TRN`, `REDIM`, `$PACK/$UNPACK`,
   `$TRAN` con tabelle da 256 byte, `OR/AND/XOR` bit-a-bit su stringhe, funzioni stringa (`VAL`, `NUM`, `BIN` esteso).
7. **Prestazioni**: oggi AST interpretato (≈ centinaia di migliaia di istruzioni/s, più che sufficiente); se servisse, compilare l'AST in closure.

## Prove

```
node test/parse-uns.js          # il parser accetta ogni riga di UNS-MAN e UNS-GAME
node test/run-uns.js            # esegue il titolo e una partita, stampa lo schermo
node test/hof-and-speed.js      # classifica su platter (scrittura nome + rilettura) e ritmo del gioco
node test/title-keys.js         # tasti sul titolo (KEYIN bloccante e non)
```

## Crediti

Font del terminale: [WangEmu](https://github.com/jimbattle/wangemu) di Jim Battle (MIT).
UNS-MAN / UNS-GAME: Steve McGarry, Wang Laboratories, 1981 — listati usati per studio e conservazione.
