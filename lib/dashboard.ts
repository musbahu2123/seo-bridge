// lib/dashboard.ts — aggregated stats for the dashboard (server-only)
// One place for every dashboard query so the page stays thin and the
// weekly-report job (Batch 14) can reuse the same aggregations.
import dbConnect from "@/lib/dbConnect";
import Site from "@/models/Site";
import Keyword from "@/models/Keyword";
import ArticleJob from "@/models/ArticleJob";
import PageIndex from "@/models/PageIndex";
import LinkTask from "@/models/LinkTask";
import WeeklySnapshot from "@/models/WeeklySnapshot";

export type DashboardStats = {
  sites: {
    total: number;
    active: number;
    gscConnected: number;
    publishKeySet: number;
  };
  keywords: {
    total: number;
    target: number;
    watch: number;
    park: number;
    byStatus: Record<string, number>;
  };
  articles: {
    total: number;
    awaitingReview: number;
    approved: number;
    pushed: number;
    rejected: number;
  };
  pages: {
    own: number;
    external: number;
    unindexedOwn: number; // own pages whose coverageState is not "Indexed"
  };
  links: {
    total: number;
    byStatus: Record<string, number>;
    placedTotal: number;
    placedLast30d: number;
  };
  latestSnapshot: {
    week: string | null;
    clicks: number;
    impressions: number;
    ctr: number;
    avgPosition: number;
    referringDomains: number;
  } | null;
};

async function countBy<T extends { _id: string; n: number }>(
  model: any,
  field: string,
): Promise<Record<string, number>> {
  const rows: T[] = await model.aggregate([
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r._id ?? "unknown")] = r.n;
  return out;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  await dbConnect();

  const [
    siteTotal,
    siteActive,
    siteGsc,
    sitePublish,
    kwTotal,
    kwByDecision,
    kwByStatus,
    artTotal,
    artByStatus,
    pageOwn,
    pageExternal,
    pageUnindexed,
    linkTotal,
    linkByStatus,
    placedTotal,
    placedLast30d,
    latest,
  ] = await Promise.all([
    Site.countDocuments({}),
    Site.countDocuments({ active: true }),
    Site.countDocuments({ gscRefreshToken: { $ne: null } }),
    Site.countDocuments({ publishKey: { $ne: null, $ne: "" } }),
    Keyword.countDocuments({}),
    countBy(Keyword, "decision"),
    countBy(Keyword, "status"),
    ArticleJob.countDocuments({}),
    countBy(ArticleJob, "status"),
    PageIndex.countDocuments({ type: "own" }),
    PageIndex.countDocuments({ type: "external" }),
    PageIndex.countDocuments({
      type: "own",
      coverageState: { $not: /^Indexed$/i },
    }),
    LinkTask.countDocuments({}),
    countBy(LinkTask, "status"),
    LinkTask.countDocuments({ status: "placed" }),
    LinkTask.countDocuments({
      status: "placed",
      placedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    }),
    WeeklySnapshot.findOne({}).sort({ week: -1 }).lean(),
  ]);

  const latestSnapshot = latest
    ? {
        week: latest.week ? new Date(latest.week).toISOString().slice(0, 10) : null,
        clicks: latest.clicks ?? 0,
        impressions: latest.impressions ?? 0,
        ctr: latest.ctr ?? 0,
        avgPosition: latest.avgPosition ?? 0,
        referringDomains: latest.referringDomains ?? 0,
      }
    : null;

  return {
    sites: {
      total: siteTotal,
      active: siteActive,
      gscConnected: siteGsc,
      publishKeySet: sitePublish,
    },
    keywords: {
      total: kwTotal,
      target: kwByDecision.TARGET ?? 0,
      watch: kwByDecision.WATCH ?? 0,
      park: kwByDecision.PARK ?? 0,
      byStatus: kwByStatus,
    },
    articles: {
      total: artTotal,
      awaitingReview: artByStatus.awaiting_review ?? 0,
      approved: artByStatus.approved ?? 0,
      pushed: artByStatus.pushed ?? 0,
      rejected: artByStatus.rejected ?? 0,
    },
    pages: {
      own: pageOwn,
      external: pageExternal,
      unindexedOwn: pageUnindexed,
    },
    links: {
      total: linkTotal,
      byStatus: linkByStatus,
      placedTotal: placedTotal,
      placedLast30d: placedLast30d,
    },
    latestSnapshot,
  };
}