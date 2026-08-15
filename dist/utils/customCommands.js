import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
export const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/;
export function parseFrontmatter(markdown) {
    const match = markdown.match(FRONTMATTER_REGEX);
    if (!match) {
        return {
            frontmatter: {},
            content: markdown,
        };
    }
    const frontmatterText = match[1] || '';
    const content = markdown.slice(match[0].length);
    let frontmatter = {};
    try {
        const parsed = yaml.load(frontmatterText);
        if (parsed && typeof parsed === 'object') {
            frontmatter = parsed;
        }
    }
    catch (err) {
        console.error('Failed to parse frontmatter:', err);
    }
    return { frontmatter, content };
}
export function loadCustomCommands(cwd) {
    const commandsDir = path.join(cwd, '.guang', 'commands');
    const commands = [];
    if (!fs.existsSync(commandsDir)) {
        return commands;
    }
    try {
        const files = fs.readdirSync(commandsDir);
        for (const file of files) {
            if (!file.endsWith('.md'))
                continue;
            const filePath = path.join(commandsDir, file);
            const stat = fs.statSync(filePath);
            if (!stat.isFile())
                continue;
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const { frontmatter, content } = parseFrontmatter(fileContent);
            const commandName = file.replace(/\.md$/, '');
            // Default to true if not explicitly set to false
            const userInvocable = frontmatter['user-invocable'] !== false;
            if (!userInvocable)
                continue;
            const description = frontmatter.description || `Custom command loaded from ${file}`;
            commands.push({
                name: commandName,
                description,
                execute: async (args, state) => {
                    // Simply return the markdown content as a system message to guide the AI
                    // We prepend instructions so the AI knows it's a custom command template
                    let finalContent = content;
                    if (args.trim()) {
                        finalContent = `User provided arguments: ${args}\n\n${finalContent}`;
                    }
                    return `[System: Executing custom command /${commandName}]\n\n${finalContent}`;
                }
            });
        }
    }
    catch (err) {
        console.error(`Error loading custom commands from ${commandsDir}:`, err);
    }
    return commands;
}
