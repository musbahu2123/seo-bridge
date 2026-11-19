// models/LandingTodo.ts — flag-only queue for landing-page-shaped keywords
// Purpose: when brief-generator sees a keyword that should be a landing/tool
//          page (not a blog post), it creates one of these instead of drafting.
//          You handle the landing page manually in the SaaS, then mark done.
//
// Per R3 (user decision 2026-11): FLAG-ONLY. The bridge does not draft landing
// copy. It just tells you "this belongs on a landing page, go build it."
import mongoose from "mongoose";

const landingTodoSchema = new mongoose.Schema(
  {
    site: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
      index: true,
    },
    // The keyword that triggered the flag (denormalized for easy listing)
    keyword: { type: String, required: true },
    // Link back to the Keyword that got flagged
    keywordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Keyword",
      default: null,
    },

    // Suggested landing URL path (best-effort from keyword shape)
    suggestedSlug: { type: String, default: "" }, // e.g. "ats-resume-checker"
    // Why it was flagged — useful when you revisit weeks later
    reason: { type: String, default: "" },        // "commercial intent + SERP is tool-shaped"

    status: {
      type: String,
      enum: ["new", "in-progress", "done", "dismissed"],
      default: "new",
      index: true,
    },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

// One todo per (site, keyword) — re-running brief-generator won't spam dupes
landingTodoSchema.index({ site: 1, keyword: 1 }, { unique: true });
landingTodoSchema.index({ site: 1, status: 1 }); // fast "open todos for site" query

const LandingTodo =
  mongoose.models.LandingTodo ||
  mongoose.model("LandingTodo", landingTodoSchema);

export default LandingTodo;