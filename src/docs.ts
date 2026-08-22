import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config";
import { layout } from "./views";

type DocsPage = { path: string; title: string; description: string; section: string; source: string };

const PAGES: DocsPage[] = [
  { path: "", title: "Forms docs", description: "How to add a form to your page, post from JavaScript, and host the service yourself.", section: "Start", source: "index.md" },
  { path: "connect-form", title: "Connect your form", description: "Register a page, copy the endpoint, paste the snippet.", section: "Start", source: "connect-form.md" },
  { path: "json-api", title: "JSON API", description: "Post JSON from your registered origin and read the response codes.", section: "Start", source: "json-api.md" },
  { path: "self-hosting", title: "Self-hosting", description: "One container, one SQLite file, and every environment variable.", section: "Operate", source: "self-hosting.md" },
  { path: "backup-restore", title: "Backup and restore", description: "Two commands and one SQLite file.", section: "Operate", source: "backup-restore.md" },
  { path: "limits", title: "Limits", description: "Hosted quotas, rate limits, and per-request bounds.", section: "Reference", source: "limits.md" },
  { path: "security", title: "Security and data handling", description: "What is stored, hashed, logged, and deletable.", section: "Reference", source: "security.md" },
];

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const slug = (value: string) => value.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const COPY_ICON = '<svg class="copy-icon" viewBox="0 0 24 24" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><svg class="check-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>';

// Minimal server-side highlighter. Input is the markdown renderer's escaped
// code (&lt; &gt; &quot; &amp;), output adds span.tok-* wrappers. Rules run
// in order; the earliest match wins, so comments beat strings beat keywords.
type TokenRule = { re: RegExp; cls: string };
const TOKEN_RULES: Record<string, TokenRule[]> = {
  sh: [
    { re: /(?:^|(?<=\s))#[^\n]*/, cls: "com" },
    { re: /&quot;[\s\S]*?&quot;|'[^'\n]*'/, cls: "str" },
    { re: /(?:^|(?<=\n))\s*(?:git|cd|cp|docker|podman|bun|openssl|curl)\b/, cls: "kw" },
  ],
  js: [
    { re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//, cls: "com" },
    { re: /&quot;[\s\S]*?&quot;|'[^'\n]*'|`[^`]*`/, cls: "str" },
    { re: /\b(?:const|let|var|function|return|await|async|if|else|for|while|new|import|export|from|try|catch|throw|typeof|class|of|in)\b/, cls: "kw" },
  ],
  html: [
    { re: /&lt;!--[\s\S]*?--&gt;/, cls: "com" },
    { re: /&quot;[\s\S]*?&quot;/, cls: "str" },
    { re: /&lt;\/?[a-zA-Z][\w-]*|\/?&gt;/, cls: "kw" },
    { re: /(?<=\s)[a-zA-Z-]+(?==&quot;)/, cls: "attr" },
  ],
};

function highlight(code: string, language: string): string {
  const rules = TOKEN_RULES[language];
  if (!rules) return code;
  let output = "";
  let rest = code;
  while (rest) {
    let earliest: { index: number; text: string; cls: string } | undefined;
    for (const rule of rules) {
      const match = rest.match(rule.re);
      if (match?.[0] && (!earliest || match.index! < earliest.index)) {
        earliest = { index: match.index!, text: match[0], cls: rule.cls };
      }
    }
    if (!earliest) return output + rest;
    output += rest.slice(0, earliest.index);
    output += `<span class="tok-${earliest.cls}">${earliest.text}</span>`;
    rest = rest.slice(earliest.index + earliest.text.length);
  }
  return output;
}

function renderMarkdown(markdown: string): string {
  return Bun.markdown.html(markdown)
    .replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_match, level, text) => {
      const id = slug(text);
      return `<h${level} id="${id}">${text}<a class="docs-anchor" href="#${id}" aria-label="Link to ${id}">#</a></h${level}>`;
    })
    .replace(/<pre><code(?: class="language-([^"]+)")?>([\s\S]*?)<\/code><\/pre>/g, (_match, language = "text", code) => `<div class="docs-code"><div class="docs-code-bar"><span>${escape(language)}</span><button class="docs-copy" type="button" data-copy-code aria-label="Copy code">${COPY_ICON}</button></div><pre><code>${highlight(code, language)}</code></pre></div>`)
    .replace(/<table>([\s\S]*?)<\/table>/g, '<div class="docs-table-wrap"><table>$1</table></div>');
}

function sidebar(activePath: string): string {
  return [...new Set(PAGES.map(({ section }) => section))].map((section) => {
    const links = PAGES.filter((page) => page.section === section).map((page) => {
      const href = page.path ? `/docs/${page.path}` : "/docs";
      return `<a href="${href}"${page.path === activePath ? ' aria-current="page"' : ""}>${escape(page.title)}</a>`;
    }).join("");
    return `<div class="docs-nav-group"><h2>${escape(section)}</h2>${links}</div>`;
  }).join("");
}

function pager(index: number): string {
  const link = (page: DocsPage, direction: "prev" | "next") => `<a class="docs-pager-${direction}" href="${page.path ? `/docs/${page.path}` : "/docs"}"><span>${direction === "prev" ? "Previous" : "Next"}</span><strong>${escape(page.title)}</strong></a>`;
  return `${index ? link(PAGES[index - 1]!, "prev") : ""}${index < PAGES.length - 1 ? link(PAGES[index + 1]!, "next") : ""}`;
}

const directory = join(import.meta.dir, "..", "docs");
const sources = new Map(PAGES.map((page) => [page.path, readFileSync(join(directory, page.source), "utf8")]));
const rendered = new Map(PAGES.map((page, index) => {
  const content = `<div class="docs-frame">
    <button class="docs-menu" type="button" aria-expanded="false" aria-controls="docs-sidebar">Browse docs</button>
    <aside class="docs-sidebar" id="docs-sidebar" aria-label="Documentation">
      <div class="docs-sidebar-head"><a href="/docs"><span lang="ja">渋み</span> Docs</a><button type="button" class="docs-close" aria-label="Close documentation menu">×</button></div>
      <div class="docs-nav">${sidebar(page.path)}</div>
    </aside>
    <article class="docs-article">
      <header class="docs-article-head"><p>${escape(page.section)}</p><h1>${escape(page.title)}<span>.</span></h1><div>${escape(page.description)}</div></header>
      <div class="docs-prose">${renderMarkdown(sources.get(page.path)!)}</div>
      <div class="docs-pager" role="navigation" aria-label="Documentation pages">${pager(index)}</div>
    </article>
    <aside class="docs-outline" aria-label="On this page"><strong>On this page</strong><div data-docs-outline></div></aside>
  </div><script src="/assets/docs.js" defer></script>`;
  return [page.path, { title: page.title, content }];
}));

export function renderDocsPage(config: AppConfig, path: string, signedIn: boolean): string | undefined {
  const page = rendered.get(path);
  if (!page) return undefined;
  return layout(config, page.title, page.content, false, signedIn, {
    head: '\n  <link rel="stylesheet" href="/assets/docs.css">',
    bodyClass: "docs-page",
  });
}

export function docsMarkdownSource(path: string): string | undefined {
  return sources.get(path);
}
