import { expect, it } from "vitest";
import * as Y from "@y/y";
import { yUndoPluginKey } from "@y/prosemirror";
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

  doc1.on("update", (update: Uint8Array) => {
    Y.applyUpdate(doc2, update);
  });

  doc2.on("update", (update: Uint8Array) => {
    Y.applyUpdate(doc1, update);
  });
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
  expect(fragment.toJSON()).toMatchInlineSnapshot(`""`);

  editor.replaceBlocks(editor.document, [
    {
      type: "paragraph",
      content: [{ text: "Hello", styles: {}, type: "text" }],
    },
  ]);
  expect(transactionCount).toBe(2);
  // Only after a real modification is made, will the fragment be updated
  expect(fragment.toJSON()).toMatchInlineSnapshot(
    `"<blockgroup><blockcontainer id="0"><paragraph backgroundColor="default" textAlignment="left" textColor="default">Hello</paragraph></blockcontainer><blockcontainer id="1"><paragraph backgroundColor="default" textAlignment="left" textColor="default"></paragraph></blockcontainer></blockgroup>"`,
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
  setupTwoWaySync(ydocA, ydocB);

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
  ]);
  expect(contentB).toEqual([
    '[{"type":"text","text":"1","styles":{}}]',
    '[{"type":"text","text":"B2","styles":{}}]',
    '[{"type":"text","text":"3","styles":{}}]',
  ]);
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

  // eslint-disable-next-line no-console
  console.log("suggestion-diagnose", {
    mainBlocks: mainEditor.document.map((b) => JSON.stringify(b.content)),
    suggestionBlocks: suggestionEditor.document.map((b) =>
      JSON.stringify(b.content),
    ),
    suggestionFragment: suggestionDoc.get("doc").toJSON(),
  });
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

  // eslint-disable-next-line no-console
  console.log("cross-client-suggestion-diagnose", {
    mainA: mainEditorA.document.map((b) => JSON.stringify(b.content)),
    mainB: mainEditorB.document.map((b) => JSON.stringify(b.content)),
    sugA: suggestionEditorA.document.map((b) => JSON.stringify(b.content)),
    sugB: suggestionEditorB.document.map((b) => JSON.stringify(b.content)),
    sugAPm: getTextNodesWithMarks(suggestionEditorA),
    sugBPm: getTextNodesWithMarks(suggestionEditorB),
    suggestionDocA: suggestionDocA.get("doc").toJSON(),
    suggestionDocB: suggestionDocB.get("doc").toJSON(),
  });
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

it("reproduces heading formatting failure on a blank paragraph in suggestion mode", async () => {
  const errorPromise = new Promise<Error>((resolve) => {
    process.prependOnceListener("uncaughtException", resolve);
  });

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
  mainEditorA.updateBlock(firstBlockId, {
    type: "heading",
    props: { level: 1 },
  } as any);
  const error = await errorPromise;

  expect(error.message).toBe("Unexpected case");
});
