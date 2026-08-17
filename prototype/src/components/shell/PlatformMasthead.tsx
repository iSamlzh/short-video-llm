export function PlatformMasthead({ operatorName }: { operatorName: string }) {
  return <header className="masthead platform-masthead">
    <div className="masthead-left"><span className="product-name">平台内容大脑</span></div>
    <div className="context-navigation"><strong>内部安全域</strong><span /><span>内容负责人：{operatorName}</span><span /><time dateTime="2026-08-17">2026-08-17</time></div>
  </header>
}
