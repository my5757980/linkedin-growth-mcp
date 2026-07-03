# linkedin-growth-mcp

Custom **MCP (Model Context Protocol) server** for LinkedIn — post to your profile via the official (free) LinkedIn API.

Published on npm: [`@mj4384963/linkedin-growth-mcp`](https://www.npmjs.com/package/@mj4384963/linkedin-growth-mcp)

## 3 Tools

| Tool | What it does |
|------|-------------|
| `post_to_linkedin` | Publish a text post to your profile |
| `post_with_link` | Publish a post with a link preview card (GitHub repo, demo, article) |
| `get_my_profile` | Get your profile basics (name, email, person URN) |

> Note: LinkedIn's public API only allows **posting to your own profile** (free). Follows, comments, feed reading are NOT available in the public API — those are partner-only.

## Setup (one time)

### 1. Create a LinkedIn Developer App
- Go to [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) → Create app
- Add products: **"Share on LinkedIn"** + **"Sign In with LinkedIn using OpenID Connect"**
- In Auth tab, add redirect URL: `http://localhost:8914/callback`
- Copy Client ID + Client Secret

### 2. Get your access token (60-day validity)
```bash
npx -y @mj4384963/linkedin-growth-mcp   # no — for auth use:
git clone https://github.com/my5757980/linkedin-growth-mcp
cd linkedin-growth-mcp && npm install
# put LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET in .env
npm run auth   # opens OAuth flow, prints LINKEDIN_ACCESS_TOKEN
```

### 3. Connect to Claude Code
```bash
claude mcp add linkedin-growth -s user \
  -e LINKEDIN_ACCESS_TOKEN=your_token \
  -- npx -y @mj4384963/linkedin-growth-mcp@latest
```

## Stack
- Node.js (ES modules) · `@modelcontextprotocol/sdk` · LinkedIn REST API (ugcPosts + OpenID userinfo) · stdio transport

---

Built by [Muhammad Yaseen](https://github.com/my5757980) · [LinkedIn](https://www.linkedin.com/in/muhammadyaseen-ai/) · [@MuhammadYa5968](https://x.com/MuhammadYa5968)
