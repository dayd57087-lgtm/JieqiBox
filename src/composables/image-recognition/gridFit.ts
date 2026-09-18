/**
 * 从截图里拟合棋盘晶格（9 条竖线 × 10 条横线）。
 *
 * 这是「逐格分类」识别通路的定位环节：分类器需要知道每一格在图上的确切位置，
 * 才能裁出正对着的方格。做法是对灰度投影做一维拟合 ——
 * 沿整行/整列求平均暗度，木纹棋盘上的格子线会从噪声里露出来，
 * 而棋子的深色质量恰好落在交叉点上，是加强信号而不是干扰。
 *
 * 与 boardFen.ts 里的 fitLattice 的区别：那个是从检测框中心反推晶格，
 * 这个是从**像素**直接找线，精度到亚像素，不依赖检测框。
 *
 * 算法在 Model Studio 里做过四场景回归（原图 / 1080×2340 带 UI 栏 /
 * 框选偏小 12% / 框选偏大 20%），最差场景累计偏差 < 0.5% 格。
 */

export const GRID_COLS = 9
export const GRID_ROWS = 10

export interface RoughBox {
  x: number
  y: number
  w: number
  h: number
}

export interface GridFit {
  /** 左上交叉点的像素坐标 */
  x0: number
  y0: number
  /** 相邻竖线 / 横线的间距 */
  dx: number
  dy: number
  /** 拟合位置的暗度相对剖面起伏的倍数，越大越可信，经验值 4~8 */
  confidence: number
  /** 两端之外是否还压着同样强的线。接近 1 说明相位错了一格，越小越好 */
  edgeRatio: number
}

/** 沿 x 方向求列投影：每个 x 上一定 y 范围内的平均暗度 */
function columnProfile(
  gray: Uint8ClampedArray | Uint8Array,
  W: number,
  _H: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): Float64Array {
  const n = x1 - x0 + 1
  const P = new Float64Array(n)
  const top = Math.round(y0 + (y1 - y0) * 0.1)
  const bot = Math.round(y0 + (y1 - y0) * 0.9)
  for (let x = x0; x <= x1; x++) {
    let s = 0
    let c = 0
    for (let y = top; y <= bot; y += 2) {
      s += 255 - gray[y * W + x]
      c++
    }
    P[x - x0] = c ? s / c : 0
  }
  return P
}

/** 沿 y 方向求行投影 */
function rowProfile(
  gray: Uint8ClampedArray | Uint8Array,
  W: number,
  _H: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number
): Float64Array {
  const n = y1 - y0 + 1
  const P = new Float64Array(n)
  const left = Math.round(x0 + (x1 - x0) * 0.1)
  const right = Math.round(x0 + (x1 - x0) * 0.9)
  for (let y = y0; y <= y1; y++) {
    let s = 0
    let c = 0
    for (let x = left; x <= right; x += 2) {
      s += 255 - gray[y * W + x]
      c++
    }
    P[y - y0] = c ? s / c : 0
  }
  return P
}

/**
 * 找出剖面里「有纹理」的那一段。
 *
 * 棋盘内部有等距格子线，投影会明显起伏；棋盘外是均匀背景（通常是深色），
 * 投影几乎是一条平线。返回起伏持续超过阈值的最长区间。
 *
 * 为什么必须做这一步：棋盘外的深色背景「暗度」极高，任何延伸到棋盘外的
 * 候选晶格都会白捡一条最强的「线」。实测这会稳定地把晶格整体推偏整整一格，
 * 而两组线在平均暗度上几乎打平（102.4 vs 105），光靠打分分不出来。
 */
function texturedRange(
  P: Float64Array,
  win: number
): { lo: number; hi: number } {
  const n = P.length
  if (n < 8) return { lo: 0, hi: n - 1 }
  const w = Math.max(2, Math.round(win))
  const st = new Float64Array(n)
  let mx = 0
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w)
    const b = Math.min(n - 1, i + w)
    let s = 0
    for (let j = a; j <= b; j++) s += P[j]
    const m = s / (b - a + 1)
    let v = 0
    for (let j = a; j <= b; j++) {
      const d = P[j] - m
      v += d * d
    }
    st[i] = Math.sqrt(v / (b - a + 1))
    if (st[i] > mx) mx = st[i]
  }
  if (mx <= 1e-6) return { lo: 0, hi: n - 1 }

  const thr = mx * 0.3
  let lo = 0
  while (lo < n && st[lo] < thr) lo++
  let hi = n - 1
  while (hi > lo && st[hi] < thr) hi--
  // 裁得太狠就不要裁了，宁可退回原范围
  if (hi - lo < n * 0.2) return { lo: 0, hi: n - 1 }
  return { lo, hi }
}

/** 去掉低频趋势（木纹明暗、光照渐变），只留细线的高频成分 */
function detrend(P: Float64Array, win: number): Float64Array {
  const n = P.length
  const half = Math.max(1, Math.round(win / 2))
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n - 1, i + half)
    let s = 0
    for (let j = a; j <= b; j++) s += P[j]
    out[i] = P[i] - s / (b - a + 1)
  }
  return out
}

function sampleLinear(P: Float64Array, pos: number): number {
  if (pos <= 0 || pos >= P.length - 1) return 0
  const i = Math.floor(pos)
  const t = pos - i
  return P[i] * (1 - t) + P[i + 1] * t
}

/** (起点, 间距) 的评分：所有线位置上的平均暗度 */
function score(P: Float64Array, start: number, spacing: number, count: number): number {
  let s = 0
  for (let k = 0; k < count; k++) s += sampleLinear(P, start + k * spacing)
  return s / count
}

/** 置信度：拟合位置的暗度 / 剖面自身的高频起伏强度。
 *  不能拿剖面均值做分母 —— 去趋势后均值恒为 0，除出来是垃圾值。 */
function confidenceOf(P: Float64Array, fitScore: number): number {
  const n = P.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += P[i]
  mean /= n
  let v = 0
  for (let i = 0; i < n; i++) {
    const d = P[i] - mean
    v += d * d
  }
  const std = Math.sqrt(v / n)
  return std > 1e-6 ? fitScore / std : 0
}

/**
 * 拟合单根轴。
 *
 * 关键约束：整段跨度必须接近给定的 roughSpan。
 * 否则会出现退化解 —— 线挤进一小块深色区域时平均暗度反而更高，
 * 于是拟出一组毫无意义的密集线（实测框选偏小 12% 就会塌缩成 0.67 倍间距）。
 */
function fitAxis(
  P: Float64Array,
  count: number,
  roughSpan: number
): { start: number; spacing: number; confidence: number; edgeRatio: number } {
  const n = P.length
  const spanLo = roughSpan * 0.7
  const spanHi = roughSpan * 1.3
  let best = { start: 0.5, spacing: spanLo / (count - 1), score: -Infinity }

  const spanSteps = 160
  for (let si = 0; si <= spanSteps; si++) {
    const span = spanLo + ((spanHi - spanLo) * si) / spanSteps
    const sp = span / (count - 1)
    const maxStart = n - 1.5 - span
    if (maxStart < 0.5) continue
    for (let st = 0.5; st <= maxStart; st += 1) {
      const sc = score(P, st, sp, count)
      if (sc > best.score) best = { start: st, spacing: sp, score: sc }
    }
  }
  if (!isFinite(best.score)) {
    return { start: 0, spacing: roughSpan / (count - 1), confidence: 0, edgeRatio: 1 }
  }

  // 局部精修：逐次缩小步长，用插值让目标函数连续，最终到亚像素
  let step = Math.max(0.5, best.spacing / 24)
  for (let round = 0; round < 6; round++) {
    let improved = true
    while (improved) {
      improved = false
      const cands: Array<[number, number]> = [
        [best.start + step, best.spacing],
        [best.start - step, best.spacing],
        [best.start, best.spacing + step],
        [best.start, best.spacing - step],
      ]
      for (const [cs, cp] of cands) {
        const cspan = cp * (count - 1)
        if (cspan < spanLo * 0.9 || cspan > spanHi * 1.1) continue
        if (cs < 0.2 || cs + cspan > n - 1.2) continue
        const v = score(P, cs, cp, count)
        if (v > best.score + 1e-9) {
          best = { start: cs, spacing: cp, score: v }
          improved = true
        }
      }
    }
    step /= 4
  }

  // 边缘判据：真实晶格的两端之外是棋盘外的木边，不该再有格子线。
  // 若往外一格的位置上仍然有同样强的线，说明这组线只是棋盘内部的一段 ——
  // 相位错了一格。棋盘横线等距，错相位与正确相位在「平均线暗度」上几乎一样，
  // 只有靠这个判据才能分开（实测兜底自标定时 3 次里有 2 次栽在这里）。
  const end = best.start + best.spacing * (count - 1)
  const outside = Math.max(
    sampleLinear(P, best.start - best.spacing),
    sampleLinear(P, end + best.spacing)
  )
  const edgeRatio = best.score > 1e-6 ? Math.max(0, outside) / best.score : 1

  return {
    start: best.start,
    spacing: best.spacing,
    confidence: confidenceOf(P, best.score),
    edgeRatio,
  }
}

/**
 * 在给定粗略范围内拟合晶格。
 *
 * 采样区会向外扩 25%：用户框得偏小时真实晶格会落在框外，
 * 只在框内采样的话边缘那几条线会被当成「框外无信号」而拖垮拟合。
 */
export function fitBoardGrid(
  gray: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number,
  rough: RoughBox
): GridFit | null {
  if (rough.w < 60 || rough.h < 60) return null

  const padX = rough.w * 0.25
  const padY = rough.h * 0.25
  const rx0 = Math.max(0, Math.floor(rough.x - padX))
  const ry0 = Math.max(0, Math.floor(rough.y - padY))
  const rx1 = Math.min(W - 1, Math.ceil(rough.x + rough.w + padX))
  const ry1 = Math.min(H - 1, Math.ceil(rough.y + rough.h + padY))
  if (rx1 - rx0 < 60 || ry1 - ry0 < 60) return null

  // 先按「有纹理」把范围收紧到棋盘本身，把外面的均匀背景排除掉
  const trimC = texturedRange(
    columnProfile(gray, W, H, rx0, rx1, ry0, ry1),
    (rx1 - rx0) / 34
  )
  const trimR = texturedRange(
    rowProfile(gray, W, H, rx0, rx1, ry0, ry1),
    (ry1 - ry0) / 38
  )
  const cc0 = rx0 + trimC.lo
  const cc1 = rx0 + trimC.hi
  const rr0 = ry0 + trimR.lo
  const rr1 = ry0 + trimR.hi
  if (cc1 - cc0 < 60 || rr1 - rr0 < 60) {
    return null
  }

  const Pc = detrend(columnProfile(gray, W, H, cc0, cc1, rr0, rr1), (cc1 - cc0) / 17)
  const Pr = detrend(rowProfile(gray, W, H, cc0, cc1, rr0, rr1), (rr1 - rr0) / 19)

  // 跨度约束仍然用用户框选的尺寸 —— 它是独立于裁剪的可靠信息
  const cx = fitAxis(Pc, GRID_COLS, rough.w)
  const cy = fitAxis(Pr, GRID_ROWS, rough.h)

  const x0 = cc0 + cx.start
  const y0 = rr0 + cy.start
  const xEnd = x0 + cx.spacing * (GRID_COLS - 1)
  const yEnd = y0 + cy.spacing * (GRID_ROWS - 1)
  if (x0 < -5 || y0 < -5 || xEnd > W + 5 || yEnd > H + 5) return null

  return {
    x0,
    y0,
    dx: cx.spacing,
    dy: cy.spacing,
    confidence: Math.min(cx.confidence, cy.confidence),
    // 两轴取更差的那个：任一轴相位错一格，整块棋盘都会错位
    edgeRatio: Math.max(cx.edgeRatio, cy.edgeRatio),
  }
}

/**
 * 没有棋盘框时的兜底：扫几档「棋盘占画面多大」，取置信度最高的。
 *
 * 逐格分类需要先知道棋盘在哪。有检测器时用检测器的 Board 框最准；
 * 没有时只能这样找一遍 —— 精度不如检测器，但足以让流程跑起来。
 */
export function fitBoardGridAuto(
  gray: Uint8ClampedArray | Uint8Array,
  W: number,
  H: number
): GridFit | null {
  const fractions = [0.98, 0.88, 0.78, 0.66, 0.54]
  const offsets = [
    [0.5, 0.5],
    [0.5, 0.42],
    [0.5, 0.34],
    [0.5, 0.26],
  ]

  let best: GridFit | null = null
  for (const f of fractions) {
    for (const [ox, oy] of offsets) {
      const w = W * f
      // 棋盘是 9:10，高度按宽度的比例推，避免用满屏高度把 UI 栏也圈进来
      const h = Math.min(H, w * (10 / 9))
      const x = Math.max(0, W * ox - w / 2)
      const y = Math.max(0, H * oy - h / 2)
      const fit = fitBoardGrid(gray, W, H, {
        x,
        y,
        w: Math.min(w, W - x),
        h: Math.min(h, H - y),
      })
      // 相位错的候选线数一样多、置信度接近，必须靠 edgeRatio 压下去
      if (fit && fit.edgeRatio < 0.6) {
        if (!best || fit.confidence > best.confidence) best = fit
      }
    }
  }
  return best
}

/** 把画面转成灰度 */
export function toGray(
  img: HTMLImageElement | HTMLCanvasElement
): { gray: Uint8ClampedArray; w: number; h: number } | null {
  const w = (img as HTMLImageElement).naturalWidth || (img as HTMLCanvasElement).width
  const h = (img as HTMLImageElement).naturalHeight || (img as HTMLCanvasElement).height
  if (!w || !h) return null

  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const gray = new Uint8ClampedArray(w * h)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114
  }
  return { gray, w, h }
}
