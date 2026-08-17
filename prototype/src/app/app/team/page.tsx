import { TeamDelegationView } from "@/components/team/TeamDelegationView"
import { demoProductData } from "@/presets/product-demo"

export default function TeamPage() { return <main><TeamDelegationView delegation={demoProductData.delegation} /></main> }
