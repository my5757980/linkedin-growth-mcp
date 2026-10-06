# linkedin-growth-mcp

Custom **MCP (Model Context Protocol) server** for LinkedIn. It posts (text, links, images, videos, documents, multi-image posts and polls), edits, comments, reacts and reshares from your own profile through the official (free) LinkedIn API.

Published on npm: [`@mj4384963/linkedin-growth-mcp`](https://www.npmjs.com/package/@mj4384963/linkedin-growth-mcp)

## 12 Tools

| Tool | What it does |
|------|-------------|
| `post_to_linkedin` | Publish a text post to your profile |
| `post_with_link` | Publish a post with a link preview card (GitHub repo, demo, article) |
| `post_with_media` | Publish a post with one image or video, from a file on your computer or a URL |
| `post_document` | Publish a document (PDF, PowerPoint or Word, up to 100 MB / 300 pages) that readers swipe through like a carousel |
| `post_multi_image` | Publish a post with 2 to 20 images (JPG, PNG or GIF), with optional alt text |
| `post_poll` | Publish a poll: a question with 2 to 4 answers, open for 1, 3, 7 or 14 days |
| `comment_on_post` | Comment on any post, given its URL or URN |
| `like_post` | Like a post, or react with Celebrate, Love, Insightful, Support or Funny |
| `reshare_post` | Repost a post to your feed, optionally with your own text |
| `edit_post` | Change the text of one of your own posts |
| `delete_post` | Delete one of your own posts |
| `get_my_profile` | Get your profile basics (name, email, person URN) |

Posts, comments and reactions all run on the free `w_member_social` permission from the "Share on LinkedIn" product. LinkedIn describes it as "Post, comment and like posts on behalf of an authenticated member".
- **Not available:** following people, reading your feed or your followers, and reading your own posts or their analytics. Those need `r_member_social` and partner permissions, which LinkedIn restricts to approved partners.
- **Rate limit:** LinkedIn allows 150 requests per member per day.
- **Polls:** LinkedIn forbids polls on political opinions, health or other sensitive data, and a poll's answers cannot be edited after posting.

**Text on the Posts API tools** (`post_document`, `post_multi_image`, `post_poll`, `reshare_post`, `edit_post`): LinkedIn reads the characters `| { } @ [ ] ( ) < > # \ * _ ~` as markup, so the server escapes them for you. `#hashtags` stay hashtags, and `@[Company](urn:li:organization:ID)` mentions a company.

**Post URLs:**
- `comment_on_post`, `like_post` and `reshare_post` accept any of these:
  - a post URL (`linkedin.com/feed/update/urn:li:activity:…` or `linkedin.com/posts/…-activity-…`)
  - the embed code from the post's **… → Embed this post**
  - a URN
- `reshare_post`, `edit_post` and `delete_post` need the post's `urn:li:share:…` or `urn:li:ugcPost:…`. For your own posts, the post tools print it. For anyone else's post, it is in the embed code.

**Comments and reactions:** these first call LinkedIn's versioned `/rest` API (`Linkedin-Version: 202609`; set `LINKEDIN_API_VERSION` to change it). If that is refused outright (403, 404 or 426), they try the older `/v2/socialActions` API once. Any other failure is reported and not retried, so nothing is ever posted twice.

## Setup (one time)

### 1. Create a LinkedIn Developer App
- Go to [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) and click **Create app**.
- Add the products **"Share on LinkedIn"** and **"Sign In with LinkedIn using OpenID Connect"**.
- In the Auth tab, add the redirect URL `http://localhost:8914/callback`.
- Copy the Client ID and Client Secret.

### 2. Get your access token (valid for 60 days)
```bash
git clone https://github.com/my5757980/linkedin-growth-mcp
cd linkedin-growth-mcp && npm install
# put LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET in .env
npm run auth   # opens the OAuth flow and prints LINKEDIN_ACCESS_TOKEN
```
The token lasts 60 days. When a tool answers `401 … run npm run auth`, run it again and put the new token in your MCP config.

### 3. Connect to Claude Code
```bash
npm i -g @mj4384963/linkedin-growth-mcp
claude mcp add linkedin-growth -s user \
  -e LINKEDIN_ACCESS_TOKEN=your_token \
  -- node "$(npm root -g)/@mj4384963/linkedin-growth-mcp/index.js"
```
`-- npx -y @mj4384963/linkedin-growth-mcp@latest` works too. The catch: npx asks npm for the latest version on every start, and on a slow network that can exceed Claude Code's MCP connect timeout. After a new release, run `npm i -g @mj4384963/linkedin-growth-mcp@latest` to update the installed copy.

## Tests
```bash
npm test
```
Every tool is tested against a fake `fetch`, which checks each request's URL, method, headers and body against LinkedIn's docs. The server is also tested over stdio. Nothing is sent to LinkedIn.

## Stack
- Node.js 18+ (ES modules)
- `@modelcontextprotocol/sdk`, stdio transport
- LinkedIn API: ugcPosts, assets, Posts, Comments, Reactions and OpenID userinfo

---

Built by [Muhammad Yaseen](https://github.com/my5757980) · [LinkedIn](https://www.linkedin.com/in/muhammadyaseen-ai/) · [@MuhammadYa5968](https://x.com/MuhammadYa5968)
