const mongoose = require("mongoose");

// #2.5 — the Community feed: student/instructor discussions, Q&A and knowledge
// sharing.
//
// Deliberately NOT built on Chat/Message. Those model a conversation between a
// known set of participants; a community post is public to the cohort, belongs
// to a category, can be pinned, and carries its own comment thread. Forcing it
// into Chat would mean a participants list that includes everybody and a pile of
// null-checks on every read.

// Author identity is denormalized. `author` can be a User, Instructor or Student
// and there is no single collection to populate from, so the display name and
// role are captured at write time — same approach as Ticket.createdByName.
const AuthorFields = {
  author: { type: String, required: true }, // id as string: crosses 3 collections
  authorName: { type: String, default: "" },
  authorRole: { type: String, default: "" },
  authorPhoto: { type: String, default: "" },
};

const ReactionSchema = new mongoose.Schema(
  {
    user: { type: String, required: true },
    // #2.6 — the five reactions from the doc.
    type: {
      type: String,
      enum: ["like", "love", "celebrate", "applause", "helpful"],
      required: true,
    },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const CommentSchema = new mongoose.Schema(
  {
    ...AuthorFields,
    content: { type: String, required: true },
    mentions: { type: [String], default: [] },
    isDeleted: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// #2.19 — fixed set so the filter bar is predictable.
const CATEGORIES = [
  "General Discussion",
  "Course Help",
  "Assignments",
  "Success Stories",
  "AI Tools",
  "Announcements",
  "Feedback",
];

const CommunityPostSchema = new mongoose.Schema(
  {
    ...AuthorFields,
    category: { type: String, enum: CATEGORIES, default: "General Discussion" },
    content: { type: String, required: true },
    // Stored as plain URLs; the client renders images inline and other types as
    // download cards (#2.11/#2.12).
    attachments: { type: [Object], default: [] },
    mentions: { type: [String], default: [] }, // #2.9

    reactions: { type: [ReactionSchema], default: [] },
    comments: { type: [CommentSchema], default: [] },

    // #2.7 — pinned posts sort above everything else until unpinned.
    isPinned: { type: Boolean, default: false },
    pinnedAt: { type: Date, default: null },
    // #2.18 — moderators can lock a thread without deleting it.
    isLocked: { type: Boolean, default: false },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Feed query is always "not deleted, pinned first, newest first".
CommunityPostSchema.index({ isDeleted: 1, isPinned: -1, createdAt: -1 });

CommunityPostSchema.statics.CATEGORIES = CATEGORIES;

module.exports = mongoose.model("CommunityPost", CommunityPostSchema);
