import type { Awareness } from "@y/protocols/awareness";
import {
  createExtension,
  ExtensionOptions,
} from "../../editor/BlockNoteExtension.js";
import { CollaborationOptions } from "./Collaboration.js";
import {
  createRemoteCursorPlugin,
  createCursorPosition,
  removeCursorFromCache,
  remoteCursorPluginKey,
} from "./BlockNoteYjsBinding.js";
import { Plugin } from "prosemirror-state";

export type CollaborationUser = {
  name: string;
  color: string;
  [key: string]: string;
};

export const YCursorExtension = createExtension(
  ({ editor, options }: ExtensionOptions<CollaborationOptions>) => {
    const awareness =
      options.provider &&
      "awareness" in options.provider &&
      typeof options.provider.awareness === "object"
        ? (options.provider.awareness as Awareness)
        : undefined;

    if (awareness) {
      awareness.setLocalStateField("user", options.user);
    }

    // State for cursor broadcasting
    let hasFocus = false;
    let destroyed = false;
    let tiptapUnsubscribe: (() => void) | null = null;
    let awarenessChangeHandler:
      | ((
          changes: { added: number[]; updated: number[]; removed: number[] },
          origin: any,
        ) => void)
      | null = null;

    const noteId = options.noteId || "default";
    const yContent = options.fragment;

    function clearLocalCursor() {
      if (!awareness) return;
      const currentState = awareness.getLocalState() ?? {};
      const currentUser = (currentState.user as Record<string, any>) ?? {};
      awareness.setLocalStateField("user", {
        ...currentUser,
        cursor: undefined,
      });
    }

    function onSelectionUpdate() {
      if (!awareness || !hasFocus) return;

      try {
        const tiptapEditor = editor._tiptapEditor;
        if (!tiptapEditor) return;

        const { state } = tiptapEditor;
        const { selection } = state;
        const { anchor, head } = selection;

        const headPos = createCursorPosition(state, head, yContent, noteId);
        if (!headPos) return;

        const cursorState: Record<string, any> = { ...headPos };

        if (anchor !== head) {
          const anchorPos = createCursorPosition(
            state,
            anchor,
            yContent,
            noteId,
          );
          if (anchorPos) {
            cursorState.anchorBlockRelPos = anchorPos.blockRelPos;
            cursorState.anchorTextRelPos = anchorPos.textRelPos;
          }
        }

        const currentState = awareness.getLocalState() ?? {};
        const currentUser =
          (currentState.user as Record<string, any>) ?? {};

        awareness.setLocalStateField("user", {
          ...currentUser,
          cursor: cursorState,
        });
      } catch {
        // Editor may not be ready
      }
    }

    function onEditorFocus() {
      hasFocus = true;
    }

    function onEditorBlur() {
      hasFocus = false;
      clearLocalCursor();
    }

    function onAwarenessUpdate(
      changes: { added: number[]; updated: number[]; removed: number[] },
    ) {
      if (destroyed) return;
      for (const clientId of changes.removed) {
        removeCursorFromCache(clientId);
      }

      const tiptapEditor = editor._tiptapEditor;
      if (tiptapEditor?.view) {
        const { state } = tiptapEditor.view;
        tiptapEditor.view.dispatch(
          state.tr.setMeta("awarenessUpdate", true),
        );
      }
    }

    return {
      key: "yCursor",
      prosemirrorPlugins: awareness
        ? [createRemoteCursorPlugin(awareness, yContent, noteId)]
        : [],
      dependsOn: ["ySync"],
      mount() {
        if (!awareness) return;

        const tiptapEditor = editor._tiptapEditor;
        if (!tiptapEditor) return;

        // Broadcast local cursor position on selection change
        tiptapEditor.on("selectionUpdate", onSelectionUpdate);
        tiptapEditor.on("focus", onEditorFocus);
        tiptapEditor.on("blur", onEditorBlur);

        // Listen for remote awareness changes to trigger decoration updates
        awarenessChangeHandler = onAwarenessUpdate;
        awareness.on("change", awarenessChangeHandler);

        tiptapUnsubscribe = () => {
          tiptapEditor.off("selectionUpdate", onSelectionUpdate);
          tiptapEditor.off("focus", onEditorFocus);
          tiptapEditor.off("blur", onEditorBlur);
        };
      },
      unmount() {
        destroyed = true;

        if (awareness && awarenessChangeHandler) {
          awareness.off("change", awarenessChangeHandler);
          awarenessChangeHandler = null;
        }

        clearLocalCursor();

        if (awareness) {
          removeCursorFromCache(awareness.clientID);
        }

        if (tiptapUnsubscribe) {
          tiptapUnsubscribe();
          tiptapUnsubscribe = null;
        }

        // Remove cursor plugin from ProseMirror state
        const tiptapEditor = (editor as any)?._tiptapEditor;
        if (tiptapEditor?.view && !tiptapEditor.view.isDestroyed) {
          try {
            const currentState = tiptapEditor.view.state;
            const plugins = currentState.plugins.filter(
              (p: Plugin) => p.spec.key !== remoteCursorPluginKey,
            );
            if (plugins.length !== currentState.plugins.length) {
              const cleanState = currentState.reconfigure({ plugins });
              tiptapEditor.view.updateState(cleanState);
            }
          } catch {
            // Best-effort cleanup
          }
        }
      },
      updateUser(
        user: { name: string; color: string; [key: string]: string },
      ) {
        awareness?.setLocalStateField("user", user);
      },
    } as const;
  },
);
