# Polaris 发布视频

revision: 17

本文件约束 Polaris 的发布视频。上方是进行中的开源发布视频；「已确认」及之后各节保留 2026-10 X 预热视频的决定与验收记录。应用设计以根目录 `design.decisions.md`、`design.md`、`interaction.md` 和 `desktop/src/theme.css` 为准。

## 开源发布视频（2026-11-12）

| 项目 | 决定 | 来源 |
| --- | --- | --- |
| 工具 | 继续使用 Remotion，在本工程上改版；界面素材改用当前 Electron 版本 | 用户 2026-11-12 选择 |
| 价值重点 | 一、多个目标、每个目标多条策略同时推进；二、在决策卡中高效决定，不必在大量文本里查找待决事项；三、用户把精力集中在分析目标与策略上 | 用户 2026-11-12 要求 |
| 开场对比 | 大量 Agent 文本中埋着很多待决定的问题：第一段话里就有三个，之后更多段落继续出现；所有问题最后一起脱离文本，变成决策卡，衔接下一幕看板 | 用户 2026-11-12 反馈；替代草案中只有三个问题的开场 |
| 目标领域 | 单独一幕说明目标可以来自生活、学习、产品增长等不同领域 | 用户 2026-11-12 要求 |
| 新策略 | 单独一幕：主 Agent 针对目标给出更多策略建议，用户同意后新策略开始推进，并自动生成决策卡 | 用户 2026-11-12 要求；对应产品的策略建议（R-D190、R-D192）与自动补卡（R-D188） |
| 时长 | 40 秒：每段只保留动作与读完字幕所需的时间，单段静止不超过约 2 秒 | 用户 2026-11-12 反馈部分画面过长；实测 60 秒版多目标段静止 8.9 秒、新策略段 8.3 秒、决定段 6.0 秒；替代此前 60 秒 |
| 快捷键展示 | 不展示按键；选择与确认由选项勾选和弹窗收起表达 | 用户 2026-11-12 要求 |
| 新策略表达 | 不说「Agent 会建议新策略」，改为 Agent 围绕目标研究成功案例、找出新的策略路径；建议卡正文呈现案例依据 | 用户 2026-11-12 反馈原表达太刻意 |
| 片尾说明 | 明确开源，并说明数据存储在本机。不写「数据完全在本地」：业务数据保存在用户的 Mac，但 Agent 调用所选平台的模型，对话内容会发送到该平台 | 用户 2026-11-12 要求说明开源与本地数据；措辞按实际数据流限定 |
| 表达方式 | 画面与顺序可以调整，以三点价值准确、流畅地传达为准；以上开场、目标领域、新策略要求按此原则落实 | 用户 2026-11-12 授权 |
| 分镜 | 已确认：埋在文本里（0–8s）→ 变成卡片（8–13s）→ 高效决定（13–24s）→ 多个目标同时推进（24–35s）→ 策略建议卡与新策略自动补卡（35–50s）→ 收束（50–55s）→ 发布（55–60s）。屏幕文案与旁白见下节 | 用户 2026-11-12 确认「ok，来吧」 |
| 开场表达 | 文本是后台 Agent 的工作记录（标明 Agent 与策略）。转场时文本收回各自的 Agent 头像，只有问题飞出成为决策卡；不表现 Polaris 解析聊天记录 | 用户 2026-11-12 同意；依据后台 Agent 不经聊天提问、过程留在任务详情（interaction.md） |
| 交付方式 | 方向确定后直接交付成片，不再提交中间样稿 | 用户 2026-11-12 要求 |
| 字幕 | 无旁白也能看懂；旁白生成后与字幕同时使用 | 本片制作决定 |
| 中文版 | 与英文版共用场景与时间线：应用界面为简体中文，演示内容与字幕为中文，工具活动行保持英文（R-D66） | 用户 2026-11-12 要求 |
| 配乐 | 先定节拍再剪画面：120 BPM、D 小调，一拍 15 帧、一小节 60 帧；场景从小节开始，字幕与关键动作落在拍点。合成鼓组、贝斯、和弦、琶音与事件拨音；第一帧即有重击，前奏直接进入律动并带切分动机（低于高潮约 2 dB），铺垫段收紧低通、加密军鼓，留一拍空白，12 张卡落位时滤波全开进入全片最响的高潮，中段为多目标高峰，收束后在标志处落下终止和弦 | 用户 2026-11-12 反馈原配乐没有节奏、开头过于清淡易被划走；参照 product-launch-motion、huashu-motion 等代码制作发布片的做法 |

### 分镜与文案

| 时间 | 幕 | 画面 | 屏幕文案 |
| --- | --- | --- | --- |
| 0–6s | 埋在文本里 | 三个后台 Agent 交错的工作记录；前 2 秒第一段三个问题依次高亮，随后加速滚过，共 12 个问题；3 s 起拉远倾斜 | Decisions get buried in the text. / 决策埋在大段文字里。 |
| 5–8s | 工作归 Agent，决定归你 | 5 s 问题浮起，每段记录收回所属 Agent 的头像；6 s 起卡片按十六分音符逐张落位 | Agents keep the work. You get the decisions. / 工作留给 Agent，决策交给你。 |
| 8–15s | 高效决定 | 8.5 s 第一张卡展开成弹窗，背景约 1.5 s、选项约 1.5 s，12 s 选择推荐、13 s 确认，回到全景 | One question. Clear options. Your call. / 一个问题，选项清楚，由你决定。 |
| 15–22s | 多个目标同时推进 | 三个目标看板层叠展开，镜头缓慢推近；17 s、18 s 学习与生活目标各到达一张新卡；20.5 s 起回到增长目标 | Any goal. Many strategies. All at once. / 任何目标，多条策略，同时推进。 |
| 22–33s | 新策略 | 22.5 s 策略建议卡到达，23.5 s 展开：卡片内容是 Agent 围绕目标研究的成功案例（12 个独立产品的首批客户来源与有效做法）及由此提出的新策略路径；26.5 s 选择推荐，27.5 s 确认；28 s 第四列出现并准备卡片，三张卡在 30、30.5、31 s 落入，32 s 该 Agent 退出 | Agents study what worked for goals like yours. / New strategy paths. Say yes, and work begins. / 围绕你的目标，Agent 研究成功案例。/ 找到新的策略路径，你点头就开始推进。 |
| 33–36s | 收束 | 拉回全景，卡片区域减淡 | You focus on goals and strategy. / 你只需专注目标和策略。 |
| 36–40s | 发布 | 36 s 终止拍上落标志；名称，「Free and open source. / Your data is stored on your Mac.」（「免费开源。/ 数据存储在你的 Mac 上。」），GitHub 地址 | — |

旁白（Aoede，`assets/narration-v3.json`）：Your agents work for hours. The decisions they need from you get buried in the text. / In Polaris, the work stays with your agents. The decisions come to you. / One question, with the context, the options, and a recommendation. Make the call, and move on. / Do this for every goal: growing a product, learning a language, training for a race. Each one runs several strategies at once. / When there's a better angle, agents suggest a new strategy. Say yes, and they start the work, bringing back the first decisions. / Agents do the legwork. You focus on goals and strategy. / Polaris. Free and open source.

### 制作方式

- 界面素材：`scripts/capture-launch.mjs` 以 `POLARIS_TEST=1` 的隐藏、不可聚焦窗口运行已构建的 Polaris，使用隔离数据库与 `assets/launch-demo.json` 的虚构内容，窗口 1536×864、2.5× 采集 3840×2160。运行中的后台任务在启动后写入，以呈现真实的 Agent 列表与 Preparing decision cards 状态。
- `scripts/prepare-launch.py` 从采集图裁出卡片、策略列、Agent 列表与弹窗，场景只加载所需小图。
- 场景代码在 `src/v3/`。所有场景起点、动作时刻与字幕时间都在 `src/v3/timeline.json`，影片与配乐脚本共用；配乐脚本校验关键时刻都在拍点上。颜色、圆角与字号取自 `desktop/src/theme.css`。开场的工作记录是示意排版，Agent 头像取自真实 Agent 列表；其余画面均为真实应用状态。采集时隐藏进度环，由影片按应用样式重绘并转动。
- 飞行中的文字保持固定字号、以 transform 缩放；逐帧改变字号会让渲染页崩溃。
- 文案：`src/v3/copy.ts` 保存两种语言的工作记录、字幕与片尾；演示数据为 `assets/launch-demo.en.json`、`assets/launch-demo.zh-Hans.json`；采集与裁切按语言输出到 `public/v3/<locale>/`。
- 声音：`scripts/make-launch-v3-audio.py` 按 120 BPM 节拍网格合成（鼓组、贝斯、和弦 stab、十六分琶音、事件拨音，pad 随底鼓起伏），段落力度随画面变化（读卡与读建议时退后约 3 dB）。无旁白时母带到约 −16 LUFS、真峰值约 −5 dBTP；`out/narration-v3/` 有全部旁白后，音乐降到 −24 LUFS 并在说话时避让。模型无法试听，验收依据节拍对齐、能量曲线与频谱图，听感以用户试听为准。
- 截图中的决策弹窗分隔词：桌面源码已改用 `board.or` 九语文案；已构建的应用早于该修改，采集脚本在隐藏窗口里显示同一文案，重新构建应用后不再需要。
- 旁白生成：`python3 scripts/gemini-voice-study.py --script assets/narration-v3.json --key-file <项目目录外的私有凭据文件>`，再运行音频脚本与合成。
- 复现：`node scripts/capture-launch.mjs`（需已构建的 macos/build/Polaris.app）→ `python3 scripts/prepare-launch.py` → `npx remotion render src/index.ts PolarisLaunch out/polaris-launch-v3-video.mp4 --crf=16` → `python3 scripts/make-launch-v3-audio.py` → 用 ffmpeg 合成 `out/polaris-launch-v3.mp4`。中文版：采集与裁切传入 `zh-Hans`，渲染 `PolarisLaunchZh`，输出 `out/polaris-launch-v3-zh.mp4`。

## 已确认

| 项目 | 决定 | 来源 |
| --- | --- | --- |
| 用途 | X 产品发布预热，一条英文帖子配一条产品视频 | 用户需求 |
| 受众 | 海外 AI 用户与独立开发者 | 用户选择 |
| CTA | 关注后续发布，先收集兴趣 | 用户选择 |
| 工具 | video-shotcraft 的制作流程与镜头库，Remotion 渲染 | 用户选择 |
| 协作方式 | 先讨论视频文案和画面，再制作 | 用户本轮要求 |
| 方向 | 一条完整决策流程；以 Cursor 的清楚演示为主，少量 Linear 式局部特写；沿用 Polaris 白、黑、蓝 | 用户接受上一轮方案 |
| 本轮重点 | 同一个目标下多条策略并行，每条策略包含多项具体待决策；用看板和操作让观众直接感受 | 用户本轮明确要求；替代只跟随一条策略的主叙事 |
| 讲解范围 | 只讲主要产品逻辑，不强调 GrokBot 依赖、接入配置或复制命令 | 用户追加要求；替代上一版专门的交接说明镜头 |
| 制作放行 | 按当前方案制作第一版；界面和字幕全部英文，重点是策略并行与连续决策 | 用户本轮明确确认 |
| 声音反馈 | 第一版音效被用户否定。重查 Cursor、Linear 原片及其他 AI 制作案例后再设计声音；原有音轨不视为已接受 | 用户 2026-10-28 追加反馈 |
| 声音样片放行 | 参考 Linear 的氛围，先制作 12–15 秒声音样片；用现有三条策略展开至第一项决策的画面试听 | 用户明确确认；只约束本次样片 |
| 声音样片反馈 | 音乐方向可以保留；沙沙/擦过类音效被否定，后续去除。人声明确为英文旁白；使用托管 API，不下载本地模型 | 用户追加反馈及澄清；本地 Kokoro 试跑已停止并清除其模型缓存 |
| 旁白样片放行 | 使用 Gemini TTS API 制作英文旁白试听，保留音乐、移除沙沙拟音；先比较两种声线 | 用户确认“可以，去吧”；只使用免费项目，不开启付费结算 |
| 正片旁白 | 选择 B（Aoede）；在现有 45 秒画面中加入英文旁白，保留样片音乐方向，去除全部旧拟音 | 用户确认“B 吧” |

## Aoede 正片声音方案

使用同一 Gemini Aoede 预设声线与已选样片的自然、平静美式英语指导，分六段生成，按镜头安排停顿。旁白之外保留安静阅读时间。片尾由旁白说品牌与价值，关注引导保留在画面中。音乐延展样片的 D 小调和声、稀疏拨音与低频脉冲；不加入空气噪声、刷擦、whoosh 或 UI 点击音。原视频画面流直接复用，声音替换为音乐与旁白两个分轨。

| 起点 | 旁白 | 对应内容 |
| --- | --- | --- |
| 0.2s | Your agents do the legwork. You make the calls. | 分工 |
| 4.5s | Set a goal and your guidelines. Multiple strategies move forward in parallel, bringing back the decisions that need you. | 目标、方针、并行策略和多项判断 |
| 16.5s | The context. The options. A recommendation. Ready for your review. | 第一项决策的背景与选项 |
| 24s | Compare the options. Then make the call. | 比较、选择、确认 |
| 30s | Move to the next strategy. Make another decision. Keep your goal moving. | 跨策略连续决策 |
| 41s | Polaris. More time for decisions. | 品牌与价值 |

时点为排期，生成后按实际时长检查无重叠并微调。交付 `out/polaris-launch-v2.mp4` 与无配乐旁白版；旧样片保留供对照。

## 第一版执行方案

时长 45 秒，1920×1080，30 fps。英文屏幕文案、轻音乐与操作音效；首版不加旁白。以“找到前 10 位客户”这一虚构目标贯穿全片，同时展示三条策略、每条四个独立待决策。多目标适用范围由帖子承接，视频末尾不切换个人目标，把时间留给一个目标的并行推进。

观众应看懂：设定一个目标和约束；三条策略并行推进；每条策略不断带回不同的具体选择；用户在同一看板上处理这些判断；用户的决定指导后续工作。

这次强调的好处是重要问题有完整背景、选项可以比较、用户不必在聊天记录中寻找待办的决定。避免声称已测得效率提升倍数。

## 屏幕文案与画面草案

| 时间 | 英文文案 | 画面 | 信息目的 |
| --- | --- | --- | --- |
| 0–3s | Your agents do the legwork. / You make the calls. | 白底大字，Polaris 小字标识；第二句话用主题蓝落定 | 说明人与 Agent 的分工 |
| 3–6s | One goal. | Find my first 10 customers 出现在真实看板顶部；简短呈现方针入口 | 建立唯一的共同目标 |
| 6–10.5s | Multiple strategies. Moving in parallel. | 同一目标下三列接近同时展开，具体问题按列交错落入 | 三列是并行策略，不能剪成先后阶段 |
| 10.5–16s | Your decisions, all in one place. | 每列四张真实问题；先保持全貌，再推近三列标题与具体问题 | 直接看见多条策略带回多项判断 |
| 16–29s | The context. The options. Your call. / Compare the options. / Make the call. | 打开第一列的用户访谈问题，分别特写背景和选项，选择 Solo founders 并确认 | 完整展示第一项决定，并为阅读留足时间 |
| 29–31s | Then move to the next one. | 第一列从四项变三项；回到原看板 | 建立空间连续性 |
| 31–39s | Keep your strategies moving. | 打开第二列的帖子主题问题，选择 More time for decisions 并确认 | 跨策略连续决策 |
| 39–41s | A few decisions. More progress. | 第一、二列各剩三项，第三列四项；两项结果已保存，其余待决策仍在 | 不讲接入与命令，不虚构自动执行 |
| 41–45s | Polaris / Follow for the launch. | 收束到正式图标与名称，静止收尾 | 记住名称与下一步 |

第一项完整展示选项决策；第二项可剪短展示另一条策略的选择。自定义输入保留为备选，不为了覆盖功能而压缩多列看板的展示时间。

## 演示内容

所有内容均为虚构演示数据。

- Goal: Find my first 10 customers
- Guardrails: Learn from real conversations. No paid ads.
- Strategy A: Customer conversations — interview potential users and compare their needs.
- Strategy B: Build in public — test messaging and product demos with relevant readers.
- Strategy C: Validate the offer — test the promise, early-access offer, and buying intent.
- Decision: Who should we interview first?
- Context: We can interview five people this week. Solo founders decide quickly. Small teams reveal collaboration needs. Start with one audience.
- Option A: Solo founders — Start with users who can try and buy on their own.
- Option B: Small product teams — Learn where shared workflows create friction.
- Recommendation: Solo founders — A narrower first audience will make the initial interviews easier to compare.
- Optional custom decision: Start with B2B founders. Keep it to five interviews.

每条策略的具体待决策：

| Customer conversations | Build in public | Validate the offer |
| --- | --- | --- |
| Who should we interview first? | Which angle should our first post lead with? | Which promise should lead the landing page? |
| Which problem should we explore first? | Which product moment should the demo show? | What should the early-access offer include? |
| Is this interview invitation ready to send? | Is this launch teaser ready to publish? | Which audience should onboarding focus on? |
| Which feedback should we validate next? | Which reader question needs a follow-up? | Which signal should count as buying intent? |

这些是同一目标下彼此独立的选择，不能画成互相依赖的三步流程。多列卡片交错出现表达并行工作，不表示 Polaris 自己提供调度器。Agent 不越过等待用户决定的分支，其他可独立推进的分支继续。

## 视觉与节奏

- 品牌颜色和字体关系来自 Theme.swift；不更改应用 Token。画布字号按 1920×1080 阅读距离放大。
- 白色主画布，墨色正文，蓝色只强调人做决定的关键句和选择状态。
- 字卡承担概括，真实界面承担证据。一镜只传达一个动作，文字落定后留阅读时间。
- 先展示完整界面，再推近问题、选项与建议，最后归回原位置。关键文字阅读时保持正面。
- 三列看板占据全片核心位置。至少在卡片汇集后、完成一次决定后和结尾前返回全貌，让用户记住“一个目标、多条策略、多项决定”。
- 少量侧斜和景深只用于转场、界面进入；不让必须阅读的内容持续倾斜或模糊。
- 完整界面使用真实应用截图。`scripts/capture.py` 复制 SwiftUI 视图到 `.capture/`，仅在拍摄副本中英文化按钮、方针入口和相对时间，调用原有存储逻辑生成真实决定前后状态；正式应用源码与用户数据库不改动。通过 NSView 将真实视图直接绘制为 3× 位图，不受当前显示器倍率影响；`scripts/prepare-assets.py` 按图片实际尺寸换算；元素坐标来自 BoardStore 的真实几何数据。
- 不制作不存在的目标编辑器、运行状态或自动交接开关。影片讲主要工作逻辑，隐藏平台品牌与配置细节；具体接入依赖由真实使用说明承接。

## 参考与执行入口

- Cursor: https://x.com/cursor_ai/status/2115159585548021814
- Linear: https://x.com/linear/status/1956012232950653301
- video-shotcraft: https://github.com/Vincentwei1021/video-shotcraft
- 共同创作流程: https://github.com/Vincentwei1021/video-shotcraft/blob/main/references/guided-free-creation.md

## 镜头与素材依据

video-shotcraft 来源版本：`43bd349a136651865ecfa6ea1cf012f6e957d304`。通过 `gallery/api/library.json` 核对下列卡名；阅读卡片与具体 demo 后按 Polaris 素材适配。

| 内容 | 镜头依据 | 保留与适配 |
| --- | --- | --- |
| 开场文字 | `blur-slide` / `demos/typography/blur-slide/BlurSlide.tsx` | 22f 词级入场，位移、模糊、透明度共享同一进度；换为原生无衬线与黑蓝颜色；去掉刊头、纸张装饰 |
| 多列问题落入 | `row-embed` / `demos/ui-entrance/row-embed/RowEmbed.tsx` | 12f 加速落入、16° 收平、4f 落定；按三列交错投放到真实槽位；依照项目简洁方向去掉逐卡光效 |
| 指针与相机 | `cursor-flyover` / `demos/camera/cursor-flyover/CursorFlyover.tsx` | 独立的相机与光标轨迹、真实控件坐标、点击后状态反馈；放慢为完整阅读与两次真实决策 |
| 页面相机 | `assets/lib/PageCam.tsx` | 直接复用并换白底；只有移动、推近，无手持抖动 |
| 收尾 | 已确认的静态构图 | 简短原生弹簧进入后静止；不套用和本片语义无关的高能品牌变形 |

`src/timeline.ts` 是镜头、字幕和音效时点的共同来源，`src/workbench.ts` 从它派生编辑清单。背景音乐在画面后选择，不把内容节奏强制改成卡点片：House Vibez / Lily J，轻音量铺底；音效采用可追溯来源的转场与真实开关拟音。曲目与素材授权登记见 `assets/audio-attribution.md`。输出带音乐与无音乐（保留操作音效）两个版本。

本片以已确认的清楚、克制方向为准，不采用镜头库中与当前项目不符的暗底、颗粒、纸张、霓虹、整画面节拍冲击等装饰。终检由独立审查 Agent 按视频技能清单执行。

## 复现

`npm ci` 后运行 `npm run render:all`，生成当前带音乐旁白版与无音乐旁白版。两版共用同一条已编码的视频流，避免重渲染造成字体光栅化差异。`npm run check` 检查 TypeScript；`npm run studio` 打开 Remotion 编辑器。截图采集需本机已构建的 Swift 依赖；复渲染现有视频不需要重新采集。

当前声音资产用 `npm run audio` 从 `out/narration/` 的六段 Aoede 原声复现。若需要重新生成原声，运行 `python3 scripts/gemini-voice-study.py --script assets/narration.json --key-file <项目目录外的私有凭据文件>`；已有片段会保留，网络中断可续跑。该命令不启用付费，不下载模型。`npm run audio` 同时复用 v1 已编码画面生成 v2，无需重新采集 UI 或重渲染画面。

## 第一版验收（2026-10-28）

以下是技术检查记录，不代表声音已获用户认可。用户已否定第一版音效，声音方向以文末追加研究为准。

- 已输出：`out/polaris-launch-v1.mp4`（带音乐）与 `out/polaris-launch-v1-no-music.mp4`（仅操作音效），均为 1920×1080、30fps、1,350 帧。
- 两版复用同一视频流，SHA-256：`ce615474e0b5ed6a37ab42d83923728880b929ebf7baeb9e75216fb541a32c81`。
- `npm run check` 通过；Workbench 与原始 Remotion 在 f75、405、600、735、1060、1310 的像素差均为 0。
- 独立复核已确认：3× 原生截图、正文及两个选项可读；两次选择/确认与 4/4/4 → 3/4/4 → 3/3/4 状态对应；转场无文字重叠；音效偏差小于 0.01 帧，无音频削波。详细记录见 `out/review.md`。
- 虚构演示数据保存在本目录，采集使用独立 SQLite 库；视频制作没有写入正式用户数据库。

## 声音研究与待制作方向（2026-10-28）

### 可核验的参考事实

- [Cursor 原片](https://x.com/cursor_ai/status/2115159585548021814)：43.566 秒。取得的官方 MP4 只有视频流；官方 HLS 主清单没有音频组且 CODECS 仅列 AVC。此参考在当前公开版本中是无音轨视频，不能描述为有配乐或拟音。
- [Linear Product Intelligence 原片](https://x.com/linear/status/1956012232950653301)：34.8 秒，AAC 48kHz 双声道。离线分析的主要节拍候选约 120 BPM；明显瞬态集中于约 8、10、12、14、16、18、20、22、24、26、28、30 秒。整体响度约 -21.9 LUFS，响度范围约 9.2 LU；本片第一版为 -26.0 LUFS / 5.3 LU。数值说明参考的动态和段落变化更大，不是把本片统一加响即可。
- 当前模型不能直接接收音频：没有进行耳听式音色验收。CLAP 音色分类只作为辅助推断，不能用来确认原片乐器、音源、插件或作者的制作流程；不能把分类分数当作正确率。
- 本片源代码确实把同一个 `click.mp3` 用于两轮的打开、选择、确认，共六次；BGM 除首尾包络外没有按阅读/交互段落变化。这是已核验的实现问题。

### 他人的可复现做法

- [LUDGI 的 SaaS 示例](https://www.ludgi.ai/motion-graphics/glass-launch-sting)：公开制作信息写明 ElevenLabs Music 与四个音效。
- [huashu-motion](https://github.com/alchaincyf/huashu-motion)：从节奏单写 ABC 乐谱，以乐器采样演奏，场景标记与画面共用时间线，再给关键动作配短音效。
- [lemo-opuscar 的实现说明](https://github.com/lemomo-ai/lemo-opuscar/blob/main/TECHNIQUE.md)：配乐分轨与程序拟音分别生成，统一时间线做音量避让、压缩、平衡后合成。
- [ElevenLabs 官方建议](https://elevenlabs.io/docs/eleven-creative/playground/sound-effects)：复杂声音可拆成独立音效生成后再组合；生成模型不代替选择与混音。

### 下一版建议（尚未试听定稿）

保留现有画面与决策主线，先用同一段 12–15 秒画面做声音比较。偏向低密度、有短拨音或轻敲击的器乐底，不继续沿用当前 House Vibez。三条策略展开时用一小组有轻微左右位置区别的短音表现并行；阅读段收掉节奏层并让声音退后；打开、选择、确认各用不同且克制的声音，避免六次同样的硬开关声；片尾短句收束，不叠加重型转场。先核对试听效果再铺满全片。

### 15 秒声音样片 v1

已制作 `out/sound-study/resolve-sound-study-v1.mp3` 和带画面对照的同名 MP4，画面取自主片 6–21 秒。此次为原创合成的氛围和声、稀疏短音、每小节一次轻脉冲与轻拟音，没有采样参考片的音轨。约第 10 秒打开决策时，音乐在 0.85 秒内退后；尾部留自然淡出。制作脚本为 `scripts/make-sound-study.py`，音乐/拟音分轨与事件表一并保留。此版本用于用户试听选方向，不能把技术音频检查或分类模型评分视为用户的听感认可。

### Gemini API 旁白样片

使用 Gemini Developer API 免费项目 `Polaris narration` 与 `gemini-3.8-flash-tts` 生成两种预设声线：Charon、Aoede。无本地模型、未启用付费结算。样片在 `out/voice-study/`，两条旁白使用同一文案；各自提供原声 WAV、与原配乐混合的 MP3、15 秒带画面对照 MP4。混音只使用 `out/sound-study/music.wav`，不含之前的沙沙拟音；旁白从 0.6 秒开始。调用与混音脚本分别为 `scripts/gemini-voice-study.py`、`scripts/mix-voice-study.py`，API 凭据不写入项目。

### Aoede 正片 v2 技术验收

`out/polaris-launch-v2.mp4` 与 `out/polaris-launch-v2-no-music.mp4` 均为 45.000 秒、1920×1080、30fps、1,350 帧。两版与 v1 的视频流哈希完全一致。六段旁白已完整置入，没有重叠、超出分镜排期或高电平截尾。混音只含新配乐与 Aoede 旁白，数字残差复核未发现旧拟音；带音乐 MP4 为 −21.50 LUFS / −5.36 dBTP。独立报告见 `out/narration/review.md`。

已同步 Remotion 和 Workbench 的音乐、旁白轨。实际 Remotion 音频导出与交付无损混音相关系数为 0.99999997，差异处于 16bit 导出量化量级。此记录是工程技术验收；声线、发音和音乐平衡的主观效果以用户试听为准。

云端 Gemini 3.8 Flash 在未提供参考文案的情况下完成音频转写，结果与计划旁白的 62 个词逐词匹配，未报告明显音频异常；结果见 `out/narration/audio-check.json`。这是自动辅助复核，不作为人工耳听结论。临时 API 凭据已删除。
