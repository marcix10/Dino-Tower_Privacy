// Premi delle classifiche di Dino Tower (giornalieri e settimanali).
// Gira su GitHub Actions ogni 15 minuti: legge le classifiche "di oggi" di Play Giochi,
// tiene l'ultima lettura di ogni giorno e, quando il giorno di Google è finito
// (mezzanotte in California = 9:00 in Italia), assegna i premi in premi.json.
// La settimana (lunedì-domenica, giorni di Google) somma i punteggi finali di ogni giorno.
// Senza rete verso Google: MOCK=file.json usa dati finti (per le prove).
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ROOT = path.join(DIR, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const STATE_FILE = path.join(DIR, 'stato.json');
const OUT_FILE = path.join(ROOT, 'premi.json');
const NOW = process.env.NOW ? new Date(process.env.NOW) : new Date();

// giorno di Google (fuso della California) come AAAA-MM-GG
function googleDay(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();   // 0 = domenica
const monday = (day) => addDays(day, -((weekday(day) + 6) % 7));

async function accessToken() {
  const body = new URLSearchParams({
    client_id: process.env.PGS_CLIENT_ID || '',
    client_secret: process.env.PGS_CLIENT_SECRET || '',
    refresh_token: process.env.PGS_REFRESH_TOKEN || '',
    grant_type: 'refresh_token',
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = await r.json();
  if (!j.access_token) throw new Error('Accesso a Google non riuscito: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

// classifica di oggi (tutte le pagine, fino a 300 giocatori)
async function loadDaily(token, id) {
  if (process.env.MOCK) {
    const m = JSON.parse(fs.readFileSync(process.env.MOCK, 'utf8'));
    return (m[id] || []).map((e, i) => ({ id: e.id, name: e.name, score: e.score, rank: e.rank || i + 1 }));
  }
  const out = [];
  let page = '';
  for (let i = 0; i < 10; i++) {
    const u = new URL(`https://games.googleapis.com/games/v1/leaderboards/${id}/scores/PUBLIC`);
    u.searchParams.set('timeSpan', 'DAILY');
    u.searchParams.set('maxResults', '30');
    if (page) u.searchParams.set('pageToken', page);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(`Classifica ${id}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    for (const e of j.items || []) {
      if (!e.player || !e.player.playerId) continue;
      out.push({ id: e.player.playerId, name: e.player.displayName || '', score: Number(e.scoreValue) || 0, rank: Number(e.scoreRank) || out.length + 1 });
    }
    page = j.nextPageToken || '';
    if (!page) break;
  }
  return out;
}

function rewardFor(table, rank) {
  const f = table.find((x) => rank >= x.da && rank <= x.a);
  if (!f) return null;
  const r = {};
  if (f.ambra) r.ambra = f.ambra;
  if (f.bones) r.bones = Math.max(150, f.bones);
  if (f.tok) r.tok = f.tok;
  return r;
}
// posizioni con i pari merito (stesso punteggio = stessa posizione)
function ranked(list) {
  const s = list.slice().sort((a, b) => b.score - a.score);
  let last = null, rank = 0;
  return s.map((e, i) => { if (e.score !== last) { rank = i + 1; last = e.score; } return Object.assign({}, e, { rank }); });
}
function entry(kind, period, board, list, table) {
  const players = {};
  for (const e of list) {
    const r = rewardFor(table, e.rank);
    if (r && e.score > 0) players[e.id] = Object.assign({ rank: e.rank, name: e.name, score: e.score }, r);
  }
  return { id: `${kind === 'daily' ? 'd' : 'w'}-${period}-${board}`, kind, period, board, players };
}

async function main() {
  // finché i Secrets non ci sono, non fa niente (niente errori ogni 15 minuti)
  if (!process.env.MOCK && !process.env.PGS_REFRESH_TOKEN) { console.log('Secrets di Play Giochi non ancora impostati: nessuna lettura.'); return; }
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { days: {} };
  const out = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : { v: 1, rewards: [] };
  const today = googleDay(NOW);
  const boards = CFG.classifiche;

  // 1. lettura di oggi (sostituisce quella di 15 minuti fa)
  const token = process.env.MOCK ? '' : await accessToken();
  const snap = {};
  for (const [k, id] of Object.entries(boards)) snap[k] = await loadDaily(token, id);
  const prev = state.days[today];
  const count = (b) => Object.values(b || {}).reduce((a, l) => a + l.length, 0);
  // una lettura vuota (Google senza risposte) non cancella quella buona di prima
  if ((!prev || !prev.final) && (!prev || count(snap) >= count(prev.boards))) state.days[today] = { at: NOW.toISOString(), boards: snap, final: false };

  // 2. giorni finiti: premi giornalieri (e settimanali la domenica)
  const done = [];
  for (const day of Object.keys(state.days).sort()) {
    const d = state.days[day];
    if (day >= today || d.final) continue;
    for (const k of Object.keys(boards)) out.rewards.push(entry('daily', day, k, d.boards[k] || [], CFG.giornalieri));
    d.final = true;
    done.push(day);
    if (weekday(day) === 0) {
      const mon = monday(day);
      for (const k of Object.keys(boards)) {
        const sum = {};
        for (let i = 0; i < 7; i++) {
          const dd = state.days[addDays(mon, i)];
          for (const e of (dd && dd.boards[k]) || []) {
            sum[e.id] = sum[e.id] || { id: e.id, name: e.name, score: 0 };
            sum[e.id].score += e.score;
            sum[e.id].name = e.name || sum[e.id].name;
          }
        }
        out.rewards.push(entry('weekly', mon, k, ranked(Object.values(sum)), CFG.settimanali));
      }
    }
  }

  // 3. pulizia: letture degli ultimi 9 giorni, premi validi per i giorni stabiliti
  for (const day of Object.keys(state.days)) if (day < addDays(today, -9)) delete state.days[day];
  out.rewards = out.rewards.filter((r) => r.period >= addDays(today, -(r.kind === 'daily' ? CFG.giorni_validi : CFG.settimane_valide)));
  // un solo premio per giorno/settimana e classifica
  const seen = new Set();
  out.rewards = out.rewards.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  out.v = 1;
  out.today = today;

  fs.writeFileSync(STATE_FILE, JSON.stringify(state) + '\n');
  fs.writeFileSync(OUT_FILE, JSON.stringify(out) + '\n');
  const n = Object.values(snap).reduce((a, l) => a + l.length, 0);
  console.log(`Giorno di Google ${today}: ${n} punteggi letti. Giorni chiusi: ${done.join(', ') || 'nessuno'}. Premi attivi: ${out.rewards.length}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
