export function PlatformMasthead({ operatorName, role = "平台运营" }: { operatorName: string; role?: string }) {
  return <header className="masthead platform-masthead">
    <div className="masthead-left"><span className="product-name">平台内容大脑</span><span className="platform-scope">样本到结构闭环</span></div>
    <div className="context-navigation"><strong>内部安全域</strong><span /><span>{role}：{operatorName}</span></div>
  </header>
}
