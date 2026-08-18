import { buildIndustryQuestionSet } from "../build-industry-question-set"

export const fashionStyleV1 = buildIndustryQuestionSet({
  category: "fashion_style",
  label: "服饰穿搭",
  audience: "希望找到适合自己穿衣方式的人",
  stages: "基础搭配、身形修饰、场合穿搭、风格形成和衣橱升级",
  problems: "身形、尺码、面料、颜色、场合、搭配和退换选择",
  misconceptions: "身材限制、流行趋势、面料价值和搭配规则",
  decisionObject: "服饰产品、穿搭方案或形象服务",
  knowledge: "身形、场合、风格、面料、尺码和搭配逻辑",
  workScenes: "选款、试穿、搭配、面料比较或顾客沟通现场",
  assets: "试穿视频、搭配对比、面料细节、选款过程或顾客问题",
  product: "服饰、配饰或穿搭产品",
  service: "穿搭建议、选款或形象管理服务",
  nonSalesTopics: "身形认知、搭配方法、面料知识和场合审美",
})
