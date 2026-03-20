import { expect, it } from "vitest";
import * as Y from "@y/y";
import { BlockNoteEditor } from "../../../../editor/BlockNoteEditor.js";
import { moveColorAttributes } from "./moveColorAttributes.js";

it("can move color attributes on older documents", async () => {
  const doc = new Y.Doc();
  const fragment = doc.get("doc");
  const editor = BlockNoteEditor.create({
    initialContent: [
      {
        type: "paragraph",
        content: "Welcome to this demo!",
      },
    ],
  });

  // Because this was a previous schema, we are creating the Y.Type structure manually
  // In v14, Y.Type with a name acts like the old Y.XmlElement
  const blockGroup = new Y.Type("blockGroup");
  const el = new Y.Type("blockContainer");
  el.setAttr("id", "0");
  el.setAttr("backgroundColor", "red");
  el.setAttr("textColor", "blue");
  const para = new Y.Type("paragraph");
  para.setAttr("textAlignment", "left");
  para.insert(0, "Welcome to this demo!");
  el.push([para]);
  blockGroup.push([el]);
  fragment.push([blockGroup]);

  const tr = editor.prosemirrorState.tr;
  moveColorAttributes(fragment, tr);
  // Note that the color attributes have been moved to the paragraph.
  expect(tr.docChanged).toBe(true);
});

it("does not move color attributes on newer documents", async () => {
  const doc = new Y.Doc();
  const fragment = doc.get("doc");
  const editor = BlockNoteEditor.create({
    initialContent: [
      {
        type: "paragraph",
        content: "Welcome to this demo!",
        props: {
          backgroundColor: "red",
          textColor: "blue",
          textAlignment: "right",
        },
      },
    ],
  });

  // In newer documents, color attributes are already on the paragraph.
  // Create a structure where blockContainer does NOT have color attrs.
  const blockGroup = new Y.Type("blockGroup");
  const el = new Y.Type("blockContainer");
  el.setAttr("id", "0");
  // No color attributes on blockContainer
  const para = new Y.Type("paragraph");
  para.setAttr("textAlignment", "right");
  para.setAttr("backgroundColor", "red");
  para.setAttr("textColor", "blue");
  para.insert(0, "Welcome to this demo!");
  el.push([para]);
  blockGroup.push([el]);
  fragment.push([blockGroup]);

  const tr = editor.prosemirrorState.tr;
  moveColorAttributes(fragment, tr);
  // The document will be unchanged because the color attributes are already on the paragraph.
  expect(tr.docChanged).toBe(false);
});

it("can move color attributes on older documents multiple times", async () => {
  const doc = new Y.Doc();
  const fragment = doc.get("doc");
  const editor = BlockNoteEditor.create({
    initialContent: [
      {
        type: "paragraph",
        content: "Welcome to this demo!",
      },
    ],
  });

  // Because this was a previous schema, we are creating the Y.Type structure manually
  const blockGroup = new Y.Type("blockGroup");
  const el = new Y.Type("blockContainer");
  el.setAttr("id", "0");
  el.setAttr("backgroundColor", "red");
  el.setAttr("textColor", "blue");
  const para = new Y.Type("paragraph");
  para.setAttr("textAlignment", "left");
  para.insert(0, "Welcome to this demo!");
  el.push([para]);
  blockGroup.push([el]);
  fragment.push([blockGroup]);

  const tr = editor.prosemirrorState.tr;
  moveColorAttributes(fragment, tr);
  expect(tr.docChanged).toBe(true);

  // Update the color attributes on the blockContainer
  el.setAttr("backgroundColor", "green");
  el.setAttr("textColor", "yellow");

  const nextTr = editor.prosemirrorState.tr;
  moveColorAttributes(fragment, nextTr);
  expect(nextTr.docChanged).toBe(true);
});
