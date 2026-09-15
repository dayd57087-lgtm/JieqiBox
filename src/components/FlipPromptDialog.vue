<template>
  <!-- Custom draggable dialog overlay -->
  <div
    v-if="isDialogVisible"
    class="custom-dialog-overlay"
    @click="handleOverlayClick"
  >
    <div
      v-if="gameState.pendingFlip.value"
      class="custom-draggable-dialog"
      :style="dialogStyle"
      @click.stop
    >
      <div
        class="dialog-title-bar"
        @mousedown="startDrag"
        @touchstart="startDrag"
      >
        <span class="text-h5">
          {{
            gameState.pendingFlip.value.purpose === 'capture'
              ? $t('flipPrompt.captureTitle')
              : $t('flipPrompt.title')
          }}
        </span>
        <div class="drag-handle">⋮⋮</div>
      </div>
      <div class="dialog-content">
        <!-- Where did this choice come from? The piece has already moved, so
             show the position with the move arrowed. -->
        <div class="prompt-board">
          <MiniBoard
            :pieces="gameState.pieces.value"
            :arrow-uci="gameState.pendingFlip.value.uciMove"
            :flipped="gameState.isBoardFlipped.value"
            :size="196"
            :label="
              gameState.pendingFlip.value.purpose === 'capture'
                ? $t('flipPrompt.capturedPiece')
                : $t('flipPrompt.lastMove')
            "
          />
        </div>

        <p class="prompt-hint">
          {{
            gameState.pendingFlip.value.purpose === 'capture'
              ? $t('flipPrompt.captureHint')
              : $t('flipPrompt.chooseHint')
          }}
        </p>

        <div class="pieces-grid">
          <div
            v-for="item in availablePieces"
            :key="item.name"
            class="piece-item"
            @click="selectPiece(item.name)"
          >
            <div class="piece-option">
              <img
                :src="getPieceImageUrl(item.name)"
                :alt="item.name"
                class="piece-image"
              />
              <div class="piece-count">{{ item.count }}</div>
            </div>
          </div>
        </div>
        <div v-if="availablePieces.length === 0" class="error-message">
          <p>{{ $t('flipPrompt.message') }}</p>
        </div>
      </div>
      <div class="dialog-actions">
        <div class="spacer"></div>
        <button class="cancel-btn" @click="cancelFlip">
          {{ $t('flipPrompt.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, inject, ref, onMounted, onUnmounted } from 'vue'
  import MersenneTwister from 'mersenne-twister'
  import { resolveDefaultPieceImage } from '@/utils/pieceImages'
  import MiniBoard from './MiniBoard.vue'

  // Create a global instance of Mersenne Twister for this component
  const mt = new MersenneTwister()

  // Set seed based on current date and time for better randomness
  mt.init_seed(new Date().getTime())

  // Custom random function using Mersenne Twister
  const mtRandom = (): number => {
    return mt.random()
  }

  const gameState: any = inject('game-state')

  // Drag state management
  const isDragging = ref(false)
  const dragOffset = ref({ x: 0, y: 0 })
  const dialogPosition = ref({ x: 0, y: 0 })

  const isDialogVisible = computed(() => gameState.pendingFlip.value !== null)

  // Calculate dialog position for dragging
  const dialogStyle = computed(() => ({
    position: 'fixed' as const,
    top: `${dialogPosition.value.y}px`,
    left: `${dialogPosition.value.x}px`,
    transform: 'none',
    margin: '0',
    zIndex: 9999,
  }))

  const availablePieces = computed(() => {
    if (!gameState.pendingFlip.value) return []
    const requiredSide = gameState.pendingFlip.value.side

    return Object.entries(gameState.unrevealedPieceCounts.value)
      .map(([char, count]) => {
        const name = gameState.getPieceNameFromChar(char)
        return { name, char, count }
      })
      .filter(item => {
        const pieceSide = item.name.startsWith('red') ? 'red' : 'black'
        return pieceSide === requiredSide && (item.count as number) > 0
      })
  })

  // Initialize dialog position to center of screen
  onMounted(() => {
    centerDialog()
  })

  // Center the dialog on screen
  function centerDialog() {
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight
    const dialogWidth = 500 // max-width from v-dialog
    const dialogHeight = 400 // estimated height

    dialogPosition.value = {
      x: Math.max(0, (windowWidth - dialogWidth) / 2),
      y: Math.max(0, (windowHeight - dialogHeight) / 2),
    }
  }

  // Start dragging when mouse down on title bar
  function startDrag(event: MouseEvent | TouchEvent) {
    isDragging.value = true

    const clientX =
      'touches' in event ? event.touches[0].clientX : event.clientX
    const clientY =
      'touches' in event ? event.touches[0].clientY : event.clientY

    dragOffset.value = {
      x: clientX - dialogPosition.value.x,
      y: clientY - dialogPosition.value.y,
    }

    // Add event listeners for dragging
    document.addEventListener('mousemove', handleDrag)
    document.addEventListener('touchmove', handleDrag, { passive: false })
    document.addEventListener('mouseup', stopDrag)
    document.addEventListener('touchend', stopDrag)

    // Prevent default to avoid text selection
    event.preventDefault()
  }

  // Handle dragging movement
  function handleDrag(event: MouseEvent | TouchEvent) {
    if (!isDragging.value) return

    const clientX =
      'touches' in event ? event.touches[0].clientX : event.clientX
    const clientY =
      'touches' in event ? event.touches[0].clientY : event.clientY

    // Calculate new position
    const newX = clientX - dragOffset.value.x
    const newY = clientY - dragOffset.value.y

    // Allow dragging across the entire window without constraints
    // Only prevent the dialog from being completely outside the viewport
    const minX = -480 // Allow dialog to be almost completely outside left edge
    const maxX = window.innerWidth - 20 // Allow dialog to be almost completely outside right edge
    const minY = -380 // Allow dialog to be almost completely outside top edge
    const maxY = window.innerHeight - 20 // Allow dialog to be almost completely outside bottom edge

    dialogPosition.value = {
      x: Math.max(minX, Math.min(newX, maxX)),
      y: Math.max(minY, Math.min(newY, maxY)),
    }

    // Prevent default for touch events
    if ('touches' in event) {
      event.preventDefault()
    }
  }

  // Stop dragging
  function stopDrag() {
    isDragging.value = false

    // Remove event listeners
    document.removeEventListener('mousemove', handleDrag)
    document.removeEventListener('touchmove', handleDrag)
    document.removeEventListener('mouseup', stopDrag)
    document.removeEventListener('touchend', stopDrag)
  }

  // Clean up event listeners on component unmount
  onUnmounted(() => {
    stopDrag()
  })

  // Handle overlay click to prevent dialog closing when clicking outside
  function handleOverlayClick(event: Event) {
    // Only close if clicking directly on the overlay, not on the dialog
    if (event.target === event.currentTarget) {
      cancelFlip()
    }
  }

  function selectPiece(pieceName: string) {
    if (gameState.pendingFlip.value) {
      gameState.pendingFlip.value.callback(pieceName)
    }
  }

  function cancelFlip() {
    if (gameState.pendingFlip.value) {
      // When the dialog is closed directly, flip a piece randomly based on probability
      const requiredSide = gameState.pendingFlip.value.side
      const pool = Object.entries(gameState.unrevealedPieceCounts.value)
        .filter(([, count]) => (count as number) > 0)
        .flatMap(([char, count]) => {
          const name = gameState.getPieceNameFromChar(char)
          return name.startsWith(requiredSide)
            ? Array(count as number).fill(name)
            : []
        })

      if (pool.length > 0) {
        // Randomly select a piece
        const randomIndex = Math.floor(mtRandom() * pool.length)
        const chosenName = pool[randomIndex]
        gameState.pendingFlip.value.callback(chosenName)
      } else if (gameState.pendingFlip.value.purpose === 'capture') {
        // Dismissing the capture prompt must still finish the move — the piece
        // that moved is already revealed, and the history entry is written by
        // the callback. An empty name just means the captured piece stays
        // unaccounted for, which the owner handles.
        gameState.pendingFlip.value.callback('')
      } else {
        // If no pieces are available, just cancel
        const uciMove = gameState.pendingFlip.value.uciMove
        // Check if this was an AI move before clearing pendingFlip
        const isAiMove = (window as any).__LAST_AI_MOVE__ === uciMove
        gameState.pendingFlip.value = null

        // If this was an AI move, ponder should be started now that the flip dialog is closed
        if (isAiMove) {
          console.log(
            `[DEBUG] cancelFlip: AI move completed after flip dialog cancellation. Checking if ponder should start.`
          )
          const ponderState = (window as any).__PONDER_STATE__
          if (ponderState && ponderState.handlePonderAfterMove) {
            console.log(
              `[DEBUG] cancelFlip: Triggering ponder for AI move: ${uciMove}`
            )
            ponderState.handlePonderAfterMove(uciMove, true)
          }
        }
      }
    }
  }

  function getPieceImageUrl(pieceName: string): string {
    const imageName = pieceName || 'dark_piece'
    return resolveDefaultPieceImage(imageName)
  }
</script>

<style scoped>
  /* Centred card rather than a free-floating draggable box: dragging made
     sense on a desktop, but on a phone it is how a dialog ends up half off the
     screen with its buttons unreachable. */
  .custom-dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: 9998;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--sp-4);
    background: var(--scrim, rgb(28 27 26 / 0.5));
    backdrop-filter: blur(2px);
    overflow-y: auto;
  }

  .custom-draggable-dialog {
    width: 100%;
    max-width: 380px;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: var(--r-lg);
    background: rgb(var(--c-surface));
    box-shadow: var(--sh-3);
    overflow: hidden;
    user-select: none;
  }

  .dialog-title-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-2);
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid rgb(var(--c-divider));
    font-size: var(--fs-md);
    font-weight: var(--fw-semibold);
    /* No longer a drag handle. */
    cursor: default;
  }

  .drag-handle {
    display: none;
  }

  .dialog-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--sp-4);
  }

  .prompt-board {
    display: flex;
    justify-content: center;
    margin-bottom: var(--sp-2);
  }

  .prompt-hint {
    margin: 0 0 var(--sp-3);
    text-align: center;
    font-size: var(--fs-sm);
    color: rgb(var(--c-text-2));
  }

  /* Two rows of three: six pieces fit without shrinking the tap targets. */
  .pieces-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--sp-2);
  }

  .piece-item {
    text-align: center;
  }

  .piece-option {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 72px;
    padding: var(--sp-2);
    border: 1px solid rgb(var(--c-border));
    border-radius: var(--r-md);
    background: rgb(var(--c-surface-2));
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }

  .piece-option:active {
    transform: scale(0.96);
    background: rgb(var(--c-primary-soft));
    border-color: rgb(var(--c-primary));
  }

  .piece-image {
    width: 40px;
    height: 40px;
    display: block;
  }

  .piece-count {
    font-size: var(--fs-sm);
    font-weight: var(--fw-semibold);
    color: rgb(var(--c-text-2));
    font-variant-numeric: tabular-nums;
  }

  .error-message {
    text-align: center;
    color: rgb(var(--c-danger));
    padding: var(--sp-3);
    font-size: var(--fs-base);
  }

  .dialog-actions {
    flex: 0 0 auto;
    display: flex;
    justify-content: flex-end;
    padding: var(--sp-3) var(--sp-4);
    padding-bottom: calc(var(--sp-3) + env(safe-area-inset-bottom));
    border-top: 1px solid rgb(var(--c-divider));
  }

  .spacer {
    flex: 1;
  }

  .cancel-btn {
    min-height: 44px;
    padding: 0 var(--sp-5);
    border: 1px solid rgb(var(--c-border));
    border-radius: var(--r-sm);
    background: transparent;
    color: rgb(var(--c-text-2));
    font-size: var(--fs-base);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .cancel-btn:active {
    background: rgb(var(--c-surface-3));
  }
</style>
