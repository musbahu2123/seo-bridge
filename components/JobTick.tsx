"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Fires /api/jobs/tick on every admin navigation.
 * The tick endpoint is a no-op if no job is due, so this is cheap.
 * Mounted once in app/(admin)/layout.tsx.
 *
 * Why usePathname dependency: the admin layout is preserved across navigations
 * within its subtree, so a plain useEffect([]) would only fire once. Re-firing
 * on each pathname change ensures every admin page visit triggers a due check.
 */
export function JobTick() {
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/jobs/tick", { method: "POST" }).catch(() => {
      /* swallow — this is best-effort */
    });
  }, [pathname]);

  return null;
}