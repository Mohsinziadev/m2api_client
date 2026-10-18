'use client';

import { useState } from 'react';
import { IconChevronRight } from '../icons';

const PAGE = 100;

export interface JsonTreeProps {
  value: unknown;
  /** Levels expanded initially. Default 2. */
  defaultExpandDepth?: number;
  /** Change to force all nodes open (`true`) or closed (`false`). */
  expandAll?: { open: boolean; version: number };
}

/** Collapsible JSON viewer. Large arrays/objects render in pages of 100 children. */
export function JsonTree({ value, defaultExpandDepth = 2, expandAll }: JsonTreeProps) {
  return (
    <div className="m2a-tree" role="group" aria-label="JSON tree">
      <Node name={null} value={value} depth={0} defaultExpandDepth={defaultExpandDepth} expandAll={expandAll} last />
    </div>
  );
}

interface NodeProps {
  name: string | number | null;
  value: unknown;
  depth: number;
  defaultExpandDepth: number;
  expandAll?: { open: boolean; version: number };
  last: boolean;
}

function Node({ name, value, depth, defaultExpandDepth, expandAll, last }: NodeProps) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object';
  const initialOpen = expandAll ? expandAll.open : depth < defaultExpandDepth;
  // Re-sync with "expand all / collapse all" by keying local state on the version.
  const [state, setState] = useState({ open: initialOpen, version: expandAll?.version ?? 0, shown: PAGE });
  let { open } = state;
  if (expandAll && expandAll.version !== state.version) {
    open = expandAll.open;
    setState({ open, version: expandAll.version, shown: state.shown });
  }

  const label =
    name === null ? null : (
      <span className="m2a-tree-key">
        {typeof name === 'number' ? name : JSON.stringify(name)}
        <span className="m2a-tok-punct">: </span>
      </span>
    );
  const comma = last ? null : <span className="m2a-tok-punct">,</span>;

  if (!isObject) {
    return (
      <div className="m2a-tree-row" style={{ paddingLeft: depth * 14 + 18 }}>
        {label}
        <Primitive value={value} />
        {comma}
      </div>
    );
  }

  const entries: Array<[string | number, unknown]> = isArray ? (value as unknown[]).map((v, i) => [i, v]) : Object.entries(value as object);
  const [openBracket, closeBracket] = isArray ? ['[', ']'] : ['{', '}'];
  const toggle = () => setState((s) => ({ ...s, open: !s.open }));

  if (entries.length === 0) {
    return (
      <div className="m2a-tree-row" style={{ paddingLeft: depth * 14 + 18 }}>
        {label}
        <span className="m2a-tok-punct">
          {openBracket}
          {closeBracket}
        </span>
        {comma}
      </div>
    );
  }

  return (
    <div>
      <div className="m2a-tree-row" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          className="m2a-tree-toggle"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${name ?? 'root'}`}
          onClick={toggle}
        >
          <IconChevronRight size={12} />
        </button>
        {label}
        <span className="m2a-tok-punct">{openBracket}</span>
        {!open && (
          <button type="button" className="m2a-tree-summary" onClick={toggle} tabIndex={-1}>
            {isArray
              ? `${entries.length} item${entries.length === 1 ? '' : 's'}`
              : `${entries.length} key${entries.length === 1 ? '' : 's'}`}
          </button>
        )}
        {!open && <span className="m2a-tok-punct">{closeBracket}</span>}
        {!open && comma}
      </div>
      {open && (
        <>
          {entries.slice(0, state.shown).map(([k, v], i) => (
            <Node
              key={k}
              name={k}
              value={v}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
              expandAll={expandAll}
              last={i === Math.min(entries.length, state.shown) - 1 && state.shown >= entries.length}
            />
          ))}
          {entries.length > state.shown && (
            <div className="m2a-tree-row" style={{ paddingLeft: (depth + 1) * 14 + 18 }}>
              <button type="button" className="m2a-link-btn" onClick={() => setState((s) => ({ ...s, shown: s.shown + PAGE * 5 }))}>
                Show {Math.min(PAGE * 5, entries.length - state.shown)} more of {entries.length - state.shown}
              </button>
            </div>
          )}
          <div className="m2a-tree-row" style={{ paddingLeft: depth * 14 + 18 }}>
            <span className="m2a-tok-punct">{closeBracket}</span>
            {comma}
          </div>
        </>
      )}
    </div>
  );
}

function Primitive({ value }: { value: unknown }) {
  if (typeof value === 'string') return <span className="m2a-tok-string">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="m2a-tok-number">{String(value)}</span>;
  return <span className="m2a-tok-literal">{String(value)}</span>;
}
