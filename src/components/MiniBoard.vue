<template>
  <div class="mini-board" :style="{ width: size + 'px' }">
    <img class="mini-board__bg" src="@/assets/xiangqi.png" alt="" />

    <!-- Pieces, drawn only where one actually stands. -->
    <img
      v-for="p in placedPieces"
      :key="p.id"
      class="mini-board__piece"
      :class="{ 'is-dark': !p.isKnown }"
      :src="p.src"
      :style="{ top: p.top + '%', left: p.left + '%' }"
      alt=""
    />

    <!-- The move that produced this prompt. -->
    <svg
      v-if="arrow"
      class="mini-board__arrows"
      viewBox="0 0 90 100"
      preserveAspectRatio="none"
    >
      <defs>
        <marker
          id="mini-arrow-head"
          markerWidth="2.4"
          markerHeight="2.4"
          refX="1.6"
          refY="1.2"
          orient="auto"
        >
          <polygon points="0 0, 2.4 1.2, 0 2.4" fill="#e53935" />
        </marker>
      </defs>
      <line
        :x1="arrow.x1"
        :y1="arrow.y1"
        :x2="arrow.x2"
        :y2="arrow.y2"
        marker-end="url(#mini-arrow-head)"
        class="mini-board__arrow"
      />
    </svg>

    <span v-if="label" class="mini-board__label">{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
  /**
   * A small read-only picture of the position, with an optional move arrow.
   *
   * Exists so the player can see *where* a prompt came from without closing it:
   * "a dark piece moved from here to there, and now you must say what it was".
   *
   * Geometry mirrors Chessboard.vue exactly — the same measured offsets — so a
   * piece lands on the same intersection at any size.
   */
  import { computed } from 'vue'
  import { resolveDefaultPieceImage } from '@/utils/pieceImages'

  const props = withDefaults(
    defineProps<{
      pieces: any[]
      /** Move to draw, in UCI ("h2e2"). */
      arrowUci?: string | null
      /** Whether the board is shown from black's side. */
      flipped?: boolean
      size?: number
      label?: string
    }>(),
    { arrowUci: null, flipped: false, size: 200, label: '' }
  )

  /* Same constants as the main board: xiangqi.png is 844x938 and its outermost
     grid lines sit at 46.5 / 796.5 horizontally and 46.5 / 890.5 vertically. */
  const IMG_W = 844
  const IMG_H = 938
  const GRID_LEFT = 46.5
  const GRID_RIGHT = 796.5
  const GRID_TOP = 46.5
  const GRID_BOTTOM = 890.5
  const COLS = 9
  const ROWS = 10

  const OX = (GRID_LEFT / IMG_W) * 100
  const OY = (GRID_TOP / IMG_H) * 100
  const GX = ((GRID_RIGHT - GRID_LEFT) / IMG_W) * 100
  const GY = ((GRID_BOTTOM - GRID_TOP) / IMG_H) * 100

  const pct = (row: number, col: number) => ({
    x: OX + (col / (COLS - 1)) * GX,
    y: OY + (row / (ROWS - 1)) * GY,
  })

  const displayRC = (row: number, col: number) =>
    props.flipped ? [ROWS - 1 - row, COLS - 1 - col] : [row, col]

  const placedPieces = computed(() =>
    (props.pieces || []).map((p: any) => {
      const [r, c] = displayRC(p.row, p.col)
      const { x, y } = pct(r, c)
      return {
        id: p.id,
        isKnown: p.isKnown,
        src: resolveDefaultPieceImage(
          p.isKnown && p.name ? p.name : 'dark_piece'
        ),
        top: y,
        left: x,
      }
    })
  )

  const arrow = computed(() => {
    const uci = props.arrowUci
    if (!uci || uci.length < 4) return null
    const file2col = (ch: string) => ch.charCodeAt(0) - 97
    const rank2row = (d: string) => 9 - parseInt(d, 10)

    const [fR, fC] = displayRC(rank2row(uci[1]), file2col(uci[0]))
    const [tR, tC] = displayRC(rank2row(uci[3]), file2col(uci[2]))
    const from = pct(fR, fC)
    const to = pct(tR, tC)

    // The arrow layer uses the board's SVG coordinate system: width 90 for 100
    // units of height, matching Chessboard.vue.
    return {
      x1: from.x * 0.9,
      y1: from.y,
      x2: to.x * 0.9,
      y2: to.y,
    }
  })
</script>

<style scoped lang="scss">
  .mini-board {
    position: relative;
    aspect-ratio: 9 / 10;
    margin: 0 auto;
    border-radius: var(--r-sm);
    overflow: hidden;
    box-shadow: var(--sh-1);
    background: rgb(var(--c-sunken));
  }

  .mini-board__bg {
    width: 100%;
    height: 100%;
    display: block;
    user-select: none;
  }

  .mini-board__piece {
    position: absolute;
    width: 12%;
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .mini-board__piece.is-dark {
    filter: drop-shadow(0 1px 1px rgb(28 27 26 / 0.28));
  }

  .mini-board__arrows {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .mini-board__arrow {
    stroke: #e53935;
    stroke-width: 1.6;
    stroke-linecap: round;
    fill: none;
  }

  .mini-board__label {
    position: absolute;
    left: 50%;
    bottom: 4px;
    translate: -50% 0;
    padding: 2px 8px;
    border-radius: var(--r-pill);
    background: rgb(28 27 26 / 0.66);
    color: #fff;
    font-size: var(--fs-micro);
    white-space: nowrap;
  }
</style>
