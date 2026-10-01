// ════ 見積依頼（発注の前に、発注先へ見積をお願いする） ════
//
// 発注作成とよく似た流れ。違うのは「単価を書かない」こと。
//   ① 発注先を選ぶ
//   ② 見積してほしい品目を並べる（品名・仕様・数量・単位）
//   ③ 案件名と見積回答希望日を入れる
//   ④ 見積依頼書を確かめて送る（チャット・ChatWork・メールは発注先の設定どおり）

let qrSupplier = null;        // 選んだ発注先
let qrItems = [];             // 見積してほしい品目
let qrCurrent = null;         // 送る直前の中身

function renderQuotePage(){
  // 発注先を選ぶ前は、品目の欄を出さない
  document.getElementById('qr-step1').style.display = qrSupplier ? 'none' : '';
  document.getElementById('qr-step2').style.display = qrSupplier ? '' : 'none';
  if(!qrSupplier){ renderQuoteSupplierList(); return; }
  document.getElementById('qr-supplier-name').textContent = qrSupplier.name;
  // 案件名は打ってもよいが、いまある案件から選べるようにしておく
  const dl = document.getElementById('qr-project-list');
  if(dl) dl.innerHTML = (projects||[]).map(p=>`<option value="${esc(p.name)}">`).join('');
  renderQuoteItems();
  renderQuoteHistory();
  updateQuoteBtnState();
}

function renderQuoteSupplierList(){
  const el = document.getElementById('qr-supplier-list');
  if(!el) return;
  const list = (suppliers||[]).filter(s=>s.name!=='在庫分');
  el.innerHTML = list.length
    ? list.map(s=>`<button class="sup-thread-row" style="width:100%;text-align:left" onclick="qrPickSupplier(${s.id})">
        <div class="sup-thread-icon">🏪</div>
        <div class="sup-thread-info">
          <div class="sup-thread-name">${esc(s.name)}</div>
          <div class="sup-thread-preview">${esc(s.cats||'')}${s.contact&&s.contact!=='—'?`　担当：${esc(s.contact)}`:''}</div>
        </div>
      </button>`).join('')
    : '<div class="empty" style="padding:16px">発注先が登録されていません</div>';
}
function qrPickSupplier(id){
  qrSupplier = (suppliers||[]).find(s=>s.id===id) || null;
  if(qrSupplier && !qrItems.length) qrAddItem();
  renderQuotePage();
}
function qrBackToSupplier(){ qrSupplier = null; renderQuotePage(); }

// ── 品目 ──
function qrAddItem(){
  qrItems.push({ name:'', spec:'', qty:1, unit:'式' });
  renderQuoteItems();
  setTimeout(()=>{
    const els = document.querySelectorAll('#qr-items .qr-name');
    els[els.length-1]?.focus();
  }, 30);
}
function qrSetItem(i, field, v){
  if(!qrItems[i]) return;
  qrItems[i][field] = (field==='qty') ? (parseFloat(v)||0) : v;
  updateQuoteBtnState();
}
function qrRemoveItem(i){ qrItems.splice(i,1); renderQuoteItems(); }

// 品目マスタから選んで入れる（よく使うものを打ち直さずに済む）
function qrPickFromMaster(){
  const el = document.getElementById('qr-master-list');
  const box = document.getElementById('qr-master-box');
  if(!el || !box) return;
  const open = box.style.display !== 'none';
  box.style.display = open ? 'none' : '';
  if(open) return;
  const mine = (master||[]).filter(m=>!qrSupplier || m.supplier===qrSupplier.name);
  const list = mine.length ? mine : (master||[]);
  el.innerHTML = list.length
    ? list.map(m=>`<button type="button" class="btn xs" style="margin:2px" onclick="qrAddFromMaster(${m.id})">${esc(m.name)}</button>`).join('')
    : '<span style="font-size:11px;color:var(--text-muted)">品目マスタが空です</span>';
}
function qrAddFromMaster(id){
  const m = (master||[]).find(x=>x.id===id);
  if(!m) return;
  qrItems.push({ name:m.name, spec:m.makerCode||'', qty:1, unit:m.unit||'式' });
  renderQuoteItems();
}

function renderQuoteItems(){
  const el = document.getElementById('qr-items');
  if(!el) return;
  el.innerHTML = qrItems.length ? qrItems.map((it,i)=>`
    <div class="qr-row">
      <input class="qr-input qr-name" value="${esc(it.name)}" placeholder="品名（例：ヒノキ 柱 4寸角）"
        oninput="qrSetItem(${i},'name',this.value)">
      <input class="qr-input qr-spec" value="${esc(it.spec)}" placeholder="仕様・品番など（任意）"
        oninput="qrSetItem(${i},'spec',this.value)">
      <div class="qr-qty">
        <input class="qr-input num" type="number" min="0" step="any" value="${it.qty}"
          oninput="qrSetItem(${i},'qty',this.value)">
        <input class="qr-input unit" value="${esc(it.unit)}" placeholder="単位"
          oninput="qrSetItem(${i},'unit',this.value)">
        <button type="button" class="btn danger xs" onclick="qrRemoveItem(${i})" title="この行を消す">×</button>
      </div>
    </div>`).join('')
    : '<div class="empty" style="padding:14px">「＋ 品目を追加」から、見積してほしいものを入れてください</div>';
  updateQuoteBtnState();
}

function updateQuoteBtnState(){
  const btn = document.getElementById('qr-preview-btn');
  if(!btn) return;
  const project = document.getElementById('qr-project')?.value.trim();
  const ok = !!(qrSupplier && project && qrItems.some(i=>String(i.name||'').trim()));
  btn.classList.toggle('btn-incomplete', !ok);
}

// ── 見積依頼書を確かめる ──
function openQuotePreview(){
  if(!qrSupplier){ showToast('発注先を選んでください'); return; }
  const project = document.getElementById('qr-project').value.trim();
  const replyBy = document.getElementById('qr-reply-by').value || '';
  const note = document.getElementById('qr-note').value.trim();
  const items = qrItems.map(i=>({ name:String(i.name||'').trim(), spec:String(i.spec||'').trim(),
    qty:Number(i.qty)||0, unit:String(i.unit||'式').trim()||'式' })).filter(i=>i.name);
  if(!project){ showToast('案件名を入力してください'); return; }
  if(!items.length){ showToast('見積してほしい品目を入れてください'); return; }

  const now = new Date();
  const no = 'Q' + now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0')
    + String(now.getHours()).padStart(2,'0') + String(now.getMinutes()).padStart(2,'0');
  qrCurrent = { no, date: localYmd(now), project, replyBy, note, items,
    supplierName: qrSupplier.name, supplierObj: qrSupplier,
    createdByName: currentUserDisplayName || '' };

  document.getElementById('qr-pdf-body').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
      <div><div style="font-size:22px;font-weight:900;letter-spacing:.04em;color:#2a1e0e;margin-bottom:2px">見 積 依 頼 書</div>
        <div style="font-size:11px;color:#888">Request for Quotation</div></div>
      <div style="text-align:right;font-size:11px;color:#555;line-height:1.7">
        <div style="font-weight:800;font-size:13px;color:#2a1e0e">${COMPANY.name}</div>
        <div>${COMPANY.zip} ${COMPANY.address}</div><div>TEL：${COMPANY.tel}</div>
        <div style="color:#5c7a3e">${COMPANY.url}</div>
        ${qrCurrent.createdByName?`<div style="color:#2a1e0e">担当者：${esc(qrCurrent.createdByName)}</div>`:''}
      </div>
    </div>
    <div style="background:#f7f3eb;border-radius:7px;padding:10px 12px;margin-bottom:16px;font-size:12px;line-height:1.9">
      <div><span style="color:#888">発注先：</span><strong>${esc(qrSupplier.name)}</strong>　御中</div>
      <div style="display:flex;gap:16px"><div style="flex:1"><span style="color:#888">依頼番号：</span><strong>${no}</strong></div>
        <div style="flex:1"><span style="color:#888">依頼日：</span><strong>${qrCurrent.date}</strong></div></div>
      <div><span style="color:#888">件名：</span><strong>${esc(project)}</strong></div>
      <div><span style="color:#888">見積回答希望日：</span><strong>${replyBy ? replyBy.replace(/-/g,'/') : 'ご都合のよい日'}</strong></div>
    </div>
    <div style="font-size:12px;margin-bottom:8px">下記につきまして、お見積りをお願いいたします。</div>
    <div style="display:flex;background:#2a1e0e;font-size:11px;color:#d4a96a">
      <div style="flex:3;padding:6px 8px">品目・仕様</div>
      <div style="flex:.8;padding:6px 8px;text-align:center">単位</div>
      <div style="flex:.8;padding:6px 8px;text-align:right">数量</div>
      <div style="flex:1.2;padding:6px 8px;text-align:right">単価</div>
      <div style="flex:1.2;padding:6px 8px;text-align:right">金額</div>
    </div>
    ${items.map(i=>`<div style="display:flex;font-size:12px;border-bottom:0.5px solid #e8e0d0">
      <div style="flex:3;min-width:0;padding:6px 8px;word-break:break-word">${esc(i.name)}${
        i.spec?`<div style="font-size:10px;color:#888">${esc(i.spec)}</div>`:''}</div>
      <div style="flex:.8;padding:6px 8px;text-align:center">${esc(i.unit)}</div>
      <div style="flex:.8;padding:6px 8px;text-align:right">${i.qty}</div>
      <div style="flex:1.2;padding:6px 8px;text-align:right;color:#bbb">—</div>
      <div style="flex:1.2;padding:6px 8px;text-align:right;color:#bbb">—</div>
    </div>`).join('')}
    <div style="text-align:right;font-size:10px;color:#888;margin-top:6px">単価・金額の欄はご記入ください</div>
    ${note?`<div style="margin-top:14px;border:1px solid #e0d8c8;border-radius:6px;padding:8px 10px;font-size:12px;color:#4a3010;white-space:pre-wrap"><b style="font-size:11px;color:#888">備考</b><br>${esc(note)}</div>`:''}
    <div style="margin-top:14px;font-size:11px;color:#888;border-top:1px solid #e0d8c8;padding-top:10px;line-height:1.8">
      ${replyBy?`お手数ですが、${replyBy.replace(/-/g,'/')} までにご回答をお願いいたします。<br>`:''}
      ご回答は、手寄のチャット・メール・FAXのいずれでも構いません。<br>
      ※この書類は発注ではありません。お見積りのお願いです。
    </div>`;
  document.getElementById('qr-pdf-overlay').classList.add('open');
}
function closeQuotePdf(){ document.getElementById('qr-pdf-overlay').classList.remove('open'); }

// ── 送る ──
async function sendQuoteRequest(){
  if(!qrCurrent) return;
  const btn = document.getElementById('qr-send-btn');
  if(btn){ btn.disabled = true; btn.textContent = '送信中…'; }

  // PDFを作る（作れなくても依頼は送る）
  try{ qrCurrent.pdfUrl = await dbGenerateQuotePdf(qrCurrent); }
  catch(_){ qrCurrent.pdfUrl = ''; }

  try{
    await dbSendQuoteRequest(qrCurrent);
  }catch(e){
    if(btn){ btn.disabled = false; btn.textContent = '✓ 見積依頼を送る'; }
    return;
  }

  showToast(`✅ ${qrCurrent.supplierName}へ見積依頼を送りました`);
  qrItems = []; qrCurrent = null;
  document.getElementById('qr-project').value = '';
  document.getElementById('qr-reply-by').value = '';
  document.getElementById('qr-note').value = '';
  qrAddItem();
  closeQuotePdf();
  renderQuotePage();
  document.getElementById('nav-talk-dot').style.display = 'block';
  if(btn){ btn.disabled = false; btn.textContent = '✓ 見積依頼を送る'; }
}

// ── 送った見積依頼の一覧 ──
function renderQuoteHistory(){
  const el = document.getElementById('qr-history');
  if(!el) return;
  if(!quoteRequestsReady){
    el.innerHTML = '<div class="empty" style="padding:12px;font-size:12px">データベースの準備が必要です（supabase/migration-genba78.sql）</div>';
    return;
  }
  const list = (quoteRequests||[]).slice(0, 20);
  if(!list.length){ el.innerHTML = '<div class="empty" style="padding:14px">まだ見積依頼はありません</div>'; return; }
  el.innerHTML = list.map(q=>{
    const late = q.status==='sent' && q.replyBy && q.replyBy < localYmd(new Date());
    return `<div class="qr-hist">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(q.project)}</div>
        <div style="font-size:11px;color:var(--text-sub)">${esc(q.supplierName)}　${esc(q.no)}　${(q.items||[]).length}品目</div>
        <div style="font-size:11px;color:${late?'var(--danger)':'var(--text-muted)'}">
          ${q.replyBy?`回答希望 ${String(q.replyBy).replace(/-/g,'/')}${late?'（過ぎています）':''}`:'回答希望日なし'}
        </div>
      </div>
      <span class="badge ${q.status==='answered'?'approved':'sent'}" style="font-size:10px;flex-shrink:0">${
        q.status==='answered'?'回答あり':q.status==='closed'?'終了':'依頼中'}</span>
      ${q.pdfUrl?`<button class="btn xs" onclick="openPdfViewer('${q.pdfUrl}')">書類</button>`:''}
      ${q.status!=='answered'?`<button class="btn xs" onclick="quoteMarkAnswered(${q.id})">回答あり</button>`:''}
      ${currentUserRole==='staff'?`<button class="btn danger xs" onclick="quoteDelete(${q.id})">×</button>`:''}
    </div>`;
  }).join('');
}

async function quoteMarkAnswered(id){
  try{ await dbSetQuoteStatus(id, 'answered'); showToast('回答ありにしました'); }catch(_){ return; }
  renderQuoteHistory();
  if(typeof renderTalkPanelMessages==='function') renderTalkPanelMessages();
}
async function quoteDelete(id){
  const q = (quoteRequests||[]).find(x=>x.id===id);
  if(!q) return;
  if(!confirm(`${q.project}\n${q.supplierName}　${q.no}\n\nこの見積依頼の記録を消します。\n（チャットに送った書類は残ります）\n\nよろしいですか？`)) return;
  try{ await dbDeleteQuoteRequest(id); showToast('消しました'); }catch(_){ return; }
  renderQuoteHistory();
}
