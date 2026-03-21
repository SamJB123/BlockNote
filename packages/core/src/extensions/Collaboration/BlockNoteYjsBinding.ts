/**
 * BlockNote ↔ Yjs v14 Binding
 *
 * Combines @samjb/y-prosemirror's syncPlugin (for incremental bidirectional sync
 * with attribution support) with custom cursor rendering via Awareness.
 *
 * Architecture:
 * - Sync: delegated to @samjb/y-prosemirror's syncPlugin which uses trToDelta
 *   for efficient incremental PM→Yjs sync, and deltaToPSteps for Yjs→PM.
 * - Cursors: custom ProseMirror decorations using Yjs v14 RelativePosition API.
 * - @samjb/y-prosemirror handles: sync, attribution, pause/resume, initialization.
 * - This binding handles: cursor rendering, awareness, lifecycle management.
 */

import * as Y from "@y/y";
import type { Awareness } from "@y/protocols/awareness";
import { syncPlugin, ySyncPluginKey } from "@samjb/y-prosemirror";
import { TextOp } from "lib0/delta";
import { Decoration, DecorationSet } from "prosemirror-view";
import { Plugin, PluginKey } from "prosemirror-state";

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

function hasStringValue(
  value: unknown,
): value is { stringValue: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("stringValue" in value)) return false;
  return typeof value.stringValue === "string";
}

function filterLinkStyles(
  format: Record<string, unknown>,
): Record<string, boolean | string> {
  const styles: Record<string, boolean | string> = {};
  for (const [key, value] of Object.entries(format)) {
    if (key !== "link" && value !== null && value !== undefined) {
      if (hasStringValue(value)) {
        styles[key] = value.stringValue;
      } else if (typeof value === "boolean" || typeof value === "string") {
        styles[key] = value;
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
    if (!(op instanceof TextOp)) continue;

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
          if (hasStringValue(value)) {
            styles[key] = value.stringValue;
          } else if (typeof value === "boolean" || typeof value === "string") {
            styles[key] = value;
          }
        }
      }
      content.push({ type: "text", text, styles });
    }
  }

  return content;
}

function yBlockToBlockNote(blockContainer: Y.Type): BlockNoteBlock {
  const id = blockContainer.getAttr("id");
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

export function getBlocksFromContent(
  yContent: Y.Type,
): BlockNoteBlock[] {
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
// Attribution types (re-exported for Collaboration.ts)
// ============================================================================

import type { Attribution } from "lib0/delta";

/**
 * A function that maps Yjs attribution data to ProseMirror formatting marks.
 * Used for track changes / suggestion mode.
 */
export type MapAttributionToMark = (
  format: Record<string, unknown> | null,
  attribution: Attribution,
) => Record<string, unknown> | null;

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

export function createCursorPosition(
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
    return undefined;
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

    const blockId = blockContainer.getAttr("id");
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
        return undefined;
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

export function removeCursorFromCache(clientId: number): void {
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

      const user: AwarenessUser | undefined = aw.user;
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

export class BlockNoteYjsBinding {
  private yContent: Y.Type;
  private editor: any;
  private awareness: Awareness | null;
  private noteId: string;
  private broadcastLocalCursor: boolean;

  private awarenessChangeHandler:
    | ((
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: any,
      ) => void)
    | null = null;
  private tiptapUnsubscribe: (() => void) | null = null;

  private hasFocus = false;
  private destroyed = false;

  constructor(
    yContent: Y.Type,
    editor: any,
    awareness: Awareness | null,
    noteId: string,
    broadcastLocalCursor = true,
    attributionManager?: Y.AbstractAttributionManager,
    mapAttributionToMark?: MapAttributionToMark,
  ) {
    this.yContent = yContent;
    this.editor = editor;
    this.awareness = awareness;
    this.noteId = noteId;
    this.broadcastLocalCursor = broadcastLocalCursor;

    this.onSelectionUpdate = this.onSelectionUpdate.bind(this);
    this.onEditorFocus = this.onEditorFocus.bind(this);
    this.onEditorBlur = this.onEditorBlur.bind(this);
    this.onAwarenessUpdate = this.onAwarenessUpdate.bind(this);

    const tiptapEditor = editor._tiptapEditor;
    if (tiptapEditor) {
      // Register syncPlugin from @samjb/y-prosemirror for bidirectional sync.
      // This handles: initialization, incremental PM→Yjs via trToDelta,
      // Yjs→PM via deltaToPSteps, attribution, pause/resume.
      const sync = syncPlugin(yContent, {
        attributionManager: attributionManager ?? Y.noAttributionsManager,
        mapAttributionToMark: mapAttributionToMark ?? undefined,
      });

      const plugins = [...tiptapEditor.state.plugins, sync];

      // Register cursor plugin if awareness is available
      if (awareness) {
        const cursorPlugin = createRemoteCursorPlugin(
          awareness,
          yContent,
          noteId,
        );
        plugins.push(cursorPlugin);

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

      // Apply all plugins at once
      const newState = tiptapEditor.state.reconfigure({ plugins });
      tiptapEditor.view.updateState(newState);

      this.tiptapUnsubscribe = () => {
        tiptapEditor.off("selectionUpdate", this.onSelectionUpdate);
        tiptapEditor.off("focus", this.onEditorFocus);
        tiptapEditor.off("blur", this.onEditorBlur);
      };
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

    const tiptapEditor = this.editor._tiptapEditor;
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
      const pmEditor = this.editor._tiptapEditor;
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
      const currentUser: AwarenessUser = currentState.user ?? {};

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
    const currentUser: AwarenessUser = currentState.user ?? {};
    this.awareness.setLocalStateField("user", {
      ...currentUser,
      cursor: undefined,
    });
  }

  destroy(): void {
    this.destroyed = true;

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

    // Remove both syncPlugin and cursor plugin from ProseMirror state
    const tiptapEditor = this.editor?._tiptapEditor;
    if (tiptapEditor?.view && !tiptapEditor.view.isDestroyed) {
      try {
        const currentState = tiptapEditor.view.state;
        const plugins = currentState.plugins.filter(
          (p: Plugin) =>
            p.spec.key !== remoteCursorPluginKey &&
            p.spec.key !== ySyncPluginKey,
        );
        if (plugins.length !== currentState.plugins.length) {
          const cleanState = currentState.reconfigure({ plugins });
          tiptapEditor.view.updateState(cleanState);
        }
      } catch (err) {
        console.warn(
          "[BlockNoteYjsBinding] Failed to unregister plugins:",
          err,
        );
      }
    }
  }
}
