import { NativeParamType, NativeParamValue, ParameterDescriptor } from './types';
import { ParameterRuntimeState } from './parameterStore';

export type ParameterTypeLabel = 'float32' | 'int32' | 'uint32' | 'bool';

export type ParameterView = {
  id: number;
  path: string;
  type: ParameterTypeLabel;
  writable: boolean;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  confirmedValue?: number | boolean;
  pending?: { requestedValue: number | boolean };
  lastError?: { detail: string };
};

export type NativeUiSessionState =
  | 'disconnected'
  | 'handshaking'
  | 'discovering'
  | 'ready'
  | 'incompatible'
  | 'discovery_failed';

function typeLabel(t: NativeParamType): ParameterTypeLabel {
  switch (t) {
    case NativeParamType.Float32:
      return 'float32';
    case NativeParamType.Int32:
      return 'int32';
    case NativeParamType.UInt32:
      return 'uint32';
    case NativeParamType.Bool:
      return 'bool';
    default:
      return 'float32';
  }
}

function num(v: NativeParamValue | undefined): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

export function toParameterView(st: ParameterRuntimeState): ParameterView {
  const d = st.descriptor;
  const view: ParameterView = {
    id: d.id,
    path: d.path,
    type: typeLabel(d.type),
    writable: d.writable,
    unit: d.unit,
    min: num(d.min),
    max: num(d.max),
    step: num(d.step),
  };
  if (st.confirmedValue !== undefined) view.confirmedValue = st.confirmedValue;
  if (st.pending) view.pending = { requestedValue: st.pending.requestedValue };
  if (st.lastError) view.lastError = { detail: st.lastError.detail ?? `code ${st.lastError.code}` };
  return view;
}

export function formatParamValue(v: number | boolean | undefined, type: ParameterTypeLabel): string {
  if (v === undefined) return '';
  if (type === 'bool') return v ? 'true' : 'false';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (type === 'int32' || type === 'uint32') return String(Math.trunc(n));
  if (Number.isInteger(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 0.001 || abs >= 1e6)) return n.toExponential(4);
  // compact float
  const s = n.toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

export type ParamTreeNode = {
  name: string;
  fullPath: string;
  children: ParamTreeNode[];
  parameter?: ParameterView;
};

export function buildParamTree(params: ParameterView[]): ParamTreeNode[] {
  const root: ParamTreeNode[] = [];
  const nodeMap = new Map<string, ParamTreeNode>();
  const ensure = (fullPath: string, name: string): ParamTreeNode => {
    let n = nodeMap.get(fullPath);
    if (n) return n;
    n = { name, fullPath, children: [] };
    nodeMap.set(fullPath, n);
    const parentPath = fullPath.includes('.') ? fullPath.slice(0, fullPath.lastIndexOf('.')) : '';
    if (parentPath) {
      const parentName = parentPath.slice(parentPath.lastIndexOf('.') + 1);
      ensure(parentPath, parentName).children.push(n);
    } else {
      root.push(n);
    }
    return n;
  };
  const sorted = [...params].sort((a, b) => a.path.localeCompare(b.path));
  for (const p of sorted) {
    const parts = p.path.split('.').filter(Boolean);
    if (!parts.length) continue;
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}.${parts[i]}` : parts[i]!;
      ensure(acc, parts[i]!);
    }
    const leafName = parts[parts.length - 1]!;
    const leafPath = parts.join('.');
    const leaf = ensure(leafPath, leafName);
    leaf.parameter = p;
  }
  return root;
}

export function searchParameters(params: ParameterView[], query: string): ParameterView[] {
  const q = query.trim().toLowerCase();
  if (!q) return params;
  return params.filter((p) => {
    if (p.path.toLowerCase().includes(q)) return true;
    const leaf = p.path.slice(p.path.lastIndexOf('.') + 1).toLowerCase();
    if (leaf.includes(q)) return true;
    if (p.unit && p.unit.toLowerCase().includes(q)) return true;
    return false;
  });
}

/** Local UX validation only — Host NativeSession remains authoritative. */
export function validateSetInput(
  view: Pick<ParameterView, 'type' | 'writable' | 'min' | 'max'>,
  raw: string | number | boolean
): { ok: true; value: number | boolean } | { ok: false; error: string } {
  if (!view.writable) return { ok: false, error: 'read-only' };
  if (view.type === 'bool') {
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    const s = String(raw).toLowerCase();
    if (s === 'true' || s === '1') return { ok: true, value: true };
    if (s === 'false' || s === '0') return { ok: true, value: false };
    return { ok: false, error: 'bool required' };
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { ok: false, error: 'finite number required' };
  if (view.type === 'int32' || view.type === 'uint32') {
    if (!Number.isInteger(n)) return { ok: false, error: 'integer required' };
  }
  if (view.type === 'uint32' && n < 0) return { ok: false, error: 'uint32 must be >= 0' };
  if (view.min !== undefined && n < view.min) return { ok: false, error: `below min ${view.min}` };
  if (view.max !== undefined && n > view.max) return { ok: false, error: `above max ${view.max}` };
  return { ok: true, value: n };
}

export function isParameterTypeLabel(t: string): t is ParameterTypeLabel {
  return t === 'float32' || t === 'int32' || t === 'uint32' || t === 'bool';
}

export function parseWebviewSetValue(
  id: unknown,
  value: unknown
): { ok: true; parameterId: number; value: number | boolean } | { ok: false; error: string } {
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > 65535) {
    return { ok: false, error: 'invalid parameterId' };
  }
  if (typeof value === 'boolean') return { ok: true, parameterId: id, value };
  if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, parameterId: id, value };
  return { ok: false, error: 'invalid value' };
}

export type { ParameterDescriptor };
