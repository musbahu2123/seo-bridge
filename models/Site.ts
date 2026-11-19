// models/Site.ts — a tenant: one per SaaS we manage
import mongoose from "mongoose";

const siteSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    domain: { type: String, required: true, unique: true },

    // ── Google Search Console ──
    gscSiteUrl: { type: String, default: null },
    gscRefreshToken: { type: String, default: null }, // AES-GCM encrypted
    gscConnectedAt: { type: Date, default: null },

    // ── Sources ──
    sitemapUrl: { type: String, required: true },
    competitors: { type: [String], default: [] },

    // ── Strategy context ──
    positioning: { type: String, default: "" },
    buyerPrompts: { type: [String], default: [] },

    // ── Branded promo code (the "branded code" weapon) ──
    promoCode: { type: String, default: "" },   // e.g. "INTV25"
    promoUrl: { type: String, default: "" },    // e.g. "https://www.resumetailorapp.com/?promo=INTV25"

    // ── Brand tokens for branded vs non-branded split in gsc-sync ──
    brandTokens: {
      type: [String],
      default: ["resumetailor", "resume tailor", "rta"],
    },

    // ── Publishing ──
    publishUrl: { type: String, required: true },
    publishKey: { type: String, required: true }, // AES-GCM encrypted

    // ── Multi-tenant GET response shape ──
    // Some tenants return a top-level JSON array (default: "").
    // Some wrap it: { data: { posts: [...] } } → "data.posts".
    // content-sync resolves this dot-path before mapping posts.
    // THIS IS THE MULTI-TENANT RELIABILITY LEVER — no code change per tenant.
    contentResponsePath: { type: String, default: "" },

    // ── Category map ──
    categoryMap: {
      type: Map,
      of: String,
      default: {
        interview: "Career Advice",
        negotiation: "Career Advice",
        career: "Career Advice",
        "resume-mechanics": "ATS Optimization",
        tool: "AI Tools",
        template: "Templates",
      },
    },

    ctaPages: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const Site = mongoose.models.Site || mongoose.model("Site", siteSchema);
export default Site;