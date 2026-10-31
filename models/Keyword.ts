// models/Keyword.ts — candidate keyword with its Opportunity Score (brief 3.5)
import mongoose from "mongoose";

const keywordSchema = new mongoose.Schema(
  {
    site: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
      index: true,
    },
    keyword: { type: String, required: true },
    source: {
      type: String,
      enum: ["gsc", "serper", "autocomplete", "paa", "competitor"],
      default: "serper",
    },

    status: {
      type: String,
      enum: ["new", "approved", "briefed", "drafted", "published", "watch", "rejected"],
      default: "new",
      index: true,
    },

    // ── Opportunity Score components (total 0-10) ──
    demand: { type: Number, default: 0 }, // 0-3
    serpOpp: { type: Number, default: 0 }, // 0-4
    fit: { type: Number, default: 0 }, // 0-3
    opportunityScore: { type: Number, default: 0 },
    decision: {
      type: String,
      enum: ["TARGET", "WATCH", "PARK"],
      default: "PARK",
      index: true,
    },
    overrideReason: { type: String, default: "" }, // why a hard override fired

    // ── SERP snapshot (the evidence) ──
    giantsInTop10: { type: Number, default: 0 },
    weakSitesInTop10: { type: Number, default: 0 },
    topResults: [{ title: String, domain: String }],
    paas: { type: [String], default: [] }, // People Also Ask -> FAQ blocks + future keywords
    related: { type: [String], default: [] },

    // ── GSC evidence ──
    gscImpressions: { type: Number, default: 0 },
    gscPosition: { type: Number, default: 0 },

    intent: {
      type: String,
      enum: ["commercial", "informational", "transactional", "navigational", null],
      default: null,
    },
    cluster: { type: String, default: "" },
    ctaPage: { type: String, default: "" }, // assigned tool page for this article's CTA

    lastScoredAt: { type: Date, default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

// One row per site+keyword — re-harvesting must upsert, not duplicate
keywordSchema.index({ site: 1, keyword: 1 }, { unique: true });

const Keyword =
  mongoose.models.Keyword || mongoose.model("Keyword", keywordSchema);
export default Keyword;