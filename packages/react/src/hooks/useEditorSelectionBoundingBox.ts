import type { BlockNoteEditor } from "@samjb/blocknote-core";
import { useEditorState } from "./useEditorState.js";

export function useEditorSelectionBoundingBox(
  enabled?: boolean,
  editor?: BlockNoteEditor<any, any, any>,
) {
  return useEditorState({
    editor,
    selector: ({ editor }) =>
      enabled ? editor.getSelectionBoundingBox() : undefined,
  });
}
