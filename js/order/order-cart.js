// ════ 受発注：発注作成フロー（発注先選択 → 品目選択 → カート） ════

function orderSubTab(t){
  document.querySelectorAll('#page-order .sub-tab-btn').forEach((b,i)=>b.classList.toggle('active',['new','supplier','master','invoice','history','card'][i]===t));
  document.querySelectorAll('#page-order .sub-page').forEach(p=>p.classList.remove('active'));
  document.getElementById('ordersub-'+t).classList.add('active');
  if(t==='new') renderSupplierSelectList();
  if(t==='supplier') renderSupplierMaster();
  if(t==='master') renderMaster();
  if(t==='invoice') renderInvoices();
  if(t==='history') renderOrders();
  if(t==='card') renderCardPage();
}

// ── STEP1: 発注先リスト ──
function renderSupplierSelectList(){
  const el=document.getElementById('supplier-select-list');
  if(!suppliers.length){el.innerHTML='<div class="empty">発注先が登録されていません</div>';return;}
  el.innerHTML=suppliers.map(s=>{
    const isStock=s.name==='在庫分';
    return `
    <div class="supplier-card${selectedSupplier&&selectedSupplier.id===s.id?' selected':''}" onclick="selectSupplier(${s.id})">
      <div class="sup-icon">${isStock?'📦':'🏪'}</div>
      <div class="sup-info">
        <div class="sup-name">${s.name}</div>
        <div class="sup-meta">${isStock?'自社在庫から現場へ出す（原価は使う現場に計上）':s.contact+(s.tel?' · '+s.tel:'')}</div>
        <div class="sup-meta" style="color:var(--accent-t);margin-top:1px">${isStock?'':s.cats||'—'}</div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" width="16" height="16" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  }).join('');
}

function selectSupplier(id){
  selectedSupplier=suppliers.find(s=>s.id===id);
  activeCat='全て';
  cart=[];
  document.getElementById('order-step1').style.display='none';
  document.getElementById('order-step2').style.display='block';
  document.getElementById('selected-supplier-name').textContent=selectedSupplier.name;
  renderOrderProjectSelect();
  renderCatFilter();
  renderItemSelectList();
  renderCart();
  orderDueAsap = false;
  renderOrderDueNote();
}

// 発注の紐づけ先（案件 or 在庫分 or 経費）の選択肢。サイドバーで選択中の案件を初期値にする
function renderOrderProjectSelect(){
  const el=document.getElementById('order-project');
  if(!el) return;
  const prev=el.value;
  el.innerHTML='<option value="">選択してください</option>'
    +'<option value="在庫分">在庫分（案件に紐づかない発注）</option>'
    +`<option value="${EXPENSE_PROJECT}">経費（会社の経費。勘定科目で分ける）</option>`
    +projects.map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  el.value = prev || selectedProjectName || '';
  if(el.selectedIndex<0) el.selectedIndex=0;
  updateOrderPreviewBtnState();
}

// ════ 経費（案件に紐づかない会社の経費） ════
//
// 案件で「経費」を選ぶと、費目区分の代わりに勘定科目を選ぶ。
// 選んだ科目は cost_type にそのまま入る（案件名が「経費」の明細は、どの現場の原価にも混ざらない）。
const EXPENSE_PROJECT = '経費';
const COST_TYPE_OPTIONS = ['材料費','外注費','労務費','諸経費'];
// desc … どんな費用がこの科目になるか／ex … よくある例
const EXPENSE_ACCOUNTS = [
  {name:'消耗品費',   desc:'すぐ使い切る物や、10万円未満の道具・備品。',
   ex:'文房具、コピー用紙、電池、軍手、清掃用品、10万円未満の工具・パソコン周辺機器'},
  {name:'旅費交通費', desc:'仕事での移動にかかる費用。',
   ex:'電車・バス・タクシー代、高速道路料金、コインパーキング、出張の宿泊費'},
  {name:'通信費',     desc:'電話・インターネット・郵便の費用。',
   ex:'携帯電話・固定電話の料金、ネット回線、切手・はがき、レターパック'},
  {name:'接待交際費', desc:'取引先やお客さまとの付き合いにかかる費用。',
   ex:'取引先との会食、お中元・お歳暮、手土産、祝い金・香典、職人さんへの差し入れ'},
  {name:'福利厚生費', desc:'社員みんなのための費用（特定の人だけのものは入らない）。',
   ex:'社員の飲み物・お茶菓子、健康診断、社員旅行、慶弔見舞金、全員に配る作業着'},
  {name:'会議費',     desc:'打合せや会議にかかる費用。飲食は1人1万円以下が目安。',
   ex:'打合せの飲み物・お弁当、会議室の利用料、打合せを兼ねた軽い食事'},
  {name:'広告宣伝費', desc:'会社や家づくりを知ってもらうための費用。',
   ex:'チラシ、ホームページ、ネット広告、看板、見学会・イベントの費用、社名入りの配布物'},
  {name:'水道光熱費', desc:'事務所・作業場・倉庫の電気・ガス・水道の料金。',
   ex:'事務所の電気代、作業場のガス代、倉庫の水道代（現場の仮設電気・水道は案件へ）'},
  {name:'荷造運賃',   desc:'物を送る・運ぶための費用。',
   ex:'宅配便・運送費、段ボール・緩衝材などの梱包材'},
  {name:'支払手数料', desc:'サービスや手続きに払う手数料。',
   ex:'振込手数料、決済手数料、税理士・司法書士への報酬、各種の事務手数料'},
  {name:'地代家賃',   desc:'土地や建物を借りている費用。',
   ex:'事務所・倉庫・資材置き場の家賃、月極駐車場'},
  {name:'租税公課',   desc:'税金や、国・役所に払うお金（法人税・住民税は入らない）。',
   ex:'収入印紙、自動車税、固定資産税、登録免許税、住民票・印鑑証明の発行手数料'},
  {name:'雑費',       desc:'どの科目にも当てはまらず、金額が小さく、たまにしか出ない費用。',
   ex:'クリーニング代、少額のゴミ処理代（毎月出るもの・高額なものは雑費にしない）'},
];
function isExpenseProject(p){ return p === EXPENSE_PROJECT; }
function costTypeLabelOf(project){ return isExpenseProject(project) ? '勘定科目' : '費目区分'; }

// 案件に合わせて「費目区分／勘定科目」の欄を切り替える。
// 何度呼んでも、切り替えが必要なときだけ選択肢を作り直す（選んだ値は消さない）
let _costFieldMode = '';
function syncOrderCostTypeField(){
  const sel = document.getElementById('order-cost-type');
  if(!sel) return;
  const expense = isExpenseProject(document.getElementById('order-project')?.value);
  const mode = expense ? 'account' : 'cost';
  if(mode !== _costFieldMode){
    _costFieldMode = mode;
    const prev = sel.value;
    const names = expense ? EXPENSE_ACCOUNTS.map(a=>a.name) : COST_TYPE_OPTIONS;
    sel.innerHTML = '<option value="">選択してください</option>'
      + names.map(n=>`<option value="${n}">${n}</option>`).join('');
    sel.value = names.includes(prev) ? prev : '';
    const lbl = document.getElementById('order-cost-type-lbl');
    if(lbl) lbl.textContent = costTypeLabelOf(expense ? EXPENSE_PROJECT : '');
  }
  renderAccountHelp();
}

// 選んだ勘定科目の説明と、全科目の説明一覧
function renderAccountHelp(){
  const box = document.getElementById('order-account-help');
  if(!box) return;
  const expense = _costFieldMode === 'account';
  box.hidden = !expense;
  if(!expense) return;
  const picked = document.getElementById('order-cost-type')?.value || '';
  const cur = EXPENSE_ACCOUNTS.find(a=>a.name===picked);
  const wasOpen = !!box.querySelector('details')?.open;
  box.innerHTML = (cur
      ? `<div class="acct-now"><div class="acct-now-desc">${esc(cur.desc)}</div>
           <div class="acct-now-ex">例：${esc(cur.ex)}</div></div>`
      : `<div class="acct-now acct-now-empty">科目を選ぶと、どんな費用が当てはまるかがここに出ます</div>`)
    + `<details class="acct-all"${wasOpen?' open':''}>
         <summary>どの科目か迷ったら（全科目の説明）</summary>
         ${EXPENSE_ACCOUNTS.map(a=>`
           <button type="button" class="acct-row${a.name===picked?' on':''}" onclick="pickExpenseAccount('${a.name}')">
             <span class="acct-row-name">${esc(a.name)}</span>
             <span class="acct-row-desc">${esc(a.desc)}</span>
             <span class="acct-row-ex">例：${esc(a.ex)}</span>
           </button>`).join('')}
         <div class="acct-note">現場で使う材料・道具は、経費ではなくその案件を選んでください。10万円以上の物は事務に確認してください。</div>
       </details>`;
}
function pickExpenseAccount(name){
  const sel = document.getElementById('order-cost-type');
  if(!sel) return;
  sel.value = name;
  const d = document.querySelector('#order-account-help details');
  if(d) d.open = false;   // 選んだら一覧は閉じる
  updateOrderPreviewBtnState();
}

// ── 納品希望日の「最短」 ──
//
// いちばん早い納品日は翌日。ただし日曜は建材屋が動かないので月曜にする。
// あくまで初期値なので、入れたあとから直せる。
//
// 「最短」で出した発注は、発注書にも日付ではなく「最短」と書いて渡す。
// 日付そのものは社内の納期の目安として持っておく。
let orderDueAsap = false;
// 発注書に出す納品希望日の書き方
function orderDueLabel(o){
  if(o?.dueAsap) return '最短';
  return o?.dueDate || '未指定';
}
function orderSoonestDue(){
  const d = new Date();
  d.setDate(d.getDate() + 1);
  if(d.getDay() === 0) d.setDate(d.getDate() + 1);   // 日曜は飛ばす
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function setOrderDueSoonest(){
  const el = document.getElementById('order-due-date');
  if(!el) return;
  el.value = orderSoonestDue();
  orderDueAsap = true;
  updateOrderPreviewBtnState();
  renderOrderDueNote();
}
// 手で日付を選んだら「最短」ではなくなる
function orderDueChanged(){
  orderDueAsap = false;
  updateOrderPreviewBtnState();
  renderOrderDueNote();
}
// 入れた日が何曜日か、今日から何日後かを小さく添える
function renderOrderDueNote(){
  const note = document.getElementById('order-due-note');
  const v = document.getElementById('order-due-date')?.value;
  if(!note) return;
  if(!v){ note.textContent = ''; return; }
  const [y,m,d] = v.split('-').map(Number);
  const t = new Date(y, m-1, d);
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.round((t - today) / 86400000);
  const w = ['日','月','火','水','木','金','土'][t.getDay()];
  const when = days===0?'本日':days===1?'明日':days>0?`${days}日後`:`${-days}日前`;
  note.innerHTML = orderDueAsap
    ? `<b style="color:var(--accent-t)">「最短」で伝えます</b>（目安 ${m}/${d}（${w}）・${when}）`
    : `${m}/${d}（${w}）　${when}`;
}

// ── 納品場所 ──
//
// 「現場」ならその案件の住所、「きよかわ加工場」なら可部の加工場、
// 「その他」なら打った場所を、そのまま発注書に書く。
const KIYOKAWA_FACTORY = '広島県広島市安佐北区可部2-13-7';

// いま選ばれている納品場所を、発注データの形（種類と住所）で返す
function orderDeliveryOf(projectName){
  const place = document.getElementById('order-place')?.value || '現場';
  if(place==='きよかわ加工場') return { place, address: KIYOKAWA_FACTORY };
  if(place==='その他')         return { place, address: (document.getElementById('order-place-other')?.value||'').trim() };
  const p = (projects||[]).find(x=>x.name===projectName);
  return { place:'現場', address: (p?.address||'').trim() };
}
// 発注書・チャットに出す1行の書き方
function orderDeliveryLabel(o){
  const place = o?.deliveryPlace || '';
  const addr  = (o?.deliveryAddress || '').trim();
  if(place==='きよかわ加工場') return `きよかわ加工場${addr?`（${addr}）`:''}`;
  if(place==='その他')         return addr || 'その他';
  if(place==='現場')           return `${o?.project||''} 現場${addr?`（${addr}）`:''}`;
  // 納品場所を選ぶ前に出した古い発注は、これまでどおり「現場」と書く
  return `${o?.project||''} 現場`;
}
function orderPlaceChanged(){
  const place = document.getElementById('order-place')?.value || '現場';
  const other = document.getElementById('order-place-other');
  if(other) other.style.display = place==='その他' ? '' : 'none';
  if(place==='その他') other?.focus();
  updateOrderPreviewBtnState();
  renderOrderPlaceNote();
}
// 選んだ場所の住所を小さく添える（現場住所が未登録なら教える）
function renderOrderPlaceNote(){
  const note = document.getElementById('order-place-note');
  if(!note) return;
  const place = document.getElementById('order-place')?.value || '現場';
  if(place==='きよかわ加工場'){ note.textContent = KIYOKAWA_FACTORY; return; }
  if(place==='その他'){ note.textContent = '発注書には、ここに書いた場所をそのまま載せます'; return; }
  const projectName = document.getElementById('order-project')?.value || '';
  const addr = (projects||[]).find(x=>x.name===projectName)?.address || '';
  const noSite = projectName==='在庫分' || (typeof isExpenseProject==='function' && isExpenseProject(projectName));
  note.innerHTML = addr ? esc(addr)
    : noSite ? 'この案件に現場はありません。「きよかわ加工場」か「その他」を選んでください'
    : projectName ? '<b style="color:var(--warn-t)">この案件に現場住所が入っていません</b>（案件情報で登録できます）'
    : '案件を選ぶと現場住所が出ます';
}

function backToStep1(){
  document.getElementById('order-step1').style.display='block';
  document.getElementById('order-step2').style.display='none';
  renderSupplierSelectList();
}

// ── STEP2: カテゴリフィルタ ──
function renderCatFilter(){
  if(selectedSupplier?.name==='在庫分'){document.getElementById('cat-filter-wrap').innerHTML='';return;}
  const items=master.filter(m=>m.supplier===selectedSupplier.name);
  const cats=['全て',...new Set(items.map(m=>m.cat))];
  document.getElementById('cat-filter-wrap').innerHTML=cats.map(c=>`
    <button class="cat-pill${c===activeCat?' active':''}" onclick="setCat('${c}')">${c}</button>`).join('');
}

function setCat(cat){
  activeCat=cat;
  renderCatFilter();
  renderItemSelectList();
}

// ── STEP2: 品目リスト（選択式） ──
// 発注先「在庫分」の場合は品目マスタではなく、現在庫がある品目を表示する
let _stockList=[];
function renderStockItemList(){
  _stockList=Object.values(calcStock()).filter(s=>s.qty>0).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  const el=document.getElementById('item-select-list');
  if(!_stockList.length){el.innerHTML='<div class="empty">現在、在庫がありません。<br>案件「在庫分」で発注すると在庫に入ります。</div>';return;}
  el.innerHTML=_stockList.map((s,i)=>{
    const inCart=cart.find(c=>c.id==='stock:'+s.name);
    const {n, s:spec} = splitNameSpec(s.name);
    return `<div class="item-pick-card${inCart?' in-cart':''}" onclick="openStockQtyModal(${i})">
      <div class="ipc-info">
        <div class="ipc-row">
          <span class="ipc-name">${esc(n)}</span>
          <span class="ipc-spec">${esc(spec)}</span>
        </div>
        <div class="ipc-meta">在庫 ${s.qty}${s.unit}${inCart?` · カート: ${inCart.qty}${s.unit}`:'　／　タップして追加'}</div>
      </div>
      <div class="ipc-price">平均単価 ¥${fmt(s.avgCost)}/${s.unit}</div>
    </div>`;
  }).join('');
}

function renderItemSelectList(){
  if(selectedSupplier?.name==='在庫分'){renderStockItemList();return;}
  const items=master.filter(m=>{
    if(m.supplier!==selectedSupplier.name) return false;
    if(activeCat!=='全て'&&m.cat!==activeCat) return false;
    return true;
  });
  const el=document.getElementById('item-select-list');
  // 大林製材は、造作材をその場で作って入れられるようにする
  const zosakuCard = isZosakuSupplier(selectedSupplier) ? `
    <div class="item-pick-card zosaku-add" onclick="openZosakuModal()">
      <div class="ipc-info">
        <div class="ipc-row"><span class="ipc-name">造作材発注</span></div>
        <div class="ipc-meta">材種・等級・寸法を決めて、その場でカートに入れられます</div>
      </div>
    </div>` : '';
  if(!items.length){
    el.innerHTML = zosakuCard ||
      '<div class="empty">この発注先の品目がありません。<br>品目マスタで発注先を設定してください。</div>';
    return;
  }
  el.innerHTML=zosakuCard+items.map(m=>{
    const inCart=cart.find(c=>c.id===m.id);
    const {n, s} = splitNameSpec(m.name);
    return `<div class="item-pick-card${inCart?' in-cart':''}" onclick="openQtyModal(${m.id})">
      <div class="ipc-info">
        <div class="ipc-row">
          <span class="ipc-name">${n}</span>
          <span class="ipc-spec">${s}</span>
        </div>
        <div class="ipc-meta">${m.cat}${m.perBundle?` · 1束=${m.perBundle}${BUNDLE_PIECE_UNIT}`:''}${
          inCart?` · カート: ${inCart.qty}${m.unit}${bundleNote(m, inCart.qty)}`:'　／　タップして追加'}</div>
      </div>
      <div class="ipc-price">原価 ¥${fmt(itemCurrentCost(m))}/${m.unit}</div>
    </div>`;
  }).join('');
}

// ── 数量モーダル ──
function openQtyModal(itemId){
  const _m=master.find(m=>m.id===itemId);
  if(!_m) return;
  // 発注は「今日の時点で有効な単価」で行う（先の日付で予約された値上げはまだ使わない）
  pendingItem={..._m, cost:itemCurrentCost(_m), price:itemCurrentCost(_m)};
  const inCart=cart.find(c=>c.id===itemId);
  document.getElementById('qty-modal-title').textContent=inCart?'数量を変更':'数量を入力';
  document.getElementById('qty-item-name').textContent=pendingItem.name;
  document.getElementById('qty-item-meta').textContent=`原価 ¥${fmt(pendingItem.cost)}/${pendingItem.unit}　発注先：${pendingItem.supplier}`
    + (pendingItem.perBundle?`　1束=${pendingItem.perBundle}${BUNDLE_PIECE_UNIT}`:'');
  document.getElementById('qty-unit-label').textContent=pendingItem.unit;
  document.getElementById('qty-input').value=inCart?inCart.qty:1;
  // クイック選択ボタン
  const quicks=[1,2,3,5,10,20];
  // 単位が「束」の品目は、上のボタンがそのまま束の数なので、束のボタンは出さない
  const per=(pendingItem.unit===BUNDLE_UNIT) ? 0 : (Number(pendingItem.perBundle)||0);
  document.getElementById('qty-quick-btns').innerHTML=
    quicks.map(n=>`
    <button class="btn sm" onclick="document.getElementById('qty-input').value=${n}" style="min-width:44px;justify-content:center">${n}${pendingItem.unit}</button>`).join('')
    // 本で数える品目でも、束のボタンを出す（1束=何本かはマスタで決めてある）
    + (per ? [1,2,3,5].map(b=>`
    <button class="btn sm wood" onclick="document.getElementById('qty-input').value=${b*per}" style="min-width:52px;justify-content:center">${b}束<span style="font-size:10px;opacity:.8">(${b*per}${BUNDLE_PIECE_UNIT})</span></button>`).join('') : '');
  document.getElementById('qty-modal').classList.add('open');
  setTimeout(()=>document.getElementById('qty-input').focus(),100);
}

// 在庫品目の数量入力（在庫数を上限にする）
function openStockQtyModal(i){
  const s=_stockList[i];
  if(!s) return;
  pendingItem={id:'stock:'+s.name, cat:'在庫', name:s.name, unit:s.unit, cost:Math.round(s.avgCost), price:0, supplier:'在庫分', _stockMax:s.qty};
  const inCart=cart.find(c=>c.id===pendingItem.id);
  document.getElementById('qty-modal-title').textContent=inCart?'数量を変更':'数量を入力';
  document.getElementById('qty-item-name').textContent=s.name;
  document.getElementById('qty-item-meta').textContent=`在庫 ${s.qty}${s.unit}　平均単価 ¥${fmt(s.avgCost)}/${s.unit}`;
  document.getElementById('qty-unit-label').textContent=s.unit;
  document.getElementById('qty-input').value=inCart?inCart.qty:1;
  const quicks=[1,2,3,5,10,20].filter(n=>n<=s.qty);
  document.getElementById('qty-quick-btns').innerHTML=quicks.map(n=>`
    <button class="btn sm" onclick="document.getElementById('qty-input').value=${n}" style="min-width:44px;justify-content:center">${n}${s.unit}</button>`).join('');
  document.getElementById('qty-modal').classList.add('open');
  setTimeout(()=>document.getElementById('qty-input').focus(),100);
}

function closeQtyModal(){document.getElementById('qty-modal').classList.remove('open');pendingItem=null;}

function confirmQty(){
  if(!pendingItem) return;
  const qty=parseFloat(document.getElementById('qty-input').value)||0;
  if(qty<=0){closeQtyModal();return;}
  // 在庫品目は現在庫を超えて出庫できない
  if(pendingItem._stockMax!=null && qty>pendingItem._stockMax){
    alert(`在庫が足りません。「${pendingItem.name}」の現在庫は ${pendingItem._stockMax}${pendingItem.unit} です。`);
    return;
  }
  const ex=cart.find(c=>c.id===pendingItem.id);
  const {_stockMax, ...clean}=pendingItem;
  if(ex) ex.qty=qty; else cart.push({...clean,qty});
  closeQtyModal();
  renderItemSelectList();
  renderCart();
}

// ════ 造作材をその場で作ってカートに入れる（大林製材） ════
//
// 造作材は材種・等級・寸法の組み合わせが多すぎて品目マスタに持てないので、
// 発注のときに作れるようにする。単価は分からないことが多いので空でもよく、
// あとから大林製材が「単価・送料を直す」から入れられる。
const ZOSAKU_SUPPLIER = /大林製材/;
const ZOSAKU_CAT = '造作材';
const ZOSAKU_UNIT = '本';
function isZosakuSupplier(s){ return ZOSAKU_SUPPLIER.test(s?.name || ''); }

function openZosakuModal(){
  ['zs-kind','zs-t','zs-w','zs-l','zs-cost'].forEach(i=>{ const el=document.getElementById(i); if(el) el.value=''; });
  document.getElementById('zs-grade').value='化粧';
  zosakuSync();
  document.getElementById('zosaku-modal').classList.add('open');
  setTimeout(()=>document.getElementById('zs-kind')?.focus(),100);
}
function closeZosakuModal(){ document.getElementById('zosaku-modal').classList.remove('open'); }

const zsVal = id => String(document.getElementById(id)?.value || '').trim();
function zosakuSize(){
  const p=['zs-t','zs-w','zs-l'].map(id=>zsVal(id).replace(/[^\d.]/g,''));
  return p.every(Boolean) ? p.join('×') : '';
}
function zosakuCost(){
  return Math.max(0, parseInt(zsVal('zs-cost').replace(/[^\d]/g,''))||0);
}
function zosakuName(){
  const size=zosakuSize();
  return [zsVal('zs-kind'), zsVal('zs-grade')||document.getElementById('zs-grade')?.value, size]
    .filter(Boolean).join(' ');
}
function zosakuSync(){
  const kind=zsVal('zs-kind'), size=zosakuSize(), cost=zosakuCost();
  const ok=!!(kind && size);
  const pv=document.getElementById('zs-preview');
  if(pv) pv.innerHTML = ok
    ? `<b>${esc(zosakuName())}</b><br>
       <span style="color:var(--text-sub)">${ZOSAKU_CAT}／${ZOSAKU_UNIT}／単価 ${cost?'¥'+fmt(cost):'未定'}</span>`
    : `<span style="color:var(--text-muted)">材種と寸法（3つとも）を入れてください</span>`;
  const btn=document.getElementById('zs-next-btn');
  if(btn) btn.disabled=!ok;
}

// 内容が決まったら、いつもの数量モーダル（クイック選択・直接入力）へ渡す
function zosakuToQty(){
  const name=zosakuName();
  if(!zsVal('zs-kind') || !zosakuSize()){ showToast('材種と寸法を入れてください'); return; }
  const cost=zosakuCost();
  // 同じ内容をもう一度作ったときは、カートの同じ行の本数を変える
  pendingItem={ id:'zosaku:'+name, cat:ZOSAKU_CAT, name, unit:ZOSAKU_UNIT,
    cost, price:cost, supplier:selectedSupplier?.name||'', shipping:0, shippingPer:'order' };
  closeZosakuModal();
  const inCart=cart.find(c=>c.id===pendingItem.id);
  document.getElementById('qty-modal-title').textContent=inCart?'本数を変更':'本数を入力';
  document.getElementById('qty-item-name').textContent=name;
  document.getElementById('qty-item-meta').textContent=
    `${ZOSAKU_CAT}　単価 ${cost?'¥'+fmt(cost):'未定'}/${ZOSAKU_UNIT}　発注先：${pendingItem.supplier}`;
  document.getElementById('qty-unit-label').textContent=ZOSAKU_UNIT;
  document.getElementById('qty-input').value=inCart?inCart.qty:1;
  document.getElementById('qty-quick-btns').innerHTML=[1,2,3,5,10,20].map(n=>`
    <button class="btn sm" onclick="document.getElementById('qty-input').value=${n}" style="min-width:44px;justify-content:center">${n}${ZOSAKU_UNIT}</button>`).join('');
  document.getElementById('qty-modal').classList.add('open');
  setTimeout(()=>document.getElementById('qty-input').focus(),100);
}

// ── 1束あたりの本数 ──
//
// 束の中身は必ず「本」で数える。品目の単位（束・枚など）とは別のもの。
// ・単位が「束」の品目 … 束の数で発注するので「3束（45本）」と本数を添える
// ・単位が「本」の品目 … 本数で発注するので「45本（3束）」と束数を添える。
//   ちょうど割り切れないときは「2束＋3本」のように出す。
const BUNDLE_UNIT = '束';
const BUNDLE_PIECE_UNIT = '本';
function bundleNote(item, qty){
  const per=Number(item?.perBundle)||0;
  const n=Number(qty)||0;
  if(!per || !n) return '';
  if(item.unit===BUNDLE_UNIT) return `（${Math.round(n*per*100)/100}${BUNDLE_PIECE_UNIT}）`;
  const b=Math.floor(n/per), r=Math.round((n-b*per)*100)/100;
  if(!b) return '';
  return `（${b}${BUNDLE_UNIT}${r?`＋${r}${item.unit||BUNDLE_PIECE_UNIT}`:''}）`;
}

// ── メーカー送料 ──
//
// 品目に登録したメーカー送料を、発注のときに足す。
//   1つごとに（unit）… 単価に足し込む
//   1回の発注につき（order）… 「送料」の行としてまとめて1行にする
function cartUnitShipping(c){ return c.shippingPer==='unit' ? (Number(c.shipping)||0) : 0; }
function cartItemCost(c){ return (Number(c.cost)||0) + cartUnitShipping(c); }
// 「1回の発注につき」の送料の合計（品目ごとに1回ずつ）
function cartOrderShipping(){
  return (cart||[]).reduce((s,c)=> s + (c.shippingPer==='unit' ? 0 : (Number(c.shipping)||0)), 0);
}
function cartGrandTotal(){
  return (cart||[]).reduce((s,c)=>s+cartItemCost(c)*c.qty, 0) + cartOrderShipping();
}

// ── カート ──
function renderCart(){
  const card=document.getElementById('cart-card');
  const ci=document.getElementById('cart-items');
  if(!cart.length){card.style.display='none';updateOrderPreviewBtnState();return;}
  card.style.display='block';
  ci.innerHTML=cart.map((c,i)=>`
    <div class="cart-item">
      <div class="cart-name">
        <div style="font-size:13px;font-weight:500">${c.name}</div>
        <div style="font-size:11px;color:var(--text-muted)">¥${fmt(c.cost)}/${c.unit}${
          cartUnitShipping(c) ? `　＋送料 ¥${fmt(cartUnitShipping(c))}/${c.unit}` : ''}${
          (c.shipping && c.shippingPer!=='unit') ? `　＋送料 ¥${fmt(c.shipping)}（1回）` : ''}${
          bundleNote(c, c.qty)}</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="changeQty(${i},-1)">−</button>
        <div class="qty-val">${c.qty}</div>
        <button class="qty-btn" onclick="changeQty(${i},1)">＋</button>
        <span style="font-size:12px;color:var(--text-sub);margin-left:2px">${c.unit}</span>
      </div>
      <div style="font-size:12px;font-weight:600;color:var(--wood-t);min-width:62px;text-align:right">¥${fmt(cartItemCost(c)*c.qty)}</div>
      <button class="btn danger xs" onclick="removeCartItem(${i})" style="margin-left:4px">×</button>
    </div>`).join('');
  // メーカー送料（1回の発注につき）は、まとめて1行として出す
  const ship=cartOrderShipping();
  if(ship){
    ci.innerHTML+=`<div class="cart-item" style="background:var(--surface2)">
      <div class="cart-name"><div style="font-size:13px;font-weight:500">送料（メーカー）</div>
        <div style="font-size:11px;color:var(--text-muted)">発注1回につき</div></div>
      <div style="font-size:12px;font-weight:600;color:var(--wood-t);min-width:62px;text-align:right">¥${fmt(ship)}</div>
    </div>`;
  }
  document.getElementById('cart-total').textContent=fmt(cartGrandTotal());
  updateOrderPreviewBtnState();
}
function changeQty(i,d){
  cart[i].qty=Math.max(1,cart[i].qty+d);
  renderCart();renderItemSelectList();
}
function removeCartItem(i){cart.splice(i,1);renderCart();renderItemSelectList();}
function clearCart(){cart=[];renderCart();renderItemSelectList();}
