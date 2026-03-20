import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  ChevronDown, ChevronRight, Plus, Trash2, Copy,
  ArrowUp, ArrowDown, Download, GripVertical, FileText,
  Layers, ArrowRightLeft, Eye, Move, LayoutGrid,
  Upload, Clipboard, FileSpreadsheet, Image as ImageIcon, ChevronUp, PenLine, FileText as FileTextIcon,
  FilePlus, Check, Sprout, Sparkles
} from "lucide-react";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";
import { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, AlignmentType, TextRun, HeadingLevel, BorderStyle } from "docx";

// ─── Constants ───────────────────────────────────────────────────────────────
const DEPARTMENTS = ["Design & Production", "Project Management", "BD", "Compliance & Admin", "Other"];
const FREQUENCIES = ["Daily", "Weekly", "Per-project", "Ad-hoc"];
const OPERATORS = ["Human Only", "Human+AI", "AI-Led", "Full Auto"];
const AI_TOOLS = ["Gemini", "Gemini Gem", "Google Workspace", "NotebookLM", "Google AI Studio", "n8n", "None", "Other"];
const ERROR_FREQS = ["Low", "Medium", "High"];
const MAX_STEPS = 20;

const PAIN = {
  1: { bg: "#DCFCE7", border: "#10B981" },
  2: { bg: "#DCFCE7", border: "#10B981" },
  3: { bg: "#FEF9C3", border: "#F59E0B" },
  4: { bg: "#FFEDD5", border: "#F97316" },
  5: { bg: "#FEE2E2", border: "#EF4444" },
};

const OP_STYLE = {
  "Human Only": { bg: "#1E2761", emoji: "\u{1F9E0}" },
  "Human+AI":   { bg: "#0D9488", emoji: "\u{1F91D}" },
  "AI-Led":     { bg: "#3B82F6", emoji: "\u{1F916}" },
  "Full Auto":  { bg: "#F96167", emoji: "\u26A1" },
};

let _uid = 100;
const uid = () => `s${_uid++}`;

// ─── localStorage persistence + migration ────────────────────────────────────
const STORAGE_KEY = "if-workflow-state";

function migrateV1(raw) {
  const stepsAsIs = raw.steps.map(s => ({
    id: s.id, name: s.name, description: s.description || "", owner: s.owner || "",
    timeHours: s.timeHours, painLevel: s.painLevel || 1,
    errorFrequency: s.errorFrequency || "Low", toolsUsed: s.toolsUsed || "",
  }));
  const hasToBeData = raw.steps.some(s =>
    s.operator !== "Human Only" || s.aiTool !== "None" || (s.newTimeHours != null && s.newTimeHours !== s.timeHours)
  );
  const stepsToBe = hasToBeData ? raw.steps.map(s => ({
    id: uid(), name: s.name, operator: s.operator || "Human Only",
    aiTool: (s.aiTool === "Workspace AI" ? "Google Workspace" : s.aiTool === "AI Studio" ? "Google AI Studio" : s.aiTool) || "None",
    aiAction: s.aiAction || "", humanCheck: s.humanCheck || "",
    timeHours: s.newTimeHours ?? s.timeHours,
  })) : null;
  return {
    version: 2, mode: raw.mode || "as-is", meta: raw.meta,
    stepsAsIs, stepsToBe,
    connectionsAsIs: raw.connections || null,
    connectionsToBe: hasToBeData ? raw.connections || null : null,
    nodeSizesAsIs: raw.nodeSizes || {}, nodeSizesToBe: {},
  };
}

function loadSaved() {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    if (!r) return null;
    let data = JSON.parse(r);
    // v1 migration
    if (!data.version || data.version < 2) {
      if (!data.steps || !Array.isArray(data.steps)) return null;
      data = migrateV1(data);
    }
    if (!data.stepsAsIs || !Array.isArray(data.stepsAsIs)) return null;
    // Restore _uid
    const allSteps = [...(data.stepsAsIs || []), ...(data.stepsToBe || [])];
    const maxId = allSteps.reduce((m, s) => {
      const n = parseInt(s.id.replace("s", ""), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    _uid = Math.max(_uid, maxId + 1);
    return data;
  } catch { return null; }
}

const _saved = loadSaved();

const tr = (s, n) => {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
};

const inputCls = "w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#F96167]/20 focus:border-[#F96167] transition-colors";
const labelCls = "block text-xs font-medium text-slate-500 mb-1";
const FONT = "system-ui, -apple-system, sans-serif";

// ─── Starter Data ────────────────────────────────────────────────────────────
const INIT_META = {
  workflowName: "Proposal Writing",
  teamName: "Design Team",
  department: "BD",
  frequency: "Per-project",
};

const INIT_STEPS_AS_IS = [
  { id: "s1", name: "Receive Client Brief", description: "Receive and review incoming client brief", owner: "BD Team", timeHours: 0.5, painLevel: 1, errorFrequency: "Low", toolsUsed: "Email/LINE" },
  { id: "s2", name: "Research & Reference Projects", description: "Search for past project references and comparable work", owner: "Architect", timeHours: 3.0, painLevel: 4, errorFrequency: "Medium", toolsUsed: "Google Drive, manual search" },
  { id: "s3", name: "Draft Proposal Document", description: "Create the proposal document with project approach and references", owner: "Architect", timeHours: 4.0, painLevel: 5, errorFrequency: "High", toolsUsed: "Google Docs, InDesign" },
  { id: "s4", name: "Internal Review & Revision", description: "Senior team reviews and provides feedback", owner: "Senior Architect", timeHours: 2.0, painLevel: 3, errorFrequency: "Medium", toolsUsed: "Google Docs comments" },
];

// ─── SVG Layout Helpers ──────────────────────────────────────────────────────
const BOX = { w: 180, h: 140, gap: 36, cols: 6 };
const TBOX = { w: 180, h: 190, gap: 36, cols: 6 };
const CBOX = { w: 160, h: 95, gap: 26, cols: 6 };
const CTBOX = { w: 160, h: 120, gap: 26, cols: 6 };
const MIN_W = 120, MIN_H = 80;

function gridLayout(count, b) {
  const pos = [];
  for (let i = 0; i < count; i++) {
    const col = i % b.cols;
    const row = Math.floor(i / b.cols);
    pos.push({ x: col * (b.w + b.gap), y: row * (b.h + b.gap) });
  }
  return pos;
}

function nodeSize(stepId, b, nodeSizes, compact) {
  if (compact || !nodeSizes[stepId]) return { w: b.w, h: b.h };
  return nodeSizes[stepId];
}

function viewBoxFromPositions(positions, steps, b, nodeSizes, compact, pad) {
  if (!positions.length) return "0 0 400 200";
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  positions.forEach((p, i) => {
    const ns = steps[i] ? nodeSize(steps[i].id, b, nodeSizes, compact) : { w: b.w, h: b.h };
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + ns.w);
    y1 = Math.max(y1, p.y + ns.h);
  });
  return `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`;
}

// ─── Topological Sort ────────────────────────────────────────────────────────
function topoSort(steps, connections) {
  if (!connections || !connections.length) return steps;
  const ids = steps.map(s => s.id);
  const idSet = new Set(ids);
  const adj = new Map();
  const inDeg = new Map();
  ids.forEach(id => { adj.set(id, []); inDeg.set(id, 0); });
  connections.forEach(c => {
    if (idSet.has(c.from) && idSet.has(c.to)) {
      adj.get(c.from).push(c.to);
      inDeg.set(c.to, inDeg.get(c.to) + 1);
    }
  });
  const queue = [];
  inDeg.forEach((deg, id) => { if (deg === 0) queue.push(id); });
  const sorted = [];
  while (queue.length) {
    const id = queue.shift();
    sorted.push(id);
    for (const next of (adj.get(id) || [])) {
      inDeg.set(next, inDeg.get(next) - 1);
      if (inDeg.get(next) === 0) queue.push(next);
    }
  }
  const sortedSet = new Set(sorted);
  ids.forEach(id => { if (!sortedSet.has(id)) sorted.push(id); });
  const stepMap = new Map(steps.map(s => [s.id, s]));
  return sorted.map(id => stepMap.get(id)).filter(Boolean);
}

// ─── SVG Shared Components ──────────────────────────────────────────────────
function SvgDefs() {
  return (
    <defs>
      <marker id="ah" viewBox="0 0 12 8" refX="11" refY="4" markerWidth="9" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L12 4 L0 8Z" fill="#94A3B8" />
      </marker>
      <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="10" cy="10" r="0.7" fill="#E2E8F0" />
      </pattern>
      <filter id="bshadow" x="-8%" y="-8%" width="116%" height="124%">
        <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.08" />
      </filter>
    </defs>
  );
}

function PainDots({ x, y, level, r: radius }) {
  const rr = radius || 4;
  return <>
    {[1,2,3,4,5].map(i => (
      <circle key={i} cx={x + (i - 1) * (rr * 2 + 3)} cy={y} r={rr}
        fill={i <= level ? PAIN[level].border : "#E2E8F0"} />
    ))}
  </>;
}

// ─── Arrows (Connection-based) ──────────────────────────────────────────────
function Arrows({ steps, positions, b, nodeSizes, compact, connections, dashedIds, onDeleteConnection }) {
  const [hovered, setHovered] = useState(null);

  return <>
    {(connections || []).map((conn, ci) => {
      const fromIdx = steps.findIndex(s => s.id === conn.from);
      const toIdx = steps.findIndex(s => s.id === conn.to);
      if (fromIdx < 0 || toIdx < 0) return null;
      const fromPos = positions[fromIdx];
      const toPos = positions[toIdx];
      if (!fromPos || !toPos) return null;

      const fs = nodeSize(conn.from, b, nodeSizes, compact);
      const ts = nodeSize(conn.to, b, nodeSizes, compact);

      const x1r = fromPos.x + fs.w;
      const y1m = fromPos.y + fs.h / 2;
      const x1m = fromPos.x + fs.w / 2;
      const y1b = fromPos.y + fs.h;
      const x2l = toPos.x;
      const y2m = toPos.y + ts.h / 2;
      const x2m = toPos.x + ts.w / 2;
      const y2t = toPos.y;

      let d, midX, midY;
      if (toPos.y > fromPos.y + fs.h * 0.5 && x2l < x1r - 20) {
        // Different row: route bottom-center → top-center with vertical S-curve
        const gapY = y2t - y1b;
        const cpDist = Math.max(gapY * 0.6, 40);
        d = `M ${x1m} ${y1b} C ${x1m} ${y1b + cpDist}, ${x2m} ${y2t - cpDist}, ${x2m} ${y2t}`;
        midX = (x1m + x2m) / 2;
        midY = (y1b + y2t) / 2;
      } else {
        // Same row: standard right → left horizontal bezier
        const dx = Math.abs(x2l - x1r);
        const cpOff = Math.max(dx * 0.45, 40);
        d = `M ${x1r} ${y1m} C ${x1r + cpOff} ${y1m}, ${x2l - cpOff} ${y2m}, ${x2l} ${y2m}`;
        midX = (x1r + x2l) / 2;
        midY = (y1m + y2m) / 2;
      }
      const isDashed = dashedIds ? (dashedIds.has(conn.from) || dashedIds.has(conn.to)) : false;
      const isHov = hovered === ci;

      return (
        <g key={`${conn.from}-${conn.to}-${ci}`}
          onMouseEnter={() => setHovered(ci)} onMouseLeave={() => setHovered(null)}>
          <path d={d} fill="none" stroke="transparent" strokeWidth={30} style={{ cursor: "pointer" }} />
          {isHov && <path d={d} fill="none" stroke="#F96167" strokeWidth={6} opacity={0.2} />}
          <path d={d} fill="none" stroke={isHov ? "#F96167" : "#94A3B8"} strokeWidth={isHov ? 3 : 2}
            markerEnd="url(#ah)" strokeDasharray={isDashed ? "6 4" : "none"}
            style={{ transition: "stroke 0.15s, stroke-width 0.15s" }} />
          {isHov && onDeleteConnection && (
            <g transform={`translate(${midX},${midY})`}
              onClick={e => { e.stopPropagation(); setHovered(null); onDeleteConnection(ci); }}
              style={{ cursor: "pointer" }}>
              <circle r={14} fill="#EF4444" stroke="#fff" strokeWidth={2.5} />
              <line x1={-5} y1={-5} x2={5} y2={5} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
              <line x1={5} y1={-5} x2={-5} y2={5} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
            </g>
          )}
        </g>
      );
    })}
  </>;
}

// ─── Temp Connecting Line ───────────────────────────────────────────────────
function ConnectingLine({ fromStepId, mousePos, steps, positions, b, nodeSizes, compact }) {
  const fromIdx = steps.findIndex(s => s.id === fromStepId);
  if (fromIdx < 0 || !positions[fromIdx] || !mousePos) return null;
  const fp = positions[fromIdx];
  const fs = nodeSize(fromStepId, b, nodeSizes, compact);
  const x1 = fp.x + fs.w;
  const y1 = fp.y + fs.h / 2;
  const x2 = mousePos.x;
  const y2 = mousePos.y;
  const dx = Math.abs(x2 - x1);
  const cpOff = Math.max(dx * 0.45, 40);
  const d = `M ${x1} ${y1} C ${x1 + cpOff} ${y1}, ${x2 - cpOff} ${y2}, ${x2} ${y2}`;
  return <path d={d} fill="none" stroke="#94A3B8" strokeWidth={2} strokeDasharray="6 4" opacity={0.5} />;
}

// ─── Drag / Resize / Connect Hook ───────────────────────────────────────────
function useDrag(steps, b, tidyKey, nodeSizes, compact, onResizeNode, onConnect, connections) {
  const defaultPos = useMemo(() => {
    const sorted = topoSort(steps, connections);
    const orderMap = new Map(sorted.map((s, i) => [s.id, i]));
    const pos = [];
    for (let i = 0; i < steps.length; i++) {
      const gridIdx = orderMap.get(steps[i].id) ?? i;
      const col = gridIdx % b.cols;
      const row = Math.floor(gridIdx / b.cols);
      pos.push({ x: col * (b.w + b.gap), y: row * (b.h + b.gap) });
    }
    return pos;
  }, [steps, b, connections]);
  const [customPos, setCustomPos] = useState(null);
  const interRef = useRef(null);
  const svgRef = useRef(null);
  const [connectFrom, setConnectFrom] = useState(null);
  const [connectMouse, setConnectMouse] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [selectedNode, setSelectedNode] = useState(null);
  const dragStartRef = useRef(null);
  const stepsKey = steps.map(s => s.id).join(",");
  const prevStepsRef = useRef(steps.map(s => s.id));

  useEffect(() => {
    const prevIds = prevStepsRef.current;
    const curIds = steps.map(s => s.id);
    prevStepsRef.current = curIds;

    // If steps were removed or reordered, recalculate all positions
    const removed = prevIds.some(id => !curIds.includes(id));
    if (removed) { setCustomPos(null); return; }

    // If steps were added and we have custom positions, append new positions
    const added = curIds.length > prevIds.length;
    if (added && customPos) {
      setCustomPos(prev => {
        if (!prev) return null;
        const next = [...prev];
        for (let i = prev.length; i < steps.length; i++) {
          const col = i % b.cols;
          const row = Math.floor(i / b.cols);
          next.push({ x: col * (b.w + b.gap), y: row * (b.h + b.gap) });
        }
        return next;
      });
    } else if (added) {
      // No custom positions yet — defaultPos will auto-recalculate, nothing to do
    }
  }, [stepsKey]);
  useEffect(() => { setCustomPos(null); setConnectFrom(null); setConnectMouse(null); }, [tidyKey]);
  // Clear selection if step removed
  useEffect(() => {
    if (selectedNode && !steps.find(s => s.id === selectedNode)) setSelectedNode(null);
  }, [steps, selectedNode]);

  const pos = customPos || defaultPos;

  const toSvg = useCallback((e) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }, []);

  const onNodeDown = useCallback((e, idx) => {
    e.preventDefault();
    e.stopPropagation();
    const sp = toSvg(e);
    const p = pos[idx];
    dragStartRef.current = { x: e.clientX, y: e.clientY, idx, moved: false };
    interRef.current = { type: "drag", idx, ox: sp.x - p.x, oy: sp.y - p.y };
    if (!customPos) setCustomPos(defaultPos.map(p => ({ ...p })));
  }, [pos, customPos, defaultPos, toSvg]);

  const onResizeDown = useCallback((e, idx) => {
    e.preventDefault();
    e.stopPropagation();
    if (compact) return;
    const sp = toSvg(e);
    const ns = nodeSize(steps[idx].id, b, nodeSizes, compact);
    interRef.current = { type: "resize", idx, startX: sp.x, startY: sp.y, origW: ns.w, origH: ns.h };
  }, [toSvg, steps, b, nodeSizes, compact]);

  const onPortDown = useCallback((e, stepId) => {
    e.preventDefault();
    e.stopPropagation();
    setConnectFrom(stepId);
    setConnectMouse(toSvg(e));
  }, [toSvg]);

  const onPortUp = useCallback((e, stepId) => {
    e.stopPropagation();
    if (connectFrom && connectFrom !== stepId) {
      onConnect?.(connectFrom, stepId);
    }
    setConnectFrom(null);
    setConnectMouse(null);
  }, [connectFrom, onConnect]);

  const onMove = useCallback((e) => {
    if (connectFrom) {
      e.preventDefault();
      setConnectMouse(toSvg(e));
      return;
    }
    if (!interRef.current) {
      // Pan with middle mouse button or shift+left
      if ((e.buttons === 4) || (e.buttons === 1 && e.shiftKey)) {
        e.preventDefault();
        setPanOffset(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
        return;
      }
      return;
    }
    e.preventDefault();
    // Track if drag moved significantly
    if (dragStartRef.current && !dragStartRef.current.moved) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragStartRef.current.moved = true;
    }
    const sp = toSvg(e);
    if (interRef.current.type === "drag") {
      const { idx, ox, oy } = interRef.current;
      setCustomPos(prev => {
        const next = [...(prev || defaultPos.map(p => ({ ...p })))];
        next[idx] = { x: sp.x - ox, y: sp.y - oy };
        return next;
      });
    } else if (interRef.current.type === "resize") {
      const { idx, startX, startY, origW, origH } = interRef.current;
      const newW = Math.max(MIN_W, origW + (sp.x - startX));
      const newH = Math.max(MIN_H, origH + (sp.y - startY));
      onResizeNode?.(steps[idx].id, newW, newH);
    }
  }, [toSvg, defaultPos, connectFrom, steps, onResizeNode]);

  const onUp = useCallback(() => {
    // If node was clicked without significant drag, select/deselect it
    if (dragStartRef.current && !dragStartRef.current.moved) {
      const clickedId = steps[dragStartRef.current.idx]?.id;
      if (clickedId) {
        setSelectedNode(prev => prev === clickedId ? null : clickedId);
      }
    }
    interRef.current = null;
    dragStartRef.current = null;
    setConnectFrom(null);
    setConnectMouse(null);
  }, [steps]);

  const onBgClick = useCallback((e) => {
    // Only deselect if clicking directly on the SVG background (not on a node)
    if (e.target.tagName === 'rect' && e.target.getAttribute('fill') === 'url(#dots)') {
      setSelectedNode(null);
    }
  }, []);

  const onWheel = useCallback((e) => {
    if (!e.ctrlKey && !e.metaKey) return; // Allow normal scroll; only Ctrl+scroll zooms
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.min(3.0, Math.max(0.3, Math.round((prev + delta) * 10) / 10)));
  }, []);

  const zoomIn = useCallback(() => setZoom(prev => Math.min(3.0, Math.round((prev + 0.2) * 10) / 10)), []);
  const zoomOut = useCallback(() => setZoom(prev => Math.max(0.3, Math.round((prev - 0.2) * 10) / 10)), []);
  const zoomReset = useCallback(() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }, []);

  return { pos, svgRef, onNodeDown, onResizeDown, onPortDown, onPortUp, onMove, onUp, onBgClick, onWheel, connectFrom, connectMouse, zoom, panOffset, zoomIn, zoomOut, zoomReset, selectedNode, setSelectedNode };
}

// ─── As-Is Flowchart ─────────────────────────────────────────────────────────
function AsIsChart({ steps, compact, connections, nodeSizes, tidyKey, onDeleteConnection, onConnect, onResizeNode, onDeleteStep, selectedNode: externalSelected, onSelectNode }) {
  const b = compact ? CBOX : BOX;
  const { pos, svgRef, onNodeDown, onResizeDown, onPortDown, onPortUp, onMove, onUp, onBgClick, onWheel, connectFrom, connectMouse, zoom, panOffset, zoomIn, zoomOut, zoomReset, selectedNode, setSelectedNode } =
    useDrag(steps, b, tidyKey, nodeSizes, compact, onResizeNode, onConnect, connections);
  const pad = compact ? 40 : 60;
  const vb = viewBoxFromPositions(pos, steps, b, nodeSizes, compact, pad);

  // Parse viewBox for zoom
  const vbParts = vb.split(/[\s,]+/).map(Number);
  const zVb = `${vbParts[0] - panOffset.x / zoom} ${vbParts[1] - panOffset.y / zoom} ${vbParts[2] / zoom} ${vbParts[3] / zoom}`;

  const handleKeyDown = useCallback((e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedNode && onDeleteStep) {
      e.preventDefault();
      onDeleteStep(selectedNode);
      setSelectedNode(null);
    }
    if (e.key === "Escape") setSelectedNode(null);
    if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomIn(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "-") { e.preventDefault(); zoomOut(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "0") { e.preventDefault(); zoomReset(); }
  }, [selectedNode, onDeleteStep, setSelectedNode, zoomIn, zoomOut, zoomReset]);

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={zVb} className="w-full h-auto focus:outline-none" xmlns="http://www.w3.org/2000/svg"
        onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onClick={onBgClick}
        onWheel={onWheel} tabIndex={0} onKeyDown={handleKeyDown}
        style={{ minHeight: 200 }}>
        <SvgDefs />
        <rect x={-9999} y={-9999} width={99999} height={99999} fill="url(#dots)" />
        <Arrows steps={steps} positions={pos} b={b} nodeSizes={nodeSizes} compact={compact}
          connections={connections} onDeleteConnection={onDeleteConnection} />
        <ConnectingLine fromStepId={connectFrom} mousePos={connectMouse}
          steps={steps} positions={pos} b={b} nodeSizes={nodeSizes} compact={compact} />

        {steps.map((s, i) => {
          const p = pos[i];
          if (!p) return null;
          const ns = nodeSize(s.id, b, nodeSizes, compact);
          const ps = PAIN[s.painLevel] || PAIN[1];
          const px = 14;
          const isSelected = selectedNode === s.id;

          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`}>
              {isSelected && (
                <rect x={-4} y={-4} width={ns.w + 8} height={ns.h + 8} rx={12}
                  fill="none" stroke="#3B82F6" strokeWidth={3} strokeDasharray="6 3" opacity={0.8}>
                  <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1s" repeatCount="indefinite" />
                </rect>
              )}
              <rect width={ns.w} height={ns.h} rx={10} fill={ps.bg} stroke={isSelected ? "#3B82F6" : ps.border} strokeWidth={isSelected ? 3 : 2}
                filter="url(#bshadow)" onMouseDown={e => onNodeDown(e, i)} style={{ cursor: "grab" }} />

              {compact ? (
                <>
                  <foreignObject x={px} y={8} width={ns.w - px * 2} height={30}>
                    <div xmlns="http://www.w3.org/1999/xhtml" style={{
                      fontSize: 12, fontWeight: 700, color: "#1E293B", fontFamily: FONT,
                      wordWrap: "break-word", overflowWrap: "break-word", overflow: "hidden",
                      lineHeight: "1.3", display: "-webkit-box",
                      WebkitLineClamp: 2, WebkitBoxOrient: "vertical"
                    }}>{s.name || "Untitled"}</div>
                  </foreignObject>
                  <text x={px} y={52} fontSize={10} fill="#64748B" fontFamily={FONT}>{tr(s.owner, 24)}</text>
                  <text x={px} y={67} fontSize={10} fill="#1E293B" fontFamily={FONT}>{"\u23F1"} {s.timeHours}h</text>
                  <PainDots x={px} y={82} level={s.painLevel} r={3.5} />
                </>
              ) : (
                <>
                  <foreignObject x={px} y={10} width={ns.w - px * 2} height={42}>
                    <div xmlns="http://www.w3.org/1999/xhtml" style={{
                      fontSize: 14, fontWeight: 700, color: "#1E293B", fontFamily: FONT,
                      wordWrap: "break-word", overflowWrap: "break-word", overflow: "hidden",
                      lineHeight: "1.3", display: "-webkit-box",
                      WebkitLineClamp: 2, WebkitBoxOrient: "vertical"
                    }}>{s.name || "Untitled"}</div>
                  </foreignObject>
                  <text x={px} y={64} fontSize={12} fill="#64748B" fontFamily={FONT}>{tr(s.owner, Math.floor(ns.w / 8))}</text>
                  <text x={px} y={84} fontSize={10} fill="#94A3B8" fontFamily={FONT}>{tr(s.toolsUsed, Math.floor(ns.w / 7))}</text>
                  <text x={px} y={106} fontSize={12} fill="#1E293B" fontFamily={FONT}>{"\u23F1"} {s.timeHours} hrs</text>
                  <PainDots x={px} y={124} level={s.painLevel} r={4} />
                </>
              )}

              <circle cx={0} cy={ns.h / 2} r={6} fill="#fff" stroke="#94A3B8" strokeWidth={1.5}
                onMouseUp={e => onPortUp(e, s.id)} style={{ cursor: "crosshair" }} />
              <circle cx={ns.w} cy={ns.h / 2} r={6} fill="#fff" stroke="#94A3B8" strokeWidth={1.5}
                onMouseDown={e => onPortDown(e, s.id)} style={{ cursor: "crosshair" }} />

              {!compact && (
                <path d={`M ${ns.w - 14} ${ns.h} L ${ns.w} ${ns.h - 14} L ${ns.w} ${ns.h} Z`}
                  fill="rgba(0,0,0,0.1)" style={{ cursor: "nwse-resize" }}
                  onMouseDown={e => onResizeDown(e, i)} />
              )}
            </g>
          );
        })}
      </svg>
      {!compact && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-lg border border-slate-200 shadow-sm px-1 py-1">
          <button onClick={zoomOut} className="w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 text-sm font-bold" title="Zoom out (Ctrl+-)">−</button>
          <span className="text-xs text-slate-500 w-10 text-center font-medium">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} className="w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 text-sm font-bold" title="Zoom in (Ctrl+=)">+</button>
          <button onClick={zoomReset} className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 text-[10px] font-medium" title="Reset zoom (Ctrl+0)">Fit</button>
        </div>
      )}
    </div>
  );
}

// ─── To-Be Flowchart ─────────────────────────────────────────────────────────
function ToBeChart({ steps, compact, connections, nodeSizes, tidyKey, onDeleteConnection, onConnect, onResizeNode, onDeleteStep }) {
  const b = compact ? CTBOX : TBOX;
  const { pos, svgRef, onNodeDown, onResizeDown, onPortDown, onPortUp, onMove, onUp, onBgClick, onWheel, connectFrom, connectMouse, zoom, panOffset, zoomIn, zoomOut, zoomReset, selectedNode, setSelectedNode } =
    useDrag(steps, b, tidyKey, nodeSizes, compact, onResizeNode, onConnect, connections);
  const pad = compact ? 40 : 60;
  const vb = viewBoxFromPositions(pos, steps, b, nodeSizes, compact, pad);

  const vbParts = vb.split(/[\s,]+/).map(Number);
  const zVb = `${vbParts[0] - panOffset.x / zoom} ${vbParts[1] - panOffset.y / zoom} ${vbParts[2] / zoom} ${vbParts[3] / zoom}`;

  const autoOps = new Set(["AI-Led", "Full Auto"]);
  const dashedIds = new Set(steps.filter(s => autoOps.has(s.operator)).map(s => s.id));

  const handleKeyDown = useCallback((e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedNode && onDeleteStep) {
      e.preventDefault();
      onDeleteStep(selectedNode);
      setSelectedNode(null);
    }
    if (e.key === "Escape") setSelectedNode(null);
    if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomIn(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "-") { e.preventDefault(); zoomOut(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "0") { e.preventDefault(); zoomReset(); }
  }, [selectedNode, onDeleteStep, setSelectedNode, zoomIn, zoomOut, zoomReset]);

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={zVb} className="w-full h-auto focus:outline-none" xmlns="http://www.w3.org/2000/svg"
        onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onClick={onBgClick}
        onWheel={onWheel} tabIndex={0} onKeyDown={handleKeyDown}
        style={{ minHeight: 200 }}>
        <SvgDefs />
        <rect x={-9999} y={-9999} width={99999} height={99999} fill="url(#dots)" />
        <Arrows steps={steps} positions={pos} b={b} nodeSizes={nodeSizes} compact={compact}
          connections={connections} dashedIds={dashedIds} onDeleteConnection={onDeleteConnection} />
        <ConnectingLine fromStepId={connectFrom} mousePos={connectMouse}
          steps={steps} positions={pos} b={b} nodeSizes={nodeSizes} compact={compact} />

        {steps.map((s, i) => {
          const p = pos[i];
          if (!p) return null;
          const ns = nodeSize(s.id, b, nodeSizes, compact);
          const os = OP_STYLE[s.operator] || OP_STYLE["Human Only"];
          const px = 14;
          const isSelected = selectedNode === s.id;

          return (
            <g key={s.id} transform={`translate(${p.x},${p.y})`}>
              {isSelected && (
                <rect x={-4} y={-4} width={ns.w + 8} height={ns.h + 8} rx={12}
                  fill="none" stroke="#3B82F6" strokeWidth={3} strokeDasharray="6 3" opacity={0.8}>
                  <animate attributeName="stroke-dashoffset" from="0" to="-18" dur="1s" repeatCount="indefinite" />
                </rect>
              )}
              <rect width={ns.w} height={ns.h} rx={10} fill={os.bg}
                stroke={isSelected ? "#3B82F6" : "none"} strokeWidth={isSelected ? 3 : 0}
                filter="url(#bshadow)" onMouseDown={e => onNodeDown(e, i)} style={{ cursor: "grab" }} />

              {compact ? (
                <>
                  <text x={px} y={16} fontSize={10} fontWeight={600} fill="rgba(255,255,255,0.85)" fontFamily={FONT}>{os.emoji} {s.operator}</text>
                  <foreignObject x={px} y={20} width={ns.w - px * 2} height={26}>
                    <div xmlns="http://www.w3.org/1999/xhtml" style={{
                      fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: FONT,
                      wordWrap: "break-word", overflowWrap: "break-word", overflow: "hidden",
                      lineHeight: "1.2", display: "-webkit-box",
                      WebkitLineClamp: 2, WebkitBoxOrient: "vertical"
                    }}>{s.name || "Untitled"}</div>
                  </foreignObject>
                  <text x={px} y={58} fontSize={9} fill="rgba(255,255,255,0.7)" fontFamily={FONT}>{s.aiTool !== "None" ? s.aiTool : ""}</text>
                  {s.aiAction && (
                    <foreignObject x={px} y={62} width={ns.w - px * 2} height={22}>
                      <div xmlns="http://www.w3.org/1999/xhtml" style={{
                        fontSize: 8, color: "rgba(255,255,255,0.7)", fontFamily: FONT, fontStyle: "italic",
                        overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis"
                      }}>{"\u{1F916}"} {s.aiAction}</div>
                    </foreignObject>
                  )}
                  {s.humanCheck && (
                    <foreignObject x={px} y={s.aiAction ? 80 : 62} width={ns.w - px * 2} height={22}>
                      <div xmlns="http://www.w3.org/1999/xhtml" style={{
                        fontSize: 8, color: "rgba(255,255,255,0.7)", fontFamily: FONT, fontStyle: "italic",
                        overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis"
                      }}>{"\u2705"} {s.humanCheck}</div>
                    </foreignObject>
                  )}
                  <text x={px} y={ns.h - 8} fontSize={10} fill="rgba(255,255,255,0.9)" fontFamily={FONT}>{s.timeHours}h</text>
                </>
              ) : (
                <>
                  <text x={px} y={26} fontSize={12} fontWeight={600} fill="rgba(255,255,255,0.85)" fontFamily={FONT}>{os.emoji} {s.operator}</text>
                  <foreignObject x={px} y={32} width={ns.w - px * 2} height={42}>
                    <div xmlns="http://www.w3.org/1999/xhtml" style={{
                      fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: FONT,
                      wordWrap: "break-word", overflowWrap: "break-word", overflow: "hidden",
                      lineHeight: "1.3", display: "-webkit-box",
                      WebkitLineClamp: 2, WebkitBoxOrient: "vertical"
                    }}>{s.name || "Untitled"}</div>
                  </foreignObject>
                  <text x={px} y={86} fontSize={12} fill="rgba(255,255,255,0.7)" fontFamily={FONT}>{s.aiTool !== "None" ? s.aiTool : ""}</text>
                  {s.aiAction && (
                    <foreignObject x={px} y={92} width={ns.w - px * 2} height={30}>
                      <div xmlns="http://www.w3.org/1999/xhtml" style={{
                        fontSize: 10, color: "rgba(255,255,255,0.75)", fontFamily: FONT, fontStyle: "italic",
                        wordWrap: "break-word", overflowWrap: "break-word", overflow: "hidden",
                        lineHeight: "1.3", display: "-webkit-box",
                        WebkitLineClamp: 2, WebkitBoxOrient: "vertical"
                      }}>{"\u{1F916}"} {s.aiAction}</div>
                    </foreignObject>
                  )}
                  {s.humanCheck && (
                    <foreignObject x={px} y={s.aiAction ? 124 : 92} width={ns.w - px * 2} height={30}>
                      <div xmlns="http://www.w3.org/1999/xhtml" style={{
                        fontSize: 10, color: "rgba(255,255,255,0.75)", fontFamily: FONT, fontStyle: "italic",
                        wordWrap: "break-word", overflowWrap: "break-word", overflow: "hidden",
                        lineHeight: "1.3", display: "-webkit-box",
                        WebkitLineClamp: 2, WebkitBoxOrient: "vertical"
                      }}>{"\u2705"} {s.humanCheck}</div>
                    </foreignObject>
                  )}
                  <text x={px} y={ns.h - 16} fontSize={13} fill="rgba(255,255,255,0.9)" fontFamily={FONT}>{s.timeHours}h</text>
                  {s.aiTool !== "None" && (
                    <rect x={ns.w - 44} y={8} width={34} height={18} rx={9} fill="rgba(255,255,255,0.2)" />
                  )}
                  {s.aiTool !== "None" && (
                    <text x={ns.w - 27} y={21} fontSize={9} fontWeight={700} fill="rgba(255,255,255,0.8)" fontFamily={FONT} textAnchor="middle">AI</text>
                  )}
                </>
              )}

              <circle cx={0} cy={ns.h / 2} r={6} fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5}
                onMouseUp={e => onPortUp(e, s.id)} style={{ cursor: "crosshair" }} />
              <circle cx={ns.w} cy={ns.h / 2} r={6} fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5}
                onMouseDown={e => onPortDown(e, s.id)} style={{ cursor: "crosshair" }} />

              {!compact && (
                <path d={`M ${ns.w - 14} ${ns.h} L ${ns.w} ${ns.h - 14} L ${ns.w} ${ns.h} Z`}
                  fill="rgba(255,255,255,0.15)" style={{ cursor: "nwse-resize" }}
                  onMouseDown={e => onResizeDown(e, i)} />
              )}
            </g>
          );
        })}
      </svg>
      {!compact && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-lg border border-slate-200 shadow-sm px-1 py-1">
          <button onClick={zoomOut} className="w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 text-sm font-bold" title="Zoom out (Ctrl+-)">−</button>
          <span className="text-xs text-slate-500 w-10 text-center font-medium">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} className="w-7 h-7 flex items-center justify-center rounded text-slate-600 hover:bg-slate-100 text-sm font-bold" title="Zoom in (Ctrl+=)">+</button>
          <button onClick={zoomReset} className="w-7 h-7 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 text-[10px] font-medium" title="Reset zoom (Ctrl+0)">Fit</button>
        </div>
      )}
    </div>
  );
}

// ─── Compare Bar Chart (HTML) — Aggregate comparison ─────────────────────────
function BarChart({ stepsAsIs, stepsToBe }) {
  const totalAsIs = stepsAsIs.reduce((a, s) => a + s.timeHours, 0);
  const totalToBe = (stepsToBe || []).reduce((a, s) => a + s.timeHours, 0);
  const pct = totalAsIs > 0 ? Math.round((1 - totalToBe / totalAsIs) * 100) : 0;
  const maxT = Math.max(totalAsIs, totalToBe, 1);
  const maxStep = Math.max(
    ...stepsAsIs.map(s => s.timeHours),
    ...(stepsToBe || []).map(s => s.timeHours),
    1
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <h3 className="text-sm font-bold text-slate-800">Time Comparison</h3>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#CBD5E1] inline-block" /> As-Is</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#0D9488] inline-block" /> To-Be</span>
        </div>
      </div>

      {/* Aggregate total comparison */}
      <div className="p-4 bg-slate-50 rounded-xl space-y-2">
        <div className="text-xs font-bold text-slate-700 mb-2">TOTAL</div>
        <div className="flex items-center gap-2">
          <div className="h-5 rounded" style={{ width: `${Math.max((totalAsIs / maxT) * 100, 2)}%`, backgroundColor: "#94A3B8" }} />
          <span className="text-sm font-bold text-slate-600 flex-shrink-0">{totalAsIs}h</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-5 rounded" style={{ width: `${Math.max((totalToBe / maxT) * 100, 2)}%`, backgroundColor: "#0D9488" }} />
          <span className="text-sm font-bold text-teal-700 flex-shrink-0">{totalToBe}h</span>
          <span className="ml-1 px-2.5 py-0.5 rounded-full text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: "#F96167" }}>
            {pct > 0 ? `-${pct}%` : `+${Math.abs(pct)}%`}
          </span>
        </div>
      </div>

      {/* Side-by-side step breakdown */}
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">As-Is Steps ({stepsAsIs.length})</div>
          {stepsAsIs.map(s => (
            <div key={s.id} className="flex items-center gap-2">
              <div className="h-3 rounded" style={{ width: `${Math.max((s.timeHours / maxStep) * 100, 3)}%`, backgroundColor: "#CBD5E1" }} />
              <span className="text-xs text-slate-500 flex-shrink-0 whitespace-nowrap">{s.timeHours}h</span>
              <span className="text-xs text-slate-600 truncate">{s.name || "Untitled"}</span>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">To-Be Steps ({(stepsToBe || []).length})</div>
          {(stepsToBe || []).map(s => (
            <div key={s.id} className="flex items-center gap-2">
              <div className="h-3 rounded" style={{ width: `${Math.max((s.timeHours / maxStep) * 100, 3)}%`, backgroundColor: "#0D9488" }} />
              <span className="text-xs text-slate-500 flex-shrink-0 whitespace-nowrap">{s.timeHours}h</span>
              <span className="text-xs text-slate-600 truncate">{s.name || "Untitled"}</span>
            </div>
          ))}
          {(!stepsToBe || stepsToBe.length === 0) && (
            <div className="text-xs text-slate-400 italic">No To-Be steps defined yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Summary Stats ───────────────────────────────────────────────────────────
function Stats({ stepsAsIs, stepsToBe, mode }) {
  const asIs = stepsAsIs.reduce((a, s) => a + s.timeHours, 0);
  const toBe = (stepsToBe || []).reduce((a, s) => a + s.timeHours, 0);
  const saved = asIs - toBe;
  const pct = asIs > 0 ? Math.round((saved / asIs) * 100) : 0;
  const counts = {};
  OPERATORS.forEach(o => { counts[o] = (stepsToBe || []).filter(s => s.operator === o).length; });
  const showToBe = (mode === "to-be" || mode === "compare") && stepsToBe;

  return (
    <div className="mt-6 grid grid-cols-2 gap-3">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="text-xs text-slate-500 mb-1">As-Is Total Time</div>
        <div className="text-2xl font-bold text-slate-800">{asIs}h</div>
      </div>
      {showToBe && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 mb-1">To-Be Total Time</div>
          <div className="text-2xl font-bold text-teal-600">{toBe}h</div>
        </div>
      )}
      {showToBe && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 mb-1">Time Saved</div>
          <div className="text-2xl font-bold text-[#F96167]">{saved}h <span className="text-base">({pct}%)</span></div>
        </div>
      )}
      {showToBe && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 mb-2">Steps by Operator</div>
          <div className="flex flex-wrap gap-2">
            {OPERATORS.map(o => counts[o] > 0 && (
              <span key={o} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: OP_STYLE[o].bg }}>
                {OP_STYLE[o].emoji} {"\u00D7"}{counts[o]}
              </span>
            ))}
          </div>
        </div>
      )}
      {!showToBe && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 mb-1">Total Steps</div>
          <div className="text-2xl font-bold text-slate-800">
            {mode === "to-be" ? 0 : stepsAsIs.length}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step Card (As-Is) ──────────────────────────────────────────────────────
function AsIsStepCard({ step, index, expanded, onToggle, onChange, onDelete, onDup, onUp, onDown, isFirst, isLast }) {
  const ps = PAIN[step.painLevel] || PAIN[1];
  const field = (key, val) => onChange(step.id, key, val);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2 px-3 py-3 cursor-pointer select-none" onClick={onToggle}>
        <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
        <span className="text-xs font-bold text-slate-400 w-5 flex-shrink-0">{index + 1}</span>
        <span className="text-sm font-medium text-slate-700 flex-1 truncate">{step.name || "Untitled Step"}</span>
        <div className="flex gap-0.5 flex-shrink-0">
          {[1,2,3,4,5].map(l => (
            <div key={l} className="w-2 h-2 rounded-full" style={{ backgroundColor: l <= step.painLevel ? ps.border : "#E2E8F0" }} />
          ))}
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex gap-1 justify-end">
            <button onClick={() => onUp(step.id)} disabled={isFirst} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-colors"><ArrowUp className="w-3.5 h-3.5" /></button>
            <button onClick={() => onDown(step.id)} disabled={isLast} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-colors"><ArrowDown className="w-3.5 h-3.5" /></button>
            <button onClick={() => onDup(step.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"><Copy className="w-3.5 h-3.5" /></button>
            <button onClick={() => onDelete(step.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>

          <div>
            <label className={labelCls}>Step Name</label>
            <input className={inputCls} value={step.name} placeholder="e.g. Draft Proposal" onChange={e => field("name", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <textarea className={inputCls + " resize-none"} rows={2} value={step.description} placeholder="What happens in this step?" onChange={e => field("description", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Owner</label>
            <input className={inputCls} value={step.owner} placeholder="e.g. Architect" onChange={e => field("owner", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Time (hours)</label>
              <input type="number" min={0} step={0.5} className={inputCls} value={step.timeHours} onChange={e => field("timeHours", parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label className={labelCls}>Error Frequency</label>
              <select className={inputCls} value={step.errorFrequency} onChange={e => field("errorFrequency", e.target.value)}>
                {ERROR_FREQS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Pain Level</label>
            <div className="flex gap-1.5 mt-1">
              {[1,2,3,4,5].map(l => (
                <button key={l} onClick={() => field("painLevel", l)}
                  className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${step.painLevel === l ? "text-white scale-110 shadow-md" : "border border-slate-200 text-slate-400 hover:border-slate-300"}`}
                  style={step.painLevel === l ? { backgroundColor: PAIN[l].border } : {}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>Tools Used</label>
            <input className={inputCls} value={step.toolsUsed} placeholder="e.g. Google Docs, InDesign" onChange={e => field("toolsUsed", e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step Card (To-Be) ──────────────────────────────────────────────────────
function ToBeStepCard({ step, index, expanded, onToggle, onChange, onDelete, onDup, onUp, onDown, isFirst, isLast }) {
  const os = OP_STYLE[step.operator] || OP_STYLE["Human Only"];
  const field = (key, val) => onChange(step.id, key, val);
  const isCustomTool = step.aiTool && step.aiTool !== "Other" && !AI_TOOLS.includes(step.aiTool);
  const showOtherInput = isCustomTool || step.aiTool === "Other";
  const dropdownVal = isCustomTool ? "Other" : (step.aiTool || "None");

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2 px-3 py-3 cursor-pointer select-none" onClick={onToggle}>
        <GripVertical className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
        <span className="text-xs font-bold text-slate-400 w-5 flex-shrink-0">{index + 1}</span>
        <span className="text-sm font-medium text-slate-700 flex-1 truncate">{step.name || "Untitled Step"}</span>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-white flex-shrink-0" style={{ backgroundColor: os.bg }}>
          {os.emoji} {step.operator}
        </span>
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex gap-1 justify-end">
            <button onClick={() => onUp(step.id)} disabled={isFirst} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-colors"><ArrowUp className="w-3.5 h-3.5" /></button>
            <button onClick={() => onDown(step.id)} disabled={isLast} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-colors"><ArrowDown className="w-3.5 h-3.5" /></button>
            <button onClick={() => onDup(step.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"><Copy className="w-3.5 h-3.5" /></button>
            <button onClick={() => onDelete(step.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>

          <div>
            <label className={labelCls}>Step Name</label>
            <input className={inputCls} value={step.name} placeholder="e.g. AI-Assisted Draft" onChange={e => field("name", e.target.value)} />
          </div>
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-3.5 h-3.5 text-[#F96167]" />
            <span className="text-xs font-semibold text-[#F96167] uppercase tracking-wider">AI Redesign</span>
          </div>
          <div>
            <label className={labelCls}>Operator</label>
            <div className="grid grid-cols-2 gap-1.5">
              {OPERATORS.map(o => (
                <button key={o} onClick={() => field("operator", o)}
                  className={`px-2 py-2 rounded-lg text-xs font-medium transition-all ${step.operator === o ? "text-white shadow-md scale-[1.02]" : "bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200"}`}
                  style={step.operator === o ? { backgroundColor: OP_STYLE[o].bg } : {}}>
                  {OP_STYLE[o].emoji} {o}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>AI Tool</label>
            <select className={inputCls} value={dropdownVal} onChange={e => {
              const v = e.target.value;
              field("aiTool", v === "Other" ? "Other" : v);
            }}>
              {AI_TOOLS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {showOtherInput && (
              <input className={inputCls + " mt-1.5"} value={isCustomTool ? step.aiTool : ""}
                placeholder="Type your AI tool name..."
                onChange={e => field("aiTool", e.target.value || "Other")}
                autoFocus={step.aiTool === "Other"} />
            )}
          </div>
          <div>
            <label className={labelCls}>What AI Does</label>
            <textarea className={inputCls + " resize-none"} rows={2} value={step.aiAction} placeholder="Describe the AI's role..." onChange={e => field("aiAction", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Human Checks</label>
            <textarea className={inputCls + " resize-none"} rows={2} value={step.humanCheck} placeholder="What does the human verify?" onChange={e => field("humanCheck", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Time (hours)</label>
            <input type="number" min={0} step={0.5} className={inputCls} value={step.timeHours} onChange={e => field("timeHours", parseFloat(e.target.value) || 0)} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Generic Step Actions Hook ───────────────────────────────────────────────
function useStepActions(setSteps, setConns, setNS, setExp) {
  const update = useCallback((id, key, val) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, [key]: val } : s));
  }, [setSteps]);

  const del = useCallback((id) => {
    if (!window.confirm("Delete this step?")) return;
    setSteps(prev => prev.filter(s => s.id !== id));
    setExp(prev => { const n = new Set(prev); n.delete(id); return n; });
    setConns(prev => prev ? prev.filter(c => c.from !== id && c.to !== id) : null);
    setNS(prev => { const next = { ...prev }; delete next[id]; return next; });
  }, [setSteps, setConns, setNS, setExp]);

  const dup = useCallback((id) => {
    setSteps(prev => {
      if (prev.length >= MAX_STEPS) { alert(`Maximum ${MAX_STEPS} steps reached.`); return prev; }
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const newId = uid();
      const clone = { ...prev[idx], id: newId, name: prev[idx].name + " (Copy)" };
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
  }, [setSteps]);

  const move = useCallback((id, dir) => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, [setSteps]);

  const connect = useCallback((from, to) => {
    setConns(prev => {
      const base = prev || [];
      if (base.some(c => c.from === from && c.to === to)) return base;
      return [...base, { from, to }];
    });
  }, [setConns]);

  const delConn = useCallback((idx) => {
    setConns(prev => {
      const base = prev || [];
      return base.filter((_, i) => i !== idx);
    });
  }, [setConns]);

  const resize = useCallback((stepId, w, h) => {
    setNS(prev => ({ ...prev, [stepId]: { w, h } }));
  }, [setNS]);

  return { update, del, dup, move, connect, delConn, resize };
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function IFWorkflowVisualizer() {
  const [mode, setMode] = useState(_saved?.mode || "as-is");
  const [meta, setMeta] = useState(_saved?.meta || INIT_META);
  const [stepsAsIs, setStepsAsIs] = useState(_saved?.stepsAsIs || INIT_STEPS_AS_IS);
  const [stepsToBe, setStepsToBe] = useState(_saved?.stepsToBe ?? null);
  const [connectionsAsIs, setConnectionsAsIs] = useState(_saved?.connectionsAsIs ?? null);
  const [connectionsToBe, setConnectionsToBe] = useState(_saved?.connectionsToBe ?? null);
  const [nodeSizesAsIs, setNodeSizesAsIs] = useState(_saved?.nodeSizesAsIs || {});
  const [nodeSizesToBe, setNodeSizesToBe] = useState(_saved?.nodeSizesToBe || {});
  const [expanded, setExpanded] = useState(new Set([(_saved?.stepsAsIs || INIT_STEPS_AS_IS)[0]?.id]));
  const [infoOpen, setInfoOpen] = useState(true);
  const [tidyKey, setTidyKey] = useState(0);
  const [saveStatus, setSaveStatus] = useState(_saved ? "restored" : null);
  const [compareTab, setCompareTab] = useState("as-is");
  const vizRef = useRef(null);

  // ── Step actions (generic) ──
  const asIsActions = useStepActions(setStepsAsIs, setConnectionsAsIs, setNodeSizesAsIs, setExpanded);
  const toBeActions = useStepActions(setStepsToBe, setConnectionsToBe, setNodeSizesToBe, setExpanded);

  const addAsIsStep = useCallback(() => {
    if (stepsAsIs.length >= MAX_STEPS) { alert(`Maximum ${MAX_STEPS} steps reached. Consider consolidating steps.`); return; }
    const id = uid();
    setStepsAsIs(prev => [...prev, { id, name: "", description: "", owner: "", timeHours: 1, painLevel: 1, errorFrequency: "Low", toolsUsed: "" }]);
    setExpanded(prev => new Set([...prev, id]));
    // Auto-connect from last step if connections are in explicit mode
    if (connectionsAsIs !== null && stepsAsIs.length > 0) {
      const lastId = stepsAsIs[stepsAsIs.length - 1].id;
      setConnectionsAsIs(prev => [...(prev || []), { from: lastId, to: id }]);
    }
  }, [stepsAsIs, connectionsAsIs]);

  const addToBeStep = useCallback(() => {
    if ((stepsToBe || []).length >= MAX_STEPS) { alert(`Maximum ${MAX_STEPS} steps reached. Consider consolidating steps.`); return; }
    const id = uid();
    setStepsToBe(prev => [...(prev || []), { id, name: "", operator: "Human Only", aiTool: "None", aiAction: "", humanCheck: "", timeHours: 1 }]);
    setExpanded(prev => new Set([...prev, id]));
    // Auto-connect from last step if connections are in explicit mode
    if (connectionsToBe !== null && stepsToBe && stepsToBe.length > 0) {
      const lastId = stepsToBe[stepsToBe.length - 1].id;
      setConnectionsToBe(prev => [...(prev || []), { from: lastId, to: id }]);
    }
  }, [stepsToBe, connectionsToBe]);

  // ── Auto-save to localStorage (debounced 500ms) ──
  const saveCountRef = useRef(0);
  useEffect(() => {
    saveCountRef.current++;
    if (saveCountRef.current <= 1 && _saved) return;
    const timer = setTimeout(() => {
      try {
        const data = {
          version: 2, mode, meta, stepsAsIs, stepsToBe,
          connectionsAsIs, connectionsToBe,
          nodeSizesAsIs, nodeSizesToBe, savedAt: Date.now(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(null), 2000);
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [mode, meta, stepsAsIs, stepsToBe, connectionsAsIs, connectionsToBe, nodeSizesAsIs, nodeSizesToBe]);

  useEffect(() => {
    if (saveStatus === "restored") {
      const t = setTimeout(() => setSaveStatus(null), 3000);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  // ── Effective connections ──
  const effectiveConnectionsAsIs = useMemo(() => {
    if (connectionsAsIs) return connectionsAsIs;
    return stepsAsIs.slice(0, -1).map((s, i) => ({ from: s.id, to: stepsAsIs[i + 1].id }));
  }, [connectionsAsIs, stepsAsIs]);

  const effectiveConnectionsToBe = useMemo(() => {
    if (!stepsToBe || stepsToBe.length === 0) return [];
    if (connectionsToBe) return connectionsToBe;
    return stepsToBe.slice(0, -1).map((s, i) => ({ from: s.id, to: stepsToBe[i + 1].id }));
  }, [connectionsToBe, stepsToBe]);

  // ── Display order ──
  const displayOrderAsIs = useMemo(() => {
    if (!connectionsAsIs) return stepsAsIs;
    return topoSort(stepsAsIs, connectionsAsIs);
  }, [connectionsAsIs, stepsAsIs]);

  const displayOrderToBe = useMemo(() => {
    if (!stepsToBe) return [];
    if (!connectionsToBe) return stepsToBe;
    return topoSort(stepsToBe, connectionsToBe);
  }, [connectionsToBe, stepsToBe]);

  const toggleStep = useCallback((id) => {
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  // ── Seed To-Be from As-Is ──
  const seedToBeFromAsIs = useCallback(() => {
    const seeded = stepsAsIs.map(s => ({
      id: uid(), name: s.name, operator: "Human Only", aiTool: "None",
      aiAction: "", humanCheck: "", timeHours: s.timeHours,
    }));
    setStepsToBe(seeded);
    if (effectiveConnectionsAsIs.length > 0) {
      const idMap = new Map();
      stepsAsIs.forEach((s, i) => idMap.set(s.id, seeded[i].id));
      const seededConns = effectiveConnectionsAsIs
        .map(c => ({ from: idMap.get(c.from), to: idMap.get(c.to) }))
        .filter(c => c.from && c.to);
      setConnectionsToBe(seededConns);
    }
  }, [stepsAsIs, effectiveConnectionsAsIs]);

  const startToBeEmpty = useCallback(() => {
    setStepsToBe([]);
    setConnectionsToBe(null);
  }, []);

  // ── Tidy up / New workflow ──
  const handleTidyUp = useCallback(() => {
    setTidyKey(k => k + 1);
    if (mode === "as-is") setNodeSizesAsIs({});
    else if (mode === "to-be") setNodeSizesToBe({});
    else { setNodeSizesAsIs({}); setNodeSizesToBe({}); }
  }, [mode]);

  const handleNewWorkflow = useCallback(() => {
    if (!window.confirm("Start a new workflow? Current progress will be cleared.")) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setMode("as-is");
    setMeta(INIT_META);
    setStepsAsIs(INIT_STEPS_AS_IS);
    setStepsToBe(null);
    setConnectionsAsIs(null);
    setConnectionsToBe(null);
    setNodeSizesAsIs({});
    setNodeSizesToBe({});
    setTidyKey(k => k + 1);
    setExpanded(new Set(["s1"]));
    setSaveStatus(null);
  }, []);

  // ── Shared SVG helpers ──
  const getSvgElement = useCallback(() => {
    const container = vizRef.current;
    if (!container) return null;
    const allSvgs = container.querySelectorAll("svg");
    for (const s of allSvgs) {
      if (s.classList.contains("w-full")) return s;
    }
    return null;
  }, []);

  const cloneSvg = useCallback(() => {
    const svgEl = getSvgElement();
    if (!svgEl) return null;
    const clone = svgEl.cloneNode(true);
    const vb = svgEl.getAttribute("viewBox");
    if (!vb) return null;
    const parts = vb.split(/[\s,]+/).map(Number);
    const scale = 2;
    const w = parts[2] * scale;
    const h = parts[3] * scale;
    clone.setAttribute("width", w);
    clone.setAttribute("height", h);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xhtml", "http://www.w3.org/1999/xhtml");
    const str = new XMLSerializer().serializeToString(clone);
    return { str, w, h };
  }, [getSvgElement]);

  const svgToPngBlob = useCallback((svgData) => {
    return new Promise((resolve, reject) => {
      if (!svgData) { reject(new Error("No SVG")); return; }
      const { str, w, h } = svgData;
      const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(str);
      const img = new window.Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        c.toBlob(blob => blob ? resolve({ blob, canvas: c }) : reject(new Error("Canvas failed")), "image/png");
      };
      img.onerror = () => reject(new Error("Image load failed"));
      img.src = dataUrl;
    });
  }, []);

  const downloadBlob = useCallback((blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }, []);

  const fname = useCallback((ext) => `${meta.workflowName || "workflow"}-${mode}.${ext}`, [meta.workflowName, mode]);

  // ── Active steps/connections for current mode ──
  const activeSteps = mode === "to-be" ? (stepsToBe || []) : stepsAsIs;
  const activeConnections = mode === "to-be" ? effectiveConnectionsToBe : effectiveConnectionsAsIs;
  const activeNodeSizes = mode === "to-be" ? nodeSizesToBe : nodeSizesAsIs;

  // ── Export: PNG ──
  const handleExportPNG = useCallback(async () => {
    try {
      const svgData = cloneSvg();
      const { blob } = await svgToPngBlob(svgData);
      downloadBlob(blob, fname("png"));
    } catch {
      const svgData = cloneSvg();
      if (svgData) {
        const blob = new Blob([svgData.str], { type: "image/svg+xml" });
        downloadBlob(blob, fname("svg"));
      } else {
        alert("Export failed. Please use your browser\u2019s screenshot tool.");
      }
    }
  }, [cloneSvg, svgToPngBlob, downloadBlob, fname]);

  // ── Export: SVG ──
  const handleExportSVG = useCallback(() => {
    const svgData = cloneSvg();
    if (!svgData) return;
    const blob = new Blob([svgData.str], { type: "image/svg+xml" });
    downloadBlob(blob, fname("svg"));
  }, [cloneSvg, downloadBlob, fname]);

  // ── Export: Copy to Clipboard ──
  const [clipboardMsg, setClipboardMsg] = useState(null);
  const handleCopyClipboard = useCallback(async () => {
    try {
      const svgData = cloneSvg();
      const { blob } = await svgToPngBlob(svgData);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setClipboardMsg("Copied!");
      setTimeout(() => setClipboardMsg(null), 2000);
    } catch {
      setClipboardMsg("Failed");
      setTimeout(() => setClipboardMsg(null), 2000);
    }
  }, [cloneSvg, svgToPngBlob]);

  // ── Export: Excel (.xlsx) ──
  const handleExportExcel = useCallback(() => {
    const wb = XLSX.utils.book_new();
    // Workflow Info sheet
    const infoData = [
      ["Workflow Name", meta.workflowName], ["Team Name", meta.teamName],
      ["Department", meta.department], ["Frequency", meta.frequency],
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(infoData);
    wsInfo["!cols"] = [{ wch: 18 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, "Workflow Info");

    // As-Is sheet
    const asIsHeader = ["Step #", "Name", "Description", "Owner", "Time (hrs)", "Pain Level", "Error Frequency", "Tools Used"];
    const asIsRows = stepsAsIs.map((s, i) => [i + 1, s.name, s.description, s.owner, s.timeHours, s.painLevel, s.errorFrequency, s.toolsUsed]);
    const wsAsIs = XLSX.utils.aoa_to_sheet([asIsHeader, ...asIsRows]);
    wsAsIs["!cols"] = [{ wch: 7 }, { wch: 30 }, { wch: 40 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsAsIs, "As-Is Steps");

    // To-Be sheet (if exists)
    if (stepsToBe && stepsToBe.length > 0) {
      const toBeHeader = ["Step #", "Name", "Operator", "AI Tool", "AI Action", "Human Check", "Time (hrs)"];
      const toBeRows = stepsToBe.map((s, i) => [i + 1, s.name, s.operator, s.aiTool, s.aiAction, s.humanCheck, s.timeHours]);
      const wsToBe = XLSX.utils.aoa_to_sheet([toBeHeader, ...toBeRows]);
      wsToBe["!cols"] = [{ wch: 7 }, { wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 40 }, { wch: 30 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, wsToBe, "To-Be Steps");

      // Summary sheet
      const totalAsIs = stepsAsIs.reduce((a, s) => a + s.timeHours, 0);
      const totalToBe = stepsToBe.reduce((a, s) => a + s.timeHours, 0);
      const saved = totalAsIs - totalToBe;
      const pct = totalAsIs > 0 ? Math.round((saved / totalAsIs) * 100) : 0;
      const summaryData = [
        ["Metric", "Value"],
        ["As-Is Steps", stepsAsIs.length], ["To-Be Steps", stepsToBe.length],
        ["As-Is Total Time", `${totalAsIs}h`], ["To-Be Total Time", `${totalToBe}h`],
        ["Time Saved", `${saved}h (${pct}%)`],
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      wsSummary["!cols"] = [{ wch: 20 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");
    }

    XLSX.writeFile(wb, fname("xlsx"));
  }, [stepsAsIs, stepsToBe, meta, fname]);

  // ── Shared: compute node positions for export ──
  const computeExportPositions = useCallback((steps, conns, ns) => {
    const b = BOX;
    const sorted = topoSort(steps, conns);
    const orderMap = new Map(sorted.map((s, i) => [s.id, i]));
    return steps.map((s) => {
      const gridIdx = orderMap.get(s.id) ?? 0;
      const col = gridIdx % b.cols;
      const row = Math.floor(gridIdx / b.cols);
      const sz = ns[s.id] || { w: b.w, h: b.h };
      return { x: col * (b.w + b.gap), y: row * (b.h + b.gap), w: sz.w, h: sz.h };
    });
  }, []);

  // ── Export: PPTX (Editable Shapes) ──
  const handleExportPPTX = useCallback(async () => {
    try {
      const prs = new PptxGenJS();
      prs.layout = "LAYOUT_WIDE";

      // Slide 1: Title
      const slide1 = prs.addSlide();
      slide1.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: "F8FAFC" } });
      slide1.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 0.12, fill: { color: "F96167" } });
      slide1.addText(meta.workflowName || "Workflow", { x: 0.8, y: 1.8, w: 8, h: 1, fontSize: 36, fontFace: "Arial", bold: true, color: "1E293B" });
      slide1.addText(`${meta.teamName || "Team"} \u2014 ${meta.department || "Department"}`, { x: 0.8, y: 2.8, w: 8, h: 0.5, fontSize: 18, fontFace: "Arial", color: "64748B" });
      slide1.addText(`Frequency: ${meta.frequency || "N/A"}`, { x: 0.8, y: 3.3, w: 8, h: 0.4, fontSize: 14, fontFace: "Arial", color: "94A3B8" });
      slide1.addText("IF Workflow Visualizer", { x: 0.8, y: 4.6, w: 8, h: 0.4, fontSize: 12, fontFace: "Arial", color: "CBD5E1" });

      // Helper: add diagram slide
      const addDiagramSlide = (title, steps, conns, ns, isToBe) => {
        const slide = prs.addSlide();
        slide.addText(title, { x: 0.3, y: 0.15, w: 9, h: 0.4, fontSize: 16, fontFace: "Arial", bold: true, color: "1E293B" });
        const positions = computeExportPositions(steps, conns, ns);
        let maxX = 0, maxY = 0;
        positions.forEach(p => { maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h); });
        const slideW = 12.0, slideH = 6.0, padX = 0.6, padY = 0.8;
        const scale = Math.min(maxX > 0 ? slideW / maxX : 1, maxY > 0 ? slideH / maxY : 1);
        const toIn = (v) => v * scale;

        steps.forEach((s, i) => {
          const p = positions[i];
          if (!p) return;
          const nx = padX + toIn(p.x), ny = padY + toIn(p.y), nw = toIn(p.w), nh = toIn(p.h);
          let fillColor, lineColor, textColor;
          if (isToBe) {
            const os = OP_STYLE[s.operator] || OP_STYLE["Human Only"];
            fillColor = os.bg.replace("#", ""); lineColor = fillColor; textColor = "FFFFFF";
          } else {
            const ps = PAIN[s.painLevel] || PAIN[1];
            fillColor = ps.bg.replace("#", ""); lineColor = ps.border.replace("#", ""); textColor = "1E293B";
          }
          slide.addShape(prs.ShapeType.roundRect, { x: nx, y: ny, w: nw, h: nh, fill: { color: fillColor }, line: { color: lineColor, width: 1.5 }, rectRadius: 0.08 });
          const label = isToBe
            ? `${s.operator}\n${s.name}${s.aiTool !== "None" ? `\n${s.aiTool}` : ""}${s.aiAction ? `\nAI: ${s.aiAction}` : ""}${s.humanCheck ? `\nCheck: ${s.humanCheck}` : ""}\n${s.timeHours}h`
            : `${s.name}\n${s.owner || ""}\n${s.timeHours}h`;
          slide.addText(label, { x: nx + 0.05, y: ny + 0.05, w: nw - 0.1, h: nh - 0.1, fontSize: nw > 1.5 ? 10 : 8, fontFace: "Arial", color: textColor, valign: "middle", align: "center", bold: true, wrap: true });
        });

        conns.forEach(conn => {
          const fi = steps.findIndex(s => s.id === conn.from);
          const ti = steps.findIndex(s => s.id === conn.to);
          if (fi < 0 || ti < 0) return;
          const fp = positions[fi], tp = positions[ti];
          slide.addShape(prs.ShapeType.line, {
            x: padX + toIn(fp.x + fp.w), y: padY + toIn(fp.y + fp.h / 2),
            w: toIn(tp.x) - toIn(fp.x + fp.w), h: toIn(tp.y + tp.h / 2) - toIn(fp.y + fp.h / 2),
            line: { color: "94A3B8", width: 1.5, endArrowType: "triangle" },
          });
        });
      };

      // Slide 2: As-Is diagram
      addDiagramSlide("As-Is Workflow", stepsAsIs, effectiveConnectionsAsIs, nodeSizesAsIs, false);

      // Slide 3: To-Be diagram (if exists)
      if (stepsToBe && stepsToBe.length > 0) {
        addDiagramSlide("To-Be Workflow", stepsToBe, effectiveConnectionsToBe, nodeSizesToBe, true);
      }

      // Stats slide
      const slide3 = prs.addSlide();
      slide3.addText("Summary", { x: 0.5, y: 0.2, w: 9, h: 0.5, fontSize: 20, fontFace: "Arial", bold: true, color: "1E293B" });
      const asIs = stepsAsIs.reduce((a, s) => a + s.timeHours, 0);
      const toBe = (stepsToBe || []).reduce((a, s) => a + s.timeHours, 0);
      const saved = asIs - toBe;
      const pctSaved = asIs > 0 ? Math.round((saved / asIs) * 100) : 0;
      const statsRows = [
        [{ text: "Metric", options: { bold: true, color: "FFFFFF", fill: { color: "1E293B" } } },
         { text: "Value", options: { bold: true, color: "FFFFFF", fill: { color: "1E293B" } } }],
        ["As-Is Steps", String(stepsAsIs.length)],
        ["To-Be Steps", String((stepsToBe || []).length)],
        ["As-Is Total Time", `${asIs}h`],
        ["To-Be Total Time", `${toBe}h`],
        ["Time Saved", `${saved}h (${pctSaved}%)`],
      ];
      OPERATORS.forEach(o => {
        const count = (stepsToBe || []).filter(s => s.operator === o).length;
        if (count > 0) statsRows.push([o, `${count} step${count > 1 ? "s" : ""}`]);
      });
      slide3.addTable(statsRows, { x: 0.5, y: 0.9, w: 6, fontSize: 13, fontFace: "Arial", border: { pt: 0.5, color: "E2E8F0" }, colW: [3, 3] });

      await prs.writeFile({ fileName: fname("pptx") });
    } catch (err) {
      alert("PPTX export failed: " + err.message);
    }
  }, [meta, stepsAsIs, stepsToBe, effectiveConnectionsAsIs, effectiveConnectionsToBe, nodeSizesAsIs, nodeSizesToBe, computeExportPositions, fname]);

  // ── Export: draw.io (.drawio) ──
  const handleExportDrawio = useCallback(() => {
    const isToBe = mode === "to-be";
    const steps = isToBe ? (stepsToBe || []) : stepsAsIs;
    const conns = isToBe ? effectiveConnectionsToBe : effectiveConnectionsAsIs;
    const ns = isToBe ? nodeSizesToBe : nodeSizesAsIs;
    const positions = computeExportPositions(steps, conns, ns);
    const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    let cells = "";
    steps.forEach((s, i) => {
      const p = positions[i];
      if (!p) return;
      let fillColor, strokeColor, fontColor;
      if (isToBe) {
        const os = OP_STYLE[s.operator] || OP_STYLE["Human Only"];
        fillColor = os.bg; strokeColor = os.bg; fontColor = "#FFFFFF";
      } else {
        const ps = PAIN[s.painLevel] || PAIN[1];
        fillColor = ps.bg; strokeColor = ps.border; fontColor = "#1E293B";
      }
      const label = isToBe
        ? `${s.operator}\\n${esc(s.name)}${s.aiTool !== "None" ? `\\n${s.aiTool}` : ""}${s.aiAction ? `\\n${esc(s.aiAction)}` : ""}\\n${s.timeHours}h`
        : `${esc(s.name)}\\n${esc(s.owner)}\\n${s.timeHours}h`;

      cells += `        <mxCell id="n_${s.id}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;fillColor=${fillColor};strokeColor=${strokeColor};fontColor=${fontColor};fontStyle=1;fontSize=12;arcSize=8;" vertex="1" parent="1">\n`;
      cells += `          <mxGeometry x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" as="geometry"/>\n`;
      cells += `        </mxCell>\n`;
    });

    conns.forEach((conn, ci) => {
      cells += `        <mxCell id="e_${ci}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeColor=#94A3B8;strokeWidth=2;" edge="1" source="n_${conn.from}" target="n_${conn.to}" parent="1">\n`;
      cells += `          <mxGeometry relative="1" as="geometry"/>\n`;
      cells += `        </mxCell>\n`;
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="IF Workflow Visualizer" modified="${new Date().toISOString()}" type="device">
  <diagram name="${esc(meta.workflowName || "Workflow")}" id="workflow">
    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells}      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

    const blob = new Blob([xml], { type: "application/xml" });
    downloadBlob(blob, fname("drawio"));
  }, [stepsAsIs, stepsToBe, mode, effectiveConnectionsAsIs, effectiveConnectionsToBe, nodeSizesAsIs, nodeSizesToBe, computeExportPositions, downloadBlob, fname, meta.workflowName]);

  // ── Export: Google Docs (.docx) ──
  const handleExportDocx = useCallback(async () => {
    try {
      const isToBe = mode === "to-be" || mode === "compare";
      const steps = isToBe ? (stepsToBe || []) : stepsAsIs;
      const conns = isToBe ? effectiveConnectionsToBe : effectiveConnectionsAsIs;
      const cols = BOX.cols;
      const sorted = topoSort(steps, conns);
      const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
      const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

      const tableRows = [];
      for (let rowStart = 0; rowStart < sorted.length; rowStart += cols) {
        const rowSteps = sorted.slice(rowStart, rowStart + cols);
        const rowCells = [];

        rowSteps.forEach((s, ci) => {
          let bgColor, textColor;
          if (isToBe) {
            const os = OP_STYLE[s.operator] || OP_STYLE["Human Only"];
            bgColor = os.bg.replace("#", ""); textColor = "FFFFFF";
          } else {
            const ps = PAIN[s.painLevel] || PAIN[1];
            bgColor = ps.bg.replace("#", ""); textColor = "1E293B";
          }

          const cellParagraphs = [];
          if (isToBe) {
            cellParagraphs.push(new Paragraph({ children: [new TextRun({ text: s.operator, bold: true, size: 16, color: textColor, font: "Arial" })] }));
          }
          cellParagraphs.push(new Paragraph({ children: [new TextRun({ text: s.name || "Untitled", bold: true, size: 20, color: textColor, font: "Arial" })] }));
          if (!isToBe) cellParagraphs.push(new Paragraph({ children: [new TextRun({ text: s.owner || "", size: 16, color: textColor, font: "Arial" })] }));
          if (isToBe && s.aiTool !== "None") {
            cellParagraphs.push(new Paragraph({ children: [new TextRun({ text: s.aiTool, size: 16, color: textColor, font: "Arial", italics: true })] }));
          }
          cellParagraphs.push(new Paragraph({ children: [new TextRun({ text: `${s.timeHours}h`, size: 18, color: textColor, font: "Arial", bold: true })] }));
          if (!isToBe) {
            cellParagraphs.push(new Paragraph({ children: [new TextRun({ text: `Pain: ${"●".repeat(s.painLevel)}${"○".repeat(5 - s.painLevel)}`, size: 14, color: textColor, font: "Arial" })] }));
          }

          rowCells.push(new TableCell({
            children: cellParagraphs,
            width: { size: 2200, type: WidthType.DXA },
            shading: { fill: bgColor, type: "clear" },
            margins: { top: 80, bottom: 80, left: 100, right: 100 },
          }));

          if (ci < rowSteps.length - 1) {
            rowCells.push(new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "\u2192", size: 28, color: "94A3B8", font: "Arial" })] })],
              width: { size: 400, type: WidthType.DXA },
              verticalAlign: "center",
              borders: noBorders,
            }));
          }
        });

        tableRows.push(new TableRow({ children: rowCells }));

        if (rowStart + cols < sorted.length) {
          const downCells = [];
          for (let ci = 0; ci < rowSteps.length * 2 - 1; ci++) {
            const isLast = ci === rowSteps.length * 2 - 2;
            downCells.push(new TableCell({
              children: [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: isLast ? [new TextRun({ text: "\u2193", size: 28, color: "94A3B8", font: "Arial" })] : [],
              })],
              borders: noBorders,
            }));
          }
          tableRows.push(new TableRow({ children: downCells }));
        }
      }

      const flowTable = new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } });

      const detailSections = [];
      sorted.forEach((s, i) => {
        detailSections.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `Step ${i + 1}: ${s.name}`, bold: true, font: "Arial" })] }));
        const fields = isToBe
          ? [["Operator", s.operator], ["AI Tool", s.aiTool], ["AI Action", s.aiAction], ["Human Check", s.humanCheck], ["Time", `${s.timeHours}h`]]
          : [["Owner", s.owner], ["Description", s.description], ["Time", `${s.timeHours}h`], ["Pain Level", `${s.painLevel}/5`], ["Error Frequency", s.errorFrequency], ["Tools", s.toolsUsed]];
        fields.forEach(([label, val]) => {
          if (val) {
            detailSections.push(new Paragraph({ children: [
              new TextRun({ text: `${label}: `, bold: true, size: 20, font: "Arial", color: "64748B" }),
              new TextRun({ text: val, size: 20, font: "Arial", color: "1E293B" }),
            ] }));
          }
        });
        detailSections.push(new Paragraph({ text: "" }));
      });

      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: meta.workflowName || "Workflow", bold: true, font: "Arial", color: "1E293B" })] }),
            new Paragraph({ children: [
              new TextRun({ text: `${meta.teamName || ""} | ${meta.department || ""} | ${meta.frequency || ""}`, size: 22, font: "Arial", color: "64748B" }),
            ] }),
            new Paragraph({ children: [new TextRun({ text: `Mode: ${isToBe ? "To-Be" : "As-Is"}`, size: 20, font: "Arial", color: "94A3B8", italics: true })] }),
            new Paragraph({ text: "" }),
            flowTable,
            new Paragraph({ text: "" }),
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Step Details", bold: true, font: "Arial" })] }),
            ...detailSections,
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      downloadBlob(blob, fname("docx"));
    } catch (err) {
      alert("DOCX export failed: " + err.message);
    }
  }, [stepsAsIs, stepsToBe, mode, effectiveConnectionsAsIs, effectiveConnectionsToBe, meta, downloadBlob, fname]);

  // ── Export: JSON ──
  const handleExportJSON = useCallback(() => {
    const data = {
      version: 2, meta, stepsAsIs, stepsToBe,
      connectionsAsIs, connectionsToBe,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(blob, fname("json"));
  }, [meta, stepsAsIs, stepsToBe, connectionsAsIs, connectionsToBe, downloadBlob, fname]);

  // ── Import: JSON ──
  const fileInputRef = useRef(null);
  const handleImportJSON = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let data = JSON.parse(reader.result);
        // v1 migration
        if (!data.version || data.version < 2) {
          if (!data.steps || !Array.isArray(data.steps)) throw new Error("Invalid format");
          data = migrateV1(data);
        }
        if (!data.stepsAsIs || !Array.isArray(data.stepsAsIs)) throw new Error("Invalid format");
        if (data.meta) setMeta(data.meta);
        setStepsAsIs(data.stepsAsIs);
        setStepsToBe(data.stepsToBe ?? null);
        setConnectionsAsIs(data.connectionsAsIs ?? null);
        setConnectionsToBe(data.connectionsToBe ?? null);
        setNodeSizesAsIs({});
        setNodeSizesToBe({});
        setTidyKey(k => k + 1);
      } catch (err) {
        alert("Invalid JSON file: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  // ── Export Dropdown State ──
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);
  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [exportOpen]);

  const metaField = useCallback((key, val) => {
    setMeta(prev => ({ ...prev, [key]: val }));
  }, []);

  const modes = [
    { key: "as-is", label: "As-Is", icon: Eye },
    { key: "to-be", label: "To-Be", icon: Layers },
    { key: "compare", label: "Compare", icon: ArrowRightLeft },
  ];

  // Wrappers that materialize auto-generated connections before deleting
  const deleteAsIsConn = useCallback((idx) => {
    const base = connectionsAsIs || effectiveConnectionsAsIs;
    setConnectionsAsIs(base.filter((_, i) => i !== idx));
  }, [connectionsAsIs, effectiveConnectionsAsIs]);

  const deleteToBeConn = useCallback((idx) => {
    const base = connectionsToBe || effectiveConnectionsToBe;
    setConnectionsToBe(base.filter((_, i) => i !== idx));
  }, [connectionsToBe, effectiveConnectionsToBe]);

  const asIsChartProps = {
    connections: effectiveConnectionsAsIs,
    nodeSizes: nodeSizesAsIs,
    tidyKey,
    onDeleteConnection: deleteAsIsConn,
    onConnect: asIsActions.connect,
    onResizeNode: asIsActions.resize,
    onDeleteStep: asIsActions.del,
  };

  const toBeChartProps = {
    connections: effectiveConnectionsToBe,
    nodeSizes: nodeSizesToBe,
    tidyKey,
    onDeleteConnection: deleteToBeConn,
    onConnect: toBeActions.connect,
    onResizeNode: toBeActions.resize,
    onDeleteStep: toBeActions.del,
  };

  // ── To-Be seed splash ──
  const toBeNotCreated = stepsToBe === null;

  return (
    <div className="h-screen flex flex-col bg-[#F8FAFC]" style={{ fontFamily: FONT }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200 flex-shrink-0 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F96167] to-[#F9D423] flex items-center justify-center">
            <Layers className="w-4.5 h-4.5 text-white" />
          </div>
          <h1 className="text-lg font-bold text-slate-800 tracking-tight">IF Workflow Visualizer</h1>
        </div>

        <div className="flex bg-slate-100 rounded-full p-1">
          {modes.map(m => {
            const Icon = m.icon;
            return (
              <button key={m.key} onClick={() => setMode(m.key)}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium transition-all ${mode === m.key ? "text-white shadow-md" : "text-slate-500 hover:text-slate-700"}`}
                style={mode === m.key ? { backgroundColor: "#F96167" } : {}}>
                <Icon className="w-3.5 h-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {saveStatus && (
            <span className={`flex items-center gap-1 text-xs font-medium transition-opacity ${saveStatus === "restored" ? "text-blue-500" : "text-emerald-500"}`}>
              <Check className="w-3 h-3" />
              {saveStatus === "restored" ? "Restored from last session" : "Auto-saved"}
            </span>
          )}
          <button onClick={handleNewWorkflow}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
            <FilePlus className="w-4 h-4" />
            New
          </button>
          <button onClick={handleTidyUp}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
            <LayoutGrid className="w-4 h-4" />
            Tidy Up
          </button>
          <div className="relative" ref={exportRef}>
            <button onClick={() => setExportOpen(o => !o)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700 transition-colors shadow-sm">
              <Download className="w-4 h-4" />
              Export
              {exportOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl border border-slate-200 shadow-lg z-50 py-1 overflow-hidden">
                <button onClick={() => { handleExportPNG(); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <ImageIcon className="w-4 h-4 text-slate-400" /> PNG Image
                </button>
                <button onClick={() => { handleExportSVG(); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <Download className="w-4 h-4 text-slate-400" /> SVG Vector
                </button>
                <button onClick={() => { handleCopyClipboard(); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <Clipboard className="w-4 h-4 text-slate-400" /> {clipboardMsg || "Copy to Clipboard"}
                </button>
                <div className="border-t border-slate-100 my-1" />
                <button onClick={() => { handleExportPPTX(); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <Layers className="w-4 h-4 text-orange-500" /> Editable Slides (.pptx)
                </button>
                <button onClick={() => { handleExportDocx(); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <FileText className="w-4 h-4 text-blue-600" /> Google Docs (.docx)
                </button>
                <button onClick={() => { handleExportDrawio(); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <PenLine className="w-4 h-4 text-teal-500" /> draw.io Diagram
                </button>
                <button onClick={() => { handleExportExcel(); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <FileSpreadsheet className="w-4 h-4 text-green-500" /> Excel (.xlsx)
                </button>
                <div className="border-t border-slate-100 my-1" />
                <button onClick={() => { handleExportJSON(); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <FileText className="w-4 h-4 text-blue-500" /> Save as JSON
                </button>
                <button onClick={() => { fileInputRef.current?.click(); setExportOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <Upload className="w-4 h-4 text-violet-500" /> Load from JSON...
                </button>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportJSON} />
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div className="w-[35%] border-r border-slate-200 overflow-y-auto bg-[#F8FAFC]">
          <div className="p-4 space-y-3">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <button onClick={() => setInfoOpen(!infoOpen)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-400" />
                  <span className="text-sm font-semibold text-slate-700">Workflow Info</span>
                  {meta.workflowName && <span className="text-xs text-slate-400 ml-1">{"\u2014"} {meta.workflowName}</span>}
                </div>
                {infoOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              </button>
              {infoOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
                  <div>
                    <label className={labelCls}>Workflow Name</label>
                    <input className={inputCls} value={meta.workflowName} placeholder="e.g. Proposal Writing" onChange={e => metaField("workflowName", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Team Name</label>
                    <input className={inputCls} value={meta.teamName} placeholder="e.g. Design Team" onChange={e => metaField("teamName", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls}>Department</label>
                      <select className={inputCls} value={meta.department} onChange={e => metaField("department", e.target.value)}>
                        {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Frequency</label>
                      <select className={inputCls} value={meta.frequency} onChange={e => metaField("frequency", e.target.value)}>
                        {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Compare mode: tabs */}
            {mode === "compare" && (
              <div className="flex bg-slate-100 rounded-lg p-1">
                <button onClick={() => setCompareTab("as-is")}
                  className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${compareTab === "as-is" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500"}`}>
                  As-Is Steps ({stepsAsIs.length})
                </button>
                <button onClick={() => setCompareTab("to-be")}
                  className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${compareTab === "to-be" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500"}`}>
                  To-Be Steps ({(stepsToBe || []).length})
                </button>
              </div>
            )}

            {/* Step cards */}
            {(mode === "as-is" || (mode === "compare" && compareTab === "as-is")) && (
              <>
                <div className="space-y-2">
                  {displayOrderAsIs.map((step, i) => (
                    <AsIsStepCard key={step.id} step={step} index={i}
                      expanded={expanded.has(step.id)} onToggle={() => toggleStep(step.id)}
                      onChange={asIsActions.update} onDelete={asIsActions.del} onDup={asIsActions.dup}
                      onUp={(id) => asIsActions.move(id, -1)} onDown={(id) => asIsActions.move(id, 1)}
                      isFirst={i === 0} isLast={i === displayOrderAsIs.length - 1} />
                  ))}
                </div>
                {mode !== "compare" && (
                  <button onClick={addAsIsStep}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 text-sm font-medium hover:border-[#F96167] hover:text-[#F96167] hover:bg-[#F96167]/5 transition-all">
                    <Plus className="w-4 h-4" />
                    Add Step ({stepsAsIs.length}/{MAX_STEPS})
                  </button>
                )}
              </>
            )}

            {(mode === "to-be" || (mode === "compare" && compareTab === "to-be")) && (
              <>
                {toBeNotCreated ? (
                  <div className="bg-white rounded-xl border-2 border-dashed border-slate-300 p-8 text-center space-y-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-teal-50 to-blue-50 flex items-center justify-center mx-auto">
                      <Layers className="w-6 h-6 text-teal-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-700">Create your To-Be Workflow</h3>
                      <p className="text-xs text-slate-400 mt-1">Design how AI will transform your current process</p>
                    </div>
                    <div className="flex gap-2 justify-center">
                      <button onClick={seedToBeFromAsIs}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-500 text-white text-sm font-medium hover:bg-teal-600 transition-colors">
                        <Sprout className="w-4 h-4" />
                        Seed from As-Is
                      </button>
                      <button onClick={startToBeEmpty}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
                        <Sparkles className="w-4 h-4" />
                        Start Empty
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {displayOrderToBe.map((step, i) => (
                        <ToBeStepCard key={step.id} step={step} index={i}
                          expanded={expanded.has(step.id)} onToggle={() => toggleStep(step.id)}
                          onChange={toBeActions.update} onDelete={toBeActions.del} onDup={toBeActions.dup}
                          onUp={(id) => toBeActions.move(id, -1)} onDown={(id) => toBeActions.move(id, 1)}
                          isFirst={i === 0} isLast={i === displayOrderToBe.length - 1} />
                      ))}
                    </div>
                    {mode !== "compare" && (
                      <button onClick={addToBeStep}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 text-sm font-medium hover:border-teal-500 hover:text-teal-600 hover:bg-teal-50/50 transition-all">
                        <Plus className="w-4 h-4" />
                        Add Step ({(stepsToBe || []).length}/{MAX_STEPS})
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-[65%] overflow-y-auto bg-[#F8FAFC]" ref={vizRef}>
          <div className="p-6">
            {mode === "as-is" && stepsAsIs.length === 0 && (
              <div className="flex flex-col items-center justify-center h-96 text-slate-400">
                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                  <Layers className="w-8 h-8 text-slate-300" />
                </div>
                <p className="text-lg font-medium text-slate-500">Add your first workflow step</p>
                <p className="text-sm mt-1">to get started</p>
              </div>
            )}

            {mode === "as-is" && stepsAsIs.length > 0 && (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <h2 className="text-base font-bold text-slate-700">As-Is Workflow</h2>
                  {meta.workflowName && <span className="text-sm text-slate-400">{meta.workflowName}</span>}
                  <span className="ml-auto flex items-center gap-1 text-xs text-slate-400">
                    <Move className="w-3 h-3" /> Drag nodes {"\u00B7"} Ctrl+Scroll to zoom {"\u00B7"} Click to select {"\u00B7"} Del to remove
                  </span>
                </div>
                <AsIsChart steps={stepsAsIs} {...asIsChartProps} />
                <Stats stepsAsIs={stepsAsIs} stepsToBe={stepsToBe} mode={mode} />
              </>
            )}

            {mode === "to-be" && (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <h2 className="text-base font-bold text-slate-700">To-Be Workflow</h2>
                  {meta.workflowName && <span className="text-sm text-slate-400">{meta.workflowName}</span>}
                  <span className="ml-auto flex items-center gap-1 text-xs text-slate-400">
                    <Move className="w-3 h-3" /> Drag nodes {"\u00B7"} Ctrl+Scroll to zoom {"\u00B7"} Click to select {"\u00B7"} Del to remove
                  </span>
                </div>
                {toBeNotCreated ? (
                  <div className="flex flex-col items-center justify-center h-96 text-slate-400">
                    <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center mb-4">
                      <Layers className="w-8 h-8 text-teal-300" />
                    </div>
                    <p className="text-lg font-medium text-slate-500">Create your To-Be workflow</p>
                    <p className="text-sm mt-1">Use the left panel to seed from As-Is or start empty</p>
                  </div>
                ) : stepsToBe.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-96 text-slate-400">
                    <div className="w-16 h-16 rounded-full bg-teal-50 flex items-center justify-center mb-4">
                      <Layers className="w-8 h-8 text-teal-300" />
                    </div>
                    <p className="text-lg font-medium text-slate-500">Add your first To-Be step</p>
                    <p className="text-sm mt-1">to design the AI-enhanced workflow</p>
                  </div>
                ) : (
                  <ToBeChart steps={stepsToBe} {...toBeChartProps} />
                )}
                <Stats stepsAsIs={stepsAsIs} stepsToBe={stepsToBe} mode={mode} />
              </>
            )}

            {mode === "compare" && (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <h2 className="text-base font-bold text-slate-700">Workflow Comparison</h2>
                  {meta.workflowName && <span className="text-sm text-slate-400">{meta.workflowName}</span>}
                </div>
                <div className="space-y-8">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-500 mb-3 uppercase tracking-wider flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-slate-400" /> Current Process (As-Is) {"\u2014"} {stepsAsIs.length} steps
                    </h3>
                    <AsIsChart steps={stepsAsIs} compact {...asIsChartProps} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-500 mb-3 uppercase tracking-wider flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-teal-500" /> Redesigned Process (To-Be) {"\u2014"} {(stepsToBe || []).length} steps
                    </h3>
                    {stepsToBe && stepsToBe.length > 0 ? (
                      <ToBeChart steps={stepsToBe} compact {...toBeChartProps} />
                    ) : (
                      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
                        No To-Be workflow defined yet. Switch to To-Be mode to create one.
                      </div>
                    )}
                  </div>
                  <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                    <BarChart stepsAsIs={stepsAsIs} stepsToBe={stepsToBe} />
                  </div>
                </div>
                <Stats stepsAsIs={stepsAsIs} stepsToBe={stepsToBe} mode={mode} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="flex-shrink-0 border-t border-slate-200 bg-white">
        <div className="px-6 py-2.5 flex items-center justify-between">
          <span className="text-xs text-slate-400">AI {"\u00D7"} Workflow Redesign Hackathon | Integrated Field</span>
          <span className="text-xs text-slate-300">
            {stepsAsIs.length} as-is step{stepsAsIs.length !== 1 ? "s" : ""}
            {stepsToBe ? ` \u00B7 ${stepsToBe.length} to-be step${stepsToBe.length !== 1 ? "s" : ""}` : ""}
            {" \u00B7 "}{mode.replace("-", " ").replace(/\b\w/g, c => c.toUpperCase())} mode
          </span>
        </div>
      </footer>
    </div>
  );
}
