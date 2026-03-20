import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import {
  yXmlFragmentToBlocks,
  blocksToYXmlFragment,
  yDocToBlocks,
  blocksToYDoc,
} from "@blocknote/core/yjs";
import * as Y from "@y/y";
import { Awareness } from "@y/protocols/awareness";
import { useState } from "react";

const doc = new Y.Doc();
const provider = {
  awareness: new Awareness(doc),
};

export function ConversionsDemo() {
  const editor = useCreateBlockNote({
    collaboration: {
      fragment: doc.get("doc"),
      provider,
      user: { name: "Alice", color: "#3b82f6" },
    },
  });

  const [conversionOutput, setConversionOutput] = useState<string>("");

  const handleYTypeToBlocks = () => {
    try {
      const fragment = doc.get("doc");
      const blocks = yXmlFragmentToBlocks(editor, fragment);
      setConversionOutput(
        `yXmlFragmentToBlocks result (${blocks.length} blocks):\n\n` +
          JSON.stringify(blocks, null, 2),
      );
    } catch (e) {
      setConversionOutput(`Error: ${e}`);
    }
  };

  const handleBlocksToYDoc = () => {
    try {
      const currentBlocks = editor.document;
      const newDoc = blocksToYDoc(editor, currentBlocks);
      const state = Y.encodeStateAsUpdate(newDoc);
      setConversionOutput(
        `blocksToYDoc result:\n` +
          `  Y.Doc created with ${state.byteLength} bytes of state\n` +
          `  Fragment "prosemirror" length: ${newDoc.get("prosemirror").length}`,
      );
    } catch (e) {
      setConversionOutput(`Error: ${e}`);
    }
  };

  const handleBlocksToFragment = () => {
    try {
      const currentBlocks = editor.document;
      const fragment = blocksToYXmlFragment(editor, currentBlocks as any);
      setConversionOutput(
        `blocksToYXmlFragment result:\n` +
          `  Fragment length: ${fragment.length}\n` +
          `  Fragment delta: ${JSON.stringify(fragment.toDelta()?.toJSON?.() ?? "N/A", null, 2)}`,
      );
    } catch (e) {
      setConversionOutput(`Error: ${e}`);
    }
  };

  const handleRoundTrip = () => {
    try {
      const originalBlocks = editor.document;

      // Blocks → Y.Doc → Blocks
      const newDoc = blocksToYDoc(editor, originalBlocks);
      const roundTrippedBlocks = yDocToBlocks(editor, newDoc);

      const originalJson = JSON.stringify(originalBlocks, null, 2);
      const roundTrippedJson = JSON.stringify(roundTrippedBlocks, null, 2);
      const match = originalJson === roundTrippedJson;

      setConversionOutput(
        `Round-trip test (Blocks → Y.Doc → Blocks):\n` +
          `  Original blocks: ${originalBlocks.length}\n` +
          `  Round-tripped blocks: ${roundTrippedBlocks.length}\n` +
          `  Match: ${match ? "YES ✓" : "NO ✗"}\n\n` +
          (match
            ? "Content preserved perfectly!"
            : `Original:\n${originalJson}\n\nRound-tripped:\n${roundTrippedJson}`),
      );
    } catch (e) {
      setConversionOutput(`Error: ${e}`);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>Yjs Conversion Utilities Demo</h2>
      <p>
        Test the conversion functions between BlockNote blocks and Yjs types.
        Type some content in the editor, then click the buttons below.
      </p>
      <BlockNoteView editor={editor} />
      <div
        style={{
          marginTop: "10px",
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={handleYTypeToBlocks}
          style={{
            padding: "8px 16px",
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Y.Type → Blocks
        </button>
        <button
          onClick={handleBlocksToYDoc}
          style={{
            padding: "8px 16px",
            background: "#8b5cf6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Blocks → Y.Doc
        </button>
        <button
          onClick={handleBlocksToFragment}
          style={{
            padding: "8px 16px",
            background: "#ec4899",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Blocks → Y.Type Fragment
        </button>
        <button
          onClick={handleRoundTrip}
          style={{
            padding: "8px 16px",
            background: "#10b981",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Round-Trip Test
        </button>
      </div>
      {conversionOutput && (
        <pre
          style={{
            marginTop: "10px",
            padding: "12px",
            background: "#1e293b",
            color: "#e2e8f0",
            borderRadius: "8px",
            fontSize: "12px",
            overflow: "auto",
            maxHeight: "400px",
            whiteSpace: "pre-wrap",
          }}
        >
          {conversionOutput}
        </pre>
      )}
    </div>
  );
}
