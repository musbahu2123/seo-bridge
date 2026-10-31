// components/SiteForm.tsx — add-tenant form (client)
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type FormState = {
  name: string;
  domain: string;
  gscSiteUrl: string;
  sitemapUrl: string;
  competitors: string;
  positioning: string;
  buyerPrompts: string;
  publishUrl: string;
  publishKey: string;
  ctaPages: string;
  categoryMapPreset: "default" | "custom";
};

const INITIAL: FormState = {
  name: "ResumeTailorApp",
  domain: "resumetailorapp.com",
  gscSiteUrl: "",
  sitemapUrl: "https://www.resumetailorapp.com/sitemap.xml",
  competitors: "zety.com, tealhq.com, resumegenius.com, novoresume.com",
  positioning:
    "The resume tool that gets you interviews, outcome-focused AI resume tailoring.",
  buyerPrompts:
    "best resume builder for nurses\nfree ats checker\nzety vs resume io\nbest ai resume tailor",
  publishUrl: "https://www.resumetailorapp.com/api/admin/blog",
  publishKey: "",
  ctaPages: "",
  categoryMapPreset: "default",
};

function splitLines(v: string): string[] {
  return v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function SiteForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      domain: form.domain.trim(),
      sitemapUrl: form.sitemapUrl.trim(),
      competitors: splitLines(form.competitors),
      positioning: form.positioning.trim(),
      buyerPrompts: splitLines(form.buyerPrompts),
      publishUrl: form.publishUrl.trim(),
      ctaPages: splitLines(form.ctaPages),
    };

    if (form.gscSiteUrl.trim()) payload.gscSiteUrl = form.gscSiteUrl.trim();
    if (form.publishKey.trim()) payload.publishKey = form.publishKey.trim();

    const res = await fetch("/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch {
        /* keep default */
      }
      setError(msg);
      return;
    }

    startTransition(() => {
      router.push("/sites");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="ResumeTailorApp"
              required
            />
          </Field>

          <Field label="Domain" required hint="No protocol, no trailing slash.">
            <Input
              value={form.domain}
              onChange={(e) => update("domain", e.target.value)}
              placeholder="resumetailorapp.com"
              required
            />
          </Field>

          <Field
            label="GSC property"
            hint='Optional now. Format: "sc-domain:resumetailorapp.com" (Domain property) or "https://www.resumetailorapp.com/" (URL-prefix). You can set this later when OAuth is wired.'
          >
            <Input
              value={form.gscSiteUrl}
              onChange={(e) => update("gscSiteUrl", e.target.value)}
              placeholder="sc-domain:resumetailorapp.com"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sources &amp; positioning</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Sitemap URL" required>
            <Input
              value={form.sitemapUrl}
              onChange={(e) => update("sitemapUrl", e.target.value)}
              placeholder="https://www.resumetailorapp.com/sitemap.xml"
              required
            />
          </Field>

          <Field
            label="Competitors"
            hint="Comma- or newline-separated. Used for keyword-harvest and link-intersect."
          >
            <textarea
              value={form.competitors}
              onChange={(e) => update("competitors", e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>

          <Field
            label="Positioning"
            hint="Injected into every LLM prompt. One paragraph."
          >
            <textarea
              value={form.positioning}
              onChange={(e) => update("positioning", e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>

          <Field
            label="Buyer prompts"
            hint="One per line. Used for AI-citation prospecting (brief §11.3)."
          >
            <textarea
              value={form.buyerPrompts}
              onChange={(e) => update("buyerPrompts", e.target.value)}
              rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Publishing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Publish URL"
            required
            hint="The SaaS admin blog endpoint. The bridge POSTs here with x-api-key."
          >
            <Input
              value={form.publishUrl}
              onChange={(e) => update("publishUrl", e.target.value)}
              placeholder="https://www.resumetailorapp.com/api/admin/blog"
              required
            />
          </Field>

          <Field
            label="Publish key"
            hint="Optional now. Leave blank until the SaaS ApiKey patch (§3.7) ships — we'll store a placeholder and you can edit it later."
          >
            <Input
              value={form.publishKey}
              onChange={(e) => update("publishKey", e.target.value)}
              placeholder="rta_live_..."
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content routing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="CTA pages"
            hint="One per line. Tool pages on the SaaS used for outcome-matched CTAs (e.g. /ats-resume-checker). Leave blank for now — fill once you confirm the URLs."
          >
            <textarea
              value={form.ctaPages}
              onChange={(e) => update("ctaPages", e.target.value)}
              rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>

          <Field
            label="Category map"
            hint="Bridge topic → target BlogPost category. Defaults match the ResumeTailorApp enum."
          >
            <Select
              value={form.categoryMapPreset}
              onValueChange={(v) =>
                update("categoryMapPreset", v as FormState["categoryMapPreset"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  Default (recommended for ResumeTailorApp)
                </SelectItem>
                <SelectItem value="custom">
                  Custom (edit later)
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/sites")}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating…" : "Create site"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}