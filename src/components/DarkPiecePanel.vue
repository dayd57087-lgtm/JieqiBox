<template>
  <section class="pool" :class="{ 'is-folded': isFolded }">
    <button
      type="button"
      class="pool__head"
      :aria-expanded="!isFolded"
      :title="$t('pool.toggleHint')"
      @click="toggleFolded"
    >
      <span class="pool__title">{{ $t('pool.title') }}</span>
      <span
        class="chip"
        :class="isHealthy ? 'chip--ok' : 'chip--warn'"
        :title="statusDetail"
      >
        {{ statusLabel }}
      </span>
      <svg viewBox="0 0 24 24" class="ico pool__chev">
        <path
          d="M6 15l6-6 6 6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <div ref="bodyEl" class="pool__body">
      <div v-for="side in SIDES" :key="side" class="siderow">
        <span class="siderow__tag" :class="`siderow__tag--${side}`">
          {{ side === 'red' ? $t('pool.red') : $t('pool.black') }}
        </span>

        <div class="siderow__items">
          <div
            v-for="entry in rows[side]"
            :key="entry.char"
            class="counter"
            :class="{ 'is-zero': entry.count === 0, 'is-max': entry.atMax }"
            :title="cellTitle(side, entry)"
          >
            <img
              class="counter__icon"
              :src="pieceImageFor(entry.char)"
              :alt="entry.label"
            />
            <span class="counter__num">{{ entry.count }}</span>

            <div class="counter__stepper">
              <button
                type="button"
                class="counter__btn"
                :disabled="entry.atMax"
                :aria-label="`${entry.label} +1`"
                @click="bump(entry.char, 1)"
              >
                +
              </button>
              <button
                type="button"
                class="counter__btn"
                :disabled="entry.count <= 0"
                :aria-label="`${entry.label} -1`"
                @click="bump(entry.char, -1)"
              >
                −
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
  /**
   * 暗子区 — the face-down piece counters.
   *
   * Both armies are on screen at once and every cell carries its own − / +,
   * so correcting a number never requires first selecting whose turn it is to
   * be edited. The count and the buttons form one control rather than two
   * stacked rows, which keeps the strip short enough to leave the board room
   * to breathe.
   *
   * All state comes from `game-state`; this component owns nothing but the
   * fold flag.
   */
  import { computed, inject, ref, onMounted, nextTick, watch } from 'vue'
  import { useInterfaceSettings } from '@/composables/useInterfaceSettings'
  import { resolvePieceImage } from '@/utils/pieceImages'
  import { INITIAL_PIECE_COUNTS } from '@/utils/constants'

  const gameState = inject('game-state') as any
  const {
    pieces,
    unrevealedPieceCounts,
    adjustUnrevealedCount,
    getPieceNameFromChar,
    validationStatus,
  } = gameState

  const { pieceStyle } = useInterfaceSettings()

  /* ---------- Shape of the panel ---------- */

  const SIDES = ['red', 'black'] as const

  /* The king is deliberately absent: it is the one piece that is never
     face-down, which is why the app tracks 'RNBACP' and not 'RNBACKP'. */
  const RED_CHARS = 'RNBACP'.split('')

  const FOLD_KEY = 'jieqi.pool.folded'

  const isFolded = ref(false)
  const bodyEl = ref<HTMLElement | null>(null)

  try {
    isFolded.value = localStorage.getItem(FOLD_KEY) === '1'
  } catch {
    // Storage unavailable (private mode) — start expanded.
  }

  const toggleFolded = () => {
    isFolded.value = !isFolded.value
    try {
      localStorage.setItem(FOLD_KEY, isFolded.value ? '1' : '0')
    } catch {
      // The panel still works, it just forgets.
    }
  }

  /* ---------- Counts ---------- */

  /** How many pieces of this exact char are already face-up on the board. */
  const revealedCount = (char: string): number => {
    const name = getPieceNameFromChar(char)
    return (pieces.value || []).filter((p: any) => p.isKnown && p.name === name)
      .length
  }

  /**
   * Highest value the counter may reach.
   *
   * The cap is not a constant: pieces already revealed on the board consume
   * part of the side's allowance, so this shrinks as the game progresses.
   * Both the disabled state of + and the tooltip read from here, which keeps
   * the UI in agreement with the engine's own `adjustUnrevealedCount` guard
   * (that guard raises an alert, and we would rather never reach it).
   */
  const maxFor = (char: string): number => {
    const total = INITIAL_PIECE_COUNTS[char] ?? 0
    return Math.max(0, total - revealedCount(char))
  }

  const CN_RED: Record<string, string> = {
    R: '车',
    N: '马',
    B: '相',
    A: '仕',
    C: '炮',
    P: '兵',
  }
  const CN_BLACK: Record<string, string> = {
    r: '车',
    n: '马',
    b: '象',
    a: '士',
    c: '炮',
    p: '卒',
  }

  const pieceLabel = (char: string) =>
    (char === char.toUpperCase() ? CN_RED : CN_BLACK)[char] || char

  const rows = computed(() => {
    const build = (chars: string[]) =>
      chars.map(char => {
        const count = unrevealedPieceCounts.value?.[char] || 0
        const max = maxFor(char)
        return {
          char,
          count,
          max,
          atMax: count >= max,
          label: pieceLabel(char),
        }
      })

    return {
      red: build(RED_CHARS),
      black: build(RED_CHARS.map(c => c.toLowerCase())),
    }
  })

  const pieceImageFor = (char: string) =>
    resolvePieceImage(
      getPieceNameFromChar(char),
      pieceStyle?.value === 'internationalized'
        ? 'internationalized'
        : 'default'
    )

  const cellTitle = (
    side: 'red' | 'black',
    entry: { char: string; count: number; max: number }
  ) =>
    `${side === 'red' ? '红方' : '黑方'}${pieceLabel(entry.char)}：${entry.count} / ${entry.max}`

  const bump = (char: string, delta: 1 | -1) => {
    adjustUnrevealedCount(char, delta)
  }

  /* ---------- Status chip ---------- */

  const statusRaw = computed(() => String(validationStatus?.value ?? '正常'))
  const isHealthy = computed(() => statusRaw.value === '正常')

  /* `validationStatus` returns prose intended for a log line. The strip has
     room for a couple of characters, so shorten the two shapes it produces
     and keep the full sentence in the tooltip. */
  const statusLabel = computed(() => {
    if (isHealthy.value) return '正常'
    const m = statusRaw.value.match(/错误[:：]\s*(.+)/)
    return m ? m[1] : statusRaw.value
  })

  const statusDetail = computed(() =>
    isHealthy.value ? '暗子数量与棋盘一致' : statusRaw.value
  )

  /* ---------- Fold animation height ---------- */

  const syncHeight = () => {
    const el = bodyEl.value
    if (!el) return
    el.style.height = isFolded.value ? '0px' : `${el.scrollHeight}px`
  }

  onMounted(async () => {
    await nextTick()
    syncHeight()
  })

  watch([isFolded, rows], () => syncHeight(), { deep: true })
</script>

<style scoped lang="scss">
  .pool {
    flex: 0 0 auto;
    margin: 0 var(--sp-2) var(--sp-2);
    padding: var(--sp-1) 10px var(--sp-2);
    border: 1px solid rgb(var(--c-border));
    border-radius: var(--r-md);
    background: rgb(var(--c-surface));
    box-shadow: var(--sh-1);
  }

  /* The whole header folds the panel — a separate 44px chevron button would
     spend vertical budget that the board can use better. */
  .pool__head {
    width: 100%;
    height: 28px;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pool__title {
    font-size: var(--fs-base);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.02em;
  }

  .pool__chev {
    width: 18px;
    height: 18px;
    color: rgb(var(--c-text-3));
    transition: rotate var(--dur-base) var(--ease-out);
  }

  .pool.is-folded .pool__chev {
    rotate: 180deg;
  }

  .chip {
    padding: 2px 8px;
    border-radius: var(--r-pill);
    font-size: var(--fs-micro);
    font-weight: var(--fw-medium);
    white-space: nowrap;
    max-width: 46vw;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip--ok {
    background: rgb(var(--c-success-soft));
    color: rgb(var(--c-success));
  }

  .chip--warn {
    background: rgb(var(--c-danger-soft));
    color: rgb(var(--c-danger));
  }

  .pool__body {
    overflow: hidden;
    transition:
      height var(--dur-base) var(--ease-out),
      opacity var(--dur-base) var(--ease-out);
  }

  .pool.is-folded .pool__body {
    opacity: 0;
  }

  .siderow {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
  }

  .siderow + .siderow {
    margin-top: 6px;
  }

  .siderow__tag {
    flex: 0 0 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: var(--r-pill);
    color: #fff;
    font-size: var(--fs-sm);
    font-weight: var(--fw-bold);
    line-height: 1;
  }

  .siderow__tag--red {
    background: rgb(var(--c-red));
  }

  .siderow__tag--black {
    background: rgb(var(--c-black));
  }

  .siderow__items {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 3px;
  }

  /* icon · count · stacked stepper, as a single control */
  .counter {
    flex: 1 1 0;
    min-width: 0;
    height: 44px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 2px;
    border: 1px solid rgb(var(--c-border));
    border-radius: var(--r-xs);
    background: rgb(var(--c-surface-2));
    transition:
      border-color var(--dur-base) var(--ease-out),
      opacity var(--dur-base) var(--ease-out);
  }

  .counter__icon {
    flex: 0 0 auto;
    width: 15px;
    height: 15px;
  }

  .counter__num {
    flex: 1 1 auto;
    min-width: 0;
    text-align: center;
    font-size: var(--fs-base);
    font-weight: var(--fw-bold);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  /* Stacked, not side by side: the pair keeps usable width even in a 55px
     cell, and the column costs no extra height. */
  .counter__stepper {
    flex: 0 0 auto;
    width: 21px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .counter__btn {
    width: 100%;
    height: 20px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid rgb(var(--c-border));
    border-radius: 3px;
    background: rgb(var(--c-surface));
    color: rgb(var(--c-text-2));
    font-size: 14px;
    font-weight: var(--fw-semibold);
    line-height: 1;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  .counter__btn:active:not(:disabled) {
    background: rgb(var(--c-primary-soft));
    border-color: rgb(var(--c-primary));
    color: rgb(var(--c-primary-text));
  }

  .counter__btn:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .counter.is-zero {
    opacity: 0.55;
  }

  .counter.is-max .counter__num {
    color: rgb(var(--c-primary-text));
  }

  /* Desktop has the room to be a little more generous. */
  @media (min-width: 769px) {
    .pool {
      margin-inline: var(--sp-5);
    }

    .counter {
      height: 46px;
    }

    .counter__stepper {
      width: 24px;
    }

    .counter__btn {
      height: 21px;
    }
  }
</style>
