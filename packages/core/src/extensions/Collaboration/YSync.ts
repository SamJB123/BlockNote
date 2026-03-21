import { syncPlugin } from "@samjb/y-prosemirror";
import {
  ExtensionOptions,
  createExtension,
} from "../../editor/BlockNoteExtension.js";
import { CollaborationOptions } from "./Collaboration.js";

export const YSyncExtension = createExtension(
  ({
    options,
  }: ExtensionOptions<
    Pick<CollaborationOptions, "fragment" | "attributionManager">
  >) => {
    return {
      key: "ySync",
      prosemirrorPlugins: [
        syncPlugin(options.fragment, {
          attributionManager: options.attributionManager,
          mapAttributionToMark(format, attribution) {
            if (Array.isArray(attribution.delete) ? attribution.delete.length > 0 : !!attribution.delete) {
              return Object.assign({}, format, {
                deletion: { id: Date.now(), user: attribution.delete?.[0] },
              });
            }
            if (Array.isArray(attribution.insert) ? attribution.insert.length > 0 : !!attribution.insert) {
              return Object.assign({}, format, {
                insertion: { id: Date.now(), user: attribution.insert?.[0] },
              });
            }
            return format;
          },
        }),
      ],
      runsBefore: ["default"],
    } as const;
  },
);
