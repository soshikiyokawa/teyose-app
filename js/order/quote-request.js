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
  if(typeof fillStaffSelect==='function') fillStaffSelect('qr-staff');
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
    createdByName: document.getElementById('qr-staff')?.value || currentUserDisplayName || '' };

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
      <button class="btn xs primary" onclick="openQuoteAnswer(${q.id})">${q.status==='answered'?'回答を見る':'回答を入力'}</button>
      ${currentUserRole==='staff'?`<button class="btn danger xs" onclick="quoteDelete(${q.id})">×</button>`:''}
    </div>`;
  }).join('');
}

// ════ 見積の回答を入れる ════
//
// 発注先から返ってきた単価を、品目ごとに入れる。
// そのまま品目マスタに登録できるので、次からは発注書にそのまま使える。
//   ・マスタに同じ品目があれば、単価だけ入れ替える（変更履歴も残る）
//   ・無ければ新しく追加する
let qaId = null;      // いま回答を入れている見積依頼
let qaRows = [];      // 画面の行

function openQuoteAnswer(id){
  const q = (quoteRequests||[]).find(x=>x.id===id);
  if(!q){ showToast('その見積依頼が見つかりません'); return; }
  qaId = id;
  // 同じ発注先の品目マスタから、品名が一致するものを探しておく
  qaRows = (q.items||[]).map(it=>{
    const hit = (master||[]).find(m=>m.supplier===q.supplierName && m.name===it.name);
    return {
      name: it.name, spec: it.spec||'', qty: it.qty, unit: it.unit||'式',
      price: (it.price==null ? '' : it.price),
      cat: hit?.cat || '',
      toMaster: true,
      existingId: hit?.id || null,
      existingCost: hit?.cost ?? null,
    };
  });
  document.getElementById('qa-title').textContent = `${q.supplierName}　${q.project}`;
  document.getElementById('qa-sub').textContent = `${q.no}${q.replyBy?`　回答希望 ${String(q.replyBy).replace(/-/g,'/')}`:''}`;
  // 分類の候補は、いまのマスタにあるものから作る
  const cats = [...new Set((master||[]).map(m=>m.cat).filter(Boolean))].sort();
  document.getElementById('qa-cat-list').innerHTML = cats.map(c=>`<option value="${esc(c)}">`).join('');
  renderQuoteAnswerRows();
  document.getElementById('qa-modal').classList.add('open');
}
function closeQuoteAnswer(){
  qaId = null; qaRows = [];
  document.getElementById('qa-modal').classList.remove('open');
}
function qaSet(i, field, v){
  if(!qaRows[i]) return;
  qaRows[i][field] = (field==='price') ? (v==='' ? '' : (parseFloat(String(v).replace(/,/g,''))||0)) : v;
  if(field==='price' || field==='toMaster') renderQuoteAnswerRows();
}
function qaToggle(i, on){ if(qaRows[i]) qaRows[i].toMaster = !!on; renderQuoteAnswerRows(); }

function renderQuoteAnswerRows(){
  const el = document.getElementById('qa-rows');
  if(!el) return;
  el.innerHTML = qaRows.map((r,i)=>{
    const changed = r.existingId && r.price!=='' && Number(r.price)!==Number(r.existingCost);
    return `<div class="qa-row">
      <div class="qa-name">${esc(r.name)}${r.spec?`<span class="qa-spec">${esc(r.spec)}</span>`:''}</div>
      <div class="qa-line">
        <span class="qa-qty">${r.qty}${esc(r.unit)}</span>
        <span style="font-size:11px;color:var(--text-muted)">単価</span>
        <input class="qa-input num" type="text" inputmode="numeric" value="${r.price===''?'':r.price}"
          placeholder="—" onchange="qaSet(${i},'price',this.value)">
        <span style="font-size:11px;color:var(--text-muted)">円/${esc(r.unit)}</span>
        ${r.price!=='' ? `<span class="qa-amt">¥${fmt(Number(r.price)*Number(r.qty||0))}</span>` : ''}
      </div>
      <div class="qa-line">
        <label class="qa-chk"><input type="checkbox" ${r.toMaster?'checked':''} onchange="qaToggle(${i},this.checked)">
          品目マスタに${r.existingId?'反映':'登録'}</label>
        ${r.toMaster ? `<input class="qa-input qa-cat" value="${esc(r.cat)}" placeholder="分類（例：木材）"
            list="qa-cat-list" onchange="qaSet(${i},'cat',this.value)">` : ''}
        ${r.existingId
          ? `<span class="qa-note">${changed ? `いまの単価 ¥${fmt(r.existingCost)} → 入れ替え` : 'マスタにあります'}</span>`
          : '<span class="qa-note">新しく追加します</span>'}
      </div>
    </div>`;
  }).join('');
  const n = qaRows.filter(r=>r.price!=='').length;
  const m = qaRows.filter(r=>r.toMaster && r.price!=='').length;
  const info = document.getElementById('qa-info');
  if(info) info.textContent = `${qaRows.length}品目中 ${n}件に単価を入れました（うち${m}件をマスタに反映）`;
}

async function saveQuoteAnswer(){
  const q = (quoteRequests||[]).find(x=>x.id===qaId);
  if(!q) return;
  const filled = qaRows.filter(r=>r.price!=='');
  if(!filled.length){ showToast('単価を入れてください'); return; }

  const btn = document.getElementById('qa-save-btn');
  btn.disabled = true; btn.textContent = '保存中…';
  let added = 0, updated = 0, failed = 0;
  try{
    // ① 見積依頼に回答の単価を残す
    const items = (q.items||[]).map((it,i)=>{
      const r = qaRows[i];
      return (r && r.price!=='') ? {...it, price:Number(r.price)} : it;
    });
    await dbSaveQuoteAnswer(q.id, items);

    // ② 品目マスタに反映する
    for(const r of qaRows){
      if(!r.toMaster || r.price==='') continue;
      try{
        if(r.existingId){
          const prev = (master||[]).find(m=>m.id===r.existingId);
          if(prev && Number(prev.cost) !== Number(r.price)){
            // 単価の入れ替えは履歴に残す（いつ・いくらから変わったかを追えるように）
            await dbSaveItemPrice(prev, Number(r.price), localYmd(new Date()));
            prev.cost = Number(r.price); prev.price = Number(r.price);
            updated++;
          }
        }else{
          await dbAddMasterItem({
            cat: String(r.cat||'').trim() || 'その他',
            name: r.name, unit: r.unit,
            cost: Number(r.price), price: Number(r.price),
            supplier: q.supplierName,
            makerCode: r.spec || '',
            shipping: 0, shippingPer: 'order', perBundle: 0,
          });
          added++;
        }
      }catch(_){ failed++; }
    }
  }catch(e){
    btn.disabled = false; btn.textContent = '回答を保存';
    return;
  }
  btn.disabled = false; btn.textContent = '回答を保存';

  const parts = [`${filled.length}品目の単価を記録しました`];
  if(added)   parts.push(`${added}件を品目マスタに追加`);
  if(updated) parts.push(`${updated}件の単価を入れ替え`);
  if(failed)  parts.push(`${failed}件はマスタに反映できませんでした`);
  showToast('✅ ' + parts.join('／'), 7000);

  closeQuoteAnswer();
  renderQuoteHistory();
  if(typeof renderMaster==='function') renderMaster();
  if(typeof renderTalkPanelMessages==='function') renderTalkPanelMessages();
}

// 回答の入力を開かずに「回答あり」だけにする（金額は入れない場合）
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
