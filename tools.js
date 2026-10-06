// The LinkedIn API calls behind each MCP tool. index.js serves them over stdio; the tests call them with a fake fetch.
import { readFile } from "fs/promises";
import { extname, resolve } from "path";

const API = "https://api.linkedin.com";
const REACTIONS = ["LIKE", "PRAISE", "EMPATHY", "INTEREST", "APPRECIATION", "ENTERTAINMENT"];
const DOC_MIME = {
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};
const MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".mp4": "video/mp4", ".mov": "video/quicktime",
  ...DOC_MIME
};
// the Images API (and so a multi-image post) takes JPG, PNG and GIF; documents go up to 100 MB
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];
const MAX_DOC_BYTES = 100 * 1024 * 1024;
const POLL_DURATIONS = ["ONE_DAY", "THREE_DAYS", "SEVEN_DAYS", "FOURTEEN_DAYS"];
const POST_ARG = {
  type: "string",
  description: "The post's URL (linkedin.com/feed/update/... or linkedin.com/posts/...) or its URN (urn:li:activity:..., urn:li:share:..., urn:li:ugcPost:...)"
};
const REST_TEXT = "#hashtags work, and @[Name](urn:li:organization:ID) mentions a company";

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
    name: "post_document",
    description: "Publish a LinkedIn document post: a PDF, PowerPoint or Word file that readers swipe through like a carousel. From a file on this computer or an http(s) URL; max 100 MB and 300 pages",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: `The post text. ${REST_TEXT}` },
        file: { type: "string", description: "Absolute path of the .pdf, .ppt, .pptx, .doc or .docx on this computer, or its http(s) URL" },
        title: { type: "string", description: "Title shown on the document (defaults to the file name)" }
      },
      required: ["text", "file"]
    }
  },
  {
    name: "post_multi_image",
    description: "Publish a LinkedIn post with 2 to 20 images (JPG, PNG or GIF), each from a file on this computer or an http(s) URL",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: `The post text. ${REST_TEXT}` },
        files: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 20, description: "2 to 20 image paths or http(s) URLs, in the order they should appear" },
        alt_texts: { type: "array", items: { type: "string" }, description: "Optional alt text for each image, in the same order (read out by screen readers)" }
      },
      required: ["text", "files"]
    }
  },
  {
    name: "post_poll",
    description: "Publish a LinkedIn poll: a question with 2 to 4 answers that stays open for 1, 3, 7 or 14 days. LinkedIn forbids polls on political opinions, health or other sensitive data, and the answers cannot be edited after posting",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: `The post text above the poll. ${REST_TEXT}` },
        question: { type: "string", description: "The poll question (max 140 characters)" },
        options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4, description: "2 to 4 different answers, each max 30 characters" },
        duration: { type: "string", enum: POLL_DURATIONS, description: "How long voting stays open (default SEVEN_DAYS)" }
      },
      required: ["text", "question", "options"]
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
        text: { type: "string", description: `Optional text of your own above the reshared post. ${REST_TEXT}` }
      },
      required: ["post"]
    }
  },
  {
    name: "edit_post",
    description: "Change the text of one of your own LinkedIn posts, by the ID the post tools printed (urn:li:share:... or urn:li:ugcPost:...). Only the text changes: images, documents and poll answers stay as they are",
    inputSchema: {
      type: "object",
      properties: {
        post: POST_ARG,
        text: { type: "string", description: `The new full post text. ${REST_TEXT}` }
      },
      required: ["post", "text"]
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

// Posts API commentary is LinkedIn's "little" text: its reserved characters must be backslash-escaped,
// or LinkedIn reads them as markup and can drop the rest of the text. #hashtags and
// @[Name](urn:li:person|organization:ID) mentions stay live.
const LITTLE_RESERVED = /[|{}@[\]()<>#\\*_~]/g;
const escapeLittle = s => s.replace(LITTLE_RESERVED, "\\$&");
export function littleText(input) {
  const text = String(input ?? "");
  const live = /@\[([^\]\n]{1,100})\]\((urn:li:(?:person|organization):[A-Za-z0-9_-]+)\)|#[\p{L}\p{N}]+/gu;
  let out = "";
  let last = 0;
  for (const m of text.matchAll(live)) {
    out += escapeLittle(text.slice(last, m.index));
    out += m[1] !== undefined ? `@[${escapeLittle(m[1])}](${m[2]})` : m[0];
    last = m.index + m[0].length;
  }
  return out + escapeLittle(text.slice(last));
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

  async function loadFile(source) {
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
    const pathname = isUrl ? new URL(source).pathname : source;
    const ext = extname(pathname).toLowerCase();
    return { bytes, ext, name: pathname.split(/[\\/]/).pop(), contentType: MIME[ext] || served || "application/octet-stream" };
  }

  async function loadMedia(source, mediaType) {
    const file = await loadFile(source);
    const kind = mediaType || (file.contentType.startsWith("video/") ? "video" : file.contentType.startsWith("image/") ? "image" : null);
    if (kind !== "image" && kind !== "video") throw new Error(`cannot tell whether ${source} is an image or a video: pass media_type`);
    return { ...file, kind };
  }

  async function putBytes(uploadUrl, file, headers = {}) {
    const up = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        ...(isLinkedInHost(uploadUrl) ? { "Authorization": `Bearer ${token}` } : {}),
        "Content-Type": file.contentType,
        ...headers
      },
      body: file.bytes
    });
    if (!up.ok) throw new Error(`LinkedIn media upload ${up.status}: ${(await up.text()).substring(0, 300)}`);
  }

  // Images and Documents APIs: declare the upload, PUT the bytes, and get back the urn:li:image / urn:li:document.
  async function initUpload(api, file) {
    const init = await li(`/rest/${api}?action=initializeUpload`, {
      method: "POST",
      body: JSON.stringify({ initializeUploadRequest: { owner: await getPersonUrn() } })
    });
    const urn = init.value?.image || init.value?.document;
    if (!init.value?.uploadUrl || !urn) throw new Error(`LinkedIn gave no upload URL: ${JSON.stringify(init).substring(0, 300)}`);
    await putBytes(init.value.uploadUrl, file);
    return urn;
  }

  // A post through the versioned Posts API; `extra` carries the content or the reshare context.
  async function restPost(text, extra = {}) {
    return li("/rest/posts", {
      method: "POST",
      body: JSON.stringify({
        author: await getPersonUrn(),
        commentary: littleText(text),
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...extra
      })
    });
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
    await putBytes(mechanism.uploadUrl, media, mechanism.headers || {});
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

      if (name === "post_document") {
        const file = await loadFile(String(args.file ?? ""));
        if (!DOC_MIME[file.ext] && !Object.values(DOC_MIME).includes(file.contentType)) {
          throw new Error(`a document post takes a .pdf, .ppt, .pptx, .doc or .docx file, not "${file.name}"`);
        }
        if (file.bytes.length > MAX_DOC_BYTES) {
          throw new Error(`${file.name} is ${(file.bytes.length / 1048576).toFixed(1)} MB; LinkedIn takes documents up to 100 MB`);
        }
        const doc = await initUpload("documents", file);
        const result = await restPost(args.text, { content: { media: { title: args.title || file.name, id: doc } } });
        return ok(`✅ LinkedIn document post published!\nID: ${result.id}`);
      }

      if (name === "post_multi_image") {
        const files = Array.isArray(args.files) ? args.files : [];
        if (files.length < 2 || files.length > 20) throw new Error(`a multi-image post takes 2 to 20 images, not ${files.length}`);
        // every file is read and checked before the first upload, so a bad one leaves nothing half-sent
        const loaded = [];
        for (const source of files) {
          const file = await loadFile(String(source ?? ""));
          if (!IMAGE_TYPES.includes(file.contentType)) throw new Error(`${file.name} is not a JPG, PNG or GIF image`);
          loaded.push(file);
        }
        const alts = Array.isArray(args.alt_texts) ? args.alt_texts : [];
        const images = [];
        for (const [i, file] of loaded.entries()) {
          const id = await initUpload("images", file);
          images.push({ id, ...(alts[i] ? { altText: String(alts[i]) } : {}) });
        }
        const result = await restPost(args.text, { content: { multiImage: { images } } });
        return ok(`✅ LinkedIn post with ${images.length} images published!\nID: ${result.id}`);
      }

      if (name === "post_poll") {
        const question = String(args.question ?? "").trim();
        const options = (Array.isArray(args.options) ? args.options : []).map(o => String(o ?? "").trim());
        const duration = String(args.duration || "SEVEN_DAYS").toUpperCase();
        if (!question || question.length > 140) throw new Error("the poll question must be 1 to 140 characters");
        if (options.length < 2 || options.length > 4) throw new Error(`a poll takes 2 to 4 answers, not ${options.length}`);
        const bad = options.find(o => !o || o.length > 30);
        if (bad !== undefined) throw new Error(`each poll answer must be 1 to 30 characters: "${bad}"`);
        if (new Set(options.map(o => o.toLowerCase())).size !== options.length) throw new Error("the poll answers must all be different");
        if (!POLL_DURATIONS.includes(duration)) throw new Error(`duration must be one of ${POLL_DURATIONS.join(", ")}`);
        const result = await restPost(args.text, {
          content: { poll: { question, options: options.map(text => ({ text })), settings: { duration } } }
        });
        return ok(`✅ LinkedIn poll published (open ${duration.replace("_", " ").toLowerCase()})!\nID: ${result.id}`);
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
        const result = await restPost(args.text, { reshareContext: { parent } });
        return ok(`✅ Reshared ${parent}\nID: ${result.id}`);
      }

      if (name === "edit_post") {
        const target = postUrn(args.post);
        if (target.startsWith("urn:li:activity:")) {
          throw new Error("edit needs the post's urn:li:share:... or urn:li:ugcPost:... ID (the one printed when it was posted), not an activity URL");
        }
        await li(`/rest/posts/${encodeURIComponent(target)}`, {
          method: "POST",
          headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
          body: JSON.stringify({ patch: { $set: { commentary: littleText(args.text) } } })
        });
        return ok(`✏️ Updated the text of ${target}`);
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
