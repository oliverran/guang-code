export type Skill = {
    id: string;
    name: string;
    description: string;
    prompt: string;
    allowedTools?: string[];
    arguments?: string[];
    argumentHint?: string;
    userInvocable: boolean;
    sourcePath: string;
};
export declare function loadAllSkills(cwd: string): Skill[];
export declare function renderSkillInvocation(skill: Skill, args: string): string;
