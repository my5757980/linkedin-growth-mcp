// The LinkedIn API calls behind each MCP tool. index.js serves them over stdio; the tests call them with a fake fetch.
import { readFile } from "fs/promises";
import { extname, resolve } from "path";

const API = "https://api.linkedin.com";
const REACTIONS = ["LIKE", "PRAISE", "EMPATHY", "INTEREST", "APPRECIATION", "ENTERTAINMENT"];
const MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".mp4": "video/mp4", ".mov": "video/quicktime"
};
const POST_ARG = {
  type: "string",
  description: "The post's URL (linkedin.com/feed/update/... or linkedin.com/posts/...) or its URN (urn:li:activity:..., urn:li:share:..., urn:li:ugcPost:...)"
};

export const TOOLS = [
  {
    name: "post_to_linkedin",
    description: "Publish a text post on your LinkedIn profile",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The full post text (max 3000 characters)" }
      },
      required: ["text"]
    }
  },
  {
    name: "post_with_link",
    description: "Publish a LinkedIn post with a link preview card (GitHub repo, demo, article)",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The post text" },
        url: { type: "string", description: "The link to share" },
        title: { type: "string", description: "Optional title for the link card" }
      },
      required: ["text", "url"]
    }
  },
  {
    name: "post_with_media",
    description: "Publish a LinkedIn post with one image or video, taken from a file on this computer or from an http(s) URL",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The post text" },
        file: { type: "string", description: "Absolute path of the image or video on this computer, or its http(s) URL" },
        media_type: { type: "string", enum: ["image", "video"], description: "Optional. Worked out from the extension (.jpg .jpeg .png .gif / .mp4 .mov) when left out" },
        title: { type: "string", description: "Optional title shown with the media" },
        description: { type: "string", description: "Optional description of the media" }
      },
      required: ["text", "file"]
    }
  },
  {
    name: "comment_on_post",
    description: "Comment on a LinkedIn post as yourself",
    inputSchema: {
      type: "object",
      properties: {
        post: POST_ARG,
        text: { type: "string", description: "The comment text" }
      },
      required: ["post", "text"]
    }
  },
  {
    name: "like_post",
    description: "Like a LinkedIn post, or give it another reaction (Celebrate, Love, Insightful, Support, Funny)",
    inputSchema: {
      type: "object",
      properties: {
        post: POST_ARG,
        reaction: {
          type: "string",
          enum: REACTIONS,
          description: "LIKE (default), PRAISE = Celebrate, EMPATHY = Love, INTEREST = Insightful, APPRECIATION = Support, ENTERTAINMENT = Funny"
        }
      },
      required: ["post"]
    }
  },
  {
    name: "reshare_post",
    description: "Repost a LinkedIn post to your feed, optionally with your own text above it. LinkedIn expects the post's urn:li:share:... or urn:li:ugcPost:... (the code from the post's '...' menu > 'Embed this post' contains it); an activity URL may be refused",
    inputSchema: {
      type: "object",
      properties: {
        post: POST_ARG,
        text: { type: "string", description: "Optional text of your own above the reshared post" }
      },
      required: ["post"]
    }
  },
  {
    name: "delete_post",
    description: "Delete one of your own LinkedIn posts, by the ID the post tools printed (urn:li:share:... or urn:li:ugcPost:...)",
    inputSchema: {
      type: "object",
      properties: { post: POST_ARG },
      required: ["post"]
    }
  },
  {
    name: "get_my_profile",
    description: "Show your LinkedIn profile basics (name, email, person URN)",
    inputSchema: { type: "object", properties: {} }
  }
];

// The URN inside a post URL, an embed code or a URN typed by hand.
// linkedin.com/posts/ URLs carry the ID as "...-activity-7234567890123456789-AbCd".
export function postUrn(input) {
  let s = String(input ?? "").trim();
  try { s = decodeURIComponent(s); } catch { /* not percent-encoded */ }
  const m = s.match(/urn:li:(activity|share|ugcPost):(\d+)/) || s.match(/(activity|share|ugcPost)-(\d{15,})/);
  if (!m) throw new Error(`"${input}" is not a LinkedIn post URL or URN (urn:li:activity:..., urn:li:share:... or urn:li:ugcPost:...)`);
  return `urn:li:${m[1]}:${m[2]}`;
}

// The bearer token may only ever go to LinkedIn itself.
function isLinkedInHost(url) {
  const { protocol, hostname } = new URL(url);
  return protocol === "https:" && (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com"));
}

const ok = text => ({ content: [{ type: "text", text }] });

export function createLinkedIn({ token, personUrn = null, apiVersion = "202609", fetch = globalThis.fetch, read = readFile } = {}) {
  async function li(path, { headers, ...options } = {}) {
    if (!token) throw new Error("LINKEDIN_ACCESS_TOKEN is not set. Run `npm run auth` in the repo and put the token in your MCP config");
    const res = await fetch(API + path, {
      ...options,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        // the versioned /rest APIs refuse a call without a version
        ...(path.startsWith("/rest/") ? { "Linkedin-Version": apiVersion } : {}),
        ...(headers || {})
      }
    });
    const text = await res.text();
    if (!res.ok) {
      const hint = res.status === 401 ? " (the access token has expired or is invalid: run `npm run auth` for a new one)" : "";
      const err = new Error(`LinkedIn API ${res.status}: ${text.substring(0, 300)}${hint}`);
      err.status = res.status;
      throw err;
    }
    const data = text ? JSON.parse(text) : {};
    // a create answers 201 with the new entity's URN in the x-restli-id header, not always in the body
    const restliId = res.headers.get("x-restli-id");
    if (restliId && data.id === undefined) data.id = restliId;
    return data;
  }

  // Comments and reactions are documented on the versioned /rest API. If that refuses the call outright
  // (no permission, not found, version not active), the older /v2 socialActions API gets one try.
  // Anything else, a 5xx included, is not retried, so a comment is never posted twice.
  async function restThenV2(rest, v2) {
    try {
      return await rest();
    } catch (err) {
      if (!v2 || ![403, 404, 426].includes(err.status)) throw err;
      try {
        return await v2();
      } catch (err2) {
        throw new Error(`/rest: ${err.message}\n/v2: ${err2.message}`);
      }
    }
  }

  let urn = personUrn;
  async function getPersonUrn() {
    if (urn) return urn;
    const me = await li("/v2/userinfo");
    urn = `urn:li:person:${me.sub}`;
    return urn;
  }

  async function loadMedia(source, mediaType) {
    const isUrl = /^https?:\/\//i.test(source);
    let bytes, served;
    if (isUrl) {
      const res = await fetch(source);
      if (!res.ok) throw new Error(`could not download ${source}: HTTP ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer());
      served = res.headers.get("content-type")?.split(";")[0].trim();
    } else {
      const path = resolve(source);
      try {
        bytes = await read(path);
      } catch (err) {
        throw new Error(`could not read ${path}: ${err.code || err.message}`);
      }
    }
    const ext = extname(isUrl ? new URL(source).pathname : source).toLowerCase();
    const contentType = MIME[ext] || served || "application/octet-stream";
    const kind = mediaType || (contentType.startsWith("video/") ? "video" : contentType.startsWith("image/") ? "image" : null);
    if (kind !== "image" && kind !== "video") throw new Error(`cannot tell whether ${source} is an image or a video: pass media_type`);
    return { bytes, contentType, kind };
  }

  // Share on LinkedIn: register the upload, send the bytes, and get back the asset URN a post can carry.
  async function uploadMedia(media) {
    const owner = await getPersonUrn();
    const reg = await li("/v2/assets?action=registerUpload", {
      method: "POST",
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: [`urn:li:digitalmediaRecipe:feedshare-${media.kind}`],
          owner,
          serviceRelationships: [{ relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" }]
        }
      })
    });
    const mechanism = reg.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"];
    if (!mechanism?.uploadUrl || !reg.value?.asset) {
      throw new Error(`LinkedIn gave no upload URL: ${JSON.stringify(reg).substring(0, 300)}`);
    }
    const up = await fetch(mechanism.uploadUrl, {
      method: "PUT",
      headers: {
        ...(isLinkedInHost(mechanism.uploadUrl) ? { "Authorization": `Bearer ${token}` } : {}),
        "Content-Type": media.contentType,
        ...(mechanism.headers || {})
      },
      body: media.bytes
    });
    if (!up.ok) throw new Error(`LinkedIn media upload ${up.status}: ${(await up.text()).substring(0, 300)}`);
    return reg.value.asset;
  }

  function ugcPost(author, text, category, media) {
    return li("/v2/ugcPosts", {
      method: "POST",
      body: JSON.stringify({
        author,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text },
            shareMediaCategory: category,
            ...(media ? { media } : {})
          }
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" }
      })
    });
  }

  return async function callTool(name, args = {}) {
    try {
      if (name === "get_my_profile") {
        const me = await li("/v2/userinfo");
        return ok(`👤 ${me.name}\n📧 ${me.email || "no email scope"}\n🌍 ${me.locale?.country || ""}\nURN: urn:li:person:${me.sub}`);
      }

      if (name === "post_to_linkedin") {
        const result = await ugcPost(await getPersonUrn(), args.text, "NONE");
        return ok(`✅ LinkedIn post published!\nID: ${result.id}`);
      }

      if (name === "post_with_link") {
        const result = await ugcPost(await getPersonUrn(), args.text, "ARTICLE", [{
          status: "READY",
          originalUrl: args.url,
          ...(args.title ? { title: { text: args.title } } : {})
        }]);
        return ok(`✅ LinkedIn post with link published!\nID: ${result.id}\nLink: ${args.url}`);
      }

      if (name === "post_with_media") {
        const media = await loadMedia(String(args.file ?? ""), args.media_type);
        const asset = await uploadMedia(media);
        const result = await ugcPost(await getPersonUrn(), args.text, media.kind === "video" ? "VIDEO" : "IMAGE", [{
          status: "READY",
          media: asset,
          ...(args.title ? { title: { text: args.title } } : {}),
          ...(args.description ? { description: { text: args.description } } : {})
        }]);
        return ok(`✅ LinkedIn ${media.kind} post published!\nID: ${result.id}`);
      }

      if (name === "comment_on_post") {
        const target = postUrn(args.post);
        const actor = await getPersonUrn();
        const body = JSON.stringify({ actor, object: target, message: { text: args.text } });
        const path = `/socialActions/${encodeURIComponent(target)}/comments`;
        const result = await restThenV2(
          () => li(`/rest${path}`, { method: "POST", body }),
          () => li(`/v2${path}`, { method: "POST", body })
        );
        const id = result.commentUrn || result.id;
        return ok(`✅ Comment posted on ${target}${id ? `\nID: ${id}` : ""}`);
      }

      if (name === "like_post") {
        const target = postUrn(args.post);
        const reaction = String(args.reaction || "LIKE").toUpperCase();
        if (!REACTIONS.includes(reaction)) throw new Error(`reaction must be one of ${REACTIONS.join(", ")}`);
        const actor = await getPersonUrn();
        await restThenV2(
          () => li(`/rest/reactions?actor=${encodeURIComponent(actor)}`, {
            method: "POST",
            body: JSON.stringify({ root: target, reactionType: reaction })
          }),
          // the old API only knows plain likes
          reaction === "LIKE"
            ? () => li(`/v2/socialActions/${encodeURIComponent(target)}/likes`, {
                method: "POST",
                body: JSON.stringify({ actor, object: target })
              })
            : null
        );
        return ok(`✅ ${reaction} added to ${target}`);
      }

      if (name === "reshare_post") {
        const parent = postUrn(args.post);
        const result = await li("/rest/posts", {
          method: "POST",
          body: JSON.stringify({
            author: await getPersonUrn(),
            commentary: args.text || "",
            visibility: "PUBLIC",
            distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
            lifecycleState: "PUBLISHED",
            isReshareDisabledByAuthor: false,
            reshareContext: { parent }
          })
        });
        return ok(`✅ Reshared ${parent}\nID: ${result.id}`);
      }

      if (name === "delete_post") {
        const target = postUrn(args.post);
        if (target.startsWith("urn:li:activity:")) {
          throw new Error("delete needs the post's urn:li:share:... or urn:li:ugcPost:... ID (the one printed when it was posted), not an activity URL");
        }
        await li(`/rest/posts/${encodeURIComponent(target)}`, { method: "DELETE", headers: { "X-RestLi-Method": "DELETE" } });
        return ok(`🗑️ Deleted ${target}`);
      }

      return { content: [{ type: "text", text: `❌ Unknown tool: ${name}` }], isError: true };
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error: ${err.message}` }], isError: true };
    }
  };
}
