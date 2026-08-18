import {
  QUESTION_SET_VERSION,
  QUESTION_SLOTS,
  type IndustryCategory,
  type PortraitQuestionInput,
  type QuestionSlot,
} from "../domain/ip-onboarding"
import { defineQuestion, defineQuestionSet } from "./define-question-set"
import { requireQuestionSlot } from "./question-slots"

export type IndustryQuestionContext = {
  category: IndustryCategory
  label: string
  audience: string
  stages: string
  problems: string
  misconceptions: string
  decisionObject: string
  knowledge: string
  workScenes: string
  assets: string
  product: string
  service: string
  nonSalesTopics: string
}

type PromptFactory = (context: IndustryQuestionContext) => string

const promptFactories: Record<QuestionSlot, PromptFactory> = {
  audience_primary: context => `在${context.label}内容里，你最希望哪类人刷到你的视频？`,
  audience_stage: context => `这些人目前更接近${context.stages}中的哪种阶段？`,
  audience_urgent_problem: context => `他们在${context.problems}方面最常因为什么具体事情来问你？`,
  audience_misconception: context => `围绕${context.misconceptions}，他们最容易误解什么？`,
  audience_decision_concern: context => `他们决定是否了解${context.decisionObject}时最担心什么？`,
  credibility_experience: context => `你有哪些真实经历能证明你适合长期讲${context.label}？`,
  professional_judgement: context => `关于${context.knowledge}，你最有把握讲清楚哪类判断？`,
  distinct_belief: context => `在${context.label}这件事上，你有哪些观点和常见说法不一样？`,
  repeat_principle: context => `你最希望观众反复记住哪条${context.label}原则？`,
  failure_story: context => `你有哪些可以公开讲的${context.label}踩坑或判断失误经历？`,
  success_process: context => `你有哪些可以公开讲的${context.label}长期实践或服务过程？`,
  work_scene: context => `你的日常工作中有哪些${context.workScenes}可以直接拍摄？`,
  existing_assets: context => `你现在已经有哪些${context.assets}可以作为内容素材？`,
  question_sources: context => `关于${context.problems}的真实问题通常从哪些用户场景来到你这里？`,
  natural_narrative: context => `讲${context.label}内容时，你最自然的方式是哪一种？`,
  preferred_structure: context => `一条${context.label}口播里，你更适合用什么顺序展开？`,
  opening_style: context => `你平时讲${context.label}时最自然的开场白是什么？`,
  persona_impression: context => `你希望观众看完几条${context.label}内容后用哪三个词形容你？`,
  product_connection: context => `${context.product}更适合通过哪种内容方式自然出现？`,
  service_connection: context => `${context.service}最适合在哪类内容中自然出现？`,
  non_sales_content: context => `即使完全不介绍产品或服务，你仍愿意长期分享哪些${context.nonSalesTopics}？`,
  desired_action: context => `观众看完${context.label}内容后，你最希望他做什么？`,
  undesired_action: context => `哪些行动引导会让你的${context.label}内容显得过度销售？`,
  forbidden_promises: context => `围绕${context.decisionObject}，有哪些承诺或结果你明确不会说？`,
  private_boundaries: context => `哪些个人经历、客户信息或工作细节不适合在${context.label}内容中公开？`,
  misunderstood_expression: context => `你讲${context.knowledge}时，哪些表达最容易被观众误解？`,
  month_one_topics: context => `如果第一个月只讲三个${context.label}主题，你会优先讲什么？`,
  series_topics: context => `哪些${context.problems}适合做成连续十期以上的内容系列？`,
  new_direction: context => `除了现在熟悉的内容，你还想验证哪个新的${context.label}选题方向？`,
  missing_evidence: context => `为了把${context.label}内容讲得更真实，你目前最缺少哪类素材或依据？`,
}

const choiceOptions: Partial<Record<QuestionSlot, PortraitQuestionInput["options"]>> = {
  natural_narrative: [
    { value: "story", label: "讲真实故事", signals: ["format:story"] },
    { value: "qa", label: "回答具体问题", signals: ["format:qa"] },
    { value: "myth", label: "拆解常见误区", signals: ["format:myth"] },
    { value: "process", label: "展示工作过程", signals: ["format:process"] },
    { value: "custom", label: "自己填写", signals: ["format:custom"] },
  ],
  preferred_structure: [
    { value: "conclusion_first", label: "先给结论", signals: ["structure:conclusion_first"] },
    { value: "scene_first", label: "先讲场景", signals: ["structure:scene_first"] },
    { value: "question_first", label: "先提问题", signals: ["structure:question_first"] },
    { value: "experience_first", label: "先讲经历", signals: ["structure:experience_first"] },
  ],
  product_connection: [
    { value: "knowledge", label: "知识讲解", signals: ["commercial:knowledge"] },
    { value: "scene", label: "真实使用场景", signals: ["commercial:scene"] },
    { value: "selection", label: "选择方法", signals: ["commercial:selection"] },
    { value: "story", label: "产品或品牌故事", signals: ["commercial:story"] },
    { value: "none", label: "暂时不出现", signals: ["commercial:none"] },
  ],
  desired_action: [
    { value: "follow", label: "关注账号", signals: ["cta:follow"] },
    { value: "comment", label: "留言互动", signals: ["cta:comment"] },
    { value: "consult", label: "进一步咨询", signals: ["cta:consult"] },
    { value: "learn_product", label: "了解产品或服务", signals: ["cta:learn_product"] },
    { value: "custom", label: "自己填写", signals: ["cta:custom"] },
  ],
}

const anchorSlots = new Set<QuestionSlot>([
  "audience_primary",
  "audience_urgent_problem",
  "existing_assets",
  "desired_action",
])

const optionalSlots = new Set<QuestionSlot>([
  "failure_story",
  "success_process",
  "work_scene",
  "existing_assets",
  "new_direction",
  "missing_evidence",
])

function buildQuestion(context: IndustryQuestionContext, slot: QuestionSlot, index: number) {
  const slotDefinition = requireQuestionSlot(slot)
  const options = choiceOptions[slot]
  return defineQuestion({
    id: `${context.category.replaceAll("_", "-")}-v1-q${String(index + 1).padStart(2, "0")}`,
    slot,
    dimension: slotDefinition.dimension,
    prompt: promptFactories[slot](context),
    answerType: options ? (slot === "product_connection" ? "multi_choice" : "single_choice") : "long_text",
    options,
    requiredAnchor: anchorSlots.has(slot),
    canAnswerNone: optionalSlots.has(slot),
    priority: anchorSlots.has(slot) ? 100 - [...anchorSlots].indexOf(slot) : 80 - index,
    trigger: { kind: "always" },
    outputFields: [...slotDefinition.outputFields],
    topicSignals: [...slotDefinition.topicSignals, `industry:${context.category}`, `slot:${slot}`],
    status: "active",
  })
}

export function buildIndustryQuestionSet(context: IndustryQuestionContext) {
  return defineQuestionSet({
    version: QUESTION_SET_VERSION,
    industryCategory: context.category,
    questions: QUESTION_SLOTS.map((slot, index) => buildQuestion(context, slot, index)),
  })
}
