import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import {
  CommentsExtension,
  DefaultThreadStoreAuth,
  YjsThreadStore,
} from "@blocknote/core/comments";
import * as Y from "@y/y";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "@y/protocols/awareness";
import { useMemo } from "react";

const doc = new Y.Doc();
const provider = {
  awareness: new Awareness(doc),
};

const doc2 = new Y.Doc();
const provider2 = {
  awareness: new Awareness(doc2),
};

const suggestingDoc = new Y.Doc({ isSuggestionDoc: true });
const suggestingProvider = {
  awareness: new Awareness(suggestingDoc),
};

const createSuggestionAttrs = (prevDoc: Y.Doc, nextDoc: Y.Doc) =>
  Y.createContentMapFromContentIds(
    Y.createContentIdsFromDocDiff(prevDoc, nextDoc),
    [Y.createContentAttribute("insert", ["nickthesick"])],
  );

const suggestingAttributionManager = Y.createAttributionManagerFromDiff(
  doc,
  suggestingDoc,
  {
    attrs: createSuggestionAttrs(doc, suggestingDoc),
  },
);
suggestingAttributionManager.suggestionMode = true;

const suggestionModeDoc = new Y.Doc({ isSuggestionDoc: true });
const suggestionModeProvider = {
  awareness: new Awareness(suggestionModeDoc),
};
const suggestionModeAttributionManager = Y.createAttributionManagerFromDiff(
  doc,
  suggestionModeDoc,
  {
    attrs: createSuggestionAttrs(doc, suggestionModeDoc),
  },
);
suggestionModeAttributionManager.suggestionMode = true;

// Hardcoded users for the demo
const USERS = [
  { id: "alice", username: "Alice", avatarUrl: "" },
  { id: "bob", username: "Bob", avatarUrl: "" },
];

async function resolveUsers(userIds: string[]) {
  return USERS.filter((u) => userIds.includes(u.id));
}

// Function to sync two documents
function syncDocs(sourceDoc: Y.Doc, targetDoc: Y.Doc) {
  const update = Y.encodeStateAsUpdate(sourceDoc);
  Y.applyUpdate(targetDoc, update);
}

// Set up two-way sync (Y.Doc + Awareness)
function setupTwoWaySync(
  doc1: Y.Doc,
  doc2: Y.Doc,
  awareness1?: Awareness,
  awareness2?: Awareness,
) {
  syncDocs(doc1, doc2);
  syncDocs(doc2, doc1);

  doc1.on("update", (update: Uint8Array) => {
    Y.applyUpdate(doc2, update);
  });

  doc2.on("update", (update: Uint8Array) => {
    Y.applyUpdate(doc1, update);
  });

  if (awareness1 && awareness2) {
    awareness1.on(
      "update",
      ({
        added,
        updated,
        removed,
      }: {
        added: number[];
        updated: number[];
        removed: number[];
      }) => {
        const changedClients = added.concat(updated).concat(removed);
        const encodedUpdate = encodeAwarenessUpdate(awareness1, changedClients);
        applyAwarenessUpdate(awareness2, encodedUpdate, awareness1);
      },
    );

    awareness2.on(
      "update",
      ({
        added,
        updated,
        removed,
      }: {
        added: number[];
        updated: number[];
        removed: number[];
      }) => {
        const changedClients = added.concat(updated).concat(removed);
        const encodedUpdate = encodeAwarenessUpdate(awareness2, changedClients);
        applyAwarenessUpdate(awareness1, encodedUpdate, awareness2);
      },
    );
  }
}

setupTwoWaySync(doc, doc2, provider.awareness, provider2.awareness);

setupTwoWaySync(
  suggestingDoc,
  suggestionModeDoc,
  suggestingProvider.awareness,
  suggestionModeProvider.awareness,
);

function Editor({
  fragment,
  provider,
  attributionManager,
  user,
  userId,
  threadsYType,
}: {
  fragment: Y.Type;
  provider: { awareness: Awareness };
  attributionManager?: Y.AbstractAttributionManager;
  user: { name: string; color: string };
  userId: string;
  threadsYType: Y.Type;
}) {
  const threadStore = useMemo(
    () =>
      new YjsThreadStore(
        userId,
        threadsYType,
        new DefaultThreadStoreAuth(userId, "editor"),
      ),
    [userId, threadsYType],
  );

  const editor = useCreateBlockNote({
    collaboration: {
      fragment,
      provider,
      user,
      attributionManager,
    },
    extensions: [CommentsExtension({ threadStore, resolveUsers })],
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", gap: "8px" }}>
        <button type="button" onClick={() => editor.undo()}>
          Undo
        </button>
        <button type="button" onClick={() => editor.redo()}>
          Redo
        </button>
      </div>
      <BlockNoteView editor={editor} />
    </div>
  );
}

export function CollabDemo() {
  return (
    <div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: "10px",
          margin: "10px",
        }}
      >
        <div style={{ flex: 1 }}>
          Client A (Alice)
          <Editor
            fragment={doc.get("doc")}
            provider={provider}
            user={{ name: "Alice", color: "#3b82f6" }}
            userId="alice"
            threadsYType={doc.get("threads")}
          />
        </div>
        <div style={{ flex: 1 }}>
          Client B (Bob)
          <Editor
            fragment={doc2.get("doc")}
            provider={provider2}
            user={{ name: "Bob", color: "#ef4444" }}
            userId="bob"
            threadsYType={doc2.get("threads")}
          />
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: "10px",
          margin: "10px",
        }}
      >
        <div style={{ flex: 1 }}>
          View Suggestions Mode
          <Editor
            fragment={suggestingDoc.get("doc")}
            provider={suggestingProvider}
            attributionManager={suggestingAttributionManager}
            user={{ name: "Alice", color: "#3b82f6" }}
            userId="alice"
            threadsYType={suggestingDoc.get("threads")}
          />
        </div>
        <div style={{ flex: 1 }}>
          Suggestion Mode
          <Editor
            fragment={suggestionModeDoc.get("doc")}
            provider={suggestionModeProvider}
            attributionManager={suggestionModeAttributionManager}
            user={{ name: "Bob", color: "#ef4444" }}
            userId="bob"
            threadsYType={suggestionModeDoc.get("threads")}
          />
        </div>
      </div>
    </div>
  );
}
