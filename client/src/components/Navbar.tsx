/*
 * Design: Signal — Néo-Brutaliste Télécom
 * Navbar avec bordure épaisse en bas, logo bold, navigation par onglets
 */
import { Phone, Settings, BarChart3, MessageSquare } from "lucide-react";
import { Link, useLocation } from "wouter";

const navItems = [
  { href: "/", label: "Accueil", icon: Phone },
  { href: "/config", label: "Configuration", icon: Settings },
  { href: "/simulation", label: "Simulation", icon: MessageSquare },
  { href: "/historique", label: "Historique", icon: BarChart3 },
];

export default function Navbar() {
  const [location] = useLocation();

  return (
    <nav className="sticky top-0 z-50 bg-card border-b-[3px] border-foreground">
      <div className="container flex items-center justify-between h-16">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <div className="w-9 h-9 bg-primary flex items-center justify-center border-2 border-foreground shadow-[3px_3px_0px] shadow-foreground">
            <Phone className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-heading text-xl font-bold tracking-tight text-foreground hidden sm:block">
            NJP Call
          </span>
        </Link>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-2 px-3 py-2 text-sm font-heading font-semibold
                  border-2 transition-all duration-150 no-underline
                  ${
                    isActive
                      ? "bg-primary text-primary-foreground border-foreground shadow-[3px_3px_0px] shadow-foreground"
                      : "bg-transparent text-foreground border-transparent hover:border-foreground hover:shadow-[2px_2px_0px] hover:shadow-foreground"
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
