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
  document.getElementById('ekrea-status').innerHTML =
    `品番あり ${withCode.length}件／全${items.length}件`
    + (withCode.length<items.length ? `　<span style="color:var(--warn-t)">品番の入っていない品目は取得できません</span>` : '')
    + (last ? `<br>最終取得 ${ekreaDateLabel(last)}` : '<br>まだ取得していません')
    + (diff ? `　<span style="color:var(--danger);font-weight:700">原価と違うもの ${diff}件</span>` : '');
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

// 保存や取得のあとに品目マスタを取り直す
async function refreshMasterItems(){
  const { data } = await sb.from('master_items').select('*').order('sort_order').order('id');
  if(!data) return;
  master = data.map(r=>({id:r.id,cat:r.cat,name:r.name,unit:r.unit,price:Number(r.price),cost:Number(r.cost),
    supplier:supplierNameById(r.supplier_id),sortOrder:r.sort_order,
    makerCode:r.maker_code||'', webPrice:(r.web_price==null?null:Number(r.web_price)), webPriceAt:r.web_price_at||''}));
}
