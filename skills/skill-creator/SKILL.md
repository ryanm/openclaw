---
name: skill-creator
description: Create or update AgentSkills. Use when designing, structuring, or packaging skills with scripts, references, and assets.
---

# Skill Creator

Guidance for creating effective, concise skills that extend agent capabilities.

## Core Principles

**Concise is key** — The context window is shared. Only add essential information Codex doesn't already have. Prefer bullet points over paragraphs.

**Set appropriate degrees of freedom**:
- **High freedom**: Text instructions when multiple valid approaches exist
- **Medium freedom**: Pseudocode/scripts with parameters for preferred patterns  
- **Low freedom**: Specific scripts for fragile, error-prone operations

**Progressive disclosure**: Load only what's needed:
1. Metadata (name + description) — always in context
2. SKILL.md body — when skill triggers
3. Bundled resources — as needed

## Anatomy of a Skill

```
skill-name/
├── SKILL.md (required)
│   ├── Frontmatter: name + description (required)
│   └── Body: instructions (required)
└── Bundled Resources (optional)
    ├── scripts/          - Executable code
    ├── references/       - Documentation loaded as needed
    └── assets/           - Files used in output
```

### SKILL.md Requirements
- **Frontmatter**: `name` (hyphen-case) and `description` (triggers usage). Be comprehensive about when to use.
- **Body**: Imperative instructions. Keep under 500 lines. Move details to reference files.

### Bundled Resources
- **Scripts**: For deterministic reliability or repeated code
- **References**: Domain knowledge, schemas, API docs. Load only when needed.
- **Assets**: Templates, images, boilerplate used in output.

## Progressive Disclosure Patterns

**Pattern 1: High-level guide with references**
```markdown
# PDF Processing
## Quick start
[code example]
## Advanced features  
- **Form filling**: See [FORMS.md](FORMS.md)
```

**Pattern 2: Domain-specific organization**
```
skill/
├── SKILL.md (overview)
└── reference/
    ├── finance.md
    ├── sales.md
    └── product.md
```

**Pattern 3: Conditional details**
Show basic content, link to advanced features.

## Skill Creation Process

1. **Understand** with concrete examples
2. **Plan** reusable resources (scripts, references, assets)
3. **Initialize** with `scripts/init_skill.py <name> --path <dir>`
4. **Edit** skill:
   - Test scripts
   - Write frontmatter with comprehensive description
   - Write body with imperative instructions
   - Move details to reference files
5. **Package** with `scripts/package_skill.py <path>`

## Packaging

Run `scripts/package_skill.py <skill-folder>` to create distributable .skill file. Validates skill first.

---

*Remember: Concise is key. Challenge every paragraph. Keep SKILL.md under 500 lines, aim for under 100.*