/**
 * 逐格分类识别通路。
 *
 * 与检测通路的区别：检测器在整屏里同时干两件事 —— 找棋盘在哪、认每颗子是什么；
 * 逐格分类把这两件事拆开：先用晶格拟合定位（亚像素），再对 90 个格子逐个分类。
 * 每个分类器看到的是正对着的方格裁切，而不是整屏里的一小块，
 * 所以对棋子样式的分辨能力更强。
 *
 * 返回值和检测通路一样是 DetectionBox[]，这样下游的 buildGrid、FEN 构建、
 * 走子检测、方向判断全都不用改 —— 格子中心精确，buildGrid 会把它吸附到自己那一格。
 */
import * as ort from 'onnxruntime-web'
import { LABELS, type DetectionBox } from './types'
import {
  fitBoardGrid,
  fitBoardGridAuto,
  toGray,
  GRID_COLS,
  GRID_ROWS,
  type GridFit,
  type RoughBox,
} from './gridFit'
import { readOnnxMetadata, type OnnxMetadata } from './onnxMeta'

export type ModelKind = 'detector' | 'classifier' | 'unknown'

export interface SessionInspection {
  kind: ModelKind
  /** classifier 时为 [1, H, W, 3] 里的 H；detector 时沿用旧的固定 640 逻辑 */
  inputSize: number
  /** 输出张量的形状，用于界面显示与判定 */
  outputDims: number[]
  inputDims: Array<number | string>
  meta: OnnxMetadata | null
}

/**
 * 判断这个模型是检测器还是逐格分类器。
 *
 * 判据是输出形状 —— 分类器的输出是二维 [N, classes] 且 classes 很小；
 * 检测器输出三维 [1, 4+classes, 8400] 这类，最后一维是候选框数量。
 * 光看输入形状不行：分类器的输入也是四维 NHWC。
 */
export function inspectSession(session: ort.InferenceSession): SessionInspection {
  const inMeta: any = session.inputMetadata?.[0]
  const outMeta: any = session.outputMetadata?.[0]

  const inputDims = (inMeta?.isTensor ? inMeta.shape : []) as Array<number | string>
  const outputDims = ((outMeta?.isTensor ? outMeta.dims || outMeta.shape : []) ||
    []) as number[]

  let inputSize = 0
  if (inputDims.length === 4) {
    const h = Number(inputDims[1])
    const w = Number(inputDims[2])
    if (Number.isFinite(h) && h > 0 && h === w) inputSize = h
  }

  const lastDim = outputDims.length ? outputDims[outputDims.length - 1] : 0
  let kind: ModelKind = 'unknown'
  if (outputDims.length === 2 && lastDim > 1 && lastDim <= 256) {
    kind = 'classifier'
  } else if (outputDims.length === 3) {
    kind = 'detector'
  } else if (outputDims.length === 2 && lastDim > 256) {
    // 有些导出的检测模型是 [N, 8400] 这种转置形式
    kind = 'detector'
  }

  return { kind, inputSize, outputDims, inputDims, meta: null }
}

export interface ClassifierHandle {
  session: ort.InferenceSession
  inspection: SessionInspection
  /** 类别名数组，顺序即输出维度顺序 */
  labels: string[]
  inputSize: number
  cropK: number
  inputName: string
}

/** 从模型字节建立分类器会话；不是分类器就返回 null */
export async function createClassifier(
  bytes: Uint8Array,
  options?: { executionProviders?: readonly string[] }
): Promise<ClassifierHandle | null> {
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: (options?.executionProviders as any) ?? ['wasm'],
    graphOptimizationLevel: 'all',
  })

  const inspection = inspectSession(session)
  if (inspection.kind !== 'classifier') return null

  // 类别名优先取模型自带的元数据；取不到就按输出维度长度兜底
  const meta = readOnnxMetadata(bytes)
  inspection.meta = meta

  const labels =
    meta && meta.labels.length === inspection.outputDims[1]
      ? meta.labels
      : Array.from({ length: inspection.outputDims[1] }, (_, i) => String(i))

  const inputSize = meta?.inputSize || inspection.inputSize || 32
  const cropK = meta?.cropK || 1.14

  return {
    session,
    inspection,
    labels,
    inputSize,
    cropK,
    inputName: session.inputNames[0],
  }
}

/** 类别名 → 应用里的 labelIndex。名字对不上就返回 -1（该格忽略） */
export function labelIndexOf(name: string): number {
  for (const key of Object.keys(LABELS)) {
    if (LABELS[Number(key)].name === name) return Number(key)
  }
  return -1
}

/** 预热：跑一次空输入，避免第一次识别时把编译时间算进去 */
export async function warmupClassifier(h: ClassifierHandle): Promise<void> {
  const t = new ort.Tensor('float32', new Float32Array(h.inputSize * h.inputSize * 3), [
    1,
    h.inputSize,
    h.inputSize,
    3,
  ])
  await h.session.run({ [h.inputName]: t })
}

export interface ClassifyResult {
  boxes: DetectionBox[]
  grid: GridFit
  /** 每个格子的类别名，长度 90，用于诊断显示 */
  cellLabels: string[]
  /** 未映射到应用类别的格数（模型类别表与应用不一致的信号） */
  unmapped: number
}

/** 裁出 90 个格子并拼成一个批次 */
function cropCells(
  img: HTMLImageElement,
  grid: GridFit,
  size: number,
  cropK: number
): Float32Array {
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  const side = Math.max(grid.dx, grid.dy) * cropK
  const half = side / 2

  const out = new Float32Array(GRID_ROWS * GRID_COLS * size * size * 3)
  let p = 0
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const cx = grid.x0 + c * grid.dx
      const cy = grid.y0 + r * grid.dy
      ctx.clearRect(0, 0, size, size)
      ctx.drawImage(
        img,
        cx - half,
        cy - half,
        side,
        side,
        0,
        0,
        size,
        size
      )
      const d = ctx.getImageData(0, 0, size, size).data
      for (let i = 0; i < size * size; i++) {
        out[p++] = d[i * 4] / 255
        out[p++] = d[i * 4 + 1] / 255
        out[p++] = d[i * 4 + 2] / 255
      }
    }
  }
  return out
}

/**
 * 对一张图跑逐格分类。
 *
 * @param rough 有检测器的 Board 框就传进来（最准）；没有就留空，会自己扫一遍。
 */
export async function classifyBoard(
  img: HTMLImageElement,
  h: ClassifierHandle,
  rough?: RoughBox | null
): Promise<ClassifyResult | null> {
  const imgData = toGray(img)
  if (!imgData) return null

  const grid = rough
    ? fitBoardGrid(imgData.gray, imgData.w, imgData.h, rough)
    : null
  const fit = grid ?? fitBoardGridAuto(imgData.gray, imgData.w, imgData.h)
  if (!fit) return null

  const data = cropCells(img, fit, h.inputSize, h.cropK)
  const n = GRID_ROWS * GRID_COLS
  const tensor = new ort.Tensor('float32', data, [n, h.inputSize, h.inputSize, 3])
  const results = await h.session.run({ [h.inputName]: tensor })
  const first = results[h.session.outputNames[0]]
  const logits = first.data as unknown as Float32Array
  const classes = first.dims[first.dims.length - 1]

  const boxes: DetectionBox[] = []
  const cellLabels: string[] = new Array(n).fill('')
  let unmapped = 0

  for (let i = 0; i < n; i++) {
    let best = 0
    let bestV = -Infinity
    for (let c = 0; c < classes; c++) {
      const v = logits[i * classes + c]
      if (v > bestV) {
        bestV = v
        best = c
      }
    }
    const name = h.labels[best] ?? ''
    cellLabels[i] = name

    // 空格子不产出检测框 —— 下游只关心盘面上有东西的格子
    if (name === 'empty' || !name) continue

    const idx = labelIndexOf(name)
    if (idx < 0) {
      unmapped++
      continue
    }

    const r = Math.floor(i / GRID_COLS)
    const c = i % GRID_COLS
    const cx = fit.x0 + c * fit.dx
    const cy = fit.y0 + r * fit.dy
    const w = fit.dx
    const hgt = fit.dy
    boxes.push({
      box: [cx - w / 2, cy - hgt / 2, w, hgt],
      // 分类器给的是 logits，没有天然的「置信度」语义。
      // 这里给一个高于阈值上限的固定值，避免被下游的 minScore 过滤掉；
      // 真正的置信度过滤在读格子结果时由 drawBoundingBoxes 之外的逻辑处理。
      score: Math.min(0.99, Math.max(0.5, 1 / (1 + Math.exp(-bestV)))),
      labelIndex: idx,
    })
  }

  return { boxes, grid: fit, cellLabels, unmapped }
}

/** 从检测结果里取棋盘框，用作晶格拟合的粗略范围 */
export function boardRoughFrom(boxes: DetectionBox[]): RoughBox | null {
  let best: DetectionBox | null = null
  for (const b of boxes) {
    if (LABELS[b.labelIndex]?.name !== 'Board') continue
    if (!best || b.score > best.score) best = b
  }
  if (!best) return null
  const [x, y, w, h] = best.box
  return { x, y, w, h }
}
