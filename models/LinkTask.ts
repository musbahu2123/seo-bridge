// models/LinkTask.ts — the $0 links CRM (brief 11.2 plays + 11.4 rules)
import mongoose from "mongoose";

const linkTaskSchema = new mongoose.Schema(
  {
    site: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
      index: true,
    },

    // ── The 10 plays + prospect sources (brief 11.2 / 11.3) ──
    play: {
      type: String,
      enum: [
        "directory",
        "listicle-outreach",
        "listicle-tombstone",
        "gift-correction",
        "gift-reshoot",
        "gift-diagram",
        "reclaim-broken",
        "reclaim-mention",
        "reclaim-customer-story",
        "forum",
        "exchange",
        "ai-citation",
      ],
      required: true,
    },
    source: {
      type: String,
      enum: ["link-intersect", "ai-citation", "serp-listicle", "directory-list", "manual"],
      default: "manual",
    },

    // ── Prospect ──
    targetDomain: { type: String, required: true },
    targetUrl: { type: String, default: "" },
    pageType: {
      type: String,
      enum: ["listicle", "tutorial", "stats", "guide", "directory", "forum", "n/a"],
      default: "n/a",
    },
    dr: { type: Number, default: null }, // null = unknown — NEVER invent a number
    contact: { type: String, default: "" },
    citedCount: { type: Number, default: 0 }, // how many AI prompts cited this domain
    proofUrl: { type: String, default: "" }, // tombstone: shutdown notice URL — no proof, no pitch

    // ── Outreach state ──
    emailDraft: { type: String, default: "" }, // HUMAN sends from Gmail — the bridge never sends
    status: {
      type: String,
      enum: ["prospect", "drafted", "sent", "replied", "placed", "rejected"],
      default: "prospect",
      index: true,
    },
    cost: { type: Number, default: 0 }, // hard rule: $0 — decline all paid offers

    // ── If placed ──
    placedUrl: { type: String, default: "" },
    anchorText: { type: String, default: "" },
    relAttribute: { type: String, default: "" },
    placedAt: { type: Date, default: null },
    judgeAfter: { type: Date, default: null }, // placedAt + 60 days — patience rule (11.4)

    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

const LinkTask =
  mongoose.models.LinkTask || mongoose.model("LinkTask", linkTaskSchema);
export default LinkTask;