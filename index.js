#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

const ACCESS_TOKEN = process.env.LINKEDIN_ACCESS_TOKEN;
const API = "https://api.linkedin.com";

async function li(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      "Authorization": `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LinkedIn API ${res.status}: ${text.substring(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// Get person URN (cached after first call)
let personUrn = process.env.LINKEDIN_PERSON_URN || null;
async function getPersonUrn() {
  if (personUrn) return personUrn;
  const me = await li("/v2/userinfo");
  personUrn = `urn:li:person:${me.sub}`;
  return personUrn;
}

const server = new Server(
  { name: "linkedin-growth-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "post_to_linkedin",
      description: "LinkedIn pe text post publish karo (apni profile se)",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Post ka poora content (max 3000 characters)" }
        },
        required: ["text"]
      }
    },
    {
      name: "post_with_link",
      description: "LinkedIn pe post karo ek link/article ke saath (link preview card ke saath)",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Post ka content" },
          url: { type: "string", description: "Share karne wala link (GitHub, demo, article)" },
          title: { type: "string", description: "Link ka title (optional)" }
        },
        required: ["text", "url"]
      }
    },
    {
      name: "get_my_profile",
      description: "Apni LinkedIn profile ki basic info dekho (name, email)",
      inputSchema: { type: "object", properties: {} }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "get_my_profile") {
      const me = await li("/v2/userinfo");
      return {
        content: [{
          type: "text",
          text: `👤 ${me.name}\n📧 ${me.email || "email scope nahi"}\n🌍 ${me.locale?.country || ""}\nURN: urn:li:person:${me.sub}`
        }]
      };
    }

    if (name === "post_to_linkedin") {
      const author = await getPersonUrn();
      const body = {
        author,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: args.text },
            shareMediaCategory: "NONE"
          }
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
      };
      const result = await li("/v2/ugcPosts", { method: "POST", body: JSON.stringify(body) });
      return {
        content: [{ type: "text", text: `✅ LinkedIn post published!\nID: ${result.id}` }]
      };
    }

    if (name === "post_with_link") {
      const author = await getPersonUrn();
      const body = {
        author,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: args.text },
            shareMediaCategory: "ARTICLE",
            media: [{
              status: "READY",
              originalUrl: args.url,
              ...(args.title ? { title: { text: args.title } } : {})
            }]
          }
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
      };
      const result = await li("/v2/ugcPosts", { method: "POST", body: JSON.stringify(body) });
      return {
        content: [{ type: "text", text: `✅ LinkedIn post with link published!\nID: ${result.id}\nLink: ${args.url}` }]
      };
    }

    return { content: [{ type: "text", text: `❌ Unknown tool: ${name}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `❌ Error: ${err.message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
