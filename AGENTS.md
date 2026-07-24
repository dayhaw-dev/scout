# SCOUT Agent Handbook

This file is the repository's operating memory. Read it fully before making changes.

## Standing fences (non-negotiable)

- Demo seeds are protected. Never search, expand, or regenerate Brian Lagerstrom (`chili oil wontons`) or My Name Is Andong (exact chip phrase: `lithuanian pink soup recipe`). Both are `seed_locked`.
- Miranda Goes Outside and Kraig Adams are demo RESERVE locks.
- Re-freeze three days before any demo, run a dry run, and re-verify that protected chips remain unsearched.
- Do not spend ScrapeCreators credits unless the prompt explicitly authorizes it. Every outbound attempt costs a credit; retrying a 5xx spends another credit.
- Never fabricate data, including in the UI. Label null or unknown states as unknown; never invent values.
- Seed mining is manual-only through the Expand action. Never schedule it.
- Regen Queries rebuilds chips from stored titles. It does not mine, and it is poison while a seed's `videos` table is empty.

## Migration safety (from the Jul 16 cascade incident)

- Back up production D1 before any migration. Use `wrangler d1 export` to create a timestamped `.sql` file.
- Rebuild-style migrations on tables with foreign-key dependents fire `ON DELETE CASCADE` and `ON DELETE SET NULL`. `PRAGMA defer_foreign_keys` does not stop cascades caused by `DROP`. Prefer additive `ALTER TABLE` migrations.
- Around any migration that touches `channels`, verify pre- and post-migration row counts for every foreign-key-dependent table: `videos`, `seed_queries`, `seed_topics`, `outreach_log`, and channel seed provenance.

## Windows data handling (from the restore incident)

- Force strict UTF-8 for any data extraction or restore on Windows. The legacy PowerShell code page corrupts multibyte characters.
- Verify restored data with a byte-exact comparison.
- The Jul 16 restore corrupted 2,162 video rows on its first pass through mojibake. It was redone with strict UTF-8 and verified 2,265/2,265 exact.

## Cloudflare specifics

- Cron weekday numbers are `1=Sunday` through `7=Saturday`. Always use named days such as `MON,THU`; numeric weekdays already caused a silent wrong-day bug.
- Deploy with `wrangler deploy` through the release configuration. Local Miniflare state lives in `.wrangler` and is not production.

## Verification discipline

- Work on one named change at a time. Commit and push together, keep one feature per commit, and leave a clean working tree at the end of every session.
- Nothing is done until it is verified. Report exact before/after results, row counts, or UI state.
- Dry-run anything that spends credits or writes production D1.

## Known design facts (for future work)

- Expand pages `/v1/youtube/channel-videos` from page one every time. No cursor or offset is persisted per seed. Provider-default ordering is used. Upserts deduplicate stored rows, but previously seen pages are fetched and paid for again.
- RSS freshness reads `youtube.com/feeds/videos.xml`, which exposes the latest 15 entries, includes Shorts, and provides no content-type field. Current entries are persisted in `seed_rss_entries` and classified strictly with manual-redirect `HEAD /shorts/<video_id>` requests; ambiguous responses remain pending rather than being guessed.
- UNMINED is classified-set membership: current `is_short = 0` entries absent from stored videos. Shorts and pending entries never count as ore, and pending classification prevents a seed from being considered fully mined.
- In observed data, `/channel-videos` returns long-form videos only. Shorts present in RSS are not fetchable by the current Expand flow.
- Decision (Jul 23): SCOUT does not mine Shorts; they are thin ore. UNMINED must count long-form uploads only.
- `getVideoDetails(videoId)` exists in the client and costs one credit per video, but it is currently unused. Its response uses `publishDate`, while channel-video page items use `publishedTime`; an adapter is required if it is ever used.
