import { buildIndustryQuestionSet } from "../build-industry-question-set"

export const beautySkincareV1 = buildIndustryQuestionSet({
  category: "beauty_skincare",
  label: "美容护肤",
  audience: "希望改善日常护肤体验的人",
  stages: "基础护理、问题改善、成分学习、门店护理和长期皮肤管理",
  problems: "肤质判断、护肤步骤、成分选择、使用方法和效果预期",
  misconceptions: "肤质、成分、护肤顺序和产品搭配",
  decisionObject: "护肤产品、美容项目或皮肤管理服务",
  knowledge: "肤质、成分、护理步骤、产品搭配和使用边界",
  workScenes: "肤质沟通、产品试用、护理流程或门店服务现场",
  assets: "成分资料、产品试用、护理过程、用户提问或门店场景",
  product: "护肤产品或美容产品",
  service: "美容护理或皮肤管理服务",
  nonSalesTopics: "肤质认知、护肤步骤、成分常识和使用误区",
})
