/**
 * Agent Web Tools
 * Provides live web search, webpage content extraction, and AI image generation for the autonomous agent.
 *
 * @module agent/agentWeb
 */

/**
 * Perform a live web search using DuckDuckGo HTML endpoint (zero API key required)
 */
export async function searchWeb(query, limit = 5) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return { error: "Query is required." };

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      return { error: `Search request failed with status ${res.status}` };
    }

    const html = await res.text();
    const results = [];

    // Parse DuckDuckGo HTML results
    const blocks = html.split('class="result__body');
    for (let i = 1; i < blocks.length && results.length < limit; i++) {
      const block = blocks[i];

      // Extract title and link
      const titleMatch = block.match(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
                         block.match(/<a class="result__snippet"[^>]*href="([^"]+)"/i);
      const headingMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);

      let link = headingMatch ? headingMatch[1] : titleMatch ? titleMatch[1] : "";
      let title = headingMatch ? headingMatch[2] : "";

      // Clean duckduckgo redirect link if present
      if (link.includes("uddg=")) {
        const param = link.split("uddg=")[1]?.split("&")[0];
        if (param) link = decodeURIComponent(param);
      }

      // Extract snippet
      const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);
      let snippet = snippetMatch ? snippetMatch[1] : "";

      // Strip HTML tags and entities
      title = title.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim();
      snippet = snippet.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").trim();

      if (title && (snippet || link)) {
        results.push({
          title,
          link,
          snippet,
        });
      }
    }

    if (!results.length) {
      return { query: cleanQuery, count: 0, results: [], message: "No search results found." };
    }

    return {
      query: cleanQuery,
      count: results.length,
      results,
    };
  } catch (err) {
    return { error: `Web search failed: ${err?.message || err}` };
  }
}

/**
 * Fetch and extract readable plain text from a webpage URL
 */
export async function fetchWebpage(targetUrl, maxLength = 3500) {
  try {
    const parsed = new URL(targetUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { error: "Only http and https URLs are supported." };
    }

    const res = await fetch(parsed.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      return { error: `Failed to fetch webpage (Status ${res.status}: ${res.statusText})` };
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      const json = await res.json();
      return { url: targetUrl, type: "json", content: JSON.stringify(json, null, 2).slice(0, maxLength) };
    }

    const html = await res.text();

    // Remove script, style, svg, header, footer tags
    const cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<svg[\s\S]*?<\/svg>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "");

    // Extract title
    const titleMatch = cleanHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    // Convert headings and paragraphs to text
    const text = cleanHtml
      .replace(/<(h[1-6]|p|div|li)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s{2,}/g, " ")
      .replace(/\n\s*\n/g, "\n\n")
      .trim();

    return {
      url: targetUrl,
      title,
      text: text.slice(0, maxLength),
    };
  } catch (err) {
    return { error: `Failed to load webpage: ${err?.message || err}` };
  }
}

/**
 * Generate an AI image via free Pollinations / FLUX endpoint
 */
export async function generateAIImage(prompt, { width = 1024, height = 1024, model = "flux" } = {}) {
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) throw new Error("Image prompt is required.");

  const encodedPrompt = encodeURIComponent(cleanPrompt);
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${model}&nologo=true`;

  const res = await fetch(imageUrl, {
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    throw new Error(`Image generation failed with status ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return {
    prompt: cleanPrompt,
    buffer,
    url: imageUrl,
    mimetype: "image/jpeg",
  };
}
