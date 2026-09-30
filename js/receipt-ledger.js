// ════ レシート台帳（日付順に並べて、画像と中身をたどれる） ════
//
// 整えたレシートの画像と、読み取った内容（日付・店名・税率ごとの内訳）を残してある。
// ここでは、それを日付の新しい順に並べ、月で絞り込み、紙に並べて印刷できるようにする。
//
// 画像は公開していない置き場所にあるので、見るときだけ1時間有効のリンクを作る。

let rlMonth = '';          // '' なら全部、'2026-09' ならその月だけ
let rlKeyword = '';
let _rlThumbs = {};        // 画像のリンクを覚えておく（毎回作り直さない）

function rlMonthsAvailable(){
  return [...new Set((receiptLedger||[]).map(r=>String(r.paidOn||'').slice(0,7)).filter(Boolean))]
    .sort().reverse();
}
function rlRows(){
  const kw = rlKeyword.trim();
  return (receiptLedger||[]).filter(r=>{
    if(rlMonth && String(r.paidOn||'').slice(0,7) !== rlMonth) return false;
    if(kw){
      const hay = [r.shop, r.project, r.costType, r.paymentMethod, r.note,
        ...(r.items||[]).map(i=>i.name)].join(' ');
      if(!hay.includes(kw)) return false;
    }
    return true;
  });
}

function rlSetMonth(v){ rlMonth = v; renderReceiptLedger(); }
function rlSetKeyword(v){ rlKeyword = v; renderReceiptLedger(); }

function renderReceiptLedger(){
  const el = document.getElementById('rl-body');
  if(!el) return;

  // 絞り込みの並び
  const fw = document.getElementById('rl-filter');
  if(fw){
    const months = rlMonthsAvailable();
    fw.innerHTML = `
      <select onchange="rlSetMonth(this.value)" style="width:auto;font-size:12px;padding:4px 8px">
        <option value="">月：すべて</option>
        ${months.map(m=>`<option value="${m}"${rlMonth===m?' selected':''}>${m.replace('-','年')}月</option>`).join('')}
      </select>
      <input type="search" placeholder="店名・品目・案件で探す" value="${esc(rlKeyword)}"
        oninput="rlSetKeyword(this.value)" style="width:auto;flex:1;min-width:140px;font-size:12px;padding:4px 8px">
      <button class="btn sm" onclick="printReceiptLedger()">台帳を印刷</button>`;
  }

  if(!receiptsReady){
    el.innerHTML = `<div class="card" style="padding:12px;font-size:12px;color:var(--text-sub);line-height:1.7">
      この機能を使うには、データベースの準備が必要です。<br>
      supabase/migration-genba76.sql を実行してください。</div>`;
    return;
  }

  const rows = rlRows();
  const sum = rows.reduce((s,r)=>s+r.total, 0);
  const cnt = document.getElementById('rl-count');
  if(cnt) cnt.innerHTML = rows.length
    ? `${rows.length}件　合計 <b>¥${fmt(sum)}</b>`
    : '0件';

  if(!rows.length){
    el.innerHTML = `<div class="card"><div class="empty" style="padding:20px;line-height:1.8">
      ${receiptLedger.length ? '該当するレシートがありません'
        : 'まだレシートがありません<br><span style="font-size:11px;color:var(--text-muted)">受発注でレシートを読み取って発注を確定すると、ここに残ります</span>'}
    </div></div>`;
    return;
  }

  el.innerHTML = rows.map(r=>{
    const taxNote = (r.taxRows||[]).length
      ? (r.taxRows||[]).map(t=>`${t.rate===0?'非課税':t.rate+'%'} ¥${fmt(t.incl)}`).join('　')
      : '';
    const items = (r.items||[]).slice(0,4).map(i=>esc(i.name)).join('、')
      + ((r.items||[]).length>4 ? ` ほか${r.items.length-4}件` : '');
    return `<div class="rl-row">
      <div class="rl-thumb" id="rl-thumb-${r.id}" onclick="rlOpenImage(${r.id})"
        title="${r.filePath?'タップで大きく見る':'画像がありません'}">${r.filePath?'':'—'}</div>
      <div class="rl-info">
        <div class="rl-top">
          <span class="rl-date">${String(r.paidOn||'').replace(/-/g,'/')}</span>
          <span class="rl-shop">${esc(r.shop||'（店名なし）')}</span>
          <span class="rl-total">¥${fmt(r.total)}</span>
        </div>
        <div class="rl-sub">${esc(r.project||'')}${r.costType?`　${esc(r.costType)}`:''}${
          r.paymentMethod?`　${esc(r.paymentMethod)}`:''}</div>
        ${taxNote?`<div class="rl-sub">${taxNote}　（税抜 ¥${fmt(r.subtotal)}＋消費税 ¥${fmt(r.tax)}）</div>`:''}
        ${items?`<div class="rl-items">${items}</div>`:''}
        <div class="rl-sub" style="color:var(--text-muted)">${r.orderNo?`発注 ${esc(r.orderNo)}　`:''}${esc(r.createdByName||'')}</div>
      </div>
      ${currentUserRole==='staff'?`<button class="btn danger xs rl-del" onclick="rlDelete(${r.id})" title="台帳から消す">×</button>`:''}
    </div>`;
  }).join('');

  // サムネイルは、行を出したあとで順に読み込む（一気に出すと重いので）
  rows.forEach(r=>{ if(r.filePath) rlLoadThumb(r); });
}

async function rlLoadThumb(r){
  const box = document.getElementById('rl-thumb-' + r.id);
  if(!box || box.dataset.done) return;
  box.dataset.done = '1';
  try{
    const url = _rlThumbs[r.id] || await dbReceiptUrl(r.filePath);
    _rlThumbs[r.id] = url;
    box.style.backgroundImage = `url("${url}")`;
    box.textContent = '';
  }catch(_){ box.textContent = '×'; }
}

async function rlOpenImage(id){
  const r = (receiptLedger||[]).find(x=>x.id===id);
  if(!r || !r.filePath){ showToast('この記録には画像がありません'); return; }
  try{
    const url = _rlThumbs[r.id] || await dbReceiptUrl(r.filePath);
    _rlThumbs[r.id] = url;
    window.open(url, '_blank');
  }catch(_){}
}

async function rlDelete(id){
  if(currentUserRole!=='staff'){ showToast('台帳から消せるのは管理者だけです'); return; }
  const r = (receiptLedger||[]).find(x=>x.id===id);
  if(!r) return;
  if(!confirm(`${String(r.paidOn).replace(/-/g,'/')}　${r.shop||''}　¥${fmt(r.total)}\n\nこのレシートを台帳から消します。画像も一緒に消えます。\n（発注・原価の記録はそのまま残ります）\n\nよろしいですか？`)) return;
  try{ await dbDeleteReceipt(r); showToast('台帳から消しました'); renderReceiptLedger(); }catch(_){}
}

// ── 台帳を紙に並べて印刷する ──
//
// 添付いただいた見本のように、整えたレシートを横に並べて貼った形にする。
// 下に日付・店名・金額の一覧も付けて、数字で確かめられるようにする。
async function printReceiptLedger(){
  const rows = rlRows();
  if(!rows.length){ showToast('印刷するレシートがありません'); return; }
  showToast('台帳を用意しています…', 8000);

  // 画像のリンクをまとめて作る
  const urls = {};
  for(const r of rows){
    if(!r.filePath) continue;
    try{ urls[r.id] = _rlThumbs[r.id] || await dbReceiptUrl(r.filePath); _rlThumbs[r.id] = urls[r.id]; }catch(_){}
  }

  const title = rlMonth ? `${rlMonth.replace('-','年')}月のレシート` : 'レシート台帳';
  const sum = rows.reduce((s,r)=>s+r.total, 0);
  const cards = rows.map(r=>`
    <div class="card">
      ${urls[r.id] ? `<img src="${urls[r.id]}" alt="">` : '<div class="noimg">画像なし</div>'}
      <div class="cap"><b>${String(r.paidOn||'').replace(/-/g,'/')}</b>　${esc(r.shop||'')}<br>¥${fmt(r.total)}</div>
    </div>`).join('');
  const list = rows.map((r,i)=>`<tr>
      <td class="c">${i+1}</td>
      <td>${String(r.paidOn||'').replace(/-/g,'/')}</td>
      <td>${esc(r.shop||'')}</td>
      <td>${esc(r.project||'')}</td>
      <td>${esc(r.costType||'')}</td>
      <td>${esc(r.paymentMethod||'')}</td>
      <td class="r">¥${fmt(r.subtotal)}</td>
      <td class="r">¥${fmt(r.tax)}</td>
      <td class="r"><b>¥${fmt(r.total)}</b></td>
    </tr>`).join('');

  printHtml(title, `
    <style>
      @page{ size:A4 portrait; margin:10mm }
      h2{ font-size:15px; margin:0 0 2mm }
      .head{ font-size:11px; color:#666; margin-bottom:4mm }
      .grid{ display:flex; flex-wrap:wrap; gap:4mm; align-items:flex-start }
      .card{ width:44mm; border:0.4pt solid #bbb; border-radius:2mm; padding:2mm;
             background:#fff; break-inside:avoid; page-break-inside:avoid; text-align:center }
      .card img{ width:100%; height:auto; max-height:90mm; object-fit:contain; display:block }
      .noimg{ height:30mm; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:10px }
      .cap{ font-size:9px; line-height:1.5; margin-top:1mm; word-break:break-all }
      table{ width:100%; border-collapse:collapse; font-size:10px; margin-top:6mm }
      th{ background:#eee; padding:2px 4px; text-align:left; font-weight:700 }
      td{ border-bottom:0.4pt solid #ddd; padding:2px 4px }
      td.r,th.r{ text-align:right } td.c,th.c{ text-align:center }
      tfoot td{ font-weight:700; border-top:1pt solid #888 }
    </style>
    <h2>${esc(title)}</h2>
    <div class="head">${rows.length}件　合計 ¥${fmt(sum)}　／　作成 ${localYmd(new Date()).replace(/-/g,'/')}${
      rlKeyword?`　絞り込み：${esc(rlKeyword)}`:''}</div>
    <div class="grid">${cards}</div>
    <table>
      <thead><tr><th class="c">No.</th><th>日付</th><th>店名</th><th>案件</th><th>勘定科目</th><th>支払</th>
        <th class="r">税抜</th><th class="r">消費税</th><th class="r">税込</th></tr></thead>
      <tbody>${list}</tbody>
      <tfoot><tr><td colspan="8" class="r">合計</td><td class="r">¥${fmt(sum)}</td></tr></tfoot>
    </table>`);
}
