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
// 請求月として正しい形か（YYYY-MM）
const invMonthOk = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m||''));
// 請求月の選択肢。今月から1年3か月ぶんさかのぼる＋翌月（先に送る場合）
// ＜input type="month"＞はSafariでただの文字入力になってしまうため、選ぶ形にしている
function invMonthOptions(){
  const d=new Date(), out=[];
  for(let k=-1;k<=15;k++){          // -1＝翌月、0＝今月、15＝15か月前
    const t=new Date(d.getFullYear(), d.getMonth()-k, 1);
    out.push(`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}`);
  }
  return out;                        // 新しい月から順
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
let invFilterState = '';     // ''＝すべて／'unpaid'＝未払い／'diff'＝差額あり

// ════ 請求月にあたる期間（締め日ぶんずらす） ════
//
// 月末締めなら 1日〜末日。20日締めなら 前月21日〜当月20日。
// 発注額との突き合わせは、この期間に出した発注を集めて行う。
const invFmtDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function invClosingDay(supplierName){
  return (suppliers||[]).find(s=>s.name===supplierName)?.closingDay || 0;
}
function invPeriod(month, closingDay){
  const [y,m]=String(month).split('-').map(Number);
  if(!y||!m) return null;
  if(!closingDay) return { from:`${month}-01`, to: invFmtDate(new Date(y, m, 0)) };
  return { from: invFmtDate(new Date(y, m-2, closingDay+1)), to: invFmtDate(new Date(y, m-1, closingDay)) };
}
function invPeriodLabel(p){
  const s=d=>String(d).slice(5).replace('-','/');
  return p ? `${s(p.from)}〜${s(p.to)}` : '';
}

// ════ ①発注額との突き合わせ ════
//
// その期間にその発注先へ出した発注の合計（税込）と、請求額を比べる。
// 発注の合計は単価の変更や送料の追加が入ったあとの金額なので、そのまま使える。
function invOrdersOf(v){
  const p = invPeriod(v.month, invClosingDay(v.supplierName));
  if(!p) return { period:null, list:[], total:0 };
  const list=(orders||[]).filter(o=>o.suppliers===v.supplierName && o.date>=p.from && o.date<=p.to);
  return { period:p, list, total:list.reduce((s,o)=>s+(Number(o.total)||0), 0) };
}
// 請求額と発注額の差。請求額が入っていないときは null
function invDiff(v){
  if(v.amount==null) return null;
  return v.amount - invOrdersOf(v).total;
}

// ════ ⑤インボイス（登録番号）の確認 ════
// 'ok'＝一致／'ng'＝食い違い／'none'＝請求書に番号が無い／''＝発注先に登録番号が未設定
function invRegState(v){
  const want=(suppliers||[]).find(s=>s.name===v.supplierName)?.invoiceRegNo || '';
  if(!want) return '';
  if(!v.regNo) return 'none';
  return v.regNo===want ? 'ok' : 'ng';
}

// ════ ③支払管理 ════
const invIsPaid = v => !!v.paidOn;
function invPayState(v){
  if(invIsPaid(v)) return 'paid';
  const today=invFmtDate(new Date());
  if(v.dueOn && v.dueOn < today) return 'over';    // 支払予定日を過ぎている
  return 'unpaid';
}

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
    if(invFilterState==='unpaid') list=list.filter(v=>!invIsPaid(v));
    if(invFilterState==='diff')   list=list.filter(v=>{ const d=invDiff(v); return d!==null && d!==0; });
  }

  // 絞り込みの選択肢
  const fw=document.getElementById('invoice-filter');
  if(fw){
    fw.style.display = invIsStaff() ? 'flex' : 'none';
    if(invIsStaff()){
      const sups=[...new Set((invoices||[]).map(v=>v.supplierName).filter(Boolean))].sort();
      const months=[...new Set((invoices||[]).map(v=>v.month).filter(Boolean))].sort().reverse();
      const sum   = list.reduce((s,v)=>s+(v.amount||0),0);
      const unpaid= list.filter(v=>!invIsPaid(v)).reduce((s,v)=>s+(v.amount||0),0);
      const diffN = list.filter(v=>{ const d=invDiff(v); return d!==null && d!==0; }).length;
      fw.innerHTML=`
        <select onchange="invFilterSupplier=this.value;renderInvoices()" style="width:auto;font-size:12px;padding:4px 8px">
          <option value="">発注先：すべて</option>
          ${sups.map(s=>`<option value="${esc(s)}"${invFilterSupplier===s?' selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select onchange="invFilterMonth=this.value;renderInvoices()" style="width:auto;font-size:12px;padding:4px 8px">
          <option value="">請求月：すべて</option>
          ${months.map(m=>`<option value="${m}"${invFilterMonth===m?' selected':''}>${invMonthLabel(m)}</option>`).join('')}
        </select>
        <select onchange="invFilterState=this.value;renderInvoices()" style="width:auto;font-size:12px;padding:4px 8px">
          <option value=""${invFilterState===''?' selected':''}>状態：すべて</option>
          <option value="unpaid"${invFilterState==='unpaid'?' selected':''}>未払いのみ</option>
          <option value="diff"${invFilterState==='diff'?' selected':''}>差額があるもの</option>
        </select>
        <button class="btn sm" onclick="printInvoiceList()">支払一覧を印刷</button>
        <span style="font-size:11px;color:var(--text-sub)">${list.length}件　請求 ¥${fmt(sum)}${
          unpaid?`　<b style="color:var(--warn-t)">未払い ¥${fmt(unpaid)}</b>`:''}${
          diffN?`　<b style="color:var(--danger)">差額あり ${diffN}件</b>`:''}</span>`;
    }
  }

  el.innerHTML = list.length
    ? `<div class="card" style="padding:0;overflow:hidden">${list.map(invRowHtml).join('')}</div>`
    : `<div class="card"><div class="empty" style="padding:20px">${
        invIsSupplier()?'まだ請求書を送っていません':'請求書はまだ届いていません'}</div></div>`;
}

function invRowHtml(v){
  const ord=invOrdersOf(v);
  const diff=invDiff(v);
  const reg=invRegState(v);
  const pay=invPayState(v);
  const PAY={paid:['支払済み','inv-ok'], over:['支払予定日を過ぎています','inv-ng'], unpaid:['未払い','inv-warn']};
  const REG={ok:['登録番号 一致','inv-ok'], ng:['登録番号が違います','inv-ng'], none:['登録番号なし','inv-warn']};

  // 発注額との突き合わせ（社内だけに出す。発注先には他社の情報が混ざらないよう出さない）
  const compare = invIsStaff() ? `
    <div class="inv-cmp">
      <span>発注 ¥${fmt(ord.total)}<i>（${ord.list.length}件・${invPeriodLabel(ord.period)}）</i></span>
      <span>請求 ${v.amount!=null?`¥${fmt(v.amount)}`:'—'}</span>
      ${diff===null ? '<span class="inv-warn">請求額が未入力</span>'
        : diff===0  ? '<span class="inv-ok">一致</span>'
        : `<span class="inv-ng">差額 ${diff>0?'＋':'−'}¥${fmt(Math.abs(diff))}</span>`}
      ${ord.list.length?`<button class="btn xs" onclick="showInvoiceOrders(${v.id})">発注の内訳</button>`:''}
    </div>` : '';

  return `<div class="leave-row" style="display:block">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${esc(v.title||invTitle(v.supplierName,v.month))}
          <span class="inv-tag ${PAY[pay][1]}">${PAY[pay][0]}</span>
          ${reg?`<span class="inv-tag ${REG[reg][1]}">${REG[reg][0]}</span>`:''}
        </div>
        <div style="font-size:11px;color:var(--text-sub)">
          ${esc(v.fileName||'ファイル')}${v.amount!=null?`　<b>¥${fmt(v.amount)}</b>`:''}
          <span style="color:var(--text-muted)">　送信 ${(v.createdAt||'').slice(0,10).replace(/-/g,'/')}${v.uploadedBy?'（'+esc(v.uploadedBy)+'）':''}</span>
        </div>
        ${v.note?`<div style="font-size:11px;color:var(--text-muted)">${esc(v.note)}</div>`:''}
      </div>
      <button class="btn xs primary" onclick="openInvoice(${v.id})">開く</button>
      ${invIsStaff()?`<button class="btn xs" onclick="openInvoiceLines(${v.id})">明細を現場に${
        ilLineCount(v.id) ? (ilUnassignedCount(v.id)
          ? `（<b style="color:var(--danger)">残${ilUnassignedCount(v.id)}</b>）` : '（済）') : ''}</button>
      <button class="btn xs" onclick="readInvoiceWithAi(${v.id})">AIで読む</button>
      <button class="btn xs" onclick="openInvoicePay(${v.id})">支払</button>
      <button class="btn xs danger" onclick="deleteInvoice(${v.id})">削除</button>`:''}
    </div>
    ${compare}
    ${invIsPaid(v)?`<div class="inv-paid">支払 ${String(v.paidOn).replace(/-/g,'/')}${
      v.paidAmount!=null?`　¥${fmt(v.paidAmount)}`:''}</div>`
      : v.dueOn?`<div class="inv-paid">支払予定 ${String(v.dueOn).replace(/-/g,'/')}</div>`:''}
  </div>`;
}

// 突き合わせのもとになった発注を見せる
function showInvoiceOrders(id){
  const v=(invoices||[]).find(x=>x.id===id); if(!v) return;
  const ord=invOrdersOf(v);
  const lines=ord.list.map(o=>`${o.date.replace(/-/g,'/')}　${o.no}　${o.project}　¥${fmt(o.total)}`).join('\n');
  alert(`${v.title||invTitle(v.supplierName,v.month)}\n対象期間 ${invPeriodLabel(ord.period)}\n\n`+
    (lines||'この期間の発注はありません')+`\n\n発注の合計 ¥${fmt(ord.total)}\n請求額 ${v.amount!=null?'¥'+fmt(v.amount):'未入力'}`);
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
  // 発注先の人には、保存名に使われる「会社の名前」を出す（担当者名ではない）
  const myName = (suppliers||[]).find(s=>s.id===currentUserSupplierId)?.name || currentUserDisplayName || '';
  const supOpts = invIsStaff()
    ? `<select id="invc-supplier" style="width:auto;font-size:12px;padding:4px 8px">
         ${(suppliers||[]).filter(s=>s.name!=='在庫分').map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}
       </select>`
    : `<span style="font-size:12px;font-weight:700">${esc(myName)}</span>`;
  wrap.innerHTML=`
    <div class="card" style="padding:12px">
      <div style="font-size:12px;font-weight:700;margin-bottom:8px">請求書を送る</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:11px;color:var(--text-sub)">発注先</span>${supOpts}
        <span style="font-size:11px;color:var(--text-sub)">請求月</span>
        <select id="invc-month" style="width:auto;font-size:12px;padding:4px 8px">
          ${invMonthOptions().map(m=>`<option value="${m}"${m===invMonthNow()?' selected':''}>${invMonthLabel(m)}</option>`).join('')}
        </select>
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
  // 請求月は保存名と保管場所に使うので、形が正しいことを必ず確かめる
  if(!invMonthOk(month)){ showToast('請求月を選んでください'); return; }
  if(file.size > 25*1024*1024){ showToast('ファイルが大きすぎます（25MBまで）'); return; }

  let supplierId, supplierName;
  if(invIsStaff()){
    supplierId=Number(document.getElementById('invc-supplier').value)||null;
    supplierName=(suppliers||[]).find(s=>s.id===supplierId)?.name||'';
    if(!supplierId){ showToast('発注先を選んでください'); return; }
  }else{
    supplierId=currentUserSupplierId;
    // 「業者名＋請求月」の名前にするので、担当者の名前ではなく会社の名前を使う
    // （1つの発注先に複数のアカウントがあっても同じ名前で並ぶようにするため）
    supplierName=(suppliers||[]).find(s=>s.id===currentUserSupplierId)?.name||currentUserDisplayName||'';
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

// ── ②AIで読み取る（請求額・登録番号・支払期限を埋める） ──
async function readInvoiceWithAi(id){
  const v=(invoices||[]).find(x=>x.id===id); if(!v) return;
  showToast('請求書を読み取っています…');
  let r;
  try{ r=await dbReadInvoice(v.filePath); }
  catch(e){ showToast('読み取りに失敗しました：'+e.message); return; }
  if(r.error){ showToast('読み取れませんでした：'+r.error); return; }
  if(r.total==null){ showToast('請求金額を見つけられませんでした'); return; }

  const want=(suppliers||[]).find(s=>s.name===v.supplierName)?.invoiceRegNo || '';
  const lines=[
    `請求金額　¥${fmt(r.total)}${v.amount!=null&&v.amount!==r.total?`（いまの登録 ¥${fmt(v.amount)}）`:''}`,
    r.regNo?`登録番号　${r.regNo}${want?(r.regNo===want?'（登録と一致）':'（登録は '+want+'）'):''}`:'登録番号　見つかりません',
    r.dueOn?`支払期限　${r.dueOn.replace(/-/g,'/')}`:'',
    r.month&&r.month!==v.month?`請求書の対象月は ${invMonthLabel(r.month)} と読めました（登録は ${invMonthLabel(v.month)}）`:'',
    r.issuer?`発行元　${r.issuer}`:'',
  ].filter(Boolean).join('\n');
  if(!confirm(`次のとおり読み取りました。この内容で登録しますか？\n\n${lines}`)) return;

  try{
    const { error } = await sb.from('invoices')
      .update({ amount:r.total, reg_no:r.regNo||'', read_by_ai:true,
                due_on: v.dueOn || r.dueOn || null })
      .eq('id', id);
    if(error) throw error;
  }catch(e){ showToast('登録に失敗しました：'+(e.message||'')); return; }

  Object.assign(v, { amount:r.total, regNo:r.regNo||'', readByAi:true, dueOn:v.dueOn||r.dueOn||'' });
  renderInvoices();
  const st=invRegState(v);
  showToast(st==='ng' ? '読み取りました。登録番号が発注先マスタと違います'
          : st==='none' ? '読み取りました。請求書に登録番号が見つかりません'
          : '読み取って登録しました');
}

// ── ③支払の記録 ──
let invPayId = null;
function openInvoicePay(id){
  if(!invIsStaff()){ showToast('支払の記録は管理者のみです'); return; }
  const v=(invoices||[]).find(x=>x.id===id); if(!v) return;
  invPayId=id;
  document.getElementById('invpay-title').textContent=v.title||invTitle(v.supplierName,v.month);
  document.getElementById('invpay-sub').textContent=
    `請求額 ${v.amount!=null?'¥'+fmt(v.amount):'未入力'}　／　発注額 ¥${fmt(invOrdersOf(v).total)}`;
  document.getElementById('invpay-due').value=v.dueOn||'';
  document.getElementById('invpay-on').value=v.paidOn||'';
  document.getElementById('invpay-amount').value=v.paidAmount!=null?v.paidAmount:(v.amount!=null?v.amount:'');
  document.getElementById('invpay-modal').classList.add('open');
}
function closeInvoicePay(){ document.getElementById('invpay-modal').classList.remove('open'); invPayId=null; }
function invPayToday(){
  document.getElementById('invpay-on').value=invFmtDate(new Date());
}
async function saveInvoicePay(){
  const v=(invoices||[]).find(x=>x.id===invPayId); if(!v) return;
  const dueOn=document.getElementById('invpay-due').value||'';
  const paidOn=document.getElementById('invpay-on').value||'';
  const raw=document.getElementById('invpay-amount').value;
  const paidAmount=raw===''?null:Math.max(0, Math.round(Number(String(raw).replace(/[^\d.]/g,''))||0));
  if(paidOn && paidAmount===null){ showToast('支払った金額を入れてください'); return; }
  try{ await dbSetInvoicePayment(v.id, {dueOn, paidOn, paidAmount}); }catch(e){ return; }
  Object.assign(v, {dueOn, paidOn, paidAmount});
  closeInvoicePay();
  renderInvoices();
  showToast(paidOn?'支払済みとして記録しました':'支払予定を記録しました');
}

// ── 支払一覧の印刷（振込のときの確認用） ──
function printInvoiceList(){
  let list=(invoices||[]).slice();
  if(invFilterSupplier) list=list.filter(v=>v.supplierName===invFilterSupplier);
  if(invFilterMonth)    list=list.filter(v=>v.month===invFilterMonth);
  if(invFilterState==='unpaid') list=list.filter(v=>!invIsPaid(v));
  if(invFilterState==='diff')   list=list.filter(v=>{ const d=invDiff(v); return d!==null && d!==0; });
  list.sort((a,b)=> (a.dueOn||'9999').localeCompare(b.dueOn||'9999') || a.supplierName.localeCompare(b.supplierName,'ja'));
  if(!list.length){ showToast('印刷するものがありません'); return; }

  const rows=list.map(v=>{
    const d=invDiff(v);
    return `<tr>
      <td>${esc(v.supplierName)}</td>
      <td>${invMonthLabel(v.month)}</td>
      <td class="r">${v.amount!=null?'¥'+fmt(v.amount):'—'}</td>
      <td class="r">¥${fmt(invOrdersOf(v).total)}</td>
      <td class="r">${d===null?'—':d===0?'一致':(d>0?'＋':'−')+'¥'+fmt(Math.abs(d))}</td>
      <td>${v.dueOn?String(v.dueOn).replace(/-/g,'/'):''}</td>
      <td>${invIsPaid(v)?String(v.paidOn).replace(/-/g,'/'):'未払い'}</td>
    </tr>`;
  }).join('');
  const sum=list.reduce((s,v)=>s+(v.amount||0),0);
  const unpaid=list.filter(v=>!invIsPaid(v)).reduce((s,v)=>s+(v.amount||0),0);
  printHtml('支払一覧', `
    <style>
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{background:#2a1e0e;color:#d4a96a;padding:5px 6px;text-align:left;font-weight:600}
      td{border-bottom:0.5px solid #e8e0d0;padding:5px 6px}
      td.r{text-align:right}
      @page{size:A4 portrait;margin:12mm}
    </style>
    <div style="font-size:17px;font-weight:800;margin-bottom:2px">支払一覧</div>
    <div style="font-size:11px;color:#888;margin-bottom:10px">
      ${invFilterSupplier?esc(invFilterSupplier)+'　':''}${invFilterMonth?invMonthLabel(invFilterMonth)+'　':''}
      ${invFilterState==='unpaid'?'未払いのみ　':''}${invFilterState==='diff'?'差額があるもの　':''}
      ${list.length}件　作成 ${invFmtDate(new Date()).replace(/-/g,'/')}
    </div>
    <table>
      <thead><tr><th>発注先</th><th>請求月</th><th style="text-align:right">請求額</th>
        <th style="text-align:right">発注額</th><th style="text-align:right">差額</th>
        <th>支払予定</th><th>支払日</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:10px;text-align:right;font-size:12px;line-height:1.9">
      <div>請求額の合計：¥${fmt(sum)}</div>
      <div style="font-weight:700">未払いの合計：¥${fmt(unpaid)}</div>
    </div>`);
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
