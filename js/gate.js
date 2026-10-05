// Entrance screen, same flow as 家計簿: log in with email + password, set a password the
// first time, reset a forgotten password. The app stays hidden until the database says
// the logged-in email is on にゃちまる商店's allowlist.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PANELS = ['login', 'setup', 'recovery'];

export function createGate({ $, auth, onAllowed }) {
  const here = () => location.origin + location.pathname;

  function msg(text, ok) {
    $('gateMsg').textContent = text || '';
    $('gateMsg').classList.toggle('ok', !!ok);
  }
  function busy(on) { document.querySelectorAll('#gate button').forEach(b => { b.disabled = on; }); }

  // Shows the entrance (app hidden) with one panel.
  function show(panel, text, ok) {
    $('gate').hidden = false; $('app').hidden = true;
    for (const p of PANELS) $('gate-' + p).hidden = p !== panel;
    busy(false);
    if (text !== undefined) msg(text, ok);
  }
  function disable(text) { show('login', text); busy(true); }

  // Called with a session: lets the user in only when the allowlist says yes.
  async function admit(session) {
    busy(true); msg('確認しています…');
    let allowed = false;
    try { allowed = await auth.checkAccess(); }
    catch { show('login', '確認できませんでした。通信を確認して、もう一度試してね。'); return; }
    if (!allowed) {
      try { await auth.signOut(); } catch { /* already logged out */ }
      show('login', 'このメールアドレスでは、にゃちまる商店に入れません。');
      return;
    }
    msg('');
    $('gate').hidden = true; $('app').hidden = false;
    await onAllowed(session.user);
  }

  $('gateLoginForm').onsubmit = async ev => {
    ev.preventDefault();
    const email = $('gEmail').value.trim(), password = $('gPassword').value;
    if (!EMAIL_RE.test(email) || !password) return msg('メールアドレスとパスワードを入れてね。');
    busy(true); msg('ログインしています…');
    let session;
    try { session = (await auth.signIn(email, password)).session; }
    catch { show('login', 'メールアドレスまたはパスワードが違います。'); return; }
    await admit(session);
  };

  $('gToSetup').onclick = () => { $('gsEmail').value = $('gEmail').value.trim(); show('setup', ''); };
  $('gBack').onclick = () => show('login', '');

  $('gateSetupForm').onsubmit = async ev => {
    ev.preventDefault();
    const email = $('gsEmail').value.trim(), p1 = $('gsPassword').value, p2 = $('gsPassword2').value;
    if (!EMAIL_RE.test(email)) return msg('メールアドレスを正しく入れてね。');
    if (p1.length < 8) return msg('パスワードは8文字以上にしてね。');
    if (p1 !== p2) return msg('確認用のパスワードが一致しません。');
    busy(true); msg('送っています…');
    try { await auth.signUp(email, p1, here()); }
    catch { show('setup', '設定できませんでした。許可されたメールアドレスか確認してね。'); return; }
    $('gEmail').value = email;
    show('login', '確認メールを送りました。メールのリンクを開いてから、ログインしてね。', true);
  };

  $('gForgot').onclick = async () => {
    const email = $('gEmail').value.trim();
    if (!EMAIL_RE.test(email)) return msg('先にメールアドレスを入れてから押してね。');
    busy(true);
    try { await auth.sendReset(email, here()); show('login', 'パスワード再設定のメールを送りました。メールのリンクを開いてね。', true); }
    catch { show('login', '送れませんでした。少し時間をおいて、もう一度試してね。'); }
  };

  $('gateRecoveryForm').onsubmit = async ev => {
    ev.preventDefault();
    const p1 = $('grPassword').value, p2 = $('grPassword2').value;
    if (p1.length < 8) return msg('パスワードは8文字以上にしてね。');
    if (p1 !== p2) return msg('確認用のパスワードが一致しません。');
    busy(true);
    try { await auth.updatePassword(p1); }
    catch { show('recovery', '変更できませんでした。もう一度メールのリンクから開き直してね。'); return; }
    history.replaceState(null, '', here());
    await admit(await auth.session());
  };

  return { show, admit, disable };
}
