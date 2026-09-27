#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { TOOLS, createLinkedIn } from "./tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });
const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8"));

const callTool = createLinkedIn({
  token: process.env.LINKEDIN_ACCESS_TOKEN,
  personUrn: process.env.LINKEDIN_PERSON_URN || null,
  apiVersion: process.env.LINKEDIN_API_VERSION || undefined
});

const server = new Server(
  { name: "linkedin-growth-mcp", version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(req.params.name, req.params.arguments || {}));

const transport = new StdioServerTransport();
await server.connect(transport);
