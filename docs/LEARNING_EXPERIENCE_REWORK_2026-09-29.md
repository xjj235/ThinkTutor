# 首页与苏格拉底追问体验整改验收记录

本文记录首页与追问体验整改的实现、发布和验收证据。准确发布提交、Render 状态及发布后浏览器复查以[本轮最终发布记录](../.data/release-validation/release-final.json)为准；后文保留各历史阶段的结果，不用早期通过数量覆盖后续发现的问题。

## 本轮实现：先收集自述，作答后再诊断（2026-09-29）

前一个补充版本为 `5d91df7dccc8b744cf1aa572a10c30ba348492ef`，Render 部署 `dep-datmujpsrm7s739bm1mg` 于 **2026-09-29 07:59:49 UTC** 生效。随后线上复查再次发现实质问题：初诊题用“两直角边”等术语提前透露正在询问的适用条件；第一次追问只给一条边，未保持学生错误主张中的“已知两条边”前提，不能据此确认题目能区分该主张。[发布与语义问题记录](../.data/release-validation/release-followup.json)

该次浏览器运行还因定位器要求完全匹配不含标签的进步文本而报错；页面实际含有加粗标签，测试定位器已在本地修正。这一工具误失败与上述教学语义缺陷分别记录，不能相互抵消，也不能将整次线上复查写为通过。[线上完整记录](../.data/release-validation/live-smoke-2026-09-29T08-00-15-870Z-22bf8850-c803-4dc9-8da5-767e6584feb4.json)

当前候选对普通、未绑定专项运行清单的任务改为由服务端生成中性自述问题，允许学生说“不知道”；开场不调用诊断模型，不引用参考资料、不预告学科条件，也不认定学生已经掌握或存在错误。页面仍展示任务主题与目标。学生首次作答后，才把实际回答、任务及相关课程上下文交给 AI 诊断，形成回答关联的解释与追问。再练仍先生成针对原缺口的任务目标，再收集新自述，保留父子会话关联及原历史记录。

下表记录自述开场接线版本的检查，早于下述 **08:29 UTC** 的结构化审核冻结；不能用这些数量代替新审核版本的最终全量、构建或浏览器验收。

| 本次候选检查 | 已取得的结果 | 证据 |
| --- | --- | --- |
| 全量自动测试 | **894 通过、44 跳过**；包含本地开场、创建保护、再练事务及首答上下文回归 | [tests-self-explanation-final](../.data/release-validation/tests-self-explanation-final.log) |
| 生产构建 | `pnpm build` 通过 | [build-self-explanation-final](../.data/release-validation/build-self-explanation-final.log) |
| 普通核心浏览器流程 | **10 通过**，使用 Mock，覆盖桌面与手机完整学习流程 | [browser-self-explanation](../.data/release-validation/browser-self-explanation.log) |

### 结构化追问检查：保持学生原话中的条件

08:09 与 08:12 UTC 的固定重放进一步确认：只写提示规则和自由文本理由仍会误放。第一次审核删掉了学生“知道两条边”的条件；第二次已经承认学生按原主张也可回答“只给一边，不能求”，却自行补成“即使再给一条边”来宣称有区分力。两次错误证据继续保留：[08:09 重放](../.data/coaching-live/recheck-2026-09-29T08-09-48-301Z.json)、[08:12 重放](../.data/coaching-live/recheck-2026-09-29T08-12-47-416Z.json)。

现有教学审核新增请求内的 `counterfactualEvidence`，记录沿用当前学生主张时，在**原题实际条件下**会得到什么结果。没有新增模型调用层，也未修改推理档位、输出预算或既有有界重试次数：

- `studentClaimQuote` 连续摘取本题检验的完整主张，最多 1200 字，保留相关对象、量词及前提，不复制整份长回答或无关段落；`wholeClaimIncluded=false` 时不放行。各 `conditions` 保存学生条件原文、题面依据及 `SATISFIED`／`NOT_SATISFIED`／`UNKNOWN` 状态。
- 条件状态暂且站在学生规则内部，只检查题目实例是否属于其对象范围、是否具备其要求的输入，不能用该错误规律在科学上为假来否定对象条件。例如非直角三角形仍属于“三角形”；“所有三角形”的范围条件与“所有三角形都能使用定理”的规律真假须分开。条件摘录不连带“就能……”的结论。
- `studentOutcome` 与 `correctOutcome` 使用 `AFFIRM`／`DENY`／`INSUFFICIENT`／`VALUE` 表示同一道题的结果。服务端拒绝条件未满足或未知却预测无条件肯定，也拒绝把相同结果标成 `DIFFERENT_RESULT`。只有题干明确要求某个具体推理环节时，才能走 `REQUIRED_REASON`，并给出该题原文及 `SPECIFIC` 范围；泛问“为什么／依据是什么”不能冒充这一要求。
- 若仍持错误主张的学生已经有足够回答原题的正确判断或理由，`studentReasonStillSufficient=true` 会触发拒绝；若必须另加条件或要求学生多答未问的问题才有区分力，`usesOnlyGivenConditions=false` 会触发拒绝。学生和题面引用不匹配、相关字段缺失或互相矛盾也不放行，即使模型同时返回 `diagnosticValue=true`。
- 当前已经修正、正确但不完整或回答“不知道”时，`studentRuleAnswer`、`distinguishingEvidence`、`counterfactualEvidence` 均为 `null`，继续检查真实应用、补缺或较小支架任务，不强迫新问题区分已放弃的误解。

这些字段使已声明的条件、结果与审核结论可以由服务端交叉检查；**引用存在不等于引用在语义上支持该条件，模型也仍可能漏抽条件或判错其状态**。因此这里记录的是结构化防线及有限对照结果，不把它称为完整的逻辑证明或模型教学判断完全正确。审核证据不写入学生学习记录；失败仍沿既有事务边界处理，不保存作答、不增加轮次、不推进阶段。

| 本次结构化审核证据（UTC） | 实际结果与边界 | 证据 |
| --- | --- | --- |
| 08:25 固定正反对照 | 自动测试 **0／2 通过**。负控已被服务端硬拒，但旧断言仍要求模型的 `diagnosticValue=false`，因此测试失败；正控则因模型把“所有三角形”的规律真假误作对象条件，标为 `NOT_SATISFIED` 而误拒。不能将该批写为全通过。 | [实际审核](../.data/coaching-live/recheck-2026-09-29T08-25-17-209Z.json) |
| 08:27 自然生成与纠偏 | **2 项通过、2 项失败**。不知道及修正前后共 3 份实际输出有效；错误条件场景发生内容审核截断，后续完整草稿又被条件状态误判拦下，未产生可交付输出。纠偏的最终 `content_review` 在约 8000 token 处截断，JSON 不可解析，`output=null`。修正后场景也曾中途截断，随后有界重试得到有效输出；不能忽略这些中间失败或把纠偏写成完成。 | [实际输出与传输状态](../.data/coaching-live/recheck-2026-09-29T08-27-53-589Z.json) |
| 08:30 同一组固定正反对照 | **2／2 产品判定通过**，四次 HTTP 均为 200、`finishReason=stop` 且 JSON 完整。负控仍被模型自报为 `diagnosticValue=true`，但它将学生要求的“两条边”标为 `NOT_SATISFIED`、引用题面“一条边”，同时预测 `AFFIRM`，由服务端确定性拒绝。正控的两个条件均为 `SATISFIED`，学生预测 `AFFIRM`、正确结果 `DENY`，实际放行。这证明本次结构化防线拦住了模型误判，不能表述为模型的全部教学理由正确。 | [正反对照与实际审核](../.data/coaching-live/recheck-2026-09-29T08-30-06-271Z.json) |
| 08:30 错误理解自然生成 | **1 项自动通过**。学生可见问题给定两边 3、4 及夹角 60°，反馈引用原话、解释需核验的条件并留下判断。内部审核却仅从一个 60° 角概括整个三角形非直角；这个完整数字案例实际不是直角三角形，但该审核理由本身不充分。因此本行不称全部语义正确，也不证明已消除局部推整体的审核局限。 | [日志](../.data/release-validation/live-generation-premise-final.log)、[实际输出与审核](../.data/coaching-live/recheck-2026-09-29T08-30-21-666Z.json) |
| 08:32 定向纠偏 | **1 项通过**。首份泄漏草稿为人工注入，其后 1 次真实生成、3 次真实审核全部完成；四次 HTTP 均为 200、`stop` 且 JSON 完整。最终题目完整给出三个角 50°／60°／70°及已知两边，反馈未预告判断，原话、关注点与问题一致，经人工及独立复核未发现学生可见的实质阻断。 | [日志](../.data/release-validation/live-repair-premise-final.log)、[真实纠偏输出](../.data/coaching-live/recheck-2026-09-29T08-32-01-582Z.json) |

上述条件状态规则于 **2026-09-29 08:29 UTC（北京时间 16:29）** 冻结。不知道及修正前后的三个有效学生可见输出沿用 08:27 的实际记录，只用于确认这些分支的内容表现；不把该批整体改写为通过。当前真实证据来自分别标明时间、版本和范围的批次，不拼成一批从未执行的“全绿”结果。

| 冻结后工程检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 全量自动测试 | **913 通过、44 跳过**，跳过项不作为真实模型证据 | [tests-shipping-final](../.data/release-validation/tests-shipping-final.log) |
| 普通核心浏览器流程 | **10 通过**，使用 Mock | [browser-shipping-core](../.data/release-validation/browser-shipping-core.log) |
| 专项知识库浏览器流程 | **6 通过**，使用 Mock；与普通核心按各自配置分开执行 | [browser-shipping-curated](../.data/release-validation/browser-shipping-curated.log) |
| 静态检查及最终构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过 | [lint](../.data/release-validation/lint-shipping-final.log)、[typecheck](../.data/release-validation/typecheck-shipping-final.log)、[build](../.data/release-validation/build-shipping-final.log) |
| 精确提交发布与真实线上浏览器复查 | 独立记录实际状态、执行时间、合成账号的两次真实回答及人工审阅，不以本地通过代替上线 | [本轮最终发布记录](../.data/release-validation/release-final.json) |

普通与专项浏览器曾被错误合并到同一条命令，运行器将整批切到专项模式，造成普通用例两项失败；分开执行后的 10 项和 6 项均通过，未放宽断言或修改产品来回避失败。两项固定对照和上述有限自然样例不证明所有模型审核可靠，也不抹去前述失败。发布与线上状态只以最终发布记录中的实际结果为准。下节初诊模型自然生成 3 项和固定审核 5 项属于旧实现证据，不能用于证明当前服务端自述开场。

## 历史阶段：5d91 补充版本发布前验证（2026-09-29）

本节保留该版本发布前的实现说明、通过样例和失败记录；其中“当前”“最终”只指该阶段，最新未完成项见上节。

基础改造最初以 `514fff7d8986c2299c7c1697af40e2a0e64b60e5` 发布至 [ThinkTutor 线上网站](https://thinktutor-competition.onrender.com)。Render 部署 `dep-datknemgekts73b7hijg` 于 **2026-09-29 05:28:01 UTC** 生效，包含下文首页、回答关联反馈及学习轨迹改造。[首次发布记录](../.data/release-validation/release-result.json)。补充修复的准确提交、部署状态和线上复查结果另记于[补充发布记录](../.data/release-validation/release-followup.json)，不以本地测试代替部署确认。

发布后的真实语义复查发现两类问题：首轮诊断可能把参考材料当作学生已表达的理解，或要求辨认未提供的图形；普通追问可能混淆“能否使用规则”和“结论本身是否为真”。浏览器流程通过不能抵消这些教学内容缺陷。[线上复查记录](../.data/release-validation/live-smoke-2026-09-29T05-30-51-196Z-387ee7ce-f0e4-457b-b96c-a3a77188b284.json)

补充修复在隔离工作区完成：首轮增加独立审核且不嵌套重试，新建与再练的锁预算覆盖生成及审核，失败不创建会话，未作答状态清零；普通追问增加条件推理方向与题目目标核验，并把内容审核已核对的前提传给教学审核。后审保留“未确认／信息不足”的限定；生成信息充分性问题时明确问“仅凭这些信息是否足以判断”。不能把局部条件缺失改写成整体一定不成立。

范围判断的历史断言曾强制要求“另一个角可能为直角”等特定措辞，误拒了有依据的“需先确认”表达；当前改为核对答案与已引证前提共同支持的含义。新增 6 项不调用模型的校准测试，保留对旧错误的拒绝断言，包括由一个非直角推断整个三角形非直角，以及误称已知两边必须都是直角边。校准不撤销历史失败记录，也不能代替最终真实模型回归。

| 候选检查 | 最新已取得的结果 | 证据 |
| --- | --- | --- |
| 全量自动测试 | **889 通过、42 跳过**；包含最后新增的 8 项 3／4／5 断言校准，跳过项不计作真实模型验证 | [tests-committed-candidate](../.data/release-validation/tests-committed-candidate.log) |
| 普通核心浏览器流程 | **10 通过**，使用 Mock | [browser-core-final](../.data/release-validation/browser-core-final.log) |
| 专项知识库浏览器流程 | **6 通过**，使用 Mock；与核心 10 项继续作为当前页面流程证据 | [browser-curated-final](../.data/release-validation/browser-curated-final.log) |
| 静态检查与构建 | `pnpm lint`、`pnpm typecheck`、`pnpm build` 通过；最后仅调整测试断言，生产源码与该构建一致 | [lint](../.data/release-validation/lint-committed-candidate.log)、[typecheck](../.data/release-validation/typecheck-committed-candidate.log)、[build](../.data/release-validation/build-shipping.log) |
| 首轮诊断真实自然生成 | **3 通过**；沿用与当前诊断源码对应、已经人工复核的自然生成证据，本次不重复计数 | [日志](../.data/release-validation/live-diagnostic-final-generation.log)、[实际输出](../.data/diagnostic-live/recheck-2026-09-29T05-49-26-768Z.json) |
| 首轮诊断真实审核固定对照 | **5 项固定对照通过**；沿用与当前诊断源码对应、已经人工复核的证据。只注入候选题，审核为真实调用，不能算作 5 个自然生成样本 | [该批日志](../.data/release-validation/live-diagnostic-recheck.log)、[固定对照与审核](../.data/diagnostic-live/recheck-2026-09-29T05-47-39-226Z.json) |
| 最终生成提示下的普通追问 | **4 项通过**：错误条件、不知道、前后修正（两次作答）、首份错误草稿后的真实纠偏。四份自然输出及一份纠偏输出均经独立人工复核 | [日志](../.data/release-validation/live-generation-shipping.log)、[实际输出](../.data/coaching-live/recheck-2026-09-29T07-44-40-843Z.json) |
| 普通追问完整回归批次 | **27 通过、3 失败**，其中 6 项通过是纯断言校准；不称整批通过。固定对照中的 18 份完整审核经人工复核，6 个正控放行、12 个负控拒绝均有对应依据 | [日志](../.data/release-validation/live-coaching-release-final.log)、[输出与传输状态](../.data/coaching-live/recheck-2026-09-29T07-49-56-127Z.json) |

此前候选的失败证据保留：普通生成与纠偏曾为 **3 通过、1 失败**（审核空输出，[日志](../.data/release-validation/live-coach-final-generation.log)）；逆否正反对照曾为 **1 通过、1 失败**（“预告需要修正”的负例误放行，[日志](../.data/release-validation/live-contrapositive-final.log)）。这些属于修复前批次，不计入正在执行的最终回归。

完整批次的三项失败分别为：3／4／5 固定负控因缺少逆定理前提被正确拒绝，但断言将“材料不足，不能确认”误当作“数学上不能使用”，该断言随后定向校准；否定前件与中性范围固定对照均在单次内容审核达到 7999／8000 输出 token 上限时截断，没有返回有效 JSON。这两项不能计为语义检查通过，也不能以另一个范围样例通过来替代。失败草稿被拒绝，没有返回给学生；服务流程的回滚与不推进轮次已由集成测试验证。未因这些失败切换正式模型或增加未经验证的降级路径。

上述有限合成样例与 Mock 浏览器检查分别证明内容样例及页面流程，不代表真实学生教学成效、所有未来模型输出、生产 Nginx 或阿里云验证。真实审核仍可能截断；本记录不宣称整批真实模型回归全绿或审核可靠性达到 100%。

## 历史记录说明

以下保留基础改造和发布前验收的原始证据。各阶段的“本次”“最终”“未部署”“尚未收到网址”只描述当时状态；补充版本及线上复查见文首链接的发布记录。历史失败批次和后来发现的缺陷继续保留。

## 首页：打开后直接开始学习

- 公共首页及学生首页中央只保留一个主操作：**新建学习任务**。
- 个人中心、历史学习记录、学习分析、班级及教师任务收进右上角个人入口和个人中心；教师、管理员原有工作入口保留。
- 未登录用户点击主入口后，经登录或注册直接回到新建任务；返回地址只接受服务端白名单中的 `/learn/new`。
- 请求结果不明时，“检查学习记录”直接进入历史列表，避免回到已简化的首页后无法确认任务是否建立。
- 检查桌面与 375px 手机视口、深色主题、键盘焦点及个人入口展开状态。

## 追问：学生看得见提问的来由

每次有效作答之后，先展示与本次真实回答绑定的反馈，再提出问题：

1. **从你的回答出发**：逐字引用学生的一段表达，指出已经表达的理解或尚不足的证据。
2. **接下来关注**：说明本轮补充或核验的具体部分。
3. **为什么要想这一步**：说明该部分对当前理解和判断的意义。
4. **针对这一点继续想**：提出与反馈一致的主要问题；不知道时提供更小的思考步骤。
5. **这次理解的变化**：仅在有真实前后回答支持时显示，不能凭轮数或进入下一阶段推断掌握。

普通模型依次进行生成、内容可用性审核、教学针对性审核。第一层解答实际题目，列明所需前提及其来源，并检查答案暴露、题设矛盾与资料缺失；第二层据此检查真实作答依据、问题区分力、缺口与解释是否对应、实际理解变化，不另造相反答案或更改前提判定。服务端核验审核引用和结论的一致性，不只接受“全部通过”的布尔值。审核失败进入有上限的定向重试；最终失败不保存作答、不增加轮次、不推进状态。

专项知识库沿用现有证据、缺口与教学选择，用服务端反馈说明问题依据、目标切换、案例应用和独立讲解的目的。证据未出现不直接认定为错误；可靠的新独立证据才可支持理解变化。

当前反馈与问题在主页面完整展示，旧对话收在可展开的历史记录中。请求提示后仍保留原问题的反馈；新问题到达时定位到反馈开头。会话及报告新增“我的理解如何变化”，把原表达、追问原因、后续作答和实际反馈串起来，并能跳回完整原文。

反馈与学生消息 ID 一起持久化，刷新后不丢失。既有记录继续可读，不为缺少反馈的旧数据补造评价；此次无需数据库迁移。Mock 模式明确标注模拟反馈，移除按追问轮数自动提高掌握程度的做法。

## 历史阶段：末端闭环补充修复（2026-09-29）

再次复核发现：普通流程主动进入费曼时，服务端保存的是一个没有逐轮诊断的新任务。原学习轨迹只收录有反馈的任务，导致旧追问正确显示为已替换，但最终独立讲解没有出现在轨迹中；自动进入费曼虽然保留讲解原文，也没有把已有学习报告带到该条目的回看位置。

比较了三种处理方式：把讲解并入旧追问会误归属证据；在轨迹外单独追加文本会割裂任务与作答；因此采用独立任务条目，按真实消息顺序并入现有轨迹。主动进入时保留新的讲解任务和后续原文，自动进入时复用已有条目，不重复显示。提示不成为新任务，替换前的问题不接收替换后的答案，没有原回答时不补造前后变化。

会话及报告页面同时传入已有报告；只有当前会话的最后一项任务确实收到最后一条学生费曼阶段作答时，条目才显示“整次学习报告”和仍处于 OPEN／IN_PROGRESS 的待巩固部分。页面明确这是整次对话的反馈，不把它冒充某一次追问的独立修复结论；查看完整记录直接定位实际讲解。兼容旧记录，无需模型调用、数据库迁移或补写历史评价。

交叉复核进一步发现，专项学习中的恢复核验也可能保存为没有逐轮反馈的 FEYNMAN 阶段消息。因此新条目使用中性的“费曼阶段任务／我的作答”，保留真实任务原文；不能仅凭阶段推断学生完成了独立输出。已有反馈的条目继续使用具体关注点，恢复核验也不会被误称为新增掌握证据。

本次同时补充纯函数回归、真实服务与数据库流程回归，以及桌面／手机的主动进入费曼→讲解→报告→原文定位用例。前次真实模型审核实现未变，本次不重新调用真实模型；自动测试继续使用 Mock。

浏览器复核还发现退出成功后的客户端路由缓存可能留下登录首页。仅调整刷新顺序仍可能竞争，改造为服务端 Action 则会扩大认证改动，因此采用成功退出后完整导航到首页，丢弃旧认证页面缓存；登录和个人入口的状态由服务端重新读取。回归断言退出后出现登录入口、个人中心消失，并能重新登录继续新建任务。

报告回看中的 Markdown 恢复正常空白排版，条目分隔线只作用于最外层任务，避免正文列表继承多余分隔线与空白。核心再练测试也改为等待带真实会话属性的页面，避免把 Next.js 流式导航期间短暂共存的两个加载占位当作已载入会话。

本次验证日志单独保存在 `.data/learning-experience-final-review-20260929/`。中间失败批次保留：初次默认构建清理了正在使用的预览缓存，已重启预览并将后续构建隔离到 `.next/learning-experience-verified-build`；直接在启用专项知识库的预览上运行普通核心脚本时，流程模式不同导致 2 项失败，改用项目正式 runner 的隔离普通模式；之后的普通模式暴露了上述退出缓存和加载占位选择器问题，修复后另存最终回归日志，不把先前失败批次并入通过数量。

| 本次最终检查 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm test` | **805 通过、24 跳过**；新增 6 项轨迹回归，扩展数据库流程验证主动费曼后的报告归属 | [日志](../.data/learning-experience-final-review-20260929/tests-final.log) |
| 普通核心浏览器流程 | **10 项通过**，桌面及手机覆盖首页、注册登录与退出、主动及自动费曼回看、报告与再练 | [日志](../.data/learning-experience-final-review-20260929/browser-verified.log)、[截图](../.data/learning-experience-final-review-20260929/browser-verified/) |
| 专项知识库浏览器流程 | **6 项通过**，覆盖版本化学习、费曼与反思、报告 | [日志](../.data/learning-experience-final-review-20260929/browser-curated-final.log) |
| `pnpm lint`、`pnpm build` | 通过 | [lint](../.data/learning-experience-final-review-20260929/lint-verified.log)、[构建](../.data/learning-experience-final-review-20260929/build-verified.log) |
| 配置恢复与类型检查 | 两个 Next 生成配置恢复至本次开始前原始字节，`pnpm typecheck` 通过；预览首页 HTTP 200 | [类型检查](../.data/learning-experience-final-review-20260929/typecheck-verified.log)、[运行核对](../.data/learning-experience-final-review-20260929/runtime-check.json) |

该阶段运行的本机预览为 <http://127.0.0.1:3100>，使用 Mock，数据目录不变。桌面首页以及桌面、手机费曼任务和报告截图已人工查看。当时的代码整改尚未提交、推送或部署；该阶段证据不代表当时线上网站已更新，也不作为真实学生教学效果证据。

## 历史阶段：后续本机预览复核（2026-09-29）

用户再次提出同一体验反馈后，核对了关键源码与前次验收摘要，改动完整保留。此次未改动教学实现，重新启动同一应用的本机预览，并完成独立复测；下列结果不沿用前次测试数量。

- 预览地址：<http://127.0.0.1:3100>，仅本机访问，使用 Mock；可以检查首页、创建任务、反馈呈现及报告回看，不能用模拟回答评价真实模型的教学能力。
- 数据保存在独立的 `.local-preview/learning-experience-20260929/postgres`，未覆盖其他预览的学习记录。预览使用项目现有 Next.js 页面、服务和权限逻辑。
- `pnpm lint`、`pnpm typecheck`、`pnpm build` 均通过；`pnpm test` 重新执行，**799 通过、24 跳过**。证据：[lint](../.data/learning-experience-runtime-20260929/lint.log)、[类型检查](../.data/learning-experience-runtime-20260929/typecheck.log)、[构建](../.data/learning-experience-runtime-20260929/build.log)、[测试](../.data/learning-experience-runtime-20260929/tests.log)。
- 项目已有 Playwright 用例直接访问上述预览，**6 项通过**，覆盖桌面与手机首页、注册／登录后进入新建任务、深色主题与键盘、逐轮解释及报告中的理解变化。[浏览器日志](../.data/learning-experience-runtime-20260929/browser.log)，[截图目录](../.data/learning-experience-runtime-20260929/browser/)。额外人工查看桌面首页与手机反馈截图，确认核心入口和解释内容可见。
- 构建产生的 `next-env.d.ts`、`tsconfig.json` 已恢复为此次复核前的原始字节，恢复后类型检查通过；预览首页返回 HTTP 200。

该阶段没有重新调用真实模型；前次真实生成、审核对照和专项样例证据保留在下节，不冒充该阶段结果。README 同步澄清预览默认使用 Mock，以及显式切换真实模型的区别。当时代码仍未提交、推送或部署，尚未收到用户实际测试的网站完整网址，因此当时不能确认线上版本包含这些改动。

## 历史阶段：深入修正后的代码验证

以下为当时深入修正后的结果。所有命令均实际执行；此前失败批次保留，不混入通过数量。后续线上复查及候选修复的结论见文首。

| 检查 | 结果 | 本轮证据 |
| --- | --- | --- |
| `pnpm lint`、`pnpm typecheck` | 通过 | [lint](../.data/learning-feedback-recheck/lint-verified.log)、[类型检查](../.data/learning-feedback-recheck/typecheck-verified.log) |
| `pnpm test` | **799 通过，24 跳过**；59 个文件通过，4 个可选文件跳过 | [完整日志](../.data/learning-feedback-recheck/tests-verified.log) |
| `pnpm build` | 通过 | [构建日志](../.data/learning-feedback-recheck/build-verified.log) |
| 桌面及手机浏览器 | **14 项核心用例通过**；中性题型标签修改后，反馈到报告的 2 项用例再次通过 | [首页与反馈 8 项](../.data/learning-feedback-recheck/browser-complete-core.log)、[知识库与费曼流程 6 项](../.data/learning-feedback-recheck/browser-complete-knowledge.log)、[标签修改后复测 2 项](../.data/learning-feedback-recheck/browser-neutral-label.log) |
| 普通真实生成及纠偏 | **4 项通过**：错误条件、不知道、前后理解修正（两轮）、首稿错误后的真实重新生成 | [日志](../.data/learning-feedback-recheck/live-content-prerequisite-generation.log)、[输出及审核记录](../.data/coaching-live/recheck-2026-09-28T17-46-29-737Z.json) |
| 普通真实审核固定对照 | **10 项通过**：8 个负例被拒，2 个正例放行 | [日志](../.data/learning-feedback-recheck/live-content-prerequisite-controls.log)、[对照及实际审核](../.data/coaching-live/recheck-2026-09-28T17-46-46-087Z.json) |
| 专项知识库真实调用 | **2 项通过**：实际评估后解释与追问，以及边界泄漏／机制背景正反对照 | [日志中的专项 2 项](../.data/learning-feedback-recheck/live-final-delivery.log)、[专项输出](../.data/coaching-live/v12-recheck-2026-09-28T17-25-12-819Z.json) |

专项证据所在合并日志的普通流程在当时仍有 2 项失败，因此这里只引用其中通过的专项部分；普通流程以表中后续独立日志为准。专项代码在该次通过后未再修改。浏览器采用 Mock，后续仅普通真实 Provider 的审核分工发生变化；真实生成测试显式调用 DeepSeek，关闭联网，不用 Mock 输出充当模型能力证据。

固定审核对照通过注入候选题来验证真实模型审核，不能当作全部由模型自然生成的成功样本。纠偏对照只注入首份错误草稿，之后的审核、重新生成与再次审核均为真实调用。原 3／4／5 题同时存在前置知识缺失和区分力问题，最终由明确的未支持逆定理拦截；另用前提完整的“所有偶数是否都是 4 的倍数”对照单独验证区分力，避免用任意错误或超时冒充教学判断。

最终普通样例已展示具体变化：先由“任意三角形都适用”的表达检验条件，再在学生明确修正为直角三角形后，引导其按已知直角位置写出边长关系；反馈明确说明这一步如何把适用条件与实际应用连起来。学习报告保留真实原回答、追问原因和后续补充，供学生回看。

最终普通与专项输出均逐条人工阅读，并完成独立复核；没有发现新的实质性学生可见问题。[验收源码摘要](../.data/learning-feedback-recheck/verified-source.json)记录关键文件哈希和本轮数量，便于区别后续版本。

测试过程中发现的类型检查问题已修复：独立对照任务显式提供可为空的课程及章节字段。构建生成的 `next-env.d.ts`、`tsconfig.json` 已恢复为本轮开始前的原始字节，再运行类型检查；没有留下测试用的 Next 配置改动。

这些检查证明当时代码及所测合成情境，不能保证所有后续随机模型输出或实际教学成效。该阶段尚未部署到用户实际测试的网站，也未验证生产 Nginx、阿里云或真实联网检索。

## 历史阶段：首次实现验证（深入复核前）

以下保留首次实现阶段的实际检查。它们不是下文深入复核后的最终代码验证，尤其不能用先前的真实样例通过代替人工检查教学质量。

| 检查 | 本轮结果 | 证据 |
| --- | --- | --- |
| `pnpm lint` | 通过 | [日志](../.data/learning-feedback-lint-acceptance.log) |
| `pnpm typecheck` | 通过 | [日志](../.data/learning-feedback-typecheck-acceptance.log) |
| `pnpm test` | 726 通过，12 跳过；56 个文件通过、4 个可选文件跳过 | [日志](../.data/learning-feedback-tests-acceptance.log) |
| `pnpm build` | 通过 | [日志](../.data/learning-feedback-build.log) |
| 首页与工作区浏览器检查 | 最终复测 6 项通过，覆盖桌面、手机、账号入口和键盘操作 | [日志](../.data/learning-feedback-e2e-home-verified.log)、[截图目录](../.data/review-20260929/home-verified/) |
| 核心浏览器回归 | 首轮 48 项中 46 通过，发现 2 项任务恢复入口问题；修正后，反馈与回答恢复相关 20 项全部通过 | [首轮日志](../.data/learning-feedback-e2e.log)、[修正后日志](../.data/learning-feedback-e2e-confirmation.log) |
| 专项知识库浏览器回归 | 22 项通过，覆盖八类案例及桌面、手机视口 | [日志](../.data/learning-feedback-e2e-curated-verified.log) |
| 真实 DeepSeek 反馈回归 | 4 项测试通过：3 项普通教学测试（含 4 种作答情境），1 项专项知识库测试 | [日志](../.data/learning-feedback-live-acceptance.log)、[普通样例](../.data/coaching-live/results.json)、[专项样例](../.data/coaching-live/v12-results.json) |

核心浏览器覆盖新建、诊断、追问、提示、费曼讲解、报告、再练、历史记录、教师任务，以及错误和网络恢复。专项浏览器覆盖八类案例的学习、修复、重试和最终讲解，并在桌面和手机上执行。

普通真实模型样例包括错误适用条件、表示不知道、不充分解释和纠正原有理解。最后一类实际输出指出：“之前你只关注边长、认为所有三角形都适用；这次已把适用范围限定为直角三角形，并指出斜边对应直角。”专项样例从“只有直接债权债务联系才会传播系统性风险”的表达出发。后续人工复核发现部分问题仍然缺少区分力、提前给出待问结论或依赖未建立的前置知识；这些发现及修正后的证据另列于下节。

真实调用使用合成回答，没有使用真实学生数据。专项真实样例仅将用量日志数据库写入替换成本地记录，教学评估、教学选择及审核仍调用真实模型。开发及日常测试默认仍为 Mock。自动测试和这些有限样例证明本轮实现与所测行为，不能代表真实学生的教学成效或所有未来模型输出。

## 历史阶段：深入复核发现与修正

本次复核继续检查“题目是否真的帮助补齐缺口”，而不只检查反馈字段是否出现：

- 学生误以为所有三角形都适用某关系时，只问满足该关系的正例，可能让错误理解和正确理解得到同样的答案。审核需先按题目实际条件作答，再比较沿用错误主张是否仍能得到可接受答案。
- 解释和题干中的纠错句、复合术语也可能提前给出待答结论。不能只检查是否出现一整段标准答案。
- 尚待学生判断的情形不能提前称为“反例”来暗示结论。页面原有“反例思考”标签改为中性的“情形检验”；生成及审核同时约束这种隐含泄漏，已由学生确认的反例仍可回顾。
- 原命题不等于逆命题；尚未确认的前置定理不能直接当成学生应会的新任务。只说“问题可回答”不足以证明适合当前学生。
- 审核也必须避免误拒：学生已经修正概念后，下一道条件完整的应用题可用于检验应用能力，无须继续区分已经撤回的错误主张。求值题点明已经建立的定理或工具，与直接给出正在追问的条件或结果不同；新增真实审核正例与原有泄漏反例共同检查这一边界。
- 教学审核失败后的重试需要收到具体纠偏要求。纠偏仅使用服务端白名单规则；被拒草稿留在不可信输入区，审核内部答案不进入生成提示或学生记录，原学生回答保持不变。
- 专项知识库中的“理解变化”必须对应当前目标、实际上一问和此前缺口；其他目标或离题的新内容不能算作补齐。
- 专项反馈按已经表达的具体主张说明待核验点。例如“只有直接联系才会传播”的回答，会被说明为把直接联系当成必要条件，并解释这个条件如何影响传播范围的判断；不给出待学生判断的结论。
- 反思阶段把实际反思目标、课程检索、判定规则和反馈记录统一到同一目标，兼容旧会话留下的目标错配。只补充一个知识点时，其他尚未解决的综合迁移缺口继续保留。
- 中途切换的任务在学习轨迹中明确标为已替换，不把新任务的回答归给旧追问。

复核过程保留在 `.data/learning-feedback-recheck/`，真实合成样例逐次另存 `.data/coaching-live/recheck-*.json`。先前失败或人工发现缺陷的批次不计作最终通过；结构检查通过也不能代表审核解释完全正确。

依据 [DeepSeek 官方 thinking 参数文档](https://api-docs.deepseek.com/guides/thinking_mode/)进行过不同审核策略的实测。综合审核独立重新解题曾出现相反事实判断，启用推理后又达到 8000 token 上限而截断，均未视为完成。最终普通生成及内容审核使用低强度推理，内容审核同时列明实际解答依赖的前提方向、类型、来源及原文。服务端拒绝未支持前提、不匹配的引用，以及把学科规则伪装成基础运算；术语命名等正在检验的基础答案不被当作预先必须掌握的知识。精简后的教学审核关闭推理，沿用前层答案专注教学价值；服务端检查两层答案完全一致。这个答案只在本次内部审核的不可信数据区传递，不进入系统规则、生成器或学生记录。两层并非两位独立专家的事实复核，仍需真实样例和人工检查；引用确实存在也不能单独证明推断方向正确。审核自身不嵌套重试，普通有效作答每次尝试最多 3 次模型请求，最多 2 次重试时上限为 9 次，会话锁的有效期同步覆盖这个上限；这是更严格审核带来的额外请求成本。

Nginx 部署模板的读取等待上限同步调整为 600 秒，覆盖默认单次 45 秒、普通作答最多 9 次调用，以及同一路由进入费曼阶段时最多另有 3 次调用及余量。修改模型超时或重试环境配置时需同步重算；本轮只改模板，没有更改或验证任何生产 Nginx 实例。

## 历史阶段复现命令

当前已安装依赖环境使用 PowerShell；pnpm 依赖预检查因本机状态可能触发非交互重装，运行时关闭该预检查，未新增依赖或更改锁文件：

```powershell
$env:PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN = 'false'
pnpm lint
pnpm typecheck
pnpm test
pnpm build

$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm e2e e2e/home-entry.spec.ts e2e/workspace-design.spec.ts
pnpm e2e e2e/coaching-explanation.spec.ts e2e/thinktutor-flow.spec.ts e2e/teacher-assignment-flow.spec.ts e2e/student-knowledge-selection.spec.ts e2e/spec-completion-retry.spec.ts e2e/question-answer-resilience.spec.ts e2e/project-audit-resilience.spec.ts e2e/learning-records.spec.ts e2e/resilience.spec.ts
pnpm e2e e2e/knowledge-runtime.spec.ts e2e/spec-completion-feynman.spec.ts e2e/v12-case-matrix.spec.ts
```

真实模型检查另需本地合法配置的服务端密钥，显式设置 `RUN_DEEPSEEK_LIVE_TEST=true` 后运行；未开启时会跳过，不混入 Mock 验收结论。完整命令：

```powershell
$env:TEST_POSTGRES_PORT = '55437'
$env:RUN_DEEPSEEK_LIVE_TEST = 'true'
node node_modules/tsx/dist/cli.mjs scripts/with-test-postgres.ts -- pnpm test:deepseek:live tests/smoke/coaching-live.test.ts tests/smoke/coaching-v12-live.test.ts
```

上述发布前验收阶段未包含生产部署、阿里云服务状态验证或真实学生使用研究。后续 Render 发布、线上发现及当前候选的未完成验收项见文首。
