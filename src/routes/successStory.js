const express = require("express");
const router = express.Router();

const jwtAuth = require("../middleware/jwtAuth");
const requireRole = require("../middleware/requireRole");
// Staff = anyone who may administer the catalogue and the queues.
const staffOnly = [jwtAuth, requireRole("admin", "instructor")];
const optionalAuth = require("../middleware/optionalAuth");

const multer = require("multer");
const SuccessStory = require("../models/SuccessStory");
const upload = multer();

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const s3Client = new S3Client({
  region: "ap-southeast-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = "bluverse-lms";

async function uploadThumbnailToS3(file) {
  const key = `success-story-thumbnails/${Date.now()}-${file.originalname}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return `https://${BUCKET}.s3.ap-southeast-2.amazonaws.com/${key}`;
}

// Auto-detect platform from the video URL (#30 — "auto-detected video
// platform badges" instead of a manual picker).
function detectPlatform(url = "") {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("facebook.com") || u.includes("fb.watch")) return "facebook";
  return "other";
}

// CREATE
// Staff only.
router.post("/", staffOnly, upload.single("thumbnail"), async (req, res) => {
  try {
    const { studentName, title, story, videoUrl, featured, status } = req.body;
    if (!studentName || !title || !story) {
      return res
        .status(400)
        .json({ error: "studentName, title, and story are required." });
    }
    let thumbnailUrl = "";
    if (req.file) {
      thumbnailUrl = await uploadThumbnailToS3(req.file);
    }
    const successStory = new SuccessStory({
      studentName,
      title,
      story,
      videoUrl: videoUrl || "",
      platform: detectPlatform(videoUrl),
      thumbnailUrl,
      featured: featured === true || featured === "true",
      status: status || "draft",
    });
    await successStory.save();
    res.status(201).json(successStory);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET ALL — public callers only ever see published stories; the admin
// management page passes includeDrafts=true to see everything.
router.get("/", optionalAuth, async (req, res) => {
  try {
    const query = {};
    // includeDrafts is a staff view. The route itself is public (the shop and
    // the stories page need it logged out), so the flag is honoured only for a
    // verified staff token — otherwise anyone could append it and read
    // unpublished stories.
    const viewerIsStaff =
      !!req.user && ["admin", "instructor"].includes(String(req.user.role));
    if (!(viewerIsStaff && req.query.includeDrafts === "true")) {
      query.status = "published";
    }
    if (req.query.platform) query.platform = req.query.platform;
    if (req.query.search) {
      query.$or = [
        { title: { $regex: req.query.search, $options: "i" } },
        { studentName: { $regex: req.query.search, $options: "i" } },
        { story: { $regex: req.query.search, $options: "i" } },
      ];
    }
    const stories = await SuccessStory.find(query).sort({
      featured: -1,
      createdAt: -1,
    });
    res.json(stories);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET BY ID
router.get("/:id", async (req, res) => {
  try {
    const story = await SuccessStory.findById(req.params.id);
    if (!story) return res.status(404).json({ error: "Story not found" });
    res.json(story);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE
// Staff only.
router.put("/:id", staffOnly, upload.single("thumbnail"), async (req, res) => {
  try {
    const { studentName, title, story, videoUrl, featured, status } = req.body;
    const update = {
      studentName,
      title,
      story,
      videoUrl: videoUrl || "",
      platform: detectPlatform(videoUrl),
      featured: featured === true || featured === "true",
      status,
    };
    if (req.file) {
      update.thumbnailUrl = await uploadThumbnailToS3(req.file);
    }
    const successStory = await SuccessStory.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );
    if (!successStory) return res.status(404).json({ error: "Story not found" });
    res.json(successStory);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE
// Staff only.
router.delete("/:id", staffOnly, async (req, res) => {
  try {
    const story = await SuccessStory.findByIdAndDelete(req.params.id);
    if (!story) return res.status(404).json({ error: "Story not found" });
    res.json({ message: "Success story deleted" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
