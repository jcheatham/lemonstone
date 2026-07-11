import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/ui/markdown-render.ts";

describe("renderMarkdown", () => {
  it("renders plain markdown normally", () => {
    const html = renderMarkdown("# Hello\n\nWorld");
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<p>World</p>");
  });

  it("still rewrites wikilinks (regression guard for the shared renderer)", () => {
    const html = renderMarkdown("See [[Some Note]]");
    expect(html).toContain('data-wikilink="Some Note"');
  });

  it("renders a ```s3vault fence as a locked card widget, not a code block", () => {
    const html = renderMarkdown("```s3vault\nabc123XYZ\n```");
    expect(html).toContain('class="s3vault-card"');
    expect(html).toContain('data-blob="abc123XYZ"');
    expect(html).not.toContain("<pre>");
    expect(html).not.toContain("<code>");
  });

  it("leaves other fenced code languages untouched", () => {
    const html = renderMarkdown("```js\nconsole.log(1)\n```");
    expect(html).toContain("<pre>");
    expect(html).not.toContain("s3vault-card");
  });

  it("escapes the blob safely for the data attribute", () => {
    const html = renderMarkdown('```s3vault\nhas"quote&amp\n```');
    expect(html).toContain("&quot;");
    expect(html).not.toContain('data-blob="has"quote"'); // would break the attribute if unescaped
  });

  it("trims whitespace around the blob", () => {
    const html = renderMarkdown("```s3vault\n  blob-with-space  \n```");
    expect(html).toContain('data-blob="blob-with-space"');
  });
});
