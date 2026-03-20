import * as Y from "@y/y";

import {
  type Block,
  type BlockNoteEditor,
  type BlockSchema,
  type InlineContentSchema,
  type PartialBlock,
  type StyleSchema,
  blockToNode,
  docToBlocks,
} from "../index.js";
import { getBlocksFromContent } from "../extensions/Collaboration/BlockNoteYjsBinding.js";

/**
 * Turn Prosemirror JSON to BlockNote style JSON
 * @param editor BlockNote editor
 * @param json Prosemirror JSON
 * @returns BlockNote style JSON
 */
export function _prosemirrorJSONToBlocks<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(editor: BlockNoteEditor<BSchema, ISchema, SSchema>, json: any) {
  const doc = editor.pmSchema.nodeFromJSON(json);
  return docToBlocks<BSchema, ISchema, SSchema>(doc);
}

/**
 * Turn BlockNote JSON to Prosemirror node / state
 * @param editor BlockNote editor
 * @param blocks BlockNote blocks
 * @returns Prosemirror root node
 */
export function _blocksToProsemirrorNode<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ISchema, SSchema>,
  blocks: PartialBlock<BSchema, ISchema, SSchema>[],
) {
  const pmNodes = blocks.map((b) => blockToNode(b, editor.pmSchema));

  const doc = editor.pmSchema.topNodeType.create(
    null,
    editor.pmSchema.nodes["blockGroup"].create(null, pmNodes),
  );
  return doc;
}

/** YJS / BLOCKNOTE conversions */

/**
 * Turn a Y.Type collaborative doc fragment into a BlockNote document
 * @param editor BlockNote editor
 * @param fragment Y.Type fragment
 * @returns BlockNote document (BlockNote style JSON of all blocks)
 */
export function yXmlFragmentToBlocks<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  _editor: BlockNoteEditor<BSchema, ISchema, SSchema>,
  fragment: Y.Type,
) {
  return getBlocksFromContent(fragment) as unknown as Block<
    BSchema,
    ISchema,
    SSchema
  >[];
}

/**
 * Convert blocks to a Y.Type fragment.
 *
 * This can be used when importing existing content to Y.Doc for the first time,
 * note that this should not be used to rehydrate a Y.Doc from a database once
 * collaboration has begun as all history will be lost
 *
 * @param editor BlockNote editor
 * @param blocks the blocks to convert
 * @param fragment optional existing Y.Type to populate
 * @returns Y.Type
 */
export function blocksToYXmlFragment<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ISchema, SSchema>,
  blocks: Block<BSchema, ISchema, SSchema>[],
  fragment?: Y.Type,
): Y.Type {
  const pmNode = _blocksToProsemirrorNode(editor, blocks);
  const target = fragment ?? new Y.Type();

  // Use lib0/delta to sync the PM node into the Y.Type
  const { default: deltaModule } = await_delta();
  const { default: schemaModule } = await_schema();
  const $pmDelta = deltaModule.$delta({
    name: schemaModule.$string,
    attrs: schemaModule.$record(schemaModule.$string, schemaModule.$any),
    text: true,
    recursive: true,
  });

  function nodeToD(n: any): any {
    const d = deltaModule.create(n.type.name, $pmDelta);
    if (n.attrs) d.setAttrs(n.attrs);
    n.content.forEach((child: any) => {
      if (child.isText) {
        const formatting: Record<string, any> = {};
        child.marks.forEach((mark: any) => {
          if (mark.attrs?.stringValue !== undefined) {
            formatting[mark.type.name] = mark.attrs.stringValue;
          } else if (mark.attrs && Object.keys(mark.attrs).length > 0) {
            formatting[mark.type.name] = mark.attrs;
          } else {
            formatting[mark.type.name] = true;
          }
        });
        d.insert(child.text || "", formatting);
      } else {
        const childFormatting: Record<string, any> = {};
        child.marks.forEach((mark: any) => {
          if (mark.attrs?.stringValue !== undefined) {
            childFormatting[mark.type.name] = mark.attrs.stringValue;
          } else if (mark.attrs && Object.keys(mark.attrs).length > 0) {
            childFormatting[mark.type.name] = mark.attrs;
          } else {
            childFormatting[mark.type.name] = true;
          }
        });
        d.insert([nodeToD(child)], childFormatting);
      }
    });
    return d;
  }

  const pmDelta = nodeToD(pmNode);
  target.applyDelta(pmDelta);

  return target;
}

// Lazy imports for lib0/delta and lib0/schema to avoid top-level async
function await_delta() {
  return require("lib0/delta");
}
function await_schema() {
  return require("lib0/schema");
}

/**
 * Turn a Y.Doc collaborative doc into a BlockNote document
 * @param editor BlockNote editor
 * @param ydoc Y.Doc
 * @param fragmentName Name of the fragment in the Y.Doc
 * @returns BlockNote document
 */
export function yDocToBlocks<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ISchema, SSchema>,
  ydoc: Y.Doc,
  fragmentName = "prosemirror",
) {
  return yXmlFragmentToBlocks(editor, ydoc.get(fragmentName));
}

/**
 * Convert blocks to a Y.Doc.
 *
 * @param editor BlockNote editor
 * @param blocks the blocks to convert
 * @param fragmentName Name of the fragment in the Y.Doc
 */
export function blocksToYDoc<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(
  editor: BlockNoteEditor<BSchema, ISchema, SSchema>,
  blocks: PartialBlock<BSchema, ISchema, SSchema>[],
  fragmentName = "prosemirror",
) {
  const ydoc = new Y.Doc();
  const fragment = ydoc.get(fragmentName);
  blocksToYXmlFragment(editor, blocks as any, fragment);
  return ydoc;
}
