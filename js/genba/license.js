// ════ 免許・自保（運転免許証と自動車保険の登録・期限管理） ════
//
// 免許証・保険証券を撮影すると、その場で内容を読み取って各欄に反映する（読み取り結果は編集可）。
// 撮影した写真は証拠として非公開の保管場所（license-files）に残し、本人と管理者だけが見られる。
// 有効期限の1か月前・2週間前・1週間前に本人へ通知する（license-remind）。

const LICENSE_WARN_DAYS = 30;   // この日数を切ったら画面上で注意表示にする

function lcToday(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function lcDaysLeft(dateStr){
  if(!dateStr) return null;
  return Math.round((new Date(dateStr+'T00:00:00') - new Date(lcToday()+'T00:00:00'))/86400000);
}
function lcExpireLabel(dateStr){
  if(!dateStr) return '<span style="color:var(--text-muted)">未登録</span>';
  const d=lcDaysLeft(dateStr);
  const label=dateStr.replace(/-/g,'/');
  if(d<0)  return `<span style="color:var(--danger);font-weight:800">${label}（期限切れ）</span>`;
  if(d===0) return `<span style="color:var(--danger);font-weight:800">${label}（本日まで）</span>`;
  if(d<=LICENSE_WARN_DAYS) return `<span style="color:var(--warn-t);font-weight:800">${label}（あと${d}日）</span>`;
  return `<span style="font-weight:700">${label}</span>`;
}

// ── 画面 ──
function renderLicense(){
  const el=document.getElementById('license-body');
  if(!el) return;
  if(typeof licenseTableReady!=='undefined' && !licenseTableReady){
    el.innerHTML=`<div class="card" style="padding:12px;font-size:12px;color:var(--text-sub);line-height:1.7">
      この機能を使うには、データベースの準備が必要です。<br>
      ${currentUserRole==='staff' ? 'supabase/migration-genba22.sql を実行し、Edge Function（read-license／license-remind）をデプロイしてください。' : '管理者に連絡してください。'}
    </div>`;
    return;
  }
  const mine=licenses.find(l=>l.userId===currentUserId)||{};
  el.innerHTML = licenseCardHtml(mine, currentUserId, currentUserDisplayName, true);
  renderLicensePhotos(mine);
  renderLicenseAdmin();
}

function licenseCardHtml(l, userId, userName, editable){
  const row=(label,value)=>`<div style="display:flex;gap:8px;padding:4px 0;font-size:13px">
      <span style="width:96px;flex-shrink:0;color:var(--text-sub);font-size:12px">${label}</span>
      <span style="flex:1;min-width:0">${value}</span></div>`;
  return `
  <div class="section-lbl" style="margin-top:0">運転免許証</div>
  <div class="card" style="padding:12px">
    ${row('免許証番号', l.licenseNo ? `<span style="font-weight:700;letter-spacing:.04em">${esc(l.licenseNo)}</span>` : '<span style="color:var(--text-muted)">未登録</span>')}
    ${row('有効期限', lcExpireLabel(l.licenseExpire))}
    <div id="license-photo-wrap" style="margin-top:8px"></div>
    ${editable?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
      <button class="btn primary" onclick="openLicenseCamera('license')">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" width="14" height="14" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        免許証を撮影して読み取り</button>
      <button class="btn" onclick="openLicenseEdit('license')">手入力で修正</button>
    </div>`:''}
  </div>

  <div class="section-lbl">自動車保険</div>
  <div class="card" style="padding:12px">
    ${row('保険会社', l.insurer ? esc(l.insurer) : '<span style="color:var(--text-muted)">未登録</span>')}
    ${row('対人補償', l.liabilityPerson ? `<span style="font-weight:700">${esc(l.liabilityPerson)}</span>` : '<span style="color:var(--text-muted)">未登録</span>')}
    ${row('対物補償', l.liabilityObject ? `<span style="font-weight:700">${esc(l.liabilityObject)}</span>` : '<span style="color:var(--text-muted)">未登録</span>')}
    ${row('満了日', lcExpireLabel(l.insuranceExpire))}
    <div id="insurance-photo-wrap" style="margin-top:8px"></div>
    ${editable?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
      <button class="btn primary" onclick="openLicenseCamera('insurance')">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" width="14" height="14" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        保険証券を撮影して読み取り</button>
      <button class="btn" onclick="openLicenseEdit('insurance')">手入力で修正</button>
    </div>`:''}
  </div>
  <div style="font-size:11px;color:var(--text-muted);line-height:1.7;margin-top:8px">
    写真は本人と管理者だけが見られます。有効期限の1か月前・2週間前・1週間前に通知が届きます。
  </div>`;
}

// 写真は非公開のため、表示のたびに期限付きURLを作る
async function renderLicensePhotos(l){
  const put=async (wrapId, path, kind)=>{
    const wrap=document.getElementById(wrapId);
    if(!wrap) return;
    if(!path){ wrap.innerHTML='<div style="font-size:11px;color:var(--text-muted)">写真は未登録です</div>'; return; }
    wrap.innerHTML='<div style="font-size:11px;color:var(--text-muted)">写真を読み込み中…</div>';
    const url=await dbLicensePhotoUrl(path);
    wrap.innerHTML = url
      ? `<div style="display:flex;align-items:center;gap:8px">
           <img src="${url}" alt="登録した写真" style="width:96px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer" onclick="window.open('${url}','_blank')">
           <div style="font-size:11px;color:var(--text-sub)">タップで拡大<br>
             <button class="btn xs danger" style="margin-top:4px" onclick="deleteLicensePhoto('${kind}')">写真を削除</button></div>
         </div>`
      : '<div style="font-size:11px;color:var(--danger)">写真を表示できませんでした</div>';
  };
  put('license-photo-wrap', l.licensePhoto, 'license');
  put('insurance-photo-wrap', l.insurancePhoto, 'insurance');
}

// ── 管理者：全員の状況 ──
function renderLicenseAdmin(){
  const wrap=document.getElementById('license-admin-wrap');
  if(!wrap) return;
  if(currentUserRole!=='staff' || (typeof licenseTableReady!=='undefined' && !licenseTableReady)){ wrap.style.display='none'; return; }
  wrap.style.display='';
  const people=(typeof allProfiles!=='undefined'?allProfiles:[])
    .filter(p=>p.role==='staff'||p.role==='carpenter')
    .sort((a,b)=>cmpEmployee(a.displayName,b.displayName));
  document.getElementById('license-admin-list').innerHTML = people.map(p=>{
    const l=licenses.find(x=>x.userId===p.id)||{};
    const worst=[l.licenseExpire,l.insuranceExpire].filter(Boolean).map(lcDaysLeft).sort((a,b)=>a-b)[0];
    const mark = worst==null ? '' : worst<0 ? '<span style="color:var(--danger);font-weight:800">期限切れ</span>'
      : worst<=LICENSE_WARN_DAYS ? `<span style="color:var(--warn-t);font-weight:800">あと${worst}日</span>` : '';
    return `<div class="leave-row"><div style="display:flex;align-items:center;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${esc(p.displayName)}　${mark}</div>
        <div style="font-size:11px;color:var(--text-sub)">
          免許 ${l.licenseNo?esc(l.licenseNo):'—'}／${l.licenseExpire?l.licenseExpire.replace(/-/g,'/'):'期限未登録'}
        </div>
        <div style="font-size:11px;color:var(--text-sub)">
          保険 対人 ${l.liabilityPerson?esc(l.liabilityPerson):'—'}／対物 ${l.liabilityObject?esc(l.liabilityObject):'—'}／${l.insuranceExpire?l.insuranceExpire.replace(/-/g,'/'):'満了日未登録'}
        </div>
      </div>
    </div></div>`;
  }).join('') || '<div class="empty" style="padding:14px">社員がいません</div>';
}

// ── 撮影 → 読み取り ──
let _licenseKind='license';

function openLicenseCamera(kind){
  _licenseKind=kind;
  document.getElementById('license-file-input').click();
}

// 端末の写真は大きいので、長辺1600pxに縮小してから送る（読み取りも保存も速くなる）
function licenseResize(file, maxSide=1600){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const scale=Math.min(1, maxSide/Math.max(img.width,img.height));
      const w=Math.round(img.width*scale), h=Math.round(img.height*scale);
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      cv.toBlob(b=>b?resolve(b):reject(new Error('画像を変換できませんでした')), 'image/jpeg', 0.85);
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
    img.src=url;
  });
}
function blobToBase64(blob){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=()=>resolve(String(r.result).split(',')[1]);
    r.onerror=reject;
    r.readAsDataURL(blob);
  });
}

async function onLicenseFileChange(input){
  const file=input.files?.[0];
  if(!file) return;
  input.value='';
  const kind=_licenseKind;
  const label=kind==='license'?'免許証':'保険証券';
  showLicenseBusy(`${label}を読み取っています…`);
  try{
    const blob=await licenseResize(file);
    const base64=await blobToBase64(blob);

    // ① 読み取り
    let result={};
    try{
      result=await dbReadLicenseImage(base64, 'image/jpeg', kind);
    }catch(e){
      showLicenseBusy('');
      showToast('読み取りに失敗しました：'+e.message+'（手入力で登録できます）');
      openLicenseEdit(kind);
      return;
    }

    // ② 写真を保存
    showLicenseBusy('写真を保存しています…');
    const path=await dbUploadLicensePhoto(currentUserId, blob, kind);

    // ③ 読み取り結果を確認画面に出す（そのまま保存も、直してから保存も可能）
    showLicenseBusy('');
    openLicenseEdit(kind, result, path);
  }catch(e){
    showLicenseBusy('');
    showToast('エラー：'+e.message);
  }
}

function showLicenseBusy(msg){
  const el=document.getElementById('license-busy');
  if(!el) return;
  el.style.display=msg?'':'none';
  el.textContent=msg||'';
}

// ── 入力・確認モーダル ──
let _licenseEditKind='license', _licenseNewPhoto='';

function openLicenseEdit(kind, result, photoPath){
  _licenseEditKind=kind;
  _licenseNewPhoto=photoPath||'';
  const l=licenses.find(x=>x.userId===currentUserId)||{};
  const isLic=kind==='license';
  document.getElementById('license-edit-title').textContent = isLic?'運転免許証':'自動車保険';
  document.getElementById('license-edit-hint').textContent = result
    ? '写真から読み取りました。間違いがないか確認して保存してください。'
    : '内容を入力して保存してください。';
  document.getElementById('license-edit-lic').style.display = isLic?'':'none';
  document.getElementById('license-edit-ins').style.display = isLic?'none':'';
  if(isLic){
    document.getElementById('lc-no').value     = result?.licenseNo ?? l.licenseNo ?? '';
    document.getElementById('lc-expire').value = result?.expire    ?? l.licenseExpire ?? '';
  } else {
    document.getElementById('lc-insurer').value = result?.insurer         ?? l.insurer ?? '';
    document.getElementById('lc-person').value  = result?.liabilityPerson ?? l.liabilityPerson ?? '';
    document.getElementById('lc-object').value  = result?.liabilityObject ?? l.liabilityObject ?? '';
    document.getElementById('lc-ins-expire').value = result?.expire       ?? l.insuranceExpire ?? '';
  }
  document.getElementById('license-edit-modal').classList.add('open');
}
function closeLicenseEdit(){
  document.getElementById('license-edit-modal').classList.remove('open');
  _licenseNewPhoto='';
}

async function saveLicenseEdit(){
  const isLic=_licenseEditKind==='license';
  const l=licenses.find(x=>x.userId===currentUserId)||{};
  const patch = isLic
    ? {licenseNo:document.getElementById('lc-no').value.trim(), licenseExpire:document.getElementById('lc-expire').value}
    : {insurer:document.getElementById('lc-insurer').value.trim(),
       liabilityPerson:document.getElementById('lc-person').value.trim(),
       liabilityObject:document.getElementById('lc-object').value.trim(),
       insuranceExpire:document.getElementById('lc-ins-expire').value};
  if(_licenseNewPhoto){
    // 新しい写真に差し替え、古い写真は消す
    const old = isLic ? l.licensePhoto : l.insurancePhoto;
    patch[isLic?'licensePhoto':'insurancePhoto'] = _licenseNewPhoto;
    if(old) dbDeleteLicensePhoto(old).catch(()=>{});
  }
  try{
    await dbSaveLicense(currentUserId, currentUserDisplayName, patch);
  }catch(e){ return; }
  closeLicenseEdit();
  await refreshGenba();
  showToast('保存しました');
}

async function deleteLicensePhoto(kind){
  if(!confirm('登録した写真を削除しますか？')) return;
  const l=licenses.find(x=>x.userId===currentUserId)||{};
  const path = kind==='license' ? l.licensePhoto : l.insurancePhoto;
  if(path) await dbDeleteLicensePhoto(path).catch(()=>{});
  await dbSaveLicense(currentUserId, currentUserDisplayName, {[kind==='license'?'licensePhoto':'insurancePhoto']:''});
  await refreshGenba();
  showToast('写真を削除しました');
}
