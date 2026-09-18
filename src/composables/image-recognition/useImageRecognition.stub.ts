import { ref, readonly } from 'vue'
import type { DetectionBox } from './types'

// no-yolo 构建里没有真正的模型，保持和 real 实现同样的导出形状，
// 免得引用方在两种构建下编译不过。
export const modelSource = readonly(ref<'builtin' | 'imported'>('builtin'))
export const importedModelName = readonly(ref(''))
export const modelImportBridge = () => null
export const resetSharedSession = (): void => {
  /* no-op */
}

// This is the stub implementation. It returns the same structure
// but with disabled/default values and functions that do nothing.
export const useImageRecognition = () => {
  const status = readonly(ref('Image recognition is disabled in this build.'))

  // Return an API-compatible object
  return {
    session: readonly(ref(null)),
    isModelLoading: readonly(ref(false)),
    isProcessing: readonly(ref(false)),
    status,
    detectedBoxes: ref<DetectionBox[]>([]),
    inputImage: readonly(ref<HTMLImageElement | null>(null)),
    outputCanvas: readonly(ref<HTMLCanvasElement | null>(null)),
    showBoundingBoxes: ref(false), // Can still be toggled, won't do anything
    processImage: async (_file: File): Promise<void> => {
      console.warn('Image recognition is disabled in this build.')
      return Promise.resolve()
    },
    processImageElement: async (
      _img: HTMLImageElement
    ): Promise<DetectionBox[]> => {
      console.warn('Image recognition is disabled in this build.')
      return []
    },
    getBoardBox: (_boxes: DetectionBox[]): DetectionBox | null => null,
    modelInput: readonly(ref({ size: 640, dynamic: false, nativeSize: 640 })),
    setModelInputSize: (_size: number): void => {
      /* no-op */
    },
    drawBoundingBoxes: (
      _boxes: DetectionBox[],
      _imgElement: HTMLImageElement,
      _canvasElement: HTMLCanvasElement
    ) => {
      /* Do nothing */
    },
    updateBoardGrid: (_boxes: DetectionBox[]) =>
      Array(10)
        .fill(null)
        .map(() => Array(9).fill(null)),
    initializeModel: async (): Promise<void> => {
      console.warn('Image recognition is disabled in this build.')
      return Promise.resolve()
    },
  }
}
