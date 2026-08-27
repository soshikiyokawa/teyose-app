// ════ アカウント権限（管理者専用：各アカウントの権限を設定） ════
// 権限は role にマップ：管理者＝staff／一般社員＝carpenter／業者＝supplier
// RLSは role（staff/carpenter/supplier）で判定しているため、DBの値は role のまま保持する。

const PERM_OPTIONS = [['staff','管理者'],['carpenter','一般社員'],['supplier','業者']];

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
  try{
    await dbInviteUser({email, displayName, role, supplierId, workGroup});
  }catch(e){
    btn.disabled=false; btn.textContent='招待メールを送信';
    return;
  }
  btn.disabled=false; btn.textContent='招待メールを送信';
  document.getElementById('inv-email').value='';
  document.getElementById('inv-name').value='';
  showToast(`${displayName}さんに招待メールを送信しました`);
  try{ await fetchProfiles(); }catch(e){} // allProfilesを取り直して一覧に反映
  renderAccountPerms();
}
function closeAccountPerms(){ document.getElementById('acct-modal').classList.remove('open'); }

function renderAccountPerms(){
  const el=document.getElementById('acct-list');
  if(!allProfiles.length){ el.innerHTML='<div class="empty" style="padding:12px">アカウントがありません</div>'; return; }
  // 並び順：社員（指定の固定順）→ 業者。社員内は EMPLOYEE_ORDER、業者は末尾に名前順
  const rank = p => p.role==='supplier' ? 1 : 0;
  const cmpName = (typeof cmpEmployee==='function')
    ? cmpEmployee
    : (a,b)=>String(a).localeCompare(String(b),'ja');
  const list = allProfiles.slice().sort((a,b)=> rank(a)-rank(b) || cmpName(a.displayName||'', b.displayName||''));
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
      <select onchange="acctSetRole('${p.id}',this.value)"${isSelf?' disabled':''} style="font-size:12px;padding:4px 6px">
        ${PERM_OPTIONS.map(([r,l])=>`<option value="${r}"${p.role===r?' selected':''}>${l}</option>`).join('')}
      </select>
      ${isSelf?'':`<button class="btn sm" onclick="openSetPassword('${p.id}')" style="font-size:11px">パスワード</button>
      <button class="btn sm danger" onclick="acctDelete('${p.id}')" style="font-size:11px">削除</button>`}
      ${supSel}
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
    renderAccountPerms();
  }catch(e){
    showToast('削除に失敗しました：'+e.message);
  }
}

async function acctCallDelete(userId, confirmed){
  const { data, error } = await sb.functions.invoke('delete-user', { body:{ userId, confirmed } });
  if(error || data?.error) throw new Error(await setpwErrorText(error, data));
  return data;
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
