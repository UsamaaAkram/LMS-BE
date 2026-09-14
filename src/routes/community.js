const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const jwtAuth = require("../middleware/jwtAuth");
const router = express.Router();

// Every route in this file requires a signed-in user. These endpoints were
// completely open: anyone on the internet could read and write them without
// a token. jwtAuth accepts student, instructor and admin tokens alike, and
// for students also enforces the active-session check behind Logout.
router.use(jwtAuth);

const upload = multer();

const CommunityPost = require("../models/CommunityPost");
const { notify } = require("../utils/notify");
const { resolveMentions } = require("../utils/resolveMentions");
const { COMMUNITY_ROOM } = require("../sockets/chatSocket");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({
  region: "ap-southeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = "bluverse-lms";

async function uploadToS3(file) {
  const key = `community/${Date.now()}-${file.originalname}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return {
    url: `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${key}`,
    originalname: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
  };
}

// Staff can moderate anyone's content; everyone else only their own (#2.18).
const isModerator = (role) =>
  ["admin", "superadmin", "super-admin", "instructor", "teacher"].includes(
    String(role || "").toLowerCase()
  );

// @mentions are parsed server-side so the stored list can't be spoofed by a
// client sending a mentions array that doesn't match the text.
function parseMentions(content) {
  return [
    ...new Set(
      (String(content || "").match(/@([A-Za-z0-9._-]{2,40})/g) || []).map((m) =>
        m.slice(1)
      )
    ),
  ];
}

const badId = (id) => !mongoose.Types.ObjectId.isValid(id);

// #2.21 — push feed changes to everyone with the Community tab open. Wrapped
// because a socket failure must never fail the request that caused it.
function broadcast(req, event, payload) {
  try {
    req.app.get("io")?.to(COMMUNITY_ROOM).emit(event, payload);
  } catch (err) {
    console.error("community broadcast failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// GET /api/community — the feed (#2.5), with category filter and search (#2.10)
// ---------------------------------------------------------------------------
router.get("/", async (req, res) => {
  try {
    const { category, search, limit = 20, before } = req.query;
    const q = { isDeleted: false };
    if (category && category !== "All") q.category = category;
    if (search) {
      const rx = { $regex: String(search).trim(), $options: "i" };
      q.$or = [{ content: rx }, { authorName: rx }];
    }
    // Cursor paging (#2.17 infinite scroll). Pinned posts are always returned
    // on the first page so they can't fall off the bottom of the feed.
    if (before) {
      const d = new Date(before);
      if (!isNaN(d.valueOf())) {
        q.createdAt = { $lt: d };
        q.isPinned = false;
      }
    }
    const capped = Math.min(Number(limit) || 20, 50);
    const posts = await CommunityPost.find(q)
      .sort({ isPinned: -1, createdAt: -1 })
      .limit(capped);
    res.json(posts);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/categories", (_req, res) =>
  res.json(CommunityPost.CATEGORIES)
);

// POST /api/community — create a post
router.post("/", upload.array("attachments", 5), async (req, res) => {
  try {
    const { author, authorName, authorRole, authorPhoto, category, content } =
      req.body || {};
    if (!author || !content || !String(content).trim()) {
      return res
        .status(400)
        .json({ error: "An author and some content are required." });
    }
    if (category && !CommunityPost.CATEGORIES.includes(category)) {
      return res.status(400).json({ error: "Unknown category." });
    }

    const attachments = [];
    for (const f of req.files || []) attachments.push(await uploadToS3(f));

    const post = await CommunityPost.create({
      author,
      authorName: authorName || "",
      authorRole: authorRole || "",
      authorPhoto: authorPhoto || "",
      category: category || "General Discussion",
      content: String(content).trim(),
      attachments,
      mentions: parseMentions(content),
    });
    broadcast(req, "communityPostCreated", post);

    // #2.9 — tell anyone who was @mentioned (never the author themselves).
    const mentionIds = (await resolveMentions(post.mentions)).filter(
      (id) => id !== String(author)
    );
    await notify(
      mentionIds,
      {
        type: "community_mention",
        title: `${authorName || "Someone"} mentioned you`,
        body: String(content).trim().slice(0, 140),
        link: "/messages",
        actorName: authorName || "",
      },
      req.app.get("io")
    );

    res.status(201).json(post);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/community/:id — edit own post (or any, as a moderator)
router.patch("/:id", async (req, res) => {
  try {
    if (badId(req.params.id))
      return res.status(400).json({ error: "Invalid post id." });
    const { content, category, actor } = req.body || {};
    const post = await CommunityPost.findById(req.params.id);
    if (!post || post.isDeleted)
      return res.status(404).json({ error: "Post not found" });

    const own = String(post.author) === String(actor?.id);
    if (!own && !isModerator(actor?.role)) {
      return res.status(403).json({ error: "You can only edit your own posts." });
    }
    if (content !== undefined) {
      if (!String(content).trim())
        return res.status(400).json({ error: "Content can't be empty." });
      post.content = String(content).trim();
      post.mentions = parseMentions(content);
      post.editedAt = new Date();
    }
    if (category !== undefined) {
      if (!CommunityPost.CATEGORIES.includes(category))
        return res.status(400).json({ error: "Unknown category." });
      post.category = category;
    }
    await post.save();
    broadcast(req, "communityPostUpdated", post);
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/community/:id — soft delete so the thread history survives
router.delete("/:id", async (req, res) => {
  try {
    if (badId(req.params.id))
      return res.status(400).json({ error: "Invalid post id." });
    // DELETE bodies are awkward for some clients, so the actor may arrive as a
    // query param instead.
    const actor = req.body?.actor || {
      id: req.query.actorId,
      role: req.query.actorRole,
    };
    const post = await CommunityPost.findById(req.params.id);
    if (!post || post.isDeleted)
      return res.status(404).json({ error: "Post not found" });

    const own = String(post.author) === String(actor?.id);
    if (!own && !isModerator(actor?.role)) {
      return res
        .status(403)
        .json({ error: "You can only delete your own posts." });
    }
    post.isDeleted = true;
    post.deletedAt = new Date();
    await post.save();
    broadcast(req, "communityPostDeleted", { _id: post._id });
    res.json({ message: "Post deleted", _id: post._id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/community/:id/react — add / switch / remove a reaction (#2.6)
router.post("/:id/react", async (req, res) => {
  try {
    if (badId(req.params.id))
      return res.status(400).json({ error: "Invalid post id." });
    const { user, type } = req.body || {};
    const allowed = ["like", "love", "celebrate", "applause", "helpful"];
    if (!user) return res.status(400).json({ error: "A user is required." });
    if (!allowed.includes(type))
      return res.status(400).json({ error: "Unknown reaction." });

    const post = await CommunityPost.findById(req.params.id);
    if (!post || post.isDeleted)
      return res.status(404).json({ error: "Post not found" });

    // One reaction per person: same type toggles off, a different type replaces.
    const existing = post.reactions.find(
      (r) => String(r.user) === String(user)
    );
    if (existing && existing.type === type) {
      post.reactions = post.reactions.filter(
        (r) => String(r.user) !== String(user)
      );
    } else if (existing) {
      existing.type = type;
      existing.at = new Date();
    } else {
      post.reactions.push({ user, type });
    }
    await post.save();
    broadcast(req, "communityPostUpdated", post);
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/community/:id/comments — threaded replies (#2.5)
router.post("/:id/comments", async (req, res) => {
  try {
    if (badId(req.params.id))
      return res.status(400).json({ error: "Invalid post id." });
    const { author, authorName, authorRole, authorPhoto, content } =
      req.body || {};
    if (!author || !content || !String(content).trim()) {
      return res
        .status(400)
        .json({ error: "An author and some content are required." });
    }
    const post = await CommunityPost.findById(req.params.id);
    if (!post || post.isDeleted)
      return res.status(404).json({ error: "Post not found" });
    if (post.isLocked) {
      return res
        .status(400)
        .json({ error: "This discussion is locked and no longer accepts replies." });
    }

    // $push so two people replying at once can't overwrite each other.
    const comment = {
      author,
      authorName: authorName || "",
      authorRole: authorRole || "",
      authorPhoto: authorPhoto || "",
      content: String(content).trim(),
      mentions: parseMentions(content),
    };
    const updated = await CommunityPost.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: comment } },
      { new: true }
    );

    // #2.16 — notify the post author, plus everyone else already in the thread,
    // but never the person who just replied.
    const thread = (updated.comments || [])
      .filter((c) => !c.isDeleted)
      .map((c) => String(c.author));
    const audience = [String(updated.author), ...thread].filter(
      (id) => id && id !== String(author)
    );
    // #2.9 — a mention inside a reply notifies too, and takes precedence over
    // the generic "replied" notice so nobody gets both for one comment.
    const mentionIds = (await resolveMentions(parseMentions(content))).filter(
      (id) => id !== String(author)
    );
    await notify(
      mentionIds,
      {
        type: "community_mention",
        title: `${authorName || "Someone"} mentioned you`,
        body: String(content).trim().slice(0, 140),
        link: "/messages",
        actorName: authorName || "",
      },
      req.app.get("io")
    );

    await notify(
      audience.filter((id) => !mentionIds.includes(id)),
      {
        type: "community_reply",
        title: `${authorName || "Someone"} replied in ${updated.category}`,
        body: String(content).trim().slice(0, 140),
        link: "/messages",
        actorName: authorName || "",
      },
      req.app.get("io")
    );

    broadcast(req, "communityPostUpdated", updated);
    res.status(201).json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE a single comment
router.delete("/:id/comments/:commentId", async (req, res) => {
  try {
    const actor = req.body?.actor || {
      id: req.query.actorId,
      role: req.query.actorRole,
    };
    const post = await CommunityPost.findById(req.params.id);
    if (!post || post.isDeleted)
      return res.status(404).json({ error: "Post not found" });
    const comment = post.comments.id(req.params.commentId);
    if (!comment || comment.isDeleted)
      return res.status(404).json({ error: "Comment not found" });

    const own = String(comment.author) === String(actor?.id);
    if (!own && !isModerator(actor?.role)) {
      return res
        .status(403)
        .json({ error: "You can only delete your own comments." });
    }
    comment.isDeleted = true;
    await post.save();
    broadcast(req, "communityPostUpdated", post);
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/community/:id/pin — moderators only (#2.7)
router.post("/:id/pin", async (req, res) => {
  try {
    const { pinned, actor } = req.body || {};
    if (!isModerator(actor?.role)) {
      return res
        .status(403)
        .json({ error: "Only staff can pin posts." });
    }
    const post = await CommunityPost.findById(req.params.id);
    if (!post || post.isDeleted)
      return res.status(404).json({ error: "Post not found" });
    post.isPinned = !!pinned;
    post.pinnedAt = pinned ? new Date() : null;
    await post.save();
    broadcast(req, "communityPostUpdated", post);
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/community/:id/lock — moderators only (#2.18)
router.post("/:id/lock", async (req, res) => {
  try {
    const { locked, actor } = req.body || {};
    if (!isModerator(actor?.role)) {
      return res.status(403).json({ error: "Only staff can lock discussions." });
    }
    const post = await CommunityPost.findById(req.params.id);
    if (!post || post.isDeleted)
      return res.status(404).json({ error: "Post not found" });
    post.isLocked = !!locked;
    await post.save();
    broadcast(req, "communityPostUpdated", post);
    res.json(post);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
