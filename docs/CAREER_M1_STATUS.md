# M1 实现状态

对应 §5 里程碑表中的 **M1 最小闭环**。已落地，可编译、可测试。

## 交付内容

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 后端 | `src-tauri/src/career.rs` | SQLite 生涯库（profile / game / move / opponent_progress / achievement + meta 版本号），对照 `opening_book.rs` 的写法 |
| 后端 | `src-tauri/src/lib.rs` | `get_career_db_path`、`open_career_store` 与 10 个命令 |
| 前端 | `src/composables/useCareer.ts` | 档案、统计、存局；段位名由前端从分数推导 |
| 前端 | `src/composables/useCareerOpponents.ts` | 12 关阶梯 + 风格参数包 + 选着函数 |
| 前端 | `src/composables/useCareerEngineOptions.ts` | 对局级 UCI 选项覆盖（快照 → 覆盖 → 还原） |
| 前端 | `src/composables/useCareerMatch.ts` | 单场赛事状态机 + 防刷分守卫 |
| 界面 | `src/components/career/{CareerView,OpponentCard,PostGameReport}.vue` | 生涯主页/阶梯/战绩/说明 + 赛后报告 |
| 接线 | `App.vue`、`MainDrawer.vue`、`AnalysisSidebar.vue`、`utils/xqf.ts` | 入口、走子钩子、开局库深度限制、随机种子注入 |
| 文案 | `i18n/locales/{zh_cn,en}.ts` | `career` 命名空间 |

## 验证情况

| 检查 | 结果 |
| --- | --- |
| `cargo test`（生涯数据层） | **15 项全通过** — 默认分段、爆冷加分、短局不计分、重复对手阻尼、首通奖励的触发与封顶、首通只给一次、败局不给奖励、历史顺序、对手通关记录、逐手明细入库、清档 |
| Rust 类型检查 | 通过（把 `career.rs` 单独拉进一个只依赖 rusqlite/serde/chrono 的工程做 `cargo check --all-targets`，零警告） |
| 阶梯行为模拟 | 见下节。发现并修正了一处设计缺陷 |
| `vue-tsc --noEmit` | 通过 |
| `vite build` | 通过 |
| `cargo clippy -D warnings` | **未能在本地跑** — Alpine 无 clippy 包。已按已知 lint 逐条修正（`map_unwrap_or` → `is_some_and`、嵌套 `if let` 合并、删除常量断言测试、清理未使用 import / 变量） |

## 评级设计的一次修正（实测发现）

`cargo test` 全绿并不能说明评级系统是对的——它只能证明代码按我写的规则执行。所以另写了一个模拟（`docs/ladder_simulation.rs`，把玩家的"真实水平"设为已知值，按 Elo 期望胜率随机生成胜负，跑完整个阶梯），然后读曲线。

**第一次跑就暴露了问题：**

| 真实水平 | 打完 12 关后的分数 | 结论 |
| --- | --- | --- |
| 2400 | 1876 | 严重低估 |
| 1600 | 1429 | 低估 |
| 1050 | 1266 | 基本合理 |

原因很直接：**纯 Elo 配关卡制是错配的**。赢下 800 分的学棋童子，对一个 1200 分的玩家来说期望胜率是 0.91，按 Elo 只值 +4 分——这个数字作为棋力估计完全正确，作为"我刚赢了一局"的反馈则毫无意义。而关卡只会越来越强，所以玩家的分数整局生涯都在追赶自己的真实水平。

**修正：引入首通奖励。**

```rust
fn first_clear_bonus(player: i32, opponent: i32) -> i32 {
    let headroom = (opponent - player).max(0) as f64;
    (18.0 + headroom * 0.45).min(100.0) as i32
}
```

期望值决定棋力分，进度另给一笔奖金，两者在赛后报告里**分开显示**——玩家能看见"这 100 分不是你下出来的，是你过关给的"。奖金随"关卡高出你多少"缩放，所以第一次打赢一个远弱于你的对手，依然只给 18 分。

**修正后：**

| 真实水平 | 打完 12 关后的分数 | 偏差 |
| --- | --- | --- |
| 2400 | 2359 | −41 |
| 1600 | 1848 | +248 |
| 1050 | 1485 | +435 |
| 1600（只刷第 1 关 12 局） | 1241 | 防刷分有效：12 连胜只值 +41 |

- 高段玩家（系统最需要服务的一群人）误差落在 41 分内，不再"卡住"。
- 中段 +248 偏高，但他是真的赢下了 1850 和 2000 的对手（24 局 12 胜），分数反映的是他的实际战绩。
- 低段 +435 仍偏大，来源是 36 局的小样本加上几次爆冷拿到封顶奖励。要压下去只能把奖金砍到对高段玩家又不够用的程度——**这是一个取舍，不是可以同时满足的目标**。

> 这些数字是模型，不是真人。对手分数的锚点（800…2600）需要一轮真人测试来定标；届时改动 `CAREER_OPPONENTS` 的 `rating` 与上面的两个常数即可，模拟脚本可以直接重跑。

## 与设计的偏差（如实记录）

1. **引擎不再自动加载。** 设计里写了"未加载时自动拉起来"，实现时改成**拒绝开局并提示**。`loadEngine(engine: ManagedEngine)` 需要完整引擎对象，而引擎选择归侧栏所有；强行在这里加载会把引擎列表的职责复制一份。
2. **`luckIndex` 暂时写 `null`。** ONNX 运气模型接在 `AnalysisSidebar` 内部，M2 才做抽取。字段和表都已就位，不用改库。
3. **棋谱未归档。** `game.xqf_path` 字段已留，M1 只存首末 FEN。避免一次改动同时碰文件对话框与 SAF。
4. **只有胜负，没有和棋。** 沿用现有规则引擎的终局判定（仅"无合法着法"）。赛制里的和棋、超时、认输属于 M3。
5. **其他 10 种语言没写文案**，走 `zh_cn` fallback（`i18n/index.ts` 的 `fallbackLocale` 正是 `zh_cn`）。
6. **对手分数是设计值，未做校准赛。** 即 §6.8 提到的那件事，需要一轮引擎对打才能定标。

## 关键实现决策

**难度在哪生效：只有一处。**
`AnalysisSidebar` 的 `watch(bestMove, …)` 里，在提交着法之前问一次 `getCareerMovePicker()`。引擎照常看到整个局面、照常算出最优着，我们只是有时不采纳它。另有 `isBookAllowedForCareer()` 限制开局库深度。两处钩子，各一行判断，没有 career 模式时行为与改动前完全一致。

**为什么不用 UCI_Elo 当主手段。**
`buildOpponentOverrides` 会把 `UCI_Elo` / `Skill Level` 一并下发，但仅在引擎**自己声明**了这些选项时；且 `candidateWidth` 与 `pickTopProbability` 才是主旋钮。揭棋暗子对引擎不可见，把强度调低的引擎会走出没有理由的着法——玩家看到的是坏掉的 AI，不是强敌。

**对局级选项覆盖不写配置。**
`UciOptionsDialog` 写的是玩家偏好（per-engine、持久化）。覆盖层只做"快照 → 下发 → 赛后还原"，且记账的只有被改过的那几项。引擎中途被换掉时 `engineId` 不匹配即丢弃快照，避免把 A 引擎的偏好写到 B 上。

**种子已经是真的。**
`utils/xqf.ts` 新增 `setBoardRngSeed()` / `getBoardRngSeed()`，把原本"按时间播种"的模块级 Mersenne Twister 变成可注入。对局开始时播种并记录，因此 M2 的运气重采样有据可依。默认路径（不调用）行为不变。

**防刷分做了三层。**
① 重复对手 24h 内 3 局后收益 ×0.5、7 局后 ×0.25，由 Rust 端按历史统计；
② 少于 10 手不计分；
③ 玩家把自己的走子权交给引擎（`useAutoPlay` 的开关）或中途悔棋，本局标记为不计分——但**仍然入库**，隐藏它比记录它更糟。

**赛后报告取代原生结束对话框。**
生涯模式下 `GameEndDialog` 不渲染，改由 `PostGameReport` 一次给出胜负 + 分数变化。同时 `settle()` 会清掉 `isGameEndDialogVisible`，否则那个标志会留到下一局才炸。

## M2 的入口已经留好

- `game.fen_seed` — 用于重放与运气重采样
- `move` 表（`engine_score` / `eval_drop` / `quality` / `time_ms`）— 逐手分析，现在就开始写，早期对局不至于缺数据
- `game.acpl` / `blunders` / `mistakes` / `inaccuracies` — 字段已建
- `useCareerEngineOptions.ts` 的 `aggression` — 候选着法打分的偏置位，M2 接
