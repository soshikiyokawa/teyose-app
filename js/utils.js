const fmt = n => Math.round(n).toLocaleString('ja-JP');
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
  const html=`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>${title}</title><style>*{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}body{font-family:'Helvetica Neue','Hiragino Sans',sans-serif;color:#111;padding:32px;max-width:800px;margin:0 auto}table{width:100%;border-collapse:collapse}@media print{@page{margin:15mm}button{display:none}}</style></head><body>${body}</body></html>`;
  const win=window.open('','_blank');
  if(win){
    win.document.write(html);win.document.close();
    setTimeout(()=>win.print(),500);
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
