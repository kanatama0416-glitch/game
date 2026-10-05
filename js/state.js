// State shape and every change to it. No DOM, no storage.
// Each change mutates S and returns "ops" describing what must be saved:
//   {t:'shop'} | {t:'record',k} | {t:'month',m} | {t:'skip',k} | {t:'reset'}
// The store reads the current value from S for each op (present → save, missing → delete).
import { EVENTS, BYK } from './events.js';
import { DATE_RE, MONTH_RE, evalAuto, monthEnd } from './logic.js';

export function emptyState() {
  return { sample: false, name: '', start: '', done: {}, months: {}, skip: {} };
}

// Accepts anything (old saves, broken JSON) and returns a valid state.
export function normalize(raw) {
  const S = emptyState();
  if (!raw || typeof raw !== 'object') return null;
  S.sample = raw.sample === true;
  S.name = typeof raw.name === 'string' ? raw.name.slice(0, 20) : '';
  S.start = DATE_RE.test(raw.start || '') ? raw.start : '';
  for (const [k, v] of Object.entries(raw.done || {})) {
    if (!BYK[k] || !v || !DATE_RE.test(v.date || '')) continue;
    const rec = { date: v.date };
    if (Number.isInteger(v.amount) && v.amount >= 0) rec.amount = v.amount;
    if (typeof v.memo === 'string' && v.memo) rec.memo = v.memo.slice(0, 80);
    S.done[k] = rec;
  }
  for (const [m, v] of Object.entries(raw.months || {})) {
    if (!MONTH_RE.test(m) || !v) continue;
    const s = Number.isInteger(v.s) && v.s >= 0 ? v.s : 0, e = Number.isInteger(v.e) && v.e >= 0 ? v.e : 0;
    S.months[m] = { s, e };
  }
  for (const k of Object.keys(raw.skip || {})) if (BYK[k]) S.skip[k] = true;
  return S;
}

export function hasUserData(S) {
  return !S.sample && (Object.keys(S.done).length > 0 || Object.keys(S.months).length > 0 || !!S.name || !!S.start);
}

// Any change by the user makes the data theirs, so it is no longer treated as the sample.
export function applyRecord(S, k, rec, extra) {
  S.sample = false;
  const ops = [{ t: 'record', k }];
  if (k === 'yago' && extra && extra.name != null) { S.name = extra.name; ops.push({ t: 'shop' }); }
  if (k === 'opendate') { S.start = rec.date; ops.push({ t: 'shop' }); }
  if (S.skip[k]) { delete S.skip[k]; ops.push({ t: 'skip', k }); } // recording it means it applies after all
  S.done[k] = rec;
  return ops;
}
export function removeRecord(S, k) {
  S.sample = false;
  delete S.done[k];
  const ops = [{ t: 'record', k }];
  if (k === 'yago') { S.name = ''; ops.push({ t: 'shop' }); }
  if (k === 'opendate') { S.start = ''; ops.push({ t: 'shop' }); }
  return ops;
}
export function setMonth(S, m, v) { S.sample = false; S.months[m] = v; return [{ t: 'month', m }]; }
export function removeMonth(S, m) { S.sample = false; delete S.months[m]; return [{ t: 'month', m }]; }
export function skipEvent(S, k) { S.sample = false; S.skip[k] = true; return [{ t: 'skip', k }]; }
export function unskipEvent(S, k) { delete S.skip[k]; return [{ t: 'skip', k }]; }
export function setShop(S, name, start) {
  S.sample = false;
  S.name = name; S.start = start;
  const ops = [{ t: 'shop' }];
  if (S.done.opendate && DATE_RE.test(start)) { S.done.opendate.date = start; ops.push({ t: 'record', k: 'opendate' }); }
  return ops;
}
export function resetAll(S) { Object.assign(S, emptyState()); return [{ t: 'reset' }]; }

// Adds/removes automatic milestones to match the monthly money. Returns newly added keys and ops.
export function syncAuto(S, today) {
  const hit = evalAuto(S.months); const added = [], ops = [];
  for (const e of EVENTS.filter(e => e.auto)) {
    if (hit[e.k] && !S.done[e.k]) { S.done[e.k] = { date: monthEnd(hit[e.k], today) }; added.push(e.k); ops.push({ t: 'record', k: e.k }); }
    else if (!hit[e.k] && S.done[e.k]) { delete S.done[e.k]; ops.push({ t: 'record', k: e.k }); }
  }
  return { added, ops };
}

// Ops that write the whole state (used when moving this device's records to the account).
export function allOps(S) {
  return [{ t: 'shop' },
    ...Object.keys(S.done).map(k => ({ t: 'record', k })),
    ...Object.keys(S.months).map(m => ({ t: 'month', m })),
    ...Object.keys(S.skip).map(k => ({ t: 'skip', k }))];
}
