const fmt = n => Math.round(n).toLocaleString('ja-JP');

function payAmtFocus(el){ el.value = el.value.replace(/,/g,''); }
function payAmtBlur(el){
  const n = parseFloat(el.value.replace(/,/g,''));
  el.value = isNaN(n)||n===0 ? '' : n.toLocaleString('ja-JP');
}
function payAmtLoad(id, val){
  const el = document.getElementById(id);
  if(!el) return;
  el.value = val ? Number(val).toLocaleString('ja-JP') : '';
}
function payAmtVal(id){ return parseFloat((document.getElementById(id)?.value||'').replace(/,/g,''))||0; }

// ════ 案件の参加メンバー（1つの発注先に複数のアカウントがある場合に使う） ════
// 案件のメンバーには、社員は表示名、発注先は「会社名」または担当者の表示名が入る。
// 発注先は会社名でも自分の表示名でも通るようにして、会社名だけ入れておけば
// その会社のアカウント全員が見られるようにする（SQL側の app_is_project_member と同じ考え方）。
function myMemberNames(){
  const names = [currentUserDisplayName].filter(Boolean);
  if(currentUserRole==='supplier'){
    const sup = (typeof suppliers!=='undefined' ? suppliers : [])
      .find(s=>s.id===currentUserSupplierId);
    if(sup?.name) names.push(sup.name);
  }
  return names;
}
// 管理者（staff）の表示名。案件を作ったとき、はじめから参加メンバーに入れる
function staffMemberNames(){
  return (typeof allProfiles!=='undefined' ? allProfiles : [])
    .filter(p=>p.role==='staff' && p.displayName)
    .map(p=>p.displayName);
}
function isMyProjectMember(members){
  const mine = myMemberNames();
  return (members||[]).some(n=>mine.includes(n));
}
// 案件チャットの通知先（参加メンバーから自分＝表示名も会社名も除く）
function otherMemberNames(members){
  const mine = myMemberNames();
  return (members||[]).filter(n=>!mine.includes(n));
}
const COMPANY = {name:'株式会社きよかわ',zip:'〒731-0221',address:'広島県広島市安佐北区可部2-13-31-1',tel:'082-815-6080',fax:'082-815-6081',regNo:'T9-2400-0101-8389',url:'kiyokawanoie.com'};

function showToast(msg, duration=2000){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), duration);
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function tsLabel(ts){
  const d=new Date(ts);const now=new Date();const diff=now-d;
  if(diff<60000) return 'たった今';
  if(diff<3600000) return Math.floor(diff/60000)+'分前';
  if(diff<86400000) return d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
  return (d.getMonth()+1)+'/'+d.getDate();
}
function dateLabel(ts){const d=new Date(ts);return d.getFullYear()+'年'+(d.getMonth()+1)+'月'+d.getDate()+'日';}

// 品目名から「品名」と「寸法」を分離
// 寸法は数字×数字パターン or 末尾の数字列を検出
function splitNameSpec(name){
  // 数字×数字×数字 or 数字×数字 のパターンより前を品名とする
  const m = name.match(/^(.*?)\s+([\d.]+(?:[×xX][\d.]+)+(?:\s*\(.*\))?)$/);
  if(m) return {n: m[1].trim(), s: m[2].trim()};
  // 末尾に単独の数字（長さなど）があるパターン
  const m2 = name.match(/^(.*?)\s+(\d{3,}(?:\s*\(.*\))?)$/);
  if(m2) return {n: m2[1].trim(), s: m2[2].trim()};
  return {n: name, s: ''};
}

// PDF バックアップ（Supabase Storage）
async function savePdfBackup(type, projectName, bodyHtml) {
  try {
    const now = new Date();
    const dateStr = now.getFullYear()
      + String(now.getMonth()+1).padStart(2,'0')
      + String(now.getDate()).padStart(2,'0');
    const timeStr = String(now.getHours()).padStart(2,'0')
      + String(now.getMinutes()).padStart(2,'0');
    const safeName = (projectName||'工事名未設定').replace(/[\/\\:*?"<>|]/g,'_').trim();
    const fileName = `${safeName}_${dateStr}_${timeStr}.html`;
    const path = `${type}/${fileName}`;
    const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>${type}｜${safeName}</title><style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:'Hiragino Sans',sans-serif;color:#111;padding:32px;max-width:800px;margin:0 auto}table{width:100%;border-collapse:collapse}@media print{@page{margin:15mm}button{display:none}}</style></head><body>${bodyHtml}</body></html>`;
    const blob = new Blob([html], {type:'text/html'});
    const {error} = await sb.storage.from('pdf-backups').upload(path, blob, {contentType:'text/html', upsert:false});
    if(error) throw error;
    showToast(`${type}をバックアップしました`);
  } catch(e) {
    console.warn('バックアップ失敗:', e.message||e);
  }
}

// バックアップ一覧を表示
async function openPdfBackupList() {
  const modal = document.getElementById('pdf-backup-modal');
  const listEl = document.getElementById('pdf-backup-list');
  if(!modal||!listEl) return;
  listEl.innerHTML = '<div style="padding:16px;color:var(--text-muted)">読み込み中…</div>';
  modal.classList.add('open');
  try {
    const folders = ['見積書','請求書'];
    let html = '';
    for(const folder of folders) {
      const {data, error} = await sb.storage.from('pdf-backups').list(folder, {sortBy:{column:'created_at',order:'desc'}});
      if(error||!data||data.length===0) { html+=`<div class="section-lbl">${folder}</div><div class="empty" style="padding:8px 0 16px">なし</div>`; continue; }
      html += `<div class="section-lbl">${folder}</div><div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">`;
      for(const f of data) {
        const {data:urlData} = sb.storage.from('pdf-backups').getPublicUrl(`${folder}/${f.name}`);
        const label = f.name.replace(/\.html$/,'');
        html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface-1);border-radius:6px;font-size:13px">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>
          <a href="${urlData.publicUrl}" target="_blank" class="btn xs">開く</a>
        </div>`;
      }
      html += '</div>';
    }
    listEl.innerHTML = html || '<div class="empty">バックアップなし</div>';
  } catch(e) {
    listEl.innerHTML = `<div class="empty">読み込みエラー: ${e.message}</div>`;
  }
}

// PDF印刷ユーティリティ（ポップアップブロック対応）
function printHtml(title, body){
  // 画面上部に「印刷」「閉じる」バーを常設（印刷時は非表示）。スマホで戻れなくなるのを防ぐ
  const bar=`<div class="noprint" style="position:sticky;top:0;z-index:99;display:flex;gap:8px;justify-content:flex-end;align-items:center;background:#f7f3eb;border-bottom:1px solid #d8cdb8;padding:8px 12px;margin:-32px -32px 20px">
    <button onclick="window.print()" style="border:none;background:#8b6340;color:#fff;font-size:14px;font-weight:700;padding:8px 18px;border-radius:8px;cursor:pointer">🖨 印刷</button>
    <button onclick="window.close()" style="border:1px solid #c8bfae;background:#fff;color:#5c3d1e;font-size:14px;font-weight:700;padding:8px 18px;border-radius:8px;cursor:pointer">✕ 閉じる</button>
  </div>`;
  const html=`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${title}</title><style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}body{font-family:'Helvetica Neue','Hiragino Sans',sans-serif;color:#111;padding:32px;max-width:800px;margin:0 auto}table{width:100%;border-collapse:collapse}@media print{@page{margin:15mm}button,.noprint{display:none !important}body{padding:0}}</style></head><body>${bar}${body}</body></html>`;
  const win=window.open('','_blank');
  if(win){
    win.document.write(html);win.document.close();
    return true;
  }
  // フォールバック：非表示iframeで印刷
  const old=document.getElementById('_print_frame');
  if(old) old.remove();
  const iframe=document.createElement('iframe');
  iframe.id='_print_frame';
  iframe.style.cssText='position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none';
  document.body.appendChild(iframe);
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  setTimeout(()=>{iframe.contentWindow.focus();iframe.contentWindow.print();},500);
  return false;
}

// ════ 一覧のドラッグ並び替え（マウス・指のどちらでも動く） ════
// HTML5のドラッグ＆ドロップはスマホのタッチでは動かないため、
// ポインタイベント（マウス・タッチ共通）で「⠿」ハンドルをつかんで並び替える。
//
//   enableDragSort(一覧の要素, '行のセレクタ', (動かす行のid, 落とす先のid)=>{...})
//
function enableDragSort(container, rowSelector, onDrop){
  if(!container) return;
  // 一覧は並び替えのたびに描き直されるため、同じ要素に何度も登録しない
  // （重複させると1回の操作で並び替えが2回走ってしまう）
  container._dragSortRowSelector = rowSelector;
  container._dragSortOnDrop = onDrop;
  if(container._dragSortBound) return;
  container._dragSortBound = true;

  let srcRow=null, srcId=null, overRow=null, scrollTimer=null;
  const rowsSel = ()=>container._dragSortRowSelector;   // 最新の設定を container から読む

  const clearOver=()=>{
    container.querySelectorAll(rowsSel()).forEach(r=>r.classList.remove("drag-over"));
    overRow=null;
  };
  const finish=()=>{
    if(scrollTimer){ cancelAnimationFrame(scrollTimer); scrollTimer=null; }
    if(srcRow) srcRow.classList.remove('dragging');
    document.body.classList.remove('drag-sorting');
    clearOver();
    srcRow=null; srcId=null;
  };

  // 画面の上端・下端に近づいたら自動でスクロールする（長い一覧用）
  const autoScroll=(y)=>{
    const margin=70, speed=12;
    const step=()=>{
      if(!srcRow) return;
      if(y<margin) window.scrollBy(0,-speed);
      else if(y>window.innerHeight-margin) window.scrollBy(0,speed);
      scrollTimer=requestAnimationFrame(step);
    };
    if(scrollTimer) cancelAnimationFrame(scrollTimer);
    if(y<margin || y>window.innerHeight-margin) scrollTimer=requestAnimationFrame(step);
    else scrollTimer=null;
  };

  container.addEventListener('pointerdown', e=>{
    const handle=e.target.closest('.drag-handle');
    if(!handle || !container.contains(handle)) return;
    const row=handle.closest(rowsSel());
    if(!row) return;
    e.preventDefault();                    // タッチ中の画面スクロール・文字選択を止める
    srcRow=row; srcId=row.dataset.id;
    row.classList.add('dragging');
    document.body.classList.add('drag-sorting');
    handle.setPointerCapture?.(e.pointerId);
  });

  container.addEventListener('pointermove', e=>{
    if(!srcRow) return;
    e.preventDefault();
    // 指・カーソルの真下にある行を探す（ハンドルがポインタを占有するため座標で判定する）
    const el=document.elementFromPoint(e.clientX, e.clientY);
    const row=el && el.closest ? el.closest(rowsSel()) : null;
    if(row && container.contains(row) && row!==srcRow){
      if(row!==overRow){ clearOver(); row.classList.add('drag-over'); overRow=row; }
    } else if(!row){
      clearOver();
    }
    autoScroll(e.clientY);
  });

  const drop=()=>{
    if(!srcRow) return;
    const toId = overRow?.dataset.id;
    const fromId = srcId;
    finish();
    if(toId && fromId && toId!==fromId) container._dragSortOnDrop(fromId, toId);
  };
  container.addEventListener('pointerup', drop);
  container.addEventListener('pointercancel', finish);
  container.addEventListener('lostpointercapture', ()=>{ if(srcRow) drop(); });
}

// ════ 人工（1人日） ════
//
// 1人工＝その人の1日の所定労働時間ぶんの労働。
// 一般社員は8時間、訓練校生は7.5時間（勤務区分ごとの所定労働時間）。
// 区分ごとの時間は「残業代の計算の設定」（app_settings.overtime_pay）と同じものを使う。
// 出面表・現場別労務費・原価サマリー・案件カードで同じ数え方になるよう、ここに集めてある。
function ninkuMinutesOf(userId){
  const s = (typeof appSettings!=='undefined' && appSettings && appSettings.overtime_pay) || {};
  const p = (typeof allProfiles!=='undefined' ? allProfiles : []).find(x=>x.id===userId);
  const cal = (p && p.workGroup==='訓練校生') ? 'trainee' : 'regular';
  const per  = Number((s.dailyHoursByCal||{})[cal]);
  const base = Number(s.dailyHours);
  const hours = per>0 ? per : (base>0 ? base : 8);
  return Math.max(1, Math.round(hours*60));
}
// 日報1件ぶんの人工
function nippoNinku(n){
  return n && n.workMinutes ? n.workMinutes / ninkuMinutesOf(n.userId) : 0;
}
