# Adobe Skills for AI Coding Agents

Official Adobe skills for AI coding agents.

## Installation

Choose your preferred method:

### Claude Code Plugins

```bash
/plugin marketplace add adobe/skills
/plugin install aem-content-driven-development@adobe-skills
```

### Vercel Skills (npx skills)

```bash
# Install a specific skill
npx skills add adobe/skills -s aem-content-driven-development

# Install all AEM Edge Delivery skills
npx skills add adobe/skills -s aem-edge-delivery

# Install all skills
npx skills add adobe/skills --all
```

### upskill (GitHub CLI Extension)

```bash
gh extension install trieloff/gh-upskill
gh upskill adobe/skills
```

## Available Skills

TODO

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on adding or updating skills.

## Resources

- [agentskills.io Specification](https://agentskills.io)
- [Claude Code Plugins Documentation](https://docs.anthropic.com/en/docs/claude-code)
- [Vercel Skills](https://github.com/vercel-labs/skills)
- [upskill GitHub Extension](https://github.com/trieloff/gh-upskill)

## License

Apache 2.0 - see [LICENSE](LICENSE) for details.
