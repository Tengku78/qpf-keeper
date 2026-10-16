#!/usr/bin/env node
// QPF Keeper v3.1: keeps a QuantumProof testnet validator online and reports to Discord.
// It runs the official qpf-node.js, restarts it when it stops signing, and only READS from the
// QuantumProof site. The only thing it ever sends is messages to your own Discord webhook.
// It reads your validator ADDRESS from qpf-validator.json, never the private key.
'use strict';
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), crypto = require('crypto');

const DIR = __dirname, NODE_FILE = path.join(DIR, 'qpf-node.js');
const CFG_FILE = path.join(DIR, 'keeper.config.json'), STATE_FILE = path.join(DIR, 'keeper.state.json');
const T = Number(process.env.KEEPER_TIME_SCALE || 1); // test hook: speeds up every timer
const DEFAULTS = {
  name: 'validator', site: 'https://quantumproofchain.net', webhookFile: 'discord-webhook.txt',
  summaryHour: 9, restartAfterSec: 60, alertAfterSec: 180,
  rankAlerts: true, missAlerts: true, resetAlerts: true, updateWatch: true,
  nodeSha256: null, maxLogMB: 5, logFile: 'node.log',
};
const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const writeJSON = (f, o) => { try { fs.writeFileSync(f, JSON.stringify(o, null, 2)); } catch (e) { log('could not save', path.basename(f), e.message); } };
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const log = (...a) => console.log(new Date().toISOString(), '[keeper]', ...a);

const cfg = { ...DEFAULTS, ...readJSON(CFG_FILE, {}) };
const SITE = process.env.QPF_SITE || cfg.site;

// --trust: accept the current qpf-node.js as the approved version, then exit.
if (process.argv.includes('--trust')) {
  cfg.nodeSha256 = sha256(NODE_FILE); writeJSON(CFG_FILE, cfg);
  console.log('Approved qpf-node.js, fingerprint ' + cfg.nodeSha256.slice(0, 16) + '…'); process.exit(0);
}

const key = readJSON(path.join(DIR, 'qpf-validator.json'), {});
const ADDR = key.addr || null, NAME = key.name || cfg.name;
const st = { day: null, pts0: null, rank0: null, upSec: 0, totSec: 0, restarts: 0, resets: 0,
  missedSeen: 0, lastHeight: 0, notifiedOfficialSha: null, ...readJSON(STATE_FILE, {}) };
const save = () => writeJSON(STATE_FILE, st);

async function notify(text) {
  let url = ''; try { url = fs.readFileSync(path.join(DIR, cfg.webhookFile), 'utf8').trim(); } catch { return; }
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) return;
  try { await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: NAME + ' · QPF Keeper', content: text.slice(0, 1900) }) }); }
  catch (e) { log('discord error:', e.message); }
}
async function getJSON(p) { const r = await fetch(SITE + p); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
async function rpc(method, ...params) {
  const r = await (await fetch(SITE + '/rpc', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (r.error) throw new Error(r.error.message); return r.result;
}
async function board() {
  const j = await getJSON('/api/points'); const top = j.top || [];
  const i = top.findIndex((x) => x.addr === ADDR);
  return { me: top[i], above: i > 0 ? top[i - 1] : null, below: i >= 0 ? top[i + 1] : null, n: j.participants || top.length, top };
}
const who = (x) => x ? (x.name || x.addr.slice(0, 10) + '…') : '';
const gapLine = (b) => [b.above && `${b.above.total - b.me.total} behind #${b.above.rank} ${who(b.above)}`,
  b.below && `${b.me.total - b.below.total} ahead of #${b.below.rank} ${who(b.below)}`].filter(Boolean).join(' · ');

// ---- the validator process ------------------------------------------------------------
// lastSig: since the current node process started or last signed (drives restarts).
// lastGood: last real signature, never reset by a restart (drives offline alerts and uptime).
// recovering: set whenever the node is restarted, so the next signature sends "back online".
let child = null, lastSig = Date.now(), lastGood = Date.now(), alerted = false, tampered = false, recovering = false;
function restartNow(why) { if (!child) return; log(why + ', restarting'); recovering = true; const c = child; child = null; c.kill(); }
function nodeIsTrusted() {
  if (!fs.existsSync(NODE_FILE)) { log('qpf-node.js is missing'); return false; }
  const h = sha256(NODE_FILE);
  if (!cfg.nodeSha256) { cfg.nodeSha256 = h; writeJSON(CFG_FILE, cfg); log('recorded qpf-node.js fingerprint', h.slice(0, 16)); }
  return h === cfg.nodeSha256;
}
function start() {
  if (!nodeIsTrusted()) {
    if (!tampered) { tampered = true; log('qpf-node.js changed, refusing to run');
      notify('🛑 **Stopped for safety.** `qpf-node.js` on this Mac changed since it was approved, so the keeper will not run it. If you updated it on purpose and reviewed it, run `node ~/qpf/qpf-keeper.js --trust`.'); }
    setTimeout(start, 60000 / T); return;
  }
  if (tampered) { tampered = false; notify('✅ `qpf-node.js` approved again. Starting the validator.'); }
  lastSig = Date.now();
  child = spawn(process.execPath, [NODE_FILE, NAME], { cwd: DIR, env: process.env });
  log('node started, pid', child.pid);
  child.stdout.on('data', (d) => {
    const s = d.toString(); process.stdout.write(s);
    for (const m of s.matchAll(/#(\d+)/g)) {
      const h = +m[1];
      if (st.lastHeight > 50 && h < st.lastHeight - 20) {
        st.resets++; log('chain reset detected', st.lastHeight, '->', h);
        if (cfg.resetAlerts) notify(`🔄 **Chain reset detected** (block #${st.lastHeight} → #${h}). Restarting now to re-register.`);
        st.lastHeight = h; restartNow('chain reset'); return;
      }
      st.lastHeight = h;
    }
    if (/attested|PROPOSED/.test(s)) {
      const now = Date.now(), downFor = Math.round((now - lastGood) / 1000);
      lastSig = lastGood = now;
      if (alerted || recovering) { alerted = recovering = false; notify(`🟢 **Back online.** Signing again after ${downFor}s.`); }
    }
  });
  child.stderr.on('data', (d) => process.stderr.write(d));
  const me = child;
  me.on('exit', (c) => {
    log('node exited (' + c + '), restarting in 10s'); if (child === me) child = null;
    recovering = true; st.restarts++; save(); setTimeout(start, 10000 / T);
  });
}

// Watchdog every 15 s: uptime, restart when quiet, offline alert.
setInterval(() => {
  const now = Date.now(), quiet = now - lastSig, down = now - lastGood;
  st.totSec += 15; if (down <= cfg.restartAfterSec * 1000 / T) st.upSec += 15;
  if (child && quiet > cfg.restartAfterSec * 1000 / T) restartNow('no signatures for ' + cfg.restartAfterSec + 's');
  if (!alerted && !tampered && down > cfg.alertAfterSec * 1000 / T) { alerted = true;
    notify(`🔴 **Offline.** No signatures for ${Math.round(cfg.alertAfterSec / 60)} minutes. The keeper keeps retrying; check \`tail ~/qpf/${cfg.logFile}\` if it lasts.`); }
}, 15000 / T);

// Every minute: missed proposer slots.
setInterval(async () => {
  if (!cfg.missAlerts || !ADDR) return;
  try {
    const v = await rpc('qpf_getValidators'); const me = (v.community || []).find((x) => x.addr === ADDR);
    if (!me) return;
    if (me.missed < st.missedSeen) st.missedSeen = me.missed;
    if (me.missed > st.missedSeen) { const n = me.missed - st.missedSeen; st.missedSeen = me.missed; save();
      notify(`⚠️ **Missed ${n} proposer slot${n > 1 ? 's' : ''}** (−${4 * n} points). Missed so far: ${me.missed}.`); }
  } catch (e) { log('validator check failed:', e.message); }
}, 60000 / T);

// Every 5 minutes: rank changes and the daily report.
let lastRank = null;
async function fiveMinute() {
  try {
    const b = await board(); if (!b.me) return;
    if (st.pts0 === null) { st.pts0 = b.me.total; st.rank0 = b.me.rank; st.day = new Date().toDateString(); save(); }
    if (cfg.rankAlerts && lastRank !== null && b.me.rank !== lastRank)
      notify(`${b.me.rank < lastRank ? '📈 Up' : '📉 Down'} to **#${b.me.rank}** of ${b.n} · ${b.me.total} points\n${gapLine(b)}`);
    lastRank = b.me.rank;
    const now = new Date();
    if (now.getHours() >= cfg.summaryHour && st.day !== now.toDateString()) {
      let v = null; try { v = ((await rpc('qpf_getValidators')).community || []).find((x) => x.addr === ADDR); } catch {}
      const up = st.totSec ? (100 * st.upSec / st.totSec).toFixed(1) : '–';
      const dPts = b.me.total - st.pts0, dRank = st.rank0 - b.me.rank;
      const leader = b.top[0];
      notify([
        `📊 **Daily report · ${NAME}**`,
        `Rank **#${b.me.rank}** of ${b.n}${dRank ? ` (${dRank > 0 ? '▲' : '▼'}${Math.abs(dRank)})` : ''} · **${b.me.total}** points (+${dPts} in 24 h)`,
        gapLine(b) || (leader && leader.addr === ADDR ? 'You are #1 🏆' : ''),
        `Uptime ${up}% · restarts ${st.restarts} · chain resets ${st.resets}`,
        v ? `This chain: proposed ${v.produced} · attested ${v.attested} · missed ${v.missed} · ${v.online ? 'online 🟢' : 'offline 🔴'}` : '',
      ].filter(Boolean).join('\n'));
      Object.assign(st, { day: now.toDateString(), pts0: b.me.total, rank0: b.me.rank, upSec: 0, totSec: 0, restarts: 0, resets: 0 }); save();
    }
  } catch (e) { log('points check failed:', e.message); }
}
setInterval(fiveMinute, 300000 / T);

// Every 6 hours: has the official validator script changed? Alert only; never auto-install.
async function updateWatch() {
  if (!cfg.updateWatch) return;
  try {
    const r = await fetch(SITE + '/qpf-node.js'); if (!r.ok) return;
    const h = crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
    if (h !== cfg.nodeSha256 && h !== st.notifiedOfficialSha) { st.notifiedOfficialSha = h; save();
      notify('🆕 **The official `qpf-node.js` changed on the QuantumProof site.** Nothing was installed. Have it reviewed before you update.'); }
  } catch (e) { log('update check failed:', e.message); }
}
setInterval(updateWatch, 6 * 3600000 / T);

// Every hour: keep the log file small.
setInterval(() => {
  try { const f = path.join(DIR, cfg.logFile); if (fs.statSync(f).size > cfg.maxLogMB * 1048576) { fs.truncateSync(f, 0); log('log trimmed'); } } catch {}
}, 3600000 / T);

process.on('SIGTERM', () => { save(); if (child) child.kill(); process.exit(0); });
start();
(async () => {
  try { const b = await board(); lastRank = b.me ? b.me.rank : null;
    notify(`✅ **Keeper v3.1 started** for ${NAME}${b.me ? ` · rank #${b.me.rank} of ${b.n} · ${b.me.total} points` : ''}.`); }
  catch { notify(`✅ **Keeper v3.1 started** for ${NAME}.`); }
  setTimeout(updateWatch, 60000 / T);
})();
