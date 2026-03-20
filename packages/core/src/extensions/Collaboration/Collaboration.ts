import type * as Y from "@y/y";
import type { Awareness } from "@y/protocols/awareness";
import {
  createExtension,
  ExtensionOptions,
} from "../../editor/BlockNoteExtension.js";

export type CollaborationOptions = {
  /**
   * The Yjs Y.Type that's used for collaboration.
   */
  fragment: Y.Type;
  /**
   * The user info for the current user that's shown to other collaborators.
   */
  user: {
    name: string;
    color: string;
  };
  /**
   * A Yjs provider (used for awareness / cursor information)
   */
  provider?: { awareness?: Awareness };
  /**
   * Optional function to customize how cursors of users are rendered
   */
  renderCursor?: (user: any) => HTMLElement;
  /**
   * Optional flag to set when the user label should be shown with the default
   * collaboration cursor. Setting to "always" will always show the label,
   * while "activity" will only show the label when the user moves the cursor
   * or types. Defaults to "activity".
   */
  showCursorLabels?: "always" | "activity";
  /**
   * A note/document ID used for scoping cursor presence.
   */
  noteId?: string;
};

export const CollaborationExtension = createExtension(
  ({ editor, options }: ExtensionOptions<CollaborationOptions>) => {
    let binding: any = null;

    return {
      key: "collaboration",
      mount() {
        // Lazy import to avoid pulling in prosemirror-view at parse time
        import("./BlockNoteYjsBinding.js").then(
          ({ BlockNoteYjsBinding }) => {
            const awareness =
              options.provider &&
              "awareness" in options.provider &&
              typeof options.provider.awareness === "object"
                ? (options.provider.awareness as Awareness)
                : null;

            if (awareness) {
              awareness.setLocalStateField("user", options.user);
            }

            binding = new BlockNoteYjsBinding(
              options.fragment,
              editor,
              awareness,
              options.noteId || "default",
              true,
            );
          },
        );
      },
      unmount() {
        if (binding) {
          binding.destroy();
          binding = null;
        }
      },
      updateUser(user: { name: string; color: string }) {
        const awareness =
          options.provider &&
          "awareness" in options.provider &&
          typeof options.provider.awareness === "object"
            ? (options.provider.awareness as Awareness)
            : null;
        if (awareness) {
          awareness.setLocalStateField("user", user);
        }
      },
    } as const;
  },
);
