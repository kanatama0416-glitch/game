// Screen: rendering, sheets and event handlers. Data changes go through state.js,
// saving goes through store.js. This file never talks to localStorage or Supabase directly.
import { EVENTS, CHAPTERS, CHAPTER_SCENES, ROOM_NAMES, BYK } from './events.js';
import {
  DATE_RE, MONTH_RE, todayStr, fmtDate, fmtMonth, dayLabel, headerDays,
  deadlineOf, dueText, dueClass, pendingEvents, curChapter, totals, parseYen,
} from './logic.js';
import * as st from './state.js';
import { createLocalStore, createRemoteStore } from './store.js';
import { createAuth } from './auth.js';
import { createGate } from './gate.js';
import { SUPABASE_URL, SUPABASE_KEY, LOCAL_KEY } from './config.js';

// ---------- small helpers ----------
const $ = id => document.getElementById(id);
const yen = n => '¥' + Math.round(n).toLocaleString('ja-JP');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function bindTap(nodes, fn) {
  nodes.forEach(el => {
    el.onclick = () => fn(el);
    el.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fn(el); } };
  });
}
function showErr(id, msg) { const el = $(id); el.textContent = msg; el.hidden = false; }
function safeStorage() {
  try { const s = window.localStorage; s.getItem('_'); return s; }
  catch { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }; }
}

// ---------- app state ----------
const local = createLocalStore(safeStorage(), LOCAL_KEY);
let S = st.emptyState();
let store = null;                // set after login; nothing is shown before that
let gate = null;
let auth = null, user = null;
const fresh = new Set();          // records to flash once in the history
const cheerQueue = [];            // celebrations waiting for the current sheet to close: event key or {chapter}
let lastChapter = null;           // chapter shown at the last render; null = don't celebrate the next change (fresh load)

// Saves the ops for a change that has already been applied to S, plus any automatic milestones.
async function commit(ops) {
  const auto = st.syncAuto(S, todayStr());
  auto.added.forEach(k => fresh.add(k));
  render();
  if (auto.added.length) queueCheer(auto.added);
  if (!store) return; // not logged in: the app is hidden, nothing to save
  try { await store.apply(S, [...ops, ...auto.ops]); }
  catch (e) {
    if (store.kind === 'remote') {
      toast('保存できませんでした。通信を確認して、もう一度試してね。');
      await reloadRemote();
    } else toast(e.message);
  }
}

// ---------- rendering ----------
function shopName() { return S.name || 'わたしの商店'; }

function render() {
  const today = todayStr();
  $('shopname').textContent = shopName();
  $('signText').textContent = shopName().slice(0, 8);
  $('days').innerHTML = headerDays(S, today);
  const c = curChapter(S);
  $('chapter').textContent = '第' + (c + 1) + '章 ' + CHAPTERS[c];
  const t = totals(S);
  $('sSales').textContent = $('mSalesT').textContent = yen(t.s);
  $('sExp').textContent = $('mExpT').textContent = yen(t.e);
  $('sProfit').textContent = $('mProfitT').textContent = yen(t.p);
  // data-k: shown when that event is done; data-any: shown when any of the listed events is done.
  document.querySelectorAll('.it').forEach(g => g.classList.toggle('on', (g.dataset.any || g.dataset.k).split(' ').some(k => S.done[k])));
  // Scene layers: shown while the current chapter is within data-from..data-to.
  document.querySelectorAll('.scene').forEach(g => g.classList.toggle('on', c >= Number(g.dataset.from) && c <= Number(g.dataset.to)));
  const cnt = Object.keys(S.done).length;
  $('roomhint').textContent = ROOM_NAMES[c] + '・もの ' + cnt + ' / ' + EVENTS.length;
  if (lastChapter !== null && c > lastChapter) queueCheer([{ chapter: c }]);
  lastChapter = c;

  const next = pendingEvents(S).slice(0, 3);
  $('events').innerHTML = next.length ? next.map(e => evCard(e, today)).join('') : '<p class="empty">用意した出来事はすべて記録しました。</p>';
  $('events').querySelectorAll('.ev').forEach(b => { b.onclick = () => openEvent(b.dataset.k); });

  const ms = Object.keys(S.months).sort().reverse();
  $('mlist').innerHTML = ms.length === 0 ? '<p class="empty">まだ記録した月はありません。上の欄から入れてね。</p>' : ms.map(m => `<div class="mrow" role="button" tabindex="0" data-m="${esc(m)}" aria-label="${esc(fmtMonth(m))}のお金を直す"><span class="num">${esc(fmtMonth(m))}</span><span class="num">売上 ${yen(S.months[m].s)} / 経費 ${yen(S.months[m].e)}</span></div>`).join('');
  bindTap($('mlist').querySelectorAll('.mrow'), el => openMonth(el.dataset.m));

  const hs = Object.entries(S.done).filter(([k]) => BYK[k]).sort((a, b) => a[1].date < b[1].date ? -1 : a[1].date > b[1].date ? 1 : 0);
  $('history').innerHTML = hs.length ? hs.map(([k, v]) => historyRow(k, v)).join('') : '<p class="empty">最初の出来事を記録すると、ここに年表ができていきます。</p>';
  bindTap($('history').querySelectorAll('.h'), el => openEdit(el.dataset.k));
  fresh.clear();
  renderTasks(today);
  renderSettings();
  renderAccount();
}

// やること: every event, grouped by chapter. The current chapter starts open.
function renderTasks(today) {
  const cur = curChapter(S);
  const manual = EVENTS.filter(e => !e.auto && !S.skip[e.k]);
  const doneCount = manual.filter(e => S.done[e.k]).length;
  $('tasksLead').textContent = `${manual.length}個のうち${doneCount}個が済みました。タップで説明や記録を開けます。`;
  $('tasks').innerHTML = CHAPTERS.map((name, c) => {
    const evs = EVENTS.filter(e => e.ch === c);
    const counted = evs.filter(e => !e.auto && !S.skip[e.k]);
    const n = counted.filter(e => S.done[e.k]).length;
    const pct = counted.length ? Math.round(n / counted.length * 100) : 100;
    return `<details class="chap${c === cur ? ' cur' : ''}"${c === cur ? ' open' : ''}>
      <summary><span class="chap-no">第${c + 1}章</span><span class="chap-name">${esc(name)}</span><span class="chap-count">${n} / ${counted.length}</span><span class="bar"><i style="width:${pct}%"></i></span></summary>
      <div class="tasklist">${evs.map(e => taskRow(e, today)).join('')}</div></details>`;
  }).join('');
  bindTap($('tasks').querySelectorAll('button.task'), el => (S.done[el.dataset.k] ? openEdit : openEvent)(el.dataset.k));
}
function taskRow(e, today) {
  const v = S.done[e.k];
  if (v) {
    const label = dayLabel(S, v.date);
    return `<button class="task st-done" data-k="${e.k}"><span class="ic" aria-hidden="true">${e.ic}</span><span class="tt"><span class="t">${esc(e.t)}</span><span class="s">${fmtDate(v.date)}${label ? '　' + label : ''}</span></span><span class="mark">✓</span></button>`;
  }
  if (e.auto) return `<div class="task st-auto"><span class="ic" aria-hidden="true">${e.ic}</span><span class="tt"><span class="t">${esc(e.t)}</span><span class="s">月のお金を入れると自動で記録</span></span><span class="mark">自動</span></div>`;
  if (S.skip[e.k]) return `<button class="task st-skip" data-k="${e.k}"><span class="ic" aria-hidden="true">${e.ic}</span><span class="tt"><span class="t">${esc(e.t)}</span><span class="s">関係ないにした出来事</span></span><span class="mark">対象外</span></button>`;
  const dl = deadlineOf(S, e.k, today);
  const sub = dl ? `<span class="${dueClass(dl)}">${esc(dueText(dl))}</span>` : (e.opt ? `<span class="s">${esc(e.opt)}</span>` : '');
  return `<button class="task st-todo" data-k="${e.k}"><span class="ic" aria-hidden="true">${e.ic}</span><span class="tt"><span class="t">${esc(e.t)}</span>${sub}</span><span class="mark">›</span></button>`;
}

// 設定: fills the shop form unless the user is typing in it.
function renderSettings() {
  if (!$('setForm').contains(document.activeElement)) { $('sName').value = S.name; $('sStart').value = S.start; }
  const ks = Object.keys(S.skip).filter(k => BYK[k]);
  $('skippedBox').innerHTML = ks.length ? `<h2>関係ないにした出来事</h2><div class="month"><div class="check">${ks.map(k => `<div><span>${esc(BYK[k].t)}</span><button type="button" class="linkbtn" data-unskip="${k}">戻す</button></div>`).join('')}</div></div>` : '';
  document.querySelectorAll('[data-unskip]').forEach(b => { b.onclick = () => commit(st.unskipEvent(S, b.dataset.unskip)); });
  $('resetLead').textContent = 'にゃちまる商店の記録と数字をすべて消します。元には戻せません。家計簿のデータは消えません。';
}

// ---------- tabs ----------
const TABS = ['home', 'tasks', 'money', 'history', 'settings'];
function showTab(name) {
  if (!TABS.includes(name)) name = 'home';
  for (const t of TABS) {
    $('tab-' + t).hidden = t !== name;
    $('t-' + t).setAttribute('aria-selected', String(t === name));
    $('t-' + t).tabIndex = t === name ? 0 : -1;
  }
  window.scrollTo(0, 0);
}

function evCard(e, today) {
  const dl = deadlineOf(S, e.k, today);
  const due = dl ? `<span class="${dueClass(dl)}">${esc(dueText(dl))}</span>` : '';
  return `<button class="ev" data-k="${e.k}"><span class="ic" aria-hidden="true">${e.ic}</span><span><span class="t">${esc(e.rec)}</span><span class="s">${esc(e.t)}　·　第${e.ch + 1}章 ${CHAPTERS[e.ch]}</span>${due}</span><span class="go" aria-hidden="true">›</span></button>`;
}
function historyRow(k, v) {
  const e = BYK[k];
  return `<div class="h${fresh.has(k) ? ' fresh' : ''}" role="button" tabindex="0" data-k="${k}" aria-label="「${esc(e.done)}」の記録を直す"><div class="d">${fmtDate(v.date)}<em>${dayLabel(S, v.date)}</em></div><div class="ti">${esc(e.done)}${v.amount != null ? `<span class="amt">${yen(v.amount)}</span>` : ''}</div>${v.memo ? `<div class="memo">${esc(v.memo)}</div>` : ''}</div>`;
}

function renderAccount() {
  const el = $('account');
  if (!user) { el.innerHTML = ''; return; }
  el.innerHTML = `<p><b>${esc(user.email)}</b> でログイン中。家計簿と同じアカウントです。<br>ログアウトすると、この端末の家計簿からもログアウトします。</p><button class="btn ghost" id="logoutBtn">ログアウト</button>`;
  $('logoutBtn').onclick = async () => {
    try { await auth.signOut(); } catch { toast('ログアウトできませんでした。もう一度試してね。'); return; }
    leave('ログアウトしました。');
  };
}

// ---------- sheets ----------
function sheet(html) {
  $('layer').innerHTML = `<div class="veil" id="veil"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  $('veil').onclick = e => { if (e.target.id === 'veil') close(); };
}
function close() { $('layer').innerHTML = ''; showNextCheer(); }
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 5000);
}

// Record form, shared by "できた！" and edit.
function recordFields(k, rec) {
  const e = BYK[k];
  return `${k === 'yago' ? `<div class="field"><label for="fName">屋号</label><input id="fName" required maxlength="20" value="${esc(S.name)}" placeholder="例：かな商店"></div>` : ''}
    <div class="field"><label for="fDate">${k === 'opendate' ? '開業日' : '記録する日'}</label><input type="date" id="fDate" required value="${esc(rec.date || '')}"></div>
    ${e.amount ? `<div class="field"><label for="fAmt">金額（円・任意）</label><input type="number" id="fAmt" min="0" step="1" inputmode="numeric" value="${rec.amount != null ? rec.amount : ''}"></div>` : ''}
    <div class="field"><label for="fMemo">ひとことメモ（任意）</label><input id="fMemo" maxlength="80" placeholder="今日のこと、ひとこと" value="${esc(rec.memo || '')}"></div>
    <p class="err" id="fErr" hidden></p>`;
}
function readRecordForm(k) {
  const date = $('fDate').value;
  if (!DATE_RE.test(date)) return { err: '日付を入れてください。' };
  const rec = { date };
  if ($('fAmt')) {
    const a = parseYen($('fAmt').value, { optional: true });
    if (Number.isNaN(a)) return { err: '金額は0以上の整数で入れてください。' };
    if (a != null) rec.amount = a;
  }
  const m = $('fMemo').value.trim(); if (m) rec.memo = m.slice(0, 80);
  const extra = {};
  if (k === 'yago') { const nm = $('fName').value.trim(); if (!nm) return { err: '屋号を入れてください。' }; extra.name = nm.slice(0, 20); }
  return { rec, extra };
}

function openEvent(k, step = 0) {
  const e = BYK[k];
  const steps = ['なぜ必要？', 'どうやる？', 'できた！'].map((s, i) => `<span class="${i === step ? 'cur' : i < step ? 'done' : ''}">${s}</span>`).join('');
  const dl = deadlineOf(S, k, todayStr());
  const dueBox = dl ? `<div class="duebox"><span class="${dueClass(dl)}">${esc(dueText(dl))}</span><small>${esc(dl.note)}。日付は目安なので、正確な期限は窓口の案内で確認してね。</small></div>` : '';
  const optNote = S.skip[k] ? '<p class="warn">関係ないにした出来事です。記録すると、対象に戻ります。</p>' : e.opt ? `<p class="warn">${esc(e.opt)}の出来事です。</p>` : '';
  const skipBtn = S.skip[k] ? '<button class="btn ghost left" id="unskip">対象に戻す</button>' : e.opt ? '<button class="btn ghost left" id="skip">自分には関係ない</button>' : '';
  let body = '';
  if (step === 0) body = `<p>${esc(e.why)}</p>${optNote}${dueBox}<div class="acts">${skipBtn}<button class="btn ghost" id="x">あとで</button><button class="btn" id="nx">どうやる？</button></div>`;
  if (step === 1) body = `<ul>${e.how.map(h => `<li>${esc(h)}</li>`).join('')}</ul><div class="acts"><button class="btn ghost" id="bk">戻る</button><button class="btn" id="nx">できた！</button></div>`;
  if (step === 2) body = `<form id="doneForm" novalidate class="sheetform">
    ${recordFields(k, { date: k === 'opendate' && S.start ? S.start : todayStr() })}
    <div class="acts"><button type="button" class="btn ghost" id="bk">戻る</button><button class="btn" type="submit">記録する</button></div></form>`;
  sheet(`<div class="sheeticon" aria-hidden="true">${e.ic}</div><h3>${esc(e.t)}</h3><div class="steps">${steps}</div>${body}`);
  $('x') && ($('x').onclick = close);
  $('skip') && ($('skip').onclick = () => { const ops = st.skipEvent(S, k); close(); commit(ops); });
  $('unskip') && ($('unskip').onclick = () => { const ops = st.unskipEvent(S, k); close(); commit(ops); });
  $('nx') && ($('nx').onclick = () => openEvent(k, step + 1));
  $('bk') && ($('bk').onclick = () => openEvent(k, step - 1));
  const f = $('doneForm');
  if (f) f.onsubmit = ev => {
    ev.preventDefault();
    const r = readRecordForm(k); if (r.err) return showErr('fErr', r.err);
    const ops = st.applyRecord(S, k, r.rec, r.extra);
    fresh.add(k);
    $('layer').innerHTML = '';
    queueCheer([k]);
    commit(ops);
  };
}

function openEdit(k, confirmDel) {
  const e = BYK[k], rec = S.done[k]; if (!e || !rec) return;
  if (confirmDel) {
    sheet(`<h3>「${esc(e.done)}」の記録を取り消しますか？</h3><p class="warn">年表と部屋から消えて、「${esc(e.t)}」は次の出来事に戻ります。</p>
      <div class="acts"><button class="btn ghost" id="x">やめる</button><button class="btn" id="doDel">取り消す</button></div>`);
    $('x').onclick = () => openEdit(k);
    $('doDel').onclick = () => { const ops = st.removeRecord(S, k); close(); commit(ops); };
    return;
  }
  sheet(`<div class="sheeticon" aria-hidden="true">${e.ic}</div><h3>${esc(e.done)}</h3>
    <form id="editForm" novalidate class="sheetform">${recordFields(k, rec)}
    ${e.auto ? '<p class="warn">売上から自動でついた記録です。日付とメモを直せます。</p>' : ''}
    <div class="acts">${e.auto ? '' : '<button type="button" class="btn ghost left" id="toDel">取り消す</button>'}<button type="button" class="btn ghost" id="x">キャンセル</button><button class="btn" type="submit">保存</button></div></form>`);
  $('x').onclick = close;
  $('toDel') && ($('toDel').onclick = () => openEdit(k, true));
  $('editForm').onsubmit = ev => {
    ev.preventDefault();
    const r = readRecordForm(k); if (r.err) return showErr('fErr', r.err);
    const ops = st.applyRecord(S, k, r.rec, r.extra); close(); commit(ops);
  };
}

function openMonth(m, confirmDel) {
  const v = S.months[m]; if (!v) return;
  if (confirmDel) {
    sheet(`<h3>${esc(fmtMonth(m))} のお金を消しますか？</h3><p class="warn">この月の売上と経費が消え、累計も変わります。</p>
      <div class="acts"><button class="btn ghost" id="x">やめる</button><button class="btn" id="doDel">消す</button></div>`);
    $('x').onclick = () => openMonth(m);
    $('doDel').onclick = () => { const ops = st.removeMonth(S, m); close(); commit(ops); };
    return;
  }
  sheet(`<h3>${esc(fmtMonth(m))} のお金</h3>
    <form id="mEdit" novalidate class="sheetform"><div class="row">
      <div class="field"><label for="eSales">売上（円）</label><input type="number" id="eSales" min="0" step="1" inputmode="numeric" value="${v.s}"></div>
      <div class="field"><label for="eExp">経費（円）</label><input type="number" id="eExp" min="0" step="1" inputmode="numeric" value="${v.e}"></div></div>
      <p class="err" id="fErr" hidden></p>
      <div class="acts"><button type="button" class="btn ghost left" id="toDel">この月を消す</button><button type="button" class="btn ghost" id="x">キャンセル</button><button class="btn" type="submit">保存</button></div></form>`);
  $('x').onclick = close;
  $('toDel').onclick = () => openMonth(m, true);
  $('mEdit').onsubmit = ev => {
    ev.preventDefault();
    const s = parseYen($('eSales').value), x = parseYen($('eExp').value);
    if (Number.isNaN(s) || Number.isNaN(x)) return showErr('fErr', '金額は0以上の整数で入れてください。');
    const ops = st.setMonth(S, m, { s, e: x }); close(); commit(ops);
  };
}

function openNow() {
  const c = curChapter(S); const list = EVENTS.filter(e => e.ch === c);
  const next = pendingEvents(S)[0];
  const mark = e => S.done[e.k] ? ['ok', '✓'] : S.skip[e.k] ? ['no', '対象外'] : e.auto ? ['no', '自動'] : ['no', '未'];
  sheet(`<h3>今の${esc(shopName())}</h3><div class="steps"><span class="cur">第${c + 1}章 ${CHAPTERS[c]}</span></div>
   <div class="check">${list.map(e => { const [cls, t] = mark(e); return `<div><span>${esc(e.t)}</span><span class="${cls}">${t}</span></div>`; }).join('')}</div>
   ${next ? `<div class="reco">次は「<b>${esc(next.rec)}</b>」のがおすすめ。</div><div class="acts"><button class="btn ghost" id="x">閉じる</button><button class="btn" id="go">${esc(next.ic)} はじめる</button></div>` : '<p>用意した出来事はすべて記録しました。</p><div class="acts"><button class="btn" id="x">閉じる</button></div>'}`);
  $('x').onclick = close; $('go') && ($('go').onclick = () => openEvent(next.k));
}

function openReset() {
  const warn = 'にゃちまる商店の記録と数字がすべて消えます。元には戻せません。家計簿のデータは消えません。';
  sheet(`<h3>まっさらから始めますか？</h3><p class="warn">${warn}</p><div class="acts"><button class="btn ghost" id="x">やめる</button><button class="btn" id="doReset">まっさらにする</button></div>`);
  $('x').onclick = close;
  $('doReset').onclick = () => { const ops = st.resetAll(S); close(); commit(ops); showTab('home'); };
}
$('setForm').onsubmit = ev => {
  ev.preventDefault();
  const name = $('sName').value.trim().slice(0, 20), start = $('sStart').value;
  if (start && !DATE_RE.test(start)) return showErr('sErr', '開業日を正しく入れてください。');
  $('sErr').hidden = true;
  document.activeElement.blur();
  commit(st.setShop(S, name, start));
  toast('保存しました。');
};

// ---------- celebrations ----------
function queueCheer(keys) { cheerQueue.push(...keys); if (!$('layer').innerHTML) showNextCheer(); }
function showNextCheer() {
  const k = cheerQueue.shift(); if (!k) return;
  if (typeof k === 'object') return showChapterCheer(k.chapter);
  const e = BYK[k], v = S.done[k]; if (!e || !v) return showNextCheer();
  const label = dayLabel(S, v.date);
  const colors = ['--accent', '--sticker', '--pink', '--leaf'];
  const conf = Array.from({ length: 28 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:var(${colors[i % 4]});animation-delay:${Math.random() * 0.4}s"></i>`).join('');
  $('layer').innerHTML = `<div class="confetti">${conf}</div><div class="cele" id="cele"><div class="card" role="dialog" aria-modal="true">
    <div class="stamp"><span class="e" aria-hidden="true">${e.ic}</span><span class="n">${fmtDate(v.date)}</span></div>
    <h4>${esc(e.done)}</h4><p>${esc(e.msg)}</p>
    ${label ? `<p class="num cele-day">${label}の出来事</p>` : ''}
    <button class="btn" id="ok">年表に残す</button></div></div>`;
  $('ok').focus();
  $('ok').onclick = close;
}

function showChapterCheer(c) {
  $('layer').innerHTML = `<div class="cele" id="cele"><div class="card" role="dialog" aria-modal="true">
    <div class="stamp chapstamp"><span class="e">第${c + 1}章</span><span class="n">CHAPTER</span></div>
    <h4>${esc(CHAPTERS[c])}へ</h4><p>部屋の模様替えをしました。${esc(CHAPTER_SCENES[c])}</p>
    <button class="btn" id="ok">部屋を見る</button></div></div>`;
  $('ok').focus();
  $('ok').onclick = () => { close(); showTab('home'); };
}

// Moving this device's records to a new account (only when the account is still empty).
function offerImport(localState) {
  sheet(`<h3>この端末の記録を移しますか？</h3><p>この端末に保存している記録を、ログインしたアカウントに移します。移すと、スマホとPCで同じ記録を使えます。</p>
    <div class="acts"><button class="btn ghost" id="x">移さない</button><button class="btn" id="doImport">移す</button></div>`);
  $('x').onclick = close;
  $('doImport').onclick = async () => {
    $('doImport').disabled = true;
    S = localState; lastChapter = null;
    try { await store.apply(S, st.allOps(S)); close(); render(); toast('この端末の記録を移しました。'); }
    catch { close(); toast('移せませんでした。通信を確認して、もう一度ログインし直してね。'); await reloadRemote(); }
  };
}

// ---------- modes ----------
// Back to the entrance (logout, session ended).
function leave(text) {
  user = null; store = null; lastChapter = null;
  S = st.emptyState(); render();
  if (gate) gate.show('login', text ?? '', true);
}
async function enterRemote(u) {
  user = u; store = createRemoteStore(auth.client, u.id);
  $('days').textContent = '記録を読み込んでいます…';
  const ok = await reloadRemote();
  if (!ok) return;
  const localState = local.load();
  if (!st.hasUserData(S) && localState && st.hasUserData(localState)) offerImport(localState);
}
async function reloadRemote() {
  lastChapter = null;
  try { S = await store.load(); render(); return true; }
  catch {
    S = st.emptyState(); render();
    toast('記録を読み込めませんでした。通信を確認して、ページを開き直してね。');
    return false;
  }
}

// ---------- start ----------
$('monthForm').onsubmit = ev => {
  ev.preventDefault();
  const m = $('mMonth').value;
  const s = parseYen($('mSales').value), x = parseYen($('mExp').value);
  if (!MONTH_RE.test(m)) return showErr('mErr', '月を選んでください。');
  if (Number.isNaN(s) || Number.isNaN(x)) return showErr('mErr', '金額は0以上の整数で入れてください。');
  $('mErr').hidden = true;
  const ops = st.setMonth(S, m, { s, e: x });
  $('mSales').value = ''; $('mExp').value = '';
  commit(ops);
};
$('mMonth').value = todayStr().slice(0, 7);
$('nowBtn').onclick = openNow;
$('shopname').onclick = () => showTab('settings');
$('toReset').onclick = openReset;
document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
document.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => showTab(b.dataset.go); });
// Arrow keys move between tabs (standard tablist behavior).
$('t-home').parentElement.addEventListener('keydown', e => {
  const i = TABS.findIndex(t => $('t-' + t).getAttribute('aria-selected') === 'true');
  const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
  const next = TABS[(i + d + TABS.length) % TABS.length]; showTab(next); $('t-' + next).focus();
});
showTab('home');
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('cele')) close(); });

async function start() {
  render();
  auth = createAuth(window.supabase, SUPABASE_URL, SUPABASE_KEY);
  gate = auth && createGate({ $, auth, onAllowed: enterRemote });
  if (!auth) {
    // Without the login library nothing can be shown safely; keep the entrance up.
    $('gate').hidden = false; $('app').hidden = true;
    $('gateMsg').textContent = 'ログイン機能を読み込めませんでした。通信を確認して、ページを開き直してね。';
    document.querySelectorAll('#gate button').forEach(b => { b.disabled = true; });
    return;
  }
  const recovery = /(?:[?#&])type=recovery(?:[&#]|$)/.test(location.hash + location.search);
  auth.onChange((event) => {
    if (event === 'PASSWORD_RECOVERY') gate.show('recovery', '新しいパスワードを設定してね。');
    if (event === 'SIGNED_OUT' && user) leave('ログアウトしました。');
  });
  let session = null;
  try { session = await auth.session(); } catch { /* treated as logged out */ }
  if (session && recovery) gate.show('recovery', '新しいパスワードを設定してね。');
  else if (session) await gate.admit(session);
  else gate.show('login');
}
start();

// Exposed for tests only.
window.__app = { get S() { return S; }, get store() { return store; }, get user() { return user; }, render };
