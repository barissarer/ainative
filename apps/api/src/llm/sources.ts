import type Anthropic from "@anthropic-ai/sdk";

export interface Source {
  id: string; // S1, S2…
  url: string;
  title: string;
  snippets: string[];
}

/** Collect URLs the model actually retrieved or cited. Only these can back a "Fact". */
export function extractSources(blocks: Anthropic.ContentBlock[], existing: Source[] = []): Source[] {
  const byUrl = new Map(existing.map((s) => [s.url, s]));
  const add = (url: string, title: string | null | undefined, snippet?: string | null) => {
    if (!url) return;
    let s = byUrl.get(url);
    if (!s) {
      s = { id: `S${byUrl.size + 1}`, url, title: title || url, snippets: [] };
      byUrl.set(url, s);
    }
    if (snippet && !s.snippets.includes(snippet)) s.snippets.push(snippet.slice(0, 400));
  };
  for (const b of blocks as any[]) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === "web_search_result") add(r.url, r.title);
    } else if (b.type === "web_fetch_tool_result" && b.content?.url) {
      add(b.content.url, b.content.document?.title);
    } else if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) if (c.url) add(c.url, c.title, c.cited_text);
    }
  }
  return [...byUrl.values()];
}

export function textOf(blocks: Anthropic.ContentBlock[]): string {
  return blocks
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export function formatSources(sources: Source[]): string {
  return sources
    .map((s) => `${s.id}: ${s.title} (${s.url})${s.snippets.length ? `\n   excerpts: ${s.snippets.map((x) => `"${x}"`).join(" | ")}` : ""}`)
    .join("\n");
}
