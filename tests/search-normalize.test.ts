import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSearchChannelRefs } from "../src/lib/search-normalize.js";

test("normalizes heterogeneous search results into deduped channel refs", () => {
  const refs = normalizeSearchChannelRefs({
    channels: [
      {
        id: "UCdirectchannel0000000001",
        title: "Direct Channel",
        handle: "@directfood",
      },
    ],
    videos: [
      {
        id: "video-1",
        title: "A video result",
        channel: {
          id: "UCvideochannel00000000001",
          title: "Video Channel",
          handle: "@videofood",
        },
      },
    ],
    shorts: [
      {
        id: "short-1",
        title: "A short from the same channel",
        channel: {
          id: "UCvideochannel00000000001",
          title: "Video Channel",
          handle: "@videofood",
        },
      },
    ],
    lives: [
      {
        id: "live-1",
        channel: {
          handle: "@livecook",
          title: "Live Cook",
        },
      },
    ],
    playlists: [
      {
        id: "PLsponsorplaylist",
        title: "Playlist without owner should not count",
      },
      {
        id: "PLcreatorplaylist",
        title: "Playlist with owner",
        owner: {
          url: "https://www.youtube.com/@playlistchef",
          title: "Playlist Chef",
        },
      },
    ],
    shelves: [
      {
        title: "People also watched",
        items: [
          {
            id: "shelf-video",
            channel: {
              id: "UCshelfchannel00000000001",
              title: "Shelf Channel",
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(refs[0], {
    type: "channelId",
    ref: "UCvideochannel00000000001",
    title: "Video Channel",
    hitCount: 2,
    sources: ["video", "short"],
  });

  assert.deepEqual(
    new Map(refs.slice(1).map((ref) => [ref.ref, [ref.type, ref.hitCount, ref.sources]])),
    new Map([
      ["UCdirectchannel0000000001", ["channelId", 1, ["channel"]]],
      ["livecook", ["handle", 1, ["live"]]],
      ["playlistchef", ["handle", 1, ["playlist"]]],
      ["UCshelfchannel00000000001", ["channelId", 1, ["shelf"]]],
    ]),
  );
});

test("ignores playlists and shelves without clear channel references", () => {
  const refs = normalizeSearchChannelRefs({
    playlists: [
      {
        id: "PLonlyplaylist000000000",
        url: "https://www.youtube.com/playlist?list=PLonlyplaylist000000000",
        title: "Pure playlist result",
      },
    ],
    shelves: [
      {
        title: "Topic shelf",
        items: [
          {
            id: "topic-1",
            title: "No channel on this shelf item",
          },
        ],
      },
    ],
  });

  assert.equal(refs.length, 0);
});

test("does not treat generic video URLs as channel refs", () => {
  const refs = normalizeSearchChannelRefs({
    videos: [
      {
        id: "video-without-channel",
        url: "https://www.youtube.com/watch?v=abc123",
        title: "Video result missing channel block",
      },
    ],
    channels: [
      {
        title: "Custom URL Channel",
        url: "https://www.youtube.com/c/CustomChef",
      },
    ],
  });

  assert.deepEqual(
    refs.map((ref) => [ref.type, ref.ref]),
    [["url", "https://www.youtube.com/c/CustomChef"]],
  );
});
