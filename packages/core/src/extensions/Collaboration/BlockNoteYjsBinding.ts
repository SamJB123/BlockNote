/**
 * BlockNote ↔ Yjs v14 Binding
 *
 * Bidirectional sync between BlockNote/ProseMirror and a Y.Type,
 * with remote cursor rendering via Awareness.
 *
 * Based on colab-platform's BlockNoteBindingV14, adapted for
 * BlockNote's extension system.
 *
 * Architecture:
 * - Content: doc > blockGroup > blockContainer > contentNode (paragraph/heading)
 * - Text content stored in contentNode Y.Type for character-level CRDT sync
 * - Uses lib0/delta for bidirectional sync
 * - Cursor positions use Yjs v14 RelativePosition API for stability
 * - No polling - uses TipTap transaction events
 * - Selection rendering uses ProseMirror decorations
 */

import * as Y from "@y/y";
import type { Awareness } from "@y/protocols/awareness";
import { createMutex } from "lib0/mutex";
import * as delta from "lib0/delta";
import * as s from "lib0/schema";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { Node as PmNode } from "prosemirror-model";

// ============================================================================
// BlockNote Content Types
// ============================================================================

interface StyledText {
  type: "text";
  text: string;
  styles: Record<string, boolean | string>;
}

interface LinkContent {
  type: "link";
  href: string;
  content: StyledText[];
}

type InlineContent = StyledText | LinkContent;

export interface BlockNoteBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: InlineContent[];
  children?: BlockNoteBlock[];
}

// ============================================================================
// Y.Type → BlockNote Conversion
// ============================================================================

function filterLinkStyles(
  format: Record<string, unknown>,
): Record<string, boolean | string> {
  const styles: Record<string, boolean | string> = {};
  for (const [key, value] of Object.entries(format)) {
    if (key !== "link" && value !== null && value !== undefined) {
      if (
        typeof value === "object" &&
        value !== null &&
        "stringValue" in value
      ) {
        styles[key] = (value as { stringValue: string }).stringValue;
      } else {
        styles[key] = value as boolean | string;
      }
    }
  }
  return styles;
}

function yTypeToContent(ytype: Y.Type): InlineContent[] {
  const d = ytype.toDelta();
  if (!d?.children) return [];

  const content: InlineContent[] = [];

  for (const op of d.children) {
    if (typeof op.insert !== "string") continue;

    const text = op.insert;
    const format = op.format || {};

    if (format.link) {
      content.push({
        type: "link",
        href: String(format.link),
        content: [
          {
            type: "text",
            text,
            styles: filterLinkStyles(format),
          },
        ],
      });
    } else {
      const styles: Record<string, boolean | string> = {};
      for (const [key, value] of Object.entries(format)) {
        if (value !== null && value !== undefined) {
          if (
            typeof value === "object" &&
            value !== null &&
            "stringValue" in value
          ) {
            styles[key] = (value as { stringValue: string }).stringValue;
          } else {
            styles[key] = value as boolean | string;
          }
        }
      }
      content.push({ type: "text", text, styles });
    }
  }

  return content;
}

function yBlockToBlockNote(blockContainer: Y.Type): BlockNoteBlock {
  const id = blockContainer.getAttr("id") as string;
  const children = blockContainer.toArray();

  const contentNode = children.find(
    (c): c is Y.Type => c instanceof Y.Type && c.name !== "blockGroup",
  );

  const childBlockGroup = children.find(
    (c): c is Y.Type => c instanceof Y.Type && c.name === "blockGroup",
  );

  const blockType = contentNode?.name || "paragraph";

  const block: BlockNoteBlock = {
    id: id || crypto.randomUUID(),
    type: blockType,
  };

  const props: Record<string, unknown> = {};
  if (contentNode instanceof Y.Type) {
    const contentAttrs = contentNode.getAttrs?.() ?? {};
    for (const [key, value] of Object.entries(contentAttrs)) {
      if (value !== undefined) {
        props[key] = value;
      }
    }
  }
  if (Object.keys(props).length > 0) {
    block.props = props;
  }

  if (contentNode instanceof Y.Type) {
    block.content = yTypeToContent(contentNode);
  }

  if (childBlockGroup instanceof Y.Type) {
    const childArray = childBlockGroup.toArray();
    block.children = childArray
      .filter((c): c is Y.Type => c instanceof Y.Type)
      .map(yBlockToBlockNote);
  }

  return block;
}

export function getBlocksFromContent(yContent: Y.Type): BlockNoteBlock[] {
  const blocks: BlockNoteBlock[] = [];
  const docChildren = yContent.toArray();
  const blockGroup = docChildren.find(
    (c): c is Y.Type => c instanceof Y.Type && c.name === "blockGroup",
  );
  if (!blockGroup) return blocks;
  blockGroup.forEach((item) => {
    if (item instanceof Y.Type) {
      blocks.push(yBlockToBlockNote(item));
    }
  });
  return blocks;
}

// ============================================================================
// lib0/delta Schema for ProseMirror
// ============================================================================

const $prosemirrorDelta = delta.$delta({
  name: s.$string,
  attrs: s.$record(s.$string, s.$any),
  text: true,
  recursive: true,
});

type ProsemirrorDelta = ReturnType<
  typeof delta.create<typeof $prosemirrorDelta>
>;

function marksToFormattingAttributes(
  marks: readonly any[],
): Record<string, any> {
  const formatting: Record<string, any> = {};
  marks.forEach((mark) => {
    if (mark.attrs?.stringValue !== undefined) {
      formatting[mark.type.name] = mark.attrs.stringValue;
    } else if (mark.attrs && Object.keys(mark.attrs).length > 0) {
      formatting[mark.type.name] = mark.attrs;
    } else {
      formatting[mark.type.name] = true;
    }
  });
  return formatting;
}

function nodeToDelta(n: PmNode): ProsemirrorDelta {
  const d = delta.create(n.type.name, $prosemirrorDelta);
  if (n.attrs) {
    d.setAttrs(n.attrs);
  }
  n.content.forEach((child: PmNode) => {
    if (child.isText) {
      d.insert(child.text || "", marksToFormattingAttributes(child.marks));
    } else {
      d.insert(
        [nodeToDelta(child)],
        marksToFormattingAttributes(child.marks),
      );
    }
  });
  return d;
}

// ============================================================================
// Position Utilities (Yjs v14 RelativePosition API)
// ============================================================================

interface CursorState {
  noteId: string;
  blockRelPos: ReturnType<typeof Y.relativePositionToJSON>;
  textRelPos: ReturnType<typeof Y.relativePositionToJSON>;
  anchorBlockRelPos?: ReturnType<typeof Y.relativePositionToJSON>;
  anchorTextRelPos?: ReturnType<typeof Y.relativePositionToJSON>;
}

interface AwarenessUser {
  name: string;
  color: string;
  cursor?: CursorState;
}

function getYBlockGroup(yContent: Y.Type): Y.Type | null {
  return (
    yContent
      .toArray()
      .find(
        (c): c is Y.Type => c instanceof Y.Type && c.name === "blockGroup",
      ) ?? null
  );
}

function getContentNode(blockContainer: Y.Type): Y.Type | null {
  return (
    blockContainer
      .toArray()
      .find(
        (c): c is Y.Type => c instanceof Y.Type && c.name !== "blockGroup",
      ) ?? null
  );
}

function findYBlockById(
  yBlockGroup: Y.Type,
  blockId: string,
): {
  blockContainer: Y.Type;
  parentBlockGroup: Y.Type;
  index: number;
} | null {
  const blocks = yBlockGroup.toArray();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!(block instanceof Y.Type)) continue;

    if (block.getAttr("id") === blockId) {
      return { blockContainer: block, parentBlockGroup: yBlockGroup, index: i };
    }

    const nestedBlockGroup = block
      .toArray()
      .find(
        (c): c is Y.Type => c instanceof Y.Type && c.name === "blockGroup",
      );
    if (nestedBlockGroup) {
      const found = findYBlockById(nestedBlockGroup, blockId);
      if (found) return found;
    }
  }
  return null;
}

function getBlockIdAtPos(doc: any, pmPos: number): string | null {
  const $pos = doc.resolve(pmPos);
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "blockContainer" && node.attrs.id) {
      return node.attrs.id;
    }
  }
  return null;
}

function createCursorPosition(
  pmState: any,
  pmPos: number,
  yContent: Y.Type,
  noteId: string,
): Omit<CursorState, "anchorBlockRelPos" | "anchorTextRelPos"> | null {
  try {
    const doc = pmState.doc;
    const blockId = getBlockIdAtPos(doc, pmPos);
    if (!blockId) return null;

    const yBlockGroup = getYBlockGroup(yContent);
    if (!yBlockGroup) return null;

    const found = findYBlockById(yBlockGroup, blockId);
    if (!found) return null;

    const { blockContainer, parentBlockGroup, index } = found;
    const contentNode = getContentNode(blockContainer);
    if (!contentNode) return null;

    const $pos = doc.resolve(pmPos);
    const textOffset = $pos.parentOffset;

    const blockRelPos = Y.createRelativePositionFromTypeIndex(
      parentBlockGroup,
      index,
    );
    const textRelPos = Y.createRelativePositionFromTypeIndex(
      contentNode,
      textOffset,
    );

    return {
      noteId,
      blockRelPos: Y.relativePositionToJSON(blockRelPos),
      textRelPos: Y.relativePositionToJSON(textRelPos),
    };
  } catch {
    return null;
  }
}

function findPMBlockById(
  doc: any,
  blockId: string,
): { pos: number; node: any } | null {
  let result: { pos: number; node: any } | null = null;
  doc.descendants((node: any, pos: number) => {
    if (result) return false;
    if (node.type.name === "blockContainer" && node.attrs.id === blockId) {
      result = { pos, node };
      return false;
    }
  });
  return result;
}

function resolveCursorPosition(
  pmState: any,
  cursor: { blockRelPos: any; textRelPos: any },
  yContent: Y.Type,
): number | null {
  try {
    const ydoc = yContent.doc;
    if (!ydoc) return null;

    const blockRelPos = Y.createRelativePositionFromJSON(cursor.blockRelPos);
    const blockAbsPos = Y.createAbsolutePositionFromRelativePosition(
      blockRelPos,
      ydoc,
    );
    if (!blockAbsPos) return null;

    const parentBlockGroup = blockAbsPos.type;
    if (!(parentBlockGroup instanceof Y.Type)) return null;

    const blocks = parentBlockGroup.toArray();
    const blockContainer = blocks[blockAbsPos.index];
    if (!(blockContainer instanceof Y.Type)) return null;

    const blockId = blockContainer.getAttr("id") as string;
    if (!blockId) return null;

    const pmBlock = findPMBlockById(pmState.doc, blockId);
    if (!pmBlock) return null;

    const textRelPos = Y.createRelativePositionFromJSON(cursor.textRelPos);
    const textAbsPos = Y.createAbsolutePositionFromRelativePosition(
      textRelPos,
      ydoc,
    );
    const textOffset = textAbsPos?.index ?? 0;

    const blockEndPos = pmBlock.pos + pmBlock.node.nodeSize;
    let textblockContentStart: number | null = null;
    pmState.doc.nodesBetween(
      pmBlock.pos,
      blockEndPos,
      (node: any, pos: number) => {
        if (textblockContentStart !== null) return false;
        if (node.isTextblock) {
          const $insideTextblock = pmState.doc.resolve(pos + 1);
          textblockContentStart = $insideTextblock.start(
            $insideTextblock.depth,
          );
          return false;
        }
      },
    );

    if (textblockContentStart === null) return null;

    const maxTextOffset = pmBlock.node.textContent?.length ?? 0;
    return textblockContentStart + Math.min(textOffset, maxTextOffset);
  } catch {
    return null;
  }
}

// ============================================================================
// Cursor Rendering
// ============================================================================

function isDarkColor(bgColor: string): boolean {
  const color =
    bgColor.charAt(0) === "#" ? bgColor.substring(1, 7) : bgColor;
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  const uicolors = [r / 255, g / 255, b / 255];
  const c = uicolors.map((col) => {
    if (col <= 0.03928) {
      return col / 12.92;
    }
    return Math.pow((col + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return L <= 0.179;
}

const cursorCache = new Map<
  number,
  {
    element: HTMLElement;
    hideTimeout: ReturnType<typeof setTimeout> | undefined;
  }
>();

function removeCursorFromCache(clientId: number): void {
  const cached = cursorCache.get(clientId);
  if (!cached) return;
  if (cached.hideTimeout) clearTimeout(cached.hideTimeout);
  if (cached.element.parentNode) cached.element.remove();
  cursorCache.delete(clientId);
}

function showCursorLabel(clientId: number): void {
  const cached = cursorCache.get(clientId);
  if (!cached) return;
  cached.element.setAttribute("data-active", "");
  if (cached.hideTimeout) clearTimeout(cached.hideTimeout);
  cached.hideTimeout = setTimeout(() => {
    cached.element.removeAttribute("data-active");
  }, 2000);
  cursorCache.set(clientId, cached);
}

function createCursorElement(
  user: { name: string; color: string },
  clientId: number,
): HTMLElement {
  const cached = cursorCache.get(clientId);
  if (cached) {
    showCursorLabel(clientId);
    return cached.element;
  }

  const cursorElement = document.createElement("span");
  cursorElement.classList.add("bn-collaboration-cursor__base");

  const caretElement = document.createElement("span");
  caretElement.setAttribute("contentEditable", "false");
  caretElement.classList.add("bn-collaboration-cursor__caret");
  const textColor = isDarkColor(user.color) ? "white" : "black";
  caretElement.setAttribute(
    "style",
    `background-color: ${user.color}; color: ${textColor}`,
  );

  const labelElement = document.createElement("span");
  labelElement.classList.add("bn-collaboration-cursor__label");
  labelElement.setAttribute(
    "style",
    `background-color: ${user.color}; color: ${textColor}`,
  );
  labelElement.insertBefore(document.createTextNode(user.name), null);

  caretElement.insertBefore(labelElement, null);

  cursorElement.insertBefore(document.createTextNode("\u2060"), null);
  cursorElement.insertBefore(caretElement, null);
  cursorElement.insertBefore(document.createTextNode("\u2060"), null);

  cursorElement.addEventListener("mouseenter", () => {
    const c = cursorCache.get(clientId);
    if (!c) return;
    c.element.setAttribute("data-active", "");
    if (c.hideTimeout) {
      clearTimeout(c.hideTimeout);
      c.hideTimeout = undefined;
    }
  });

  cursorElement.addEventListener("mouseleave", () => {
    const c = cursorCache.get(clientId);
    if (!c) return;
    c.hideTimeout = setTimeout(() => {
      c.element.removeAttribute("data-active");
    }, 2000);
  });

  cursorCache.set(clientId, { element: cursorElement, hideTimeout: undefined });
  showCursorLabel(clientId);

  return cursorElement;
}

// ============================================================================
// Remote Cursor Plugin
// ============================================================================

export const remoteCursorPluginKey = new PluginKey("remote-cursors");

function createCursorDecorations(
  state: any,
  awareness: Awareness,
  yContent: Y.Type,
  noteId: string,
  localClientId: number,
): DecorationSet {
  try {
    const decorations: Decoration[] = [];
    const maxSize = Math.max(state.doc.content.size - 1, 0);

    awareness.getStates().forEach((aw, clientId) => {
      if (clientId === localClientId) return;

      const user = aw.user as AwarenessUser | undefined;
      if (!user?.cursor || user.cursor.noteId !== noteId) return;

      const cursorState = user.cursor;

      const headPm = resolveCursorPosition(
        state,
        {
          blockRelPos: cursorState.blockRelPos,
          textRelPos: cursorState.textRelPos,
        },
        yContent,
      );

      if (headPm === null) return;

      const head = Math.min(headPm, maxSize);

      decorations.push(
        Decoration.widget(
          head,
          () => createCursorElement(user, clientId),
          { key: `cursor-${clientId}`, side: 1 },
        ),
      );

      if (cursorState.anchorBlockRelPos && cursorState.anchorTextRelPos) {
        const anchorPm = resolveCursorPosition(
          state,
          {
            blockRelPos: cursorState.anchorBlockRelPos,
            textRelPos: cursorState.anchorTextRelPos,
          },
          yContent,
        );

        if (anchorPm !== null) {
          const anchor = Math.min(anchorPm, maxSize);
          const from = Math.min(anchor, head);
          const to = Math.max(anchor, head);

          if (from !== to) {
            decorations.push(
              Decoration.inline(
                from,
                to,
                {
                  style: `background-color: ${user.color}40;`,
                  class: "bn-remote-selection",
                },
                { inclusiveEnd: true, inclusiveStart: false },
              ),
            );
          }
        }
      }
    });

    return DecorationSet.create(state.doc, decorations);
  } catch {
    return DecorationSet.empty;
  }
}

export function createRemoteCursorPlugin(
  awareness: Awareness,
  yContent: Y.Type,
  noteId: string,
): Plugin {
  return new Plugin({
    key: remoteCursorPluginKey,
    state: {
      init: (_, state) => {
        return createCursorDecorations(
          state,
          awareness,
          yContent,
          noteId,
          awareness.clientID,
        );
      },
      apply: (_tr, prevDecorationSet, _oldState, newState) => {
        const next = createCursorDecorations(
          newState,
          awareness,
          yContent,
          noteId,
          awareness.clientID,
        );
        if (
          next === DecorationSet.empty &&
          prevDecorationSet !== DecorationSet.empty
        ) {
          try {
            return prevDecorationSet.map(_tr.mapping, newState.doc);
          } catch {
            return DecorationSet.empty;
          }
        }
        return next;
      },
    },
    props: {
      decorations: (state) => {
        return remoteCursorPluginKey.getState(state);
      },
    },
  });
}

// ============================================================================
// Main Binding Class
// ============================================================================

interface StoredSelection {
  anchor: ReturnType<typeof Y.relativePositionToJSON>;
  head: ReturnType<typeof Y.relativePositionToJSON>;
  anchorBlockId: string;
  headBlockId: string;
}

export class BlockNoteYjsBinding {
  private yContent: Y.Type;
  private editor: any;
  private doc: Y.Doc | null;
  private awareness: Awareness | null;
  private noteId: string;
  private broadcastLocalCursor: boolean;
  private deepObserver:
    | ((event: Y.YEvent<any>, transaction: Y.Transaction) => void)
    | null = null;
  private awarenessChangeHandler:
    | ((
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: any,
      ) => void)
    | null = null;
  private tiptapUnsubscribe: (() => void) | null = null;
  private transactionHandler:
    | ((props: { transaction: any }) => void)
    | null = null;

  private mux: ReturnType<typeof createMutex>;
  private beforeTransactionSelection: StoredSelection | null = null;

  private boundBeforeAllTransactions:
    | ((doc: Y.Doc) => void)
    | null = null;
  private boundAfterAllTransactions:
    | ((doc: Y.Doc, transactions: Y.Transaction[]) => void)
    | null = null;

  private hasFocus = false;
  private destroyed = false;

  private static readonly REMOTE_UPDATE_META = "blockNoteRemoteUpdate";

  constructor(
    yContent: Y.Type,
    editor: any,
    awareness: Awareness | null,
    noteId: string,
    broadcastLocalCursor = true,
  ) {
    this.yContent = yContent;
    this.editor = editor;
    this.doc = yContent.doc;
    this.awareness = awareness;
    this.noteId = noteId;
    this.broadcastLocalCursor = broadcastLocalCursor;

    this.mux = createMutex();

    // Sync initial content
    const initialBlocks = getBlocksFromContent(yContent);
    if (initialBlocks.length > 0) {
      try {
        editor.replaceBlocks(editor.document, initialBlocks as any);
      } catch (e) {
        console.warn("[BlockNoteYjsBinding] Failed to load initial blocks:", e);
      }
    } else {
      this.syncPMToYjs();
    }

    // Bind events
    this.onTransaction = this.onTransaction.bind(this);
    this.onYContentDeepChange = this.onYContentDeepChange.bind(this);
    this.onSelectionUpdate = this.onSelectionUpdate.bind(this);
    this.onEditorFocus = this.onEditorFocus.bind(this);
    this.onEditorBlur = this.onEditorBlur.bind(this);
    this.onAwarenessUpdate = this.onAwarenessUpdate.bind(this);

    this.boundBeforeAllTransactions =
      this.beforeAllTransactions.bind(this);
    this.boundAfterAllTransactions =
      this.afterAllTransactions.bind(this);

    if (this.doc) {
      this.doc.on(
        "beforeAllTransactions",
        this.boundBeforeAllTransactions,
      );
      this.doc.on(
        "afterAllTransactions",
        this.boundAfterAllTransactions,
      );
    }

    this.deepObserver = this.onYContentDeepChange;
    yContent.observeDeep(this.deepObserver);

    const tiptapEditor = (editor as any)._tiptapEditor;
    if (tiptapEditor) {
      this.transactionHandler = this.onTransaction;
      tiptapEditor.on("transaction", this.transactionHandler);

      if (awareness) {
        const cursorPlugin = createRemoteCursorPlugin(
          awareness,
          yContent,
          noteId,
        );
        const newState = tiptapEditor.state.reconfigure({
          plugins: [...tiptapEditor.state.plugins, cursorPlugin],
        });
        tiptapEditor.view.updateState(newState);

        if (this.broadcastLocalCursor) {
          tiptapEditor.on("selectionUpdate", this.onSelectionUpdate);
          tiptapEditor.on("focus", this.onEditorFocus);
          tiptapEditor.on("blur", this.onEditorBlur);
        } else {
          this.clearLocalCursor();
        }

        this.awarenessChangeHandler = this.onAwarenessUpdate;
        awareness.on("change", this.awarenessChangeHandler);
      }

      this.tiptapUnsubscribe = () => {
        tiptapEditor.off("transaction", this.transactionHandler);
        tiptapEditor.off("selectionUpdate", this.onSelectionUpdate);
        tiptapEditor.off("focus", this.onEditorFocus);
        tiptapEditor.off("blur", this.onEditorBlur);
      };
    }
  }

  private beforeAllTransactions(_doc: Y.Doc): void {
    if (this.beforeTransactionSelection !== null) return;

    const tiptapEditor = (this.editor as any)?._tiptapEditor;
    if (!tiptapEditor?.view?.hasFocus()) return;

    try {
      const { state } = tiptapEditor;
      const { selection } = state;
      const { anchor, head } = selection;

      const anchorBlockId = getBlockIdAtPos(state.doc, anchor);
      const headBlockId = getBlockIdAtPos(state.doc, head);
      if (!anchorBlockId || !headBlockId) return;

      const yBlockGroup = getYBlockGroup(this.yContent);
      if (!yBlockGroup) return;

      const anchorFound = findYBlockById(yBlockGroup, anchorBlockId);
      const headFound = findYBlockById(yBlockGroup, headBlockId);
      if (!anchorFound || !headFound) return;

      const anchorContentNode = getContentNode(
        anchorFound.blockContainer,
      );
      const headContentNode = getContentNode(headFound.blockContainer);
      if (!anchorContentNode || !headContentNode) return;

      const $anchor = state.doc.resolve(anchor);
      const $head = state.doc.resolve(head);

      const anchorRelPos = Y.createRelativePositionFromTypeIndex(
        anchorContentNode,
        $anchor.parentOffset,
      );
      const headRelPos = Y.createRelativePositionFromTypeIndex(
        headContentNode,
        $head.parentOffset,
      );

      this.beforeTransactionSelection = {
        anchor: Y.relativePositionToJSON(anchorRelPos),
        head: Y.relativePositionToJSON(headRelPos),
        anchorBlockId,
        headBlockId,
      };
    } catch {
      // Editor might not be ready
    }
  }

  private afterAllTransactions(
    _doc: Y.Doc,
    _transactions: Y.Transaction[],
  ): void {
    this.beforeTransactionSelection = null;
  }

  private restoreSelection(): void {
    if (!this.beforeTransactionSelection) return;

    const tiptapEditor = (this.editor as any)?._tiptapEditor;
    if (!tiptapEditor) return;

    try {
      const ydoc = this.doc;
      if (!ydoc) return;

      const stored = this.beforeTransactionSelection;
      const pmState = tiptapEditor.state;

      const anchorPmBlock = findPMBlockById(
        pmState.doc,
        stored.anchorBlockId,
      );
      const headPmBlock = findPMBlockById(pmState.doc, stored.headBlockId);
      if (!anchorPmBlock || !headPmBlock) return;

      const anchorRelPos = Y.createRelativePositionFromJSON(stored.anchor);
      const headRelPos = Y.createRelativePositionFromJSON(stored.head);

      const anchorAbsPos =
        Y.createAbsolutePositionFromRelativePosition(anchorRelPos, ydoc);
      const headAbsPos =
        Y.createAbsolutePositionFromRelativePosition(headRelPos, ydoc);

      if (!anchorAbsPos || !headAbsPos) return;

      const anchorPm = this.blockIdTextOffsetToPmPos(
        pmState,
        anchorPmBlock,
        anchorAbsPos.index,
      );
      const headPm = this.blockIdTextOffsetToPmPos(
        pmState,
        headPmBlock,
        headAbsPos.index,
      );

      if (anchorPm !== null && headPm !== null) {
        const tr = pmState.tr.setSelection(
          TextSelection.create(pmState.doc, anchorPm, headPm),
        );
        tr.setMeta("restoreSelection", true);
        tiptapEditor.view.dispatch(tr);
      }
    } catch {
      // Selection restoration is best-effort
    }
  }

  private blockIdTextOffsetToPmPos(
    pmState: any,
    pmBlock: { pos: number; node: any },
    textOffset: number,
  ): number | null {
    try {
      const blockEndPos = pmBlock.pos + pmBlock.node.nodeSize;
      let textblockContentStart: number | null = null;
      pmState.doc.nodesBetween(
        pmBlock.pos,
        blockEndPos,
        (node: any, pos: number) => {
          if (textblockContentStart !== null) return false;
          if (node.isTextblock) {
            const $insideTextblock = pmState.doc.resolve(pos + 1);
            textblockContentStart = $insideTextblock.start(
              $insideTextblock.depth,
            );
            return false;
          }
        },
      );
      if (textblockContentStart === null) return null;
      const maxTextOffset = pmBlock.node.textContent?.length ?? 0;
      return textblockContentStart + Math.min(textOffset, maxTextOffset);
    } catch {
      return null;
    }
  }

  private onTransaction({ transaction }: { transaction: any }): void {
    if (!transaction.docChanged) return;
    if (transaction.getMeta(BlockNoteYjsBinding.REMOTE_UPDATE_META))
      return;
    if (transaction.getMeta("restoreSelection")) return;

    this.mux(() => {
      this.syncPMToYjs();
    });
  }

  private syncPMToYjs(): void {
    const tiptapEditor = (this.editor as any)._tiptapEditor;
    if (!tiptapEditor || !this.yContent) return;

    try {
      const pmDoc = tiptapEditor.state.doc;
      const pmDelta = nodeToDelta(pmDoc);
      const yjsDelta = this.yContent.toDeltaDeep();
      const diffDelta = delta.diff(yjsDelta, pmDelta);

      if (diffDelta.children.len > 0 || diffDelta.attrs.len > 0) {
        this.yContent.applyDelta(diffDelta);
      }
    } catch (e) {
      console.warn("[BlockNoteYjsBinding] syncPMToYjs failed:", e);
    }
  }

  private onYContentDeepChange(
    _event: Y.YEvent<any>,
    _transaction: Y.Transaction,
  ): void {
    if (this.destroyed) return;

    const tiptapEditor = (this.editor as any)._tiptapEditor;
    if (!tiptapEditor) return;

    this.mux(() => {
      this.syncYjsToPM();
    });
  }

  private syncYjsToPM(): void {
    const tiptapEditor = (this.editor as any)._tiptapEditor;
    if (!tiptapEditor) return;

    try {
      const yjsDelta = this.yContent.toDeltaDeep();
      const pmDoc = tiptapEditor.state.doc;
      const pmDelta = nodeToDelta(pmDoc);
      const diffDelta = delta.diff(pmDelta, yjsDelta);

      if (diffDelta.children.len > 0 || diffDelta.attrs.len > 0) {
        const blocks = getBlocksFromContent(this.yContent);
        if (blocks.length > 0) {
          this.editor.replaceBlocks(this.editor.document, blocks as any);
        }
        this.restoreSelection();
      }
    } catch (e) {
      console.warn("[BlockNoteYjsBinding] syncYjsToPM failed:", e);
    }
  }

  private onAwarenessUpdate(
    changes: { added: number[]; updated: number[]; removed: number[] },
    _origin: string,
  ): void {
    if (this.destroyed) return;
    for (const clientId of changes.removed) {
      removeCursorFromCache(clientId);
    }

    const tiptapEditor = (this.editor as any)._tiptapEditor;
    if (tiptapEditor?.view) {
      const { state } = tiptapEditor.view;
      tiptapEditor.view.dispatch(
        state.tr.setMeta("awarenessUpdate", true),
      );
    }
  }

  private onSelectionUpdate(): void {
    if (!this.awareness || !this.broadcastLocalCursor || !this.hasFocus)
      return;

    try {
      const pmEditor = (this.editor as any)._tiptapEditor;
      if (!pmEditor) return;

      const { state } = pmEditor;
      const { selection } = state;
      const { anchor, head } = selection;

      const headPos = createCursorPosition(
        state,
        head,
        this.yContent,
        this.noteId,
      );
      if (!headPos) return;

      const cursorState: CursorState = { ...headPos };

      if (anchor !== head) {
        const anchorPos = createCursorPosition(
          state,
          anchor,
          this.yContent,
          this.noteId,
        );
        if (anchorPos) {
          cursorState.anchorBlockRelPos = anchorPos.blockRelPos;
          cursorState.anchorTextRelPos = anchorPos.textRelPos;
        }
      }

      const currentState = this.awareness.getLocalState() ?? {};
      const currentUser =
        (currentState.user as AwarenessUser) ?? {};

      this.awareness.setLocalStateField("user", {
        ...currentUser,
        cursor: cursorState,
      });
    } catch {
      // Editor may not be ready
    }
  }

  private onEditorFocus(): void {
    this.hasFocus = true;
  }

  private onEditorBlur(): void {
    this.hasFocus = false;
    this.clearLocalCursor();
  }

  clearLocalCursor(): void {
    if (!this.awareness) return;
    const currentState = this.awareness.getLocalState() ?? {};
    const currentUser = (currentState.user as AwarenessUser) ?? {};
    this.awareness.setLocalStateField("user", {
      ...currentUser,
      cursor: undefined,
    });
  }

  destroy(): void {
    this.destroyed = true;

    if (this.deepObserver) {
      this.yContent.unobserveDeep(this.deepObserver);
      this.deepObserver = null;
    }

    if (this.doc) {
      if (this.boundBeforeAllTransactions) {
        this.doc.off(
          "beforeAllTransactions",
          this.boundBeforeAllTransactions,
        );
        this.boundBeforeAllTransactions = null;
      }
      if (this.boundAfterAllTransactions) {
        this.doc.off(
          "afterAllTransactions",
          this.boundAfterAllTransactions,
        );
        this.boundAfterAllTransactions = null;
      }
    }

    if (this.awareness && this.awarenessChangeHandler) {
      this.awareness.off("change", this.awarenessChangeHandler);
      this.awarenessChangeHandler = null;
    }

    this.clearLocalCursor();

    if (this.awareness) {
      removeCursorFromCache(this.awareness.clientID);
    }

    if (this.tiptapUnsubscribe) {
      this.tiptapUnsubscribe();
      this.tiptapUnsubscribe = null;
    }

    const tiptapEditor = (this.editor as any)?._tiptapEditor;
    if (tiptapEditor?.view && !tiptapEditor.view.isDestroyed) {
      try {
        const currentState = tiptapEditor.view.state;
        const plugins = currentState.plugins.filter(
          (p: Plugin) => p.spec.key !== remoteCursorPluginKey,
        );
        if (plugins.length !== currentState.plugins.length) {
          const cleanState = currentState.reconfigure({ plugins });
          tiptapEditor.view.updateState(cleanState);
        }
      } catch (err) {
        console.warn(
          "[BlockNoteYjsBinding] Failed to unregister cursor plugin:",
          err,
        );
      }
    }
  }
}
