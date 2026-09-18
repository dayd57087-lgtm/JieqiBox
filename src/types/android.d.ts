// Android JavaScript interface types
declare global {
  interface Window {
    ExternalUrlInterface?: {
      openExternalUrl(url: string): void
    }
    SafFileInterface?: {
      startFileSelection(): void
    }
    /**
     * Bridge injected by MainActivity for the line-connect (连线自动走棋)
     * feature. Only present on Android.
     */
    LineConnect?: LineConnectBridge
    /**
     * 测试版独有的模型导入桥。正式版里这个对象也存在（前端用的是同一份产物），
     * 但 isSupported() 恒为 false，据此把入口整个隐藏。
     */
    ModelImport?: ModelImportBridge
  }
}

export interface ModelImportBridge {
  /** 正式版返回 false。 */
  isSupported(): boolean
  hasModel(): boolean
  /** 导入时的原始文件名。 */
  modelName(): string
  modelSize(): number
  /** 打开系统文件选择器挑一个 .onnx。 */
  pickModel(): void
  /** 以 base64 返回模型字节；没有导入模型时返回空串。 */
  readModel(): string
  clearModel(): boolean
}

export interface LineConnectCaptureStatus {
  running: boolean
  screenWidth: number
  screenHeight: number
  frameWidth: number
  frameHeight: number
  lastFrameTime: number
  frames: number
  hasPermission: boolean
}

export interface LineConnectBridge {
  hasCapturePermission(): boolean
  requestCapturePermission(): void
  clearCapturePermission(): void
  startCapture(scale: number, quality: number, intervalMs: number): boolean
  stopCapture(): void
  isCapturing(): boolean
  /** Newest frame as base64 JPEG, or an empty string when unavailable. */
  captureFrame(): string
  /** JSON payload, see LineConnectCaptureStatus. */
  captureStatus(): string
  hasAccessibility(): boolean
  openAccessibilitySettings(): void
  /* Floating control bar (shown while other apps are in the foreground) */
  canDrawOverlays(): boolean
  showOverlay(): boolean
  hideOverlay(): void
  isOverlayVisible(): boolean
  /** JSON payload with any of: turn, status, evaluation, waiting, autoRunning, autoEnabled, scanEnabled */
  updateOverlay(json: string): boolean
  /** Native loop driver: keeps the polling loop alive while the webview is hidden. */
  startTick(intervalMs: number): boolean
  stopTick(): void
  /** Brings the app back to the foreground. */
  bringToFront(): void
  /** Opens the "display over other apps" system settings page. */
  openOverlaySettings(): void
  /**
   * Cropped capture of the newest frame. Coordinates are captured-frame pixels;
   * much cheaper than transferring a whole screenshot once the board is located.
   */
  captureCrop(
    left: number,
    top: number,
    width: number,
    height: number,
    maxEdge: number
  ): string
  /** Fraction (0..1) of the frame that changed since the previous frame. */
  frameChangeRatio(): number

  /* Floating chessboard (movable + resizable) */
  showChessboard(): boolean
  hideChessboard(): void
  isChessboardVisible(): boolean
  /** Pushes the recognised Jieqi FEN into the floating chessboard. */
  setChessboardFen(fen: string): void

  /* Dataset collection for fine-tuning */
  startSampleRecording(): boolean
  stopSampleRecording(): void
  isSampleRecording(): boolean
  sampleCount(): number
  samplePath(): string
  /** Saves the newest frame plus the recognition result as a sample pair. */
  saveSample(annotationJson: string): boolean
  requestStoragePermission(): void
  tap(x: number, y: number, durationMs: number): boolean
  swipe(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    durationMs: number
  ): boolean
  lastGestureError(): string
  currentForegroundPackage(): string
  openOverlaySettings(): void
}

export {}
