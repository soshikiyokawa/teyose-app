// ════ アカウント権限（管理者専用：各アカウントの権限を設定） ════
// 権限は role にマップ：管理者＝staff／一般社員＝carpenter／業者＝supplier
// RLSは role（staff/carpenter/supplier）で判定しているため、DBの値は role のまま保持する。

// 権限の呼び名。お客様（client）も名前を持たせておく。
// 持たせていなかったため、アカウント権限の一覧でお客様が「管理者」と表示されていた
// （どの選択肢にも当てはまらず、いちばん上が選ばれて見えていた）。
const PERM_LABELS = { staff:'管理者', carpenter:'一般社員', supplier:'業者', client:'お客様' };
const roleLabel = r => PERM_LABELS[r] || r || '（未設定）';

// 「アカウント権限」の画面で選べるのは、社員と業者だけ。
// お客様はここから選べないようにしてある（うっかり社員をお客様にしたり、
// お客様を管理者にしたりしないように）。お客様は専用の画面で扱う
const PERM_OPTIONS = [['staff','管理者'],['carpenter','一般社員'],['supplier','業者']];

// お客様のアカウントか
const isClientProfile = p => p?.role === 'client';

function openAccountPerms(){
  if(currentUserRole!=='staff') return;
  document.getElementById('acct-modal').classList.add('open');
  // 招待フォームの発注先プルダウンを最新化
  const supSel=document.getElementById('inv-supplier');
  if(supSel) supSel.innerHTML='<option value="">発注先を選択…</option>'
    + suppliers.filter(s=>s.name!=='在庫分').map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
  invRoleChanged();
  renderAccountPerms();
}

// 招待フォーム：権限に応じて発注先／勤怠区分の欄を出し分け
function invRoleChanged(){
  const role=document.getElementById('inv-role')?.value;
  if(!role) return;
  document.getElementById('inv-supplier-wrap').style.display = role==='supplier' ? '' : 'none';
  document.getElementById('inv-group-wrap').style.display = role==='supplier' ? 'none' : '';
}

// アカウント追加（メール招待）
async function inviteAccount(){
  const email=document.getElementById('inv-email').value.trim();
  const displayName=document.getElementById('inv-name').value.trim();
  const role=document.getElementById('inv-role').value;
  const supplierId=Number(document.getElementById('inv-supplier').value)||null;
  const workGroup=document.getElementById('inv-group').value;
  if(!email){ showToast('メールアドレスを入力してください'); return; }
  if(!displayName){ showToast('表示名（氏名）を入力してください'); return; }
  if(role==='supplier' && !supplierId){ showToast('発注先を選択してください'); return; }
  const btn=document.getElementById('inv-btn');
  btn.disabled=true; btn.textContent='送信中…';
  let res=null;
  try{
    res = await dbInviteUser({email, displayName, role, supplierId, workGroup});
  }catch(e){
    btn.disabled=false; btn.textContent='招待メールを送信';
    return;
  }
  btn.disabled=false; btn.textContent='招待メールを送信';
  document.getElementById('inv-email').value='';
  document.getElementById('inv-name').value='';
  showToast(res?.attached
    ? `${displayName}さんに招待メールを送信しました（登録マニュアルを添付）`
    : `${displayName}さんに招待メールを送信しました`);
  if(res?.note) setTimeout(()=>alert(res.note), 400);
  try{ await fetchProfiles(); }catch(e){} // allProfilesを取り直して一覧に反映
  renderAccountScreens();
}
function closeAccountPerms(){ document.getElementById('acct-modal').classList.remove('open'); }

// どちらの画面が開いていても、内容がそろうように両方作り直す
function renderAccountScreens(){ renderAccountPerms(); renderClientAccounts(); }

function renderAccountPerms(){
  const el=document.getElementById('acct-list');
  // お客様はこの画面では扱わない（専用の「お客様アカウント」画面へ）
  const all = allProfiles.filter(p=>!isClientProfile(p));
  if(!all.length){ el.innerHTML='<div class="empty" style="padding:12px">アカウントがありません</div>'; return; }
  // 並び順：社員（指定の固定順）→ 業者。社員内は EMPLOYEE_ORDER、業者は末尾に名前順
  const rank = p => p.role==='supplier' ? 1 : 0;
  const cmpName = (typeof cmpEmployee==='function')
    ? cmpEmployee
    : (a,b)=>String(a).localeCompare(String(b),'ja');
  const list = all.slice().sort((a,b)=> rank(a)-rank(b) || cmpName(a.displayName||'', b.displayName||''));
  el.innerHTML=list.map(p=>{
    const isSelf=p.id===currentUserId;
    // 業者のときだけ所属発注先を選ばせる（在庫分は除く）
    const supSel = p.role==='supplier'
      ? `<div style="flex-basis:100%;margin-top:4px">
          <select onchange="acctSetSupplier('${p.id}',this.value)" style="font-size:12px;padding:4px 6px;width:100%">
            <option value="">発注先を選択…</option>
            ${suppliers.filter(s=>s.name!=='在庫分').map(s=>`<option value="${s.id}"${p.supplierId===s.id?' selected':''}>${esc(s.name)}</option>`).join('')}
          </select>
        </div>` : '';
    return `<div class="wc-assign-row" style="flex-wrap:wrap">
      <span style="flex:1;min-width:110px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.displayName||'（名前未設定）')}${isSelf?'<span style="font-size:10px;color:var(--text-muted)">（自分）</span>':''}</span>
      ${PERM_OPTIONS.some(([r])=>r===p.role)
        ? `<select onchange="acctSetRole('${p.id}',this.value)"${isSelf?' disabled':''} style="font-size:12px;padding:4px 6px">
            ${PERM_OPTIONS.map(([r,l])=>`<option value="${r}"${p.role===r?' selected':''}>${l}</option>`).join('')}
          </select>`
        // この画面で扱わない権限（お客様など）は、選べる形にせず文字で出す。
        // 選択肢に無い権限を select に入れると、いちばん上（管理者）が選ばれて見えてしまう
        : `<span class="badge" style="font-size:10px;padding:1px 7px;flex-shrink:0">${esc(roleLabel(p.role))}</span>`}
      <button class="btn sm" onclick="openAcctEdit('${p.id}')" style="font-size:11px">名前・メール</button>
      ${isSelf?'':`<button class="btn sm" onclick="openSetPassword('${p.id}')" style="font-size:11px">パスワード</button>
      <button class="btn sm danger" onclick="acctDelete('${p.id}')" style="font-size:11px">削除</button>`}
      ${supSel}
    </div>`;
  }).join('');
}

// ════ お客様アカウント（管理者専用：社員・業者とは別の画面） ════
//
// 社員・業者と同じ一覧に並べていたため、権限の欄がお客様を「管理者」と見せていた。
// 取り違えると、お客様に社内のやりとりが見えてしまう。そこで画面そのものを分け、
// こちらには権限の切り替えを置かない（お客様はお客様のまま）。
function openClientAccounts(){
  if(currentUserRole!=='staff') return;
  document.getElementById('clacct-modal').classList.add('open');
  renderClientAccounts();
}
function closeClientAccounts(){ document.getElementById('clacct-modal').classList.remove('open'); }

// そのお客様が、どの案件のお客様として登録されているか
function clientProjectsOf(userId){
  return (projects||[])
    .filter(p=>(p.clients||[]).some(c=>c.userId===userId))
    .map(p=>p.name);
}

function renderClientAccounts(){
  const el=document.getElementById('clacct-list');
  if(!el) return;
  const list = allProfiles.filter(isClientProfile)
    .sort((a,b)=>String(a.displayName||'').localeCompare(String(b.displayName||''),'ja'));
  if(!list.length){
    el.innerHTML=`<div class="empty" style="padding:14px;line-height:1.8">お客様のアカウントはまだありません<br>
      <span style="font-size:11px;color:var(--text-muted)">案件を開いて「案件情報」→ お客様チャット →「チャット案内」から登録します</span></div>`;
    return;
  }
  el.innerHTML = list.map(p=>{
    const projs = clientProjectsOf(p.id);
    return `<div class="wc-assign-row" style="flex-wrap:wrap">
      <span style="flex:1;min-width:120px;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.displayName||'（名前未設定）')}</span>
      <span class="badge" style="font-size:10px;padding:1px 7px;flex-shrink:0">お客様</span>
      <button class="btn sm" onclick="openAcctEdit('${p.id}')" style="font-size:11px">名前・メール</button>
      <button class="btn sm" onclick="openSetPassword('${p.id}')" style="font-size:11px">パスワード</button>
      <button class="btn sm danger" onclick="acctDelete('${p.id}')" style="font-size:11px">削除</button>
      <div style="flex-basis:100%;font-size:10px;color:var(--text-muted);margin-top:2px">
        ${projs.length ? '案件：'+esc(projs.join('、')) : '<b style="color:var(--warn-t)">案件に紐づいていません</b>（お客様チャットに入れません）'}
      </div>
    </div>`;
  }).join('');
}

async function acctSetRole(userId, role){
  if(userId===currentUserId){ showToast('自分の権限は変更できません'); renderAccountPerms(); return; }
  const p=allProfiles.find(x=>x.id===userId); if(!p) return;
  const supplierId = role==='supplier' ? (p.supplierId||null) : null;
  try{ await dbSetRole(userId, role, supplierId); }catch(e){ renderAccountPerms(); return; }
  p.role=role; p.supplierId=supplierId;
  showToast('権限を保存しました（本人の次回ログインで反映）');
  renderAccountPerms();
}

// ── アカウントを削除する（管理者のみ） ──
//
// 日報などが一緒に消えるアカウントは、サーバー側がいったん止めて件数を返す。
// その件数を見せたうえで、もう一度だけ確認して消す。
async function acctDelete(userId){
  if(currentUserRole!=='staff'){ showToast('アカウントの削除は管理者のみです'); return; }
  if(userId===currentUserId){ showToast('自分のアカウントは削除できません'); return; }
  const p=allProfiles.find(x=>x.id===userId); if(!p) return;
  const name=p.displayName||'（名前未設定）';
  if(!confirm(`${name}さんのアカウントを削除します。\nこの人はログインできなくなります。よろしいですか？`)) return;

  try{
    let res = await acctCallDelete(userId, false);
    // 一緒に消えるものがある場合は、その中身を見せてもう一度確認する
    if(res?.needsConfirm){
      const list=(res.related||[]).map(r=>`・${r.label}　${r.count}件`).join('\n');
      if(!confirm(
        `${name}さんには次のデータがあります。アカウントを消すと、これらも元に戻せない形で一緒に消えます。\n\n${list}\n\n`+
        `日報を消すと、出面表と現場別の労務費も変わります。\n本当に削除しますか？`)) return;
      res = await acctCallDelete(userId, true);
    }
    if(!res?.ok) throw new Error('削除できませんでした');
    showToast(`${name}さんのアカウントを削除しました`);
    try{ await fetchProfiles(); }catch(e){}
    renderAccountScreens();
  }catch(e){
    showToast('削除に失敗しました：'+e.message);
  }
}

async function acctCallDelete(userId, confirmed){
  const { data, error } = await sb.functions.invoke('delete-user', { body:{ userId, confirmed } });
  if(error || data?.error) throw new Error(await setpwErrorText(error, data));
  return data;
}

// ── 名前とメールアドレスを後から変える（管理者のみ） ──
//
// 名前は、この仕組みのあちこちに「名前そのもの」で入っている
// （案件の参加メンバー・チャットの発言者・日報の申請者など）。
// 変えるときは、それら全部を一度に付け替える（サーバー側の app_rename_user）。
let acctEditId = '';

async function openAcctEdit(userId){
  if(currentUserRole!=='staff'){ showToast('アカウントの変更は管理者のみです'); return; }
  const p = allProfiles.find(x=>x.id===userId); if(!p) return;
  acctEditId = userId;
  document.getElementById('acctedit-name').value = p.displayName || '';
  document.getElementById('acctedit-mail').value = '';
  document.getElementById('acctedit-mail').placeholder = '読み込み中…';
  document.getElementById('acctedit-note').textContent = '';
  document.getElementById('acctedit-modal').classList.add('open');
  // いま登録されているメールアドレスを読んで入れる
  try{
    const res = await dbUpdateAccount(userId, { read:true });
    if(acctEditId!==userId) return;                  // 読んでいる間に別の人を開いた
    document.getElementById('acctedit-mail').value = res?.email || '';
    document.getElementById('acctedit-mail').placeholder = 'example@mail.com';
  }catch(_){
    document.getElementById('acctedit-mail').placeholder = '（いまのアドレスを読めませんでした）';
  }
}
function closeAcctEdit(){
  acctEditId = '';
  document.getElementById('acctedit-modal').classList.remove('open');
}

async function saveAcctEdit(){
  const userId = acctEditId;
  const p = allProfiles.find(x=>x.id===userId); if(!p) return;
  const name = document.getElementById('acctedit-name').value.trim();
  const mail = document.getElementById('acctedit-mail').value.trim();
  if(!name){ showToast('名前を入力してください'); return; }
  if(!mail){ showToast('メールアドレスを入力してください'); return; }

  const nameChanged = name !== (p.displayName||'');
  // ログインに使うアドレスが変わるので、名前より重い。変わるときだけ確かめる
  let msg = `${p.displayName||''} さんのアカウントを変更します。\n\n`;
  if(nameChanged) msg += `名前：${p.displayName||''} → ${name}\n`
    + `　（案件の参加メンバー・チャット・日報など、名前で残っている所もまとめて付け替えます）\n`;
  msg += `\nメールアドレスを変えた場合、次回から新しいアドレスでログインします（パスワードはそのまま）。\nよろしいですか？`;
  if(!confirm(msg)) return;

  const btn = document.getElementById('acctedit-btn');
  btn.disabled = true; btn.textContent = '変更中…';
  try{
    const res = await dbUpdateAccount(userId, { displayName:name, email:mail });
    if(!res?.changed){ showToast('変更はありませんでした'); closeAcctEdit(); return; }
    showToast('変更しました：\n' + (res.done||[]).join('\n'), 7000);
    closeAcctEdit();
    // 名前は画面のあちこちで使っているので、読み直してから一覧を作り直す
    try{ await fetchAllData(); }catch(_){ try{ await fetchProfiles(); }catch(_){} }
    renderAccountScreens();
    if(typeof renderOrdersList==='function') renderOrdersList();
  }catch(e){
    showToast('変更できませんでした：'+e.message, 7000);
  }finally{
    btn.disabled = false; btn.textContent = 'この内容にする';
  }
}

// ── 管理者が、他の人のパスワードを決める ──
//
// 本来はご本人が招待メール・再設定メールのリンクから決める形。
// 発注先の方などでメールが使えない・急ぎのときのための手段として用意している。
let setpwUserId = '';

function openSetPassword(userId){
  if(currentUserRole!=='staff'){ showToast('パスワードの設定は管理者のみです'); return; }
  if(userId===currentUserId){ showToast('自分のパスワードは「アカウント設定」から変えてください'); return; }
  const p=allProfiles.find(x=>x.id===userId); if(!p) return;
  setpwUserId=userId;
  document.getElementById('setpw-target').textContent=`${p.displayName||'（名前未設定）'} さんのパスワードを決めます`;
  document.getElementById('setpw-1').value='';
  document.getElementById('setpw-2').value='';
  setpwToggleReveal(false);
  document.getElementById('setpw-modal').classList.add('open');
  setTimeout(()=>document.getElementById('setpw-1')?.focus(),100);
}

function closeSetPassword(){
  // 入力したパスワードを画面に残さない
  document.getElementById('setpw-1').value='';
  document.getElementById('setpw-2').value='';
  setpwUserId='';
  document.getElementById('setpw-modal').classList.remove('open');
}

function setpwToggleReveal(on){
  const t=on?'text':'password';
  document.getElementById('setpw-1').type=t;
  document.getElementById('setpw-2').type=t;
}

async function saveSetPassword(){
  const p1=document.getElementById('setpw-1').value;
  const p2=document.getElementById('setpw-2').value;
  if(p1.length<8){ showToast('パスワードは8文字以上にしてください'); return; }
  if(p1!==p2){ showToast('パスワードが一致しません'); return; }
  const p=allProfiles.find(x=>x.id===setpwUserId);
  if(!confirm(`${p?.displayName||''}さんのパスワードを、いま入力したものに変えます。\nこれまでのパスワードは使えなくなります。よろしいですか？`)) return;

  const btn=document.getElementById('setpw-btn');
  btn.disabled=true; btn.textContent='設定中…';
  try{
    const { data, error } = await sb.functions.invoke('set-user-password', {
      body:{ userId:setpwUserId, password:p1 }
    });
    if(error || data?.error) throw new Error(await setpwErrorText(error, data));
    const name=p?.displayName||'';
    closeSetPassword();
    showToast(`${name}さんのパスワードを設定しました。ご本人にお伝えください`);
  }catch(e){
    showToast('設定に失敗しました：'+e.message);
  }finally{
    btn.disabled=false; btn.textContent='このパスワードにする';
  }
}

async function setpwErrorText(error, data){
  if(data?.error) return data.error;
  if(error?.context && typeof error.context.json==='function'){
    try{ const j=await error.context.json(); if(j?.error) return j.error; }catch(_){}
  }
  return error?.message || '不明なエラー';
}

async function acctSetSupplier(userId, val){
  const p=allProfiles.find(x=>x.id===userId); if(!p) return;
  const supplierId = val?Number(val):null;
  try{ await dbSetRole(userId, 'supplier', supplierId); }catch(e){ return; }
  p.supplierId=supplierId;
  showToast('発注先を保存しました');
}
