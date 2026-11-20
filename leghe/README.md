# Premi delle classifiche

L'azione **Premi classifiche** (`.github/workflows/premi.yml`) gira ogni 15 minuti:
legge le classifiche "di oggi" di Play Giochi e, quando il giorno di Google finisce
(mezzanotte in California = 9:00 in Italia), scrive i premi in `premi.json`.
Il lunedì aggiunge i premi della settimana (somma dei punteggi di ogni giorno).
Il gioco legge `premi.json` e fa ritirare i premi a chi li ha vinti.

- `config.json`: premi per posizione (giornalieri e settimanali), modificabili qui.
- `stato.json`: letture dei giorni (scritto dall'azione, non toccare).
- Secrets del repository: `PGS_CLIENT_ID`, `PGS_CLIENT_SECRET`, `PGS_REFRESH_TOKEN`.
