// Every tool against a fake fetch: nothing here reaches LinkedIn, so nothing is ever posted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { TOOLS, createLinkedIn, postUrn } from "../tools.js";

const ME = "urn:li:person:abc123";
const ACTIVITY = "urn:li:activity:7234567890123456789";
const SHARE = "urn:li:share:7234567890123456790";

// Answers requests from a list of canned responses, in order, and records each request.
function fakeFetch(...responses) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", headers: init.headers || {}, body: init.body });
    const r = responses.shift();
    if (!r) throw new Error(`unexpected request: ${init.method || "GET"} ${url}`);
    const { status = 200, json, headers = {} } = r;
    const body = r.body ?? (json === undefined ? null : JSON.stringify(json));
    return new Response(status === 204 ? null : body, { status, headers });
  };
  fetch.calls = calls;
  return fetch;
}

const linkedIn = (fetch, extra = {}) => createLinkedIn({ token: "test-token", personUrn: ME, fetch, ...extra });
const textOf = result => result.content[0].text;

test("postUrn finds the post in every URL shape LinkedIn hands out", () => {
  assert.equal(postUrn(`https://www.linkedin.com/feed/update/${ACTIVITY}/`), ACTIVITY);
  assert.equal(postUrn("https://www.linkedin.com/posts/muhammadyaseen-ai_agentic-ai-activity-7234567890123456789-AbCd?utm_source=share"), ACTIVITY);
  assert.equal(postUrn("https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7234567890123456790"), SHARE);
  assert.equal(postUrn('<iframe src="https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:7234567890123456791" height="500">'), "urn:li:ugcPost:7234567890123456791");
  assert.equal(postUrn(`  ${SHARE}  `), SHARE);
  assert.throws(() => postUrn("hello"), /not a LinkedIn post URL or URN/);
  assert.throws(() => postUrn(undefined), /not a LinkedIn post URL or URN/);
});

test("post_to_linkedin looks up the member, then posts with the id from the x-restli-id header", async () => {
  const fetch = fakeFetch(
    { json: { sub: "abc123", name: "M Y" } },
    { status: 201, body: "", headers: { "x-restli-id": SHARE } }
  );
  const result = await createLinkedIn({ token: "test-token", fetch })("post_to_linkedin", { text: "Hello" });
  assert.equal(result.isError, undefined);
  assert.match(textOf(result), new RegExp(`ID: ${SHARE}`));
  assert.equal(fetch.calls[0].url, "https://api.linkedin.com/v2/userinfo");
  const post = fetch.calls[1];
  assert.equal(post.url, "https://api.linkedin.com/v2/ugcPosts");
  assert.equal(post.method, "POST");
  assert.equal(post.headers.Authorization, "Bearer test-token");
  assert.equal(post.headers["X-Restli-Protocol-Version"], "2.0.0");
  assert.equal(post.headers["Linkedin-Version"], undefined, "the v2 API takes no version header");
  const body = JSON.parse(post.body);
  assert.equal(body.author, ME);
  assert.equal(body.specificContent["com.linkedin.ugc.ShareContent"].shareCommentary.text, "Hello");
  assert.equal(body.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory, "NONE");
});

test("post_with_link sends an ARTICLE with the link and title", async () => {
  const fetch = fakeFetch({ status: 201, json: { id: SHARE } });
  const result = await linkedIn(fetch)("post_with_link", { text: "Repo", url: "https://github.com/x/y", title: "y" });
  assert.match(textOf(result), /with link published/);
  const content = JSON.parse(fetch.calls[0].body).specificContent["com.linkedin.ugc.ShareContent"];
  assert.equal(content.shareMediaCategory, "ARTICLE");
  assert.deepEqual(content.media, [{ status: "READY", originalUrl: "https://github.com/x/y", title: { text: "y" } }]);
});

test("comment_on_post uses the versioned Comments API with actor, object and message", async () => {
  const fetch = fakeFetch({ status: 201, json: { commentUrn: `urn:li:comment:(${ACTIVITY},999)` } });
  const result = await linkedIn(fetch)("comment_on_post", { post: `https://www.linkedin.com/feed/update/${ACTIVITY}/`, text: "Great work" });
  assert.equal(result.isError, undefined);
  assert.match(textOf(result), /ID: urn:li:comment:/);
  const [call] = fetch.calls;
  assert.equal(call.url, `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(ACTIVITY)}/comments`);
  assert.equal(call.method, "POST");
  assert.equal(call.headers["Linkedin-Version"], "202609");
  assert.equal(call.headers["X-Restli-Protocol-Version"], "2.0.0");
  assert.deepEqual(JSON.parse(call.body), { actor: ME, object: ACTIVITY, message: { text: "Great work" } });
});

test("comment_on_post falls back to /v2 socialActions once when /rest is refused with 403", async () => {
  const fetch = fakeFetch(
    { status: 403, json: { message: "Not enough permissions" } },
    { status: 201, body: "", headers: { "x-restli-id": "urn:li:comment:(urn:li:activity:1,2)" } }
  );
  const result = await linkedIn(fetch)("comment_on_post", { post: ACTIVITY, text: "Nice" });
  assert.equal(result.isError, undefined);
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[1].url, `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(ACTIVITY)}/comments`);
  assert.deepEqual(JSON.parse(fetch.calls[1].body), { actor: ME, object: ACTIVITY, message: { text: "Nice" } });
});

test("comment_on_post does not retry a 5xx, so a comment can never be posted twice", async () => {
  const fetch = fakeFetch({ status: 500, body: "boom" });
  const result = await linkedIn(fetch)("comment_on_post", { post: ACTIVITY, text: "Nice" });
  assert.equal(result.isError, true);
  assert.equal(fetch.calls.length, 1);
  assert.match(textOf(result), /LinkedIn API 500: boom/);
});

test("comment_on_post reports both answers when /rest and /v2 both refuse", async () => {
  const fetch = fakeFetch({ status: 403, body: "rest says no" }, { status: 403, body: "v2 says no" });
  const result = await linkedIn(fetch)("comment_on_post", { post: ACTIVITY, text: "Nice" });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /\/rest: LinkedIn API 403: rest says no\n\/v2: LinkedIn API 403: v2 says no/);
});

test("like_post creates a reaction for the member", async () => {
  const fetch = fakeFetch({ status: 201, body: "" });
  const result = await linkedIn(fetch)("like_post", { post: ACTIVITY });
  assert.match(textOf(result), /LIKE added/);
  assert.equal(fetch.calls[0].url, `https://api.linkedin.com/rest/reactions?actor=${encodeURIComponent(ME)}`);
  assert.equal(fetch.calls[0].headers["Linkedin-Version"], "202609");
  assert.deepEqual(JSON.parse(fetch.calls[0].body), { root: ACTIVITY, reactionType: "LIKE" });

  const praise = fakeFetch({ status: 201, body: "" });
  await linkedIn(praise)("like_post", { post: SHARE, reaction: "praise" });
  assert.deepEqual(JSON.parse(praise.calls[0].body), { root: SHARE, reactionType: "PRAISE" });
});

test("like_post falls back to a /v2 like, but only for a plain LIKE", async () => {
  const fetch = fakeFetch({ status: 403, body: "no" }, { status: 201, body: "" });
  const result = await linkedIn(fetch)("like_post", { post: ACTIVITY });
  assert.equal(result.isError, undefined);
  assert.equal(fetch.calls[1].url, `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(ACTIVITY)}/likes`);
  assert.deepEqual(JSON.parse(fetch.calls[1].body), { actor: ME, object: ACTIVITY });

  const celebrate = fakeFetch({ status: 403, body: "no" });
  const refused = await linkedIn(celebrate)("like_post", { post: ACTIVITY, reaction: "PRAISE" });
  assert.equal(refused.isError, true);
  assert.equal(celebrate.calls.length, 1);
});

test("like_post refuses an unknown reaction without calling LinkedIn", async () => {
  const fetch = fakeFetch();
  const result = await linkedIn(fetch)("like_post", { post: ACTIVITY, reaction: "MAYBE" });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /reaction must be one of/);
  assert.equal(fetch.calls.length, 0);
});

test("reshare_post creates a post whose reshareContext.parent is the original", async () => {
  const fetch = fakeFetch({ status: 201, body: "", headers: { "x-restli-id": "urn:li:share:1" } });
  const result = await linkedIn(fetch)("reshare_post", { post: SHARE, text: "Worth reading" });
  assert.match(textOf(result), /Reshared urn:li:share:7234567890123456790\nID: urn:li:share:1/);
  const [call] = fetch.calls;
  assert.equal(call.url, "https://api.linkedin.com/rest/posts");
  assert.equal(call.headers["Linkedin-Version"], "202609");
  assert.deepEqual(JSON.parse(call.body), {
    author: ME,
    commentary: "Worth reading",
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
    reshareContext: { parent: SHARE }
  });
});

test("delete_post deletes by share URN and refuses an activity URL up front", async () => {
  const fetch = fakeFetch({ status: 204 });
  const result = await linkedIn(fetch)("delete_post", { post: SHARE });
  assert.match(textOf(result), /Deleted urn:li:share:/);
  assert.equal(fetch.calls[0].url, `https://api.linkedin.com/rest/posts/${encodeURIComponent(SHARE)}`);
  assert.equal(fetch.calls[0].method, "DELETE");
  assert.equal(fetch.calls[0].headers["X-RestLi-Method"], "DELETE");

  const none = fakeFetch();
  const refused = await linkedIn(none)("delete_post", { post: `https://www.linkedin.com/feed/update/${ACTIVITY}/` });
  assert.equal(refused.isError, true);
  assert.equal(none.calls.length, 0);
});

test("post_with_media uploads a local image, then posts it as IMAGE", async () => {
  const asset = "urn:li:digitalmediaAsset:C5522AQ";
  const uploadUrl = "https://api.linkedin.com/mediaUpload/C5522AQ/feedshare-uploadedImage/0?ca=vector_feedshare";
  const fetch = fakeFetch(
    { json: { value: { uploadMechanism: { "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { headers: {}, uploadUrl } }, asset } } },
    { status: 201, body: "" },
    { status: 201, json: { id: SHARE } }
  );
  const reads = [];
  const read = async path => { reads.push(path); return Buffer.from("PNG-BYTES"); };
  const result = await linkedIn(fetch, { read })("post_with_media", { text: "Demo", file: "C:\\pics\\demo.PNG", title: "Demo" });
  assert.equal(result.isError, undefined, textOf(result));
  assert.match(textOf(result), /image post published/);
  assert.equal(reads[0], resolve("C:\\pics\\demo.PNG"));

  const [register, upload, post] = fetch.calls;
  assert.equal(register.url, "https://api.linkedin.com/v2/assets?action=registerUpload");
  assert.deepEqual(JSON.parse(register.body), {
    registerUploadRequest: {
      recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
      owner: ME,
      serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }]
    }
  });
  assert.equal(upload.url, uploadUrl);
  assert.equal(upload.method, "PUT");
  assert.equal(upload.headers.Authorization, "Bearer test-token");
  assert.equal(upload.headers["Content-Type"], "image/png");
  assert.equal(Buffer.from(upload.body).toString(), "PNG-BYTES");
  const content = JSON.parse(post.body).specificContent["com.linkedin.ugc.ShareContent"];
  assert.equal(content.shareMediaCategory, "IMAGE");
  assert.deepEqual(content.media, [{ status: "READY", media: asset, title: { text: "Demo" } }]);
});

test("post_with_media downloads a video URL and never sends the token to a non-LinkedIn host", async () => {
  const asset = "urn:li:digitalmediaAsset:V1";
  const uploadUrl = "https://uploads.example-cdn.com/v/1";
  const fetch = fakeFetch(
    { body: "MP4", headers: { "content-type": "video/mp4" } },
    { json: { value: { uploadMechanism: { "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": { headers: { "media-type-family": "VIDEO" }, uploadUrl } }, asset } } },
    { status: 201, body: "" },
    { status: 201, json: { id: SHARE } }
  );
  const result = await linkedIn(fetch)("post_with_media", { text: "Clip", file: "https://example.com/files/clip" });
  assert.equal(result.isError, undefined, textOf(result));
  const [download, register, upload, post] = fetch.calls;
  assert.equal(download.url, "https://example.com/files/clip");
  assert.equal(download.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(register.body).registerUploadRequest.recipes, ["urn:li:digitalmediaRecipe:feedshare-video"]);
  assert.equal(upload.headers.Authorization, undefined);
  assert.equal(upload.headers["media-type-family"], "VIDEO");
  assert.equal(upload.headers["Content-Type"], "video/mp4");
  assert.equal(JSON.parse(post.body).specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory, "VIDEO");
});

test("post_with_media stops before LinkedIn when the file is missing or of unknown type", async () => {
  const fetch = fakeFetch();
  const missing = await linkedIn(fetch, { read: async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } })(
    "post_with_media", { text: "x", file: "/nope/pic.png" });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /could not read .*ENOENT/);
  const unknown = await linkedIn(fetch, { read: async () => Buffer.from("?") })("post_with_media", { text: "x", file: "/tmp/file.bin" });
  assert.equal(unknown.isError, true);
  assert.match(textOf(unknown), /pass media_type/);
  assert.equal(fetch.calls.length, 0);
});

test("an expired token says how to renew it, and a missing token never calls LinkedIn", async () => {
  const fetch = fakeFetch({ status: 401, json: { serviceErrorCode: 65601, code: "REVOKED_ACCESS_TOKEN" } });
  const expired = await linkedIn(fetch)("get_my_profile", {});
  assert.equal(expired.isError, true);
  assert.match(textOf(expired), /401.*npm run auth/);

  const none = fakeFetch();
  const missing = await createLinkedIn({ token: undefined, personUrn: ME, fetch: none })("post_to_linkedin", { text: "x" });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /LINKEDIN_ACCESS_TOKEN is not set/);
  assert.equal(none.calls.length, 0);
});

test("LINKEDIN_API_VERSION overrides the version header", async () => {
  const fetch = fakeFetch({ status: 201, body: "" });
  await linkedIn(fetch, { apiVersion: "202701" })("like_post", { post: ACTIVITY });
  assert.equal(fetch.calls[0].headers["Linkedin-Version"], "202701");
});

test("an unknown tool is an error", async () => {
  const result = await linkedIn(fakeFetch())("follow_everyone", {});
  assert.equal(result.isError, true);
});

test("the stdio server lists every tool, reports the package version and flags errors", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const server = spawn(process.execPath, [fileURLToPath(new URL("../index.js", import.meta.url))], {
    env: { ...process.env, LINKEDIN_ACCESS_TOKEN: "test-token", LINKEDIN_PERSON_URN: ME },
    stdio: ["pipe", "pipe", "inherit"]
  });
  const waiting = new Map();
  let buffer = "";
  server.stdout.on("data", chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (line) { const msg = JSON.parse(line); waiting.get(msg.id)?.(msg); }
    }
  });
  const send = msg => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
  const rpc = (id, method, params) => new Promise(done => { waiting.set(id, done); send({ id, method, params }); });
  try {
    const init = await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    assert.equal(init.result.serverInfo.version, pkg.version);
    send({ method: "notifications/initialized" });
    const list = await rpc(2, "tools/list", {});
    assert.deepEqual(list.result.tools.map(t => t.name), TOOLS.map(t => t.name));
    // refused before any request leaves the machine
    const bad = await rpc(3, "tools/call", { name: "comment_on_post", arguments: { post: "not a post", text: "hi" } });
    assert.equal(bad.result.isError, true);
  } finally {
    server.kill();
  }
});
