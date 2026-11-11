# WANG-PACMAN

Porta nel browser **UNS-MAN** (clone di Pac-Man per Wang 2200, Steve McGarry, Wang Laboratories, 1981) eseguendo
il **listato BASIC-2 originale** con un interprete scritto in JavaScript, un terminale Wang 2236 emulato (font reale)
e un disco virtuale (platter) per la classifica.

## Cosa c'è e cosa NON c'è

- `engine/` - **BASIC2-JS**: interprete Wang BASIC-2, platter, terminale. Riusabile (vedi `engine/README.md`).
- `app/` - la pagina web (`template.html`, `app.js`) e lo script di build.
- I **listati originali non sono inclusi**: nell'intestazione di UNS-MAN l'autore chiede di non distribuire il
  programma in forma non protetta. Per costruire la pagina servono `UNS-MAN.txt` e `UNS-GAME.txt` (listati testuali,
  una riga BASIC per riga, byte non stampabili scritti come `\xHH`) messi in `listings/` o indicati con la variabile `LISTINGS`.

## Costruire

    python app/tools/build.py          # produce app/index.html (un solo file, non versionato)
    node engine/test/parse-uns.js      # prove sul motore (richiedono i listati)

## Crediti

- Programma: Steve McGarry, Wang Laboratories (1981).
- Font del terminale: [WangEmu](https://github.com/jimbattle/wangemu) di Jim Battle (MIT), vedi `NOTICE`.
