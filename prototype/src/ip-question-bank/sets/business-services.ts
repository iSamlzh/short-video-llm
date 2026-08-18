import { buildIndustryQuestionSet } from "../build-industry-question-set"

export const businessServicesV1 = buildIndustryQuestionSet({
  category: "business_services",
  label: "创业经营与商业服务",
  audience: "正在创业、经营业务或负责增长的人",
  stages: "想法验证、起步获客、稳定交付、团队协作和规模增长",
  problems: "定位、获客、成交、交付、团队、成本和经营判断",
  misconceptions: "增长捷径、客户价值、经营规模和方法论",
  decisionObject: "商业服务、咨询方案或合作机会",
  knowledge: "业务阶段、经营难题、客户决策、交付过程和合作边界",
  workScenes: "客户沟通、方案制定、交付复盘、团队协作或经营现场",
  assets: "经营记录、方案片段、客户问题、交付过程或失败复盘",
  product: "商业产品、工具或解决方案",
  service: "咨询、代运营、培训或企业服务",
  nonSalesTopics: "经营判断、客户理解、交付方法和失败经验",
})
