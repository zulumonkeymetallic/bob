/**
 * VisualCanvas — /canvas
 *
 * Hierarchy canvas showing:
 *   FocusGoal → Umbrella Goal → Phase/Leaf Goal → Story → Task
 *
 * Features:
 * - Two layout modes: Swimlane (left→right columns) · Tree (top-down, orthogonal connectors)
 * - Filters: search, theme, active-only, focus-only, show stories/tasks, sprint filter
 * - Goal cards matching /goals card style
 * - PlanActionBar
 * - Link Mode: click source → click target → writes to Firestore
 * - Pan + zoom
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Dropdown, Form, OverlayTrigger, Tooltip } from 'react-bootstrap';
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { ZoomIn, ZoomOut, RotateCcw, Link2, Link2Off, Filter, GitBranch, Rows3, Info } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { Goal, Story, Task, Sprint } from '../types';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { themeVars } from '../utils/themeVars';
import { colorWithAlpha, goalThemeColor as resolveGoalThemeColor } from '../utils/storyCardFormatting';
import { getThemeName } from '../utils/statusHelpers';
import PlanActionBar from './planner/PlanActionBar';

// ─── Types ────────────────────────────────────────────────────────────────────

type ColType = 'focus' | 'umbrella' | 'phase' | 'story' | 'task';
type ViewLayout = 'swimlane' | 'tree';

interface CanvasNode {
  id: string;
  col: ColType;
  colIndex: number;     // swimlane: position within column
  data: Goal | Story | Task | any;
  parentIds: string[];
}

interface TreePos { x: number; y: number; }

// ─── Constants ────────────────────────────────────────────────────────────────

// Swimlane
const COL_WIDTH    = 240;
const COL_GAP      = 80;
const NODE_HEIGHT  = 100;
const NODE_GAP     = 16;
const COL_LABEL_H  = 36;
const TOP_PAD      = 60;

// Tree
const TREE_NODE_W  = 220;
const TREE_NODE_H  = 96;
const TREE_H_GAP   = 40;
const TREE_V_GAP   = 64;
const TREE_TOP_PAD = 24;
const TREE_LEFT_PAD = 40;

const COL_ORDER: ColType[] = ['focus', 'umbrella', 'phase', 'story', 'task'];

const COL_LABELS: Record<ColType, string> = {
  focus:   'Focus Goals',
  umbrella:'Umbrella Goals',
  phase:   'Phase / Leaf Goals',
  story:   'Stories',
  task:    'Tasks',
};

const COL_COLOURS: Record<ColType, string> = {
  focus:   '#6366f1',
  umbrella:'#0ea5e9',
  phase:   '#10b981',
  story:   '#f59e0b',
  task:    '#6b7280',
};

const FOCUS_GOAL_EXPLAINER =
  'A Focus Goal is your planning lens for a period of time. It groups one or more Umbrella (long-horizon) Goals and their child phases so they appear together in dashboards, KPI widgets, and the coach. You can have multiple Focus Goals — e.g. one for work and one for fitness — but only one is active at a time.';

// ─── Swimlane position helpers ─────────────────────────────────────────────────

function nodeX(col: ColType): number {
  return COL_ORDER.indexOf(col) * (COL_WIDTH + COL_GAP) + 40;
}

function nodeY(colIndex: number): number {
  return TOP_PAD + COL_LABEL_H + colIndex * (NODE_HEIGHT + NODE_GAP);
}

// ─── Tree layout ──────────────────────────────────────────────────────────────

function computeTreePositions(
  nodes: CanvasNode[],
  connections: { fromId: string; toId: string }[],
): Map<string, TreePos> {
  const childrenOf = new Map<string, string[]>();
  const hasParent  = new Set<string>();
  connections.forEach(c => {
    if (!childrenOf.has(c.fromId)) childrenOf.set(c.fromId, []);
    childrenOf.get(c.fromId)!.push(c.toId);
    hasParent.add(c.toId);
  });

  // Nodes with no incoming edge in our connection set are roots
  const roots = nodes.filter(n => !hasParent.has(n.id));

  // Recursively compute how many px of horizontal space a subtree needs
  const subtreeWidth = (id: string): number => {
    const children = childrenOf.get(id) || [];
    if (!children.length) return TREE_NODE_W;
    const childrenTotal = children.reduce(
      (sum, cid) => sum + subtreeWidth(cid) + TREE_H_GAP,
      -TREE_H_GAP,
    );
    return Math.max(TREE_NODE_W, childrenTotal);
  };

  const positions = new Map<string, TreePos>();

  const assign = (id: string, slotLeft: number, depth: number) => {
    const sw = subtreeWidth(id);
    const cx = slotLeft + sw / 2 - TREE_NODE_W / 2;
    const y  = TREE_TOP_PAD + depth * (TREE_NODE_H + TREE_V_GAP);
    positions.set(id, { x: cx, y });
    const children = childrenOf.get(id) || [];
    let childLeft = slotLeft;
    children.forEach(cid => {
      assign(cid, childLeft, depth + 1);
      childLeft += subtreeWidth(cid) + TREE_H_GAP;
    });
  };

  let rootLeft = TREE_LEFT_PAD;
  roots.forEach(root => {
    assign(root.id, rootLeft, 0);
    rootLeft += subtreeWidth(root.id) + TREE_H_GAP * 2;
  });

  return positions;
}

// ─── SVG path helpers ─────────────────────────────────────────────────────────

/** Cubic bezier for swimlane (left-to-right) */
function bezierPath(fx: number, fy: number, tx: number, ty: number): string {
  const mx = (fx + tx) / 2;
  return `M ${fx} ${fy} C ${mx} ${fy}, ${mx} ${ty}, ${tx} ${ty}`;
}

/** Orthogonal elbow for tree (top-to-bottom) */
function elbowPath(fx: number, fy: number, tx: number, ty: number): string {
  const midY = (fy + ty) / 2;
  return `M ${fx} ${fy} L ${fx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
}

// ─── Goal theme colour ────────────────────────────────────────────────────────

function goalThemeColor(goal: any): string {
  return resolveGoalThemeColor(goal, GLOBAL_THEMES) || (themeVars.brand as string) || '#6366f1';
}

// ─── Node Card ────────────────────────────────────────────────────────────────

const NodeCard: React.FC<{
  node: CanvasNode;
  nodeW: number;
  selected: boolean;
  linkSource: boolean;
  linkTarget: boolean;
  linkMode: boolean;
  showDescriptions: boolean;
  onClick: () => void;
}> = ({ node, nodeW, selected, linkSource, linkTarget, linkMode, showDescriptions, onClick }) => {
  const col  = node.col;
  const data = node.data as any;

  const accentColor =
    col === 'focus' || col === 'umbrella' || col === 'phase'
      ? goalThemeColor(data)
      : COL_COLOURS[col];

  const statusLabel =
    col === 'story' ? (data.status === 0 ? 'Backlog' : data.status === 1 ? 'In Progress' : data.status >= 4 ? 'Done' : 'Planned')
    : col === 'task'  ? (data.status === 'done' ? 'Done' : data.status === 'in_progress' ? 'Doing' : 'To do')
    : String(data.status ?? '');

  const ring = selected    ? `0 0 0 2px ${accentColor}` :
               linkSource  ? '0 0 0 2px #6366f1' :
               linkTarget  ? '0 0 0 2px #10b981' : 'none';

  return (
    <div
      onClick={onClick}
      style={{
        width: nodeW,
        minHeight: TREE_NODE_H,
        background: 'var(--notion-bg, #fff)',
        border: `1px solid ${colorWithAlpha(accentColor, 0.3)}`,
        borderRadius: 8,
        overflow: 'hidden',
        cursor: linkMode ? 'crosshair' : 'pointer',
        boxShadow: ring !== 'none' ? ring : '0 2px 6px rgba(0,0,0,0.08)',
        transition: 'box-shadow 0.15s ease',
      }}
    >
      {/* Theme strip */}
      <div style={{ height: 4, background: accentColor }} />
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3, color: 'var(--notion-text, #1a1a1a)' }}>
          {data.title || data.ref || 'Untitled'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
          {(col === 'focus' || col === 'umbrella' || col === 'phase') && data.theme && (
            <span className="kanban-card__meta-badge">{getThemeName(data.theme)}</span>
          )}
          {statusLabel && <span className="kanban-card__meta-badge">{statusLabel}</span>}
          {data.goalKind && (
            <span className="kanban-card__meta-badge" style={{ textTransform: 'capitalize' }}>{data.goalKind}</span>
          )}
          {data.priority && (col === 'story' || col === 'task') && (
            <span className="kanban-card__meta-badge">{String(data.priority)}</span>
          )}
        </div>
        {showDescriptions && data.description && (
          <div style={{ fontSize: 11, color: 'var(--notion-text-muted, #666)', lineHeight: 1.4, marginTop: 2 }}>
            {String(data.description).slice(0, 80)}{data.description.length > 80 ? '…' : ''}
          </div>
        )}
        {(col === 'umbrella' || col === 'phase') && Array.isArray(data.kpis) && data.kpis.length > 0 && (
          <div style={{ fontSize: 10, color: 'var(--notion-text-muted, #888)', marginTop: 2 }}>
            {data.kpis.slice(0, 2).map((k: any) => `${k.name}: ${k.target}${k.unit}`).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const VisualCanvas: React.FC = () => {
  const { currentUser } = useAuth();
  const canvasRef = useRef<HTMLDivElement>(null);

  // ── Data ────────────────────────────────────────────────────────────────────
  const [goals,      setGoals]      = useState<Goal[]>([]);
  const [stories,    setStories]    = useState<Story[]>([]);
  const [tasks,      setTasks]      = useState<Task[]>([]);
  const [focusGoals, setFocusGoals] = useState<any[]>([]);
  const [sprints,    setSprints]    = useState<Sprint[]>([]);

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [searchTerm,       setSearchTerm]       = useState('');
  const [filterTheme,      setFilterTheme]      = useState('');
  const [filterSprintId,   setFilterSprintId]   = useState('');
  const [activeOnly,       setActiveOnly]       = useState(false);
  const [focusOnly,        setFocusOnly]        = useState(false);
  const [showStories,      setShowStories]      = useState(true);
  const [showTasks,        setShowTasks]        = useState(false);
  const [showDescriptions, setShowDescriptions] = useState(false);

  // ── Layout ───────────────────────────────────────────────────────────────────
  const [viewLayout, setViewLayout] = useState<ViewLayout>('swimlane');

  // ── Canvas state ─────────────────────────────────────────────────────────────
  const [scale,     setScale]     = useState(1);
  const [offset,    setOffset]    = useState({ x: 40, y: 20 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  // ── Interaction ──────────────────────────────────────────────────────────────
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [linkMode,    setLinkMode]    = useState(false);
  const [linkSource,  setLinkSource]  = useState<string | null>(null);
  const [linkStatus,  setLinkStatus]  = useState<string | null>(null);

  // ── Firestore subscriptions ──────────────────────────────────────────────────
  useEffect(() => {
    if (!currentUser) return;
    const uid = currentUser.uid;

    const unsubs = [
      onSnapshot(query(collection(db, 'goals'),      where('ownerUid', '==', uid)), snap =>
        setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal)))),
      onSnapshot(query(collection(db, 'stories'),    where('ownerUid', '==', uid)), snap =>
        setStories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Story)))),
      onSnapshot(query(collection(db, 'tasks'),      where('ownerUid', '==', uid)), snap =>
        setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)))),
      onSnapshot(query(collection(db, 'focusGoals'), where('ownerUid', '==', uid)), snap =>
        setFocusGoals(snap.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'sprints'),    where('ownerUid', '==', uid)), snap =>
        setSprints(snap.docs.map(d => ({ id: d.id, ...d.data() } as Sprint)))),
    ];
    return () => unsubs.forEach(u => u());
  }, [currentUser]);

  // ── Active focus goal ────────────────────────────────────────────────────────
  const activeFocusGoal = useMemo(
    () => focusGoals.find(fg => fg.isActive) || focusGoals[0] || null,
    [focusGoals],
  );
  const focusGoalIds = useMemo<Set<string>>(
    () => new Set(activeFocusGoal ? (activeFocusGoal.goalIds || []) : []),
    [activeFocusGoal],
  );

  // Sorted sprints for the sprint filter dropdown
  const sortedSprints = useMemo(
    () => [...sprints].sort((a, b) => (a.startDate || 0) - (b.startDate || 0)),
    [sprints],
  );

  // ── Node computation ─────────────────────────────────────────────────────────
  const { nodes, connections } = useMemo(() => {
    const search = searchTerm.toLowerCase();

    const filteredGoals = goals.filter(g => {
      if (activeOnly && Number(g.status) !== 1) return false;
      if (focusOnly && !focusGoalIds.has(g.id)) return false;
      if (filterTheme && getThemeName(g.theme) !== filterTheme) return false;
      if (search && !g.title?.toLowerCase().includes(search)) return false;
      return true;
    });

    const umbrellaGoals = filteredGoals.filter(g => (g as any).goalKind === 'umbrella');
    const phaseGoals    = filteredGoals.filter(g =>
      (g as any).goalKind === 'milestone' || (g as any).parentGoalId);
    const otherGoals    = filteredGoals.filter(g =>
      !(g as any).goalKind || ((g as any).goalKind !== 'umbrella' && !(g as any).parentGoalId));

    const visibleFocusGoals = focusGoals.slice(0, 5);

    const goalIdSet = new Set(filteredGoals.map(g => g.id));

    const filteredStories = showStories ? stories.filter(s => {
      if (!s.goalId || !goalIdSet.has(s.goalId)) return false;
      if (activeOnly && s.status !== 1) return false;
      if (filterSprintId && (s as any).sprintId !== filterSprintId) return false;
      if (search && !s.title?.toLowerCase().includes(search)) return false;
      return true;
    }) : [];

    const storyIdSet = new Set(filteredStories.map(s => s.id));
    const filteredTasks = showTasks ? tasks.filter(t => {
      if (!t.storyId || !storyIdSet.has(t.storyId)) return false;
      if (activeOnly && String(t.status) !== 'in_progress') return false;
      if (filterSprintId) {
        // Tasks inherit sprint from their story; also check direct sprintId if present
        const story = filteredStories.find(s => s.id === t.storyId);
        if (!story) return false;
        if ((story as any).sprintId !== filterSprintId) return false;
      }
      if (search && !t.title?.toLowerCase().includes(search)) return false;
      return true;
    }) : [];

    const buildNodes = (items: any[], col: ColType, parentIdFn: (item: any) => string[]): CanvasNode[] =>
      items.map((item, i) => ({
        id: item.id,
        col,
        colIndex: i,
        data: item,
        parentIds: parentIdFn(item),
      }));

    const allNodes: CanvasNode[] = [
      ...buildNodes(visibleFocusGoals, 'focus', () => []),
      ...buildNodes([...umbrellaGoals, ...otherGoals], 'umbrella', g => {
        return visibleFocusGoals
          .filter(fg => (fg.goalIds || []).includes(g.id))
          .map((fg: any) => fg.id);
      }),
      ...buildNodes(phaseGoals, 'phase', g => [(g as any).parentGoalId].filter(Boolean)),
      ...buildNodes(filteredStories, 'story', s => [s.goalId].filter(Boolean)),
      ...buildNodes(filteredTasks,   'task',  t => [t.storyId].filter(Boolean)),
    ];

    const nodeMap = new Map(allNodes.map(n => [n.id, n]));
    const conns: { id: string; fromId: string; toId: string }[] = [];
    allNodes.forEach(n => {
      n.parentIds.forEach(pid => {
        if (nodeMap.has(pid)) {
          conns.push({ id: `${pid}→${n.id}`, fromId: pid, toId: n.id });
        }
      });
    });

    return { nodes: allNodes, connections: conns };
  }, [
    goals, stories, tasks, focusGoals, focusGoalIds,
    filterTheme, filterSprintId, activeOnly, focusOnly,
    showStories, showTasks, searchTerm,
  ]);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // ── Tree positions ───────────────────────────────────────────────────────────
  const treePositions = useMemo(
    () => computeTreePositions(nodes, connections),
    [nodes, connections],
  );

  // ── Canvas geometry ──────────────────────────────────────────────────────────
  const swimlaneHeight = useMemo(() => {
    const byCol: Record<string, number> = {};
    nodes.forEach(n => { byCol[n.col] = Math.max(byCol[n.col] || 0, n.colIndex + 1); });
    const maxRows = Math.max(...Object.values(byCol), 1);
    return TOP_PAD + COL_LABEL_H + maxRows * (NODE_HEIGHT + NODE_GAP) + 80;
  }, [nodes]);

  const swimlaneWidth = useMemo(() => {
    const colsInUse = new Set(nodes.map(n => n.col));
    const maxCol = Math.max(...[...colsInUse].map(c => COL_ORDER.indexOf(c)), 2);
    return (maxCol + 1) * (COL_WIDTH + COL_GAP) + 80;
  }, [nodes]);

  const treeHeight = useMemo(() => {
    if (!treePositions.size) return 600;
    const maxY = Math.max(...[...treePositions.values()].map(p => p.y));
    return maxY + TREE_NODE_H + 80;
  }, [treePositions]);

  const treeWidth = useMemo(() => {
    if (!treePositions.size) return 800;
    const maxX = Math.max(...[...treePositions.values()].map(p => p.x));
    return maxX + TREE_NODE_W + 80;
  }, [treePositions]);

  // ── SVG paths ─────────────────────────────────────────────────────────────────
  const getSwimlanePathD = useCallback((fromId: string, toId: string): string => {
    const from = nodeMap.get(fromId);
    const to   = nodeMap.get(toId);
    if (!from || !to) return '';
    const fx = nodeX(from.col) + COL_WIDTH;
    const fy = nodeY(from.colIndex) + NODE_HEIGHT / 2;
    const tx = nodeX(to.col);
    const ty = nodeY(to.colIndex) + NODE_HEIGHT / 2;
    return bezierPath(fx, fy, tx, ty);
  }, [nodeMap]);

  const getTreePathD = useCallback((fromId: string, toId: string): string => {
    const fp = treePositions.get(fromId);
    const tp = treePositions.get(toId);
    if (!fp || !tp) return '';
    // Centre-bottom of parent → centre-top of child
    const fx = fp.x + TREE_NODE_W / 2;
    const fy = fp.y + TREE_NODE_H;
    const tx = tp.x + TREE_NODE_W / 2;
    const ty = tp.y;
    return elbowPath(fx, fy, tx, ty);
  }, [treePositions]);

  // ── Pan ───────────────────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.canvas-node-card')) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setOffset({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  };
  const handleMouseUp = () => setIsPanning(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale(s => Math.max(0.25, Math.min(2, s + (e.deltaY > 0 ? -0.08 : 0.08))));
  };

  // ── Link creation ─────────────────────────────────────────────────────────────
  const handleNodeClick = async (node: CanvasNode) => {
    if (!linkMode) {
      setSelectedId(prev => prev === node.id ? null : node.id);
      return;
    }
    if (!linkSource) {
      setLinkSource(node.id);
      setLinkStatus(`Selected "${(node.data as any).title || node.id}" — now click the target node`);
      return;
    }
    if (linkSource === node.id) {
      setLinkSource(null);
      setLinkStatus(null);
      return;
    }
    const srcNode = nodeMap.get(linkSource);
    const tgtNode = node;
    if (!srcNode) return;
    try {
      if ((srcNode.col === 'umbrella' || srcNode.col === 'phase') && (tgtNode.col === 'umbrella' || tgtNode.col === 'phase')) {
        await updateDoc(doc(db, 'goals', tgtNode.id), { parentGoalId: srcNode.id });
        setLinkStatus(`✅ Linked "${(srcNode.data as any).title}" → "${(tgtNode.data as any).title}"`);
      } else if ((srcNode.col === 'umbrella' || srcNode.col === 'phase') && tgtNode.col === 'story') {
        await updateDoc(doc(db, 'stories', tgtNode.id), { goalId: srcNode.id });
        setLinkStatus(`✅ Linked story to goal "${(srcNode.data as any).title}"`);
      } else if (srcNode.col === 'story' && tgtNode.col === 'task') {
        await updateDoc(doc(db, 'tasks', tgtNode.id), { storyId: srcNode.id });
        setLinkStatus(`✅ Linked task to story "${(srcNode.data as any).title}"`);
      } else if (srcNode.col === 'focus' && (tgtNode.col === 'umbrella' || tgtNode.col === 'phase')) {
        const fg = focusGoals.find(f => f.id === srcNode.id);
        if (fg) {
          const existing: string[] = fg.goalIds || [];
          if (!existing.includes(tgtNode.id)) {
            await updateDoc(doc(db, 'focusGoals', srcNode.id), {
              goalIds: [...existing, tgtNode.id],
            });
            setLinkStatus(`✅ Added "${(tgtNode.data as any).title}" to focus goal`);
          } else {
            setLinkStatus('ℹ️ Already linked');
          }
        }
      } else {
        setLinkStatus('⚠️ Cannot link these two node types');
      }
    } catch (e: any) {
      setLinkStatus(`❌ ${e.message}`);
    }
    setLinkSource(null);
    setTimeout(() => setLinkStatus(null), 4000);
  };

  // ─── Computed for render ──────────────────────────────────────────────────────
  const colsInUse = useMemo(() => {
    const s = new Set(nodes.map(n => n.col));
    return COL_ORDER.filter(c => s.has(c));
  }, [nodes]);

  const canvasW = viewLayout === 'tree' ? treeWidth  : swimlaneWidth;
  const canvasH = viewLayout === 'tree' ? treeHeight : swimlaneHeight;
  const nodeW   = viewLayout === 'tree' ? TREE_NODE_W : COL_WIDTH;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="d-flex flex-column" style={{ height: '100vh', overflow: 'hidden' }}>

      {/* Action bar */}
      <div className="border-bottom px-3 py-2 d-flex align-items-center gap-2 flex-wrap bg-white">
        <PlanActionBar />
      </div>

      {/* Toolbar */}
      <div className="border-bottom px-3 py-2 d-flex align-items-center gap-2 flex-wrap bg-white" style={{ zIndex: 10 }}>

        {/* Layout toggle */}
        <div className="btn-group btn-group-sm" role="group" aria-label="Layout">
          <OverlayTrigger placement="bottom" overlay={<Tooltip>Swimlane — left-to-right columns</Tooltip>}>
            <Button
              size="sm"
              variant={viewLayout === 'swimlane' ? 'primary' : 'outline-secondary'}
              onClick={() => setViewLayout('swimlane')}
            >
              <Rows3 size={14} />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger placement="bottom" overlay={<Tooltip>Tree — top-down hierarchy with right-angled connectors</Tooltip>}>
            <Button
              size="sm"
              variant={viewLayout === 'tree' ? 'primary' : 'outline-secondary'}
              onClick={() => setViewLayout('tree')}
            >
              <GitBranch size={14} />
            </Button>
          </OverlayTrigger>
        </div>

        <div className="vr" />

        <Form.Control
          size="sm"
          placeholder="Search…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ width: 160 }}
        />

        {/* Theme filter */}
        <Form.Select
          size="sm"
          value={filterTheme}
          onChange={e => setFilterTheme(e.target.value)}
          style={{ width: 130 }}
        >
          <option value="">All themes</option>
          {GLOBAL_THEMES.map(t => (
            <option key={t.id} value={t.label}>{t.label}</option>
          ))}
        </Form.Select>

        {/* Sprint filter (stories/tasks) */}
        {showStories && (
          <Form.Select
            size="sm"
            value={filterSprintId}
            onChange={e => setFilterSprintId(e.target.value)}
            style={{ width: 150 }}
          >
            <option value="">All sprints</option>
            {sortedSprints.map(s => (
              <option key={s.id} value={s.id}>{(s as any).name || s.id}</option>
            ))}
          </Form.Select>
        )}

        <div className="vr" />

        {/* Layer toggles */}
        <Button size="sm" variant={showStories ? 'primary' : 'outline-secondary'} onClick={() => setShowStories(s => !s)}>
          Stories
        </Button>
        <Button size="sm" variant={showTasks ? 'primary' : 'outline-secondary'} onClick={() => setShowTasks(t => !t)} disabled={!showStories}>
          Tasks
        </Button>

        <div className="vr" />

        <Button size="sm" variant={activeOnly ? 'warning' : 'outline-secondary'} onClick={() => setActiveOnly(a => !a)}>
          Active only
        </Button>
        <Button size="sm" variant={focusOnly ? 'info' : 'outline-secondary'} onClick={() => setFocusOnly(f => !f)}>
          Focus only
        </Button>
        <Button size="sm" variant={showDescriptions ? 'secondary' : 'outline-secondary'} onClick={() => setShowDescriptions(d => !d)}>
          Descriptions
        </Button>

        <div className="vr" />

        {/* Zoom controls */}
        <Button size="sm" variant="outline-secondary" onClick={() => setScale(s => Math.min(2, s + 0.15))}>
          <ZoomIn size={14} />
        </Button>
        <Button size="sm" variant="outline-secondary" onClick={() => setScale(s => Math.max(0.25, s - 0.15))}>
          <ZoomOut size={14} />
        </Button>
        <Button size="sm" variant="outline-secondary" onClick={() => { setScale(1); setOffset({ x: 40, y: 20 }); }}>
          <RotateCcw size={14} />
        </Button>
        <Badge bg="secondary" className="align-self-center">{Math.round(scale * 100)}%</Badge>

        <div className="vr" />

        {/* Link mode */}
        <OverlayTrigger placement="bottom" overlay={<Tooltip>Link Mode: click a source node, then a target to create a relationship in Firestore</Tooltip>}>
          <Button
            size="sm"
            variant={linkMode ? 'danger' : 'outline-primary'}
            onClick={() => { setLinkMode(m => !m); setLinkSource(null); setLinkStatus(null); }}
          >
            {linkMode ? <><Link2Off size={14} className="me-1" />Exit Link Mode</> : <><Link2 size={14} className="me-1" />Link Mode</>}
          </Button>
        </OverlayTrigger>

        {/* Focus Goal info */}
        <OverlayTrigger
          placement="bottom"
          overlay={<Tooltip style={{ maxWidth: 300 }}>{FOCUS_GOAL_EXPLAINER}</Tooltip>}
        >
          <span className="text-muted d-flex align-items-center" style={{ cursor: 'help' }}>
            <Info size={15} />
          </span>
        </OverlayTrigger>
      </div>

      {/* Link status bar */}
      {linkStatus && (
        <div className={`px-3 py-1 small ${linkStatus.startsWith('✅') ? 'bg-success-subtle text-success' : linkStatus.startsWith('❌') ? 'bg-danger-subtle text-danger' : linkStatus.startsWith('⚠️') ? 'bg-warning-subtle text-warning-emphasis' : 'bg-info-subtle text-info-emphasis'}`}>
          {linkStatus}
        </div>
      )}
      {linkMode && linkSource && (
        <div className="bg-primary-subtle text-primary px-3 py-1 small">
          Source selected: <strong>{(nodeMap.get(linkSource)?.data as any)?.title || linkSource}</strong> — click the target node
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        style={{ flex: 1, overflow: 'hidden', cursor: isPanning ? 'grabbing' : linkMode ? 'crosshair' : 'grab', background: 'var(--bs-light, #f8f9fa)' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            width: canvasW,
            height: canvasH,
            position: 'relative',
            transition: isPanning ? 'none' : 'transform 0.05s ease',
          }}
        >
          {/* SVG connections */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
            <defs>
              <marker id="arrowhead-h" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="var(--bs-primary, #0d6efd)" opacity="0.4" />
              </marker>
              <marker id="arrowhead-v" markerWidth="6" markerHeight="8" refX="3" refY="8" orient="auto">
                <polygon points="0 0, 6 0, 3 8" fill="#6b7280" opacity="0.5" />
              </marker>
            </defs>
            {connections.map(c => {
              const d = viewLayout === 'tree'
                ? getTreePathD(c.fromId, c.toId)
                : getSwimlanePathD(c.fromId, c.toId);
              if (!d) return null;
              return (
                <path
                  key={c.id}
                  d={d}
                  fill="none"
                  stroke={viewLayout === 'tree' ? '#6b7280' : 'var(--bs-primary, #0d6efd)'}
                  strokeWidth={1.5}
                  strokeOpacity={0.35}
                  markerEnd={viewLayout === 'tree' ? 'url(#arrowhead-v)' : 'url(#arrowhead-h)'}
                />
              );
            })}
          </svg>

          {/* ── SWIMLANE layout ───────────────────────────────────────────────── */}
          {viewLayout === 'swimlane' && (
            <>
              {/* Column headers */}
              {colsInUse.map(col => (
                <div
                  key={col}
                  style={{
                    position: 'absolute',
                    left: nodeX(col),
                    top: TOP_PAD,
                    width: COL_WIDTH,
                    height: COL_LABEL_H,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: COL_COLOURS[col],
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: COL_COLOURS[col], flexShrink: 0 }} />
                  {COL_LABELS[col]}
                  {col === 'focus' && (
                    <OverlayTrigger placement="right" overlay={<Tooltip style={{ maxWidth: 280 }}>{FOCUS_GOAL_EXPLAINER}</Tooltip>}>
                      <span style={{ cursor: 'help', opacity: 0.6, lineHeight: 1 }}>
                        <Info size={12} />
                      </span>
                    </OverlayTrigger>
                  )}
                  <Badge bg="light" text="dark" style={{ fontSize: 10 }}>
                    {nodes.filter(n => n.col === col).length}
                  </Badge>
                </div>
              ))}

              {/* Swimlane nodes */}
              {nodes.map(node => (
                <div
                  key={node.id}
                  className="canvas-node-card"
                  style={{ position: 'absolute', left: nodeX(node.col), top: nodeY(node.colIndex), zIndex: 2 }}
                >
                  <NodeCard
                    node={node}
                    nodeW={COL_WIDTH}
                    selected={selectedId === node.id}
                    linkSource={linkSource === node.id}
                    linkTarget={linkMode && !!linkSource && linkSource !== node.id}
                    linkMode={linkMode}
                    showDescriptions={showDescriptions}
                    onClick={() => handleNodeClick(node)}
                  />
                </div>
              ))}
            </>
          )}

          {/* ── TREE layout ───────────────────────────────────────────────────── */}
          {viewLayout === 'tree' && (
            <>
              {/* Tree nodes */}
              {nodes.map(node => {
                const pos = treePositions.get(node.id);
                if (!pos) return null;
                return (
                  <div
                    key={node.id}
                    className="canvas-node-card"
                    style={{ position: 'absolute', left: pos.x, top: pos.y, zIndex: 2 }}
                  >
                    <NodeCard
                      node={node}
                      nodeW={TREE_NODE_W}
                      selected={selectedId === node.id}
                      linkSource={linkSource === node.id}
                      linkTarget={linkMode && !!linkSource && linkSource !== node.id}
                      linkMode={linkMode}
                      showDescriptions={showDescriptions}
                      onClick={() => handleNodeClick(node)}
                    />
                  </div>
                );
              })}
            </>
          )}

          {/* Empty state */}
          {nodes.length === 0 && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
                color: '#6b7280',
              }}
            >
              <Filter size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
              <div className="fw-medium">No items match current filters</div>
              <div className="small mt-1">Try clearing filters or adding goals</div>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="border-top px-3 py-2 d-flex align-items-center gap-4 bg-white flex-wrap" style={{ fontSize: 11 }}>
        {COL_ORDER.map(col => (
          <div key={col} className="d-flex align-items-center gap-1">
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: COL_COLOURS[col] }} />
            <span className="text-muted">{COL_LABELS[col]}</span>
          </div>
        ))}
        <span className="text-muted ms-auto">
          {viewLayout === 'tree'
            ? 'Tree view — top-down hierarchy · Drag to pan · Scroll to zoom'
            : 'Swimlane view — drag to pan · scroll to zoom · Link Mode to create relationships'}
        </span>
      </div>
    </div>
  );
};

export default VisualCanvas;
export {};
