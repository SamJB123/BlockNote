import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import * as Y from "@y/y";
import { Awareness } from "@y/protocols/awareness";
import { useState } from "react";

const doc = new Y.Doc();
const provider = {
  awareness: new Awareness(doc),
};

export function ForkDemo() {
  const editor = useCreateBlockNote({
    collaboration: {
      fragment: doc.get("doc"),
      provider,
      user: { name: "Alice", color: "#3b82f6" },
    },
  });

  const [isForked, setIsForked] = useState(false);

  const handleFork = () => {
    const forkExt = editor.getExtension("yForkDoc" as any);
    if (forkExt && "fork" in forkExt) {
      (forkExt as any).fork();
      setIsForked(true);
    } else {
      console.warn("ForkYDoc extension not found");
    }
  };

  const handleMergeKeep = () => {
    const forkExt = editor.getExtension("yForkDoc" as any);
    if (forkExt && "merge" in forkExt) {
      (forkExt as any).merge({ keepChanges: true });
      setIsForked(false);
    }
  };

  const handleMergeDiscard = () => {
    const forkExt = editor.getExtension("yForkDoc" as any);
    if (forkExt && "merge" in forkExt) {
      (forkExt as any).merge({ keepChanges: false });
      setIsForked(false);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>ForkYDoc Demo</h2>
      <p>
        Fork the document to make changes without affecting the original. Then
        merge or discard your changes.
      </p>
      <div style={{ marginBottom: "10px", display: "flex", gap: "10px" }}>
        {!isForked ? (
          <button
            onClick={handleFork}
            style={{
              padding: "8px 16px",
              background: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Fork Document
          </button>
        ) : (
          <>
            <span
              style={{
                padding: "8px 16px",
                background: "#fef3c7",
                borderRadius: "4px",
                fontSize: "14px",
              }}
            >
              Document is forked — edits are local only
            </span>
            <button
              onClick={handleMergeKeep}
              style={{
                padding: "8px 16px",
                background: "#10b981",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Merge (Keep Changes)
            </button>
            <button
              onClick={handleMergeDiscard}
              style={{
                padding: "8px 16px",
                background: "#ef4444",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Merge (Discard Changes)
            </button>
          </>
        )}
      </div>
      <BlockNoteView editor={editor} />
    </div>
  );
}
