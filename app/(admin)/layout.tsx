import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, destroySession } from "@/lib/admin";
import { Button } from "@/components/ui/button";
import { JobTick } from "@/components/JobTick";

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col">
      {/* Fires /api/jobs/tick on every navigation — lazy-trigger scheduler */}
      <JobTick />

      <nav className="border-b bg-background sticky top-0 z-10">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6 text-sm">
            <Link href="/dashboard" className="font-semibold">
              SEO Bridge
            </Link>
            <Link
              href="/dashboard"
              className="text-muted-foreground hover:text-foreground"
            >
              Dashboard
            </Link>
            <Link
              href="/sites"
              className="text-muted-foreground hover:text-foreground"
            >
              Sites
            </Link>
            <Link
              href="/keywords"
              className="text-muted-foreground hover:text-foreground"
            >
              Keywords
            </Link>
            <Link
              href="/review"
              className="text-muted-foreground hover:text-foreground"
            >
              Review
            </Link>
            <Link
              href="/index-monitor"
              className="text-muted-foreground hover:text-foreground"
            >
              Index
            </Link>
            <Link
              href="/links"
              className="text-muted-foreground hover:text-foreground"
            >
              Links
            </Link>
            <Link
              href="/reports"
              className="text-muted-foreground hover:text-foreground"
            >
              Reports
            </Link>
          </div>
          <form action={logout} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{session.email}</span>
            <Button variant="ghost" size="sm" type="submit">
              Logout
            </Button>
          </form>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
    </div>
  );
}