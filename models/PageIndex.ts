// models/PageIndex.ts — indexing status for OUR pages and EXTERNAL backlink URLs
import mongoose from "mongoose";

const pageIndexSchema = new mongoose.Schema(
  {
    site: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Site",
      required: true,
      index: true,
    },
    // "own" = a page on the tenant's domain (inspected via GSC URL Inspection API)
    // "external" = a backlink/citation URL someone placed for us (from LinkTask/linkreview)
    type: { type: String, enum: ["own", "external"], default: "own", index: true },
    url: { type: String, required: true },
    sourceLinkTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LinkTask",
      default: null,
    }, // external only: which placed link this URL belongs to

    firstSeen: { type: Date, default: Date.now },
    coverageState: { type: String, default: "" }, // e.g. "Indexed", "Crawled - currently not indexed"
    indexingState: { type: String, default: "" },
    lastInspected: { type: Date, default: null },
    timesInspected: { type: Number, default: 0 },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

pageIndexSchema.index({ site: 1, url: 1 }, { unique: true });

const PageIndex =
  mongoose.models.PageIndex || mongoose.model("PageIndex", pageIndexSchema);
export default PageIndex;