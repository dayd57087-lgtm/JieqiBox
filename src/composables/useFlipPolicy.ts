import { computed, type Ref } from 'vue'
import { useGameSettings } from './useGameSettings'
import { useAutoPlay } from './useAutoPlay'

export type Side = 'red' | 'black'

/** 这个暗子是在什么情形下需要确认的。 */
export type FlipPromptKind = 'move' | 'capture'

/**
 * 我方 / 对方 是一条**相对**的界线，跟着棋盘朝向走，与红黑无关：
 * 棋盘未翻转时红方是我方，翻转后黑方是我方。这一切在后台完成，界面不显示。
 *
 * This is the whole 翻子 rule, and there is only one version of it:
 *
 * | 事件                     | 需要选择？ |
 * |--------------------------|-----------|
 * | 我方的暗子移动            | 需要       |
 * | 对方的暗子移动            | 需要       |
 * | 我方吃掉对方的暗子        | 需要       |
 * | 对方吃掉我方的暗子        | 不需要     |
 *
 * The last row is not "pick one at random" — a piece captured while face down
 * is simply never identified. That is the game: you cannot know what you took,
 * so the app does not invent an answer, and nothing is recorded about it.
 *
 * 例外：双方都是电脑时没有我方/对方可言，一切按我方的逻辑处理（全部询问），
 * 由旁观的人来回答。
 */
export function useFlipPolicy(isBoardFlipped: Ref<boolean>) {
  const { isFreeFlip } = useGameSettings()
  const { isRedAi, isBlackAi } = useAutoPlay()

  /** 我方 = 棋盘下方那一方。 */
  const mySide = computed<Side>(() => (isBoardFlipped.value ? 'black' : 'red'))
  const oppositeSide = computed<Side>(() =>
    isBoardFlipped.value ? 'red' : 'black'
  )

  /** 双方都是电脑：没有我方/对方之分。 */
  const isComputerVsComputer = computed(() => isRedAi.value && isBlackAi.value)

  /**
   * 这个暗子需不需要人来指定？
   *
   * @param pieceSide 待确认的那枚暗子属于哪一方。
   *   - `move`：就是走子的那一方
   *   - `capture`：是**被吃**的那一方，与走子方相反
   */
  const shouldAsk = (pieceSide: Side, kind: FlipPromptKind): boolean => {
    if (!isFreeFlip.value) return false

    // 双方都是电脑时不分我方对方，一律询问。
    if (isComputerVsComputer.value) return true

    // 移动的暗子哪一方都要问 —— 两枚子都摆在眼前，只是不知道名字。
    if (kind === 'move') return true

    // 被吃的暗子：只有它属于对方时才问。
    // 属于我方，说明是对方吃了我方的子 —— 保持未知，不做任何操作。
    return pieceSide === oppositeSide.value
  }

  return { shouldAsk, mySide, oppositeSide, isComputerVsComputer }
}
