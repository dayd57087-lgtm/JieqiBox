import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import * as ort from 'onnxruntime-web'
// Import types from the new file
import { LABELS, type DetectionBox, type ProcessedImage } from './types'
import {
  createClassifier,
  classifyBoard,
  boardRoughFrom,
  labelIndexOf,
  inspectSession,
  type ClassifierHandle,
  type ModelKind,
} from './cellClassifier'
import { GRID_COLS, GRID_ROWS, type RoughBox } from './gridFit'

/**
 * The ONNX session is expensive to build (tens of megabytes of weights), so it
 * is shared between every consumer of this composable instead of being created
 * once per component.
 */
let sharedSession: ort.InferenceSession | null = null
let sharedSessionPromise: Promise<ort.InferenceSession> | null = null

/** 导入的模型是逐格分类器时，走分类通路的句柄。 */
let sharedClassifier: ClassifierHandle | null = null

/** 用于给分类通路提供棋盘框的检测器。与 sharedSession 可能不是同一个会话：
 *  用户导入分类器时，棋盘定位仍然靠内置检测器。 */
let detectorSession: ort.InferenceSession | null = null
let detectorPromise: Promise<ort.InferenceSession | null> | null = null

/** 当前实际生效的模型来源，测试版界面会显示它。 */
export const modelSource = ref<'builtin' | 'imported'>('builtin')
export const importedModelName = ref('')

interface ModelImportBridge {
  isSupported(): boolean
  hasModel(): boolean
  modelName(): string
  modelSize(): number
  pickModel(): void
  readModel(): string
  clearModel(): boolean
}

/**
 * 丢掉缓存的推理会话，下次识别时重建。
 * 导入或清除模型之后必须调用，否则仍会沿用旧模型。
 */
export function resetSharedSession(): void {
  try {
    sharedSession?.release?.()
  } catch {
    /* 释放失败不影响后续重建 */
  }
  sharedSession = null
  sharedSessionPromise = null
}

/** 测试版的模型导入桥；正式版里不存在，或者 isSupported() 为 false。 */
export function modelImportBridge(): ModelImportBridge | null {
  const bridge = (window as any).ModelImport as ModelImportBridge | undefined
  if (!bridge || typeof bridge.isSupported !== 'function') return null
  return bridge.isSupported() ? bridge : null
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * 建推理会话：测试版导入过模型就优先用它，否则用打包进应用的。
 *
 * 导入的模型放在应用私有目录，WebView 自己读不到，所以由原生侧以 base64
 * 传过来再还原成字节。模型通常 10 MB 上下，这一步多花几百毫秒，只在启动时做一次。
 */
async function createSession(base: string): Promise<ort.InferenceSession> {
  const options = {
    executionProviders: ['wasm'] as const,
    graphOptimizationLevel: 'all' as const,
  }

  const bridge = modelImportBridge()
  if (bridge && bridge.hasModel()) {
    try {
      const b64 = bridge.readModel()
      if (b64) {
        const name = bridge.modelName() || '导入的模型'
        const bytes = base64ToBytes(b64)

        // 先当逐格分类器试。分类器的输出是 [N, classes] 且 classes 很小，
        // 检测器是 [1, 4+classes, 候选框数]，靠输出形状就能分开。
        try {
          const clf = await createClassifier(bytes, { executionProviders: ['wasm'] })
          if (clf) {
            sharedClassifier = clf
            console.log(
              `[image-recognition] 导入的是逐格分类器：${clf.labels.length} 类 · ` +
                `输入 ${clf.inputSize}×${clf.inputSize} · 裁切 ×${clf.cropK}`
            )
            // 分类器只回答「这格是什么子」，不负责找棋盘 —— 仍然用内置检测器定位
            void ensureDetector(base, options)
            modelSource.value = 'imported'
            importedModelName.value = name
            return clf.session
          }
        } catch (e) {
          console.warn('[image-recognition] 按分类器加载失败，改按检测器试', e)
        }

        const created = await ort.InferenceSession.create(bytes, options)
        const insp = inspectSession(created)
        console.log(`[image-recognition] 导入的模型按检测器使用 · 输出 ${JSON.stringify(insp.outputDims)}`)
        sharedClassifier = null
        modelSource.value = 'imported'
        importedModelName.value = name
        return created
      }
    } catch (e) {
      console.warn('[image-recognition] 导入的模型加载失败，回退到内置模型', e)
    }
  }

  sharedClassifier = null
  modelSource.value = 'builtin'
  importedModelName.value = ''
  return ort.InferenceSession.create(base + 'models/best.onnx', options)
}

/**
 * 确保内置检测器可用，供分类通路定位棋盘。
 * 加载失败不影响分类本身 —— 会退回自己扫一遍晶格。
 */
function ensureDetector(
  base: string,
  options: { executionProviders: readonly string[]; graphOptimizationLevel: 'all' }
): Promise<ort.InferenceSession | null> {
  if (detectorSession) return Promise.resolve(detectorSession)
  if (!detectorPromise) {
    detectorPromise = ort.InferenceSession
      .create(base + 'models/best.onnx', options as any)
      .then(s => {
        detectorSession = s
        console.log('[image-recognition] 定位用检测器已就绪')
        return s
      })
      .catch(e => {
        console.warn('[image-recognition] 定位用检测器不可用，分类通路将自行标定', e)
        detectorPromise = null
        return null
      })
  }
  return detectorPromise
}

export const useImageRecognition = () => {
  const { t } = useI18n()
  const session = ref<ort.InferenceSession | null>(null)
  const isModelLoading = ref(false)
  const isProcessing = ref(false)
  const status = ref('')
  const detectedBoxes = ref<DetectionBox[]>([])
  const inputImage = ref<HTMLImageElement | null>(null)
  const outputCanvas = ref<HTMLCanvasElement | null>(null)
  const showBoundingBoxes = ref(true)

  /** 当前识别方式：导入分类器后自动切换到 classifier */
  const recognitionMode = ref<ModelKind>('detector')
  /** 分类器的类别名，界面用来显示模型是否与应用对得上 */
  const classifierLabels = ref<string[]>([])
  /** 最近一次晶格拟合的置信度 */
  const lastGridConfidence = ref(0)
  /** 最近一次逐格分类的结果（90 个格子的类别名），用于诊断显示 */
  const lastCellLabels = ref<string[]>([])
  /** 模型给出的类别名在应用里找不到对应的格数 */
  const classifierUnmapped = ref(0)
  /** 连续多少帧没能从检测器拿到棋盘框（说明定位在退化） */
  const detectorBoardMisses = ref(0)

  function refreshRecognitionMode() {
    recognitionMode.value = sharedClassifier ? 'classifier' : 'detector'
    classifierLabels.value = sharedClassifier ? sharedClassifier.labels.slice() : []
  }

  /**
   * Effective model input size and whether the loaded model accepts dynamic
   * shapes. A fixed-shape graph (the exported upstream model) forces 640; a
   * model exported with dynamic axes can run much smaller, which is the single
   * biggest speed lever for the line-connect loop.
   */
  const modelInput = ref({ size: 640, dynamic: false, nativeSize: 640 })

  // Initialize model
  const initializeModel = async (): Promise<void> => {
    if (session.value) return

    if (sharedSession) {
      session.value = sharedSession
      return
    }

    try {
      isModelLoading.value = true
      status.value = t('positionEditor.imageRecognitionStatus.loadingModel')
      // Set the "directory path" for WASM/JSEP runtime code to /ort/ (accessible by both vite dev and build)
      // ORT will load *.jsep.mjs / *.jsep.wasm etc. under this directory using default filenames
      const base = (import.meta as any).env?.BASE_URL || '/'
      ort.env.wasm.wasmPaths = base + 'ort/'
      if (!sharedSessionPromise) {
        sharedSessionPromise = createSession(base)
          .then(created => {
            sharedSession = created
            return created
          })
          .catch(error => {
            // Allow a later attempt to retry from scratch.
            sharedSessionPromise = null
            throw error
          })
      }
      session.value = await sharedSessionPromise
      refreshRecognitionMode()
      // 分类器模式下 modelInput.size 要反映分类器的输入边长，否则界面显示的是检测器的 416/640
      if (sharedClassifier) {
        modelInput.value = {
          size: sharedClassifier.inputSize,
          dynamic: false,
          nativeSize: sharedClassifier.inputSize,
        }
      } else {
        resolveModelInputSize()
      }
      status.value = t(
        'positionEditor.imageRecognitionStatus.modelLoadedSuccessfully'
      )
    } catch (error) {
      console.error('Model loading failed:', error)
      status.value = t(
        'positionEditor.imageRecognitionStatus.modelLoadingFailed',
        {
          error:
            error instanceof Error
              ? error.message
              : t('positionEditor.imageRecognitionStatus.unknownError'),
        }
      )
      throw error
    } finally {
      isModelLoading.value = false
    }
  }

  /** Reads the graph's input shape and decides which size to run at. */
  function resolveModelInputSize(requested?: number) {
    const sess = session.value
    if (!sess) return
    const meta: any = sess.inputMetadata?.[0]
    // Non-tensor inputs carry no shape; only tensors have `shape`.
    const dims = (meta?.isTensor ? meta.shape : []) as Array<
      number | string | undefined
    >
    const h = dims[2]
    const w = dims[3]
    const fixed =
      typeof h === 'number' && h > 0 && typeof w === 'number' && w > 0
    const nativeSize = fixed ? Math.max(h as number, w as number) : 0
    const size = fixed
      ? nativeSize
      : Math.min(640, Math.max(256, Math.round(requested ?? 416)))
    modelInput.value = { size, dynamic: !fixed, nativeSize }
    console.log(
      `[image-recognition] input ${JSON.stringify(dims)} -> running at ${size}px` +
        (fixed ? ' (fixed by the model)' : ' (dynamic model)')
    )
  }

  /** Lets the caller pick the input size; ignored by fixed-shape models. */
  const setModelInputSize = (requested: number) => {
    resolveModelInputSize(requested)
  }

  // Utility functions
  const letterbox = (
    image: HTMLImageElement,
    newShape = [640, 640],
    color = 114
  ): ProcessedImage => {
    const [newH, newW] = newShape
    const imgW = image.naturalWidth || image.width
    const imgH = image.naturalHeight || image.height

    const r = Math.min(newW / imgW, newH / imgH)
    const newUnpadW = Math.round(imgW * r)
    const newUnpadH = Math.round(imgH * r)
    const dw = (newW - newUnpadW) / 2
    const dh = (newH - newUnpadH) / 2

    const canvas = document.createElement('canvas')
    canvas.width = newW
    canvas.height = newH
    const context = canvas.getContext('2d')!

    context.fillStyle = `rgb(${color}, ${color}, ${color})`
    context.fillRect(0, 0, newW, newH)

    context.drawImage(
      image,
      0,
      0,
      imgW,
      imgH,
      Math.round(dw),
      Math.round(dh),
      newUnpadW,
      newUnpadH
    )

    return {
      canvas,
      context,
      meta: { r, dw, dh, newW, newH, imgW, imgH },
    }
  }

  const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x))

  const iou = (boxA: DetectionBox, boxB: DetectionBox): number => {
    const [x1A, y1A, wA, hA] = boxA.box
    const [x1B, y1B, wB, hB] = boxB.box
    const x2A = x1A + wA,
      y2A = y1A + hA
    const x2B = x1B + wB,
      y2B = y1B + hB

    const intersectX1 = Math.max(x1A, x1B)
    const intersectY1 = Math.max(y1A, y1B)
    const intersectX2 = Math.min(x2A, x2B)
    const intersectY2 = Math.min(y2A, y2B)

    const iw = Math.max(0, intersectX2 - intersectX1)
    const ih = Math.max(0, intersectY2 - intersectY1)
    const inter = iw * ih

    const union = wA * hA + wB * hB - inter
    return union > 0 ? inter / union : 0
  }

  const nms = (
    boxes: DetectionBox[],
    iouThresh = 0.7,
    classAgnostic = false
  ): DetectionBox[] => {
    boxes.sort((a, b) => b.score - a.score)
    const result: DetectionBox[] = []
    const removed = new Array(boxes.length).fill(false)

    for (let i = 0; i < boxes.length; i++) {
      if (removed[i]) continue
      const a = boxes[i]
      result.push(a)
      for (let j = i + 1; j < boxes.length; j++) {
        if (removed[j]) continue
        const b = boxes[j]
        if (!classAgnostic && a.labelIndex !== b.labelIndex) continue
        if (iou(a, b) > iouThresh) removed[j] = true
      }
    }
    return result
  }

  const doBoxesOverlap = (
    boxA: [number, number, number, number],
    boxB: [number, number, number, number]
  ): boolean => {
    const [x1A, y1A, wA, hA] = boxA
    const [x1B, y1B, wB, hB] = boxB
    const x2A = x1A + wA,
      y2A = y1A + hA
    const x2B = x1B + wB,
      y2B = y1B + hB

    return !(x2A < x1B || x1A > x2B || y2A < y1B || y1A > y2B)
  }

  // Image preprocessing
  const preprocess = async (
    image: HTMLImageElement
  ): Promise<{ tensor: ort.Tensor; meta: ProcessedImage['meta'] }> => {
    const modelW = modelInput.value.size
    const modelH = modelInput.value.size

    const { canvas, meta } = letterbox(image, [modelH, modelW], 114)

    const context = canvas.getContext('2d')!
    const imageData = context.getImageData(0, 0, modelW, modelH)
    const { data } = imageData

    const red = new Float32Array(modelW * modelH)
    const green = new Float32Array(modelW * modelH)
    const blue = new Float32Array(modelW * modelH)

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      red[p] = data[i] / 255
      green[p] = data[i + 1] / 255
      blue[p] = data[i + 2] / 255
    }

    const input = new Float32Array(modelW * modelH * 3)
    input.set(red, 0)
    input.set(green, modelW * modelH)
    input.set(blue, modelW * modelH * 2)

    const tensor = new ort.Tensor('float32', input, [1, 3, modelH, modelW])
    return { tensor, meta }
  }

  // Post-processing results (Compatible with YOLOv11: supports CxN and NxC layouts, automatically detects normalized coordinates)
  const postprocess = (
    outputDataRaw: any,
    outShape: number[],
    meta: ProcessedImage['meta']
  ): DetectionBox[] => {
    // Unify TypedArray/number[] for Float32Array access
    const outputData =
      outputDataRaw instanceof Float32Array
        ? outputDataRaw
        : Float32Array.from(outputDataRaw as number[])

    const num_classes = 34
    const num_coords = 4

    const { r, dw, dh, imgW, imgH, newW, newH } = meta

    const confThresh = 0.25
    const iouThresh = 0.7
    const classAgnostic = false

    // ---------- Branch 3: xyxy+score+classIdx ----------
    // Format like [1, N, 6] or [N, 6], where each row is [x1,y1,x2,y2,score,cls]
    const handleXYXYFormat = (
      data: Float32Array,
      shape: number[]
    ): DetectionBox[] => {
      let N: number
      let stride: number
      let offset = 0
      if (shape.length === 3 && shape[2] === 6) {
        N = shape[1]
        stride = 6
      } else if (shape.length === 2 && shape[1] === 6) {
        N = shape[0]
        stride = 6
      } else {
        return []
      }

      // Sample to determine if coordinates are normalized
      let maxAbsCoord = 0
      const sample = Math.min(N, 64)
      for (let i = 0; i < sample; i++) {
        const base = offset + i * stride
        const x1 = Math.abs(data[base + 0])
        const y1 = Math.abs(data[base + 1])
        const x2 = Math.abs(data[base + 2])
        const y2 = Math.abs(data[base + 3])
        maxAbsCoord = Math.max(maxAbsCoord, x1, y1, x2, y2)
      }
      const coordsAreNormalized = maxAbsCoord <= 1.5

      const boxes: DetectionBox[] = []
      for (let i = 0; i < N; i++) {
        const base = offset + i * stride
        let x1 = data[base + 0]
        let y1 = data[base + 1]
        let x2 = data[base + 2]
        let y2 = data[base + 3]
        const score = data[base + 4]
        const clsIdx = Math.round(data[base + 5])

        if (score < confThresh) continue

        if (coordsAreNormalized) {
          x1 *= newW
          y1 *= newH
          x2 *= newW
          y2 *= newH
        }

        // Convert back to xywh
        let cx = (x1 + x2) / 2
        let cy = (y1 + y2) / 2
        let w = Math.max(0, x2 - x1)
        let h = Math.max(0, y2 - y1)

        // Remove letterbox padding (restore to original image)
        let bx = (cx - w / 2 - dw) / r
        let by = (cy - h / 2 - dh) / r
        let bw = w / r
        let bh = h / r

        // Clip to original image bounds
        bx = Math.max(0, Math.min(bx, imgW - 1))
        by = Math.max(0, Math.min(by, imgH - 1))
        bw = Math.max(0, Math.min(bw, imgW - bx))
        bh = Math.max(0, Math.min(bh, imgH - by))

        boxes.push({ box: [bx, by, bw, bh], score, labelIndex: clsIdx })
      }
      return boxes
    }

    // First try to identify xyxy+score+classIdx output
    if (
      (outShape.length === 3 && outShape[2] === 6) ||
      (outShape.length === 2 && outShape[1] === 6)
    ) {
      return nms(
        handleXYXYFormat(outputData, outShape),
        iouThresh,
        classAgnostic
      )
    }

    // ---------- Branch 1/2: YOLO style (xywh [+obj] + classes) ----------
    // Automatically identify [1,C,N] or [1,N,C]
    const channelsCandidate1 = outShape[1] // C?
    const predsCandidate1 = outShape[2] // N?
    const channelsCandidate2 = outShape[2] // C?
    const predsCandidate2 = outShape[1] // N?

    const matchesChannels = (c: number) =>
      c === num_coords + num_classes || c === num_coords + num_classes + 1

    let layout: 'cf' | 'cl' = 'cf' // 'cf': [1, C, N]；'cl': [1, N, C]
    let num_channels = channelsCandidate1
    let num_predictions = predsCandidate1

    if (matchesChannels(channelsCandidate1)) {
      layout = 'cf'
      num_channels = channelsCandidate1
      num_predictions = predsCandidate1
    } else if (matchesChannels(channelsCandidate2)) {
      layout = 'cl'
      num_channels = channelsCandidate2
      num_predictions = predsCandidate2
    } else {
      // Fallback: treat the larger one as C
      if (channelsCandidate1 >= channelsCandidate2) {
        layout = 'cf'
        num_channels = channelsCandidate1
        num_predictions = predsCandidate1
      } else {
        layout = 'cl'
        num_channels = channelsCandidate2
        num_predictions = predsCandidate2
      }
      console.warn(
        'Unexpected YOLO-like output shape, guessing layout:',
        outShape
      )
    }

    const hasObjectness = num_channels === num_coords + num_classes + 1

    const getVal = (ch: number, i: number): number =>
      layout === 'cf'
        ? outputData[ch * num_predictions + i]
        : outputData[i * num_channels + ch]

    // Sample to determine if classes need sigmoid
    let needSigmoid = false
    {
      const startCh = num_coords + (hasObjectness ? 1 : 0)
      let sampled = 0
      for (
        let ch = startCh;
        ch < num_channels && sampled < 64;
        ch += Math.max(1, Math.floor(num_classes / 8))
      ) {
        const v = getVal(ch, 0)
        if (v < 0 || v > 1) {
          needSigmoid = true
          break
        }
        sampled++
      }
    }

    // Sample to determine if coordinates are normalized
    let maxAbsCoord = 0
    const sampleCount = Math.min(num_predictions, 64)
    const step = Math.max(1, Math.floor(num_predictions / sampleCount))
    for (let i = 0; i < num_predictions && i < sampleCount * step; i += step) {
      const sx = Math.abs(getVal(0, i))
      const sy = Math.abs(getVal(1, i))
      const sw = Math.abs(getVal(2, i))
      const sh = Math.abs(getVal(3, i))
      maxAbsCoord = Math.max(maxAbsCoord, sx, sy, sw, sh)
    }
    const coordsAreNormalized = maxAbsCoord <= 1.5

    const boxes: DetectionBox[] = []
    for (let i = 0; i < num_predictions; i++) {
      let x = getVal(0, i)
      let y = getVal(1, i)
      let w = getVal(2, i)
      let h = getVal(3, i)

      if (coordsAreNormalized) {
        x *= newW
        y *= newH
        w *= newW
        h *= newH
      }

      let obj = 1.0
      let clsStart = 4
      if (hasObjectness) {
        obj = getVal(4, i)
        if (needSigmoid) obj = sigmoid(obj)
        clsStart = 5
      }

      let maxScore = -Infinity
      let maxIndex = -1
      for (let c = 0; c < num_classes; c++) {
        let s = getVal(clsStart + c, i)
        if (needSigmoid) s = sigmoid(s)
        const clsConf = hasObjectness ? obj * s : s
        if (clsConf > maxScore) {
          maxScore = clsConf
          maxIndex = c
        }
      }

      if (maxScore >= confThresh) {
        // cxcywh -> xywh
        let bx = x - w / 2
        let by = y - h / 2
        let bw = w
        let bh = h

        // Remove padding & restore to original image
        bx = (bx - dw) / r
        by = (by - dh) / r
        bw = bw / r
        bh = bh / r

        // Clip
        bx = Math.max(0, Math.min(bx, imgW - 1))
        by = Math.max(0, Math.min(by, imgH - 1))
        bw = Math.max(0, Math.min(bw, imgW - bx))
        bh = Math.max(0, Math.min(bh, imgH - by))

        boxes.push({
          box: [bx, by, bw, bh],
          score: maxScore,
          labelIndex: maxIndex,
        })
      }
    }

    return nms(boxes, iouThresh, classAgnostic)
  }

  // Sync canvas with image display size
  const syncCanvasToImage = (
    imgElement: HTMLImageElement,
    canvasElement: HTMLCanvasElement
  ) => {
    const dispW = imgElement.clientWidth
    const dispH = imgElement.clientHeight

    canvasElement.style.position = 'absolute'
    canvasElement.style.left = '0'
    canvasElement.style.top = '0'
    canvasElement.style.width = dispW + 'px'
    canvasElement.style.height = dispH + 'px'
    canvasElement.style.pointerEvents = 'none'

    const dpr = window.devicePixelRatio || 1
    canvasElement.width = Math.round(dispW * dpr)
    canvasElement.height = Math.round(dispH * dpr)

    const ctx = canvasElement.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, dispW, dispH)

    const natW = imgElement.naturalWidth || imgElement.width
    const natH = imgElement.naturalHeight || imgElement.height

    const scaleX = dispW / natW
    const scaleY = dispH / natH

    return { dispW, dispH, natW, natH, scaleX, scaleY }
  }

  // Draw bounding boxes
  const drawBoundingBoxes = (
    boxes: DetectionBox[],
    imgElement: HTMLImageElement,
    canvasElement: HTMLCanvasElement
  ) => {
    const { scaleX, scaleY } = syncCanvasToImage(imgElement, canvasElement)
    const ctx = canvasElement.getContext('2d')!

    // Clear canvas first
    const { dispW, dispH } = syncCanvasToImage(imgElement, canvasElement)
    ctx.clearRect(0, 0, dispW, dispH)

    // Only draw if showBoundingBoxes is enabled
    if (!showBoundingBoxes.value) {
      return
    }

    ctx.font = '14px Arial'

    boxes.forEach(({ box, score, labelIndex }) => {
      const label = LABELS[labelIndex]
      if (!label) return

      const x = box[0] * scaleX
      const y = box[1] * scaleY
      const w = box[2] * scaleX
      const h = box[3] * scaleY

      ctx.strokeStyle = label.color
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, w, h)

      const text = `${label.name}: ${score.toFixed(2)}`
      const textWidth = ctx.measureText(text).width

      ctx.fillStyle = label.color
      ctx.fillRect(x - 1, y - 18, textWidth + 8, 18)

      ctx.fillStyle = 'white'
      ctx.fillText(text, x + 3, y - 4)
    })
  }

  // 把检测通路抽出来，分类通路需要它先给出棋盘框
  const runDetector = async (
    img: HTMLImageElement,
    sess: ort.InferenceSession
  ): Promise<DetectionBox[]> => {
    status.value = t('positionEditor.imageRecognitionStatus.preprocessingImage')
    const prep = await preprocess(img)

    status.value = t(
      'positionEditor.imageRecognitionStatus.runningModelInference'
    )
    // More robust selection of input name (many exported YOLO models use 'images' as input name)
    const inputName = sess.inputNames.includes('images')
      ? 'images'
      : sess.inputNames[0]
    const feeds = { [inputName]: prep.tensor }
    const results = await sess.run(feeds)

    const firstOut = results.output0 || results[Object.keys(results)[0]]
    const outputData = firstOut.data as unknown as number[]
    const outShape = firstOut.dims as number[]

    status.value = t(
      'positionEditor.imageRecognitionStatus.postProcessingResults'
    )
    return postprocess(outputData, outShape, prep.meta)
  }

  /**
   * 逐格分类通路。
   *
   * 定位与识别分开做：先用（内置的）检测器给出棋盘框，再在框内做亚像素晶格拟合，
   * 然后裁出 90 个格子逐个分类。有检测器时最准；没有就靠拟合自己扫一遍，
   * 精度差一些，但足以让流程跑起来。
   */
  const runCellClassification = async (
    img: HTMLImageElement
  ): Promise<DetectionBox[]> => {
    const clf = sharedClassifier!
    status.value = t('positionEditor.imageRecognitionStatus.runningModelInference')

    let rough: RoughBox | null = null
    if (detectorSession) {
      try {
        const det = await runDetector(img, detectorSession)
        rough = boardRoughFrom(det)
        if (!rough) detectorBoardMisses.value++
        else detectorBoardMisses.value = 0
      } catch (e) {
        console.warn('[image-recognition] 用于定位的检测器失败，改自标定', e)
      }
    }

    const res = await classifyBoard(img, clf, rough)
    if (!res) throw new Error(t('lineConnect.classifierNoBoard'))

    lastGridConfidence.value = res.grid.confidence
    lastCellLabels.value = res.cellLabels
    classifierUnmapped.value = res.unmapped

    // 合成一个 Board 框：下游的 getBoardBox 与裁剪优化要靠它，
    // 而且由晶格算出来的框比检测器给的更准。
    const boardIdx = labelIndexOf('Board')
    const out: DetectionBox[] = []
    if (boardIdx >= 0) {
      out.push({
        box: [
          res.grid.x0 - res.grid.dx / 2,
          res.grid.y0 - res.grid.dy / 2,
          res.grid.dx * GRID_COLS,
          res.grid.dy * GRID_ROWS,
        ],
        score: 0.99,
        labelIndex: boardIdx,
      })
    }
    for (const b of res.boxes) out.push(b)

    status.value = t(
      'positionEditor.imageRecognitionStatus.recognitionCompleted'
    )
    return out
  }

  // Run the model against an already decoded image element.
  // Run the model against an already decoded image element.
  const runInference = async (
    img: HTMLImageElement
  ): Promise<DetectionBox[]> => {
    inputImage.value = img

    // 导入的是逐格分类器时走另一条通路
    if (sharedClassifier) {
      const cellBoxes = await runCellClassification(img)
      detectedBoxes.value = cellBoxes
      return cellBoxes
    }

    const boxes = await runDetector(img, session.value!)
    detectedBoxes.value = boxes

    status.value = t(
      'positionEditor.imageRecognitionStatus.recognitionCompleted'
    )

    return boxes
  }

  /**
   * Runs recognition against an image element that is already decoded.
   *
   * The line-connect (连线自动走棋) loop feeds screen captures here instead of
   * going through the file picker.
   */
  const processImageElement = async (
    img: HTMLImageElement
  ): Promise<DetectionBox[]> => {
    isProcessing.value = true
    try {
      status.value = t('positionEditor.imageRecognitionStatus.loadingImage')
      await initializeModel()
      return await runInference(img)
    } catch (error) {
      console.error('Image processing failed:', error)
      status.value = t(
        'positionEditor.imageRecognitionStatus.processingFailed',
        {
          error:
            error instanceof Error
              ? error.message
              : t('positionEditor.imageRecognitionStatus.unknownError'),
        }
      )
      throw error
    } finally {
      isProcessing.value = false
    }
  }

  // Process image recognition
  const processImage = async (file: File): Promise<void> => {
    try {
      isProcessing.value = true
      status.value = t('positionEditor.imageRecognitionStatus.loadingImage')

      // Initialize model
      await initializeModel()

      // Create image element
      const img = new Image()
      const imageUrl = URL.createObjectURL(file)

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = reject
        img.src = imageUrl
      })

      await runInference(img)

      // Do not revoke immediately; keep the blob URL while the image is displayed
    } catch (error) {
      console.error('Image processing failed:', error)
      status.value = t(
        'positionEditor.imageRecognitionStatus.processingFailed',
        {
          error:
            error instanceof Error
              ? error.message
              : t('positionEditor.imageRecognitionStatus.unknownError'),
        }
      )
      throw error
    } finally {
      isProcessing.value = false
    }
  }

  const getBoardBox = (boxes: DetectionBox[]): DetectionBox | null => {
    return (
      boxes
        .filter(b => LABELS[b.labelIndex]?.name === 'Board')
        .sort((a, b) => b.score - a.score)[0] ?? null
    )
  }

  // Update board grid
  const updateBoardGrid = (
    boxes: DetectionBox[]
  ): (DetectionBox | null)[][] => {
    const boardBox = boxes
      .filter(b => LABELS[b.labelIndex]?.name === 'Board')
      .sort((a, b) => b.score - a.score)[0]

    if (!boardBox)
      return Array(10)
        .fill(null)
        .map(() => Array(9).fill(null))

    const piecesOnBoard = boxes.filter(p => {
      if (LABELS[p.labelIndex]?.name === 'Board') return false
      return doBoxesOverlap(p.box, boardBox.box)
    })

    const [bx, by, bw, bh] = boardBox.box
    const p_tl = { x: bx, y: by }
    const p_tr = { x: bx + bw, y: by }
    const p_bl = { x: bx, y: by + bh }
    const p_br = { x: bx + bw, y: by + bh }

    const grid: Array<Array<DetectionBox | null>> = Array(10)
      .fill(null)
      .map(() => Array(9).fill(null))

    for (const piece of piecesOnBoard) {
      const [px, py, pw, ph] = piece.box
      const pieceCenter = { x: px + pw / 2, y: py + ph / 2 }
      let bestPos = { i: -1, j: -1, dist: Infinity }

      for (let j = 0; j < 10; j++) {
        for (let i = 0; i < 9; i++) {
          const u = i / 8
          const v = j / 9

          const topX = (1 - u) * p_tl.x + u * p_tr.x
          const topY = (1 - u) * p_tl.y + u * p_tr.y
          const botX = (1 - u) * p_bl.x + u * p_br.x
          const botY = (1 - u) * p_bl.y + u * p_br.y
          const gridX = (1 - v) * topX + v * botX
          const gridY = (1 - v) * topY + v * botY

          const dist = Math.hypot(pieceCenter.x - gridX, pieceCenter.y - gridY)
          if (dist < bestPos.dist) bestPos = { i, j, dist }
        }
      }

      const { i, j } = bestPos
      if (i !== -1 && (!grid[j][i] || piece.score > grid[j][i]!.score)) {
        grid[j][i] = piece
      }
    }

    return grid
  }

  return {
    session,
    isModelLoading,
    isProcessing,
    status,
    detectedBoxes,
    inputImage,
    outputCanvas,
    showBoundingBoxes,
    processImage,
    processImageElement,
    getBoardBox,
    modelInput,
    setModelInputSize,
    drawBoundingBoxes,
    updateBoardGrid,
    initializeModel,
    // 逐格分类通路
    recognitionMode,
    classifierLabels,
    lastGridConfidence,
    lastCellLabels,
    classifierUnmapped,
    detectorBoardMisses,
  }
}
