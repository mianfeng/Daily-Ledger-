# Daily Ledger 全量 UI 与组件功能重构交接规范 (Codex Execution Spec v2.1)

> **适用代码基线**：`bf84e20` (`main`)
> **选定视觉主题**：**配色 B · 竹青宣纸（Kyoto Washi Paper）** —— 轻盈雅致宣纸白底（`#F9F8F6`）+ 纯白卡片（`#FFFFFF`）+ 竹青生活强调色（`#1F5E4B`）+ 赤陶生意强调色（`#B4532A`）+ `1px` 精细描边与现代瑞士网格排版。
> **核心原则**：100% 保留 `current-ui-manifest.json` 中的全部业务契约（`businessContracts`）与计算函数（`lib/daily.ts`、`lib/copper.ts`、`lib/appData.ts`），仅重构视觉 Token、信息架构层级以及 6 个核心交互组件。

---

## 一、给 AI Codex 的一键启动指令（复制此段作为对话首句）

```text
请读取项目中的 `codex-refactor-spec.md` 与 `redesign-ui-manifest.json`（结合现有的 `current-ui-manifest.json` 业务契约），按以下 4 个阶段执行 UI 与组件功能重构，不要破坏 `lib/daily.ts`、`lib/copper.ts` 和 `lib/appData.ts` 的任何账目计算与存储结构：
1. 第一阶段：更新 `index.css`，替换为「配色 B：竹青宣纸（Kyoto Washi）」亮/暗色 Token，移除厚重的拟物凹凸阴影（sunken/raise），统一改为 20px 圆角卡片与 1px 精细边框。
2. 第二阶段：重构 `components/ui/Ui.tsx` 与 `App.tsx`，落地声明式 `Overlay`（支持下拉手势关闭与 `popstate` 手机返回键拦截）、`LedgerApp` 双模块 Keep-Alive 保活切换、以及带导入前差异预检（Dry-Run Diff）的 `BackupSection`。
3. 第三阶段：重构 `components/DailyLedger.tsx`，落地 `SmartMoneyInput`（支持加减算式求值与快捷筹码）、双层联动 `weekHero` 主卡、双栏直读状态看板、带周次标签的微缩时间轴、多维筛选与两段式防误触删除的历史流水、以及级联瀑布流样式的 `TransactionFlowDetail`。
4. 第四阶段：重构 `components/CopperShop.tsx`，落地树状资产恒等式总览卡（总资产 = 现金合计[流动库+存储库] + 库存成本）、`RatioSplitControl`（100% 恒等双向联动滑块）、以及销售毛利/库存上限实时校验。
每完成一个阶段请运行类型检查（tsc / build），确保零编译错误。
```

---

## 二、视觉 Token 规范（直接替换 `index.css`）

请将 `index.css` 中的颜色、圆角和阴影变量替换为以下 **配色 B：竹青宣纸（Kyoto Washi）** 定义：

```css
:root {
  --bg: #F9F8F6;
  --card: #FFFFFF;
  --subtle: #F0EFEA;
  --text: #1C1917;
  --muted: #57534E;
  --accent: #1F5E4B;
  --accent-hi: #17493A;
  --on-accent: #FFFFFF;
  --accent-soft: #EBF5F0;
  --accent-border: #B6DFD0;
  --warn: #D97706;
  --warn-soft: #FEF3C7;
  --warn-border: #FDE68A;
  --neg: #DC2626;
  --neg-soft: #FEF2F2;
  --neg-border: #FECACA;
  --pos: #16A34A;
  --pos-soft: #F0FDF4;
  --line: #E7E5E4;
  --track: #E7E5E4;
  --scrim: rgba(28, 25, 23, 0.48);
  --raise: 0 1px 3px rgba(28, 25, 23, 0.04), 0 4px 12px -2px rgba(28, 25, 23, 0.03);
  --sunken: inset 0 0 0 1px #E7E5E4;
  --r-card: 20px;
  --r-control: 14px;
  --r-key: 14px;
  --r-sheet: 28px;
  --r-pill: 999px;
  --hit: 44px;
}

/* 铜钱生意模块亮色覆盖 */
[data-module="copper"], .module-copper {
  --accent: #B4532A;
  --accent-hi: #96421E;
  --on-accent: #FFFFFF;
  --accent-soft: #FDF3EE;
  --accent-border: #F5CBB8;
}

/* 暗色模式覆盖 */
[data-theme="dark"], .theme-dark {
  --bg: #171615;
  --card: #21201E;
  --subtle: #2B2927;
  --text: #F5F5F4;
  --muted: #A8A29E;
  --accent: #4ADE80;
  --accent-hi: #86EFAC;
  --on-accent: #072617;
  --accent-soft: rgba(74, 222, 128, 0.12);
  --accent-border: rgba(74, 222, 128, 0.28);
  --warn: #FBBF24;
  --warn-soft: rgba(251, 191, 36, 0.14);
  --warn-border: rgba(251, 191, 36, 0.3);
  --neg: #F87171;
  --neg-soft: rgba(248, 113, 113, 0.14);
  --neg-border: rgba(248, 113, 113, 0.3);
  --pos: #4ADE80;
  --pos-soft: rgba(74, 222, 128, 0.14);
  --line: #33302E;
  --track: #33302E;
  --scrim: rgba(0, 0, 0, 0.65);
  --raise: 0 2px 10px rgba(0, 0, 0, 0.4);
  --sunken: inset 0 0 0 1px #33302E;
}

/* 暗色模式 + 铜钱生意覆盖 */
[data-theme="dark"][data-module="copper"], .theme-dark .module-copper {
  --accent: #FB923C;
  --accent-hi: #FDBA74;
  --on-accent: #271204;
  --accent-soft: rgba(251, 146, 60, 0.13);
  --accent-border: rgba(251, 146, 60, 0.28);
}
```

---

## 三、6 个核心组件的功能重构规范（逐文件落实）

### 1. `App.tsx` —— 双模块保活（Keep-Alive）与跨模块分红桥接
- **现状问题**：切换底部 `app-tabs`（生活预算 / 铜钱生意）会直接卸载前一个模块组件，导致未提交的表单草稿、展开的预算周、滚动条位置全部丢失。
- **重构要求**：
  1. 在 `LedgerApp` 中同时挂载 `<DailyLedger />` 与 `<CopperShop />`，通过外层 `<div className={activeModule === 'daily' ? 'block' : 'hidden'} aria-hidden={activeModule !== 'daily'}>` 控制显隐，保留各自的局部表单与滚动状态。
  2. **跨模块分红预填（可选快捷动作）**：在 `LedgerApp` 提供 `onTransferDividendToDaily(amount: number, note: string)` 回调传给 `CopperShop`；当用户在铜钱生意点击「提取利润至生活预算」时，自动切换到 `daily` 模块并打开 `daily.income` 弹层，预填金额与备注（不篡改底层 `lib` 逻辑，由用户点击「确认分配」完成入账）。

### 2. `components/ui/Ui.tsx` + `BottomSheet` —— 声明式弹层、下滑手势与返回栈拦截
- **现状问题**：
  - `DailyLedger.tsx` 中的 `BottomSheet` 靠匹配中文标题字符串决定 `sheet` 或 `page`，并遍历 `children` 强行抽取 `SubmitButton`；
  - `Overlay` 顶部的拖拽条只是装饰，不支持下拉关闭，且手机物理返回键会直接退出网页。
- **重构要求**：
  1. **显式 Props**：`Overlay` 与 `BottomSheet` 统一支持显式属性 `variant?: 'sheet' | 'page' | 'confirm'` 与 `footer?: React.ReactNode`（同时向后兼容旧调用方式）。
  2. **下拉手势关闭（Drag-to-Dismiss）**：在 `variant === 'sheet'` 的顶部拖拽条区域绑定 `onPointerDown` / `onPointerMove` / `onPointerUp`，当向下拖拽距离 `deltaY > 90px` 时触发 `requestClose()`（自动走现有的 `dirty` 未保存确认保护）。
  3. **浏览器返回栈同步（`popstate`）**：当最顶层 `Overlay` 打开时，调用 `window.history.pushState({ overlayOpen: true }, '')` 并监听 `popstate` 事件；用户按手机左滑返回键时调用 `requestClose()` 拦截返回动作。

### 3. `components/ui/Ui.tsx` (`BackupSection`) —— 备份健康度提醒与导入前差异预检（Dry-Run Diff）
- **现状问题**：全站无云同步，但用户不知道距离上次导出备份过了多久；恢复 JSON 或导入 Excel 时直接覆盖，选错旧备份会冲掉近期记录。
- **重构要求**：
  1. **备份健康度时间戳**：每次执行 `exportJson`、`daily.exportExcel`、`copper.exportExcel` 时，在 `localStorage` 记录 `daily_ledger_last_backup_at = Date.now()`。若距离当前超过 7 天（或从未备份），在首页右上角设置按钮上显示一个温和的琥珀色小圆点，并在 `BackupSection` 顶部显示「距离上次备份已 X 天」。
  2. **导入前差异预检（Dry-Run Preview）**：用户选择 JSON 或 Excel 文件后，先解析出文件中的记录条数与最新记录日期，在 `confirm` 弹窗中对比展示：
     - `当前浏览器账本：生活 X 笔 / 生意 Y 笔（最新日期：YYYY-MM-DD）`
     - `待导入备份文件：生活 A 笔 / 生意 B 笔（最新日期：YYYY-MM-DD）`
     - 若待导入文件的记录数少于当前账本或最新日期早于当前账本，高亮黄色警告，并提供「先自动导出当前备份，再执行恢复」选项。

### 4. `SmartMoneyInput`（升级 `NumberField`）—— 行内算式求值 + 快捷筹码 + 铜钱毛利实时预览
- **现状问题**：大号金额框只支持纯数字输入，遇到聚餐凑单扣减（`128-15`）或多件商品累加（`38+16.5`）需切出 App 按计算器。
- **重构要求**：
  1. 将 `daily.expense`、`daily.income`、`copper.sale`、`copper.purchase` 的主金额输入升级为 `SmartMoneyInput`：
     - 允许输入数字与 `+`、`-`、`.` 运算符（如 `38+12-5`）；
     - 当输入包含 `+` 或 `-` 时，在输入框右侧实时显示徽章 `= ¥45.00`，失焦（`onBlur`）或点击提交时自动将算式规约为最终数值字符串。
     - 输入框下方提供一行紧凑的快捷累加筹码：`+¥10`、`+¥50`、`+¥100`、`-¥5`，点击即在当前金额上增减。
  2. 在 `copper.sale`（记销售）中：当用户输入「销售金额」和「销售成本」时，在表单中部实时渲染一张**「毛利与分润预览卡」**：
     - 显示 `本单毛利：¥(amount - cost)` 与 `毛利率：((profit / amount) * 100).toFixed(1)%`；
     - 若 `profit > 0`，实时显示 `流动库 +¥(profit * liquidRatio%) / 存储库 +¥(profit * reserveRatio%)`；
     - 若 `cost > currentInventoryCost`，立即在输入框下方显示红色行内提示「销售成本超过当前库存成本（¥xxx），无法提交」。

### 5. `RatioSplitControl`（重构 `copper.settings` 分润比例）—— 100% 恒等联动滑块
- **现状问题**：`copper.settings` 用两个独立输入框分别输入「流动库%」和「存储库%」，要求手动凑够 100%。
- **重构要求**：
  1. 替换为双向恒等联动组件 `RatioSplitControl`：
     - 包含一个 `0–100`（步长 `5`）的滑块 + 两个联动数字框 + 三个快捷预设按钮（`70:30 常规`、`50:50 稳健`、`100:0 全回流`）；
     - 修改 `liquidRatio` 为 `X` 时，自动设置 `reserveRatio = 100 - X`；修改 `reserveRatio` 为 `Y` 时，自动设置 `liquidRatio = 100 - Y`，永远保证总和等于 `100%`。
     - 下方附带一行动态试算文案：`每产生 ¥1,000 毛利：流动库分得 ¥${liquidRatio * 10} · 存储库沉淀 ¥${reserveRatio * 10}`。

### 6. `TransactionEventRow` & `daily.history` —— 多维口袋筛选 + 两段式防误触删除
- **现状问题**：`daily.history` 只能翻页加载，无法筛选哪些支出动用了缓冲金或属于提前支付；每行右侧常驻裸露的删除图标易误触。
- **重构要求**：
  1. 在 `daily.history` 顶部增加轻量筛选栏：
     - 筛选胶囊：`全部`、`动用缓冲/储备`（过滤 `allocation` 中含 `buffer` 或 `reserve` 的记录）、`提前支付`（过滤 `isPrepaid === true`）、`大额/计划外`；
     - 关键词搜索框：按备注（`desc`）或类别名称实时过滤。
  2. **两段式行内删除**：将 `TransactionEventRow` 右侧的独立删除按钮改为收起态图标 `⋯`（或轻度弱化的删除图标），第一次点击时在行内右侧滑出 `「确认回滚删除」 | 「取消」` 两个紧凑按钮，或调用 `useUi().confirm` 弹窗并明确列出将回滚到哪些口袋的具体金额。

---

## 四、四大核心界面的布局与信息架构重构规范

### 1. 生活预算首页 (`daily.home` in `components/DailyLedger.tsx`)
- **区块 1：双层联动主卡 (`weekHero`)**
  - **上半层（聚焦本周）**：左侧「本周剩余可用」状态圆点 + 标签，右侧当前周日期胶囊（如 `W1 · 10.12 – 10.18`）；中部左侧超大等宽数字 `¥682.00`（超支时变红色并显示 `已超支 ¥xxx`），右侧显示 `已用 ¥318 / 额度 ¥1,000`；下方为圆角进度槽 + `本周消耗进度 X%` 与 `日均可用 ¥X/天`。
  - **下半层（内嵌式所属周期资金池底座，背景 `--subtle`，顶部分割线 `--line`）**：
    - 标题行：`↳ 所属周期资金池 (10.12 – 11.12)` + 右侧 `周期详情 →` 按钮（打开 `daily.cycle`）；
    - 双列子卡：左卡「周期日常剩余（含本周） `¥2,682.00`」，右卡「安全缓冲金（兜底池） `¥1,500.00`」；
    - 底部栏：若有提前支付，左侧显示琥珀色胶囊 `⏳ 未来周提前支付 ¥120 · 查看清单 →`（打开 `daily.cycle` 并定位 `#prepaid-list`），右侧显示 `可动用总计 ¥7,382`。
- **区块 2：一体化操作台 (`recordAndSummary` + `quickActions`)**
  - 采用 12 列网格（`grid-cols-12 gap-2`）：
    - 左侧 5 列（`col-span-5`）：竹青主色大按钮 `＋ 记一笔（日常 / 预付 / 大额）`，打开 `daily.expense`；
    - 右侧 7 列（`col-span-7 grid-cols-3`）：3 张纯白快捷操作卡 `💰 收入分配`、`⚖️ 余额校准`、`🏦 固定支出`（若有待确认固定项，右上角显示琥珀色数字角标）。
- **区块 3：透明直读状态看板（替代原先需盲滑圆点的小卡片）**
  - 顶部左侧分段切换按钮：`待处理事项 (N)` | `固定预留池 (¥3,200)`，右侧 `管理 →`；
  - 下方 3 列网格（`grid-cols-3 gap-2`）展示对应指标（固定待付笔数、账面校准提示、储备缺口 / 预留余额、本期固定项数、待确认扣款额）。
- **区块 4：带周次与金额的微缩周时间轴 (`weeklyConsumption`)**
  - 将原先无文字的灰色凹槽改为水平网格/滚动卡片序列（`W1`、`W2`、`W3`、`W4`…）：
  - 每张周卡片包含：顶部周次 `W1` + `本周` 高亮徽章、次行起始日期、中部垂直堆叠柱（实心竹青代表已花、琥珀斜纹 `.bg-prepaid-stripe` 代表提前支付）、底部该周剩余金额 `¥682`。

### 2. 快速记支出弹层 (`daily.expense` in `components/DailyLedger.tsx`)
- **金额框**：使用 `SmartMoneyInput`，右侧联动展示当前选中类别及其扣款规则徽章（如 `外食 · 扣本周`、`计划外 · 超支动用缓冲`、`大额 · 优先缓冲/储备`）。
- **日期与备注双列同行**：将「付款日期」与「备注·可选」排为 `grid-cols-2 gap-2`，减少纵向高度，确保手机一屏免滚动。
- **底部实时扣款预览条**：除显示 `本周剩余 ¥682 → ¥644` 文字外，附带一条实时变化的微型进度条预览。

### 3. 资金流向详情 (`TransactionFlowDetail` / `daily.flow` in `components/DailyLedger.tsx`)
- **顶部收据摘要卡**：居中展示类别徽章、标题、大号金额、日期与记录时间。
- **级联瀑布流（Waterfall Allocation）**：
  - 当具备完整前后快照时，左侧绘制一条贯穿式的纵向连接线（`border-l-2`），每个扣款口袋前放置序号圆标 `1`、`2`；
  - 每个口袋卡片展示：口袋名称 + 扣款角色标签（如 `优先扣减` / `自动补足差额`）+ 本次扣减金额 `-¥682.00`；
  - 下方内嵌 3 列等式条：`扣款前余额 ¥682.00` ➔ `-682.00` ➔ `= ¥0.00 (扣款后新余额)`。
  - **严格保留现有降级规则**：缺任一快照时隐藏计算等式条并标注旧记录；单项分配与快照不等式时写「记录后」不写等号；未覆盖差额独立展示为红色「未覆盖资金缺口」卡片；内部转账隐藏删除按钮。

### 4. 铜钱生意首页 (`copper.home` in `components/CopperShop.tsx`)
- **树状资产恒等式总览卡（合并原 `assets` 与 `cashPockets` 的割裂感）**：
  - **上半层（总资产）**：展示 `生意总资产 ¥28,460.00` + 一条双色比例进度条（赤陶色代表现金合计占比，中性灰代表库存成本占比），下方左右标注 `● 现金合计 ¥18,460 (65%)` 与 `● 库存成本 ¥10,000 (35%)`。
  - **下半层（内嵌现金两库拆解，背景 `--subtle`）**：标题注明 `↳ 现金合计拆解`，下方并排展示 `💳 流动库 ¥12,920 (利润 70%)` 与 `🔒 存储库 ¥5,540 (利润 30%)`，让 `流动库 + 存储库 = 现金合计`、`现金合计 + 库存成本 = 总资产` 的层级关系无需心算即可一目了然。
