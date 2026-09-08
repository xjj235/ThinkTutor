import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { knowledgeRuntimeSchema } from "../src/lib/knowledge/runtime-schemas";
import { z } from "zod";
import { writeFile } from "node:fs/promises";

// Synthetic student responses for transport/workflow checks, not a calibrated Golden Set.
const explanations = [
  "Systemic研究金融体系的功能损害，Systematic研究不可分散的共同市场因子，两者与单个机构风险的研究对象不同。单家机构倒闭不足以认定系统性风险，还要看到影响传播及支付、信贷功能受损。直接债权债务可以传递违约损失；没有直接借贷的机构也可能持有同类资产，因同一冲击同时受损。例如资产价格下降使共同持仓者亏损，去杠杆时被迫集中出售，出售压低价格，使其他持有人遭受进一步损失并再次减仓，形成反馈。如果出售规模有限且关键金融服务能被及时替代，那么未造成广泛功能损害时不能把个体损失直接判断为系统性事件。规模不是唯一依据，关联性和关键业务可替代性也很重要。",
  "我的判断对象是金融体系能否正常提供金融服务，不是某一家公司的盈亏。Systemic指这种体系层面的风险；Systematic指无法通过分散投资消除的共同市场因素，所以二者不能等同。以一类证券贬值为例，银行即使彼此没有借贷，也会因为共同资产敞口而一起承担损失；为降低杠杆同时卖出，又会打低市场报价，让其余持有者损失扩大，价格和处置行为互相强化。另一条链是债务人违约通过直接敞口使债权人受损。若冲击止于单家机构、没有跨主体扩散，且支付结算等服务迅速被其他机构承接，则不应仅凭倒闭认定发生了系统性风险。",
  "我区分三个对象：单体风险关注特定机构，Systemic关注整个金融体系功能，Systematic关注组合不能分散掉的市场因子。认定系统性影响，需要说明传播以及功能损害，而不能只报出一家银行失败。假设几家机构投资同一类债券，即使没有直接借贷，债券下跌也会使它们同时亏损；亏损引发降低杠杆和集中出售，新的出售继续拉低价格，使其他持有者损失加深，从而反馈放大。相较之下，债权债务链由一方不能偿债直接影响另一方。若金融功能没有受到广泛影响且替代服务充分，则上述单体事件不能自动升级为系统性事件；系统重要性还取决于关联和替代难度，不能只看规模。",
  "从研究对象看，金融体系功能受损是Systemic的问题，共同市场波动造成的不可分散风险属于Systematic，单家机构损失又是另一个层次。传播不以直接借贷为唯一前提：共同持有某种资产时，同一个价格冲击可让多家机构同步受损，受损后为去杠杆被迫卖出，卖压降低市场价格，再扩大其他持仓者的损失，这是一条自我强化的机制。直接融资链则是债务人违约造成债权人损失。我还会检查影响是否中断支付或收缩信贷；如果资产能有序处置、关键业务可及时替代而且金融功能保持正常，那么不能只因为某家机构退出就判断存在系统性后果。",
  "不能把个体经营失败、Systemic与Systematic混为一谈。前者针对一个机构，Systemic针对金融体系提供服务的能力，Systematic针对无法分散的共同市场因素。比如共同持仓机构遭遇资产减值时，即使没有彼此借贷也会同时损失；为满足风险限额而集中出售，会进一步压低价格，降低其他机构的资产价值并引出再次出售。违约损失也可以沿直接债权债务关系传播。这些机制是否造成系统性后果，要看支付结算、信贷等功能是否广泛受损。如果其他机构能承接业务且冲击没有继续扩散，则不能根据单家亏损认定系统性风险；规模之外还应考察关联性和服务替代难度。",
  "我会先问金融体系的支付与融资服务是否受到广泛损害，这才是Systemic层面的关注点。Systematic则是分散投资也无法消除的市场因素，与单家机构的个体风险都不能互换。以债券市场为例，共同持有同种债券的机构会一起受到价格下跌冲击，即便它们之间没有直接借贷；若这些机构被迫同时减仓，价格继续下降，其他持有人因此加深损失并再次出售。直接债权债务的违约损失传递则是另一条机制。如果有序承接能防止卖压扩大、关键金融服务持续正常，就不宜把个体事件判断为系统性损害。机构重要性须结合关联性和业务替代性，不能仅以规模排序。",
  "系统性风险的判断单位是金融体系：冲击传播后可能使支付、信贷等服务广泛失灵。Systemic与Systematic的区别在于后者讨论共同市场因子引致的不可分散风险，个别机构损失并非这两个概念的充分依据。假如多家银行持有同类资产，资产贬值会使它们共同受损，银行为降低杠杆而集中抛售，又压低资产价格，使别的持有者损失扩大，这种反馈无须先有直接借贷。若有直接敞口，债务人的违约也能使债权人亏损。如果没有持续传播而且核心服务可被及时替代，则系统功能正常时不应把单体亏损直接归为系统性事件。",
  "我理解的Systemic强调体系整体的金融功能，Systematic强调市场共同因素导致的不可分散性，两者的研究对象不同，不能用某个机构是否倒闭代替分析。共同资产敞口可以连接没有直接借贷的机构：一个价格冲击让它们同步出现损失，去杠杆导致集中的卖出，新的卖压引发价格下跌，再令其余持仓机构受损和减仓，从而放大冲击。直接借贷渠道则通过违约造成债权人的损失。在判断后果时还必须看支付结算、融资功能是否广泛受限；如果关键服务能够及时替代且传播被阻断，单体事件就不一定构成系统性风险。",
  "就研究边界而言，Systemic研究金融体系功能受损，Systematic研究市场共同波动下无法分散的风险，个体风险仅针对特定主体。例如几家机构买入类似的债券，即使没有直接的借贷关系，也会因债券价格回落同时损失；为满足风险约束而被迫卖出，使债券再次降价，让其他持仓者亏损更大并继续减仓，形成出售与价格的反馈。直接债权债务关系则可能传递一方违约的损失。是否达到系统层面，要进一步观察支付和信贷的广泛损害；如果业务容易替代、处置不触发连锁影响，那么某家机构失败不足以支持系统性结论。",
  "先区分体系功能、市场共同因素和单个机构这三个研究层次：它们分别对应Systemic、Systematic和个体风险。Systemic必须结合金融服务功能及影响传播，Systematic讨论无法通过分散化消除的市场风险。共同持仓是非直接借贷渠道，同类资产受冲击可使多家机构一起亏损，随后集中出售压低价格，其他持有人继续亏损并去杠杆，造成价格反馈；债权债务链还会直接传递违约损失。若金融服务能由其他机构无缝承接，且没有广泛传播和功能损害，则不能仅因单家机构退出就判断系统性风险，规模也不是系统重要性的唯一尺度。",
  "我把判断落在体系能否持续提供支付和信贷上。Systemic关注金融体系功能，Systematic指共同市场因素造成的不可分散风险，个体损失不能直接推出前者。假设银行共同持有某类债券，债券下跌会同时造成损失；同步处置压低报价，又使其他持有人亏损并继续减仓。这里的共同暴露和抛售反馈不需要先有直接借贷，直接敞口则能传递违约损失。如果机构无需被迫出售，其他机构也能及时承接金融业务，广泛传播与功能损害不成立，就不能沿用原来的系统性判断。",
  "就当前问题，我先区分单家机构的困境与金融体系的功能受损。Systemic研究后者，Systematic研究不能通过分散投资消除的共同市场因素。例如相似持仓遭遇价格冲击后，各机构为减少杠杆集中出售，卖压造成新的跌价，其他持有人进一步损失并继续卖出，冲击因此放大；债权债务也能传递一方违约的损失。若资产处置有序且支付和融资服务持续正常，只有个体亏损而没有广泛金融功能损害，那么应撤回直接认定系统性事件的结论。",
  "一个可检验的边界是金融服务的可替代性。Systemic看金融体系，Systematic看共同市场因子的不可分散风险，都不能简单用一家机构是否倒闭代替。机构共同持有资产时，价格回落使其同时受损，集中去杠杆又压低资产价格，使别的持有人再次减仓，形成反馈；存在直接敞口时，债务人违约也会造成债权人损失。如果关键服务能够及时替代且冲击没有跨主体扩展，支付与信贷功能仍正常，原来的系统性风险判断就需要修正。",
  "我会沿着冲击、主体反应、反馈和功能后果解释。某类资产跌价让共同持仓机构一起损失；它们同时出售又推动报价下降，使其他持仓者继续损失和出售，随后可能收紧对企业的信贷。Systemic关注这种传播是否损害金融体系功能，Systematic则是无法分散的市场共同因素，个体风险只描述某个主体。若承接买盘充分、出售不必同步，且支付和融资服务不受广泛影响，则这条放大链可能被阻断，不能仅凭单体损失认定系统性事件。",
  "判断不能只贴事件标签。Systemic的对象是金融体系功能，Systematic的对象是共同市场因素引起的不可分散风险。假如共同持仓机构受到资产减值冲击，为缩减杠杆集中抛售，市场价格进一步下跌，其他持有者损失变大并再次卖出，就出现非直接借贷的反馈链；直接债务违约又是另一条损失传递途径。如果业务可被其他机构及时承接，且没有支付或信贷的广泛损害，则应把个体事件与系统性后果区分开，而不是维持原结论。",
  "我用服务能否继续提供来检查结论：Systemic针对金融体系层面，Systematic针对不可分散的共同市场因素，单家公司的盈亏不等于体系功能。共同持有一种资产的机构会同时受到跌价影响，集中减仓使价格再跌，其他持有者损失扩大又继续出售，这是放大过程；债权债务还会直接传递违约损失。若取消同步出售这一条件，并且金融业务能顺利转移、支付和信贷功能保持正常，则同样个体冲击未必产生系统性后果，判断要相应调整。",
  "更完整的解释应同时说出对象和条件。Systemic考察金融体系的支付、融资功能，Systematic考察无法分散的共同市场风险。共同资产敞口使没有互相借贷的主体一起遭受价格损失；主体为降低杠杆而同时出售，使资产价格进一步下降并触发更多出售。直接债权敞口则可能使一方违约转为另一方损失。如果没有持续扩散而且核心金融业务容易替代，金融体系功能并未广泛受损，那么原先把单家机构失败视为系统性事件的判断不能成立。",
  "我把金融功能受损作为Systemic的分析重点，与Systematic的不可分散市场因子以及个体经营风险分开。设想同类资产跌价，共同持有者会同步亏损，受约束的机构被迫出售，卖压再次降低报价，使其他机构亏损更重并继续减仓，可能导致信贷供给收缩。直接借贷违约也可传递损失。若机构有足够空间有序处置且替代服务充分，金融功能没有广泛中断，就应修订系统性判断，不能只看某一机构损失。",
  "先说明为什么不能仅按规模下判断：Systemic讨论整个金融体系的功能损害，还须观察机构关联和关键服务的替代难度；Systematic讨论不可分散的共同市场波动。资产价格冲击经共同持仓造成多主体损失，集中出售又压低价格，使损失和去杠杆互相强化；债权债务的违约损失传递是另一机制。如果关联影响被隔离、服务可迅速承接而且支付融资功能正常，则个体困境不必然造成系统性后果，结论必须随条件改变。",
  "在新的假设情境中，持仓相似的机构会因同一资产贬值一起受损，即便没有彼此借贷。被迫出售带来额外卖压，使其他持仓者继续亏损和出售，形成反馈；若又收紧企业融资，影响可能进入实体经济。Systemic关心金融体系功能，Systematic关心不可分散的市场共同因素，不能与单体失败混同。若移除被迫同步出售的条件，且关键金融服务可替代、没有广泛功能损害，原来的系统性判断应相应减弱或撤回。",
  "我的结论需要三层区分：个体风险对应特定机构，Systemic对应金融体系功能，Systematic对应无法分散的市场共同因素。共同持仓的资产跌价会造成同步损失，去杠杆时集中卖出又压低价格，其他持有者进一步受损并继续出售；直接债权债务还能传递违约损失。是否形成系统性后果，要检验支付结算和信贷是否广泛受限。如果业务能够及时替代且传播被阻断，就不能维持只凭单体失败作出的体系风险结论。",
  "我将条件变化明确写出来。共同资产敞口使多家机构一同遭受价格冲击，随后集中出售、价格再跌、其他机构损失增加，可能压缩金融体系的融资服务，这是Systemic关注的传播与放大。Systematic则指分散投资也不能消除的共同市场因素，单家机构失败不能直接代表二者。直接融资关系也可能传递违约损失。如果出售可以分散进行且关键支付和信贷服务正常，则反馈减弱，原先的系统性后果判断需要重新检验。",
  "从金融体系而非单个机构出发，Systemic要求考察支付和融资等功能的广泛损害；Systematic研究市场共同因素造成的不可分散风险。相似资产价格下跌导致共同持有人一起亏损，机构为满足约束而同时减仓，进一步打低价格并引发别的机构继续减仓，形成反馈循环；直接债权链也能传递违约损失。如果资产有序处置、业务可替代且冲击没有继续传播，就应修订仅凭单体亏损作出的系统性判断。",
  "我保留对象、机制、边界三个部分：金融体系功能是Systemic的对象，共同市场因素的不可分散性是Systematic的对象，个体盈亏是另一层次。共同持仓遭受冲击后集中出售，卖压造成进一步跌价，其他持有人追加损失并再次出售，影响可能扩大到信贷服务；债权债务关系还会传递违约损失。若关键业务可被及时承接，并且没有广泛支付或信贷损害，同样的单体事件就不能沿用系统性后果的判断。",
  "这次自主说明以反事实检验收尾。Systemic考察金融体系功能，不等于某家机构倒闭；Systematic考察共同市场因子产生的不可分散风险。共同持有的资产跌价会使机构同步损失，受约束的集中抛售又压低价格，迫使其他持有人继续减仓，形成放大反馈；直接借贷也能传递违约损失。如果同步出售被有序处置取代、关键金融服务可替代且没有广泛功能损害，那么原先的系统性风险结论必须随条件变化而调整。",
];
const caseAnswers: Record<string, string> = {
  CASE_SR_001: "题中的初始冲击是房地产下跌、违约上升。A、B、C共同持有房地产相关资产，因此虽无直接借贷也会同时受损；损失引发去杠杆和集中出售，出售使市场报价再跌，其他持有者损失扩大并可能再卖出。若银行随后因损失收紧信贷，企业投资和就业可能受抑制，这是待核验的后续后果，不是题干已经发生的事实。如果有充足流动性且能有序处置，则出售反馈可能减弱；是否已形成系统性事件还需核实金融功能损害。",
  CASE_SR_002: "这是一家小型机构经营失败的个体冲击。题目明确其他机构没有资产损失、未出现恐慌或明显信贷收缩，支付结算也能迅速迁移，因此没有给出跨机构传播与反馈放大，更没有金融体系功能受损的证据，不能直接认定为系统性事件。如果其关键服务无法替代并使多家机构支付中断，则系统性判断需要改变。",
  CASE_SR_003: "起点是A公布资产损失，储户集中取款造成即时现金需要，但长期资产不能立即无损变现，因此A被迫出售，出售压低价格，形成进一步亏损。关于B、C也可能有问题的信息改变预期，储户因担忧而提款，信心和行为由A扩散到别的银行，并使同业融资更紧张。若这种反馈导致支付或信贷服务广泛受限，会损害系统功能；若可信信息和流动性支持阻断提款扩散，则不能把原有损失直接等同于系统性后果。",
  CASE_SR_004: "繁荣期间地产融资和杠杆扩张累积脆弱性；房价下跌后，共同地产敞口使银行同时受损，银行去杠杆并出售相关资产，卖压进一步降低价格并放大损失。信贷收紧使企业融资成本提高，投资和就业下降，经济放缓又可能增加违约，这是金融与实体经济之间的反馈。若初始杠杆较低且资产分散、融资替代充足，则同样房价冲击的传播和放大未必如此强。",
  CASE_SR_005: "初始冲击是某类债券价格骤降。多家机构的相似持仓使损失同时出现，风险限额及现金需求促使机构去杠杆、集中卖出，进一步降低价格，使其他持仓者账面损失增加并继续减仓。这体现共同暴露转为抛售反馈；是否已损害整个金融体系的融资功能，题中证据仍不充分。如果市场有足够承接能力且机构不用被迫同步卖出，则反馈可显著减弱，系统性后果的判断也应调整。",
  CASE_SR_006: "冲击是支付清算机构运营故障，而非其重大资产亏损。因为多家机构依赖它，故障使结算延迟及交易无法完成；参与者提高现金储备、减少交易，可能放大融资与流动性压力。支付功能已经跨机构受阻，不能仅用故障机构的资产规模判断后果。如果存在可立即切换的替代清算通道，则传播范围和功能损害会缩小。",
  CASE_SR_007: "市场下跌触发每家机构减少风险资产，从单体看可能降低暴露，但它们同步出售造成额外卖压，压低价格后又触发更多减仓，形成价格和行为的正反馈。个体理性不必然保证整体安全。题目尚未直接说明支付或信贷已广泛中断，系统性功能后果仍需查证；如果卖出节奏分散且有充足承接者，则同样自保行为未必产生如此强的放大。",
  CASE_SR_008: "不能只凭X规模大就认定其系统重要性高。X的服务易替代，而Y与关键市场联系广且承担短期不可替代的业务，Y出问题时更可能通过这些联系传播并中断关键金融功能。这里讨论的是假设其受冲击后的传播与后果，而非题干已发生危机。如果Y的关键服务有即时替代且关联被隔离，那么其传播、放大及功能中断的可能性会降低，相应的重要性排序也需要重新判断。",
};

const partialExplanations = [
  "Systemic关注金融体系的功能，单家机构倒闭并不足以证明系统性风险。我的分析目前停留在这个概念层面，尚未解释题目中的传播过程。",
  "我会以整个金融体系为研究对象，而不是只看一家机构的资产损失。这次回答仅说明判断范围，还没有把情境中的原因与结果联系起来。",
  "系统性风险涉及金融服务的广泛损害。对当前材料，我只能说明需要考察这一后果，尚未分析它具体如何形成。",
  "个体经营失败不等同于金融体系功能受损，这是我能够说明的界限。当前回答没有解释主体之间的联系，也没有给出条件变化后的判断。",
  "我理解Systemic的研究对象是金融体系，Systematic讨论不可分散的市场因素。不过我的回答还只是术语区分，没有完成具体情境分析。",
  "判断系统性影响不能停留在一家机构的损失，需要考察支付和融资服务。这里我只提出判断对象，没有展开事件如何影响这些功能。",
  "我把金融体系能否提供服务作为判断范围，单体机构的成败不是充分依据。但目前没有给出例子，也没有建立因果链条。",
  "系统性风险属于金融体系层面，而不是某一家公司的经营风险。就这一情境，我的回答只完成了概念定位，其余分析尚未展开。",
  "金融服务功能是我判断Systemic的出发点，不能仅因某家机构退出就直接下结论。这个回答还没有说明传播方式及其成立条件。",
  "我能够区分个体风险与体系层面的功能问题。对于材料要求的机制、例证和条件修订，我目前只保留问题，还没有提出具体论证。",
];
const reflections = [
  "我已能区分Systemic研究金融体系功能、Systematic研究不可分散的市场因子，单家机构失败也不等于系统性事件。但本轮对冲击、跨机构传播、反馈放大和金融功能后果之间的完整联系仍解释不足，尤其还不能为当前情境给出具体的条件变化与结论修订。这些部分需要继续定向练习。",
  "回看本轮作答，我已经明确研究对象是金融体系，也不再把单家机构损失作为充分依据。我的不足在于没有把具体材料中的因果过程写出来，尚未完成机制例证和适用条件的分析，所以仍需针对这些缺口继续练习。",
  "这次修订保留体系功能与个体事件之间的区别：Systemic关注体系层面的金融服务，不能只根据单体失败判断。对于其余部分，我尚未给出完整的传播分析，也还没有论证改变条件后结论如何调整。",
];

for (const scenario of ["mastery", "gap-retry"] as const) {
test(`real model complete learning loop: ${scenario}`, async ({ page }, testInfo) => {
  test.skip(process.env.RUN_PREVIEW_LIVE_FULL_TEST !== "true", "Full live calls require explicit opt-in.");
  test.setTimeout(15 * 60_000);
  page.setDefaultTimeout(15_000);
  const base = new URL(process.env.PREVIEW_BASE_URL!);
  const databaseUrl = new URL(process.env.PREVIEW_DATABASE_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(base.hostname);
  expect(databaseUrl.hostname).toBe("127.0.0.1");
  expect(databaseUrl.pathname).toBe("/thinktutor_preview");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl.href, max: 2 }) });
  const email = `live-full-${crypto.randomUUID()}@example.test`;
  const calls: number[] = [];
  async function pace(cost: number) {
    while (calls.filter((time) => Date.now() - time < 65_000).length + cost > 10) await page.waitForTimeout(5_000);
    for (let i = 0; i < cost; i++) calls.push(Date.now());
  }
  async function submit(button: string, endpoint: string, cost = 3) {
    await pace(cost);
    const pending = page.waitForResponse((r) => r.url().endsWith(endpoint) && r.request().method() === "POST", { timeout: 150_000 });
    await page.getByRole("button", { name: button, exact: true }).click();
    const response = await pending;
    expect(response.status(), await response.text()).toBeLessThan(300);
  }
  try {
    expect(await (await page.request.get("/api/health/ready")).text()).toContain('"aiProvider":"deepseek"');
    await page.goto("/register");
    await page.getByLabel("姓名").fill("真实模型闭环验证");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(`Live-${crypto.randomUUID()}`);
    await page.getByRole("button", { name: "创建学生账号" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/learn/new");
    await page.getByRole("textbox", { name: "知识点" }).fill("系统性风险");
    await page.getByRole("textbox", { name: "学习目标" }).fill("以概念、假设条件、机制和未见情境检验系统性风险判断。");
    await page.getByLabel("学习者水平").selectOption("有基础");
    await submit("创建并开始学习", "/api/sessions", 1);
    await expect(page).toHaveURL(/\/session\//);
    const sessionId = page.url().split("/session/")[1];
    await submit("确认目标并开始", "/events", 1);
    await submit("申请提示", "/hint", 1);
    let resumed = false;
    let partialIndex = 0;
    let reflectionIndex = 0;
    for (let turn = 0; turn < 25; turn++) {
      const saved = await prisma.learningSession.findUniqueOrThrow({ where: { id: sessionId } });
      const runtime = knowledgeRuntimeSchema.parse(saved.knowledgeRuntime);
      const state = runtime.v12!;
      console.log(JSON.stringify({ liveTurn: turn, stage: state.pedagogicalStage, result: state.lastResult, target: runtime.currentTargetId, caseId: state.currentCaseId }));
      if (saved.phase === "COMPLETED") break;
      if (!resumed && turn === 2) { await submit("恢复核验", "/events", 1); resumed = true; continue; }
      const reflection = state.pedagogicalStage === "REFLECTION";
      const content = reflection
        ? reflections[reflectionIndex++]
        : scenario === "gap-retry" && state.pedagogicalStage !== "DIAGNOSIS"
        ? partialExplanations[partialIndex++]
        : explanations[turn] ? `${state.currentCaseId ? caseAnswers[state.currentCaseId] : ""}${explanations[turn]}` : undefined;
      if (!content) throw new Error("Synthetic answers exhausted; do not recycle text as independent evidence.");
      if (saved.phase === "FEYNMAN") {
        await page.getByLabel(reflection ? "反思修订" : "费曼阐释").fill(content);
        await submit(reflection ? "提交修订并生成报告" : "提交讲解", "/feynman");
      } else {
        await page.getByLabel("独立作答").fill(content);
        await submit("提交回答", "/answers");
      }
      if (turn === 1 || state.pedagogicalStage === "CASE_TRANSFER") await page.screenshot({ path: testInfo.outputPath(`live-loop-${turn}.png`), fullPage: true });
    }
    await expect(page).toHaveURL(/\/report\//);
    await expect(page.getByText("五维能力评估")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("real-loop-report.png"), fullPage: true });
    const before = await page.request.get(`/api/reports/${sessionId}`);
    const beforeReport = z.object({ data: z.unknown() }).parse(await before.json()).data;
    const grading = z.object({ report: z.object({ dimensions: z.object({ conceptCompleteness: z.object({ score: z.number() }) }) }) }).parse(beforeReport);
    expect(grading.report.dimensions.conceptCompleteness.score, "Explicitly demonstrated conceptual scope must not be lost in the final evidence window.").toBeGreaterThan(0);
    await page.reload();
    expect(z.object({ data: z.unknown() }).parse(await (await page.request.get(`/api/reports/${sessionId}`)).json()).data).toEqual(beforeReport);
    const ids = [sessionId];
    if (scenario === "gap-retry") {
      await submit("开启定向巩固", "/retry", 1);
      await expect(page).toHaveURL(/\/session\//);
      const childId = page.url().split("/session/")[1];
      expect(childId).not.toBe(sessionId);
      ids.push(childId);
    } else {
      await expect(page.getByRole("button", { name: "暂无待巩固要点" })).toBeDisabled();
    }
    const sessions = await prisma.learningSession.findMany({ where: { id: { in: ids } } });
    const history = sessions.flatMap((s) => knowledgeRuntimeSchema.parse(s.knowledgeRuntime).v12!.coachingHistory);
    const kinds = [...new Set(history.map((h) => h.kind))];
    expect(kinds).toEqual(expect.arrayContaining(["GOAL", "DIAGNOSIS", "HINT", "RESUME", "CASE", "REFLECTION", "REPORT", ...(scenario === "gap-retry" ? ["QUESTION", "RETRY"] : ["FEYNMAN"])]));
    const usage = await prisma.aIUsage.findMany({ where: { requestId: { in: history.map((h) => h.requestId) }, status: "SUCCESS" }, select: { requestId: true, provider: true, model: true, operation: true, promptTokens: true, completionTokens: true } });
    expect(usage).toHaveLength(history.length);
    expect(usage.every((u) => u.provider === "deepseek" && u.operation === "teaching_selection" && (u.promptTokens ?? 0) > 0)).toBe(true);
    const generated = history.filter((h) => h.followUp);
    const reviews = await prisma.aIUsage.findMany({ where: { requestId: { in: generated.map((h) => `${h.requestId}:review`) }, operation: "teaching_review", status: "SUCCESS" } });
    for (const item of generated) expect(reviews.some((review) => review.requestId === `${item.requestId}:review` && review.provider === "deepseek" && (review.promptTokens ?? 0) > 0)).toBe(true);
    const evidencePath = testInfo.outputPath("real-loop-evidence.json");
    await writeFile(evidencePath, JSON.stringify({ scenario, kinds, usage, history, report: beforeReport }, null, 2), "utf8");
    await testInfo.attach("real-loop-evidence", { path: evidencePath, contentType: "application/json" });
    console.log(JSON.stringify({ realLoopVerified: { kinds, calls: usage.length, model: usage[0]?.model } }));
  } finally {
    try { await prisma.user.deleteMany({ where: { email, role: "STUDENT" } }); }
    finally { await prisma.$disconnect(); }
  }
});
}
