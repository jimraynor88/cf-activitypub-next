interface PageLayoutProps {
  sidebar?: React.ReactNode;
  children: React.ReactNode;
  rightPanel?: React.ReactNode;
}

export function PageLayout({ sidebar, children, rightPanel }: PageLayoutProps) {
  return (
    <div className="page-grid">
      {sidebar && <aside className="page-sidebar">{sidebar}</aside>}
      <main className="page-main">{children}</main>
      {rightPanel && <div className="page-right">{rightPanel}</div>}
    </div>
  );
}