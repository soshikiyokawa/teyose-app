// ════ エクレアパーツ：ホームページから単価を取ってくる ════
//
// 品目マスタに「品番」を入れておいた品目だけが対象。
// 取ってきた単価はいったん web_price に入るだけで、原価はここで選んだものだけ書き換える。
// 毎月1日にも自動で取りにいき、原価と違う品目があれば管理者へ通知する（ekrea-price）。

const EKREA_SUPPLIER_MATCH = 'エクレア';

function isEkreaSupplier(name){ return String(name||'').includes(EKREA_SUPPLIER_MATCH); }

// 発注先タブがエクレアパーツのときだけ、取得ボタンを出す
function renderEkreaBar(){
  const bar=document.getElementById('ekrea-bar');
  if(!bar) return;
  const show = currentUserRole==='staff' && isEkreaSupplier(activeMasterSupplier);
  bar.style.display = show ? 'flex' : 'none';
  if(!show) return;
  const items=(master||[]).filter(m=>isEkreaSupplier(m.supplier));
  const withCode=items.filter(m=>m.makerCode);
  const last=withCode.map(m=>m.webPriceAt).filter(Boolean).sort().pop();
  const diff=withCode.filter(m=>m.webPrice!=null && m.webPrice!==m.cost).length;
  const noCode=items.length-withCode.length;
  document.getElementById('ekrea-status').innerHTML =
    `品番あり ${withCode.length}件／全${items.length}件`
    + (noCode ? `　<span style="color:var(--warn-t)">品番なし ${noCode}件は取得できません</span>` : '')
    + (last ? `<br>最終取得 ${ekreaDateLabel(last)}` : '<br>まだ取得していません')
    + (diff ? `　<span style="color:var(--danger);font-weight:700">原価と違うもの ${diff}件</span>` : '');
  // 品番の入っていない品目があるときだけ「品番を自動で探す」を出す
  document.getElementById('ekrea-guess-btn').style.display = noCode ? '' : 'none';
}

function ekreaDateLabel(iso){
  const d=new Date(iso);
  if(isNaN(d)) return '';
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── 取得 ──
let _ekreaRows=[];
async function checkEkreaPrices(){
  const btn=document.getElementById('ekrea-check-btn');
  const old=btn.innerHTML;
  btn.disabled=true; btn.innerHTML='取得中…（少し時間がかかります）';
  try{
    const res=await dbCheckEkreaPrices();
    await refreshMasterItems();
    renderMaster();
    openEkreaDiff(res);
  }catch(_){
    // dbCheckEkreaPrices内でトースト表示済み
  }finally{
    btn.disabled=false; btn.innerHTML=old;
  }
}

// ── 差の確認 ──
function openEkreaDiff(res){
  const items=(master||[]).filter(m=>isEkreaSupplier(m.supplier) && m.makerCode && m.webPrice!=null);
  _ekreaRows=items.map(m=>({id:m.id, name:m.name, makerCode:m.makerCode, unit:m.unit, cost:m.cost, webPrice:m.webPrice}))
    .sort((a,b)=>(b.webPrice!==b.cost)-(a.webPrice!==a.cost));
  const changed=_ekreaRows.filter(r=>r.webPrice!==r.cost);
  const errors=(res?.errors||[]);
  const missed=(res?.checked||0)-(res?.got||0);

  document.getElementById('ekrea-diff-sub').innerHTML =
    `${res?.checked||0}件を確認して、${res?.got||0}件の単価が取れました。`
    + (changed.length ? `<b style="color:var(--danger)">原価と違うもの ${changed.length}件</b>` : '<b style="color:var(--ok-t)">原価との違いはありません</b>')
    + (missed>0 ? `<br><span style="color:var(--warn-t)">${missed}件は取得できませんでした（品番違い・取扱終了の可能性）</span>` : '')
    + (errors.length ? `<br><span style="font-size:11px;color:var(--text-muted)">${errors.slice(0,5).map(esc).join('<br>')}</span>` : '');

  document.getElementById('ekrea-diff-body').innerHTML = _ekreaRows.length
    ? _ekreaRows.map(ekreaDiffRow).join('')
    : '<div class="empty" style="padding:16px">品番を入れた品目がありません。品目を開いて品番（例：30-8582）を入れてください</div>';
  document.getElementById('ekrea-apply-btn').style.display = changed.length ? '' : 'none';
  document.getElementById('ekrea-diff-modal').classList.add('open');
}

function ekreaDiffRow(r){
  const same = r.webPrice===r.cost;
  const up = r.webPrice>r.cost;
  return `<label class="master-item" style="display:flex;align-items:center;gap:8px;cursor:${same?'default':'pointer'}">
    ${same ? '<span style="width:16px"></span>'
           : `<input type="checkbox" class="ekrea-pick" value="${r.id}" checked style="width:auto;margin:0;flex:none">`}
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</div>
      <div style="font-size:11px;color:var(--text-muted)">品番 ${esc(r.makerCode)}</div>
    </div>
    <div style="font-size:12px;text-align:right;flex:none">
      ${same
        ? `<span style="color:var(--text-sub)">¥${fmt(r.cost)}　<span style="font-size:10px">変更なし</span></span>`
        : `<span style="color:var(--text-muted);text-decoration:line-through">¥${fmt(r.cost)}</span>
           <span style="font-weight:700;color:${up?'var(--danger)':'var(--ok-t)'}"> → ¥${fmt(r.webPrice)}</span>
           <div style="font-size:10px;color:${up?'var(--danger)':'var(--ok-t)'}">${up?'＋':'－'}¥${fmt(Math.abs(r.webPrice-r.cost))}</div>`}
    </div>
  </label>`;
}

function ekreaDiffCheckAll(on){
  document.querySelectorAll('.ekrea-pick').forEach(c=>c.checked=on);
}
function closeEkreaDiff(){
  document.getElementById('ekrea-diff-modal').classList.remove('open');
}

// ── 反映（選んだ品目の原価だけ書き換える） ──
async function applyEkreaPrices(){
  const ids=[...document.querySelectorAll('.ekrea-pick:checked')].map(c=>Number(c.value));
  if(!ids.length){ showToast('反映するものを選んでください'); return; }
  if(!confirm(`${ids.length}件の原価をホームページの単価に書き換えます。よろしいですか？`)) return;
  const btn=document.getElementById('ekrea-apply-btn');
  btn.disabled=true; btn.innerHTML='反映中…';
  let done=0;
  try{
    for(const id of ids){
      const m=(master||[]).find(x=>x.id===id);
      if(!m || m.webPrice==null) continue;
      await dbUpdateMasterItem(id, {...m, cost:m.webPrice, price:m.webPrice});
      m.cost=m.webPrice; m.price=m.webPrice;
      done++;
    }
    closeEkreaDiff();
    renderMaster();
    showToast(`${done}件の原価を更新しました`);
  }catch(_){
    showToast(`${done}件まで更新しました（残りは失敗しました）`);
  }finally{
    btn.disabled=false; btn.innerHTML='選んだ分を原価に反映';
  }
}

// ════ 品番を自動で探す ════
//
// エクレアのサイトは商品名で検索してもヒットしないため、こちらでカタログの索引
// （品番→商品名・単価）を作っておき、品目マスタの品目名と照らして候補を出す。
// 決めるのは人。似ている順に並べて、選んだものだけ品番として保存する。

let _ekreaCatalog=null;

// 名前をくらべやすい形にそろえる（全角英数→半角、記号とスペースを落とす）
function ekreaNorm(s){
  return String(s||'')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0))
    .replace(/[\s　・,，.．\/\-ー－_（）()「」【】]/g,'')
    .toLowerCase();
}
// 2文字ずつの重なり具合で似ているかを測る（0〜1）
function ekreaSimilarity(a,b){
  const A=ekreaNorm(a), B=ekreaNorm(b);
  if(!A||!B) return 0;
  if(A===B) return 1;
  const pair=s=>{ const m=new Map(); for(let i=0;i<s.length-1;i++){ const k=s.slice(i,i+2); m.set(k,(m.get(k)||0)+1); } return m; };
  const pa=pair(A), pb=pair(B);
  if(!pa.size||!pb.size) return A.includes(B)||B.includes(A) ? 0.6 : 0;
  let hit=0;
  pa.forEach((n,k)=>{ hit += Math.min(n, pb.get(k)||0); });
  return (2*hit)/(A.length-1 + B.length-1);
}

// ── カタログの取り込み（少しずつ進む。押すたびに続きを読む） ──
async function buildEkreaCatalog(){
  const btn=document.getElementById('ekrea-catalog-btn');
  const old=btn.innerHTML;
  btn.disabled=true;
  try{
    let res, guard=0;
    do{
      btn.innerHTML='カタログ取り込み中…' + (res ? `（残り${res.pages.remaining}ページ）` : '');
      res=await dbBuildEkreaCatalog();
      guard++;
    }while(res.pages.remaining>0 && guard<20);
    _ekreaCatalog=null;
    showToast(res.pages.remaining>0
      ? `カタログを${res.pages.done}／${res.pages.total}ページまで取り込みました（続きはもう一度押してください）`
      : `カタログを取り込みました（${res.catalog}品番）`);
    renderEkreaBar();
  }catch(_){
  }finally{
    btn.disabled=false; btn.innerHTML=old;
  }
}

// ── 品番の候補を出す ──
let _ekreaGuess=[];
async function guessEkreaCodes(){
  const btn=document.getElementById('ekrea-guess-btn');
  const old=btn.innerHTML;
  btn.disabled=true; btn.innerHTML='照合中…';
  try{
    if(!_ekreaCatalog) _ekreaCatalog=await dbFetchEkreaCatalog();
    if(!_ekreaCatalog.length){
      showToast('カタログがまだ空です。先に「カタログを取り込む」を押してください');
      return;
    }
    const targets=(master||[]).filter(m=>isEkreaSupplier(m.supplier) && !m.makerCode);
    _ekreaGuess=targets.map(m=>{
      const cands=_ekreaCatalog
        .map(c=>({...c, score:ekreaSimilarity(m.name, c.name)}))
        .sort((a,b)=>b.score-a.score)
        .slice(0,3)
        .filter(c=>c.score>=0.3);
      return {id:m.id, name:m.name, cost:m.cost, cands, pick:(cands[0]&&cands[0].score>=0.55)?cands[0].makerCode:''};
    });
    openEkreaGuess();
  }catch(_){
  }finally{
    btn.disabled=false; btn.innerHTML=old;
  }
}

function openEkreaGuess(){
  const strong=_ekreaGuess.filter(g=>g.pick).length;
  const none=_ekreaGuess.filter(g=>!g.cands.length).length;
  document.getElementById('ekrea-guess-sub').innerHTML =
    `品番が入っていない品目 ${_ekreaGuess.length}件を、カタログ${_ekreaCatalog.length}品番と照らしました。`
    + (strong?`<br><b style="color:var(--ok-t)">よく似ているもの ${strong}件</b>をあらかじめ選んでいます。` : '')
    + (none?`<br><span style="color:var(--warn-t)">候補が見つからないもの ${none}件</span>` : '')
    + `<br><span style="font-size:11px;color:var(--text-muted)">中身をご確認のうえ選んでください。品番が違うと金額も違ってしまいます。</span>`;
  document.getElementById('ekrea-guess-body').innerHTML = _ekreaGuess.length
    ? _ekreaGuess.map(ekreaGuessRow).join('')
    : '<div class="empty" style="padding:16px">品番が入っていない品目はありません</div>';
  document.getElementById('ekrea-guess-modal').classList.add('open');
}

function ekreaGuessRow(g){
  const opts = g.cands.map(c=>`
    <label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer">
      <input type="radio" name="eg-${g.id}" value="${esc(c.makerCode)}"${g.pick===c.makerCode?' checked':''}
             onchange="ekreaGuessPick(${g.id}, this.value)" style="width:auto;margin:0;flex:none">
      <span style="font-size:11px;flex:1;min-width:0">
        <b>${esc(c.makerCode)}</b>　${esc(c.name)}
        <span style="color:var(--text-muted)">　${c.price!=null?'¥'+fmt(c.price):'価格なし'}　似ている度 ${Math.round(c.score*100)}%</span>
      </span>
    </label>`).join('');
  return `<div class="master-item" style="display:block">
    <div style="font-size:12px;font-weight:700">${esc(g.name)}<span style="font-weight:400;color:var(--text-muted)">　現在の原価 ¥${fmt(g.cost)}</span></div>
    ${g.cands.length ? opts + `
      <label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer">
        <input type="radio" name="eg-${g.id}" value=""${g.pick?'':' checked'} onchange="ekreaGuessPick(${g.id}, '')" style="width:auto;margin:0;flex:none">
        <span style="font-size:11px;color:var(--text-sub)">どれでもない（あとで手で入れる）</span>
      </label>`
      : '<div style="font-size:11px;color:var(--warn-t)">似ている商品が見つかりませんでした。品番は手で入れてください</div>'}
  </div>`;
}

function ekreaGuessPick(id, code){
  const g=_ekreaGuess.find(x=>x.id===id);
  if(g) g.pick=code;
}
function closeEkreaGuess(){ document.getElementById('ekrea-guess-modal').classList.remove('open'); }

// 選んだ品番を品目マスタに保存する
async function applyEkreaGuess(){
  const picks=_ekreaGuess.filter(g=>g.pick);
  if(!picks.length){ showToast('品番を選んでください'); return; }
  if(!confirm(`${picks.length}件に品番を登録します。よろしいですか？`)) return;
  const btn=document.getElementById('ekrea-guess-apply');
  btn.disabled=true; btn.innerHTML='登録中…';
  let done=0;
  try{
    for(const g of picks){
      const m=(master||[]).find(x=>x.id===g.id);
      if(!m) continue;
      await dbUpdateMasterItem(m.id, {...m, makerCode:g.pick});
      m.makerCode=g.pick;
      done++;
    }
    closeEkreaGuess();
    renderMaster();
    showToast(`${done}件に品番を登録しました。「ホームページの単価を確認」で金額を取れます`);
  }catch(_){
    showToast(`${done}件まで登録しました（残りは失敗しました）`);
  }finally{
    btn.disabled=false; btn.innerHTML='選んだ品番を登録';
  }
}

// 保存や取得のあとに品目マスタを取り直す
async function refreshMasterItems(){
  const { data } = await sb.from('master_items').select('*').order('sort_order').order('id');
  if(!data) return;
  master = data.map(r=>({id:r.id,cat:r.cat,name:r.name,unit:r.unit,price:Number(r.price),cost:Number(r.cost),
    supplier:supplierNameById(r.supplier_id),sortOrder:r.sort_order,
    makerCode:r.maker_code||'', webPrice:(r.web_price==null?null:Number(r.web_price)), webPriceAt:r.web_price_at||''}));
}
