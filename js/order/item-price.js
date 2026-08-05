// ════ 単価の切り替わり（いつからの単価か） ════
//
// 発注先が単価を変えるとき「いつから」を選べる。
//   ・適用日が今日以前 … すぐ新しい単価になる
//   ・適用日が先の日付 … その日が来るまでは今までの単価のまま
// 発注書は「発注日の時点で有効な単価」で作るので、値上げ前の発注は以前の単価のままになる。

function ipToday(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
const ipLabel = s => s ? String(s).replace(/-/g,'/') : '';

// その日に有効な単価。変更履歴が無ければ品目マスタの単価をそのまま使う
function itemCostAsOf(item, dateStr){
  if(!item) return 0;
  const date = dateStr || ipToday();
  const hits=(itemPriceChanges||[])
    .filter(c=>c.itemId===item.id && c.effectiveFrom<=date)
    .sort((a,b)=> a.effectiveFrom<b.effectiveFrom ? -1 : a.effectiveFrom>b.effectiveFrom ? 1 : a.id-b.id);
  return hits.length ? hits[hits.length-1].cost : Number(item.cost)||0;
}
// いまの単価（発注や一覧の表示に使う）
function itemCurrentCost(item){ return itemCostAsOf(item, ipToday()); }

// これから切り替わる予定（先の日付の変更のうち、いちばん近いもの）
function itemNextPriceChange(item){
  const today=ipToday();
  return (itemPriceChanges||[])
    .filter(c=>c.itemId===item?.id && c.effectiveFrom>today)
    .sort((a,b)=> a.effectiveFrom<b.effectiveFrom ? -1 : 1)[0] || null;
}

// ── 発注先が単価を変えたときのお知らせ ──
async function notifyPriceChange(item, newCost, effectiveFrom, prevCost){
  const today=ipToday();
  const when = effectiveFrom<=today ? '本日から' : `${ipLabel(effectiveFrom)}から`;
  const text =
    `【単価変更のお知らせ】\n`+
    `・${item.cat}　${item.name}（${item.unit}）\n`+
    `¥${fmt(prevCost)} → ¥${fmt(newCost)}（${when}）\n`+
    `${effectiveFrom>today ? `${ipLabel(effectiveFrom)}より前の発注は、これまでの単価で作成されます。` : ''}`;
  try{
    // 自社スレッドに残す（社内へ通知が飛ぶ）
    await dbAddChatMessage(item.supplier, {role:'them', type:'text', text});
  }catch(_){
    // チャットに残せなくても単価の変更自体は成立させる
  }
}
