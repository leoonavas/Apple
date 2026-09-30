"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChartNoAxesCombined, MessageCircle, ReceiptText, Settings2, LogOut, Menu, X, WalletCards, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

const nav = [
  { href: "/", label: "Chat", icon: MessageCircle },
  { href: "/transactions", label: "Movimentações", icon: ReceiptText },
  { href: "/summary", label: "Resumo", icon: ChartNoAxesCombined },
  { href: "/wallets", label: "Carteiras", icon: WalletCards },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [];
    const first = focusable()[0];
    first?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        window.requestAnimationFrame(() => menuTriggerRef.current?.focus());
      }
      if (event.key === "Tab") {
        const items = focusable();
        const firstItem = items[0];
        const lastItem = items[items.length - 1];
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem?.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem?.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => setMenuOpen(false), [pathname]);

  function closeMenu() {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuTriggerRef.current?.focus());
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }
  return <div className={`app-shell ${pathname === "/" ? "chat-layout" : ""}`}>
    <header className="topbar">
      <div className="topbar-leading">
        <button
          ref={menuTriggerRef}
          className="icon-button menu-trigger"
          type="button"
          aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
          aria-expanded={menuOpen}
          aria-controls="navigation-drawer"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <Link className="brand" href="/" aria-label="Apple Finanças, início"><span className="brand-mark">a.</span><span>Finanças</span></Link>
      </div>
    </header>
    {menuOpen && <>
      <button className="drawer-scrim" type="button" aria-label="Fechar menu" onClick={closeMenu} />
      <aside id="navigation-drawer" ref={drawerRef} className="navigation-drawer" role="dialog" aria-modal="true" aria-label="Menu principal">
        <div className="drawer-heading">
          <span className="drawer-title">Navegação</span>
          <button className="icon-button" type="button" aria-label="Fechar menu" onClick={closeMenu}><X size={19} /></button>
        </div>
        <nav className="drawer-nav" aria-label="Navegação principal">
          {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} className={`drawer-link ${pathname === href ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
            <Icon size={19} strokeWidth={pathname === href ? 2.2 : 1.8} /><span>{label}</span>
          </Link>)}
          <Link href="/recurrences" aria-current={pathname === "/recurrences" ? "page" : undefined} className={`drawer-link ${pathname === "/recurrences" ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
            <Settings2 size={19} strokeWidth={pathname === "/recurrences" ? 2.2 : 1.8} /><span>Recorrências</span>
          </Link>
          <Link href="/account" aria-current={pathname === "/account" ? "page" : undefined} className={`drawer-link ${pathname === "/account" ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
            <UserRound size={19} strokeWidth={pathname === "/account" ? 2.2 : 1.8} /><span>Conta e dados</span>
          </Link>
        </nav>
        <div className="drawer-footer">
          <button className="drawer-link" type="button" onClick={() => void logout()}><LogOut size={19} /><span>Sair</span></button>
        </div>
      </aside>
    </>}
    <main className={`main-content ${pathname === "/" ? "chat-main" : ""}`}>{children}</main>
  </div>;
}
