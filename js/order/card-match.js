// ════ カード明細（JCB／Visa）の取り込みと照合 ════
//
// カード会社のCSV（Shift_JIS・JIS・UTF-8。見出しの位置や列名が会社ごとに違う）を読み込み、
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

// ── 列の自動判別 ──
// JCBはもちろん、Visa（カード会社ごとに書式が違う）も読めるように、
// 見出しの言い回しと中身の両方から「日付・利用先・金額」の列を推定する。
const CARD_HEAD_WORDS = {
  date:     ['ご利用日','利用日','利用年月日','ご利用年月日','使用日','日付','取引日'],
  merchant: ['ご利用先','利用先','ご利用店名','利用店名','店名','ご利用店舗','利用加盟店','加盟店','摘要','内容','利用内容'],
  amount:   ['ご利用金額','利用金額','ご利用額','利用額','金額','支払金額','お支払い金額','ご請求額','請求額'],
  user:     ['ご利用者','利用者','カード会員','会員名','カード名義','利用者名'],
  memo:     ['摘要','備考','メモ'],
  category: ['カテゴリ','種別','区分'],
  area:     ['国内','海外','国内／海外','国内/海外']
};

function cardNormHead(s){ return cardNorm(s).replace(/[()（）￥¥]/g,''); }

// 見出し行を探す（無い場合は -1）
function cardFindHeaderRow(rows){
  const words=[...CARD_HEAD_WORDS.date, ...CARD_HEAD_WORDS.merchant, ...CARD_HEAD_WORDS.amount].map(cardNormHead);
  let best=-1, bestScore=0;
  rows.slice(0,25).forEach((r,i)=>{
    const score=r.reduce((n,c)=>{
      const h=cardNormHead(c);
      return n + (h && words.some(w=>h.includes(w)) ? 1 : 0);
    },0);
    if(score>bestScore){ bestScore=score; best=i; }
  });
  return bestScore>=2 ? best : -1;
}

// 見出し名から列番号を決める
// CARD_HEAD_WORDS の並び順＝優先順。前の語ほど強く、各語で「完全一致→部分一致」の順に探す。
// （例：JCBの「ご利用先など」を、後ろの候補である「摘要」より先に拾う）
function cardColByHead(head, kind){
  const norm=head.map(cardNormHead);
  for(const w of CARD_HEAD_WORDS[kind].map(cardNormHead)){
    const exact=norm.findIndex(h=>h===w);
    if(exact>=0) return exact;
    const partial=norm.findIndex(h=>h && h.includes(w));
    if(partial>=0) return partial;
  }
  return -1;
}

// 中身から列番号を推定する（見出しが無い／見つからないCSV用）
function cardColByContent(dataRows, kind){
  const n=Math.max(...dataRows.map(r=>r.length), 0);
  const score=[];
  for(let c=0;c<n;c++){
    const vals=dataRows.map(r=>String(r[c]??'').trim()).filter(Boolean);
    if(!vals.length){ score.push(-1); continue; }
    if(kind==='date')     score.push(vals.filter(v=>cardDate(v)).length / vals.length);
    else if(kind==='amount') score.push(vals.filter(v=>/^[\-¥￥]?[\d,]+$/.test(v) && cardNum(v)>0).length / vals.length);
    else /* merchant */   score.push(vals.filter(v=>!cardDate(v) && !/^[\-¥￥]?[\d,]+$/.test(v) && v.length>=2).length / vals.length);
  }
  const max=Math.max(...score);
  return max>=0.6 ? score.indexOf(max) : -1;
}

// CSV本文を解析して、明細と「どの列を使ったか」を返す
//   colOverride: {date, merchant, amount} を渡すと、その列を優先して使う（画面で選び直したとき）
function cardParseCsv(text, opt){
  opt=opt||{};
  const rows=csvParse(text).filter(r=>r.length && !r.every(c=>!String(c).trim()));
  if(!rows.length) throw new Error('中身が空のCSVです');

  // 支払日（JCBは先頭に「今回のお支払日」がある。無ければ空）
  let payDate='';
  for(const r of rows.slice(0,8)){
    const i=r.findIndex(c=>/お支払日|支払日|引落日|振替日/.test(String(c)));
    if(i>=0 && cardDate(r[i+1])){ payDate=cardDate(r[i+1]); break; }
  }

  const hi=cardFindHeaderRow(rows);
  const head=hi>=0 ? rows[hi].map(c=>String(c).trim()) : [];
  const dataRows=rows.slice(hi>=0 ? hi+1 : 0);

  // 列の決定：①画面で指定 ②見出し ③中身から推定
  const pick=(kind)=>{
    if(opt[kind]!=null && opt[kind]>=0) return opt[kind];
    const byHead = head.length ? cardColByHead(head, kind) : -1;
    if(byHead>=0) return byHead;
    return cardColByContent(dataRows.slice(0,40), kind);
  };
  const idx={ date:pick('date'), merchant:pick('merchant'), amount:pick('amount') };
  // 補助の列（あれば使う。無くてもよい）
  const sub={};
  ['user','memo','category','area'].forEach(k=>{ sub[k]= head.length ? cardColByHead(head,k) : -1; });
  // JCBの「お支払い金額」列（利用金額が空の行の保険）
  const payCol = head.length ? head.findIndex(h=>/お支払い金額|支払金額/.test(String(h))) : -1;

  if(idx.date<0 || idx.merchant<0 || idx.amount<0){
    const missing=[idx.date<0?'日付':'', idx.merchant<0?'利用先':'', idx.amount<0?'金額':''].filter(Boolean).join('・');
    const err=new Error(`${missing}の列を判別できませんでした`);
    err.needMapping={head, rows:dataRows.slice(0,5), idx, payDate};
    throw err;
  }

  const seen={};
  const list=[];
  dataRows.forEach(r=>{
    const useDate=cardDate(r[idx.date]);
    const merchant=String(r[idx.merchant]||'').trim();
    let amount=cardNum(r[idx.amount]);
    if(!amount && payCol>=0) amount=cardNum(r[payCol]);   // ETCまとめ行などは支払金額のみ
    if(!merchant || !amount) return;                      // 合計行・空行は取り込まない
    if(/^合計|^総額|^ご請求/.test(merchant)) return;
    const {last4, holder}= sub.user>=0 ? cardHolderOf(r[sub.user]) : {last4:'',holder:''};
    // 同じ日・同じ店・同じ金額が複数ある場合に備えて連番を付ける
    const base=`${opt.brand||'JCB'}|${payDate}|${last4}|${useDate}|${merchant}|${amount}`;
    seen[base]=(seen[base]||0)+1;
    list.push({
      brand:opt.brand||'JCB',
      payDate, cardLast4:last4, cardHolder:holder,
      useDate: useDate || payDate, merchant, amount,
      category: sub.category>=0 ? String(r[sub.category]||'').trim() : '',
      area:     sub.area>=0     ? String(r[sub.area]||'').trim() : '',
      memo:    (sub.memo>=0     ? String(r[sub.memo]||'') : '').replace(/\s*\n\s*/g,' ').trim(),
      rowKey:`${base}|${seen[base]}`
    });
  });
  return {payDate, list, head, idx, sample:dataRows.slice(0,5)};
}

// ── 自動割り当て ──

// ① 発注（レシートから作ったもの）と突き合わせる：金額（税込）が一致し、日付が近いもの
//    支払方法が明細のカードと違う発注は除く（例：Visa明細に現金払い・JCB払いの発注は出ない）
//    支払方法が未記入の古い発注は、どちらの明細とも照合できるようにしておく
function cardFindOrder(row){
  const brand = row.brand || 'JCB';
  const used = new Set(cardStatements.filter(c=>c.orderNo).map(c=>c.orderNo));
  const cands = orders.filter(o=>{
    if(used.has(o.no)) return false;                       // すでに他の明細と照合済み
    if(o.paymentMethod && o.paymentMethod!==brand) return false;  // 別の支払方法の発注は対象外
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
        <span style="font-size:11px;color:var(--text-muted)">　${(c.useDate||'').replace(/-/g,'/')}　${esc(c.brand||'JCB')}${c.cardHolder?'　'+esc(c.cardHolder):''}</span>
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

// ── CSVの取り込み（JCB／Visa。列は自動判別し、外れたら選び直せる） ──
let _cardCsvText='';     // 読み込んだCSV本文
let _cardParsed=null;    // 判別結果

function cardGuessBrand(filename, text){
  const s=(filename||'')+' '+(text||'').slice(0,400);
  if(/visa|VISA|ビザ|三井住友|ＶＩＳＡ/.test(s)) return 'Visa';
  return 'JCB';
}

async function onCardCsvChange(input){
  const file=input.files?.[0];
  if(!file) return;
  input.value='';
  const busy=document.getElementById('card-busy');
  const show=m=>{ if(busy){ busy.style.display=m?'':'none'; busy.textContent=m||''; } };
  show('CSVを読み込んでいます…');
  try{
    _cardCsvText=await cardReadText(file);
    const brand=cardGuessBrand(file.name, _cardCsvText);
    try{
      _cardParsed=cardParseCsv(_cardCsvText, {brand});
    }catch(e){
      // 列を判別できなかった場合も、画面で選べるように情報を持って開く
      if(!e.needMapping) throw e;
      _cardParsed={...e.needMapping, list:[], brand};
    }
    show('');
    openCardImport(brand);
  }catch(e){
    show('');
    showToast('読み込みに失敗しました：'+e.message);
  }
}

// 取り込み前の確認画面（カード種別と列の指定）
function openCardImport(brand){
  document.getElementById('card-import-brand').value=brand||_cardParsed?.brand||'JCB';
  renderCardImportCols();
  document.getElementById('card-import-modal').classList.add('open');
}
function closeCardImport(){
  document.getElementById('card-import-modal').classList.remove('open');
  _cardCsvText=''; _cardParsed=null;
}

// 列の選択肢を作る（見出し名＋先頭行の中身を見本として表示）
function renderCardImportCols(){
  if(!_cardParsed) return;
  const head=_cardParsed.head||[];
  const sample=_cardParsed.sample||[];
  const n=Math.max(head.length, ...sample.map(r=>r.length), 0);
  const label=i=>{
    const h=(head[i]||'').trim();
    const v=(sample.find(r=>String(r[i]||'').trim())||[])[i]||'';
    const ex=String(v).replace(/\s+/g,' ').slice(0,14);
    return `${i+1}列目${h?'：'+h:''}${ex?`（例：${ex}）`:''}`;
  };
  ['date','merchant','amount'].forEach(kind=>{
    const sel=document.getElementById('card-col-'+kind);
    sel.innerHTML='<option value="-1">選択してください</option>'+
      Array.from({length:n},(_,i)=>`<option value="${i}">${esc(label(i))}</option>`).join('');
    sel.value=String(_cardParsed.idx?.[kind] ?? -1);
  });
  renderCardImportPreview();
}

// 選んだ列でどう読めるかを試して見せる
function renderCardImportPreview(){
  const el=document.getElementById('card-import-preview');
  if(!el || !_cardCsvText) return;
  const opt={
    brand:document.getElementById('card-import-brand').value,
    date:Number(document.getElementById('card-col-date').value),
    merchant:Number(document.getElementById('card-col-merchant').value),
    amount:Number(document.getElementById('card-col-amount').value)
  };
  try{
    const {list}=cardParseCsv(_cardCsvText, opt);
    _cardParsed={..._cardParsed, list, brand:opt.brand};
    if(!list.length){
      el.innerHTML='<span style="color:var(--danger)">この指定では明細を読み取れませんでした。列を選び直してください。</span>';
      return;
    }
    const total=list.reduce((s,r)=>s+r.amount,0);
    el.innerHTML=
      `<div style="font-weight:700;margin-bottom:4px">${list.length}件　合計 ¥${fmt(total)}（税込）</div>`+
      list.slice(0,3).map(r=>`<div>${(r.useDate||'—').replace(/-/g,'/')}　${esc(r.merchant)}　¥${fmt(r.amount)}</div>`).join('')+
      (list.length>3?`<div style="color:var(--text-muted)">…ほか${list.length-3}件</div>`:'');
  }catch(e){
    _cardParsed={..._cardParsed, list:[]};
    el.innerHTML=`<span style="color:var(--danger)">${esc(e.message)}</span>`;
  }
}

// 確認した内容で取り込む
async function confirmCardImport(){
  if(!_cardParsed?.list?.length){ showToast('取り込める明細がありません'); return; }
  const brand=document.getElementById('card-import-brand').value;
  const list=_cardParsed.list;
  const payDate=_cardParsed.payDate||'';
  closeCardImport();

  const busy=document.getElementById('card-busy');
  const show=m=>{ if(busy){ busy.style.display=m?'':'none'; busy.textContent=m||''; } };
  try{
    // すでに取り込み済みの行は飛ばす
    const known=new Set(cardStatements.map(c=>c.rowKey));
    const fresh=list.filter(r=>!known.has(r.rowKey));
    if(!fresh.length){ showToast(`この明細は取り込み済みです（${list.length}件）`); return; }

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
    cardMonth=(payDate||fresh[0].useDate||'').slice(0,7);
    cardFilter='all';
    renderCardPage();
    showToast(`${brand}の明細を${fresh.length}件取り込みました（発注と照合：${matched}件）`);
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

// ════ 割り当て済みの明細をCSVで出力 ════
// 元の明細に「案件（現場）・費目・状態・発注番号・税抜金額」を書き足して書き出す。
// 文字コードはUTF-8（BOM付き）。Excelでそのまま開ける。

const CARD_STATUS_LABEL = {
  matched:'発注と照合', registered:'原価登録済', unassigned:'未割当', ignored:'対象外'
};

// 画面で今表示している条件（請求月・状態）と同じ明細を返す
function cardVisibleRows(){
  let list=cardStatements.filter(c=>!cardMonth || (c.payDate||'').startsWith(cardMonth));
  if(cardFilter==='todo')    list=list.filter(c=>c.status==='unassigned');
  if(cardFilter==='matched') list=list.filter(c=>c.status==='matched'||c.status==='registered');
  if(cardFilter==='ignored') list=list.filter(c=>c.status==='ignored');
  return list.sort((a,b)=>(a.useDate||'').localeCompare(b.useDate||'') || (a.merchant||'').localeCompare(b.merchant||''));
}

function csvCell(v){
  const s=String(v==null?'':v);
  return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}

function exportCardCsv(){
  const rows=cardVisibleRows();
  if(!rows.length){ showToast('出力する明細がありません'); return; }

  const head=['カード','請求月','ご利用日','利用者','カード下4桁','ご利用先','ご利用金額(税込)','税抜金額',
              '案件（現場）','費目','状態','発注番号','国内/海外','摘要'];
  const body=rows.map(c=>[
    c.brand||'JCB',
    (c.payDate||'').slice(0,7).replace('-','/'),
    (c.useDate||'').replace(/-/g,'/'),
    c.cardHolder||'', c.cardLast4||'', c.merchant||'',
    Math.round(c.amount||0),
    Math.round((c.amount||0)/1.1),
    c.project||'', c.costType||'',
    CARD_STATUS_LABEL[c.status]||c.status||'',
    c.orderNo||'', c.area||'', c.memo||''
  ]);

  // 末尾に案件（現場）ごとの合計を付ける（給与・原価の確認用）
  const byProject={};
  rows.forEach(c=>{ if(c.status==='ignored') return;
    const k=c.project||'（未割当）';
    byProject[k]=(byProject[k]||0)+Math.round(c.amount||0);
  });
  const sum=[[],['■ 案件（現場）別 合計（税込・対象外を除く）'],['案件（現場）','合計']];
  Object.entries(byProject).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>sum.push([k,v]));
  sum.push(['合計', Object.values(byProject).reduce((s,v)=>s+v,0)]);

  const csv=[head,...body,...sum].map(r=>r.map(csvCell).join(',')).join('\r\n');
  const label=(cardMonth||'すべて').replace('-','');
  const suffix={all:'',todo:'_未割当',matched:'_割当済',ignored:'_対象外'}[cardFilter]||'';
  cardDownload(`カード明細_${label}${suffix}.csv`, csv);
  showToast(`${rows.length}件を書き出しました`);
}

// UTF-8（BOM付き）でダウンロードする
function cardDownload(filename, text){
  const blob=new Blob(['﻿'+text], {type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}
