// Pure functions: dates, deadlines, progress and money. No DOM, no storage.
// Every function that needs app data takes the state `S` as an argument.
import { EVENTS, CHAPTERS } from './events.js';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---------- dates ----------
export function ymd(x) {
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
export function todayStr() { return ymd(new Date()); }
export function addDays(d, n) { const x = new Date(d + 'T00:00'); x.setDate(x.getDate() + n); return ymd(x); }
export function addMonths(d, n) {
  const x = new Date(d + 'T00:00'), day = x.getDate();
  x.setMonth(x.getMonth() + n);
  if (x.getDate() < day) x.setDate(0); // e.g. 12-31 + 2 months → 02-28
  return ymd(x);
}
// Days counted from `from` (day 1 = that date).
export function daysSince(from, date) {
  if (!from || !date) return null;
  const a = new Date(from + 'T00:00'), b = new Date(date + 'T00:00');
  return Math.round((b - a) / 864e5) + 1;
}
export function monthEnd(m, today) {
  const end = new Date(m + '-01T00:00'); end.setMonth(end.getMonth() + 1); end.setDate(0);
  const d = ymd(end);
  return d > today ? today : d;
}
export function fmtDate(d) { return d.replace(/-/g, '.'); }
export function fmtMonth(m) { return m.replace('-', '.'); }

// ---------- day counters ----------
export function quitDate(S) { return S.done.taishoku ? S.done.taishoku.date : ''; }
export function dayN(S, date) { return daysSince(S.start, date); }
// 開業N日目 from the opening day, 準備N日目 from the day you left your job.
export function dayLabel(S, date) {
  const open = dayN(S, date); if (open != null && open >= 1) return '開業' + open + '日目';
  const prep = daysSince(quitDate(S), date); if (prep != null && prep >= 1) return '準備' + prep + '日目';
  return '';
}
// Header line under the shop name. Returns markup built from numbers only (safe for innerHTML).
export function headerDays(S, today) {
  const open = dayN(S, today);
  if (open != null && open >= 1) return '開業 <b>' + open + '</b> 日目';
  const prep = daysSince(quitDate(S), today);
  const left = open != null ? '開業まで あと <b>' + (1 - open) + '</b> 日' : '';
  if (prep != null && prep >= 1) return '準備 <b>' + prep + '</b> 日目' + (left ? '<span class="until">' + left + '</span>' : '');
  if (left) return left;
  return '会社を辞めた日から、準備期を数えはじめます';
}

// ---------- deadlines ----------
// Dates are guides; weekends/holidays may push the real deadline later.
export const DEADLINES = {
  nenkin: { base: 'quit', calc: q => addDays(q, 14), note: '退職日の翌日から14日以内' },
  kenpo: { base: 'quit', calc: q => addDays(q, 14), note: '国民健康保険は14日以内（任意継続にする場合は資格喪失日から20日以内）' },
  kenzei: { base: 'start', calc: s => addMonths(s, 1), note: '石川県は開業後1か月以内' },
  aoiro: { base: 'start', calc: s => s.slice(5) >= '01-16' ? addMonths(s, 2) : s.slice(0, 4) + '-03-15', note: '1月16日以後の開業は開業日から2か月以内（それより前は3月15日まで）' },
  kaigyo: { base: 'start', calc: s => (Number(s.slice(0, 4)) + 1) + '-03-15', note: '開業した年の確定申告期限まで' },
};
// {date, left, note} when computable; {need:'quit'|'start', note} when the base date is missing; null when no deadline.
export function deadlineOf(S, k, today) {
  const d = DEADLINES[k]; if (!d) return null;
  const base = d.base === 'quit' ? quitDate(S) : S.start;
  if (!base || !DATE_RE.test(base)) return { need: d.base, note: d.note };
  const date = d.calc(base);
  return { date, left: daysSince(today, date) - 1, note: d.note };
}
export function dueText(dl) {
  if (!dl) return '';
  if (dl.need) return (dl.need === 'quit' ? '退職日' : '開業日') + 'を記録すると期限がわかります';
  if (dl.left < 0) return '期限 ' + fmtDate(dl.date) + '（過ぎています）';
  return '期限 ' + fmtDate(dl.date) + '・' + (dl.left === 0 ? '今日まで' : 'あと' + dl.left + '日');
}
export function dueClass(dl) { return dl && !dl.need && dl.left <= 7 ? 'due urgent' : 'due'; }

// ---------- progress ----------
// Manual events still to do: not done, not marked 関係ない. Sorted by chapter, then list order.
export function pendingEvents(S) {
  return EVENTS.filter(e => !e.auto && !S.done[e.k] && !S.skip[e.k]).sort((a, b) => a.ch - b.ch);
}
export function curChapter(S) { const p = pendingEvents(S); return p.length ? p[0].ch : CHAPTERS.length - 1; }

// ---------- money ----------
export function totals(S) {
  let s = 0, e = 0;
  for (const m of Object.values(S.months)) { s += m.s || 0; e += m.e || 0; }
  return { s, e, p: s - e };
}
// Which automatic milestones are reached, and in which month.
export function evalAuto(months) {
  const ms = Object.keys(months).sort(); let cum = 0, streak = 0; const hit = {};
  const set = (k, m) => { if (!hit[k]) hit[k] = m; };
  for (const m of ms) {
    const v = months[m]; cum += v.s || 0; streak = ((v.s || 0) - (v.e || 0)) > 0 ? streak + 1 : 0;
    if (cum >= 100000) set('sales10', m);
    if (cum >= 1000000) set('y100', m);
    if (cum >= 3000000) set('y300', m);
    if (streak >= 3) set('black3', m);
  }
  return hit;
}

// ---------- input ----------
// '' → 0 (or null when optional). Returns NaN when invalid.
export function parseYen(str, { optional } = {}) {
  const s = String(str ?? '').trim();
  if (s === '') return optional ? null : 0;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}
