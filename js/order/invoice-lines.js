// ════ 請求書の明細を、現場ごとに割り当てる ════
//
// 建材店の請求書は「日付・現場名・品名・数量・金額」の行が並んでいる。
// これをAIで読み取って、行ごとにどの現場のものかを決める。
//   ・請求書に書かれた現場名から、案件を自動で当てる
//   ・現場名が無い行、どの案件か決められない行は、いちばん上に集めて選んでもらう
//
// 割り当てた金額は「請求原価」として、現場ごとに見積・発注と並べて比べられる。

let ilInvoiceId = null;   // いま割り当てている請求書
let ilRows = [];          // {rawProject, project, workDate, name, qty, unit, amount, aiIdx}
// AIが読み取った直後の中身の控え。人が直した所を見つけて、読み方を覚えるのに使う。
// 保存済みの明細を開き直したときは null（そのときの直しは「読み違い」とは限らないため）
let ilAiSnapshot = null;
let ilEditRows = new Set();   // いま入力欄を開いている行（ilRows の番号）

// 日本語入力のまま全角で打たれても受け取る
const ilHalf = s => String(s||'').replace(/[！-～]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));
function ilParseAmount(raw){
  const s=ilHalf(raw).replace(/[^0-9-]/g,'').replace(/(?!^)-/g,'');   // 値引きのマイナスは頭だけ認める
  return s===''||s==='-' ? 0 : Math.round(Number(s));
}
function ilParseQty(raw){
  const s=ilHalf(raw).replace(/[^0-9.]/g,'');
  return s==='' ? null : (Number(s) || 0);
}

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
  ilRows = saved.length ? saved.map(l=>({...l, aiIdx:null})) : [];
  ilAiSnapshot = null;
  ilEditRows = new Set();
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
  ilInvoiceId=null; ilRows=[]; ilAiSnapshot=null; ilEditRows=new Set();
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

  ilRows=(r.lines||[]).map((l,i)=>({
    rawProject:l.project||'', project:ilGuessProject(l.project), workDate:l.date||'',
    name:l.name||'', qty:l.qty, unit:l.unit||'', amount:Math.round(l.amount)||0, costType:'材料費',
    aiIdx:i   // AIが読んだ何番目の行か。人が直した所を見つけるのに使う
  }));
  // 直したところを見つけるための控え（品名・数量・単位・金額だけ。現場の割り当ては読み違いではない）
  ilAiSnapshot = ilRows.map(l=>({name:l.name, qty:l.qty, unit:l.unit, amount:l.amount}));
  ilEditRows = new Set();
  if(r.linesTruncated) showToast('明細が多く、途中までしか読めていない可能性があります');
  if(!ilRows.length) showToast('明細の行を見つけられませんでした。「＋ 行を追加」で手で入れられます');
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
    body.innerHTML='<div class="empty" style="padding:24px;line-height:1.8">明細がありません。<br>'+
      '<span style="font-size:11px">「AIで読み直す」か、下の「＋ 行を追加」で入れてください</span></div>';
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
    const main = ilEditRows.has(i) ? ilEditHtml(i, l) : `
      <div class="il-main">
        <div class="il-name">${esc(l.name||'（品名なし）')}${ilChangedMark(i)}</div>
        <div class="il-meta">${l.workDate?String(l.workDate).replace(/-/g,'/')+'　':''}${
          l.qty!=null?`${l.qty}${esc(l.unit)}　`:''}<b>¥${fmt(l.amount)}</b>${
          l.rawProject?`　<span class="il-raw">請求書：${esc(l.rawProject)}</span>`:'　<span class="il-raw none">現場名なし</span>'}</div>
      </div>
      <button class="btn xs" onclick="ilToggleEdit(${i})" title="品名・数量・金額を直す">直す</button>`;
    return `<div class="il-row${l.project?'':' need'}${ilEditRows.has(i)?' editing':''}">
      ${main}
      <select onchange="ilSetProject(${i},this.value)">${opts(l.project)}</select>
    </div>`;
  }).join('');
  ilSummary();
}

// 入力欄を開いた行
function ilEditHtml(i, l){
  return `<div class="il-main il-edit">
    <input class="il-e-name" value="${esc(l.name||'')}" placeholder="品名"
      onchange="ilSetField(${i},'name',this.value)">
    <div class="il-e-row">
      <input class="il-e-qty" value="${l.qty==null?'':l.qty}" placeholder="数量" inputmode="decimal"
        onfocus="this.select()" onchange="ilSetField(${i},'qty',this.value)">
      <input class="il-e-unit" value="${esc(l.unit||'')}" placeholder="単位"
        onchange="ilSetField(${i},'unit',this.value)">
      <input class="il-e-amt" value="${l.amount||''}" placeholder="金額" inputmode="numeric"
        onfocus="this.select()" onchange="ilSetField(${i},'amount',this.value)">
      <span class="il-e-yen">円</span>
      <button class="btn xs danger" onclick="ilRemoveRow(${i})" title="この行を消す">消す</button>
      <button class="btn xs" onclick="ilToggleEdit(${i})">閉じる</button>
    </div>
  </div>`;
}

// AIが読んだ内容から変わっている行に印を付ける（何を直したか後で見返せるように）
function ilChangedMark(i){
  const l=ilRows[i];
  if(!ilAiSnapshot) return '';
  if(l.aiIdx==null) return '<span class="il-fix add">足した行</span>';
  const was=ilAiSnapshot[l.aiIdx];
  if(!was) return '';
  const bits=[];
  if((was.name||'')!==(l.name||'')) bits.push('品名');
  if(Number(was.amount||0)!==Number(l.amount||0)) bits.push('金額');
  if(String(was.qty??'')!==String(l.qty??'') || (was.unit||'')!==(l.unit||'')) bits.push('数量');
  return bits.length ? `<span class="il-fix">${bits.join('・')}を直した</span>` : '';
}

function ilSetProject(i, name){
  if(!ilRows[i]) return;
  ilRows[i].project=name||'';
  ilRender();
}

// 入力欄の中身を受け取る。打っている途中で描き直すと入力が飛ぶので、
// ここでは中身と合計だけ直して、行そのものは描き直さない
function ilSetField(i, field, raw){
  const l=ilRows[i];
  if(!l) return;
  if(field==='amount')      l.amount = ilParseAmount(raw);
  else if(field==='qty')    l.qty    = ilParseQty(raw);
  else                      l[field] = String(raw||'').trim();
  ilSummary();
}

function ilToggleEdit(i){
  if(ilEditRows.has(i)) ilEditRows.delete(i); else ilEditRows.add(i);
  ilRender();
}

// 読み落とされていた行を足す
function ilAddRow(){
  ilRows.push({rawProject:'', project:'', workDate:'', name:'', qty:null, unit:'',
    amount:0, costType:'材料費', aiIdx:null});
  ilEditRows.add(ilRows.length-1);
  ilRender();
  // 足した行の品名にすぐ打てるようにする
  setTimeout(()=>{
    const els=document.querySelectorAll('#il-body .il-e-name');
    els[els.length-1]?.focus();
  }, 30);
}

// 明細ではない行（小計・消費税など）をAIが拾ってしまったときに消す
function ilRemoveRow(i){
  const l=ilRows[i];
  if(!l) return;
  if((l.name||l.amount) && !confirm(`この行を消しますか？\n\n${l.name||'（品名なし）'}　¥${fmt(l.amount)}`)) return;
  // 消した行は控え（ilAiSnapshot）に残るので、保存のときに「拾わなくてよい行」として渡せる
  ilRows.splice(i,1);
  // 番号がずれるので、開いている行の印は付け直す
  ilEditRows = new Set([...ilEditRows].filter(n=>n!==i).map(n=>n>i?n-1:n));
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

// ── AIが読んだ内容と、人が直したあとの内容の差 ──
//
// 足した行・消した行・品名や金額を直した行を集める。
// これをAIに見せて「次はどう読めばよいか」を1文で書かせる（読み方を覚える）。
function ilLineFix(){
  if(!ilAiSnapshot) return null;
  const alive=new Set(ilRows.map(l=>l.aiIdx).filter(n=>n!=null));
  const same=(a,b)=>String(a??'')===String(b??'');

  const added=ilRows.filter(l=>l.aiIdx==null && (l.name||l.amount))
    .map(l=>({name:l.name, qty:l.qty, unit:l.unit, amount:l.amount}));
  const removed=ilAiSnapshot.map((w,i)=>({...w,i})).filter(w=>!alive.has(w.i))
    .map(w=>({name:w.name, amount:w.amount}));
  const edited=[];
  ilRows.forEach(l=>{
    if(l.aiIdx==null) return;
    const w=ilAiSnapshot[l.aiIdx];
    if(!w) return;
    if(same(w.name,l.name) && Number(w.amount||0)===Number(l.amount||0)
       && same(w.qty,l.qty) && same(w.unit,l.unit)) return;
    edited.push({ was:{name:w.name, amount:w.amount, qty:w.qty, unit:w.unit},
                  now:{name:l.name, amount:l.amount, qty:l.qty, unit:l.unit} });
  });

  const n=added.length+removed.length+edited.length;
  return n ? {added, removed, edited, n} : null;
}

// ── 保存 ──
async function ilSave(){
  const v=ilInvoice(); if(!v) return;
  // 足したまま何も入れていない行は保存しない
  ilRows=ilRows.filter(l=>l.aiIdx!=null || l.name || l.amount);
  const need=ilRows.filter(l=>!l.project).length;
  if(need && !confirm(`${need}行はまだ現場が決まっていません。このまま保存しますか？\n（あとから開いて決められます）`)) return;
  const fix=ilLineFix();
  const learn = fix && confirm(
    `明細を${fix.n}か所直しました。\n`+
    `${fix.added.length?`　足した行 ${fix.added.length}件\n`:''}`+
    `${fix.removed.length?`　消した行 ${fix.removed.length}件\n`:''}`+
    `${fix.edited.length?`　品名・金額・数量を直した行 ${fix.edited.length}件\n`:''}`+
    `\nこの直しから、AIに明細の読み方を覚えさせますか？\n次に ${v.supplierName} の請求書を読むときに使います。`);
  const filePath=v.filePath, supplierId=v.supplierId, month=v.month, supName=v.supplierName;

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
    return;
  }finally{
    btn.disabled=false; btn.textContent='この内容で登録';
  }

  if(learn) ilLearnFromFix({filePath, supplierId, month, supName, fix});
}

// 直した内容から「次に使える手がかり」を覚える
async function ilLearnFromFix({filePath, supplierId, month, supName, fix}){
  showToast('次から正しく読めるように、AIに覚えさせています…');
  let hint='';
  try{ hint=await dbLearnInvoiceLines(filePath, supplierId, {added:fix.added, removed:fix.removed, edited:fix.edited}); }
  catch(e){ showToast('覚えさせられませんでした：'+e.message); return; }
  if(!hint){ showToast('AIも決まりを見つけられませんでした。今回は覚えていません'); return; }
  if(!confirm(`次のことを覚えます。よろしいですか？\n\n【${supName}】明細の読み方\n${hint}\n\n次からこの発注先の請求書を読むときに、これを一緒に渡します。`)) return;
  try{
    await dbAddInvoiceHint({supplierId, hint, kind:'lines', sourceMonth:month});
    await fetchInvoiceHints();
    showToast('覚えました。次の読み取りから使います');
  }catch(_){}
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
