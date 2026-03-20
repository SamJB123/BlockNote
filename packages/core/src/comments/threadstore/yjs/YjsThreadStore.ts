import { v4 } from "uuid";
import * as Y from "@y/y";
import { CommentBody, CommentData, ThreadData } from "../../types.js";
import { ThreadStoreAuth } from "../ThreadStoreAuth.js";
import { YjsThreadStoreBase } from "./YjsThreadStoreBase.js";
import {
  commentToYType,
  threadToYType,
  yTypeToComment,
  yTypeToThread,
} from "./yjsHelpers.js";

/**
 * This is a Yjs-based implementation of the ThreadStore interface.
 *
 * It reads and writes thread / comments information directly to the underlying Yjs Document.
 *
 * @important While this is the easiest to add to your app, there are two challenges:
 * - The user needs to be able to write to the Yjs document to store the information.
 *   So a user without write access to the Yjs document cannot leave any comments.
 * - Even with write access, the operations are not secure. Unless your Yjs server
 *   guards against malicious operations, it's technically possible for one user to make changes to another user's comments, etc.
 *   (even though these options are not visible in the UI, a malicious user can make unauthorized changes to the underlying Yjs document)
 */
export class YjsThreadStore extends YjsThreadStoreBase {
  constructor(
    private readonly userId: string,
    threadsYType: Y.Type,
    auth: ThreadStoreAuth,
  ) {
    super(threadsYType, auth);
  }

  private transact = <T, R>(
    fn: (options: T) => R,
  ): ((options: T) => Promise<R>) => {
    return async (options: T) => {
      return this.threadsYType.doc!.transact(() => {
        return fn(options);
      });
    };
  };

  public createThread = this.transact(
    (options: {
      initialComment: {
        body: CommentBody;
        metadata?: any;
      };
      metadata?: any;
    }) => {
      if (!this.auth.canCreateThread()) {
        throw new Error("Not authorized");
      }

      const date = new Date();

      const comment: CommentData = {
        type: "comment",
        id: v4(),
        userId: this.userId,
        createdAt: date,
        updatedAt: date,
        reactions: [],
        metadata: options.initialComment.metadata,
        body: options.initialComment.body,
      };

      const thread: ThreadData = {
        type: "thread",
        id: v4(),
        createdAt: date,
        updatedAt: date,
        comments: [comment],
        resolved: false,
        metadata: options.metadata,
      };

      this.threadsYType.setAttr(thread.id, threadToYType(thread));

      return thread;
    },
  );

  // YjsThreadStore does not support addThreadToDocument
  public addThreadToDocument = undefined;

  public addComment = this.transact(
    (options: {
      comment: {
        body: CommentBody;
        metadata?: any;
      };
      threadId: string;
    }) => {
      const yThread = this.threadsYType.getAttr(options.threadId) as Y.Type;
      if (!yThread) {
        throw new Error("Thread not found");
      }

      if (!this.auth.canAddComment(yTypeToThread(yThread))) {
        throw new Error("Not authorized");
      }

      const date = new Date();
      const comment: CommentData = {
        type: "comment",
        id: v4(),
        userId: this.userId,
        createdAt: date,
        updatedAt: date,
        deletedAt: undefined,
        reactions: [],
        metadata: options.comment.metadata,
        body: options.comment.body,
      };

      const commentsYType = yThread.getAttr("comments") as Y.Type;
      commentsYType.push([commentToYType(comment)]);

      yThread.setAttr("updatedAt", new Date().getTime());
      return comment;
    },
  );

  public updateComment = this.transact(
    (options: {
      comment: {
        body: CommentBody;
        metadata?: any;
      };
      threadId: string;
      commentId: string;
    }) => {
      const yThread = this.threadsYType.getAttr(options.threadId) as Y.Type;
      if (!yThread) {
        throw new Error("Thread not found");
      }

      const commentsYType = yThread.getAttr("comments") as Y.Type;
      const yCommentIndex = yTypeFindIndex(
        commentsYType,
        (comment) => comment.getAttr("id") === options.commentId,
      );

      if (yCommentIndex === -1) {
        throw new Error("Comment not found");
      }

      const yComment = commentsYType.get(yCommentIndex) as Y.Type;

      if (!this.auth.canUpdateComment(yTypeToComment(yComment))) {
        throw new Error("Not authorized");
      }

      yComment.setAttr("body", options.comment.body);
      yComment.setAttr("updatedAt", new Date().getTime());
      yComment.setAttr("metadata", options.comment.metadata);
    },
  );

  public deleteComment = this.transact(
    (options: {
      threadId: string;
      commentId: string;
      softDelete?: boolean;
    }) => {
      const yThread = this.threadsYType.getAttr(options.threadId) as Y.Type;
      if (!yThread) {
        throw new Error("Thread not found");
      }

      const commentsYType = yThread.getAttr("comments") as Y.Type;
      const yCommentIndex = yTypeFindIndex(
        commentsYType,
        (comment) => comment.getAttr("id") === options.commentId,
      );

      if (yCommentIndex === -1) {
        throw new Error("Comment not found");
      }

      const yComment = commentsYType.get(yCommentIndex) as Y.Type;

      if (!this.auth.canDeleteComment(yTypeToComment(yComment))) {
        throw new Error("Not authorized");
      }

      if (yComment.getAttr("deletedAt")) {
        throw new Error("Comment already deleted");
      }

      if (options.softDelete) {
        yComment.setAttr("deletedAt", new Date().getTime());
        yComment.setAttr("body", undefined);
      } else {
        commentsYType.delete(yCommentIndex, 1);
      }

      if (
        commentsYType
          .toArray()
          .every((comment: any) =>
            comment instanceof Y.Type ? comment.getAttr("deletedAt") : true
          )
      ) {
        // all comments deleted
        if (options.softDelete) {
          yThread.setAttr("deletedAt", new Date().getTime());
        } else {
          this.threadsYType.deleteAttr(options.threadId);
        }
      }

      yThread.setAttr("updatedAt", new Date().getTime());
    },
  );

  public deleteThread = this.transact((options: { threadId: string }) => {
    if (
      !this.auth.canDeleteThread(
        yTypeToThread(this.threadsYType.getAttr(options.threadId) as Y.Type),
      )
    ) {
      throw new Error("Not authorized");
    }

    this.threadsYType.deleteAttr(options.threadId);
  });

  public resolveThread = this.transact((options: { threadId: string }) => {
    const yThread = this.threadsYType.getAttr(options.threadId) as Y.Type;
    if (!yThread) {
      throw new Error("Thread not found");
    }

    if (!this.auth.canResolveThread(yTypeToThread(yThread))) {
      throw new Error("Not authorized");
    }

    yThread.setAttr("resolved", true);
    yThread.setAttr("resolvedUpdatedAt", new Date().getTime());
    yThread.setAttr("resolvedBy", this.userId);
  });

  public unresolveThread = this.transact((options: { threadId: string }) => {
    const yThread = this.threadsYType.getAttr(options.threadId) as Y.Type;
    if (!yThread) {
      throw new Error("Thread not found");
    }

    if (!this.auth.canUnresolveThread(yTypeToThread(yThread))) {
      throw new Error("Not authorized");
    }

    yThread.setAttr("resolved", false);
    yThread.setAttr("resolvedUpdatedAt", new Date().getTime());
  });

  public addReaction = this.transact(
    (options: { threadId: string; commentId: string; emoji: string }) => {
      const yThread = this.threadsYType.getAttr(options.threadId) as Y.Type;
      if (!yThread) {
        throw new Error("Thread not found");
      }

      const commentsYType = yThread.getAttr("comments") as Y.Type;
      const yCommentIndex = yTypeFindIndex(
        commentsYType,
        (comment) => comment.getAttr("id") === options.commentId,
      );

      if (yCommentIndex === -1) {
        throw new Error("Comment not found");
      }

      const yComment = commentsYType.get(yCommentIndex) as Y.Type;

      if (!this.auth.canAddReaction(yTypeToComment(yComment), options.emoji)) {
        throw new Error("Not authorized");
      }

      const date = new Date();

      const key = `${this.userId}-${options.emoji}`;

      const reactionsByUser = yComment.getAttr("reactionsByUser") as Y.Type;

      if (reactionsByUser.hasAttr(key)) {
        // already exists
        return;
      } else {
        const reaction = new Y.Type();
        reaction.setAttr("emoji", options.emoji);
        reaction.setAttr("createdAt", date.getTime());
        reaction.setAttr("userId", this.userId);
        reactionsByUser.setAttr(key, reaction);
      }
    },
  );

  public deleteReaction = this.transact(
    (options: { threadId: string; commentId: string; emoji: string }) => {
      const yThread = this.threadsYType.getAttr(options.threadId) as Y.Type;
      if (!yThread) {
        throw new Error("Thread not found");
      }

      const commentsYType = yThread.getAttr("comments") as Y.Type;
      const yCommentIndex = yTypeFindIndex(
        commentsYType,
        (comment) => comment.getAttr("id") === options.commentId,
      );

      if (yCommentIndex === -1) {
        throw new Error("Comment not found");
      }

      const yComment = commentsYType.get(yCommentIndex) as Y.Type;

      if (
        !this.auth.canDeleteReaction(yTypeToComment(yComment), options.emoji)
      ) {
        throw new Error("Not authorized");
      }

      const key = `${this.userId}-${options.emoji}`;

      const reactionsByUser = yComment.getAttr("reactionsByUser") as Y.Type;

      reactionsByUser.deleteAttr(key);
    },
  );
}

function yTypeFindIndex(
  ytype: Y.Type,
  predicate: (item: Y.Type) => boolean,
) {
  for (let i = 0; i < ytype.length; i++) {
    const child = ytype.get(i);
    if (child instanceof Y.Type && predicate(child)) {
      return i;
    }
  }
  return -1;
}
