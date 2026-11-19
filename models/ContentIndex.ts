// models/ContentIndex.ts — index of every existing post on the tenant
// Purpose: (1) cannibalization gate before keyword-harvest / brief-generator
//          (2) slug dup safety net in the publisher
//          (3) corpus for StyleProfile learning (Phase 3)
//
// Source of truth: the tenant's own GET /api/admin/blog (see Site.publishUrl)
// Refresh: weekly via content-sync, and on-demand after adding a tenant.
//
// TENANT-AGNOSTIC: reads via publishUrl + publishKey. If a future tenant
// returns a wrapped shape { data: { posts: [...] } }, Site.contentResponsePath
// tells content-sync where the array is. This model does not care.
import mongoose from "mongoose";

const contentIndexSchema = new mongoose.Schema(
  {
    site: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
      index: true,
    },

    // ── Identity (from the SaaS post) ──
    url: { type: String, required: true }, // absolute, e.g. https://www.resumetailorapp.com/blog/x
    slug: { type: String, required: true },
    title: { type: String, required: true },
    h1: { type: String, default: "" }, // first <h1> in content, or title if none
    description: { type: String, default: "" },
    category: { type: String, default: "" },

    // ── Classification (LLM) ──
    primaryKeyword: { type: String, default: "" },
    secondaryKeywords: { type: [String], default: [] },
    intent: {
      type: String,
      enum: ["commercial", "informational", "transactional", "navigational", null],
      default: null,
    },
    pageType: {
      type: String,
      enum: ["blog", "comparison", "landing", "tool"],
      default: "blog",
    },
    isComparison: { type: Boolean, default: false }, // "X vs Y" / "X alternatives"

    // ── Sync bookkeeping ──
    publishedAt: { type: Date, default: null },
    // The SaaS post's own updatedAt, used to skip unchanged posts on re-sync.
    // If this equals the stored value, content-sync skips re-classification.
    blogPostUpdatedAt: { type: Date, default: null },
    source: { type: String, enum: ["blog-api", "sitemap"], default: "blog-api" },
    lastSyncedAt: { type: Date, default: Date.now },

    // ── LLM provenance ──
    llmModel: { type: String, default: "" },
    llmConfidence: { type: Number, default: 0 }, // 0-1
  },
  { timestamps: true },
);

// One row per site+url — re-sync must upsert, not duplicate
contentIndexSchema.index({ site: 1, url: 1 }, { unique: true });

// Fast lookups for the two gates:
contentIndexSchema.index({ site: 1, primaryKeyword: 1 }); // matchKeyword (exact)
contentIndexSchema.index({ site: 1, slug: 1 });           // matchSlug (publisher safety net)
contentIndexSchema.index({ site: 1, pageType: 1 });       // "is this a landing/tool page?"

const ContentIndex =
  mongoose.models.ContentIndex ||
  mongoose.model("ContentIndex", contentIndexSchema);

export default ContentIndex;