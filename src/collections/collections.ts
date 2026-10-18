import type { RequestDefinition, Variable } from '../core/types';
import { cloneRequest } from '../core/request';
import { createId } from '../utils/id';

export interface CollectionFolder {
  type: 'folder';
  id: string;
  name: string;
  items: CollectionNode[];
}

/** A saved request. It is a full {@link RequestDefinition} tagged with `type: 'request'`. */
export interface CollectionRequest extends RequestDefinition {
  type: 'request';
}

export type CollectionNode = CollectionFolder | CollectionRequest;

export interface Collection {
  id: string;
  name: string;
  description?: string;
  /** Collection-scoped variables (below the active environment in precedence). */
  variables: Variable[];
  items: CollectionNode[];
}

export interface NodeLocation {
  collection: Collection;
  node: CollectionNode;
  /** Folder ids from the collection root to the node's parent. */
  path: string[];
}

// All operations are pure: they return new arrays and never mutate their input.

export function createCollection(name: string, init: Partial<Omit<Collection, 'name'>> = {}): Collection {
  return { id: createId('col'), name, variables: [], items: [], ...init };
}

export function createFolder(name: string, items: CollectionNode[] = []): CollectionFolder {
  return { type: 'folder', id: createId('fld'), name, items };
}

export function toCollectionRequest(request: RequestDefinition): CollectionRequest {
  return { ...request, type: 'request' };
}

/** Strips the `type` tag, returning a plain request definition. */
export function toRequestDefinition(node: CollectionRequest): RequestDefinition {
  const { type: _type, ...request } = node;
  return request;
}

export function findNode(collections: readonly Collection[], nodeId: string): NodeLocation | undefined {
  for (const collection of collections) {
    const search = (items: CollectionNode[], path: string[]): NodeLocation | undefined => {
      for (const node of items) {
        if (node.id === nodeId) return { collection, node, path };
        if (node.type === 'folder') {
          const found = search(node.items, [...path, node.id]);
          if (found) return found;
        }
      }
      return undefined;
    };
    const found = search(collection.items, []);
    if (found) return found;
  }
  return undefined;
}

function mapItems(
  items: CollectionNode[],
  fn: (items: CollectionNode[], parentId: string | null) => CollectionNode[],
  parentId: string | null = null,
): CollectionNode[] {
  const mapped = items.map((node) => (node.type === 'folder' ? { ...node, items: mapItems(node.items, fn, node.id) } : node));
  return fn(mapped, parentId);
}

function updateCollection(collections: readonly Collection[], collectionId: string, fn: (c: Collection) => Collection): Collection[] {
  return collections.map((c) => (c.id === collectionId ? fn(c) : c));
}

export function renameCollection(collections: readonly Collection[], collectionId: string, name: string): Collection[] {
  return updateCollection(collections, collectionId, (c) => ({ ...c, name }));
}

export function updateCollectionVariables(collections: readonly Collection[], collectionId: string, variables: Variable[]): Collection[] {
  return updateCollection(collections, collectionId, (c) => ({ ...c, variables }));
}

export function removeCollection(collections: readonly Collection[], collectionId: string): Collection[] {
  return collections.filter((c) => c.id !== collectionId);
}

export function duplicateCollection(collections: readonly Collection[], collectionId: string): Collection[] {
  const index = collections.findIndex((c) => c.id === collectionId);
  if (index === -1) return [...collections];
  const source = collections[index];
  const copy: Collection = {
    ...source,
    id: createId('col'),
    name: `${source.name} copy`,
    items: source.items.map(cloneNode),
    variables: source.variables.map((v) => ({ ...v })),
  };
  return [...collections.slice(0, index + 1), copy, ...collections.slice(index + 1)];
}

/** Adds `node` to the collection root, or inside `parentId` when given. */
export function addNode(
  collections: readonly Collection[],
  collectionId: string,
  node: CollectionNode,
  parentId: string | null = null,
): Collection[] {
  return updateCollection(collections, collectionId, (c) => {
    if (!parentId) return { ...c, items: [...c.items, node] };
    return {
      ...c,
      items: mapItems(c.items, (items) =>
        items.map((n) => (n.type === 'folder' && n.id === parentId ? { ...n, items: [...n.items, node] } : n)),
      ),
    };
  });
}

export function updateNode(collections: readonly Collection[], nodeId: string, fn: (node: CollectionNode) => CollectionNode): Collection[] {
  return collections.map((c) => ({ ...c, items: mapItems(c.items, (items) => items.map((n) => (n.id === nodeId ? fn(n) : n))) }));
}

export function renameNode(collections: readonly Collection[], nodeId: string, name: string): Collection[] {
  return updateNode(collections, nodeId, (n) => ({ ...n, name }));
}

export function removeNode(collections: readonly Collection[], nodeId: string): Collection[] {
  return collections.map((c) => ({ ...c, items: mapItems(c.items, (items) => items.filter((n) => n.id !== nodeId)) }));
}

/** Deep copy with fresh ids. */
export function cloneNode(node: CollectionNode): CollectionNode {
  if (node.type === 'folder') return { ...node, id: createId('fld'), items: node.items.map(cloneNode) };
  return toCollectionRequest(cloneRequest(toRequestDefinition(node)));
}

/** Inserts a copy right after the original and returns the new collections plus the copy's id. */
export function duplicateNode(collections: readonly Collection[], nodeId: string): { collections: Collection[]; id: string | null } {
  let newId: string | null = null;
  const next = collections.map((c) => ({
    ...c,
    items: mapItems(c.items, (items) => {
      const index = items.findIndex((n) => n.id === nodeId);
      if (index === -1) return items;
      const copy = cloneNode(items[index]);
      copy.name = `${items[index].name || 'Untitled'} copy`;
      newId = copy.id;
      return [...items.slice(0, index + 1), copy, ...items.slice(index + 1)];
    }),
  }));
  return { collections: next, id: newId };
}

/** Moves a node to another collection/folder (appended). Moving a folder into itself is ignored. */
export function moveNode(
  collections: readonly Collection[],
  nodeId: string,
  target: { collectionId: string; parentId?: string | null },
): Collection[] {
  const location = findNode(collections, nodeId);
  if (!location) return [...collections];
  if (target.parentId && (target.parentId === nodeId || findNode([{ ...location.collection, items: [location.node] }], target.parentId)))
    return [...collections];
  return addNode(removeNode(collections, nodeId), target.collectionId, location.node, target.parentId ?? null);
}

/** Replaces the saved request with the same id, or adds it when it does not exist yet. */
export function saveRequestToCollection(
  collections: readonly Collection[],
  request: RequestDefinition,
  target: { collectionId: string; parentId?: string | null },
): Collection[] {
  const node = toCollectionRequest(request);
  if (findNode(collections, request.id)) return updateNode(collections, request.id, () => node);
  return addNode(collections, target.collectionId, node, target.parentId ?? null);
}

/** Every saved request, flattened, with its folder path names. */
export function listRequests(collection: Collection): Array<{ request: CollectionRequest; path: string[] }> {
  const out: Array<{ request: CollectionRequest; path: string[] }> = [];
  const walk = (items: CollectionNode[], path: string[]) => {
    for (const node of items) {
      if (node.type === 'request') out.push({ request: node, path });
      else walk(node.items, [...path, node.name]);
    }
  };
  walk(collection.items, []);
  return out;
}

export function countRequests(items: readonly CollectionNode[]): number {
  return items.reduce((n, node) => n + (node.type === 'request' ? 1 : countRequests(node.items)), 0);
}
