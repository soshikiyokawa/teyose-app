const fmt = n => Math.round(n).toLocaleString('ja-JP');

// ── きよかわの社員の名前（担当者を選ぶのに使う） ──
//
// 発注書・見積依頼書の「担当者」は、作った本人が既定。
// 別の人が窓口になる場合もあるので、ここから選び直せるようにする。
// 発注先とお客様は社員ではないので入れない。
function employeeNames(){
  const list = (typeof allProfiles!=='undefined' ? allProfiles : [])
    .filter(p=>(p.role==='staff'||p.role==='carpenter') && p.displayName)
    .map(p=>p.displayName);
  const uniq = [...new Set(list)];
  return typeof cmpEmployee==='function'
    ? uniq.sort(cmpEmployee)
    : uniq.sort((a,b)=>String(a).localeCompare(String(b),'ja'));
}
// 担当者を選ぶ欄を作る。いまの値（無ければログイン中の人）を選んでおく
function fillStaffSelect(id, picked){
  const sel = document.getElementById(id);
  if(!sel) return;
  const me = currentUserDisplayName || '';
  const want = picked || sel.value || me;
  const names = employeeNames();
  if(want && !names.includes(want)) names.unshift(want);   // 名簿に無い名前でも消さない
  sel.innerHTML = names.map(n=>`<option value="${esc(n)}"${n===want?' selected':''}>${esc(n)}${n===me?'（自分）':''}</option>`).join('');
  if(!names.length) sel.innerHTML = `<option value="">（社員が登録されていません）</option>`;
}

// ════ 消費税（品目ごとの税率に対応） ════
//
// 10%（ふつう）・8%（軽減税率＝飲食料品と新聞）・0%（非課税＝切手・印紙・商品券など）が
// 混ざることがある。税率ごとに金額をまとめてから掛けるのが正しい出し方で、
// 1行ずつ丸めて足すと、レシートに書かれた消費税と1円ずれることがある。
//
// taxRate が無い品目（これまでの発注）は、これまでどおり10%として扱う。
const TAX_RATES = [10, 8, 0];
const taxRateOf = it => TAX_RATES.includes(Number(it?.taxRate)) ? Number(it.taxRate) : 10;
const taxRateLabel = r => r===0 ? '非課税' : `${r}%`;

// その行の税抜の金額。costAdjust は、レシートを税込から税抜に直したときに出る
// 数円のずれを寄せたもの（そのままだとレシートの合計と合わなくなる）
function lineBase(it){
  return (Number(it?.cost)||0) * (Number(it?.qty)||0) + (Number(it?.costAdjust)||0);
}

// items は {cost（税抜単価）, qty, taxRate, costAdjust} の並び
function orderTaxBreakdown(items){
  const by = new Map();
  (items||[]).forEach(it=>{
    const r = taxRateOf(it);
    by.set(r, (by.get(r)||0) + lineBase(it));
  });
  const rows = [...by.entries()]
    .sort((a,b)=>b[0]-a[0])                       // 10% → 8% → 非課税 の順
    .map(([rate, base])=>({ rate, base, tax: Math.round(base * rate / 100) }));
  const subtotal = rows.reduce((s,r)=>s+r.base, 0);
  const tax = rows.reduce((s,r)=>s+r.tax, 0);
  return { rows, subtotal, tax, total: subtotal + tax, mixed: rows.length > 1 };
}
// 発注書・プレビューに出す消費税の行（税率が1つなら1行、混ざっていれば税率ごと）
function orderTaxLines(items){
  const b = orderTaxBreakdown(items);
  const lines = b.rows.filter(r=>r.rate>0).map(r=>({
    label: b.mixed ? `消費税（${r.rate}%対象 ¥${fmt(r.base)}）` : `消費税（${r.rate}%）`,
    value: r.tax,
  }));
  const zero = b.rows.find(r=>r.rate===0);
  if(zero && b.mixed) lines.push({ label:'非課税分', value: zero.base, note:true });
  if(!lines.length) lines.push({ label:'消費税（非課税）', value: 0 });
  return lines;
}

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

// 一覧に出す写真は、縮小したものを読み込む。
//
// 元の写真は1枚1MBを超えることがあり、一覧で何十枚も出すと通信量が跳ね上がる
// （2026-09にこれが積み重なって、Supabaseの転送量の上限に当たり全員が使えなくなった）。
// Supabaseの画像変換に任せ、幅を指定して読み込む。開いたときだけ元の大きさを出す。
function thumbUrl(url, width, quality){
  const u = String(url||'');
  if(!u.includes('/storage/v1/object/public/')) return u;      // 別の置き場のものは触らない
  if(!/\.(jpe?g|png|webp)(\?|$)/i.test(u)) return u;           // 写真以外（PDFなど）はそのまま
  return u.split('?')[0].replace('/storage/v1/object/public/','/storage/v1/render/image/public/')
    + '?width=' + (width||400) + '&quality=' + (quality||70);
}

// 日付を、端末の暦のまま YYYY-MM-DD にする（省略すると今日）。
// new Date().toISOString().slice(0,10) は世界標準時の日付になるため、日本では
// 朝9時前は「前日」になり、0時ちょうどの日付は1日戻る。暦の日付を作るときはこれを使う
// ════ 国民の祝日 ════
//
// 年ごとの一覧を持たずに、暦の決まりから求める（工程表は何年も先まで伸びるため）。
//   ・日にちが決まっているもの（元日・建国記念の日・昭和の日 など）
//   ・第◯月曜のもの（成人の日・海の日・敬老の日・スポーツの日）
//   ・春分の日・秋分の日（太陽の動きから出す式。1980〜2099年で合う）
//   ・振替休日（祝日が日曜なら、そのあとの最初の平日）
//   ・国民の休日（祝日と祝日にはさまれた平日。敬老の日と秋分の日の間など）
// いまの決まり（2022年以降）に合わせてある。それより前の年は、当時の決まりと違う日がある。
const _jpHolidayCache = {};
function _jpHolidaysOfYear(y){
  if(_jpHolidayCache[y]) return _jpHolidayCache[y];
  const map = {};
  const key = (m,d)=> y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  const nthMon = (m,n)=>{                                   // m月の第n月曜
    const first = new Date(y, m-1, 1).getDay();
    return 1 + ((8-first)%7) + (n-1)*7;
  };
  const shunbun = Math.floor(20.8431 + 0.242194*(y-1980) - Math.floor((y-1980)/4));
  const shubun  = Math.floor(23.2488 + 0.242194*(y-1980) - Math.floor((y-1980)/4));
  [[1,1,'元日'],[1,nthMon(1,2),'成人の日'],[2,11,'建国記念の日'],[2,23,'天皇誕生日'],
   [3,shunbun,'春分の日'],[4,29,'昭和の日'],[5,3,'憲法記念日'],[5,4,'みどりの日'],[5,5,'こどもの日'],
   [7,nthMon(7,3),'海の日'],[8,11,'山の日'],[9,nthMon(9,3),'敬老の日'],[9,shubun,'秋分の日'],
   [10,nthMon(10,2),'スポーツの日'],[11,3,'文化の日'],[11,23,'勤労感謝の日']
  ].forEach(([m,d,n])=>{ map[key(m,d)] = n; });

  const ymd = dt => key(dt.getMonth()+1, dt.getDate());
  // 振替休日：祝日が日曜なら、そのあとの最初の「祝日でない日」
  Object.keys(map).forEach(k=>{
    const [yy,mm,dd] = k.split('-').map(Number);
    const dt = new Date(yy, mm-1, dd);
    if(dt.getDay() !== 0) return;
    do{ dt.setDate(dt.getDate()+1); }while(map[ymd(dt)]);
    if(dt.getFullYear()===y) map[ymd(dt)] = '振替休日';
  });
  // 国民の休日：前の日も次の日も祝日の、平日（日曜と祝日は除く）
  for(let dt=new Date(y,0,2); dt.getFullYear()===y; dt.setDate(dt.getDate()+1)){
    const k = ymd(dt);
    if(map[k] || dt.getDay()===0) continue;
    const prev = new Date(dt); prev.setDate(dt.getDate()-1);
    const next = new Date(dt); next.setDate(dt.getDate()+1);
    const isHol = d => { const n = map[ymd(d)]; return !!n && n!=='振替休日' && n!=='国民の休日'; };
    if(prev.getFullYear()===y && next.getFullYear()===y && isHol(prev) && isHol(next)) map[k] = '国民の休日';
  }
  return (_jpHolidayCache[y] = map);
}
// その日が祝日なら、その名前。祝日でなければ ''（'2026-10-12' の形で渡す）
function jpHolidayName(ymd){
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(ymd||''));
  if(!m) return '';
  return _jpHolidaysOfYear(Number(m[1]))[ymd] || '';
}

function localYmd(d){
  d = d || new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

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
