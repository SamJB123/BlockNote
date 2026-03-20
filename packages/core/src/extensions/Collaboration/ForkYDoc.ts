import * as Y from "@y/y";
import {
  createExtension,
  createStore,
  ExtensionOptions,
} from "../../editor/BlockNoteExtension.js";
import { CollaborationOptions } from "./Collaboration.js";

/**
 * To find a fragment in another ydoc, we need to search for it.
 */
function findTypeInOtherYdoc(
  ytype: Y.Type,
  otherYdoc: Y.Doc,
): Y.Type {
  const ydoc = ytype.doc!;
  if (ytype._item === null) {
    /**
     * If is a root type, we need to find the root key in the original ydoc
     * and use it to get the type in the other ydoc.
     */
    const rootKey = Array.from(ydoc.share.keys()).find(
      (key) => ydoc.share.get(key) === ytype,
    );
    if (rootKey == null) {
      throw new Error("type does not exist in other ydoc");
    }
    return otherYdoc.get(rootKey);
  } else {
    /**
     * If it is a sub type, we use the item id to find the history type.
     */
    const ytypeItem = ytype._item;
    const otherStructs =
      otherYdoc.store.clients.get(ytypeItem.id.client) ?? [];
    const itemIndex = Y.findIndexSS(otherStructs, ytypeItem.id.clock);
    const otherItem = otherStructs[itemIndex] as Y.Item;
    const otherContent = otherItem.content as Y.ContentType;
    return otherContent.type as Y.Type;
  }
}

export const ForkYDocExtension = createExtension(
  ({ editor, options }: ExtensionOptions<CollaborationOptions>) => {
    let forkedState:
      | {
          originalFragment: Y.Type;
          forkedFragment: Y.Type;
        }
      | undefined = undefined;

    const store = createStore({ isForked: false });

    return {
      key: "yForkDoc",
      store,
      /**
       * Fork the Y.js document from syncing to the remote,
       * allowing modifications to the document without affecting the remote.
       * These changes can later be rolled back or applied to the remote.
       */
      fork() {
        if (forkedState) {
          return;
        }

        const originalFragment = options.fragment;

        if (!originalFragment) {
          throw new Error("No fragment to fork from");
        }

        const doc = new Y.Doc();
        // Copy the original document to a new Yjs document
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(originalFragment.doc!));

        // Find the forked fragment in the new Yjs document
        const forkedFragment = findTypeInOtherYdoc(originalFragment, doc);

        forkedState = {
          originalFragment,
          forkedFragment,
        };

        // Unregister the current collaboration binding
        editor.unregisterExtension(["collaboration"]);

        // Re-register with the forked fragment (no cursor sharing — it's a local fork)
        const { CollaborationExtension } = require("./Collaboration.js");
        editor.registerExtension([
          CollaborationExtension({
            ...options,
            fragment: forkedFragment,
            provider: undefined, // No cursors in forked mode
          }),
        ]);

        store.setState({ isForked: true });
      },

      /**
       * Resume syncing the Y.js document to the remote.
       * If `keepChanges` is true, any changes that have been made to the forked
       * document will be applied to the original document.
       * Otherwise, the original document will be restored and the changes will
       * be discarded.
       */
      merge({ keepChanges }: { keepChanges: boolean }) {
        if (!forkedState) {
          return;
        }

        const { originalFragment, forkedFragment } = forkedState;

        // Unregister the forked collaboration binding
        editor.unregisterExtension(["collaboration"]);

        // Re-register with the original fragment (restores cursor sharing)
        const { CollaborationExtension } = require("./Collaboration.js");
        editor.registerExtension([CollaborationExtension(options)]);

        if (keepChanges) {
          // Apply any changes that have been made to the fork, onto the original doc
          const update = Y.encodeStateAsUpdate(
            forkedFragment.doc!,
            Y.encodeStateVector(originalFragment.doc!),
          );
          Y.applyUpdate(originalFragment.doc!, update, editor);
        }

        forkedState = undefined;
        store.setState({ isForked: false });
      },
    } as const;
  },
);
