import { CollaborationOptions } from "./Collaboration.js";
import { ForkYDocExtension } from "./ForkYDoc.js";
import { YCursorExtension } from "./YCursorPlugin.js";
import { YSyncExtension } from "./YSync.js";
import { YUndoExtension } from "./YUndo.js";

export function getCollaborationRuntimeExtensions(
  options: CollaborationOptions,
  {
    includeFork = true,
  }: {
    includeFork?: boolean;
  } = {},
) {
  return [
    YSyncExtension(options),
    YCursorExtension(options),
    YUndoExtension(options),
    ...(includeFork ? [ForkYDocExtension(options)] : []),
  ];
}
