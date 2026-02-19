# GitHub MCP Server Setup

## Overview
The GitHub MCP (Model Context Protocol) Server allows AI tools to interact with GitHub repositories, manage issues, pull requests, and analyze code.

## Installation

### Option 1: Using npx (Recommended)
```bash
npx -y @modelcontextprotocol/server-github
```

### Option 2: Install globally
```bash
npm install -g @modelcontextprotocol/server-github
```

## Configuration

### 1. Create GitHub Personal Access Token (PAT)
1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate a new token with the following scopes:
   - `repo` (full control of private repositories)
   - `read:org` (read org membership)
   - `read:user` (read user profile)
   - `read:gpg_key` (read GPG keys)

### 2. Configure in Cursor

#### For Cursor Settings (JSON):
Add to your Cursor settings (usually in `~/.cursor/settings.json` or Cursor Settings UI):

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_pat_here"
      }
    }
  }
}
```

#### Alternative: Environment Variable
Set the environment variable in your shell:
```bash
export GITHUB_PERSONAL_ACCESS_TOKEN="your_pat_here"
```

### 3. Repository Configuration (Optional)
If you want to limit access to specific repositories, you can configure:
- `GITHUB_REPOSITORY` - specific repository (format: `owner/repo`)
- `GITHUB_OWNER` - specific owner/organization

## Usage

Once configured, you can use GitHub MCP commands through Cursor:
- Read repository files
- Create and manage issues
- Create and manage pull requests
- Search code
- Get repository information
- Analyze commits and branches

## Security Notes
- Never commit your PAT to version control
- Use environment variables or secure configuration
- Rotate tokens regularly
- Use minimal required scopes

## Reference
- Official GitHub MCP Server: https://github.com/github/github-mcp-server
- MCP Documentation: https://modelcontextprotocol.io


