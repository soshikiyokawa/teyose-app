// ════ 請求書（発注先が月ごとに送る／社内が一覧で確認する） ════
//
// 保存名は「業者名＋請求月」（例：野地木材_2026年08月）。
// ファイルそのものは非公開の保管場所に置き、開くときだけ1時間有効なリンクを作る。
// 発注先は自社の分だけ、社内は全社分を見られる（migration-genba38.sql）。

function invMonthNow(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function invMonthLabel(m){
  const [y,mo]=String(m||'').split('-');
  return y&&mo ? `${y}年${mo}月` : (m||'');
}
function invTitle(supplierName, month){
  const [y,mo]=String(month||'').split('-');
  return `${supplierName}_${y}年${mo}月`;
}
const invIsStaff = () => currentUserRole==='staff';
const invIsSupplier = () => currentUserRole==='supplier';

// 絞り込み（社内のみ使う）
let invFilterSupplier = '';
let invFilterMonth = '';

function renderInvoices(){
  const el=document.getElementById('invoice-body');
  if(!el) return;
  if(!invoicesReady){
    el.innerHTML=`<div class="card" style="padding:12px;font-size:12px;color:var(--text-sub);line-height:1.7">
      この機能を使うには、データベースの準備が必要です。<br>
      ${invIsStaff()?'supabase/migration-genba38.sql を実行してください。':'きよかわの担当者にご連絡ください。'}
    </div>`;
    return;
  }
  renderInvoiceForm();

  let list=(invoices||[]).slice();
  // 発注先には自社の分だけ（データベース側でも絞っているが、画面でも念のため）
  if(invIsSupplier()) list=list.filter(v=>v.supplierId===currentUserSupplierId);
  if(invIsStaff()){
    if(invFilterSupplier) list=list.filter(v=>v.supplierName===invFilterSupplier);
    if(invFilterMonth)    list=list.filter(v=>v.month===invFilterMonth);
  }

  // 絞り込みの選択肢
  const fw=document.getElementById('invoice-filter');
  if(fw){
    fw.style.display = invIsStaff() ? 'flex' : 'none';
    if(invIsStaff()){
      const sups=[...new Set((invoices||[]).map(v=>v.supplierName).filter(Boolean))].sort();
      const months=[...new Set((invoices||[]).map(v=>v.month).filter(Boolean))].sort().reverse();
      fw.innerHTML=`
        <select onchange="invFilterSupplier=this.value;renderInvoices()" style="width:auto;font-size:12px;padding:4px 8px">
          <option value="">発注先：すべて</option>
          ${sups.map(s=>`<option value="${esc(s)}"${invFilterSupplier===s?' selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select onchange="invFilterMonth=this.value;renderInvoices()" style="width:auto;font-size:12px;padding:4px 8px">
          <option value="">請求月：すべて</option>
          ${months.map(m=>`<option value="${m}"${invFilterMonth===m?' selected':''}>${invMonthLabel(m)}</option>`).join('')}
        </select>
        <span style="font-size:11px;color:var(--text-sub)">${list.length}件${
          list.length?`　合計 ¥${fmt(list.reduce((s,v)=>s+(v.amount||0),0))}`:''}</span>`;
    }
  }

  el.innerHTML = list.length
    ? `<div class="card" style="padding:0;overflow:hidden">${list.map(invRowHtml).join('')}</div>`
    : `<div class="card"><div class="empty" style="padding:20px">${
        invIsSupplier()?'まだ請求書を送っていません':'請求書はまだ届いていません'}</div></div>`;
}

function invRowHtml(v){
  return `<div class="leave-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;font-weight:700">${esc(v.title||invTitle(v.supplierName,v.month))}</div>
      <div style="font-size:11px;color:var(--text-sub)">
        ${esc(v.fileName||'ファイル')}${v.amount?`　<b>¥${fmt(v.amount)}</b>`:''}
        <span style="color:var(--text-muted)">　送信 ${(v.createdAt||'').slice(0,10).replace(/-/g,'/')}${v.uploadedBy?'（'+esc(v.uploadedBy)+'）':''}</span>
      </div>
      ${v.note?`<div style="font-size:11px;color:var(--text-muted)">${esc(v.note)}</div>`:''}
    </div>
    <button class="btn xs primary" onclick="openInvoice(${v.id})">開く</button>
    ${invIsStaff()?`<button class="btn xs danger" onclick="deleteInvoice(${v.id})">削除</button>`:''}
  </div>`;
}

// ── 送信フォーム（発注先。管理者は代理で入れられる） ──
function renderInvoiceForm(){
  const wrap=document.getElementById('invoice-form');
  if(!wrap) return;
  const canSend = invIsSupplier() || invIsStaff();
  wrap.style.display = canSend ? '' : 'none';
  // 入力中の内容を消さないよう、作り直すのは初回と権限が変わったときだけ
  if(!canSend || wrap.dataset.built===currentUserRole) return;
  wrap.dataset.built=currentUserRole;
  const supOpts = invIsStaff()
    ? `<select id="invc-supplier" style="width:auto;font-size:12px;padding:4px 8px">
         ${(suppliers||[]).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}
       </select>`
    : `<span style="font-size:12px;font-weight:700">${esc(currentUserDisplayName||'')}</span>`;
  wrap.innerHTML=`
    <div class="card" style="padding:12px">
      <div style="font-size:12px;font-weight:700;margin-bottom:8px">請求書を送る</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:11px;color:var(--text-sub)">発注先</span>${supOpts}
        <span style="font-size:11px;color:var(--text-sub)">請求月</span>
        <input type="month" id="invc-month" value="${invMonthNow()}" style="width:auto;font-size:12px;padding:3px 6px">
        <span style="font-size:11px;color:var(--text-sub)">請求額（任意）</span>
        <input type="number" id="invc-amount" placeholder="0" style="width:110px;font-size:12px;padding:3px 6px;text-align:right">
      </div>
      <input type="file" id="invc-file" accept="application/pdf,image/*" style="font-size:12px;width:100%">
      <input id="invc-note" placeholder="備考（任意）" style="font-size:12px;margin-top:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
        <span style="font-size:11px;color:var(--text-muted);flex:1" id="invc-hint">
          PDFか写真を選んでください。「業者名＋請求月」の名前で保存されます</span>
        <button class="btn primary" id="invc-send" onclick="sendInvoice()">送信</button>
      </div>
    </div>`;
}

async function sendInvoice(){
  const fileEl=document.getElementById('invc-file');
  const file=fileEl.files?.[0];
  const month=document.getElementById('invc-month').value;
  if(!file){ showToast('請求書のファイルを選んでください'); return; }
  if(!month){ showToast('請求月を選んでください'); return; }
  if(file.size > 25*1024*1024){ showToast('ファイルが大きすぎます（25MBまで）'); return; }

  let supplierId, supplierName;
  if(invIsStaff()){
    supplierId=Number(document.getElementById('invc-supplier').value)||null;
    supplierName=(suppliers||[]).find(s=>s.id===supplierId)?.name||'';
    if(!supplierId){ showToast('発注先を選んでください'); return; }
  }else{
    supplierId=currentUserSupplierId;
    supplierName=currentUserDisplayName||'';
    if(!supplierId){ showToast('発注先の情報が取得できませんでした'); return; }
  }
  // 同じ月に送っていないか確認（差し替えの送り直しは止めない）
  const dup=(invoices||[]).find(v=>v.supplierId===supplierId && v.month===month);
  if(dup && !confirm(`${invTitle(supplierName,month)} はすでに送信済みです。追加で送りますか？`)) return;

  const btn=document.getElementById('invc-send');
  btn.disabled=true; btn.textContent='送信中…';
  try{
    await dbAddInvoice({supplierId, supplierName, month, file,
      amount:parseInt(document.getElementById('invc-amount').value)||null,
      note:document.getElementById('invc-note').value.trim()});
    await fetchInvoices();
    fileEl.value=''; document.getElementById('invc-amount').value=''; document.getElementById('invc-note').value='';
    renderInvoices();
    showToast(`${invTitle(supplierName,month)} を送信しました`);
    // 社内に知らせる（発注先から送られたときだけ）
    if(invIsSupplier()){
      dbSendPushToRole('staff', '請求書が届きました',
        `${invTitle(supplierName,month)}`, 'order/invoice').catch(()=>{});
    }
  }catch(_){
  }finally{
    btn.disabled=false; btn.textContent='送信';
  }
}

async function openInvoice(id){
  const v=(invoices||[]).find(x=>x.id===id);
  if(!v) return;
  try{
    const url=await dbInvoiceUrl(v.filePath);
    window.open(url,'_blank');
  }catch(_){}
}

async function deleteInvoice(id){
  const v=(invoices||[]).find(x=>x.id===id);
  if(!v) return;
  if(!confirm(`${v.title||invTitle(v.supplierName,v.month)} を削除しますか？\nこの操作は元に戻せません。`)) return;
  try{
    await dbDeleteInvoice(v);
    invoices=invoices.filter(x=>x.id!==id);
    renderInvoices();
    showToast('削除しました');
  }catch(_){}
}
