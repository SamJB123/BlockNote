import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { AIExtension } from "@blocknote/xl-ai";
import * as Y from "@y/y";
import { Awareness } from "@y/protocols/awareness";
import { useState } from "react";

const doc = new Y.Doc();
const provider = {
  awareness: new Awareness(doc),
};

export function AIDemo() {
  const [status, setStatus] = useState("Ready");

  const editor = useCreateBlockNote({
    collaboration: {
      fragment: doc.get("doc"),
      provider,
      user: { name: "Alice", color: "#3b82f6" },
    },
    extensions: [
      AIExtension({
        agentCursor: {
          name: "AI Assistant",
          color: "#8b5cf6",
        },
      }),
    ],
  });

  const handleTestFork = () => {
    try {
      const aiExt = editor.getExtension("ai" as any);
      if (!aiExt) {
        setStatus("AI extension not found");
        return;
      }

      // Test that the AI extension registered successfully
      setStatus(
        `AI extension loaded successfully.\n` +
          `Extension key: "ai"\n` +
          `Agent cursor: AI Assistant (#8b5cf6)\n\n` +
          `The AI extension integrates with the collaboration system via:\n` +
          `- ForkYDoc: isolates AI edits from remote sync\n` +
          `- Suggestion marks: uses insertion/deletion marks for track changes\n` +
          `- Agent cursor: shows AI cursor position to other users`,
      );
    } catch (e) {
      setStatus(`Error: ${e}`);
    }
  };

  const handleCheckExtensions = () => {
    try {
      const extensions: string[] = [];

      // Check which collaboration extensions are registered
      const ySync = editor.getExtension("ySync" as any);
      if (ySync) extensions.push("ySync (sync plugin)");

      const yCursor = editor.getExtension("yCursor" as any);
      if (yCursor) extensions.push("yCursor (remote cursors)");

      const yUndo = editor.getExtension("yUndo" as any);
      if (yUndo) extensions.push("yUndo (collaborative undo/redo)");

      const yForkDoc = editor.getExtension("yForkDoc" as any);
      if (yForkDoc) extensions.push("yForkDoc (document forking)");

      const ai = editor.getExtension("ai" as any);
      if (ai) extensions.push("ai (AI extension)");

      const collaboration = editor.getExtension("collaboration" as any);
      if (collaboration) extensions.push("collaboration (parent)");

      const history = editor.getExtension("history" as any);
      if (history) extensions.push("history (ProseMirror history)");

      const comments = editor.getExtension("comments" as any);
      if (comments) extensions.push("comments");

      setStatus(
        `Registered extensions (${extensions.length}):\n\n` +
          extensions.map((e) => `  ✓ ${e}`).join("\n") +
          `\n\nNote: When collaboration is enabled, "history" should NOT be present\n` +
          `(it's replaced by yUndo for collaborative undo/redo).`,
      );
    } catch (e) {
      setStatus(`Error: ${e}`);
    }
  };

  const handleCheckSuggestionMarks = () => {
    try {
      const schema = editor.pmSchema;
      const markNames = Object.keys(schema.marks);
      const suggestionMarks = markNames.filter((n) =>
        ["insertion", "deletion", "modification", "comment"].includes(n),
      );
      const allMarks = markNames;

      setStatus(
        `ProseMirror Schema Marks:\n\n` +
          `All marks (${allMarks.length}):\n` +
          allMarks.map((m) => `  - ${m}`).join("\n") +
          `\n\nSuggestion/Collaboration marks:\n` +
          (suggestionMarks.length > 0
            ? suggestionMarks.map((m) => `  ✓ ${m}`).join("\n")
            : "  ✗ None found") +
          `\n\nThese marks are used by both the AI extension (for suggestions)\n` +
          `and the sync plugin's mapAttributionToMark (for track changes).`,
      );
    } catch (e) {
      setStatus(`Error: ${e}`);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>AI Extension + Collaboration Demo</h2>
      <p>
        Tests that the AI extension loads correctly alongside the collaboration
        system. The AI extension uses ForkYDoc to isolate AI edits and
        suggestion marks for track changes.
      </p>
      <p style={{ fontSize: "12px", color: "#6b7280" }}>
        Note: No AI backend is connected. This demo verifies the extension
        integration, not AI functionality.
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
          onClick={handleTestFork}
          style={{
            padding: "8px 16px",
            background: "#8b5cf6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Check AI Extension
        </button>
        <button
          onClick={handleCheckExtensions}
          style={{
            padding: "8px 16px",
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          List All Extensions
        </button>
        <button
          onClick={handleCheckSuggestionMarks}
          style={{
            padding: "8px 16px",
            background: "#10b981",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Check Schema Marks
        </button>
      </div>
      {status && (
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
          {status}
        </pre>
      )}
    </div>
  );
}
