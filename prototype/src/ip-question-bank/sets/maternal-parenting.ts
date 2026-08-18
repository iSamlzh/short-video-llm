import { buildIndustryQuestionSet } from "../build-industry-question-set"

export const maternalParentingV1 = buildIndustryQuestionSet({
  category: "maternal_parenting",
  label: "母婴育儿",
  audience: "处在孕产或婴幼儿养育阶段的家庭",
  stages: "备孕孕期、产后恢复、新生儿照护、幼儿成长和家庭陪伴",
  problems: "喂养、照护、陪伴、成长问题、用品选择和家庭分工",
  misconceptions: "育儿方法、用品选择、成长节奏和家长角色",
  decisionObject: "母婴用品、育儿课程或家庭服务",
  knowledge: "孕产经验、婴幼儿照护、家庭陪伴和用品选择",
  workScenes: "家庭照护、用品使用、亲子陪伴或服务沟通现场",
  assets: "育儿记录、用品演示、家庭场景、家长提问或服务过程",
  product: "母婴用品或家庭产品",
  service: "育儿指导、家庭陪伴或母婴服务",
  nonSalesTopics: "家庭陪伴、成长观察、照护经验和家长情绪",
})
