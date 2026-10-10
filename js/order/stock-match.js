// ════ 在庫の品目名を、品目マスタの名前に合わせる ════
//
// 在庫の品目と品目マスタの品目が、同じものなのに書き方がちがうことがある
// （空白・全角と半角・「×」と「x」・かっこ書きの有無など）。
// 名前がちがうと、発注して入った分と、手で入れた分が、別の品目として並んでしまう。
//
// ここでは、在庫の品目ごとに、品目マスタから「同じもの」を探して並べる。
//   ・在庫の品目に発注先が入っていれば、その発注先の品目マスタの中から探す
//   ・入っていなければ、品目マスタ全体から探す（合わせると、発注先もマスタから入る）
// 見つかったものは、確かさで2つに分ける。
//   同じ   … 空白や全角・半角などの書き方をそろえると、ぴったり同じになるもの（はじめから選んである）
//   候補   … 片方がもう片方をふくむ、または字の並びがよく似ているもの（選んでいない。目で確かめて選ぶ）
// 「選んだものを合わせる」で、品目マスタの名前に付け替える（migration-genba102.sql）。
// 単位と単価も品目マスタにそろえる（単価は、品目マスタのいまの単価）。数は変えない。
// 在庫の数が 0 の品目は金額を持てないので、単価は入らない（次に入庫するときに入れる）。

let stkMatch = { rows:[], busy:false };

// 書き方のちがいをならす（比べるためだけに使う。保存する名前には使わない）
function stkNormName(s){
  return String(s||'').normalize('NFKC').toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[×xX＊*✕]/g, 'x')
    .replace(/[‐‑‒–—―ー－-]/g, '-')
    .replace(/[（(]/g, '(').replace(/[）)]/g, ')')
    .replace(/ⅱ/g, 'ii').replace(/ⅰ/g, 'i').replace(/ⅲ/g, 'iii');
}
// かっこ書き（補足）を外したもの
function stkNormCore(s){ return stkNormName(s).replace(/\([^)]*\)/g, ''); }
// 字の並びの似かた（2字ずつに区切って、どれだけ重なるか。0〜1）
function stkSimilar(a, b){
  if(a===b) return 1;
  if(a.length<2 || b.length<2) return 0;
  const grams = s=>{ const m=new Map(); for(let i=0;i<s.length-1;i++){ const g=s.slice(i,i+2); m.set(g,(m.get(g)||0)+1); } return m; };
  const A=grams(a), B=grams(b);
  let hit=0;
  A.forEach((n,g)=>{ hit += Math.min(n, B.get(g)||0); });
  return 2*hit / ((a.length-1)+(b.length-1));
}
// 寸法や型番の数字が食いちがっていないか（「45mm」と「90mm」を同じにしないため）
// 空白を詰める前に拾う（詰めてからだと「4000 10本」が「400010」になってしまう）
function stkNumsOf(s){ return (String(s||'').normalize('NFKC').match(/\d+(?:\.\d+)?/g)||[]).join(','); }
// かっこ・区切りの記号そのものを外したもの（中身は残す）。「（10本/束）」と「10本/束」を同じに見る
function stkNormLoose(s){ return stkNormName(s).replace(/[()\[\]【】「」『』・,、。.:：;；]/g, ''); }

// 在庫の品目1つに、品目マスタからいちばん合うものを探す
function stkFindMaster(stockName, info){
  const list = ((typeof master!=='undefined' ? master : [])||[]).filter(m=>m && m.name && m.supplier!==STOCK_NAME);
  const pool = info?.supplier ? list.filter(m=>m.supplier===info.supplier) : list;
  const n = stkNormName(stockName), core = stkNormCore(stockName), nums = stkNumsOf(stockName);
  let best = null;
  pool.forEach(m=>{
    if(m.name===stockName) return;
    const mn = stkNormName(m.name), mc = stkNormCore(m.name);
    let score = 0, kind = '';
    if(mn===n){ score = 1; kind = 'same'; }
    else if(stkNormLoose(m.name)===stkNormLoose(stockName)){ score = 0.98; kind = 'same'; }
    // かっこ書きの補足だけがちがう（「ウートップハイムシールド (透湿防水シート)」など）。
    // かっこの中に寸法が入っていることがあるので、かっこの外の数字がそろっているものだけ
    else if(mc===core && core.length>=3 && stkNumsOf(m.name)===nums){ score = 0.97; kind = 'same'; }
    else if(stkNumsOf(m.name)===nums){
      // 数字（寸法・型番）がそろっているものだけを候補にする
      const contain = (mn.includes(n) || n.includes(mn)) && Math.min(mn.length, n.length)>=4;
      const sim = stkSimilar(mc, core);
      if(contain){ score = 0.85 + sim*0.1; kind = 'near'; }
      else if(sim>=0.72){ score = sim*0.9; kind = 'near'; }
    }
    if(score && (!best || score>best.score)) best = { m, score, kind };
  });
  return best;
}

// 合わせる候補の一覧をつくる
function stkMatchRows(){
  const names = new Set(((typeof master!=='undefined' ? master : [])||[]).filter(m=>m.supplier!==STOCK_NAME).map(m=>m.name));
  const rows = [];
  stkList('').forEach(s=>{
    if(names.has(s.name)) return;                 // もう品目マスタと同じ名前
    const info = stkInfoOf(s.name);
    const hit = stkFindMaster(s.name, info);
    if(!hit) return;
    rows.push({ from:s.name, to:hit.m.name, unitFrom:s.unit||'', unitTo:hit.m.unit||'', supplier:hit.m.supplier||'',
      cat:hit.m.cat||'', kind:hit.kind, score:hit.score, sel: hit.kind==='same',
      // 品目マスタのいまの単価（先の日付の変更予定がある場合も考える）と、在庫のいまの平均単価
      costTo: Math.round((typeof itemCurrentCost==='function' ? itemCurrentCost(hit.m) : Number(hit.m.cost)) || 0),
      costFrom: Math.round(s.avgCost||0), hasQty: (s.allIn||0) > 0,
      // 合わせた先に、もう同じ名前の在庫があるか（あれば1つにまとまる）
      merge: stkList('').some(x=>x.name===hit.m.name) });
  });
  return rows.sort((a,b)=> (a.kind==='same'?0:1)-(b.kind==='same'?0:1) || b.score-a.score || a.from.localeCompare(b.from,'ja'));
}

function openStockMatch(){
  if(!((typeof master!=='undefined' ? master : [])||[]).length){ showToast('品目マスタに品目がありません'); return; }
  stkMatch.rows = stkMatchRows();
  renderStockMatch();
  document.getElementById('stock-match-modal').classList.add('open');
}
function closeStockMatch(){ document.getElementById('stock-match-modal').classList.remove('open'); }

function renderStockMatch(){
  const rows = stkMatch.rows;
  const el = document.getElementById('stkm-list');
  const same = rows.filter(r=>r.kind==='same').length, near = rows.length-same;
  const all = stkList('').length;
  const done = all - rows.length - stkUnmatchedCount();
  document.getElementById('stkm-sub').innerHTML = rows.length
    ? `書き方がちがうだけの品目 <b>${same}</b>　似ている品目 <b>${near}</b><br>`
      + `<span>「同じ」ははじめから選んであります。「候補」は目で確かめて、同じものだけ選んでください。</span>`
    : '合わせる候補はありません。';
  const head = k => `<div class="stk-cat-head">${k==='same'?'同じ（書き方がちがうだけ）':'候補（似ている。確かめて選ぶ）'}<span>${rows.filter(r=>r.kind===k).length}品目</span></div>`;
  let last = '';
  el.innerHTML = rows.map((r,i)=>{
    const h = r.kind!==last ? head(r.kind) : ''; last = r.kind;
    return `${h}<label class="stkm-row${r.sel?' sel':''}">
      <input type="checkbox" class="orv-ck" ${r.sel?'checked':''} onchange="stkMatchSelect(${i}, this.checked)">
      <div class="stkm-main">
        <div class="stkm-from">${esc(r.from)}</div>
        <div class="stkm-to">→ ${esc(r.to)}</div>
        <div class="stkm-meta">${r.supplier?esc(r.supplier):''}${r.unitTo && r.unitTo!==r.unitFrom ? `　単位 ${esc(r.unitFrom||'—')} → ${esc(r.unitTo)}` : ''}${
          (r.costTo>0 && r.costTo!==r.costFrom) ? (r.hasQty ? `　単価 ¥${fmt(r.costFrom)} → ¥${fmt(r.costTo)}` : `　単価 ¥${fmt(r.costTo)}（在庫が0なので、入庫のときに入れてください）`) : ''}${
          r.merge ? '<span class="stk-pend">同じ名前の在庫があります（1つにまとまります）</span>' : ''}</div>
      </div>
    </label>`;
  }).join('') || `<div class="empty" style="padding:18px">在庫の品目は、品目マスタと同じ名前か、似た品目が見つからないものだけです</div>`;
  const rest = stkUnmatchedCount();
  document.getElementById('stkm-note').textContent =
    `品目マスタと同じ名前：${Math.max(0,done)}品目　／　似た品目が見つからない：${rest}品目`;
  const n = rows.filter(r=>r.sel).length;
  const btn = document.getElementById('stkm-save');
  btn.disabled = !n || stkMatch.busy;
  btn.textContent = n ? `選んだ${n}品目を合わせる` : '選んだものを合わせる';
}
// 品目マスタに同じ名前が無く、似た品目も見つからなかった数
function stkUnmatchedCount(){
  const names = new Set(((typeof master!=='undefined' ? master : [])||[]).filter(m=>m.supplier!==STOCK_NAME).map(m=>m.name));
  const cand = new Set(stkMatch.rows.map(r=>r.from));
  return stkList('').filter(s=>!names.has(s.name) && !cand.has(s.name)).length;
}
function stkMatchSelect(i, on){
  const r = stkMatch.rows[i]; if(!r) return;
  r.sel = !!on;
  renderStockMatch();
}

async function saveStockMatch(){
  if(stkMatch.busy) return;
  const picked = stkMatch.rows.filter(r=>r.sel);
  if(!picked.length){ showToast('合わせる品目を選んでください'); return; }
  // 同じ先に2つ以上まとめようとしていないか（まとめてよいが、知らせておく）
  const dupTo = picked.map(r=>r.to).filter((t,i,a)=>a.indexOf(t)!==i);
  if(!confirm(`${picked.length}品目の名前を、品目マスタの名前に合わせます。\n\n`
    + picked.slice(0,10).map(r=>`・${r.from}\n　→ ${r.to}`).join('\n')
    + (picked.length>10 ? `\nほか ${picked.length-10}品目` : '')
    + ((dupTo.length || picked.some(r=>r.merge)) ? '\n\n同じ名前になる品目は、1つにまとまります（数は足されます）。' : '')
    + '\n\n数は変わりません。単位と単価は、品目マスタにそろえます（在庫金額と、これから出庫する分の原価が変わります）。よろしいですか？')) return;

  stkMatch.busy = true;
  renderStockMatch();
  let ok = 0, failed = null, costFailed = 0;
  for(const r of picked){
    const sup = (suppliers||[]).find(x=>x.name===r.supplier);
    const { error } = await sb.rpc('app_stock_rename', {
      p_from: r.from, p_to: r.to, p_unit: r.unitTo||null, p_supplier_id: sup?.id||null, p_cat: r.cat||null });
    if(error){ failed = error; break; }
    ok++;
    // 単価も品目マスタに合わせる。まとまった先の在庫もふくめて、その品目の平均単価をそろえる。
    // 在庫の数が 0 の品目は、手続きの側で何もしない（金額を持てないため）
    if(r.costTo > 0){
      const res = await sb.rpc('app_stock_move', { p_kind:'cost', p_name:r.to, p_unit:r.unitTo||'', p_qty:0,
        p_unit_cost:r.costTo, p_project:'', p_note:'品目マスタの単価に合わせた', p_place:STOCK_PLACE_DEFAULT });
      if(res.error) costFailed++;
    }
  }
  stkMatch.busy = false;
  // 名前が変わったので、原価の明細と品目の情報を取り直す
  if(ok){
    if(typeof refetchOrdersAndCost==='function'){ try{ await refetchOrdersAndCost(); }catch(_){} }
    try{ await stkLoadInfo(); }catch(_){}
  }
  if(failed){
    const code = String(failed.code||''), msg = String(failed.message||'');
    showToast((code==='PGRST202' || code==='42883' || /app_stock_rename/.test(msg) && /find|exist|schema cache/i.test(msg))
      ? 'データベースの準備が必要です。supabase/migration-genba102.sql を実行してください'
      : `${ok}品目を合わせたところで止まりました：${msg}`, 8000);
  } else {
    showToast(`${ok}品目を、品目マスタに合わせました${costFailed?`（うち${costFailed}品目は単価を直せませんでした）`:''}`, costFailed?7000:3000);
  }
  renderStockPage();
  stkMatch.rows = stkMatchRows();
  if(stkMatch.rows.length && !failed) renderStockMatch(); else if(!failed) closeStockMatch(); else renderStockMatch();
}
