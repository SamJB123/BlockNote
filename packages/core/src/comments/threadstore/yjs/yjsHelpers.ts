import * as Y from "@y/y";
import { CommentData, CommentReactionData, ThreadData } from "../../types.js";

export function commentToYType(comment: CommentData) {
  const yt = new Y.Type();
  yt.setAttr("id", comment.id);
  yt.setAttr("userId", comment.userId);
  yt.setAttr("createdAt", comment.createdAt.getTime());
  yt.setAttr("updatedAt", comment.updatedAt.getTime());
  if (comment.deletedAt) {
    yt.setAttr("deletedAt", comment.deletedAt.getTime());
    yt.setAttr("body", undefined);
  } else {
    yt.setAttr("body", comment.body);
  }
  if (comment.reactions.length > 0) {
    throw new Error("Reactions should be empty in commentToYType");
  }

  /**
   * Reactions are stored in a Y.Type used as a map, keyed by {userId-emoji},
   * this makes it easy to add / remove reactions and in a way that works local-first.
   * The cost is that "reading" the reactions is a bit more complex (see yTypeToReactions).
   */
  yt.setAttr("reactionsByUser", new Y.Type());
  yt.setAttr("metadata", comment.metadata);

  return yt;
}

export function threadToYType(thread: ThreadData) {
  const yt = new Y.Type();
  yt.setAttr("id", thread.id);
  yt.setAttr("createdAt", thread.createdAt.getTime());
  yt.setAttr("updatedAt", thread.updatedAt.getTime());
  const commentsArray = new Y.Type();

  commentsArray.push(thread.comments.map((comment) => commentToYType(comment)));

  yt.setAttr("comments", commentsArray);
  yt.setAttr("resolved", thread.resolved);
  yt.setAttr("resolvedUpdatedAt", thread.resolvedUpdatedAt?.getTime());
  yt.setAttr("resolvedBy", thread.resolvedBy);
  yt.setAttr("metadata", thread.metadata);
  return yt;
}

type SingleUserCommentReactionData = {
  emoji: string;
  createdAt: Date;
  userId: string;
};

export function yTypeToReaction(
  yt: Y.Type,
): SingleUserCommentReactionData {
  return {
    emoji: yt.getAttr("emoji"),
    createdAt: new Date(yt.getAttr("createdAt")),
    userId: yt.getAttr("userId"),
  };
}

function yTypeToReactions(yt: Y.Type): CommentReactionData[] {
  const flatReactions: SingleUserCommentReactionData[] = [];
  yt.forEachAttr((reaction: any) => {
    if (reaction instanceof Y.Type) {
      flatReactions.push(yTypeToReaction(reaction));
    }
  });
  // combine reactions by the same emoji
  return flatReactions.reduce(
    (acc: CommentReactionData[], reaction: SingleUserCommentReactionData) => {
      const existingReaction = acc.find((r) => r.emoji === reaction.emoji);
      if (existingReaction) {
        existingReaction.userIds.push(reaction.userId);
        existingReaction.createdAt = new Date(
          Math.min(
            existingReaction.createdAt.getTime(),
            reaction.createdAt.getTime(),
          ),
        );
      } else {
        acc.push({
          emoji: reaction.emoji,
          createdAt: reaction.createdAt,
          userIds: [reaction.userId],
        });
      }
      return acc;
    },
    [] as CommentReactionData[],
  );
}

export function yTypeToComment(yt: Y.Type): CommentData {
  return {
    type: "comment",
    id: yt.getAttr("id"),
    userId: yt.getAttr("userId"),
    createdAt: new Date(yt.getAttr("createdAt")),
    updatedAt: new Date(yt.getAttr("updatedAt")),
    deletedAt: yt.getAttr("deletedAt")
      ? new Date(yt.getAttr("deletedAt"))
      : undefined,
    reactions: yTypeToReactions(yt.getAttr("reactionsByUser")),
    metadata: yt.getAttr("metadata"),
    body: yt.getAttr("body"),
  };
}

export function yTypeToThread(yt: Y.Type): ThreadData {
  const commentsYType = yt.getAttr("comments") as Y.Type;
  const comments = commentsYType
    ? commentsYType.toArray().filter((c): c is Y.Type => c instanceof Y.Type).map(
        (comment) => yTypeToComment(comment),
      )
    : [];
  return {
    type: "thread",
    id: yt.getAttr("id"),
    createdAt: new Date(yt.getAttr("createdAt")),
    updatedAt: new Date(yt.getAttr("updatedAt")),
    comments,
    resolved: yt.getAttr("resolved"),
    resolvedUpdatedAt: new Date(yt.getAttr("resolvedUpdatedAt")),
    resolvedBy: yt.getAttr("resolvedBy"),
    metadata: yt.getAttr("metadata"),
  };
}

// Keep backward-compatible aliases
export const commentToYMap = commentToYType;
export const threadToYMap = threadToYType;
export const yMapToReaction = yTypeToReaction;
export const yMapToComment = yTypeToComment;
export const yMapToThread = yTypeToThread;
