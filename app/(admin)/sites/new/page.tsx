// app/(admin)/sites/new/page.tsx — add-tenant page (server component wrapper)
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SiteForm } from "@/components/SiteForm";

export const dynamic = "force-dynamic";

export default function NewSitePage() {
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">New site</h1>
          <p className="text-sm text-muted-foreground">
            Add a tenant. ResumeTailorApp is tenant #1 — use{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              resumetailorapp.com
            </code>
            .
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/sites">Cancel</Link>
        </Button>
      </div>

      <SiteForm />
    </div>
  );
}