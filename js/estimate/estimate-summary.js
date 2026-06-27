// ════ 見積：金額確認（諸経費・消費税計算） ════

function recalcSum(){
  const wTotal=sections.reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
  const wCost=sections.reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.cost,0),0);
  const discount=parseFloat(document.getElementById('discount-amount').value)||0;
  const sub2=Math.max(0,wTotal-discount);
  const taxRate=parseFloat(document.getElementById('tax-rate').value)||0;
  const tax=Math.round(sub2*taxRate/100);
  const total=sub2+tax;
  const profit=wTotal-wCost;
  const margin=wTotal>0?(profit/wTotal*100):0;
  document.getElementById('s-cost').textContent='¥'+fmt(wCost);
  document.getElementById('s-profit').textContent='¥'+fmt(profit);
  document.getElementById('s-margin').textContent=margin.toFixed(1)+'%';
  document.getElementById('s-wtotal').textContent='¥'+fmt(wTotal);
  document.getElementById('s-discount').textContent='¥'+fmt(discount);
  document.getElementById('s-sub2').textContent='¥'+fmt(sub2);
  document.getElementById('s-tax').textContent='¥'+fmt(tax);
  document.getElementById('s-total').textContent='¥'+fmt(total);
  return {wTotal,wCost,profit,margin,discount,sub2,tax,total,taxRate};
}

function renderSumBreakdown(){
  const el=document.getElementById('sum-breakdown');
  if(!sections.length){el.innerHTML='<div style="color:var(--text-muted);font-size:13px;padding:6px 0">明細を入力してください</div>';return;}
  const wTotal=sections.reduce((t,s)=>t+s.items.reduce((s2,i)=>s2+i.qty*i.price,0),0);
  el.innerHTML=sections.map(sec=>{
    const t=sec.items.reduce((s,i)=>s+i.qty*i.price,0);
    return `<div class="sum-row"><label>${sec.name||'（無題）'}</label><span>¥${fmt(t)}</span></div>`;
  }).join('')+`<div class="sum-row" style="font-weight:700"><label>工事費 小計</label><span>¥${fmt(wTotal)}</span></div>`;
}
