// Real version for yolo-enabled builds
// This file is used when YOLO functionality is enabled

// Import the real implementation
import { useImageRecognition as useImageRecognitionReal } from './useImageRecognition.real'

// Export the real implementation
export const useImageRecognition = useImageRecognitionReal

// 模型来源与测试版的导入能力。这两个也要从这里出去：界面只认这个模块，
// 不该直接依赖 .real 实现文件。
export {
  modelSource,
  importedModelName,
  modelImportBridge,
  resetSharedSession,
} from './useImageRecognition.real'

// Also, re-export the shared types so consumers can import them from one place.
export * from './types'
