// ════ 請求書の明細を、現場ごとに割り当てる ════
//
// 建材店の請求書は「日付・現場名・品名・数量・金額」の行が並んでいる。
// これをAIで読み取って、行ごとにどの現場のものかを決める。
//   ・請求書に書かれた現場名から、案件を自動で当てる
//   ・現場名が無い行、どの案件か決められない行は、いちばん上に集めて選んでもらう
//
// 割り当てた金額は「請求原価」として、現場ごとに見積・発注と並べて比べられる。

let ilInvoiceId = null;   // いま割り当てている請求書
let ilRows = [];          // {rawProject, project, workDate, name, qty, unit, amount}

// 現場名を突き合わせるための正規化（様邸・工事などの飾りを落とす）
function ilNormProject(s){
  return String(s||'')
    .replace(/[\s　]/g,'')
    .replace(/(様邸|様方|邸宅|邸|様|御中)/g,'')
    .replace(/(新築|改修|解体|増築|リフォーム)?工事$/,'')
    .toLowerCase();
}
// 請求書に書かれた現場名から案件を推測する。1つに決まらないときは空にする
function ilGuessProject(raw){
  const r=ilNormProject(raw);
  if(!r) return '';
  const exact=(projects||[]).find(p=>p.name===String(raw).trim());
  if(exact) return exact.name;
  // 前に同じ現場名を割り当てたことがあれば、それを引き継ぐ（毎月選び直さなくてよい）
  const before=(invoiceLines||[]).filter(l=>l.project && ilNormProject(l.rawProject)===r);
  if(before.length){
    const names=[...new Set(before.map(l=>l.project))];
    if(names.length===1) return names[0];
  }
  const hits=(projects||[]).filter(p=>{
    const n=ilNormProject(p.name);
    return n && (n===r || n.includes(r) || r.includes(n));
  });
  return hits.length===1 ? hits[0].name : '';
}

const ilInvoice = () => (invoices||[]).find(v=>v.id===ilInvoiceId) || null;
// この請求書のまだ割り当てていない行の数
function ilUnassignedCount(invoiceId){
  return (invoiceLines||[]).filter(l=>l.invoiceId===invoiceId && !l.project).length;
}
function ilLineCount(invoiceId){
  return (invoiceLines||[]).filter(l=>l.invoiceId===invoiceId).length;
}

// ── 開く ──
async function openInvoiceLines(id){
  if(currentUserRole!=='staff'){ showToast('明細の割り当ては管理者のみです'); return; }
  const v=(invoices||[]).find(x=>x.id===id); if(!v) return;
  ilInvoiceId=id;
  const saved=(invoiceLines||[]).filter(l=>l.invoiceId===id);
  ilRows = saved.length ? saved.map(l=>({...l})) : [];
  const bulk=document.getElementById('il-bulk');
  bulk.innerHTML='<option value="">現場を選ぶ…</option>'
    + (projects||[]).map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')
    + '<option value="共通">共通（現場に紐づかない）</option>';
  ilRender();
  document.getElementById('il-modal').classList.add('open');
  if(!saved.length) ilReadWithAi();     // まだ読んでいなければ、開いた時点で読む
}
function closeInvoiceLines(){
  document.getElementById('il-modal').classList.remove('open');
  ilInvoiceId=null; ilRows=[];
}

// ── AIで読み取る ──
async function ilReadWithAi(){
  const v=ilInvoice(); if(!v) return;
  if(ilRows.length && !confirm('読み取り直すと、いまの割り当ては消えます。よろしいですか？')) return;
  const body=document.getElementById('il-body');
  body.innerHTML='<div class="empty" style="padding:24px">請求書を読み取っています…<br><span style="font-size:11px">明細が多いと1分ほどかかります</span></div>';
  let r;
  try{ r=await dbReadInvoice(v.filePath, v.supplierId); }
  catch(e){ body.innerHTML=`<div class="empty" style="padding:24px;color:var(--danger)">読み取りに失敗しました<br>${esc(e.message)}</div>`; return; }
  if(r.error){ body.innerHTML=`<div class="empty" style="padding:24px;color:var(--danger)">${esc(r.error)}</div>`; return; }

  ilRows=(r.lines||[]).map(l=>({
    rawProject:l.project||'', project:ilGuessProject(l.project), workDate:l.date||'',
    name:l.name||'', qty:l.qty, unit:l.unit||'', amount:Math.round(l.amount)||0, costType:'材料費'
  }));
  if(r.linesTruncated) showToast('明細が多く、途中までしか読めていない可能性があります');
  if(!ilRows.length) showToast('明細の行を見つけられませんでした');
  ilRender();
}

// ── 描画 ──
function ilRender(){
  const v=ilInvoice();
  const head=document.getElementById('il-head');
  if(head) head.textContent = v ? (v.title||`${v.supplierName}_${v.month}`) : '';

  const body=document.getElementById('il-body');
  if(!body) return;
  if(!ilRows.length){
    body.innerHTML='<div class="empty" style="padding:24px">明細がありません。「AIで読み直す」を押してください</div>';
    ilSummary();
    return;
  }
  // 割り当てが決まっていない行を上に集める（こちらで選ぶぶん）
  const idx=ilRows.map((l,i)=>i);
  idx.sort((a,b)=>{
    const ua=ilRows[a].project?1:0, ub=ilRows[b].project?1:0;
    return ua-ub || a-b;
  });
  const opts=(sel)=>`<option value="">（現場を選ぶ）</option>`+
    (projects||[]).map(p=>`<option value="${esc(p.name)}"${sel===p.name?' selected':''}>${esc(p.name)}</option>`).join('')+
    `<option value="共通"${sel==='共通'?' selected':''}>共通（現場に紐づかない）</option>`;

  body.innerHTML=idx.map(i=>{
    const l=ilRows[i];
    return `<div class="il-row${l.project?'':' need'}">
      <div class="il-main">
        <div class="il-name">${esc(l.name||'（品名なし）')}</div>
        <div class="il-meta">${l.workDate?String(l.workDate).replace(/-/g,'/')+'　':''}${
          l.qty!=null?`${l.qty}${esc(l.unit)}　`:''}<b>¥${fmt(l.amount)}</b>${
          l.rawProject?`　<span class="il-raw">請求書：${esc(l.rawProject)}</span>`:'　<span class="il-raw none">現場名なし</span>'}</div>
      </div>
      <select onchange="ilSetProject(${i},this.value)">${opts(l.project)}</select>
    </div>`;
  }).join('');
  ilSummary();
}

function ilSetProject(i, name){
  if(!ilRows[i]) return;
  ilRows[i].project=name||'';
  ilRender();
}

// 未割り当ての行に、まとめて同じ現場を入れる
function ilAssignRest(){
  const name=document.getElementById('il-bulk').value;
  if(!name){ showToast('入れる現場を選んでください'); return; }
  const n=ilRows.filter(l=>!l.project).length;
  if(!n){ showToast('割り当てが済んでいない行はありません'); return; }
  if(!confirm(`残り${n}行を「${name}」にまとめて入れますか？`)) return;
  ilRows.forEach(l=>{ if(!l.project) l.project=name; });
  ilRender();
}

function ilSummary(){
  const el=document.getElementById('il-sum');
  if(!el) return;
  const v=ilInvoice();
  const total=ilRows.reduce((s,l)=>s+l.amount,0);
  const need=ilRows.filter(l=>!l.project).length;
  // 現場ごとの内訳
  const by={};
  ilRows.filter(l=>l.project).forEach(l=>{ by[l.project]=(by[l.project]||0)+l.amount; });
  const rows=Object.entries(by).sort((a,b)=>b[1]-a[1])
    .map(([p,a])=>`<div class="il-sum-row"><span>${esc(p)}</span><b>¥${fmt(a)}</b></div>`).join('');
  // 請求額（税込）と明細合計（税抜のことが多い）の差は、消費税ぶんとして案内する
  const inv=v?.amount;
  el.innerHTML=`
    ${need?`<div class="il-need">${need}行、現場が決まっていません</div>`:'<div class="il-ok">すべての行に現場が入りました</div>'}
    ${rows||'<div style="font-size:11px;color:var(--text-muted)">まだ割り当てがありません</div>'}
    <div class="il-sum-row total"><span>明細の合計</span><b>¥${fmt(total)}</b></div>
    ${inv!=null?`<div class="il-sum-note">請求書の金額 ¥${fmt(inv)}${
      total&&inv!==total?`（差 ¥${fmt(Math.abs(inv-total))}。消費税ぶんの差であれば問題ありません）`:''}</div>`:''}`;
}

// ── 保存 ──
async function ilSave(){
  const v=ilInvoice(); if(!v) return;
  const need=ilRows.filter(l=>!l.project).length;
  if(need && !confirm(`${need}行はまだ現場が決まっていません。このまま保存しますか？\n（あとから開いて決められます）`)) return;
  const btn=document.getElementById('il-save-btn');
  btn.disabled=true; btn.textContent='保存中…';
  try{
    await dbReplaceInvoiceLines(v.id, ilRows);
    await fetchInvoiceLines();
    closeInvoiceLines();
    renderInvoices();
    if(typeof renderCost==='function') try{ renderCost(); }catch(_){}
    showToast(need?`保存しました（現場が決まっていない行が${need}件あります）`:'請求原価として登録しました');
  }catch(e){
  }finally{
    btn.disabled=false; btn.textContent='この内容で登録';
  }
}

// ── 現場ごとの請求原価（見積・発注との突き合わせに使う） ──
// その現場・その発注先の請求金額
function invoiceCostOf(projectName, supplierName){
  const ids=new Set((invoices||[]).filter(v=>!supplierName||v.supplierName===supplierName).map(v=>v.id));
  return (invoiceLines||[])
    .filter(l=>l.project===projectName && ids.has(l.invoiceId))
    .reduce((s,l)=>s+l.amount,0);
}
// その現場の請求金額（発注先を問わない）
function invoiceCostTotalOf(projectName){
  return (invoiceLines||[]).filter(l=>l.project===projectName).reduce((s,l)=>s+l.amount,0);
}
// まだ現場が決まっていない明細の件数（全体）
function invoiceUnassignedTotal(){
  return (invoiceLines||[]).filter(l=>!l.project).length;
}
