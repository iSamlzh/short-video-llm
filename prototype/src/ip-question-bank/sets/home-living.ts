import { buildIndustryQuestionSet } from "../build-industry-question-set"

export const homeLivingV1 = buildIndustryQuestionSet({
  category: "home_living",
  label: "家居日用",
  audience: "希望提升家庭空间和生活效率的人",
  stages: "新家准备、日常使用、空间整理、清洁维护和用品升级",
  problems: "空间、收纳、清洁、耐用性、使用方法和选购",
  misconceptions: "家居尺寸、使用功能、清洁方式和耐用标准",
  decisionObject: "家居用品、日用产品或家庭整理服务",
  knowledge: "空间利用、收纳、清洁、材质、耐用性和使用演示",
  workScenes: "家庭使用、空间改造、清洁测试、产品演示或上门服务现场",
  assets: "空间照片、使用演示、前后对比、材质资料或家庭场景",
  product: "家居用品或日用产品",
  service: "整理、清洁或家庭空间服务",
  nonSalesTopics: "空间规划、收纳方法、清洁技巧和生活效率",
})
