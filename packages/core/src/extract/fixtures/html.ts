/** Full HTML document: nav, an <article> with title + `words` words in 50-word paragraphs, footer. */
export function articleHtml(title: string, words: number): string {
  const paragraphs: string[] = [];
  for (let start = 0; start < words; start += 50) {
    const end = Math.min(start + 50, words);
    const chunk: string[] = [];
    for (let i = start; i < end; i++) chunk.push(`w${i}`);
    paragraphs.push(`<p>${chunk.join(' ')}.</p>`);
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body>
<nav>Home About Pricing</nav>
<article>
<h1>${title}</h1>
${paragraphs.join('\n')}
</article>
<footer>Copyright junk</footer>
</body></html>`;
}
