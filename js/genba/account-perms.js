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
  try{ await fetchWorkCalendar(); }catch(e){} // allProfilesを取り直して一覧に反映
  renderAccountPerms();
}
function closeAccountPerms(){ document.getElementById('acct-modal').classList.remove('open'); }

function renderAccountPerms(){
  const el=document.getElementById('acct-list');
  if(!allProfiles.length){ el.innerHTML='<div class="empty" style="padding:12px">アカウントがありません</div>'; return; }
  el.innerHTML=allProfiles.map(p=>{
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

async function acctSetSupplier(userId, val){
  const p=allProfiles.find(x=>x.id===userId); if(!p) return;
  const supplierId = val?Number(val):null;
  try{ await dbSetRole(userId, 'supplier', supplierId); }catch(e){ return; }
  p.supplierId=supplierId;
  showToast('発注先を保存しました');
}
