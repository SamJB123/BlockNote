import { Mark } from "@tiptap/core";

/**
 * ProseMirror marks for Yjs attribution tracking.
 * These are added to the schema when collaboration is enabled with
 * an attribution manager, enabling track changes / suggestion mode.
 *
 * The marks are created by the defaultMapAttributionToMark function
 * in @y/prosemirror's delta-sync module.
 *
 * These marks are inline-only (spanning: false) to prevent them from
 * wrapping block-level nodes like blockContainer, which would violate
 * BlockNote's schema constraints.
 */

export const YAttributionInsertionMark = Mark.create({
  name: "y-attribution-insertion",
  excludes: "",
  inclusive: false,
  spanning: false,

  addAttributes() {
    return {
      userIds: { default: null },
      timestamp: { default: null },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        class: "bn-attribution-insertion",
        "data-user-ids": HTMLAttributes.userIds
          ? JSON.stringify(HTMLAttributes.userIds)
          : undefined,
      },
    ];
  },

  parseHTML() {
    return [{ tag: "span.bn-attribution-insertion" }];
  },

  extendMarkSchema(extension) {
    if (extension.name === "y-attribution-insertion") {
      return { blocknoteIgnore: true };
    }
    return {};
  },
});

export const YAttributionDeletionMark = Mark.create({
  name: "y-attribution-deletion",
  excludes: "",
  inclusive: false,
  spanning: false,

  addAttributes() {
    return {
      userIds: { default: null },
      timestamp: { default: null },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        class: "bn-attribution-deletion",
        "data-user-ids": HTMLAttributes.userIds
          ? JSON.stringify(HTMLAttributes.userIds)
          : undefined,
      },
    ];
  },

  parseHTML() {
    return [{ tag: "span.bn-attribution-deletion" }];
  },

  extendMarkSchema(extension) {
    if (extension.name === "y-attribution-deletion") {
      return { blocknoteIgnore: true };
    }
    return {};
  },
});

export const YAttributionFormatMark = Mark.create({
  name: "y-attribution-format",
  excludes: "",
  inclusive: false,
  spanning: false,

  addAttributes() {
    return {
      userIdsByAttr: { default: null },
      timestamp: { default: null },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        class: "bn-attribution-format",
        "data-user-ids-by-attr": HTMLAttributes.userIdsByAttr
          ? JSON.stringify(HTMLAttributes.userIdsByAttr)
          : undefined,
      },
    ];
  },

  parseHTML() {
    return [{ tag: "span.bn-attribution-format" }];
  },

  extendMarkSchema(extension) {
    if (extension.name === "y-attribution-format") {
      return { blocknoteIgnore: true };
    }
    return {};
  },
});

export const attributionMarks = [
  YAttributionInsertionMark,
  YAttributionDeletionMark,
  YAttributionFormatMark,
];
