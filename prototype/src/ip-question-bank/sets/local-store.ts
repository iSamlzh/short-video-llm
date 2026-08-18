import { buildIndustryQuestionSet } from "../build-industry-question-set"

export const localStoreV1 = buildIndustryQuestionSet({
  category: "local_store",
  label: "本地生活与实体门店",
  audience: "生活在门店周边或关注本地服务的人",
  stages: "第一次了解到店、比较选择、体验服务、解决问题和长期复购",
  problems: "到店体验、服务流程、价格判断、现场细节和售后",
  misconceptions: "门店价值、服务差异、价格构成和本地口碑",
  decisionObject: "门店商品、本地服务或到店体验",
  knowledge: "门店经营、服务流程、街区关系、顾客问题和口碑维护",
  workScenes: "开店准备、服务过程、商品制作、顾客沟通或售后现场",
  assets: "门店现场、服务过程、顾客提问、商品细节或街区故事",
  product: "门店商品或本地产品",
  service: "到店、本地生活或社区服务",
  nonSalesTopics: "门店日常、街区关系、服务细节和本地生活经验",
})
