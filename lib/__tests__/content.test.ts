import { describe, it, expect } from "vitest";
import { processStatusContent } from "@/lib/activitypub/content";

describe("processStatusContent URL vs hashtag handling", () => {
  it("does not treat a #fragment inside a URL as a hashtag", () => {
    const url = "https://github.com/manalejandro/cf-activitypub-next/blob/main/components/APTypeBlock.tsx#L33-L42";
    const { html, tags } = processStatusContent(url);

    // The whole URL must be one single link that points at the original URL.
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(`${url}</a>`);
    expect(html).toMatch(/<a[^>]+href="https:\/\/github\.com[^>]*>https:\/\/github\.com[\s\S]*<\/a>/);

    // No fragment/tag link should be produced.
    expect(html).not.toContain('/tags/l33');
    expect(html).not.toContain('class="tag"');

    // No Hashtag AP tag should be emitted either.
    expect(tags.some((t) => t.type === "Hashtag")).toBe(false);
  });

  it("still honors real hashtags outside URLs", () => {
    const { html, tags } = processStatusContent("post #cats hello https://example.com/a#section world #dogs");
    expect(tags.filter((t) => t.type === "Hashtag").map((t) => t.name)).toEqual(["#cats", "#dogs"]);
    expect(html).toContain('href="https://example.com/a#section"');
    expect(html).not.toContain('/tags/section');
  });

  it("renders remote mentions as @user display with a full link", () => {
    const { html, tags } = processStatusContent("hola @alice@example.com!");

    // Display text shows only the username, not the domain.
    expect(html).toContain(">@<span>alice</span></a>");
    expect(html).not.toContain(">@<span>alice@example.com</span></a>");

    // The link target and the AP Mention tag keep the full handle/address.
    expect(html).toContain('href="https://example.com/@alice"');
    expect(html).toContain('title="@alice@example.com"');
    expect(tags).toContainEqual({ type: "Mention", href: "https://example.com/@alice", name: "@alice@example.com" });
  });
});