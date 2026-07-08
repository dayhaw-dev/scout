import { ScrapeCreatorsVideoListItem } from "./scrapecreators.js";
import { parseCountText } from "./text.js";

export function activityMetrics(
  videos: ScrapeCreatorsVideoListItem[],
  subscribers: number | null,
  now = new Date(),
): {
  lastUploadAt: string | null;
  uploadsLast90d: number;
  medianRecentViews: number | null;
  recentVelocity: number | null;
} {
  const dated = videos
    .map((video) => ({
      publishedAt: parseVideoPublishedAt(video),
      views: parseCountText(video.viewCountInt ?? video.viewCountText),
    }))
    .filter((video): video is { publishedAt: Date; views: number | null } =>
      video.publishedAt !== null,
    )
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  const lastUploadAt = dated[0]?.publishedAt.toISOString() ?? null;
  const cutoff90 = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  const uploadsLast90d = dated.filter((video) => video.publishedAt.getTime() >= cutoff90).length;
  const recentViews = dated
    .slice(0, 12)
    .map((video) => video.views)
    .filter((views): views is number => views !== null)
    .sort((a, b) => a - b);
  const medianRecentViews = median(recentViews);
  const rawReach = medianRecentViews === null
    ? null
    : medianRecentViews / Math.max(subscribers ?? 0, 1);

  return {
    lastUploadAt,
    uploadsLast90d,
    medianRecentViews,
    recentVelocity: rawReach,
  };
}

function parseVideoPublishedAt(video: ScrapeCreatorsVideoListItem): Date | null {
  const value = video.publishedTime;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const midpoint = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[midpoint];
  return Math.round((values[midpoint - 1] + values[midpoint]) / 2);
}
