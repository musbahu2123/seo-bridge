// models/ArticleJob.ts — brief -> draft -> human review -> pushed to the SaaS
import mongoose from "mongoose";

const articleJobSchema = new mongoose.Schema(
  {
    keywordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Keyword",
      required: true,
    },
    site: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
      index: true,
    },

    // ── LLM outputs ──
    brief: { type: String, default: "" }, // the evidence-pack brief
    outline: { type: [String], default: [] }, // H2/H3 structure
    ctaPlan: { type: String, default: "" }, // which CTA, where
    draft: { type: String, default: "" }, // full article content

    // ── SEO fields for the target BlogPost ──
    title: { type: String, default: "" },
    slug: { type: String, default: "" },
    description: { type: String, default: "" },
    metaTitle: { type: String, default: "" },
    metaDescription: { type: String, default: "" },
    category: { type: String, default: "" }, // mapped via Site.categoryMap
    readTime: { type: String, default: "6 min" },
    image: { type: String, default: "/images/blog/default.jpg" },

    // ── Pipeline state ──
    status: {
      type: String,
      enum: ["awaiting_review", "approved", "pushed", "rejected"],
      default: "awaiting_review",
      index: true,
    },
    reviewedBy: { type: String, default: "" }, // human gate: who approved
    reviewNotes: { type: String, default: "" },

    // ── Push log ──
    postId: { type: String, default: "" }, // returned by the SaaS /api/admin/blog
    publishedUrl: { type: String, default: "" },
    pushedAt: { type: Date, default: null },
    indexNowPinged: { type: Boolean, default: false },
    bingSubmittedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const ArticleJob =
  mongoose.models.ArticleJob || mongoose.model("ArticleJob", articleJobSchema);
export default ArticleJob;