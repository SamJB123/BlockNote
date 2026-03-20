import { yUndoPlugin, ySyncPluginKey, yUndoPluginKey } from "@y/prosemirror";
import * as Y from "@y/y";
import { Command } from "prosemirror-state";
import {
  createExtension,
  ExtensionOptions,
} from "../../editor/BlockNoteExtension.js";
import { CollaborationOptions } from "./Collaboration.js";

// Structural nodes that should not be deleted during undo if they still
// contain content from other users.  The delete loop processes children
// before parents, so: if a paragraph still has text → protected →
// its parent blockContainer still has the paragraph → also protected.
const protectedNodes = new Set([
  "paragraph",
  "blockContainer",
  "blockGroup",
  "columnList",
  "column",
]);

const deleteFilter = (item: any) => {
  const type = item?.content?.type;
  if (!type || typeof type.length !== "number") return true;
  const name: string | null = type.name ?? null;
  if (name !== null && protectedNodes.has(name) && type.length > 0) return false;
  if (name === null && type.length > 0) return false;
  return true;
};

const undoCommand: Command = (state, dispatch) => {
  const undoManager = yUndoPluginKey.getState(state)?.undoManager;
  return dispatch == null
    ? !!undoManager?.canUndo()
    : undoManager?.undo() != null;
};

const redoCommand: Command = (state, dispatch) => {
  const undoManager = yUndoPluginKey.getState(state)?.undoManager;
  return dispatch == null
    ? !!undoManager?.canRedo()
    : undoManager?.redo() != null;
};

export const YUndoExtension = createExtension(
  ({
    options,
  }: ExtensionOptions<Pick<CollaborationOptions, "fragment">>) => {
    const undoManager = new Y.UndoManager(options.fragment, {
      trackedOrigins: new Set([ySyncPluginKey]),
      deleteFilter,
      captureTransaction: (tr) => tr.meta.get("addToHistory") !== false,
    });

    return {
      key: "yUndo",
      prosemirrorPlugins: [yUndoPlugin({ undoManager })],
      dependsOn: ["ySync"],
      undoCommand,
      redoCommand,
    } as const;
  },
);
