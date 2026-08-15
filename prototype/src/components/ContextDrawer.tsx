export function ContextDrawer({ run }: { run: any }) {
  return <details className="context-drawer">
    <summary>查看本次内容上下文</summary>
    <dl><dt>IP</dt><dd>{run.ipProfile?.displayName}</dd><dt>当前阶段</dt><dd>{run.state}</dd></dl>
  </details>
}
