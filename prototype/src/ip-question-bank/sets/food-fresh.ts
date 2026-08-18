import { buildIndustryQuestionSet } from "../build-industry-question-set"

export const foodFreshV1 = buildIndustryQuestionSet({
  category: "food_fresh",
  label: "食品生鲜",
  audience: "关注家庭餐桌和食材品质的人",
  stages: "日常采购、品质比较、储存处理、家庭烹饪和长期复购",
  problems: "产地、选品、口感、保存、烹饪和售后判断",
  misconceptions: "食材新鲜度、品质标准、价格差异和保存方式",
  decisionObject: "食品、生鲜食材或家庭餐桌方案",
  knowledge: "产地、供应链、品质、储存、烹饪和售后",
  workScenes: "采购验货、产地走访、分拣包装、烹饪或售后处理现场",
  assets: "产地资料、验货记录、食材对比、烹饪过程或顾客反馈",
  product: "食品或生鲜食材",
  service: "选品、配送或家庭餐桌服务",
  nonSalesTopics: "食材知识、保存方法、烹饪技巧和品质判断",
})
