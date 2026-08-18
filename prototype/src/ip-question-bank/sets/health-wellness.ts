import { buildIndustryQuestionSet } from "../build-industry-question-set"

export const healthWellnessV1 = buildIndustryQuestionSet({
  category: "health_wellness",
  label: "健康养生",
  audience: "关注自己和家人日常健康的人",
  stages: "精力管理、饮食调整、睡眠改善、日常养护和中老年生活管理",
  problems: "饮食、睡眠、精力、日常养护和健康产品选择",
  misconceptions: "健康习惯、滋补方式和产品使用",
  decisionObject: "健康产品、滋补产品或健康管理服务",
  knowledge: "日常养护、原料知识、使用场景和生活习惯",
  workScenes: "健康咨询、产品讲解、日常服务或原料选择现场",
  assets: "产品资料、服务记录、用户提问、讲解素材或真实生活场景",
  product: "健康产品或滋补产品",
  service: "健康管理、咨询或陪伴服务",
  nonSalesTopics: "饮食、作息、精力和日常养护知识",
})
