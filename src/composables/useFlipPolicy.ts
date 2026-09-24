import { computed, ref, type Ref } from 'vue'
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
 *
 * 另有第三种情形：**盘边没有人**（引擎联赛、批量自对弈）。此时没有人可以回答，
 * 询问就等于停摆，所以暗子一律从池里随机抽取；抽签走的是可播种的随机源，
 * 因此一局仍然可以完整复现。
 */
/**
 * 盘边有没有人。
 *
 * 模块级状态，因为它描述的是"这一局是什么性质"，而不是某个组件的显示状态：
 * 联赛运行器置为 true，运行结束置回 false。若改成从组件层层传参，
 * `movePiece` 里那个匿名的调用点就拿不到了。
 */
const isUnattended = ref(false)

/** 由联赛运行器调用：标记接下来这一局没有人可以回答翻子询问。 */
export function setFlipUnattended(value: boolean): void {
  isUnattended.value = value
}

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
    // Nobody to ask: draw from the pool rather than waiting for a tap that will
    // never come.
    if (isUnattended.value) return false

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
