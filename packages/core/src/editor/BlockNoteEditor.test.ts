import { expect, it, vi } from "vitest";
import * as Y from "@y/y";
import { ySyncPluginKey, yUndoPluginKey } from "@y/prosemirror";
import {
  CommentsExtension,
  DefaultThreadStoreAuth,
  YjsThreadStore,
} from "../comments/index.js";

import {
  getBlockInfo,
  getNearestBlockPos,
} from "../api/getBlockInfoFromPos.js";
import { BlockNoteEditor } from "./BlockNoteEditor.js";
import { BlocksChanged } from "../api/getBlocksChangedByTransaction.js";

function setupTwoWaySync(doc1: Y.Doc, doc2: Y.Doc) {
  const sync = (source: Y.Doc, target: Y.Doc) => {
    const update = Y.encodeStateAsUpdate(source);
    Y.applyUpdate(target, update);
  };

  sync(doc1, doc2);
  sync(doc2, doc1);

  const forward = (update: Uint8Array) => {
    Y.applyUpdate(doc2, update);
  };

  const backward = (update: Uint8Array) => {
    Y.applyUpdate(doc1, update);
  };

  doc1.on("update", forward);
  doc2.on("update", backward);

  return () => {
    doc1.off("update", forward);
    doc2.off("update", backward);
  };
}

const createSuggestionAttrs = (prevDoc: Y.Doc, nextDoc: Y.Doc) =>
  Y.createContentMapFromContentIds(
    Y.createContentIdsFromDocDiff(prevDoc, nextDoc),
    [Y.createContentAttribute("insert", ["user-a"])],
  );

const getTextNodesWithMarks = (editor: BlockNoteEditor<any, any, any>) => {
  const nodes: Array<{ text: string; marks: string[] }> = [];
  editor.prosemirrorState.doc.descendants((node) => {
    if (!node.isText) return;
    nodes.push({
      text: node.text || "",
      marks: node.marks.map((mark) => `${mark.type.name}:${JSON.stringify(mark.attrs)}`),
    });
  });
  return nodes;
};

const waitForCollab = async (ticks = 1) => {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const setFirstBlockSelection = (
  editor: BlockNoteEditor<any, any, any>,
  fromOffset: number,
  toOffset: number,
) => {
  editor._tiptapEditor.commands.setTextSelection({
    from: 3 + fromOffset,
    to: 3 + toOffset,
  });
};

/**
 * @vitest-environment jsdom
 */
it("creates an editor", () => {
  const editor = BlockNoteEditor.create();
  const posInfo = editor.transact((tr) => getNearestBlockPos(tr.doc, 2));
  const info = getBlockInfo(posInfo);
  expect(info.blockNoteType).toEqual("paragraph");
});

it("immediately replaces doc", async () => {
  const editor = BlockNoteEditor.create();
  const blocks = await editor.tryParseMarkdownToBlocks(
    "This is a normal text\n\n# And this is a large heading",
  );
  editor.replaceBlocks(editor.document, blocks);
  expect(editor.document).toMatchInlineSnapshot(`
    [
      {
        "children": [],
        "content": [
          {
            "styles": {},
            "text": "This is a normal text",
            "type": "text",
          },
        ],
        "id": "1",
        "props": {
          "backgroundColor": "default",
          "textAlignment": "left",
          "textColor": "default",
        },
        "type": "paragraph",
      },
      {
        "children": [],
        "content": [
          {
            "styles": {},
            "text": "And this is a large heading",
            "type": "text",
          },
        ],
        "id": "2",
        "props": {
          "backgroundColor": "default",
          "isToggleable": false,
          "level": 1,
          "textAlignment": "left",
          "textColor": "default",
        },
        "type": "heading",
      },
    ]
  `);
});

it("adds id attribute when requested", async () => {
  const editor = BlockNoteEditor.create({
    setIdAttribute: true,
  });
  const blocks = await editor.tryParseMarkdownToBlocks(
    "This is a normal text\n\n# And this is a large heading",
  );
  editor.replaceBlocks(editor.document, blocks);
  expect(await editor.blocksToFullHTML(editor.document)).toMatchInlineSnapshot(
    `"<div class="bn-block-group" data-node-type="blockGroup"><div class="bn-block-outer" data-node-type="blockOuter" data-id="1" id="1"><div class="bn-block" data-node-type="blockContainer" data-id="1" id="1"><div class="bn-block-content" data-content-type="paragraph"><p class="bn-inline-content">This is a normal text</p></div></div></div><div class="bn-block-outer" data-node-type="blockOuter" data-id="2" id="2"><div class="bn-block" data-node-type="blockContainer" data-id="2" id="2"><div class="bn-block-content" data-content-type="heading"><h1 class="bn-inline-content">And this is a large heading</h1></div></div></div></div>"`,
  );
});

it("updates block", () => {
  const editor = BlockNoteEditor.create();
  editor.updateBlock(editor.document[0], {
    content: "hello",
  });
});

it("block prop types", () => {
  // this test checks whether the block props are correctly typed in typescript
  const editor = BlockNoteEditor.create();
  const block = editor.document[0];
  if (block.type === "paragraph") {
    // @ts-expect-error
    const level = block.props.level; // doesn't have level prop

    // eslint-disable-next-line
    expect(level).toBe(undefined);
  }

  if (block.type === "heading") {
    const level = block.props.level; // does have level prop

    // eslint-disable-next-line
    expect(level).toBe(1);
  }
});

it("onMount and onUnmount", async () => {
  const editor = BlockNoteEditor.create();
  let mounted = false;
  let unmounted = false;
  editor.onMount(() => {
    mounted = true;
  });
  editor.onUnmount(() => {
    unmounted = true;
  });
  editor.mount(document.createElement("div"));
  expect(mounted).toBe(true);
  expect(unmounted).toBe(false);
  editor.unmount();
  // expect the unmount event to not have been triggered yet, since it waits 2 ticks
  // expect(unmounted).toBe(false);
  // wait 3 ticks to ensure the unmount event is triggered
  await new Promise((resolve) => setTimeout(resolve, 3));
  expect(mounted).toBe(true);
  expect(unmounted).toBe(true);
});

it("sets an initial block id when using Y.js", async () => {
  const doc = new Y.Doc();
  const fragment = doc.get("doc");
  let transactionCount = 0;
  const editor = BlockNoteEditor.create({
    collaboration: {
      fragment,
      user: { name: "Hello", color: "#FFFFFF" },
    },
    _tiptapOptions: {
      onTransaction: () => {
        transactionCount++;
      },
    },
  });

  editor.mount(document.createElement("div"));

  expect(editor.prosemirrorState.doc.toJSON()).toMatchInlineSnapshot(`
    {
      "content": [
        {
          "content": [
            {
              "attrs": {
                "id": "initialBlockId",
              },
              "content": [
                {
                  "attrs": {
                    "backgroundColor": "default",
                    "textAlignment": "left",
                    "textColor": "default",
                  },
                  "type": "paragraph",
                },
              ],
              "type": "blockContainer",
            },
          ],
          "type": "blockGroup",
        },
      ],
      "type": "doc",
    }
  `);
  expect(transactionCount).toBe(1);
  // The fragment should not be modified yet, since the editor's content is only the initial content
  expect(fragment.toJSON()).toMatchInlineSnapshot(`{}`);

  editor.replaceBlocks(editor.document, [
    {
      type: "paragraph",
      content: [{ text: "Hello", styles: {}, type: "text" }],
    },
  ]);
  expect(transactionCount).toBe(2);
  // Only after a real modification is made, will the fragment be updated
  expect(fragment.toJSON()).toMatchInlineSnapshot(
    `
      {
        "children": [
          {
            "children": [
              {
                "attrs": {
                  "id": "0",
                },
                "children": [
                  {
                    "attrs": {
                      "backgroundColor": "default",
                      "textAlignment": "left",
                      "textColor": "default",
                    },
                    "children": [
                      "Hello",
                    ],
                    "name": "paragraph",
                  },
                ],
                "name": "blockContainer",
              },
              {
                "attrs": {
                  "id": "1",
                },
                "children": [
                  {
                    "attrs": {
                      "backgroundColor": "default",
                      "textAlignment": "left",
                      "textColor": "default",
                    },
                    "name": "paragraph",
                  },
                ],
                "name": "blockContainer",
              },
            ],
            "name": "blockGroup",
          },
        ],
      }
    `,
  );
});

it("onBeforeChange", () => {
  const editor = BlockNoteEditor.create();
  let beforeChangeCalled = false;
  let changes: BlocksChanged<any, any, any> = [];
  editor.onBeforeChange(({ getChanges }) => {
    beforeChangeCalled = true;
    changes = getChanges();
    return true;
  });
  editor.mount(document.createElement("div"));
  editor.replaceBlocks(editor.document, [
    {
      type: "paragraph",
      content: [{ text: "Hello", styles: {}, type: "text" }],
    },
  ]);
  expect(beforeChangeCalled).toBe(true);
  expect(changes).toMatchInlineSnapshot(`
    [
      {
        "block": {
          "children": [],
          "content": [],
          "id": "3",
          "props": {
            "backgroundColor": "default",
            "textAlignment": "left",
            "textColor": "default",
          },
          "type": "paragraph",
        },
        "prevBlock": undefined,
        "source": {
          "type": "local",
        },
        "type": "insert",
      },
      {
        "block": {
          "children": [],
          "content": [],
          "id": "2",
          "props": {
            "backgroundColor": "default",
            "textAlignment": "left",
            "textColor": "default",
          },
          "type": "paragraph",
        },
        "prevBlock": undefined,
        "source": {
          "type": "local",
        },
        "type": "delete",
      },
    ]
  `);
});

it("tracks undo operations when using Y.js collaboration", () => {
  const doc = new Y.Doc();
  const fragment = doc.get("doc");
  const editor = BlockNoteEditor.create({
    collaboration: {
      fragment,
      user: { name: "Hello", color: "#FFFFFF" },
    },
  });

  editor.mount(document.createElement("div"));
  editor.replaceBlocks(editor.document, [
    {
      type: "paragraph",
      content: [{ text: "Hello", styles: {}, type: "text" }],
    },
  ]);

  const undoState = yUndoPluginKey.getState(editor.prosemirrorState);

  expect(undoState?.undoManager?.undoStack.length).toBeGreaterThan(0);
  expect(editor.undo()).toBe(true);
});

it("tracks undo operations for interactive text insertion when using Y.js collaboration", () => {
  const doc = new Y.Doc();
  const fragment = doc.get("doc");
  const editor = BlockNoteEditor.create({
    collaboration: {
      fragment,
      user: { name: "Hello", color: "#FFFFFF" },
    },
  });

  editor.mount(document.createElement("div"));
  editor.setTextCursorPosition(editor.document[0], "start");
  editor.insertInlineContent("Hello");

  const undoState = yUndoPluginKey.getState(editor.prosemirrorState);

  expect(undoState?.undoManager?.scope[0]).toBe(fragment);
  expect(undoState?.undoManager?.undoStack.length).toBeGreaterThan(0);
  expect(editor.undo()).toBe(true);
});

it("tracks undo operations when collaboration uses a nested Y.js fragment", () => {
  const doc = new Y.Doc();
  const notes = doc.get("notes");
  const fragment = new Y.Type();
  notes.setAttr("note-1", fragment);

  const editor = BlockNoteEditor.create({
    collaboration: {
      fragment,
      user: { name: "Hello", color: "#FFFFFF" },
    },
  });

  editor.mount(document.createElement("div"));
  editor.setTextCursorPosition(editor.document[0], "start");
  editor.insertInlineContent("Hello");

  const undoState = yUndoPluginKey.getState(editor.prosemirrorState);

  expect(undoState?.undoManager?.undoStack.length).toBeGreaterThan(0);
  expect(editor.undo()).toBe(true);
});

it("undo from one user preserves remote edits to existing blocks from another user", async () => {
  const ydocA = new Y.Doc();
  const ydocB = new Y.Doc();
  const cleanupSync = setupTwoWaySync(ydocA, ydocB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: ydocA.get("doc"),
      user: { name: "A", color: "#FFFFFF" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: ydocB.get("doc"),
      user: { name: "B", color: "#000000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));

  editorA.replaceBlocks(editorA.document, [
    { type: "paragraph", content: "1" },
    { type: "paragraph", content: "2" },
    { type: "paragraph", content: "3" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  const firstBlockId = editorA.document[0].id;
  const secondBlockId = editorA.document[1].id;
  const thirdBlockId = editorA.document[2].id;

  editorA.updateBlock(firstBlockId, {
    content: "A1",
  });
  editorA.updateBlock(thirdBlockId, {
    content: "A3",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  editorB.updateBlock(secondBlockId, {
    content: "B2",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  editorA.undo();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const contentA = editorA.document.map((b) => JSON.stringify(b.content));
  const contentB = editorB.document.map((b) => JSON.stringify(b.content));

  expect(contentA).toEqual([
    '[{"type":"text","text":"1","styles":{}}]',
    '[{"type":"text","text":"B2","styles":{}}]',
    '[{"type":"text","text":"3","styles":{}}]',
    "[]",
  ]);
  expect(contentB).toEqual([
    '[{"type":"text","text":"1","styles":{}}]',
    '[{"type":"text","text":"B2","styles":{}}]',
    '[{"type":"text","text":"3","styles":{}}]',
    "[]",
  ]);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  editorA.unmount();
  editorB.unmount();
  await new Promise((resolve) => setTimeout(resolve, 10));
  cleanupSync();
  ydocA.destroy();
  ydocB.destroy();
});

it("undo preserves the full deletion when typing into the final block with a synced peer", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));

  mainEditorA.replaceBlocks(mainEditorA.document, [
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(mainEditorB.prosemirrorState)?.undoManager?.clear();

  const typeIntoBlock = async (
    editor: BlockNoteEditor<any, any, any>,
    blockIndex: number,
    text: string,
  ) => {
    editor.setTextCursorPosition(editor.document[blockIndex], "start");
    for (const ch of text) {
      editor.insertInlineContent(ch);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager?.stopCapturing();
  };

  await typeIntoBlock(mainEditorA, 0, "asdfasdfasdfadsfa");
  await typeIntoBlock(mainEditorB, 1, "123123123123");
  await typeIntoBlock(mainEditorA, 2, "asdfasdfasdf");
  await typeIntoBlock(mainEditorB, 3, "123123123123");
  await typeIntoBlock(mainEditorA, 4, "asdfadsdfasdf");

  mainEditorA.undo();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(getTextNodesWithMarks(mainEditorA)).toEqual([
    { text: "asdfasdfasdfadsfa", marks: [] },
    { text: "123123123123", marks: [] },
    { text: "asdfasdfasdf", marks: [] },
    { text: "123123123123", marks: [] },
  ]);
  expect(getTextNodesWithMarks(mainEditorB)).toEqual([
    { text: "asdfasdfasdfadsfa", marks: [] },
    { text: "123123123123", marks: [] },
    { text: "asdfasdfasdf", marks: [] },
    { text: "123123123123", marks: [] },
  ]);
});

it("captures the first typed character when undoing the final block locally", async () => {
  const doc = new Y.Doc();

  const editor = BlockNoteEditor.create({
    collaboration: {
      fragment: doc.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });

  editor.mount(document.createElement("div"));
  editor.replaceBlocks(editor.document, [
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager?.clear();

  editor.setTextCursorPosition(editor.document[4], "start");
  const undoStackSnapshots: number[] = [];
  for (const ch of "asdfadsdfasdf") {
    editor.insertInlineContent(ch);
    await new Promise((resolve) => setTimeout(resolve, 0));
    undoStackSnapshots.push(
      yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager?.undoStack.length ?? -1,
    );
  }
  yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager?.stopCapturing();

  const undoStackBeforeUndo =
    yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager?.undoStack.length;
  editor.undo();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(undoStackSnapshots[0]).toBe(1);
  expect(undoStackBeforeUndo).toBe(1);
  expect(getTextNodesWithMarks(editor)).toEqual([]);
});

it("diagnoses suggestion doc state after undo", async () => {
  const mainDoc = new Y.Doc();
  const suggestionDoc = new Y.Doc({ isSuggestionDoc: true });
  const attributionManager = Y.createAttributionManagerFromDiff(
    mainDoc,
    suggestionDoc,
    {
      attrs: createSuggestionAttrs(mainDoc, suggestionDoc),
    },
  );
  attributionManager.suggestionMode = true;

  const mainEditor = BlockNoteEditor.create({
    collaboration: {
      fragment: mainDoc.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const suggestionEditor = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDoc.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager,
    },
  });

  mainEditor.mount(document.createElement("div"));
  suggestionEditor.mount(document.createElement("div"));

  mainEditor.replaceBlocks(mainEditor.document, [
    { type: "paragraph", content: "ASDASDASDASDASD" },
    { type: "paragraph", content: "123123123123123123" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(mainEditor.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditor.prosemirrorState)?.undoManager?.clear();

  const firstBlockId = mainEditor.document[0].id;
  mainEditor.updateBlock(firstBlockId, {
    content: "ASDASDASDASDASD\nA",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  mainEditor.undo();
  await new Promise((resolve) => setTimeout(resolve, 0));

});

it("diagnoses cross-client suggestion docs after undo", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  const attributionManagerA = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(docA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    docB,
    suggestionDocB,
    { attrs: createSuggestionAttrs(docB, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  mainEditorA.replaceBlocks(mainEditorA.document, [
    { type: "paragraph", content: "asdfasdfasdfadsfa" },
    { type: "paragraph", content: "123123123123" },
    { type: "paragraph", content: "asdfasdfasdf" },
    { type: "paragraph", content: "123123123123" },
    { type: "paragraph", content: "asdfadsdfasdf" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(mainEditorB.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorB.prosemirrorState)?.undoManager?.clear();

  const lastBlockIdA = mainEditorA.document[4].id;
  mainEditorA.updateBlock(lastBlockIdA, {
    content: "ASDASDASDASDASD",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  mainEditorB.updateBlock(mainEditorB.document[1].id, {
    content: "123123123123123123",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  mainEditorA.undo();
  await new Promise((resolve) => setTimeout(resolve, 0));

});

it("undo removes the full final line in suggestion-mode collaboration views", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  const attributionManagerA = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(docA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    docB,
    suggestionDocB,
    { attrs: createSuggestionAttrs(docB, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  mainEditorA.replaceBlocks(mainEditorA.document, [
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(mainEditorB.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorB.prosemirrorState)?.undoManager?.clear();

  const typeIntoBlock = async (
    editor: BlockNoteEditor<any, any, any>,
    blockIndex: number,
    text: string,
  ) => {
    editor.setTextCursorPosition(editor.document[blockIndex], "start");
    for (const ch of text) {
      editor.insertInlineContent(ch);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager?.stopCapturing();
  };

  await typeIntoBlock(mainEditorA, 0, "asdfasdfasdfadsfa");
  await typeIntoBlock(mainEditorB, 1, "123123123123");
  await typeIntoBlock(mainEditorA, 2, "asdfasdfasdf");
  await typeIntoBlock(mainEditorB, 3, "123123123123");
  await typeIntoBlock(mainEditorA, 4, "asdfadsdfasdf");

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.stopCapturing();
  mainEditorA.undo();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(getTextNodesWithMarks(mainEditorA)).toEqual([
    { text: "asdfasdfasdfadsfa", marks: [] },
    { text: "123123123123", marks: [] },
    { text: "asdfasdfasdf", marks: [] },
    { text: "123123123123", marks: [] },
  ]);
  expect(getTextNodesWithMarks(mainEditorB)).toEqual([
    { text: "asdfasdfasdfadsfa", marks: [] },
    { text: "123123123123", marks: [] },
    { text: "asdfasdfasdf", marks: [] },
    { text: "123123123123", marks: [] },
  ]);
  expect(getTextNodesWithMarks(suggestionEditorA)).toEqual([
    { text: "asdfasdfasdfadsfa", marks: [] },
    { text: "123123123123", marks: [] },
    { text: "asdfasdfasdf", marks: [] },
    { text: "123123123123", marks: [] },
  ]);
  expect(getTextNodesWithMarks(suggestionEditorB)).toEqual([
    { text: "asdfasdfasdfadsfa", marks: [] },
    { text: "123123123123", marks: [] },
    { text: "asdfasdfasdf", marks: [] },
    { text: "123123123123", marks: [] },
  ]);
});

it("undoes the local first line without corrupting the remote second line", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));

  editorA.replaceBlocks(editorA.document, [
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  const typeIntoBlock = async (
    editor: BlockNoteEditor<any, any, any>,
    blockIndex: number,
    text: string,
  ) => {
    editor.setTextCursorPosition(editor.document[blockIndex], "start");
    for (const ch of text) {
      editor.insertInlineContent(ch);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager?.stopCapturing();
  };

  await typeIntoBlock(editorA, 0, "123123123");
  await typeIntoBlock(editorB, 1, "asdasdasdasd");

  expect(() => editorA.undo()).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(getTextNodesWithMarks(editorA)).toEqual([
    { text: "asdasdasdasd", marks: [] },
  ]);
  expect(getTextNodesWithMarks(editorB)).toEqual([
    { text: "asdasdasdasd", marks: [] },
  ]);
});

it("undoes the local first line without corrupting remote text in suggestion mode", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  const attributionManagerA = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(docA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    docB,
    suggestionDocB,
    { attrs: createSuggestionAttrs(docB, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  mainEditorA.replaceBlocks(mainEditorA.document, [
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(mainEditorB.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorB.prosemirrorState)?.undoManager?.clear();

  const typeIntoBlock = async (
    editor: BlockNoteEditor<any, any, any>,
    blockIndex: number,
    text: string,
  ) => {
    editor.setTextCursorPosition(editor.document[blockIndex], "start");
    for (const ch of text) {
      editor.insertInlineContent(ch);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager?.stopCapturing();
  };

  await typeIntoBlock(mainEditorA, 0, "123123123");
  await typeIntoBlock(mainEditorB, 1, "asdasdasdasd");

  expect(() => mainEditorA.undo()).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(getTextNodesWithMarks(mainEditorA)).toEqual([
    { text: "asdasdasdasd", marks: [] },
  ]);
  expect(getTextNodesWithMarks(mainEditorB)).toEqual([
    { text: "asdasdasdasd", marks: [] },
  ]);
  expect(getTextNodesWithMarks(suggestionEditorA)).toEqual([
    { text: "asdasdasdasd", marks: [] },
  ]);
  expect(getTextNodesWithMarks(suggestionEditorB)).toEqual([
    { text: "asdasdasdasd", marks: [] },
  ]);
});

it("undoes first-paragraph text without crashing in suggestion mode", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  const attributionManagerA = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(docA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    docB,
    suggestionDocB,
    { attrs: createSuggestionAttrs(docB, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  mainEditorA.replaceBlocks(mainEditorA.document, [
    { type: "paragraph", content: "" },
    { type: "paragraph", content: "" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(mainEditorB.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorB.prosemirrorState)?.undoManager?.clear();

  const typeIntoBlock = async (
    editor: BlockNoteEditor<any, any, any>,
    blockIndex: number,
    text: string,
  ) => {
    editor.setTextCursorPosition(editor.document[blockIndex], "start");
    for (const ch of text) {
      editor.insertInlineContent(ch);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager?.stopCapturing();
  };

  await typeIntoBlock(mainEditorA, 0, "123123123");
  await typeIntoBlock(mainEditorB, 1, "asdasdasdasd");

  expect(() => mainEditorA.undo()).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(getTextNodesWithMarks(mainEditorA)).toEqual([
    { text: "asdasdasdasd", marks: [] },
  ]);
  expect(getTextNodesWithMarks(suggestionEditorA)).toEqual([
    { text: "asdasdasdasd", marks: [] },
  ]);
});

it("undoes the first edit in the initial paragraph without crashing", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  const attributionManagerA = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(docA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    docB,
    suggestionDocB,
    { attrs: createSuggestionAttrs(docB, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(mainEditorB.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorB.prosemirrorState)?.undoManager?.clear();

  const typeIntoBlock = async (
    editor: BlockNoteEditor<any, any, any>,
    blockIndex: number,
    text: string,
  ) => {
    editor.setTextCursorPosition(editor.document[blockIndex], "start");
    for (const ch of text) {
      editor.insertInlineContent(ch);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager?.stopCapturing();
  };

  await typeIntoBlock(mainEditorA, 0, "123123123");
  expect(() => mainEditorA.undo()).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(getTextNodesWithMarks(mainEditorA)).toEqual([]);
  expect(getTextNodesWithMarks(mainEditorB)).toEqual([]);
  expect(getTextNodesWithMarks(suggestionEditorA)).toEqual([]);
  expect(getTextNodesWithMarks(suggestionEditorB)).toEqual([]);
});

it("undoes the first edit in the initial paragraph with comments extensions mounted", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  const attributionManagerA = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(docA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    docB,
    suggestionDocB,
    { attrs: createSuggestionAttrs(docB, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const resolveUsers = async (userIds: string[]) =>
    userIds.map((id) => ({ id, username: id, avatarUrl: "" }));

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
    extensions: [
      CommentsExtension({
        threadStore: new YjsThreadStore(
          "alice",
          docA.get("threads"),
          new DefaultThreadStoreAuth("alice", "editor"),
        ),
        resolveUsers,
      }),
    ],
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
    extensions: [
      CommentsExtension({
        threadStore: new YjsThreadStore(
          "bob",
          docB.get("threads"),
          new DefaultThreadStoreAuth("bob", "editor"),
        ),
        resolveUsers,
      }),
    ],
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
    extensions: [
      CommentsExtension({
        threadStore: new YjsThreadStore(
          "alice",
          suggestionDocA.get("threads"),
          new DefaultThreadStoreAuth("alice", "editor"),
        ),
        resolveUsers,
      }),
    ],
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
    extensions: [
      CommentsExtension({
        threadStore: new YjsThreadStore(
          "bob",
          suggestionDocB.get("threads"),
          new DefaultThreadStoreAuth("bob", "editor"),
        ),
        resolveUsers,
      }),
    ],
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(mainEditorB.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorB.prosemirrorState)?.undoManager?.clear();

  mainEditorA.setTextCursorPosition(mainEditorA.document[0], "start");
  for (const ch of "123123123") {
    mainEditorA.insertInlineContent(ch);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.stopCapturing();

  expect(() => mainEditorA.undo()).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(getTextNodesWithMarks(mainEditorA)).toEqual([]);
  expect(getTextNodesWithMarks(mainEditorB)).toEqual([]);
  expect(getTextNodesWithMarks(suggestionEditorA)).toEqual([]);
  expect(getTextNodesWithMarks(suggestionEditorB)).toEqual([]);
});

it("syncs heading formatting on a blank paragraph in suggestion mode", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  const attributionManagerA = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(docA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    docB,
    suggestionDocB,
    { attrs: createSuggestionAttrs(docB, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  await new Promise((resolve) => setTimeout(resolve, 0));

  const firstBlockId = mainEditorA.document[0].id;
  expect(() =>
    mainEditorA.updateBlock(firstBlockId, {
      type: "heading",
      props: { level: 1 },
    } as any),
  ).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mainEditorA.document[0].type).toBe("heading");
  expect(mainEditorB.document[0].type).toBe("heading");
  expect(suggestionEditorA.document[0].type).toBe("heading");
  expect(suggestionEditorB.document[0].type).toBe("heading");
});

it("does not throw during remote hydration when formatting a blank paragraph", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  setupTwoWaySync(suggestionDocA, suggestionDocB);

  const attributionManagerA = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(docA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocB,
    { attrs: createSuggestionAttrs(docA, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  await new Promise((resolve) => setTimeout(resolve, 0));

  let listener: ((error: Error) => void) | undefined;
  const errorPromise = new Promise<Error>((resolve) => {
    listener = resolve;
    process.prependOnceListener("uncaughtException", listener);
  });

  mainEditorA.updateBlock(mainEditorA.document[0].id, {
    type: "heading",
    props: { level: 1 },
  } as any);

  const result = await Promise.race([
    errorPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 750)),
  ]);

  if (listener) {
    process.removeListener("uncaughtException", listener);
  }

  expect(result).toBeNull();
  expect(mainEditorB.document[0].type).toBe("heading");
  expect(suggestionEditorA.document[0].type).toBe("heading");
  expect(suggestionEditorB.document[0].type).toBe("heading");
});

it("continues syncing text after structural formatting in suggestion mode", async () => {
  const captureFailure = async (run: () => void) => {
    let listener: ((error: Error) => void) | undefined;
    const errorPromise = new Promise<Error>((resolve) => {
      listener = resolve;
      process.prependOnceListener("uncaughtException", listener);
    });
    let syncError: Error | null = null;
    try {
      run();
    } catch (error) {
      syncError = error as Error;
    }
    if (syncError) {
      if (listener) {
        process.removeListener("uncaughtException", listener);
      }
      return syncError;
    }
    const result = await Promise.race([
      errorPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    if (listener) {
      process.removeListener("uncaughtException", listener);
    }
    return result;
  };

  const setupScenario = async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    setupTwoWaySync(docA, docB);

    const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
    const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
    setupTwoWaySync(suggestionDocA, suggestionDocB);
    const attributionManagerA = Y.createAttributionManagerFromDiff(
      docA,
      suggestionDocA,
      { attrs: createSuggestionAttrs(docA, suggestionDocA) },
    );
    const attributionManagerB = Y.createAttributionManagerFromDiff(
      docA,
      suggestionDocB,
      { attrs: createSuggestionAttrs(docA, suggestionDocB) },
    );
    attributionManagerA.suggestionMode = true;
    attributionManagerB.suggestionMode = true;

    const mainEditorA = BlockNoteEditor.create({
      collaboration: {
        fragment: docA.get("doc"),
        user: { name: "A", color: "#fff" },
      },
    });
    const mainEditorB = BlockNoteEditor.create({
      collaboration: {
        fragment: docB.get("doc"),
        user: { name: "B", color: "#000" },
      },
    });
    const suggestionEditorA = BlockNoteEditor.create({
      collaboration: {
        fragment: suggestionDocA.get("doc"),
        user: { name: "A", color: "#fff" },
        attributionManager: attributionManagerA,
      },
    });
    const suggestionEditorB = BlockNoteEditor.create({
      collaboration: {
        fragment: suggestionDocB.get("doc"),
        user: { name: "B", color: "#000" },
        attributionManager: attributionManagerB,
      },
    });

    mainEditorA.mount(document.createElement("div"));
    mainEditorB.mount(document.createElement("div"));
    suggestionEditorA.mount(document.createElement("div"));
    suggestionEditorB.mount(document.createElement("div"));

    await new Promise((resolve) => setTimeout(resolve, 0));

    return {
      mainEditorA,
      mainEditorB,
      suggestionEditorA,
      suggestionEditorB,
    };
  };

  const runScenario = async (setupAction: (ctx: Awaited<ReturnType<typeof setupScenario>>) => void, followUp: (ctx: Awaited<ReturnType<typeof setupScenario>>) => void) => {
    const ctx = await setupScenario();
    setupAction(ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return captureFailure(() => followUp(ctx));
  };

  const followUpResults = {
    headingThenMainAText: await runScenario(
      ({ mainEditorA }) => {
        mainEditorA.updateBlock(mainEditorA.document[0].id, {
          type: "heading",
          props: { level: 1 },
        } as any);
      },
      ({ mainEditorA }) => {
        mainEditorA.setTextCursorPosition(mainEditorA.document[0], "start");
        mainEditorA.insertInlineContent("x");
      },
    ),
    headingThenMainBText: await runScenario(
      ({ mainEditorA }) => {
        mainEditorA.updateBlock(mainEditorA.document[0].id, {
          type: "heading",
          props: { level: 1 },
        } as any);
      },
      ({ mainEditorB }) => {
        mainEditorB.setTextCursorPosition(mainEditorB.document[0], "start");
        mainEditorB.insertInlineContent("y");
      },
    ),
    bulletThenMainBText: await runScenario(
      ({ mainEditorA }) => {
        mainEditorA.updateBlock(mainEditorA.document[0].id, {
          type: "bulletListItem",
        } as any);
      },
      ({ mainEditorB }) => {
        mainEditorB.setTextCursorPosition(mainEditorB.document[0], "start");
        mainEditorB.insertInlineContent("y");
      },
    ),
  };

  expect(followUpResults.headingThenMainAText).toBeNull();
  expect(followUpResults.headingThenMainBText).toBeNull();
  expect(followUpResults.bulletThenMainBText).toBeNull();
});

it("does not throw when formatting a non-empty paragraph in collaboration demo topology", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  setupTwoWaySync(suggestionDocA, suggestionDocB);

  const attributionManagerA = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(docA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocB,
    { attrs: createSuggestionAttrs(docA, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  await new Promise((resolve) => setTimeout(resolve, 0));

  mainEditorA.updateBlock(mainEditorA.document[0].id, {
    content: "hello world",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  let listener: ((error: Error) => void) | undefined;
  const errorPromise = new Promise<Error>((resolve) => {
    listener = resolve;
    process.prependOnceListener("uncaughtException", listener);
  });

  mainEditorA.transact(() => {
    mainEditorA.updateBlock(mainEditorA.document[0].id, {
      type: "heading",
      props: { level: 1 },
    } as any);
  });

  const result = await Promise.race([
    errorPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
  ]);

  if (listener) {
    process.removeListener("uncaughtException", listener);
  }

  expect(result).toBeNull();
  expect(mainEditorB.document[0].type).toBe("heading");
  expect(suggestionEditorA.document[0].type).toBe("heading");
  expect(suggestionEditorB.document[0].type).toBe("heading");
});

it("does not create extra remote lines or crash after typing into a formatted block", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  setupTwoWaySync(suggestionDocA, suggestionDocB);

  const attributionManagerA = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(docA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    docA,
    suggestionDocB,
    { attrs: createSuggestionAttrs(docA, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainBTransactions: Array<Record<string, unknown>> = [];
  const suggestionATransactions: Array<Record<string, unknown>> = [];
  const suggestionBTransactions: Array<Record<string, unknown>> = [];

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
    _tiptapOptions: {
      onTransaction: ({ transaction, editor }) => {
        mainBTransactions.push({
          docChanged: transaction.docChanged,
          steps: transaction.steps.map((step) => step.constructor.name),
          addToHistory: transaction.getMeta("addToHistory"),
          ySyncType: transaction.getMeta(ySyncPluginKey)?.type ?? null,
          ySyncHydration: Boolean(transaction.getMeta("y-sync-hydration")),
          uniqueID: Boolean(transaction.getMeta("uniqueID")),
          appended: Boolean(transaction.getMeta("appendedTransaction")),
          length: editor.state.doc.firstChild?.childCount,
          doc: editor.state.doc.toJSON(),
        });
      },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
    _tiptapOptions: {
      onTransaction: ({ transaction, editor }) => {
        suggestionATransactions.push({
          docChanged: transaction.docChanged,
          steps: transaction.steps.map((step) => step.constructor.name),
          addToHistory: transaction.getMeta("addToHistory"),
          ySyncType: transaction.getMeta(ySyncPluginKey)?.type ?? null,
          ySyncHydration: Boolean(transaction.getMeta("y-sync-hydration")),
          uniqueID: Boolean(transaction.getMeta("uniqueID")),
          appended: Boolean(transaction.getMeta("appendedTransaction")),
          length: editor.state.doc.firstChild?.childCount,
        });
      },
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
    _tiptapOptions: {
      onTransaction: ({ transaction, editor }) => {
        suggestionBTransactions.push({
          docChanged: transaction.docChanged,
          steps: transaction.steps.map((step) => step.constructor.name),
          addToHistory: transaction.getMeta("addToHistory"),
          ySyncType: transaction.getMeta(ySyncPluginKey)?.type ?? null,
          ySyncHydration: Boolean(transaction.getMeta("y-sync-hydration")),
          uniqueID: Boolean(transaction.getMeta("uniqueID")),
          appended: Boolean(transaction.getMeta("appendedTransaction")),
          length: editor.state.doc.firstChild?.childCount,
        });
      },
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  await new Promise((resolve) => setTimeout(resolve, 0));

  mainEditorA.updateBlock(mainEditorA.document[0].id, {
    content: "hello world",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  mainEditorA.transact(() => {
    mainEditorA.updateBlock(mainEditorA.document[0].id, {
      type: "heading",
      props: { level: 1 },
    } as any);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(mainEditorA.document.length).toBe(2);
  expect(mainEditorB.document.length).toBe(2);
  expect(suggestionEditorA.document.length).toBe(2);
  expect(suggestionEditorB.document.length).toBe(2);

  let listener: ((error: Error) => void) | undefined;
  const errorPromise = new Promise<Error>((resolve) => {
    listener = resolve;
    process.prependOnceListener("uncaughtException", listener);
  });

  mainEditorB.setTextCursorPosition(mainEditorB.document[0], "end");
  mainEditorB.insertInlineContent("!");

  const result = await Promise.race([
    errorPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
  ]);

  if (listener) {
    process.removeListener("uncaughtException", listener);
  }

  expect(result).toBeNull();
  expect(mainEditorA.document[0].content).toEqual(mainEditorB.document[0].content);
});

it("does not leave a residual remote heading clone after undoing a heading change", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));

  editorA.replaceBlocks(editorA.document, [
    { type: "paragraph", content: "Hello world" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA.updateBlock(editorA.document[0].id, {
    type: "heading",
    props: { level: 1 },
  } as any);
  await new Promise((resolve) => setTimeout(resolve, 0));

  editorA.undo();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(editorA.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(editorB.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(editorA.document.map((b) => JSON.stringify(b.content))).toEqual([
    '[{"type":"text","text":"Hello world","styles":{}}]',
    "[]",
  ]);
  expect(editorB.document.map((b) => JSON.stringify(b.content))).toEqual([
    '[{"type":"text","text":"Hello world","styles":{}}]',
    "[]",
  ]);
});

it("undoes typed numbered list content without crashing a synced peer", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));

  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA.updateBlock(editorA.document[0].id, {
    type: "numberedListItem",
  } as any);
  await new Promise((resolve) => setTimeout(resolve, 0));

  editorA.setTextCursorPosition(editorA.document[0], "end");
  editorA.insertInlineContent("123");
  await new Promise((resolve) => setTimeout(resolve, 0));

  let thrown: unknown = null;
  try {
    editorA.undo();
  } catch (error) {
    thrown = error;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(thrown).toBeNull();
  expect(editorA.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(editorB.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(editorA.document.map((b) => b.id)).toEqual(["initialBlockId", "0"]);
  expect(editorB.document.map((b) => b.id)).toEqual(["initialBlockId", "0"]);
  expect(editorA.document.map((b) => JSON.stringify(b.content))).toEqual(["[]", "[]"]);
  expect(editorB.document.map((b) => JSON.stringify(b.content))).toEqual(["[]", "[]"]);
});

it("can undo numbered list creation after undoing its text without crashing locally", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));

  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA.updateBlock(editorA.document[0].id, {
    type: "numberedListItem",
  } as any);
  await new Promise((resolve) => setTimeout(resolve, 0));

  editorA.setTextCursorPosition(editorA.document[0], "end");
  editorA.insertInlineContent("123");
  await new Promise((resolve) => setTimeout(resolve, 0));

  editorA.undo();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  let thrown: unknown = null;
  try {
    editorA.undo();
  } catch (error) {
    thrown = error;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(thrown).toBeNull();
  expect(editorA.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(editorB.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(editorA.document.map((b) => JSON.stringify(b.content))).toEqual(["[]", "[]"]);
  expect(editorB.document.map((b) => JSON.stringify(b.content))).toEqual(["[]", "[]"]);
});

it("can undo two separately typed words in collaboration without restoring a selection on blockContainer", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));

  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA.setTextCursorPosition(editorA.document[0], "end");
  editorA.insertInlineContent("word");
  await new Promise((resolve) => setTimeout(resolve, 600));

  editorA.insertInlineContent(" ");
  editorA.insertInlineContent("word");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  let thrown: unknown = null;
  try {
    editorA.undo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    editorA.undo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeNull();
  expect(warnSpy).not.toHaveBeenCalledWith(
    expect.stringContaining(
      "TextSelection endpoint not pointing into a node with inline content",
    ),
  );
  expect(editorA.document.map((b) => JSON.stringify(b.content))).toEqual(["[]", "[]"]);
  expect(editorB.document.map((b) => JSON.stringify(b.content))).toEqual(["[]", "[]"]);
  warnSpy.mockRestore();
});

it("can undo bold formatting in collaboration without crashing a synced peer", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));

  editorA.replaceBlocks(editorA.document, [
    { type: "paragraph", content: "hello world" },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA._tiptapEditor.commands.setTextSelection({ from: 2, to: 13 });
  editorA.toggleStyles({ bold: true } as any);
  await new Promise((resolve) => setTimeout(resolve, 0));

  let listener: ((error: Error) => void) | undefined;
  const errorPromise = new Promise<Error>((resolve) => {
    listener = resolve;
    process.prependOnceListener("uncaughtException", listener);
  });

  editorA.undo();

  const result = await Promise.race([
    errorPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
  ]);

  if (listener) {
    process.removeListener("uncaughtException", listener);
  }

  expect(result).toBeNull();
  expect(getTextNodesWithMarks(editorA)).toEqual([
    { text: "hello world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(editorB)).toEqual([
    { text: "hello world", marks: [] },
  ]);
});

it("can undo partial-word bold formatting and continue typing at the mark boundary", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [
    { type: "paragraph", content: "hello world" },
  ]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 1, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorA.undo();
  await waitForCollab(2);

  editorA._tiptapEditor.commands.setTextSelection({ from: 8, to: 8 });
  editorA.insertInlineContent("!");
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([
    { text: "hello! world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(editorB)).toEqual([
    { text: "hello! world", marks: [] },
  ]);
});

it("can undo mixed bold and italic formatting without leaving remote mark fragments", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [
    { type: "paragraph", content: "hello world" },
  ]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  setFirstBlockSelection(editorA, 3, 8);
  editorA.toggleStyles({ italic: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorA.undo();
  await waitForCollab(2);
  editorA.undo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([
    { text: "hello world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(editorB)).toEqual([
    { text: "hello world", marks: [] },
  ]);
});

it("can undo bold inside a heading and then undo the heading change across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [
    { type: "paragraph", content: "hello world" },
  ]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA.updateBlock(editorA.document[0].id, {
    type: "heading",
    props: { level: 1 },
  } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorA.undo();
  await waitForCollab(2);
  editorA.undo();
  await waitForCollab(2);

  expect(editorA.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(editorB.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(getTextNodesWithMarks(editorA)).toEqual([
    { text: "hello world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(editorB)).toEqual([
    { text: "hello world", marks: [] },
  ]);
});

it("can undo bold inside a numbered list and then undo the list creation across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA.updateBlock(editorA.document[0].id, {
    type: "numberedListItem",
    content: "hello world",
  } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorA.undo();
  await waitForCollab(2);
  editorA.undo();
  await waitForCollab(2);

  expect(editorA.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(editorB.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(getTextNodesWithMarks(editorA)).toEqual([]);
  expect(getTextNodesWithMarks(editorB)).toEqual([]);
});

it("keeps same-block cross-user edits stable when one user undoes bold formatting", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: {
      fragment: docA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: {
      fragment: docB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [
    { type: "paragraph", content: "hello world" },
  ]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorB._tiptapEditor.commands.setTextSelection({ from: 14, to: 14 });
  editorB.insertInlineContent("!");
  await waitForCollab(2);

  editorA.undo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([
    { text: "hello world!", marks: [] },
  ]);
  expect(getTextNodesWithMarks(editorB)).toEqual([
    { text: "hello world!", marks: [] },
  ]);
});

it("can undo bold formatting in suggestion mode without corrupting attribution marks", async () => {
  const mainDocA = new Y.Doc();
  const mainDocB = new Y.Doc();
  setupTwoWaySync(mainDocA, mainDocB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  setupTwoWaySync(suggestionDocA, suggestionDocB);

  const attributionManagerA = Y.createAttributionManagerFromDiff(
    mainDocA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(mainDocA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    mainDocA,
    suggestionDocB,
    { attrs: createSuggestionAttrs(mainDocA, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: mainDocA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: mainDocB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  mainEditorA.replaceBlocks(mainEditorA.document, [
    { type: "paragraph", content: "hello world" },
  ]);
  await waitForCollab();

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(mainEditorB.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(mainEditorA, 0, 5);
  mainEditorA.toggleStyles({ bold: true } as any);
  await waitForCollab(2);
  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.stopCapturing();

  mainEditorA.undo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(mainEditorA)).toEqual([
    { text: "hello world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(mainEditorB)).toEqual([
    { text: "hello world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(suggestionEditorA)).toEqual([
    { text: "hello world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(suggestionEditorB)).toEqual([
    { text: "hello world", marks: [] },
  ]);
});

it("can undo italic formatting in collaboration without crashing a synced peer", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ italic: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorA.undo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([{ text: "hello world", marks: [] }]);
  expect(getTextNodesWithMarks(editorB)).toEqual([{ text: "hello world", marks: [] }]);
});

it("can redo bold formatting after undo across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorA.undo();
  await waitForCollab(2);
  editorA.redo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([
    { text: "hello", marks: ["bold:{}"] },
    { text: " world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(editorB)).toEqual([
    { text: "hello", marks: ["bold:{}"] },
    { text: " world", marks: [] },
  ]);
});

it("can type at the start after undoing whole-word bold formatting", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();
  editorA.undo();
  await waitForCollab(2);

  editorA._tiptapEditor.commands.setTextSelection({ from: 2, to: 2 });
  editorA.insertInlineContent("!");
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([{ text: "!hello world", marks: [] }]);
  expect(getTextNodesWithMarks(editorB)).toEqual([{ text: "!hello world", marks: [] }]);
});

it("can undo bold on a single character selection across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "abc" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 1, 2);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();
  editorA.undo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([{ text: "abc", marks: [] }]);
  expect(getTextNodesWithMarks(editorB)).toEqual([{ text: "abc", marks: [] }]);
});

it("can undo italic on the last word and continue typing at the end", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 6, 11);
  editorA.toggleStyles({ italic: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();
  editorA.undo();
  await waitForCollab(2);

  editorA._tiptapEditor.commands.setTextSelection({ from: 14, to: 14 });
  editorA.insertInlineContent("!");
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([{ text: "hello world!", marks: [] }]);
  expect(getTextNodesWithMarks(editorB)).toEqual([{ text: "hello world!", marks: [] }]);
});

it("can redo a heading change after undo across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA.updateBlock(editorA.document[0].id, {
    type: "heading",
    props: { level: 1 },
  } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorA.undo();
  await waitForCollab(2);
  editorA.redo();
  await waitForCollab(2);

  expect(editorA.document[0].type).toBe("heading");
  expect(editorB.document[0].type).toBe("heading");
});

it("can undo italic inside a heading and then undo the heading change across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA.updateBlock(editorA.document[0].id, {
    type: "heading",
    props: { level: 1 },
  } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ italic: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorA.undo();
  await waitForCollab(2);
  editorA.undo();
  await waitForCollab(2);

  expect(editorA.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(editorB.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
});

it("can undo italic inside a bullet list and then undo the list creation across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA.updateBlock(editorA.document[0].id, {
    type: "bulletListItem",
    content: "hello world",
  } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ italic: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorA.undo();
  await waitForCollab(2);
  editorA.undo();
  await waitForCollab(2);

  expect(editorA.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  expect(editorB.document.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
});

it("keeps same-block remote prepend stable when one user undoes bold formatting", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorB._tiptapEditor.commands.setTextSelection({ from: 2, to: 2 });
  editorB.insertInlineContent("!");
  await waitForCollab(2);

  editorA.undo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([{ text: "!hello world", marks: ["bold:{}"] }]);
  expect(getTextNodesWithMarks(editorB)).toEqual([{ text: "!hello world", marks: ["bold:{}"] }]);
});

it("keeps same-block remote middle insertion stable when one user undoes italic formatting", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ italic: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorB._tiptapEditor.commands.setTextSelection({ from: 8, to: 8 });
  editorB.insertInlineContent("!");
  await waitForCollab(2);

  editorA.undo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([{ text: "hello! world", marks: [] }]);
  expect(getTextNodesWithMarks(editorB)).toEqual([{ text: "hello! world", marks: [] }]);
});

it("can undo italic formatting in suggestion mode without corrupting attribution marks", async () => {
  const mainDocA = new Y.Doc();
  const mainDocB = new Y.Doc();
  setupTwoWaySync(mainDocA, mainDocB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  setupTwoWaySync(suggestionDocA, suggestionDocB);

  const attributionManagerA = Y.createAttributionManagerFromDiff(
    mainDocA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(mainDocA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    mainDocA,
    suggestionDocB,
    { attrs: createSuggestionAttrs(mainDocA, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: mainDocA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: mainDocB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });
  const suggestionEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  });
  const suggestionEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  suggestionEditorA.mount(document.createElement("div"));
  suggestionEditorB.mount(document.createElement("div"));

  mainEditorA.replaceBlocks(mainEditorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(mainEditorB.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(suggestionEditorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(mainEditorA, 0, 5);
  mainEditorA.toggleStyles({ italic: true } as any);
  await waitForCollab(2);
  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.stopCapturing();

  mainEditorA.undo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(mainEditorA)).toEqual([{ text: "hello world", marks: [] }]);
  expect(getTextNodesWithMarks(mainEditorB)).toEqual([{ text: "hello world", marks: [] }]);
  expect(getTextNodesWithMarks(suggestionEditorA)).toEqual([{ text: "hello world", marks: [] }]);
  expect(getTextNodesWithMarks(suggestionEditorB)).toEqual([{ text: "hello world", marks: [] }]);
});

it("can redo bold formatting in suggestion mode across peers", async () => {
  const mainDocA = new Y.Doc();
  const mainDocB = new Y.Doc();
  setupTwoWaySync(mainDocA, mainDocB);

  const suggestionDocA = new Y.Doc({ isSuggestionDoc: true });
  const suggestionDocB = new Y.Doc({ isSuggestionDoc: true });
  setupTwoWaySync(suggestionDocA, suggestionDocB);

  const attributionManagerA = Y.createAttributionManagerFromDiff(
    mainDocA,
    suggestionDocA,
    { attrs: createSuggestionAttrs(mainDocA, suggestionDocA) },
  );
  const attributionManagerB = Y.createAttributionManagerFromDiff(
    mainDocA,
    suggestionDocB,
    { attrs: createSuggestionAttrs(mainDocA, suggestionDocB) },
  );
  attributionManagerA.suggestionMode = true;
  attributionManagerB.suggestionMode = true;

  const mainEditorA = BlockNoteEditor.create({
    collaboration: {
      fragment: mainDocA.get("doc"),
      user: { name: "A", color: "#fff" },
    },
  });
  const mainEditorB = BlockNoteEditor.create({
    collaboration: {
      fragment: mainDocB.get("doc"),
      user: { name: "B", color: "#000" },
    },
  });

  mainEditorA.mount(document.createElement("div"));
  mainEditorB.mount(document.createElement("div"));
  BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocA.get("doc"),
      user: { name: "A", color: "#fff" },
      attributionManager: attributionManagerA,
    },
  }).mount(document.createElement("div"));
  BlockNoteEditor.create({
    collaboration: {
      fragment: suggestionDocB.get("doc"),
      user: { name: "B", color: "#000" },
      attributionManager: attributionManagerB,
    },
  }).mount(document.createElement("div"));

  mainEditorA.replaceBlocks(mainEditorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(mainEditorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(mainEditorA, 0, 5);
  mainEditorA.toggleStyles({ bold: true } as any);
  await waitForCollab(2);
  yUndoPluginKey.getState(mainEditorA.prosemirrorState)?.undoManager?.stopCapturing();

  mainEditorA.undo();
  await waitForCollab(2);
  mainEditorA.redo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(mainEditorA)).toEqual([
    { text: "hello", marks: ["bold:{}"] },
    { text: " world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(mainEditorB)).toEqual([
    { text: "hello", marks: ["bold:{}"] },
    { text: " world", marks: [] },
  ]);
});

it("can type after redoing bold formatting at the boundary across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();
  editorA.undo();
  await waitForCollab(2);
  editorA.redo();
  await waitForCollab(2);

  editorA._tiptapEditor.commands.setTextSelection({ from: 8, to: 8 });
  editorA.insertInlineContent("!");
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([
    { text: "hello!", marks: ["bold:{}"] },
    { text: " world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(editorB)).toEqual([
    { text: "hello!", marks: ["bold:{}"] },
    { text: " world", marks: [] },
  ]);
});

it("can keep typing after applying bold formatting across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab(2);

  editorA._tiptapEditor.commands.setTextSelection({ from: 8, to: 8 });
  editorA.insertInlineContent("!");
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([
    { text: "hello!", marks: ["bold:{}"] },
    { text: " world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(editorB)).toEqual([
    { text: "hello!", marks: ["bold:{}"] },
    { text: " world", marks: [] },
  ]);
});

it("can type immediately after applying bold formatting across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  editorA._tiptapEditor.commands.setTextSelection({ from: 8, to: 8 });
  editorA.insertInlineContent("!");
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([
    { text: "hello!", marks: ["bold:{}"] },
    { text: " world", marks: [] },
  ]);
  expect(getTextNodesWithMarks(editorB)).toEqual([
    { text: "hello!", marks: ["bold:{}"] },
    { text: " world", marks: [] },
  ]);
});

it("can type two characters after enabling bold at a collapsed cursor across peers", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  editorA._tiptapEditor.commands.setTextSelection({ from: 2, to: 2 });
  editorA.toggleStyles({ bold: true } as any);
  editorA.insertInlineContent("a");
  await waitForCollab(2);
  editorA.insertInlineContent("b");
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([{ text: "ab", marks: ["bold:{}"] }]);
  expect(getTextNodesWithMarks(editorB)).toEqual([{ text: "ab", marks: ["bold:{}"] }]);
});

it("keeps remote tail edits stable when one user undoes italic formatting", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ italic: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorB._tiptapEditor.commands.setTextSelection({ from: 14, to: 14 });
  editorB.insertInlineContent("!");
  await waitForCollab(2);

  editorA.undo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([{ text: "hello world!", marks: [] }]);
  expect(getTextNodesWithMarks(editorB)).toEqual([{ text: "hello world!", marks: [] }]);
});

it("can undo bold after a remote middle insertion in the same block", async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  setupTwoWaySync(docA, docB);

  const editorA = BlockNoteEditor.create({
    collaboration: { fragment: docA.get("doc"), user: { name: "A", color: "#fff" } },
  });
  const editorB = BlockNoteEditor.create({
    collaboration: { fragment: docB.get("doc"), user: { name: "B", color: "#000" } },
  });

  editorA.mount(document.createElement("div"));
  editorB.mount(document.createElement("div"));
  editorA.replaceBlocks(editorA.document, [{ type: "paragraph", content: "hello world" }]);
  await waitForCollab();

  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.clear();
  yUndoPluginKey.getState(editorB.prosemirrorState)?.undoManager?.clear();

  setFirstBlockSelection(editorA, 0, 5);
  editorA.toggleStyles({ bold: true } as any);
  await waitForCollab();
  yUndoPluginKey.getState(editorA.prosemirrorState)?.undoManager?.stopCapturing();

  editorB._tiptapEditor.commands.setTextSelection({ from: 9, to: 9 });
  editorB.insertInlineContent("!");
  await waitForCollab(2);

  editorA.undo();
  await waitForCollab(2);

  expect(getTextNodesWithMarks(editorA)).toEqual([{ text: "hello !world", marks: [] }]);
  expect(getTextNodesWithMarks(editorB)).toEqual([{ text: "hello !world", marks: [] }]);
});
