import { buildIndustryQuestionSet } from "../build-industry-question-set"

export const educationKnowledgeV1 = buildIndustryQuestionSet({
  category: "education_knowledge",
  label: "教育培训与知识服务",
  audience: "希望提升某项知识或能力的学习者",
  stages: "刚开始了解、建立基础、突破卡点、持续练习和获得反馈",
  problems: "学习目标、方法选择、练习、反馈、坚持和能力应用",
  misconceptions: "学习速度、方法效果、课程选择和能力形成",
  decisionObject: "课程、训练方案或知识服务",
  knowledge: "学习阶段、方法、练习、反馈、案例和知识边界",
  workScenes: "讲解、练习反馈、课程准备、答疑或学员服务现场",
  assets: "课程片段、练习案例、学员提问、方法演示或反馈记录",
  product: "课程、资料或学习产品",
  service: "培训、咨询、陪练或知识服务",
  nonSalesTopics: "学习方法、常见卡点、练习设计和知识应用",
})
