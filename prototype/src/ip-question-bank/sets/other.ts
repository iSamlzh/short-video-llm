import { buildIndustryQuestionSet } from "../build-industry-question-set"

export const otherV1 = buildIndustryQuestionSet({
  category: "other",
  label: "自定义行业",
  audience: "最需要你这类经验、产品或服务的人",
  stages: "刚开始了解、正在比较、准备行动、已经使用和持续复购",
  problems: "真实工作、生活场景、选择判断和结果预期",
  misconceptions: "行业常识、选择方法、使用方式和价值判断",
  decisionObject: "你的产品、服务或专业建议",
  knowledge: "真实工作经验、行业判断、用户问题和使用场景",
  workScenes: "工作过程、产品演示、客户沟通或服务交付现场",
  assets: "工作记录、产品资料、用户提问、案例过程或现场素材",
  product: "你的主要产品",
  service: "你的主要服务",
  nonSalesTopics: "行业常识、真实经验、选择方法和工作过程",
})
