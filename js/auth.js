// ════ 認証（ログイン・ログアウト・権限の読み込み） ════

async function doLogin(){
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errEl.style.display='none';
  if(!email||!password){errEl.textContent='メールアドレスとパスワードを入力してください';errEl.style.display='block';return;}

  btn.disabled = true; btn.textContent = 'ログイン中…';
  const { error } = await sb.auth.signInWithPassword({email,password});
  btn.disabled = false; btn.textContent = 'ログイン';

  if(error){
    errEl.textContent = 'ログインに失敗しました：メールアドレスまたはパスワードが正しくありません';
    errEl.style.display='block';
    return;
  }
  await bootstrapApp();
}

async function doLogout(){
  await sb.auth.signOut();
  location.reload();
}

async function bootstrapApp(){
  const { data: sessionData } = await sb.auth.getSession();
  if(!sessionData.session){
    document.getElementById('login-overlay').classList.add('open');
    return;
  }

  const { data: profile, error: profErr } = await sb.from('profiles').select('*').eq('id',sessionData.session.user.id).single();
  if(profErr || !profile){
    document.getElementById('login-error').textContent = 'このアカウントには権限が設定されていません。管理者に連絡してください。';
    document.getElementById('login-error').style.display='block';
    document.getElementById('login-overlay').classList.add('open');
    await sb.auth.signOut();
    return;
  }

  currentUserRole = profile.role;
  currentUserSupplierId = profile.supplier_id;
  currentUserDisplayName = profile.display_name || sessionData.session.user.email;

  document.body.classList.remove('role-staff','role-supplier');
  document.body.classList.add('role-'+currentUserRole);

  try{
    await fetchAllData();
  }catch(e){
    alert('データの取得に失敗しました：'+e.message);
    return;
  }

  document.getElementById('login-overlay').classList.remove('open');
  document.getElementById('app-shell').style.display='';
  document.getElementById('app-nav').style.display='';

  if(currentUserRole==='staff'){
    newEstimate();
    renderSupplierSelectList();
    mainTab('estimate');
  } else {
    // 発注先ロール：品目マスタ（自社品目の単価編集）のみ表示
    mainTab('order');
    orderSubTab('master');
  }

  subscribeRealtime();
}

// 初回読み込み時：既存セッションがあれば自動ログイン
(async ()=>{
  await bootstrapApp();
})();
