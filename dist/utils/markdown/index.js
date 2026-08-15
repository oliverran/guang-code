import { marked } from 'marked';
import chalk from 'chalk';
import { highlight } from 'cli-highlight';
// Configure marked to use our custom renderer for marked v11+
// Note: In marked v11+, renderer methods take a single token object argument
// instead of multiple primitive arguments.
const renderer = new marked.Renderer();
renderer.code = (token) => {
    const lang = token.lang || 'txt';
    const code = token.text;
    try {
        const highlighted = highlight(code, { language: lang, ignoreIllegals: true });
        return `\n${highlighted}\n`;
    }
    catch (e) {
        return `\n${code}\n`;
    }
};
renderer.codespan = (token) => chalk.cyan(token.text);
renderer.strong = (token) => chalk.bold(token.text);
renderer.em = (token) => chalk.italic(token.text);
renderer.del = (token) => chalk.strikethrough(token.text);
renderer.heading = (token) => {
    const prefix = '#'.repeat(token.depth);
    return `\n${chalk.magenta.bold(`${prefix} ${token.text}`)}\n`;
};
renderer.list = (token) => {
    // We need to parse the inner tokens since marked v11+ doesn't pre-render them
    let body = '';
    if (token.items && Array.isArray(token.items)) {
        for (const item of token.items) {
            body += renderer.listitem(item);
        }
    }
    return `\n${body}\n`;
};
renderer.listitem = (token) => {
    let text = token.text || '';
    // Basic parsing for inner tokens if needed, but text usually contains the raw string
    return `  ${chalk.gray('•')} ${text}\n`;
};
renderer.paragraph = (token) => `${token.text}\n`;
renderer.link = (token) => chalk.blue.underline(`${token.text} (${token.href})`);
renderer.blockquote = (token) => {
    const quote = token.text || '';
    return chalk.gray.italic(`  │ ${quote.replace(/\n/g, '\n  │ ')}\n`);
};
renderer.hr = () => `\n${chalk.gray('─'.repeat(40))}\n`;
marked.setOptions({
    renderer,
    gfm: true,
    breaks: false
});
export function renderMarkdown(markdown) {
    if (!markdown)
        return '';
    try {
        // marked.parse returns a string or Promise depending on async options
        // Since we don't use async options, we can safely cast to string
        const result = marked.parse(markdown);
        return result.replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .trim();
    }
    catch (e) {
        // Fallback to plain text if parsing fails
        return markdown;
    }
}
