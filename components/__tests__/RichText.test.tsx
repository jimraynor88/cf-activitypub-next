import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RichText } from "@/components/RichText";

describe("RichText", () => {
  it("renders text and allowed tags as React elements", () => {
    render(<RichText html="<p>hola <strong>mundo</strong></p>" />);
    const p = document.querySelector("p");
    expect(p).toBeTruthy();
    expect(p?.textContent).toBe("hola mundo");
    expect(document.querySelector("strong")?.textContent).toBe("mundo");
  });

  it("escapes raw script content instead of executing it", () => {
    render(<RichText html="<p><script>alert(1)</script></p>" />);
    expect(document.querySelector("script")).toBeNull();
    const p = document.querySelector("p");
    expect(p).toBeTruthy();
  });

  it("strips disallowed tags but keeps their inner content", () => {
    const { container } = render(<RichText html="<div>texto <b>negrita</b></div>" />);
    expect(container.querySelector("div")).toBeNull();
    expect(container.textContent).toContain("texto");
    expect(container.textContent).toContain("negrita");
  });

  it("decodes HTML entities in text", () => {
    const { container } = render(<RichText html={"<p>a &amp; b &lt; c</p>"} />);
    expect(container.querySelector("p")?.textContent).toBe("a & b < c");
  });

  it("preserves safe hrefs and drops javascript: links entirely", () => {
    const { container } = render(
      <RichText html={'<p><a href="/users/remote?url=x">enlace</a> <a href="javascript:alert(1)">malo</a></p>'} />
    );
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/users/remote?url=x"]);
    expect(container.textContent).toContain("malo");
  });

  it("renders mention class into className", () => {
    render(<RichText html='<p><a href="https://x.example/@u" class="u-url mention">@u</a></p>' />);
    expect(document.querySelector("a")?.className).toContain("mention");
  });

  it("renders custom emoji <img> tags", () => {
    render(<RichText html='<p><img src="https://cdn.example/e.png" alt=":blob:" class="emojione" width="16" height="16" /></p>' />);
    const img = document.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("https://cdn.example/e.png");
  });

  it("handles nested lists and quotes", () => {
    render(<RichText html="<blockquote><p><code>x</code></p></blockquote><ul><li>uno</li></ul>" />);
    expect(document.querySelector("blockquote")).toBeTruthy();
    expect(document.querySelector("code")?.textContent).toBe("x");
    expect(document.querySelector("ul")?.textContent).toBe("uno");
  });

  it("adds nofollow rel to links that lack it", () => {
    render(<RichText html='<p><a href="https://x.example">enlace</a></p>' />);
    expect(document.querySelector("a")?.getAttribute("rel")).toContain("nofollow");
  });

  it("keeps explicit target attribute on links", () => {
    render(<RichText html='<p><a href="https://x.example" target="_blank">enlace</a></p>' />);
    expect(document.querySelector("a")?.getAttribute("target")).toBe("_blank");
  });
});
