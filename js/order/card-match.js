// ════ カード明細（JCB）の取り込みと照合 ════
//
// JCBのCSV（Shift_JIS・6行目が見出し・摘要欄に改行が入ることがある）を読み込み、
// レシートから作った発注と「日付＋金額」で突き合わせて、どの現場（案件）の費用かを埋める。
//   ・発注と一致した明細   → 原価は発注時に登録済みなので二重登録しない（照合済み）
//   ・一致しなかった明細   → 過去に同じ利用先へ割り当てた案件・費目を候補として出し、原価に登録できる
//
// 取り込んだ明細は card_statements に保存する（同じCSVを再取込しても重複しない）。

const CARD_COST_TYPES = ['材料費','外注費','労務費','諸経費'];
const CARD_MATCH_DAYS = 3;        // 発注日とご利用日のズレの許容日数
const CARD_NO_PROJECT = '共通';   // 案件に紐づかない費用（消耗品・燃料など）

// ── CSVの読み取り ──

// 引用符と改行に対応したCSVパーサ
function csvParse(text){
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){
      if(c==='"'){ if(text[i+1]==='"'){ cell+='"'; i++; } else q=false; }
      else cell+=c;
    } else if(c==='"'){ q=true; }
    else if(c===','){ row.push(cell); cell=''; }
    else if(c==='\r'){ /* skip */ }
    else if(c==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; }
    else cell+=c;
  }
  if(cell!=='' || row.length){ row.push(cell); rows.push(row); }
  return rows;
}

// 文字コードを判定して読む（JCBはShift_JIS。UTF-8で保存し直された場合にも対応）
async function cardReadText(file){
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8', {fatal:false}).decode(buf);
  // 文字化けの目印（U+FFFD）が多ければShift_JISとみなす
  const bad = (utf8.match(/�/g)||[]).length;
  if(bad > 2){
    try{ return new TextDecoder('shift_jis').decode(buf); }catch(_){ return utf8; }
  }
  return utf8;
}

// 全角→半角・空白除去（利用先の突き合わせ用）
function cardNorm(s){
  return String(s||'')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0))
    .replace(/　/g,' ').replace(/[\s－ー\-]/g,'')
    .toUpperCase();
}
function cardNum(s){ return Math.round(parseFloat(String(s||'').replace(/[^0-9.\-]/g,''))||0); }
function cardDate(s){
  const m=String(s||'').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}` : '';
}
// 「****-****-****-4009　【ＯＳ】ＪＣＢ一般法人カード　清川　太視　様」→ {last4, holder}
function cardHolderOf(s){
  const t=String(s||'');
  const last4=(t.match(/(\d{4})/)||[])[1]||'';
  const holder=(t.match(/カード[　\s]+(.+?)[　\s]*様/)||[])[1]||'';
  return {last4, holder:holder.replace(/[　\s]+/g,'')};
}

// CSV本文 → 明細の配列
function cardParseCsv(text){
  const rows=csvParse(text);
  // 支払日（1〜5行目のヘッダ部にある）
  let payDate='';
  for(const r of rows.slice(0,6)){
    const i=r.findIndex(c=>String(c).includes('お支払日'));
    if(i>=0){ payDate=cardDate(r[i+1]); break; }
  }
  // 見出し行（「ご利用日」を含む行）を探す
  const hi=rows.findIndex(r=>r.some(c=>String(c).trim()==='ご利用日'));
  if(hi<0) throw new Error('見出し行（ご利用日）が見つかりません。JCBの明細CSVか確認してください');
  const head=rows[hi].map(c=>String(c).trim());
  const col=name=>head.findIndex(h=>h.replace(/\s/g,'').includes(name));
  const idx={
    user:col('ご利用者'), cat:col('カテゴリ'), date:col('ご利用日'), merchant:col('ご利用先'),
    amount:col('ご利用金額'), pay:col('お支払い金額'), area:col('国内'), memo:col('摘要')
  };

  const seen={};
  const list=[];
  rows.slice(hi+1).forEach(r=>{
    if(!r.length || r.every(c=>!String(c).trim())) return;
    const useDate=cardDate(r[idx.date]);
    const merchant=String(r[idx.merchant]||'').trim();
    let amount=cardNum(r[idx.amount]);
    if(!amount) amount=cardNum(r[idx.pay]);       // ETCまとめ行などは支払金額のみ
    if(!merchant || !amount) return;              // 合計行・空行は取り込まない
    const {last4, holder}=cardHolderOf(r[idx.user]);
    // 同じ日・同じ店・同じ金額が複数ある場合に備えて連番を付ける
    const base=`${payDate}|${last4}|${useDate}|${merchant}|${amount}`;
    seen[base]=(seen[base]||0)+1;
    list.push({
      payDate, cardLast4:last4, cardHolder:holder,
      useDate: useDate || payDate, merchant, amount,
      category:String(r[idx.cat]||'').trim(), area:String(r[idx.area]||'').trim(),
      memo:String(r[idx.memo]||'').replace(/\s*\n\s*/g,' ').trim(),
      rowKey:`${base}|${seen[base]}`
    });
  });
  return {payDate, list};
}

// ── 自動割り当て ──

// ① 発注（レシートから作ったもの）と突き合わせる：金額（税込）が一致し、日付が近いもの
function cardFindOrder(row){
  const used = new Set(cardStatements.filter(c=>c.orderNo).map(c=>c.orderNo));
  const cands = orders.filter(o=>{
    if(used.has(o.no)) return false;                       // すでに他の明細と照合済み
    if(Math.round(o.total)!==row.amount) return false;     // 合計（税込）が一致
    const d=Math.abs((new Date(o.date)-new Date(row.useDate))/86400000);
    return d<=CARD_MATCH_DAYS;
  });
  if(!cands.length) return null;
  // 日付が近いものを優先
  cands.sort((a,b)=>Math.abs(new Date(a.date)-new Date(row.useDate))-Math.abs(new Date(b.date)-new Date(row.useDate)));
  return cands[0];
}

// ② 過去に同じ利用先へ割り当てた案件・費目から推測する
function cardGuessFromHistory(row){
  const key=cardNorm(row.merchant);
  const past=cardStatements.filter(c=>cardNorm(c.merchant)===key && c.costType && c.status!=='ignored')
    .sort((a,b)=> (b.useDate||'').localeCompare(a.useDate||''));
  if(!past.length) return null;
  return {project:past[0].project||'', costType:past[0].costType, from:past[0].useDate};
}

// 明細1件の割り当て状態を求める（画面表示用）
function cardRowState(row){
  if(row.status==='ignored')    return {kind:'ignored',   label:'対象外',   color:'var(--text-muted)'};
  if(row.status==='matched')    return {kind:'matched',   label:'発注と照合', color:'var(--ok-t)'};
  if(row.status==='registered') return {kind:'registered',label:'原価登録済', color:'var(--ok-t)'};
  const g=cardGuessFromHistory(row);
  if(g) return {kind:'guess', label:'候補あり', color:'var(--warn-t)', guess:g};
  return {kind:'none', label:'未割当', color:'var(--danger)'};
}

// ════ 画面 ════

let cardFilter = 'all';   // all / todo / matched / ignored
let cardMonth  = '';      // 表示する請求月（空＝すべて）

function renderCardPage(){
  const el=document.getElementById('card-body');
  if(!el) return;
  if(typeof cardTableReady!=='undefined' && !cardTableReady){
    el.innerHTML=`<div class="card" style="padding:12px;font-size:12px;color:var(--text-sub);line-height:1.7">
      この機能を使うには、データベースの準備が必要です。<br>
      supabase/migration-genba23.sql を実行してください。</div>`;
    return;
  }

  // 請求月の選択肢
  const months=[...new Set(cardStatements.map(c=>(c.payDate||'').slice(0,7)).filter(Boolean))].sort().reverse();
  if(cardMonth && !months.includes(cardMonth)) cardMonth='';
  const monthSel=document.getElementById('card-month');
  if(monthSel){
    monthSel.innerHTML='<option value="">すべての請求月</option>'+months.map(m=>{
      const [y,mm]=m.split('-');
      return `<option value="${m}"${cardMonth===m?' selected':''}>${y}年${Number(mm)}月請求</option>`;
    }).join('');
  }

  let list=cardStatements.filter(c=>!cardMonth || (c.payDate||'').startsWith(cardMonth));
  const counts={
    all:list.length,
    todo:list.filter(c=>c.status==='unassigned').length,
    done:list.filter(c=>c.status==='matched'||c.status==='registered').length,
    ignored:list.filter(c=>c.status==='ignored').length
  };
  if(cardFilter==='todo')    list=list.filter(c=>c.status==='unassigned');
  if(cardFilter==='matched') list=list.filter(c=>c.status==='matched'||c.status==='registered');
  if(cardFilter==='ignored') list=list.filter(c=>c.status==='ignored');
  list.sort((a,b)=>(b.useDate||'').localeCompare(a.useDate||'') || (a.merchant||'').localeCompare(b.merchant||''));

  const total=list.reduce((s,c)=>s+Number(c.amount||0),0);
  const pill=(k,label,n)=>`<button class="cat-pill${cardFilter===k?' active':''}" onclick="cardSetFilter('${k}')">${label} ${n}</button>`;

  el.innerHTML=
    `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
       ${pill('all','すべて',counts.all)}${pill('todo','未割当',counts.todo)}${pill('matched','割当済',counts.done)}${pill('ignored','対象外',counts.ignored)}
     </div>
     <div style="font-size:11px;color:var(--text-sub);margin-bottom:6px">${list.length}件　合計 ¥${fmt(total)}（税込）</div>`+
    (list.length
      ? `<div class="card" style="padding:0;overflow:hidden">${list.map(cardRowHtml).join('')}</div>`
      : '<div class="card"><div class="empty" style="padding:18px">明細がありません。上の「CSVを取り込む」からJCBの明細を読み込んでください。</div></div>');
}

function cardSetFilter(k){ cardFilter=k; renderCardPage(); }
function cardMonthChanged(){ cardMonth=document.getElementById('card-month').value; renderCardPage(); }

function cardRowHtml(c){
  const st=cardRowState(c);
  const assign = c.project||c.costType
    ? `<span style="color:var(--accent-t);font-weight:700">${esc(c.project||CARD_NO_PROJECT)}</span>${c.costType?`<span style="color:var(--text-sub)">／${esc(c.costType)}</span>`:''}`
    : (st.kind==='guess'
        ? `<span style="color:var(--warn-t)">候補：${esc(st.guess.project||CARD_NO_PROJECT)}／${esc(st.guess.costType)}
             <button class="btn xs" style="margin-left:4px" onclick="cardApplyGuess(${c.id})">この内容で登録</button></span>`
        : '<span style="color:var(--text-muted)">未割当</span>');
  return `<div class="cost-row">
    <div class="cost-row-top">
      <div class="cost-row-name">
        <span style="font-weight:700">${esc(c.merchant)}</span>
        <span style="font-size:11px;color:var(--text-muted)">　${(c.useDate||'').replace(/-/g,'/')}　${esc(c.cardHolder)}</span>
      </div>
      <div class="cost-row-amt">¥${fmt(c.amount)}</div>
    </div>
    <div class="cost-row-meta" style="align-items:center">
      <span style="color:${st.color};font-weight:700">${st.label}</span>
      ${c.orderNo?`<span style="color:var(--text-muted)">発注 ${esc(c.orderNo)}</span>`:''}
      <span style="flex:1;min-width:0">${assign}</span>
      <button class="btn xs" onclick="openCardAssign(${c.id})">${c.status==='unassigned'?'割り当て':'変更'}</button>
    </div>
  </div>`;
}

// ── CSVの取り込み ──
async function onCardCsvChange(input){
  const file=input.files?.[0];
  if(!file) return;
  input.value='';
  const busy=document.getElementById('card-busy');
  const show=m=>{ if(busy){ busy.style.display=m?'':'none'; busy.textContent=m||''; } };
  show('CSVを読み込んでいます…');
  try{
    const text=await cardReadText(file);
    const {payDate, list}=cardParseCsv(text);
    if(!list.length){ show(''); showToast('取り込める明細がありませんでした'); return; }

    // すでに取り込み済みの行は飛ばす
    const known=new Set(cardStatements.map(c=>c.rowKey));
    const fresh=list.filter(r=>!known.has(r.rowKey));
    if(!fresh.length){ show(''); showToast(`この明細は取り込み済みです（${list.length}件）`); return; }

    // 発注（レシート由来）と自動照合してから保存する
    let matched=0;
    fresh.forEach(r=>{
      const o=cardFindOrder(r);
      if(o){
        r.project=o.project||''; r.costType=o.costType||''; r.orderNo=o.no; r.status='matched';
        matched++;
      } else {
        r.status='unassigned';
      }
    });
    show(`${fresh.length}件を保存しています…`);
    await dbAddCardStatements(fresh);
    await refreshCardData();
    show('');
    cardMonth=(payDate||'').slice(0,7);
    cardFilter='all';
    renderCardPage();
    showToast(`${fresh.length}件を取り込みました（発注と照合：${matched}件）`);
  }catch(e){
    show('');
    showToast('取り込みに失敗しました：'+e.message);
  }
}

// ── 割り当て（1件ずつ） ──
let _cardAssignId=null;
function openCardAssign(id){
  const c=cardStatements.find(x=>x.id===id);
  if(!c) return;
  _cardAssignId=id;
  document.getElementById('card-assign-title').textContent=c.merchant;
  document.getElementById('card-assign-sub').textContent=
    `${(c.useDate||'').replace(/-/g,'/')}　¥${fmt(c.amount)}　${c.cardHolder}`;
  // 案件の選択肢（「共通」＝現場に紐づかない費用）
  const sel=document.getElementById('card-assign-project');
  sel.innerHTML=`<option value="${CARD_NO_PROJECT}">${CARD_NO_PROJECT}（現場に紐づかない）</option>`+
    projects.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  const guess=cardRowState(c).guess;
  sel.value=c.project||guess?.project||CARD_NO_PROJECT;
  document.getElementById('card-assign-cost').innerHTML=
    '<option value="">選択してください</option>'+CARD_COST_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('');
  document.getElementById('card-assign-cost').value=c.costType||guess?.costType||'諸経費';
  document.getElementById('card-assign-name').value=c.merchant;
  // 発注と照合済みの明細は、原価がすでにあるので登録ボタンを出さない
  document.getElementById('card-assign-note').textContent = c.orderNo
    ? `発注 ${c.orderNo} と照合済みです。原価は発注時に登録済みのため、ここでは案件・費目の記録だけを直します。`
    : '登録すると、この金額（税込）を税抜に換算して原価に追加します。';
  document.getElementById('card-assign-register').style.display = c.orderNo ? 'none' : '';
  document.getElementById('card-assign-modal').classList.add('open');
}
function closeCardAssign(){
  document.getElementById('card-assign-modal').classList.remove('open');
  _cardAssignId=null;
}

// 割り当てだけ保存する（原価は作らない）
async function saveCardAssign(){
  const c=cardStatements.find(x=>x.id===_cardAssignId);
  if(!c) return;
  const project=document.getElementById('card-assign-project').value;
  const costType=document.getElementById('card-assign-cost').value;
  await dbUpdateCardStatement(c.id,{project, cost_type:costType});
  closeCardAssign();
  await refreshCardData();
  renderCardPage();
  showToast('保存しました');
}

// 原価として登録する（発注と照合できなかった明細用）
async function registerCardCost(){
  const c=cardStatements.find(x=>x.id===_cardAssignId);
  if(!c) return;
  const project=document.getElementById('card-assign-project').value;
  const costType=document.getElementById('card-assign-cost').value;
  const name=document.getElementById('card-assign-name').value.trim()||c.merchant;
  if(!costType){ showToast('費目を選んでください'); return; }
  await dbRegisterCardCost(c, {project, costType, name});
  closeCardAssign();
  await refreshCardData();
  renderCardPage();
  showToast('原価に登録しました');
}

// 候補をそのまま採用して原価登録
async function cardApplyGuess(id){
  const c=cardStatements.find(x=>x.id===id);
  const g=c && cardRowState(c).guess;
  if(!g) return;
  await dbRegisterCardCost(c, {project:g.project||CARD_NO_PROJECT, costType:g.costType, name:c.merchant});
  await refreshCardData();
  renderCardPage();
  showToast('原価に登録しました');
}

// 対象外（私費・返金など原価に入れないもの）
async function ignoreCardRow(){
  const c=cardStatements.find(x=>x.id===_cardAssignId);
  if(!c) return;
  await dbUpdateCardStatement(c.id,{status:'ignored'});
  closeCardAssign();
  await refreshCardData();
  renderCardPage();
  showToast('対象外にしました');
}

async function refreshCardData(){
  try{ await fetchCardStatements(); }catch(e){ console.warn('カード明細の再取得に失敗',e); }
}
