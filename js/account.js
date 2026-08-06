// ════ アカウント設定（本人がパスワードを変える／忘れたときに再設定する） ════
//
// 安全のための決まりごと
//   ・パスワードを変えるときは、まず「いまのパスワード」で本人確認する
//     （席を離れた端末を触られても、勝手に変えられないようにするため）
//   ・変更したら、他の端末のログインは切る
//   ・再設定のメールは、そのアドレスが登録されているかどうかを画面に出さない
//     （どのアドレスが使われているかを外から調べられないようにするため）
//   ・パスワードそのものはアプリでは保存せず、Supabaseの認証だけが扱う

function openAccountSettings(){
  const info=document.getElementById('acct-info');
  const roleLabel={staff:'管理者', carpenter:'一般社員', supplier:'発注先'}[currentUserRole]||'—';
  sb.auth.getUser().then(({data})=>{
    const email=data?.user?.email||'—';
    info.innerHTML=`
      <div><span style="color:var(--text-muted)">お名前　</span><b>${esc(currentUserDisplayName||'—')}</b></div>
      <div><span style="color:var(--text-muted)">メール　</span>${esc(email)}</div>
      <div><span style="color:var(--text-muted)">区分　　</span>${roleLabel}</div>`;
  }).catch(()=>{ info.textContent=''; });
  ['acct-pass-now','acct-pass1','acct-pass2'].forEach(id=>{const el=document.getElementById(id); if(el) el.value='';});
  document.getElementById('account-modal').classList.add('open');
}
function closeAccountSettings(){
  document.getElementById('account-modal').classList.remove('open');
  ['acct-pass-now','acct-pass1','acct-pass2'].forEach(id=>{const el=document.getElementById(id); if(el) el.value='';});
}

async function changeMyPassword(){
  const now=document.getElementById('acct-pass-now').value;
  const p1=document.getElementById('acct-pass1').value;
  const p2=document.getElementById('acct-pass2').value;
  if(!now){ showToast('いまのパスワードを入れてください'); return; }
  if(p1.length<8){ showToast('新しいパスワードは8文字以上にしてください'); return; }
  if(p1!==p2){ showToast('新しいパスワードが一致しません'); return; }
  if(p1===now){ showToast('いまと同じパスワードは使えません'); return; }

  const btn=document.getElementById('acct-pass-btn');
  btn.disabled=true; btn.textContent='変更中…';
  try{
    // ① 本人確認：いまのパスワードで入り直せるか確かめる
    const { data:{ user } } = await sb.auth.getUser();
    const email=user?.email;
    if(!email) throw new Error('ログイン情報を確認できませんでした');
    const { error: authErr } = await sb.auth.signInWithPassword({email, password:now});
    if(authErr){ showToast('いまのパスワードが違います'); return; }

    // ② 新しいパスワードに変える
    const { error } = await sb.auth.updateUser({password:p1});
    if(error){ showToast('変更に失敗しました：'+error.message); return; }

    // ③ 他の端末のログインは切る（この端末はそのまま使える）
    try{ await sb.auth.signOut({scope:'others'}); }catch(_){}

    closeAccountSettings();
    showToast('パスワードを変更しました。他の端末では入り直してください');
  }catch(e){
    showToast('変更に失敗しました：'+(e?.message||e));
  }finally{
    btn.disabled=false; btn.textContent='パスワードを変更';
  }
}

// アカウント設定からログアウトする（設定の画面は閉じてから）
function logoutFromSettings(){
  closeAccountSettings();
  doLogout();
}

// ── パスワードを忘れたとき（ログイン前） ──
function openPasswordReset(){
  const em=document.getElementById('login-email')?.value.trim();
  document.getElementById('pwreset-email').value=em||'';
  const msg=document.getElementById('pwreset-msg');
  msg.style.display='none'; msg.textContent='';
  document.getElementById('pwreset-modal').classList.add('open');
  setTimeout(()=>document.getElementById('pwreset-email').focus(),100);
}
function closePasswordReset(){ document.getElementById('pwreset-modal').classList.remove('open'); }

async function sendPasswordReset(){
  const email=document.getElementById('pwreset-email').value.trim();
  const msg=document.getElementById('pwreset-msg');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
    msg.style.display='block'; msg.style.color='var(--danger)';
    msg.textContent='メールアドレスの形式をご確認ください';
    return;
  }
  const btn=document.getElementById('pwreset-btn');
  btn.disabled=true; btn.textContent='送信中…';
  // 戻り先はこのアプリ。メールのリンクを開くとパスワード設定の画面が出る
  const redirectTo = location.origin + location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  btn.disabled=false; btn.textContent='リンクを送る';

  msg.style.display='block';
  if(error && /rate|limit|too many/i.test(error.message||'')){
    msg.style.color='var(--warn-t)';
    msg.textContent='短い時間に何度も送信されています。しばらく待ってからお試しください';
    return;
  }
  // 登録の有無は出さない（どのアドレスが使われているかを知られないため）
  msg.style.color='var(--ok-t)';
  msg.innerHTML='メールをお送りしました。届いたリンクを開くと、新しいパスワードを設定できます。<br>'+
    '<span style="color:var(--text-muted)">届かない場合は迷惑メールをご確認ください。それでも届かないときは、きよかわの担当者にご連絡ください。</span>';
}
