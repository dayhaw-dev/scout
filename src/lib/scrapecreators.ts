const API_ORIGIN = "https://api.scrapecreators.com";

export interface Env {
  SCOUT_DB: D1Database;
  SCRAPECREATORS_API_KEY: string;
  SCOUT_ADMIN_KEY: string;
  ANTHROPIC_API_KEY?: string;
  ASSETS?: {
    fetch: typeof fetch;
  };
}

interface ImageSource {
  url: string;
  width?: number;
  height?: number;
}

export interface ScrapeCreatorsChannel {
  credits_remaining?: number;
  channelId: string;
  channel?: string;
  name?: string;
  avatar?: {
    image?: {
      sources?: ImageSource[];
    };
  };
  description?: string | null;
  subscriberCount?: number;
  subscriberCountText?: string;
  videoCountText?: string;
  viewCountText?: string;
  joinedDateText?: string;
  tags?: string;
  email?: string | null;
  store?: string | null;
  twitter?: string | null;
  instagram?: string | null;
  links?: string[];
  country?: string | null;
}

export interface ScrapeCreatorsVideoListItem {
  type?: string;
  id: string;
  url?: string;
  title?: string;
  description?: string | null;
  thumbnail?: string | null;
  channel?: {
    id?: string;
    title?: string;
    handle?: string;
    thumbnail?: string | null;
  };
  viewCountText?: string;
  viewCountInt?: number;
  publishedTimeText?: string;
  publishedTime?: string;
  lengthText?: string;
  lengthSeconds?: number;
  badges?: unknown[];
}

export interface ScrapeCreatorsChannelVideos {
  credits_remaining?: number;
  videos: ScrapeCreatorsVideoListItem[];
  continuationToken?: string;
}

export interface ScrapeCreatorsVideoDetails {
  success?: boolean;
  credits_remaining?: number;
  id: string;
  thumbnail?: string;
  url?: string;
  publishDate?: string;
  type?: string;
  title?: string;
  description?: string | null;
  descriptionLinks?: unknown[];
  commentCountText?: string;
  commentCountInt?: number;
  likeCountText?: string;
  likeCountInt?: number;
  viewCountText?: string;
  viewCountInt?: number;
  publishDateText?: string;
  collaborators?: unknown[];
  channel?: {
    id?: string;
    url?: string;
    handle?: string;
    title?: string;
  };
  chapters?: unknown[];
  watchNextVideos?: ScrapeCreatorsVideoListItem[];
  keywords?: string[];
  genre?: string;
  durationMs?: number;
  durationFormatted?: string;
  captionTracks?: unknown[];
}

export interface ScrapeCreatorsSearch {
  credits_remaining?: number;
  videos?: ScrapeCreatorsVideoListItem[];
  channels?: unknown[];
  playlists?: unknown[];
  shorts?: ScrapeCreatorsVideoListItem[];
  shelves?: unknown[];
  lives?: unknown[];
  continuationToken?: string;
}

export type ScrapeCreatorsSearchUploadDate =
  | "today"
  | "this_week"
  | "this_month"
  | "this_year";

export interface ScrapeCreatorsSearchOptions {
  uploadDate?: ScrapeCreatorsSearchUploadDate;
  sortBy?: "relevance" | "popular";
  type?: "videos" | "shorts" | "channels" | "playlists";
  duration?: "under_3_min" | "between_3_and_20_min" | "over_20_min";
  region?: string;
  continuationToken?: string;
}

export type ScrapeCreatorsErrorKind =
  | "unauthorized"
  | "out_of_credits"
  | "http_error";

export interface ScrapeCreatorsLogEvent {
  endpoint: string;
  attempt: number;
  isRetry: boolean;
}

interface ScrapeCreatorsClientOptions {
  onApiLog?: (event: ScrapeCreatorsLogEvent) => void;
}

export class ScrapeCreatorsApiError extends Error {
  constructor(
    public readonly kind: ScrapeCreatorsErrorKind,
    public readonly status: number,
    public readonly endpoint: string,
    message: string,
  ) {
    super(message);
    this.name = "ScrapeCreatorsApiError";
  }
}

export class ScrapeCreatorsClient {
  constructor(
    private readonly env: Env,
    private readonly options: ScrapeCreatorsClientOptions = {},
  ) {}

  async getChannel(handleOrId: string): Promise<ScrapeCreatorsChannel> {
    const params = channelLookupParams(handleOrId);
    return this.request<ScrapeCreatorsChannel>("/v1/youtube/channel", params);
  }

  async getChannelVideos(
    channelId: string,
    limit = 25,
  ): Promise<ScrapeCreatorsChannelVideos> {
    const result = await this.getChannelVideosPage(channelId);

    return {
      ...result,
      videos: Array.isArray(result.videos) ? result.videos.slice(0, limit) : [],
    };
  }

  async getChannelVideosPage(
    channelId: string,
    continuationToken?: string,
  ): Promise<ScrapeCreatorsChannelVideos> {
    return this.request<ScrapeCreatorsChannelVideos>(
      "/v1/youtube/channel-videos",
      { channelId, continuationToken },
    );
  }

  async getVideoDetails(videoId: string): Promise<ScrapeCreatorsVideoDetails> {
    const url = videoId.startsWith("http")
      ? videoId
      : `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    return this.request<ScrapeCreatorsVideoDetails>("/v1/youtube/video", {
      url,
    });
  }

  async searchYouTube(query: string): Promise<ScrapeCreatorsSearch> {
    return this.searchYouTubePage(query);
  }

  async searchYouTubePage(
    query: string,
    options: ScrapeCreatorsSearchOptions = {},
  ): Promise<ScrapeCreatorsSearch> {
    return this.request<ScrapeCreatorsSearch>("/v1/youtube/search", {
      query,
      uploadDate: options.uploadDate,
      sortBy: options.sortBy,
      type: options.type,
      duration: options.duration,
      region: options.region,
      continuationToken: options.continuationToken,
    });
  }

  async creditsUsedToday(): Promise<number> {
    const row = await this.env.SCOUT_DB.prepare(
      "SELECT COALESCE(SUM(credits_estimated), 0) AS credits FROM api_log WHERE date(created_at) = date('now')",
    ).first<{ credits: number }>();
    return Number(row?.credits ?? 0);
  }

  private async request<T>(
    pathname: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    if (!this.env.SCRAPECREATORS_API_KEY) {
      throw new ScrapeCreatorsApiError(
        "unauthorized",
        401,
        pathname,
        "SCRAPECREATORS_API_KEY is not configured.",
      );
    }

    const url = new URL(pathname, API_ORIGIN);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const endpoint = `${url.pathname}?${url.searchParams.toString()}`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.logApiCall(endpoint);
      this.options.onApiLog?.({
        endpoint,
        attempt: attempt + 1,
        isRetry: attempt > 0,
      });

      const response = await fetch(url, {
        headers: {
          "x-api-key": this.env.SCRAPECREATORS_API_KEY,
        },
      });

      if (response.status >= 500 && attempt === 0) {
        await delay(500);
        continue;
      }

      if (response.status === 401) {
        throw new ScrapeCreatorsApiError(
          "unauthorized",
          response.status,
          endpoint,
          "ScrapeCreators rejected the API key.",
        );
      }

      if (response.status === 402) {
        throw new ScrapeCreatorsApiError(
          "out_of_credits",
          response.status,
          endpoint,
          "ScrapeCreators reports the account is out of credits.",
        );
      }

      if (!response.ok) {
        throw new ScrapeCreatorsApiError(
          "http_error",
          response.status,
          endpoint,
          await response.text(),
        );
      }

      const payload = (await response.json()) as unknown;
      await this.syncCreditsRemaining(payload);
      return payload as T;
    }

    throw new ScrapeCreatorsApiError(
      "http_error",
      500,
      endpoint,
      "ScrapeCreators request failed after retry.",
    );
  }

  private async logApiCall(endpoint: string): Promise<void> {
    await this.env.SCOUT_DB.prepare(
      "INSERT INTO api_log (endpoint, credits_estimated) VALUES (?, 1)",
    )
      .bind(endpoint)
      .run();
  }

  private async syncCreditsRemaining(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== "object") return;
    const value = (payload as Record<string, unknown>).credits_remaining;
    const credits = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(credits)) return;

    await this.env.SCOUT_DB.prepare(
      `INSERT INTO meta (key, value, updated_at)
      VALUES ('credits_remaining', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at`,
    )
      .bind(String(Math.round(credits)))
      .run();
  }
}

function channelLookupParams(input: string): Record<string, string> {
  const value = input.trim();

  if (/^https?:\/\//i.test(value)) {
    return { url: value };
  }

  const withoutAt = value.replace(/^@/, "");
  if (/^UC[\w-]+$/.test(withoutAt)) {
    return { channelId: withoutAt };
  }

  return { handle: withoutAt };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
