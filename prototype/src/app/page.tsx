import { PrototypeWorkspace } from "../components/PrototypeWorkspace"

const demoProfile = {
  displayName: "林姐",
  experience: "五年社区零售与团购运营经历，服务过十二个小区，长期负责选品、社群维护和团长培训",
  expertise: "社区团购选品与团长运营",
  audience: "想做本地生意的宝妈和小店主",
  voiceStyle: "直白、温和、喜欢讲真实案例",
  boundaries: "不承诺收入，不虚构成功案例，不贬低其他平台",
}

export default async function HomePage({ searchParams }: { searchParams?: Promise<{ demo?: string }> }) {
  const demo = (await searchParams)?.demo === "1"
  return <PrototypeWorkspace initialProfile={demo ? demoProfile : undefined} />
}
