#!/usr/bin/env node
// One-time OAuth helper — LinkedIn access token generate karne ke liye
// Usage: LINKEDIN_CLIENT_ID=xxx LINKEDIN_CLIENT_SECRET=yyy node auth.js
import { createServer } from "http";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const PORT = 8914;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = "openid profile email w_member_social";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log("❌ .env mein LINKEDIN_CLIENT_ID aur LINKEDIN_CLIENT_SECRET daalo pehle");
  console.log("App banao: https://www.linkedin.com/developers/apps");
  process.exit(1);
}

const authUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent(SCOPES)}`;

console.log("\n🔗 Browser mein yeh URL kholo aur LinkedIn se authorize karo:\n");
console.log(authUrl + "\n");
console.log(`⏳ Callback ka intezaar... (localhost:${PORT})\n`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") { res.end(); return; }
  const code = url.searchParams.get("code");
  if (!code) {
    res.end("Error: no code. Terminal dekho.");
    console.log("❌ Authorization failed:", url.searchParams.get("error_description"));
    return;
  }
  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    })
  });
  const data = await tokenRes.json();
  if (data.access_token) {
    res.end("✅ Token mil gaya! Terminal dekho. Yeh window band kar sakte ho.");
    console.log("\n✅ ACCESS TOKEN (60 din valid):\n");
    console.log("LINKEDIN_ACCESS_TOKEN=" + data.access_token);
    console.log("\nIsse .env mein save karo aur claude mcp add command mein use karo.");
  } else {
    res.end("❌ Token exchange failed. Terminal dekho.");
    console.log("❌ Failed:", JSON.stringify(data));
  }
  server.close();
});

server.listen(PORT);
