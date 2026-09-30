// ════ レシート写真を「スキャンしたような見た目」に整える ════
//
// 写真で撮ったレシートは、斜めから写って台形にゆがみ、影が入り、机や指が写り込む。
// そのままでは台帳に並べても読みにくいので、次の順で整える。
//
//   ① レシートの四隅を見つける（明るい紙が暗い机の上にある、という前提で探す）
//   ② その四隅を長方形に引き伸ばす（台形のゆがみを直す）
//   ③ 文字の行がまっすぐになるよう、残った傾きを直す
//   ④ 影を消して白黒にする（周りの明るさに合わせて白黒を決めるので、影があっても文字が残る）
//
// できないこと：レシートの上に重なった指を消すこと（消した跡を作り出すことになるため）。
// 四隅は手で動かせるので、指が写った縁は切り落としてください。
//
// 外部の部品は使わず、canvas だけで行う（追加の読み込みなし・端末の中だけで処理）。

// 画素を何度も読む canvas を作る。
// willReadFrequently は「はじめて getContext したとき」に渡さないと効かないので、
// canvas を作る側でまとめて面倒を見る（Codexの指摘）
function rsCanvas(w, h){
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d', { willReadFrequently:true });
  return cv;
}
function rsCtx(cv){ return cv.getContext('2d', { willReadFrequently:true }); }

// ── 画像ファイルを canvas に読み込む（向きの情報は createImageBitmap が直してくれる） ──
async function rsLoadImage(file){
  let bmp = null;
  try{ bmp = await createImageBitmap(file, { imageOrientation:'from-image' }); }
  catch(_){
    bmp = await new Promise((res, rej)=>{
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = ()=>{ URL.revokeObjectURL(url); res(img); };
      img.onerror = ()=>{ URL.revokeObjectURL(url); rej(new Error('画像を開けませんでした')); };
      img.src = url;
    });
  }
  // 大きすぎる写真は先に縮める（処理を速くするため。文字が読める大きさは保つ）
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = rsCanvas(Math.round(bmp.width*scale), Math.round(bmp.height*scale));
  rsCtx(cv).drawImage(bmp, 0, 0, cv.width, cv.height);
  try{ bmp.close && bmp.close(); }catch(_){}
  return cv;
}

// ── ① レシートの四隅を見つける ──
//
// 小さく縮めた白黒版で「明るいところ」を拾い、その広がりの角を四隅とする。
// x+y がいちばん小さい点＝左上、いちばん大きい点＝右下、x−y で右上・左下が出る。
function rsFindQuad(cv){
  const W = 480;   // 粗すぎると縁を拾えない（Codexの指摘）
  const s = W / cv.width;
  const h = Math.max(1, Math.round(cv.height * s));
  const small = rsCanvas(W, h);
  rsCtx(small).drawImage(cv, 0, 0, W, h);
  const d = rsCtx(small).getImageData(0,0,W,h).data;

  // 明るさのヒストグラムから境目を決める（大津の方法）
  const hist = new Array(256).fill(0);
  const lum = new Float32Array(W*h);
  for(let i=0, p=0; i<d.length; i+=4, p++){
    const v = (d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114);
    lum[p] = v; hist[Math.min(255, Math.max(0, Math.round(v)))]++;
  }
  const total = W*h;
  let sum = 0; for(let i=0;i<256;i++) sum += i*hist[i];
  let sumB=0, wB=0, best=0, thr=128;
  for(let i=0;i<256;i++){
    wB += hist[i]; if(!wB) continue;
    const wF = total - wB; if(!wF) break;
    sumB += i*hist[i];
    const mB = sumB/wB, mF = (sum-sumB)/wF;
    const between = wB*wF*(mB-mF)*(mB-mF);
    if(between > best){ best = between; thr = i; }
  }
  // 紙は明るい側。ただし全体が明るい写真では境目が高すぎるので下限を置く
  thr = Math.max(thr, 90);

  let tl=null, tr=null, bl=null, br=null, count=0;
  let minSum=1e9, maxSum=-1e9, minDif=1e9, maxDif=-1e9;
  for(let y=0; y<h; y++){
    for(let x=0; x<W; x++){
      if(lum[y*W+x] < thr) continue;
      count++;
      const s1 = x+y, s2 = x-y;
      if(s1 < minSum){ minSum = s1; tl = [x,y]; }
      if(s1 > maxSum){ maxSum = s1; br = [x,y]; }
      if(s2 > maxDif){ maxDif = s2; tr = [x,y]; }
      if(s2 < minDif){ minDif = s2; bl = [x,y]; }
    }
  }
  // 明るいところが少なすぎる／多すぎる（紙が画面いっぱい）ときは、画像全体を使う
  const ratio = count / total;
  if(!tl || ratio < 0.05 || ratio > 0.95){
    return { quad: [[0,0],[cv.width,0],[cv.width,cv.height],[0,cv.height]], auto:false };
  }
  const back = p => [p[0]/s, p[1]/s];
  return { quad: [back(tl), back(tr), back(br), back(bl)], auto:true };
}

// ── ② 四隅を長方形に引き伸ばす（台形のゆがみを直す） ──
//
// 出したい長方形の4点から、元の写真の4点へ戻す式（射影変換）を解いて、
// 出したい側の1画素ずつ、元のどこを見ればよいかを計算して色を取る。
function rsSolveHomography(dst, src){
  // dst(4点) → src(4点) の 3x3 行列を、8元の連立方程式として解く
  const A = [], b = [];
  for(let i=0;i<4;i++){
    const [x,y] = dst[i], [u,v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -x*u, -y*u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x*v, -y*v]); b.push(v);
  }
  // ガウスの消去法
  for(let c=0;c<8;c++){
    let piv = c;
    for(let r=c+1;r<8;r++) if(Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if(Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    for(let r=0;r<8;r++){
      if(r===c) continue;
      const f = A[r][c] / A[c][c];
      if(!f) continue;
      for(let k=c;k<8;k++) A[r][k] -= f*A[c][k];
      b[r] -= f*b[c];
    }
  }
  const m = b.map((v,i)=>v / A[i][i]);
  return [m[0],m[1],m[2], m[3],m[4],m[5], m[6],m[7], 1];
}

const rsDist = (a,b) => Math.hypot(a[0]-b[0], a[1]-b[1]);

function rsWarp(cv, quad){
  const [tl,tr,br,bl] = quad;
  // 出す大きさは、向かい合う辺の長いほうに合わせる（つぶれないように）。
  //
  // 縦と横を別々に上限で切ると、そこで縦横比が変わってしまう（Codexの指摘）。
  // 細長いレシートだと横に伸びて文字が読みにくくなるので、同じ倍率で縮める。
  let outW = Math.max(1, Math.round(Math.max(rsDist(tl,tr), rsDist(bl,br))));
  let outH = Math.max(1, Math.round(Math.max(rsDist(tl,bl), rsDist(tr,br))));
  // 上限は画素数でも抑える（古いスマホで場所を取りすぎないように）
  const k = Math.min(1, 1000/outW, 2000/outH, Math.sqrt(2.0e6/(outW*outH)));
  outW = Math.max(60, Math.round(outW*k));
  outH = Math.max(60, Math.round(outH*k));

  const H = rsSolveHomography([[0,0],[outW,0],[outW,outH],[0,outH]], quad);
  if(!H) return cv;

  const sctx = rsCtx(cv);
  const src = sctx.getImageData(0,0,cv.width,cv.height);
  const out = rsCanvas(outW, outH);
  const octx = rsCtx(out);
  const dst = octx.createImageData(outW, outH);
  const sw = cv.width, sh = cv.height;

  for(let y=0; y<outH; y++){
    for(let x=0; x<outW; x++){
      const w = H[6]*x + H[7]*y + H[8];
      const u = (H[0]*x + H[1]*y + H[2]) / w;
      const v = (H[3]*x + H[4]*y + H[5]) / w;
      const o = (y*outW + x) * 4;
      if(u < 0 || v < 0 || u >= sw-1 || v >= sh-1){ dst.data[o]=dst.data[o+1]=dst.data[o+2]=255; dst.data[o+3]=255; continue; }
      // 近い4点の色をまぜる（がたつきを抑える）
      const x0 = u|0, y0 = v|0, fx = u-x0, fy = v-y0;
      for(let c=0;c<3;c++){
        const i00 = ((y0)*sw + x0)*4 + c,   i10 = ((y0)*sw + x0+1)*4 + c;
        const i01 = ((y0+1)*sw + x0)*4 + c, i11 = ((y0+1)*sw + x0+1)*4 + c;
        dst.data[o+c] = (src.data[i00]*(1-fx) + src.data[i10]*fx)*(1-fy)
                      + (src.data[i01]*(1-fx) + src.data[i11]*fx)*fy;
      }
      dst.data[o+3] = 255;
    }
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

// ── ③ 残った傾きを直す（文字の行がまっすぐ並ぶ角度を探す） ──
//
// 少し回してみて、横方向に足した暗さの「山と谷」がいちばんはっきりする角度を選ぶ。
// 文字の行と行間がくっきり分かれる角度＝文字がまっすぐ並んでいる角度。
function rsDeskew(cv){
  const W = Math.min(700, cv.width);   // 細かい文字も見えるくらいの幅で測る
  const s = W / cv.width, h = Math.max(1, Math.round(cv.height*s));
  const small = rsCanvas(W, h);
  rsCtx(small).drawImage(cv, 0, 0, W, h);
  const base = rsCtx(small).getImageData(0,0,W,h).data;
  const gray = new Float32Array(W*h);
  for(let i=0,p=0;i<base.length;i+=4,p++) gray[p] = 255 - (base[i]*0.299 + base[i+1]*0.587 + base[i+2]*0.114);

  const score = deg => {
    const t = deg * Math.PI/180, sin = Math.sin(t), cos = Math.cos(t);
    const rows = new Float32Array(h);
    const cx = W/2, cy = h/2;
    for(let y=0;y<h;y++){
      for(let x=0;x<W;x++){
        const dx = x-cx, dy = y-cy;
        const ry = Math.round(cy + (-dx*sin + dy*cos));
        if(ry < 0 || ry >= h) continue;
        rows[ry] += gray[y*W+x];
      }
    }
    let mean = 0; for(let i=0;i<h;i++) mean += rows[i]; mean /= h;
    let varsum = 0; for(let i=0;i<h;i++){ const d = rows[i]-mean; varsum += d*d; }
    return varsum;
  };

  // 0°を基準にして、はっきり良くなる角度だけ採用する。
  // まっさらな画像だとどの角度も同じ点になり、最初に見た角度（−5°）が
  // 選ばれてしまうため（Codexの指摘）、0°から外へ広げて探し、
  // 0°より5%以上よくならなければ回さない
  const straightScore = score(0);
  let bestDeg = 0, bestScore = straightScore;
  for(let d = 0.5; d <= 5.0001; d += 0.5){
    for(const deg of [d, -d]){
      const v = score(deg);
      if(v > bestScore * 1.0001){ bestScore = v; bestDeg = deg; }
    }
  }
  if(bestScore < straightScore * 1.05) return cv;   // はっきり良くならないなら触らない
  if(Math.abs(bestDeg) < 0.4) return cv;      // ほぼまっすぐなら触らない

  // 回すと角が外に出るので、その分だけ大きい紙を用意する（文字が切れないように）
  const t = -bestDeg * Math.PI/180;
  const c = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t));
  const ow = Math.ceil(cv.width*c + cv.height*sn);
  const oh = Math.ceil(cv.width*sn + cv.height*c);
  const out = rsCanvas(ow, oh);
  const ctx = rsCtx(out);
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,ow,oh);
  ctx.translate(ow/2, oh/2);
  ctx.rotate(t);
  ctx.drawImage(cv, -cv.width/2, -cv.height/2);
  return out;
}

// ── ④ 影を消して白黒にする ──
//
// 画面全体で1つのしきい値を決めると、影の部分が真っ黒につぶれる。
// そこで、その画素の「まわりの明るさ」と比べて白黒を決める。
//
// まわりの平均だけで決めると、感熱紙のざらつき・折り目・写真のノイズまで
// 文字として黒く出てしまう（何もない所が砂を撒いたようになる）。
// そこで、まわりの「ばらつき（標準偏差）」も見て、
//   ・ばらつきが小さい＝何も書かれていない → 白にする
//   ・ばらつきがある＝文字がある → 平均より暗ければ黒
// という判断にする（Sauvola法と同じ考え方）。
// 平均とばらつきは、積分画像と二乗の積分画像で一気に出す。
function rsBinarize(cv){
  const w = cv.width, h = cv.height;
  const ctx = rsCtx(cv);
  const img = ctx.getImageData(0,0,w,h);
  const g = new Float32Array(w*h);
  for(let i=0,p=0;i<img.data.length;i+=4,p++){
    g[p] = img.data[i]*0.299 + img.data[i+1]*0.587 + img.data[i+2]*0.114;
  }
  // 積分画像（和と、二乗の和）
  const W1 = w+1;
  const I = new Float64Array(W1*(h+1));
  const I2 = new Float64Array(W1*(h+1));
  for(let y=0;y<h;y++){
    let rowSum = 0, rowSum2 = 0;
    for(let x=0;x<w;x++){
      const v = g[y*w+x];
      rowSum += v; rowSum2 += v*v;
      I[(y+1)*W1 + (x+1)]  = I[y*W1 + (x+1)]  + rowSum;
      I2[(y+1)*W1 + (x+1)] = I2[y*W1 + (x+1)] + rowSum2;
    }
  }
  const r = Math.max(8, Math.round(Math.min(w,h) / 24));   // まわりを見る範囲
  const out = rsCanvas(w, h);
  const o = rsCtx(out);
  const dst = o.createImageData(w,h);
  for(let y=0;y<h;y++){
    const y0 = Math.max(0, y-r), y1 = Math.min(h-1, y+r);
    for(let x=0;x<w;x++){
      const x0 = Math.max(0, x-r), x1 = Math.min(w-1, x+r);
      const area = (x1-x0+1)*(y1-y0+1);
      const A = (y1+1)*W1+(x1+1), B = y0*W1+(x1+1), C = (y1+1)*W1+x0, D = y0*W1+x0;
      const sum  = I[A]  - I[B]  - I[C]  + I[D];
      const sum2 = I2[A] - I2[B] - I2[C] + I2[D];
      const mean = sum / area;
      const sd = Math.sqrt(Math.max(0, sum2/area - mean*mean));
      // 何も書かれていない所（ばらつきが小さい）は、迷わず白にする
      let v;
      if(sd < 12) v = 255;
      else v = (g[y*w+x] < mean - Math.max(6, sd*0.45)) ? 0 : 255;
      const p = (y*w+x)*4;
      dst.data[p] = dst.data[p+1] = dst.data[p+2] = v;
      dst.data[p+3] = 255;
    }
  }
  o.putImageData(dst, 0, 0);
  return out;
}

// ── まとめ：写真 → 整えた画像 ──
//
// 四隅は返すので、自動で見つけた位置が気に入らなければ手で動かせる。
async function rsScan(file){
  const cv = await rsLoadImage(file);
  const found = rsFindQuad(cv);
  return { source: cv, quad: found.quad, auto: found.auto };
}
// 四隅が決まったあとの仕上げ
function rsFinish(sourceCanvas, quad, opts){
  let out = rsWarp(sourceCanvas, quad);
  out = rsDeskew(out);
  if(!opts || opts.mono !== false) out = rsBinarize(out);
  return out;
}
// 保存・送信用に JPEG（白黒なので軽い）にする
function rsToJpeg(cv, quality){
  return cv.toDataURL('image/jpeg', quality || 0.85).split(',')[1];
}
