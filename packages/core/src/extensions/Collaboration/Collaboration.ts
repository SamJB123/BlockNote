import type * as Y from "@y/y";
import type { Awareness } from "@y/protocols/awareness";
import {
  createExtension,
  ExtensionOptions,
} from "../../editor/BlockNoteExtension.js";
import { YSyncExtension } from "./YSync.js";
import { YCursorExtension } from "./YCursorPlugin.js";
import { YUndoExtension } from "./YUndo.js";
import { ForkYDocExtension } from "./ForkYDoc.js";

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
  /**
   * The attribution manager for tracking who made changes.
   * Used for track changes / suggestion mode.
   * Attribution data is mapped to BlockNote's existing insertion/deletion
   * marks (from SuggestionMarks) by the sync plugin.
   */
  attributionManager?: Y.AbstractAttributionManager;
};

export const CollaborationExtension = createExtension(
  ({ options }: ExtensionOptions<CollaborationOptions>) => {
    return {
      key: "collaboration",
      blockNoteExtensions: [
        // Sync: uses @y/prosemirror's syncPlugin for incremental
        // transaction-based sync with attribution support.
        // Attribution data is mapped to BlockNote's existing
        // insertion/deletion marks (SuggestionMarks).
        YSyncExtension(options),
        // Cursors: uses our BlockNoteYjsBinding-based cursor system
        // since @y/prosemirror v2 hasn't implemented yCursorPlugin yet
        YCursorExtension(options),
        // Undo/Redo: uses @y/prosemirror's yUndoPlugin with Y.UndoManager
        // for collaborative undo scoped to the local user
        YUndoExtension(options),
        // Fork/Merge: isolate edits from remote sync, then merge or discard
        ForkYDocExtension(options),
      ],
    } as const;
  },
);
