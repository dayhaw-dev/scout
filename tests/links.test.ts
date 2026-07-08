import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeContactUrl,
  sanitizedContactLinks,
} from "../src/lib/links.js";

test("sanitizeContactUrl allows only http, https, and mailto schemes", () => {
  assert.equal(sanitizeContactUrl("https://example.com/profile", "website"), "https://example.com/profile");
  assert.equal(sanitizeContactUrl("http://example.com/profile", "website"), "http://example.com/profile");
  assert.equal(sanitizeContactUrl("creator@example.com", "email"), "mailto:creator@example.com");
  assert.equal(sanitizeContactUrl("mailto:creator@example.com", "email"), "mailto:creator@example.com");
});

test("sanitizeContactUrl rejects scriptable, malformed, and control-character links", () => {
  assert.equal(sanitizeContactUrl("javascript:alert(1)", "website"), null);
  assert.equal(sanitizeContactUrl("data:text/html,<script>alert(1)</script>", "website"), null);
  assert.equal(sanitizeContactUrl("www.example.com/profile", "website"), null);
  assert.equal(sanitizeContactUrl("https://example.com/\u0000profile", "website"), null);
});

test("sanitizedContactLinks strips seeded javascript URLs before UI rendering", () => {
  const links = sanitizedContactLinks({
    website: "javascript:alert(1)",
    instagram: "https://instagram.com/safecreator",
    twitter: "data:text/html,<script>alert(1)</script>",
    email: "creator@example.com",
  });

  assert.deepEqual(links, [
    {
      type: "email",
      label: "Email",
      url: "mailto:creator@example.com",
    },
    {
      type: "instagram",
      label: "Instagram",
      url: "https://instagram.com/safecreator",
    },
  ]);
  assert.ok(!links.some((link) => link.url.startsWith("javascript:")));
  assert.ok(!links.some((link) => link.url.startsWith("data:")));
});
