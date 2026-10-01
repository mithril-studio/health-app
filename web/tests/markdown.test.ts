import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "../src/components/chat-markdown";

const render = (content: string) =>
  renderToStaticMarkup(createElement(ChatMarkdown, { content }));
test("assistant markdown renders emphasis, lists, headings, tables and code", () => {
  const html = render(
    "# Plan\n\n**Easy** and *steady*.\n\n- Run\n- Recover\n\n| Day | Load |\n| --- | --- |\n| Mon | Low |\n\n`5 km`",
  );
  assert.match(html, /<h2>Plan<\/h2>/);
  assert.match(html, /<strong>Easy<\/strong>/);
  assert.match(html, /<em>steady<\/em>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<table>/);
  assert.match(html, /<code>5 km<\/code>/);
});
test("raw HTML, images and unsafe links never execute in a coach response", () => {
  const html = render(
    "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29)\n\n![tracking](https://example.com/pixel)",
  );
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
});
test("external markdown links do not leak the private page as referrer", () => {
  const html = render("[Intervals](https://intervals.icu)");
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
});
