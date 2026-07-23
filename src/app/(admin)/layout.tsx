import Link from "next/link";

import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

// Admin chrome for every gated route. The (admin) group is protected in its
// entirety by middleware (E1-01 Feature A, Business Rule 5) — no route in
// this layout may opt out.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center justify-between gap-4 px-4">
          <nav className="flex items-center gap-4">
            <Link href="/raffles" className="text-sm font-semibold tracking-tight">
              Raffle App
            </Link>
            <Link
              href="/raffles"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Raffles
            </Link>
          </nav>
          <form action={logout}>
            <Button type="submit" variant="ghost" size="sm">
              Log out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
