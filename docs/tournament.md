# 引擎联赛（Engine Tournament）

让两个（或多个）引擎互相对局，自动排出赛程、记录每局、算出积分榜。

## 为什么这样切分职责

| 归 Rust（`src-tauri/src/tournament.rs`） | 归 TypeScript（`src/composables/useTournamentRunner.ts`） |
| --- | --- |
| 赛程：谁和谁、下几局、谁执红 | 真的把棋下出来 |
| 每局的暗子种子 | 判断为什么结束（将死 / 困毙 / 超时 / 非法招） |
| 哪一局是"下一局" | 引擎进程的启动、握手、超时 |
| 积分与等级分 | 把结果回报给 Rust |

理由是三条必须有唯一答案的东西：**可复现、可续跑、可核对**。
赛程和评级只要有两处实现，崩溃一次就会互相对不上；而"这步棋合不合法"必须只有棋规说了算。

## 三个关键设计

### 1. 种子，而且成对

揭棋同一局面会走出不同的棋——暗子身份是抽的。所以：

- 每局都带一个 `seed`，由 `master seed + 组号 + 对子序号` 经 SplitMix64 派生，重启后完全一致。
- **一对互换先后的对局共用同一个种子**，两局之间唯一的差别就是谁执红。
- 种子记进数据库，导出时一起带走；没有它，"这局到底是不是运气"永远说不清。

### 2. 赛程一次排完，认领制

创建联赛时就把全部对局写进 `tournament_game` 表（`pending`）。
运行器每局先 `plan_next`——它会把该局标记为 `running` 再返回，所以：

- 中途被杀，`migrate()` 在下次打开数据库时把 `running` 退回 `pending`，那一局照原样重下，不会漏也不会重。
- 暂停不是结果：退回队列（`tournament_release_game`），而不是记一个"平局"。
- 联赛可以跨越几天，从第 37 局接着下。

### 3. 等级分用 Bradley–Terry，不用 Elo

Elo 是顺序更新的，多引擎循环赛里结果会依赖"谁先下"；联赛正好是这个场景。
BT 用全部对局一次性拟合每人一个强度，并且**每次查询从对局表重算**，不存字段——
存下来的分数在第一次作废对局或还原备份之后就会开始说谎。

实现是 MM 迭代（400 轮，容差 1e-10），最后把全场的几何均值钉在 1500：

- 分数是相对的：跨联赛比较没有意义。
- 不足 4 局的选手标 `provisional`，界面不该给出精确数字。
- 和棋按每人 0.5 计，`void` 对局完全不进评级，但仍占据赛程位置。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `tournament_create` | 校验并创建联赛，一次排完全部赛程 |
| `tournament_list` / `tournament_get` | 列表 / 详情（含参赛引擎） |
| `tournament_next_game` | 认领下一局（`null` 表示已排完） |
| `tournament_release_game` | 把认领的局退回队列 |
| `tournament_record_game` | 记录结果（`void: true` 表示作废） |
| `tournament_games` / `tournament_standings` | 对局列表 / 积分榜 |
| `tournament_set_status` | `draft` / `running` / `paused` / `finished` |
| `tournament_reset_running` | 把在飞的局退回队列 |
| `tournament_export` / `tournament_delete` | 导出 JSON / 删除（需 `confirm: "DELETE"`） |

数据库独立于生涯模式：`jieqi_tournament.db`，与 `jieqi_career.db` 分开，
一个可以随便删的联赛不该有机会带走玩家的生涯记录。

## 引擎多实例

联赛要两个引擎同时活着，所以 Rust 侧的进程句柄从"一个 `Option<CommandChild>`"
改成了按 slot 索引的 `HashMap`：

- `spawn_engine` / `send_to_engine` / `kill_engine` 都多了可选的 `engineId`。
- 不传 `engineId` 就是原来的默认 slot，**语义完全不变**（spawn 会顶掉旧进程），
  所以已有的分析侧栏、JAI 引擎等调用点一行都不用改。
- 输出事件按实例分开：默认 slot 继续发 `engine-output`，
  具名实例发 `engine-output:<slot>`，两个引擎的日志不会串台。

每个参赛条目一个 slot（`tournament-<entryId>`），所以同名不同版本的引擎也能同场竞技。

## 已知缺口（下一步）

1. **前台服务未做**。这个包目前靠 targetSdk 28 的历史豁免活着，长联赛仍有被系统杀掉的
   风险。要做的是 `FOREGROUND_SERVICE` + 常驻通知，联赛本体已经全在 Rust 侧，
   WebView 只订阅事件，所以改造面不大。
2. **开局库未接**。`openingPlies` 已经存进数据库并下发，但运行器还没用它去
   `opening_book_query_moves` 取随机开局——现在每局的差异只来自暗子抽取。
3. **和棋规则不完整**。棋规层没有重复局面检测，运行器用 300 手封顶判和。
   两端都该补：棋规层的重复判定，以及运行器读 FEN 里的 60 回合计数。
4. **崩溃只能算超时**。引擎进程异常退出时，Rust 侧没有把 `CommandEvent::Terminated`
   转成事件，运行器只能等到超时。补上终止事件就能把 `crash` 和 `timeout` 分开记。
5. **i18n 不全**。只补了 en / zh_cn / zh_tw，其余 9 个语言会回落到默认语言；
   运行器日志是中文硬编码的，也应当改走 i18n。
6. **联赛跑在正式棋盘上**，会覆盖当前对局状态（和生涯模式一样），
   运行期间也没有锁住手动操作。
7. **前台服务/并发**：目前是串行单局制（一局下完再下一局），没有做多局并行，
   手机上两个引擎已经是散热临界点。

## 测试

赛程、种子、续跑与评级有 9 个单元测试，跟 `tournament.rs` 放在一起：

```bash
# 仅这个模块（不需要 Tauri、不需要 NDK）
cargo test
```

Tauri 应用本体在本机编译不了（Android 需要 NDK，Linux 需要 webkit2gtk），
所以这个 store 刻意不依赖 Tauri——上面那 9 个测试就是这么跑起来的。
