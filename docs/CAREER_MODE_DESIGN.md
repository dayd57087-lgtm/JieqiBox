# 揭棋生涯模式（Career Mode）设计文档

> 面向 JieqiBox v0.8.0（Tauri 2 + Vue 3 + TS + Vuetify 3）
> 目标：给这个"棋力工具"加一条**单人成长主线**，让玩家有"我在变强"的实感。
>
> **M1 已实现**，落地情况、实测数据与设计偏差见 [CAREER_M1_STATUS.md](./CAREER_M1_STATUS.md)。

---

## 0. 先说立场（我的取舍）

**不要做成就系统大杂烩。** 生涯模式的成败不在"有多少个徽章"，而在一条闭环：

```
选对手 → 打一局 → 自动记录 → 段位/评价变化 → 看到自己哪里变强/变弱 → 想再打一局
```

所以三个支柱，缺一不可：

| 支柱 | 作用 | 本项目已有基础 |
| --- | --- | --- |
| **拟人对手** | 让对手"有身份"，玩家才有代入感 | 无（现在只有"红/黑电脑"开关） |
| **持久化档案 + 评级** | 进度可见、可累积 | rusqlite 已在用；`eloCalculator.ts` 只有一次性估算 |
| **赛后数据拆解** | 让"变强"可测量、可归因 | `engineScore` 逐手已记录；`luckIndex` ONNX 模型已存在 |

第三个支柱是这个项目**别人抄不走的优势**：揭棋是暗子随机游戏，几乎所有象棋软件都只谈实力分。这里已经有一个用翻子序列预测胜率的 ONNX 小模型（`AnalysisSidebar.vue` 里的 `luckIndex`），把它接到生涯统计上，就能做出**"实力分 vs 运气分"双向拆解**——这是揭棋生涯模式最该有的差异化功能。

---

## 1. 现状盘点（代码层面的事实）

### 已经有的、可以直接复用的

| 能力 | 位置 | 生涯模式怎么用 |
| --- | --- | --- |
| 规则引擎 + 终局判定 | `useChessGame.ts`（3457 行） | 对局生命周期必须挂它的终局点，**绝不重写规则** |
| 终局状态导出 | `isGameEndDialogVisible` / `gameEndResult` / `setupNewGame` / `playMoveFromUci` | 单场赛事的开始/结束钩子 |
| UCI 引擎管理 | `useUciEngine.ts`（`setoption` 已支持） | 对局级难度注入 |
| 自动走子 | `useAutoPlay.ts` + `AnalysisSidebar` | 引擎方走子，赛事循环直接复用 |
| 引擎 vs 引擎赛 | `useJaiEngine.ts`（matchWins/Losses/Draws 已有） | **校准对手基准分**（见 §6.8） |
| Elo 计算 | `utils/eloCalculator.ts` | 表现分估算与置信区间可复用，但**缺增量评级** |
| 开局库（SQLite） | `src-tauri/src/opening_book.rs` + `jieqi_openings.jb` | 给每个对手配开局库；schema 里 `wins/draws/losses` 目前没人写 |
| 棋谱读写 | `utils/xqf.ts`、`save_game_notation`、`Autosave.json` | 每局自动归档、赛季打包导出 |
| 逐手评估分 | `HistoryEntry.engineScore / engineTime / comment` | 赛后 ACPL / 失误分级 |
| 复盘 | `ReviewAnalysisDialog.vue` | "关键手"一键跳到复盘 |
| 运气指数 | `AnalysisSidebar.luckIndex`（ONNX + 翻子序列特征） | 实力/运气拆解 |
| 持久化 | `rusqlite`（bundled）+ `app_internal_files_dir()` | 生涯库直接照 `get_opening_book_db_path()` 抄 |
| 棋风/外观 | `interfaceSettings.pieceStyle`、`useSoundEffects` | 解锁奖励的落点 |
| i18n | 12 种语言（zh_cn/zh_tw/en/ja/ko/vi/th/ms/de/fr/es/ru） | 新开 `career` 命名空间 |
| 手机端 UI 骨架 | `MainDrawer.vue`（分组入口）+ `workbench.scss` | 生涯入口放抽屉，别做桌面式多窗口 |

### 缺的（这就是工作量所在）

1. **没有玩家身份**：配置只有 `humanVsAiSettings: {isHumanVsAiMode, aiSide, showEngineAnalysis}`。没有昵称、没有分段、没有历史对局。
2. **没有对局记录**：打完一局，除了 `Autosave.json` 里当前那盘，什么都不留。`Autosave.json` 会被下一局覆盖。
3. **没有难度阶梯**：`UciOptionsDialog` 是**全局 per-engine** 的设置，改一次影响所有对局。做不了"这盘打 1200 分的对手，下盘打 2000 分的"。
4. **评级只有一次性估算**：`calculateEloRating(wins, losses, draws)` 是赛后手算表现分，不是增量积分。
5. **没有题库/关卡**。

---

## 2. 数据模型

新建 `career.db`（SQLite，Rust 侧 `career.rs` 仿 `opening_book.rs`）：

```sql
-- schema 版本，用于迁移
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE profile (
  id           INTEGER PRIMARY KEY CHECK (id = 1),  -- 单人生涯
  nickname     TEXT NOT NULL DEFAULT '棋手',
  avatar       TEXT NOT NULL DEFAULT 'reva',
  rating       INTEGER NOT NULL DEFAULT 1200,
  peak_rating  INTEGER NOT NULL DEFAULT 1200,
  dan          TEXT NOT NULL DEFAULT '业余1级',      -- 段位称号
  created_at   INTEGER NOT NULL,
  coins        INTEGER NOT NULL DEFAULT 0           -- 赛季奖金/货币
);

CREATE TABLE opponent (
  id           TEXT PRIMARY KEY,     -- 'reva', 'liu_shifu', ...
  name_key     TEXT NOT NULL,        -- i18n key，避免硬编码中文
  rating       INTEGER NOT NULL,
  tier         INTEGER NOT NULL,     -- 阶梯层级
  style        TEXT NOT NULL,        -- JSON: 难度参数包（见 §3.B）
  book_id      TEXT,                 -- 关联开局库
  bio_key      TEXT,
  taunt_keys   TEXT,                 -- JSON 数组：赛前/赛中/赛后台词
  unlocked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE game (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  opponent_id    TEXT NOT NULL,
  season_id      INTEGER,
  round_no       INTEGER,
  format         TEXT NOT NULL DEFAULT 'standard',  -- standard|blitz|bullet|handicap|blind
  human_side     TEXT NOT NULL,      -- 'red' | 'black'
  result         TEXT NOT NULL,      -- 'win' | 'loss' | 'draw'
  moves          INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL,
  rating_before  INTEGER,
  rating_after   INTEGER,
  rating_delta   INTEGER,
  luck_index     INTEGER,            -- -100..100，复用现有模型
  acpl           REAL,               -- 赛后分析填充
  blunders       INTEGER,
  mistakes       INTEGER,
  inaccuracies   INTEGER,
  fen_seed       INTEGER,            -- ★ 揭棋翻子序列种子，见 §6.3
  initial_fen    TEXT NOT NULL,
  xqf_path       TEXT,               -- 归档棋谱
  final_fen      TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE move (
  game_id        INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  ply            INTEGER NOT NULL,
  uci            TEXT NOT NULL,
  fen            TEXT NOT NULL,
  engine_score   REAL,
  eval_drop      REAL,               -- 相对上一手的分差，用于分级
  quality        TEXT,               -- best|good|inaccuracy|mistake|blunder
  time_ms        INTEGER,
  PRIMARY KEY (game_id, ply)
);

CREATE TABLE season (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  no          INTEGER NOT NULL,
  name_key    TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  final_rank  INTEGER,
  result      TEXT,                  -- promoted|stayed|relegated|champion
  rewards     TEXT
);

CREATE TABLE achievement (
  id          TEXT PRIMARY KEY,
  unlocked_at INTEGER,
  progress    INTEGER DEFAULT 0
);

CREATE TABLE puzzle (
  id          TEXT PRIMARY KEY,
  fen         TEXT NOT NULL,
  seed        INTEGER,               -- ★ 揭棋必备
  goal        TEXT NOT NULL,         -- 'mate_in_n' | 'win_material' | 'draw' | 'survive'
  solution    TEXT,                  -- JSON 数组，UCI 序列
  difficulty  INTEGER,
  tags        TEXT
);

CREATE TABLE puzzle_progress (
  puzzle_id   TEXT PRIMARY KEY REFERENCES puzzle(id),
  stars       INTEGER DEFAULT 0,
  attempts    INTEGER DEFAULT 0,
  solved_at   INTEGER
);
```

**路径**：桌面放配置同目录，Android 放 `app_internal_files_dir(app)`——直接照抄 `get_opening_book_db_path()` 的写法，别自己发明。

---

## 3. 功能模块

### A. 玩家档案与段位

- 生涯主页：头像（默认用 `reva.png` 吉祥物）、昵称、**当前分 + 段位**、赛季进度条、最近 5 局结果条、连续在玩天数。
- 段位映射（可配置，示例）：
  `学棋(<800)` → `业余1级~3级(800~1100)` → `业余初段~三段(1100~1400)` → `业余高手(1400~1700)` → `市冠(1700~1900)` → `省冠(1900~2100)` → `大师(2100~2300)` → `特大(2300~2500)` → `宗师(2500+)`
- **段位要有"分省/分市"的叙事包装**，纯数字 Elo 对休闲玩家没有情绪价值。
- 存档导出/导入（JSON 或直接拷 `career.db`），照 `opening_book_export_db/import_db` 的模式做。

### B. 对手体系（生涯模式的心脏）

对手不是"一个 Skill Level 数字"，而是一张卡：

```ts
interface CareerOpponent {
  id: string
  nameKey: string          // 不许硬编码中文
  rating: number
  title: string            // 称号：'街头棋王'
  avatar: string
  bioKey: string
  tauntKeys: { before: string[]; during: string[]; after: string[] }
  style: {
    openingBookDepth: number   // 只在前 N 手用库，之后自由发挥
    candidateWidth: number     // MultiPV 候选集宽度
    pickTopProbability: number // 以多大概率选最优着（其余从候选中随机）
    blunderRate: number        // 主动走次优的概率（拟人化核心）
    thinkTimeMs: [number, number]  // 思考时间区间，模拟"犹豫"
    aggression: number         // 吃子/将军倾向偏置
    exchangeTolerance: number  // 兑子偏好
  }
}
```

**难度阶梯示例（12 关，教学 → 终局）**

| # | 对手 | 分 | 特征 |
| --- | --- | --- | --- |
| 1 | 学棋童子 | 800 | 开局库 4 手，blunderRate 0.35 |
| 2 | 邻家小孩 | 950 | 爱抢子，aggression 高 |
| 3 | 公园常客 | 1100 | 稳，思考慢 |
| 4 | **Reva 酱（吉祥物）** | 1250 | 会聊天、会吐槽；教学关的收尾 |
| 5 | 街道棋摊老板 | 1400 | 开局库深，中局掉链子 |
| 6 | 网络快棋王 | 1550 | 快棋赛制限定 |
| 7 | 市赛八强 | 1700 | 少失误 |
| 8 | 市冠军 | 1850 | 开局库 12 手 |
| 9 | 省队陪练 | 2000 | 残局强 |
| 10 | 职业棋手 | 2150 | 全库 + 低 blunder |
| 11 | 特级大师 | 2350 | 顶配引擎，思考时长拉满 |
| 12 | 揭棋之神 | 2550+ | 不败设定，赢下解锁终局奖励 |

- **解锁条件**：赢下当前关 + 达到分数门槛。允许跳级（给高手一个"直接打第 8 关"的口子，但奖励递减）。
- **对手风格落地**：优先用 `opening_book.rs` 的库（支持 priority、allow/disallow），再叠 `candidateWidth + blunderRate`。这样对手之间真的**下得不一样**，不是同一个引擎换参数。

> **重要判断**：难度**不能**主要依赖 UCI `Skill Level` / `UCI_Elo`。揭棋的暗子对引擎是不可见的，低 Skill 的引擎会因为"看不透暗子"而走出看起来毫无理由的着法——**不是弱，是傻**，玩家感受到的是"这个 AI 坏了"而不是"这关很难"。所以难度四件套应该是：**开局库限制 + 候选集随机化 + blunder 概率 + 思考时间**，UCI_Elo 只当兜底。

### C. 赛制与赛季（进度结构）

三层，从轻到重：

1. **单场挑战**：随时打一关，影响小分。
2. **联赛（赛季主线）**：每赛季 12 轮，每轮一个对手，双循环/单循环。赛季结束按排名**升级/保级/降级**，给奖金与解锁。
3. **杯赛/总决赛**：淘汰制，单败，高倍分数；一年一次，赢下给永久称号与专属棋盘。

**赛制修饰符**（复用现有 `TimeDialog` 的时间控制）：

| 赛制 | 规则 | 目的 |
| --- | --- | --- |
| 标准 | 慢棋，可长考 | 默认 |
| 快棋 | 15+10 / 5+3 | 逼出直觉失误，数据更真实 |
| 超快棋 | 3+2 | 高方差，适合娱乐 |
| 让子局 | 对手少一枚大子 | 高手玩家用来自我设限 |
| **盲翻局** | 隐藏已翻子的身份提示 | 揭棋特色，考记忆 |
| 残局局 | 从固定局面开打 | 直接联动题库 |

- 赛季结算要有**仪式感**：结算动画/文本、升降级台词、Reva 的赛后评论、赛季最佳对局回放。
- **防无限刷分**：同一对手连续重复对局，分数收益递减（第 4 次起 ×0.5，第 8 次起 0）；认输/重开不计入；少于 10 手结束的对局标记为"无效"。

### D. 赛后数据与弱点画像（差异化重点）

每局结束自动做（在引擎还活着时做，别反复加载引擎）：

1. **准确率/ACPL**：复用 `HistoryEntry.engineScore` 逐手分差 → 按阈值分 `inaccuracy / mistake / blunder`。
2. **关键时刻**：列出失分最大的 3 手，一键跳到 `ReviewAnalysisDialog` 并定位到该手。
3. **运气/实力拆解**（揭棋专属）：
   - 用现有 `luckIndex` 模型算本局翻子的"理论胜率偏移"。
   - 更狠一点：把本局翻子序列重采样 N 次（同一批走子、不同暗子），统计胜率分布 → 得到 **"这局的运气占比"** 与 **"扣除运气后的表现分"**。
   - 展示："本局运气 -18（偏差），你的实际发挥相当于 1680 分段。"
4. **弱点画像**：
   - 开局前 10 手平均失分（对比同分段基准）
   - 最后 10 手（残局/收束）平均失分
   - 被将军时的应对评分
   - 暗子翻开后的胜率（翻到己方有利棋子 vs 不利棋子）
   - 各类棋子（车/炮/马/兵）使用效率
   - → 生成一句人话建议："你的开局很稳，但第 25~40 手换子判断偏保守，建议练 3 个中局题库。"
5. **生涯曲线**：分数走势、按月棋力、对每个对手的胜率热力表、连胜/连败记录、最长对局、最高翻子运气局。

### E. 残局闯关 / 每日一题

- 出题：用现有 `PositionEditorDialog.vue`（1977 行，能力已足够）加一个"**存为关卡**"按钮。
- 关卡元数据：目标（N 步杀 / 得子 / 求和 / 撑过 N 手）、步数上限、时限。
- 进度：星级（3 星 = 最优解）、连击、每日一题（当天固定题，全服同一题）。
- 与生涯联动：闯关给少量分数与解锁币。

> **揭棋出题的大坑**：暗子身份是随机抽的，同一个 FEN 两次打开局面完全不同，题目**不可复现**。
> 解法只有两条，必须选一条：
> 1. **固定种子**：把翻子序列的 RNG 种子写进题目（`puzzle.seed`）和对局（`game.fen_seed`）。项目里已经有 `mersenne-twister` 依赖（`xqf.ts` 在用），扩展成可注入种子的模块即可。
> 2. **出题固定为"自由翻子"模式**（`flipMode: 'free'`，现有 `useGameSettings` 已支持），题目里直接写明每枚暗子的身份。
>
> 我倾向 **两条都做**：题库用 free 模式出"教学/残局"题，对局记录用 seed 让生涯模式里能"重放同一局运气"。

### F. 成就、解锁、吉祥物剧情

- **成就**（示例，别做 100 个）：首胜、五连胜、以少胜多、翻盘（评分 −300 后翻回来）、10 手内取胜、不悔棋通关一整个赛季、连续 30 天训练、同一局运气 −50 仍然赢、赢下 Reva 酱。
- **解锁**：棋盘材质、棋子风格（`pieceStyle` 机制已存在）、音效包（`useSoundEffects`）、Reva 的头像/立绘/剧情片段。
- **吉祥物互动**：赛前/赛后 Reva 台词（`taunt_keys` 同机制）——这块是情绪价值，成本低收益高。要出声可以接系统 TTS（Android 端已有 `android-speak`）。

---

## 4. 代码集成点（改造清单）

### Rust 侧

新增 `src-tauri/src/career.rs`，结构完全对照 `opening_book.rs`（`JieqiOpeningBook` → `CareerStore`），
用 `Arc<Mutex<>>` 托管连接，注册到 `lib.rs` 的 `invoke_handler`：

```
career_open              career_get_profile      career_update_profile
career_list_opponents    career_unlock_opponent  career_save_game
career_list_games        career_get_game         career_get_stats
career_rating_history    career_achievements     career_puzzle_list
career_puzzle_submit     career_season_current   career_season_finish
career_export_save       career_import_save
```

### 前端侧

```
src/composables/useCareer.ts          # 档案/统计的响应式状态 + invoke 封装
src/composables/useCareerMatch.ts      # 单场赛事生命周期（核心）
src/composables/useCareerOpponents.ts  # 对手定义、解锁、风格参数 → UCI 注入
src/composables/useCareerAnalysis.ts   # 赛后逐手分析（ACPL/失误/关键手）
src/composables/useCareerPuzzles.ts
src/views/CareerView.vue               # 生涯总视图（手机优先）
src/components/career/CareerHome.vue
src/components/career/OpponentCard.vue
src/components/career/LadderView.vue
src/components/career/SeasonView.vue
src/components/career/PostGameReport.vue   # 赛后报告：准确率/运气/关键手
src/components/career/StatsDashboard.vue   # 曲线 + 热力表
src/components/career/PuzzleBoard.vue
```

### 必须改的现有文件

| 文件 | 改动 |
| --- | --- |
| `src/components/MainDrawer.vue` | 新增 `drawer.groupCareer` 分组，加"生涯模式"入口（图标用现成的 `ICON.tournament`/`ICON.human` 风格） |
| `src/App.vue` | 主视图 ↔ 生涯视图切换（用 `ref` 控制即可，别引 vue-router） |
| `src/composables/useChessGame.ts` | 在终局点（`isGameEndDialogVisible` 置位处）发一个可订阅事件；`setupNewGame` 支持传入 `seed` 与初始局面 |
| `src/composables/useUciEngine.ts` | ★ **新增"对局级 UCI options override"**：记录旧值 → 应用对手参数 → 赛后恢复。当前全局 `uciOptions` 与赛后恢复冲突，这是最大的一处改造 |
| `src/i18n/locales/*.ts` × 12 | 新增 `career` 命名空间（中文两份必须先写，其余至少给 en，缺失走 fallback） |
| `src/components/GameEndDialog.vue` | 人机模式下扩展为"赛后报告"入口 |

### `useCareerMatch` 的状态机

```
idle
 → preparing     (应用对手 style：UCI options override + 开局库切换 + 时间控制 + 种子)
 → playing       (human/engine 交替；复用 useAutoPlay 的引擎走子)
 → finishing     (终局判定：胜/负/和/超时/认输)
 → analyzing     (引擎存活时跑逐手分析，写 move 表)
 → settling      (Elo 增量更新、成就检查、赛季进度、解锁)
 → report        (PostGameReport 展示 + 归档 XQF)
 → idle
```

---

## 5. 里程碑

| 里程碑 | 范围 | 估时 | 可玩性 |
| --- | --- | --- | --- |
| **M1 最小闭环** | `career.db` + profile + 8 个阶梯对手 + 单场挑战 + 结果入库 + 增量评级 + 生涯主页（战绩/曲线） | 1~2 周 | 能玩了，但还"薄" |
| **M2 深度** | 赛后逐手分析（ACPL/失误/关键手跳复盘）+ 运气拆解 + 弱点画像 | 1~1.5 周 | **这是留存关键**，做完才有"变强感" |
| **M3 赛制** | 联赛赛季 + 升降级 + 杯赛 + 赛制修饰符 + 赛季结算 | 1.5~2 周 | 长期目标线成立 |
| **M4 内容** | 残局闯关 + 每日一题 + 编辑器存关 + 成就/解锁 | 2 周 | 内容量 |
| **M5 情绪** | Reva 台词/剧情、赛后仪式感、奖励外观、存档导出 | 1 周 | 包装 |

**我会先做 M1，而且只做 M1。** 但 M1 里必须预留两件事，否则后面要返工：
1. `career.db` 的 `move` 表与 `game.fen_seed` 字段（M2 需要，先建表）；
2. `useUciEngine` 的对局级 options override（M3 的赛制全依赖它）。

---

## 6. 风险与坑（照这些踩过再动手）

1. **难度 ≠ UCI_Elo**（见 §3.B）。这是最容易做砸的一点，也是"AI 打起来都一个味"的根因。
2. **全局 `uciOptions` 与对局级配置冲突**。现在 `setoption` 改的是引擎全局状态，赛制里"这盘打简单、下盘打强"会互相污染。必须做成"进入对局前 push 覆盖、赛后 pop 恢复"，并处理引擎中途崩溃导致的脏状态。
3. **揭棋随机性 → 一切不可复现**。种子必须显式落库，否则"重放同一局""题目可解""运气统计"全部做不了。`mersenne-twister` 已在依赖里，扩展成可注入种子即可。
4. **手机端优先**。`src-tauri/gen/android` 说明这项目要跑安卓。生涯界面必须竖屏 + 单列 + 大触控目标 + 走 `MainDrawer` 分支，**不要做桌面式多窗口面板**（虽然 `DraggablePanel.vue` 在，但手机上拖拽面板体验很差）。
5. **绝不重写规则**。所有合法走子/终局判定一律走 `useChessGame.ts`。它是 3457 行、含大量揭棋特例（暗子池、捕捉未翻子、翻子策略），重写必错。
6. **DB schema 迁移**。`meta` 表存 `schema_version`，启动时按版本升级。别指望"删库重来"，玩家的生涯数据比什么都重要。
7. **防刷分**：重复对手收益递减、秒退/认输不记、超短对局无效、重开不计负。还有一个隐蔽的：**用"引擎自动走子"替玩家打**（`useAutoPlay` 现成存在）——生涯模式里检测到玩家侧开了 AI，该局标记为"非人工"并只记胜率不记分。
8. **对手基准分从哪来**？引擎真实水平未知。用现有 match 模式（`useJaiEngine` 已有 WLD 统计）跑一轮**校准赛**：固定节点数下让各参数包对打，得出相对分差，再锚定到人类分段。开局库/权重可以随版本更新重跑。
9. **i18n 12 语言**。新文案只写中文会被其他 10 个语言的使用者看到中文。折中：`career` 命名空间先完整出 zh_cn/zh_tw/en，其余语言走 fallback 并在文件顶部标注 `TODO: translate`。
10. **性能**。逐手分析要在引擎还活着时批量跑（一次 `go` 遍历所有局面），不要每手重启引擎；移动端尤其要注意，Android 上引擎进程重启成本高。
11. **`Autosave.json` 会被覆盖**。生涯模式的"继续上局"要读 `career.db` 里最新的未完成记录，不能依赖 autosave。

---

## 7. 一句话总结

**M1 做"对手阶梯 + 持久评级 + 生涯主页"这条主线；M2 立刻跟上"赛后拆解"，其中揭棋特有的"实力/运气分离"是这个项目最值得雪藏的一张牌——它让生涯模式不只是"我和 AI 下棋的记录本"，而是"我看得见自己在揭棋这个运气游戏里到底有多强"。**
