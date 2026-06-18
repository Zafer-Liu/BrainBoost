import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import { Loader2, Plus, X, Check, Link2 } from 'lucide-react'
import ReactFlow, {
  Background, Controls, MiniMap, ReactFlowProvider,
  useNodesState, useEdgesState,
  EdgeLabelRenderer, getSmoothStepPath,
  type Node, type Edge, type EdgeProps,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from 'reactflow'
import * as d3force from 'd3-force'
import { v4 as uuidv4 } from 'uuid'
import 'reactflow/dist/style.css'
import type { MindNode, MindEdge } from '../../types'
import type { AppStore } from '../../store/appStore'

interface Props {
  store: AppStore
  nodes: MindNode[]; edges: MindEdge[]
  topic: string; streaming?: boolean
  highlightNodeIds?: string[]
}

const EDGE_COLORS = [
  '#5b5ef7','#0284c7','#059669','#d97706',
  '#dc2626','#7c3aed','#db2777','#0d9488',
  '#ea580c','#0891b2','#65a30d','#9333ea',
]
const GROUP_COLORS = [
  '#5b5ef7','#0284c7','#059669','#d97706',
  '#dc2626','#7c3aed','#db2777','#0d9488',
]

function getGroupColor(g: string | undefined, groups: string[]) {
  if (!g) return '#94a3b8'
  return GROUP_COLORS[groups.indexOf(g) % GROUP_COLORS.length]
}

let _cvs: HTMLCanvasElement | null = null
function measureText(t: string, sz: number, w = 400) {
  if (!_cvs) _cvs = document.createElement('canvas')
  const ctx = _cvs.getContext('2d')!
  ctx.font = `${w} ${sz}px -apple-system,"PingFang SC",sans-serif`
  return ctx.measureText(t).width
}
function nodeSize(label: string, sz: number, w = 400) {
  const tw = measureText(label, sz, w)
  const width = Math.min(200, Math.max(72, Math.ceil(tw) + 32))
  const lines = tw + 32 > 200 ? 2 : 1
  return { w: width, h: Math.ceil(lines * sz * 1.5) + 16 }
}

// ── Edge — defined at module level ───────────────────────────────────────
function SmartEdge({ id, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, data }: EdgeProps) {
  const [path, lx, ly] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition, borderRadius: 14,
  })
  const color: string   = data?.color ?? '#94a3b8'
  const label: string   = data?.label ?? ''
  const structural      = !!(data?.structural)
  const active: boolean = !!(data?.active)
  const dimmed: boolean = !!(data?.dimmed)
  const op = dimmed ? 0.1 : 1
  const aid = `a${id.replace(/[^a-z0-9]/gi,'')}`

  return (
    <>
      <defs>
        <marker id={aid} markerWidth="8" markerHeight="8"
          refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L8,3 z" fill={color} fillOpacity={op} />
        </marker>
      </defs>
      <path d={path} fill="none" stroke={color}
        strokeWidth={active ? 10 : 3} strokeOpacity={active ? 0.14 : 0.06}
        style={{ transition: 'stroke-width 0.2s,stroke-opacity 0.2s' }} />
      <path d={path} fill="none" stroke={color}
        strokeWidth={structural ? 1.2 : 1.8}
        strokeOpacity={op * (structural ? 0.4 : 0.82)}
        strokeDasharray={structural ? '5 4' : undefined}
        markerEnd={`url(#${aid})`}
        style={{ transition: 'stroke-opacity 0.2s' }} />
      {active && (
        <path d={path} fill="none" stroke={color}
          strokeWidth={2.6} strokeDasharray="12 8" strokeLinecap="round"
          markerEnd={`url(#${aid})`}
          style={{ animation: 'flowDash 0.75s linear infinite' }} />
      )}
      {label && (
        <EdgeLabelRenderer>
          <div style={{
            position: 'absolute',
            transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`,
            pointerEvents: 'none', fontSize: 11, fontWeight: active ? 600 : 500,
            color: active ? '#fff' : color,
            background: active ? color : 'rgba(255,255,255,0.95)',
            padding: '3px 9px', borderRadius: 10,
            border: `1.5px solid ${color}`, whiteSpace: 'nowrap', opacity: op,
            boxShadow: active ? `0 3px 14px ${color}55` : `0 1px 4px ${color}22`,
            transition: 'all 0.2s', userSelect: 'none', zIndex: 1000,
          }} className="nodrag nopan">{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const edgeTypes = { smart: SmartEdge }

// ── Layout ────────────────────────────────────────────────────────────────
// Key improvements over previous version:
//  • OR 380 (was 230) — groups placed further from centre
//  • charge -900 (was -520) — much stronger repulsion
//  • collision radius += 36 (was +20) — wider personal space
//  • 300 warm-up ticks + 400 cool-down ticks (was 80+200)
//  • link distance: same-group 160 (was MR*1.2≈102), cross-group 280 (was 190)
function buildLayout(mindNodes: MindNode[], mindEdges: MindEdge[], topic: string) {
  const groups = [...new Set(mindNodes.map(n => n.group).filter(Boolean) as string[])]
  const topicSz = nodeSize(topic, 15, 700)
  const sizes = new Map<string, { w: number; h: number }>()
  sizes.set('__topic__', topicSz)
  for (const n of mindNodes) sizes.set(n.id, nodeSize(n.label, 13))

  const groupReps    = new Map<string, string>()
  const groupMembers = new Map<string, string[]>()
  for (const n of mindNodes) {
    const g = n.group || '__ungrouped__'
    if (!groupReps.has(g)) { groupReps.set(g, n.id); groupMembers.set(g, []) }
    groupMembers.get(g)!.push(n.id)
  }

  const gc = Math.max(groupReps.size, 1)
  // Outer radius scales with group count so groups are well-separated
  const OR = Math.max(320, gc * 70)
  // Member spread radius scales with group size
  const maxMembers = Math.max(...[...groupMembers.values()].map(m => m.length))
  const MR = Math.max(100, maxMembers * 28)

  interface SN extends d3force.SimulationNodeDatum { id: string }
  const sns: SN[] = [{ id: '__topic__', x: 0, y: 0 }]
  let gi = 0
  for (const [, members] of groupMembers) {
    const a = (gi / gc) * 2 * Math.PI - Math.PI / 2
    const cx = Math.cos(a) * OR, cy = Math.sin(a) * OR
    gi++
    members.forEach((id, mi) => {
      // Spread members in a fan perpendicular to the radial direction
      const sp = members.length > 1 ? ((mi / (members.length - 1)) - 0.5) * 1.6 : 0
      sns.push({
        id,
        x: cx + Math.cos(a + Math.PI / 2) * MR * sp + (Math.random() - 0.5) * 10,
        y: cy + Math.sin(a + Math.PI / 2) * MR * sp + (Math.random() - 0.5) * 10,
      })
    })
  }
  const idx = new Map(sns.map((n, i) => [n.id, i]))

  interface SL extends d3force.SimulationLinkDatum<SN> { source: number; target: number }
  const sls: SL[] = []
  for (const [, rep] of groupReps)
    sls.push({ source: idx.get('__topic__')!, target: idx.get(rep)! })
  for (const [g, members] of groupMembers) {
    const rep = groupReps.get(g)!
    for (const id of members) if (id !== rep) sls.push({ source: idx.get(rep)!, target: idx.get(id)! })
  }
  for (const e of mindEdges)
    if (idx.has(e.source) && idx.has(e.target))
      sls.push({ source: idx.get(e.source)!, target: idx.get(e.target)! })

  sns[0].fx = 0; sns[0].fy = 0

  const sim = d3force.forceSimulation(sns)
    .force('link', d3force.forceLink<SN, SL>(sls).id((_, i) => i)
      .distance(l => {
        const s = l.source as unknown as SN, t = l.target as unknown as SN
        if (s.id === '__topic__' || t.id === '__topic__') return OR * 0.9
        const sg = mindNodes.find(n => n.id === s.id)?.group
        const tg = mindNodes.find(n => n.id === t.id)?.group
        // same-group: moderate distance; cross-group: large distance
        return sg === tg ? 160 : 280
      })
      .strength(l => {
        const s = l.source as unknown as SN
        return s.id === '__topic__' ? 0.9 : 0.35
      }))
    .force('charge', d3force.forceManyBody()
      .strength(-900)        // was -520
      .distanceMin(40)
      .distanceMax(700))
    .force('collision', d3force.forceCollide<SN>().radius(n => {
      const sz = sizes.get(n.id) ?? { w: 100, h: 36 }
      // generous padding so labels never touch
      return Math.hypot(sz.w, sz.h) / 2 + 36
    }).strength(1).iterations(4))   // multiple iterations for stability
    .stop()

  // Warm up with fixed centre
  sim.tick(300)
  // Release centre and let settle
  sns[0].fx = undefined; sns[0].fy = undefined
  sim.alpha(0.4).alphaDecay(0.015)
  sim.tick(400)

  // ── Build flow nodes ───────────────────────────────────────────────────
  const flowNodes: Node[] = []
  const tp = sns[0]
  flowNodes.push({
    id: '__topic__',
    position: { x: tp.x! - topicSz.w / 2, y: tp.y! - topicSz.h / 2 },
    data: { label: topic, color: '#4547e0', baseColor: '#4547e0' },
    style: {
      width: topicSz.w, height: topicSz.h,
      background: '#5b5ef7', color: '#fff',
      border: '2px solid #4547e0', borderRadius: 14,
      fontWeight: 700, fontSize: 15,
      boxShadow: '0 4px 20px rgba(91,94,247,0.38)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 10px', textAlign: 'center',
    },
  })
  for (const n of mindNodes) {
    const sn = sns[idx.get(n.id)!]
    if (!sn) continue
    const { w, h } = sizes.get(n.id)!
    const color = getGroupColor(n.group, groups)
    const locked = !!n.locked
    flowNodes.push({
      id: n.id,
      position: { x: sn.x! - w / 2, y: sn.y! - h / 2 },
      data: { label: n.label, color, baseColor: color, group: n.group, locked },
      style: {
        width: w, height: h,
        background: locked ? '#fffbeb' : color + '18',
        color: '#1e2140',
        border: locked ? `2px dashed #f59e0b` : `1.5px solid ${color}`,
        borderRadius: 9,
        fontSize: 13, fontWeight: locked ? 600 : 400,
        boxShadow: locked ? `0 2px 10px #f59e0b44` : `0 2px 8px ${color}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 8px', textAlign: 'center', wordBreak: 'break-all',
      },
    })
  }

  // ── Build flow edges ───────────────────────────────────────────────────
  const flowEdges: Edge[] = []
  let ci = 0
  const repColor = new Map<string, string>()
  let gci = 0
  for (const [, rep] of groupReps) {
    const c = GROUP_COLORS[gci++ % GROUP_COLORS.length]
    repColor.set(rep, c)
    flowEdges.push({ id: `tr-${rep}`, source: '__topic__', target: rep, type: 'smart',
      data: { color: c, label: '', structural: true, active: false, dimmed: false } })
  }
  for (const [g, members] of groupMembers) {
    const rep = groupReps.get(g)!
    const c = repColor.get(rep) ?? '#94a3b8'
    for (const id of members) {
      if (id === rep) continue
      flowEdges.push({ id: `sr-${id}`, source: rep, target: id, type: 'smart',
        data: { color: c + '99', label: '', structural: true, active: false, dimmed: false } })
    }
  }
  for (let i = 0; i < mindEdges.length; i++) {
    const e = mindEdges[i]
    if (!idx.has(e.source) || !idx.has(e.target)) continue
    const c = EDGE_COLORS[ci++ % EDGE_COLORS.length]
    flowEdges.push({ id: `ue-${i}`, source: e.source, target: e.target, type: 'smart',
      data: { color: c, label: e.label ?? '', structural: false, active: false, dimmed: false },
      zIndex: 10 })
  }

  return { flowNodes, flowEdges }
}

// ── Types ──────────────────────────────────────────────────────────────────
interface CtxMenu {
  x: number; y: number
  type: 'node' | 'edge' | 'pane'
  nodeId?: string
  edgeIndex?: number
  edgeId?: string
  // pane: world-space position for new node
  worldX?: number; worldY?: number
}

interface InlineEdit {
  type: 'node' | 'edge'
  id: string
  value: string
  x: number; y: number
  w: number
}

// Panel for picking a connection after adding a new node
interface ConnectPanel {
  newNodeId: string
  x: number; y: number  // screen-relative to container
}

// ── Inner component ───────────────────────────────────────────────────────
function MindMapInner({ store, nodes: mindNodes, edges: mindEdges, topic,
  streaming = false, highlightNodeIds }: Props) {

  const { flowNodes: initNodes, flowEdges: initEdges } = useMemo(
    () => buildLayout(mindNodes, mindEdges, topic),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mindNodes, mindEdges, topic],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)
  const [showMinimap, setShowMinimap] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [inlineEdit, setInlineEdit] = useState<InlineEdit | null>(null)
  const [connectPanel, setConnectPanel] = useState<ConnectPanel | null>(null)
  const [connectSearch, setConnectSearch] = useState('')
  const inlineRef = useRef<HTMLInputElement | null>(null)
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    setNodes(initNodes)
    setEdges(initEdges)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initNodes, initEdges])

  // Close ctx menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const h = () => setCtxMenu(null)
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [ctxMenu])

  // ── Hover ───────────────────────────────────────────────────────────────
  const onNodeMouseEnter: NodeMouseHandler = useCallback((_, node) => {
    const hoveredId = node.id
    setEdges(prev => {
      const connected = new Set<string>([hoveredId])
      for (const e of prev) {
        if (e.source === hoveredId || e.target === hoveredId) {
          connected.add(e.source); connected.add(e.target)
        }
      }
      const nextEdges = prev.map(e => {
        const active = e.source === hoveredId || e.target === hoveredId
        return { ...e, data: { ...e.data, active, dimmed: !active } }
      })
      setNodes(prevNodes => prevNodes.map(n => {
        const isConn = connected.has(n.id)
        const baseColor: string = n.data?.baseColor ?? '#94a3b8'
        return { ...n, style: { ...n.style, opacity: isConn ? 1 : 0.15,
          boxShadow: isConn
            ? n.id === hoveredId
              ? `0 0 0 2.5px ${baseColor}, 0 4px 18px ${baseColor}55`
              : `0 2px 10px ${baseColor}44`
            : `0 2px 8px ${baseColor}22` } }
      }))
      return nextEdges
    })
  }, [setEdges, setNodes])

  const onNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    setEdges(prev => prev.map(e => ({ ...e, data: { ...e.data, active: false, dimmed: false } })))
    setNodes(prev => prev.map(n => ({ ...n, style: { ...n.style, opacity: 1,
      boxShadow: n.id === '__topic__'
        ? '0 4px 20px rgba(91,94,247,0.38)'
        : `0 2px 8px ${n.data?.baseColor ?? '#94a3b8'}22` } })))
  }, [setEdges, setNodes])

  // ── Card highlight ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!highlightNodeIds) return
    setNodes(prev => prev.map(n => {
      if (n.id === '__topic__') return n
      const lit = highlightNodeIds.length === 0 || highlightNodeIds.includes(n.id)
      const c: string = n.data?.baseColor ?? '#94a3b8'
      return { ...n, style: { ...n.style,
        opacity: highlightNodeIds.length === 0 ? 1 : lit ? 1 : 0.15,
        boxShadow: lit && highlightNodeIds.length > 0
          ? `0 0 0 2.5px ${c}, 0 4px 18px ${c}66`
          : `0 2px 8px ${c}22` } }
    }))
  }, [highlightNodeIds, setNodes])

  // ── Double-click node to edit label ─────────────────────────────────────
  const onNodeDoubleClick: NodeMouseHandler = useCallback((e, node) => {
    if (node.id === '__topic__') return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setInlineEdit({
      type: 'node', id: node.id,
      value: (node.data?.label as string) ?? '',
      x: e.clientX - rect.left, y: e.clientY - rect.top, w: 160,
    })
    setTimeout(() => inlineRef.current?.select(), 30)
  }, [])

  // ── Right-click node ─────────────────────────────────────────────────────
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    setCtxMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, type: 'node', nodeId: node.id })
  }, [])

  // ── Right-click edge ─────────────────────────────────────────────────────
  const onEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const edgeIdx = edge.id.startsWith('ue-') ? parseInt(edge.id.slice(3), 10) : -1
    setCtxMenu({
      x: e.clientX - rect.left, y: e.clientY - rect.top, type: 'edge',
      edgeIndex: edgeIdx >= 0 ? edgeIdx : undefined, edgeId: edge.id,
    })
  }, [])

  // ── Right-click pane: add node ───────────────────────────────────────────
  const onPaneContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || !rfInstanceRef.current) return
    const worldPos = rfInstanceRef.current.screenToFlowPosition({
      x: e.clientX, y: e.clientY,
    })
    setCtxMenu({
      x: e.clientX - rect.left, y: e.clientY - rect.top,
      type: 'pane', worldX: worldPos.x, worldY: worldPos.y,
    })
  }, [])

  // ── Inline edit commit (merged into commitEditAndMaybeConnect below) ─────

  // ── Context menu actions ──────────────────────────────────────────────────
  function ctxDeleteNode() {
    if (!ctxMenu?.nodeId) return
    store.deleteMindNode(ctxMenu.nodeId)
    setCtxMenu(null)
  }

  function ctxToggleLock() {
    if (!ctxMenu?.nodeId) return
    const nodeId = ctxMenu.nodeId
    store.toggleNodeLock(nodeId)
    // Also update local flow node style immediately
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n
      const nowLocked = !n.data?.locked
      const color: string = n.data?.baseColor ?? '#94a3b8'
      return {
        ...n,
        data: { ...n.data, locked: nowLocked },
        style: {
          ...n.style,
          background: nowLocked ? '#fffbeb' : color + '18',
          border: nowLocked ? `2px dashed #f59e0b` : `1.5px solid ${color}`,
          fontWeight: nowLocked ? 600 : 400,
          boxShadow: nowLocked ? `0 2px 10px #f59e0b44` : `0 2px 8px ${color}22`,
        },
      }
    }))
    setCtxMenu(null)
  }

  function ctxEditNode() {
    if (!ctxMenu?.nodeId) return
    const node = nodes.find(n => n.id === ctxMenu.nodeId)
    if (!node) return
    setInlineEdit({
      type: 'node', id: node.id, value: (node.data?.label as string) ?? '',
      x: ctxMenu.x, y: ctxMenu.y, w: 160,
    })
    setCtxMenu(null)
    setTimeout(() => inlineRef.current?.select(), 30)
  }

  function ctxDeleteEdge() {
    if (!ctxMenu) return
    if (ctxMenu.edgeIndex !== undefined) {
      store.deleteMindEdge(ctxMenu.edgeIndex)
    } else if (ctxMenu.edgeId) {
      setEdges(prev => prev.filter(e => e.id !== ctxMenu.edgeId))
    }
    setCtxMenu(null)
  }

  function ctxEditEdgeLabel() {
    if (!ctxMenu?.edgeId) return
    const edge = edges.find(e => e.id === ctxMenu.edgeId)
    if (!edge) return
    setInlineEdit({
      type: 'edge', id: edge.id, value: (edge.data?.label as string) ?? '',
      x: ctxMenu.x, y: ctxMenu.y, w: 140,
    })
    setCtxMenu(null)
    setTimeout(() => inlineRef.current?.select(), 30)
  }

  // ── Add node (from context menu pane) ────────────────────────────────────
  function ctxAddNode() {
    if (!ctxMenu || ctxMenu.worldX === undefined) return
    const id = uuidv4()
    const label = '新节点'
    const color = '#94a3b8'
    const { w, h } = nodeSize(label, 13)
    store.addMindNode({ id, label, group: undefined, keywords: [] })
    setNodes(prev => [...prev, {
      id,
      position: { x: ctxMenu.worldX! - w / 2, y: ctxMenu.worldY! - h / 2 },
      data: { label, color, baseColor: color },
      style: {
        width: w, height: h,
        background: color + '18', color: '#1e2140',
        border: `1.5px solid ${color}`, borderRadius: 9,
        fontSize: 13, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '0 8px', textAlign: 'center',
      },
    }])
    const panelX = ctxMenu.x
    const panelY = ctxMenu.y
    setCtxMenu(null)
    // First open inline edit for label, then open connect panel after confirm
    setInlineEdit({ type: 'node', id, value: label, x: panelX, y: panelY, w: 160 })
    setTimeout(() => inlineRef.current?.select(), 30)
    // Store pending new node id so after label commit we open connect panel
    pendingConnectNodeRef.current = { id, x: panelX, y: panelY }
  }

  // After committing label of a brand-new node, open connection panel
  const pendingConnectNodeRef = useRef<{ id: string; x: number; y: number } | null>(null)

  function commitEditAndMaybeConnect() {
    if (!inlineEdit) return
    const val = inlineRef.current?.value?.trim() || inlineEdit.value.trim()
    if (!val) { setInlineEdit(null); pendingConnectNodeRef.current = null; return }

    if (inlineEdit.type === 'node') {
      store.updateMindNode(inlineEdit.id, { label: val })
      setNodes(prev => prev.map(n => {
        if (n.id !== inlineEdit.id) return n
        const { w, h } = nodeSize(val, 13)
        return { ...n, data: { ...n.data, label: val }, style: { ...n.style, width: w, height: h } }
      }))
      // Open connect panel if this was a new node
      const pending = pendingConnectNodeRef.current
      if (pending && pending.id === inlineEdit.id) {
        pendingConnectNodeRef.current = null
        setConnectSearch('')
        setConnectPanel({ newNodeId: inlineEdit.id, x: pending.x, y: pending.y })
      }
    } else {
      const edgeIdx = inlineEdit.id.startsWith('ue-') ? parseInt(inlineEdit.id.slice(3), 10) : -1
      if (edgeIdx >= 0) {
        store.updateMindEdge(edgeIdx, { label: val })
        setEdges(prev => prev.map(e =>
          e.id === inlineEdit.id ? { ...e, data: { ...e.data, label: val } } : e
        ))
      }
    }
    setInlineEdit(null)
  }

  // Pending direction sub-panel: user clicked a node and now picks direction + label
  const [dirPicker, setDirPicker] = useState<{
    targetId: string
    targetLabel: string
    targetColor: string
    dir: 'out' | 'in'   // 'out' = newNode→target, 'in' = target→newNode
    label: string
  } | null>(null)

  // ── Click a node in the list ──────────────────────────────────────────────
  function handleNodeClick(targetId: string, targetLabel: string, targetColor: string) {
    if (!connectPanel) return
    const { newNodeId } = connectPanel

    // If already connected → remove it
    const existingEdge = edges.find(e =>
      !e.data?.structural &&
      ((e.source === newNodeId && e.target === targetId) ||
       (e.source === targetId && e.target === newNodeId))
    )
    if (existingEdge) {
      setEdges(prev => prev.filter(e => e.id !== existingEdge.id))
      if (existingEdge.id.startsWith('ue-')) {
        const idx = parseInt(existingEdge.id.slice(3), 10)
        if (!isNaN(idx)) store.deleteMindEdge(idx)
      } else {
        store.updateCurrentSession(s => ({
          ...s,
          mindEdges: s.mindEdges.filter(e =>
            !((e.source === newNodeId && e.target === targetId) ||
              (e.source === targetId && e.target === newNodeId))
          ),
        }))
      }
      setDirPicker(null)
      return
    }

    // Not connected → open direction picker
    setDirPicker({ targetId, targetLabel, targetColor, dir: 'out', label: '' })
  }

  // ── Confirm connection with direction + label ─────────────────────────────
  function confirmConnection() {
    if (!connectPanel || !dirPicker) return
    const { newNodeId } = connectPanel
    const { targetId, dir, label } = dirPicker
    const src = dir === 'out' ? newNodeId : targetId
    const tgt = dir === 'out' ? targetId : newNodeId
    const ci = edges.filter(e => !e.data?.structural).length
    const c = EDGE_COLORS[ci % EDGE_COLORS.length]
    store.addMindEdge({ source: src, target: tgt, label: label.trim() || undefined })
    setEdges(prev => [...prev, {
      id: `ue-${Date.now()}`,
      source: src, target: tgt, type: 'smart',
      data: { color: c, label: label.trim(), structural: false, active: false, dimmed: false },
      zIndex: 10,
    }])
    setDirPicker(null)
  }

  function closeConnectPanel() {
    setConnectPanel(null)
    setConnectSearch('')
    setDirPicker(null)
  }

  // Filtered nodes for connect panel (exclude topic + the new node itself)
  const connectableNodes = useMemo(() => {
    const q = connectSearch.toLowerCase()
    return nodes.filter(n =>
      n.id !== '__topic__' &&
      n.id !== connectPanel?.newNodeId &&
      (!q || (n.data?.label as string ?? '').toLowerCase().includes(q))
    )
  }, [nodes, connectPanel, connectSearch])

  // Already-connected node ids for the new node
  const alreadyConnected = useMemo(() => {
    if (!connectPanel) return new Set<string>()
    const s = new Set<string>()
    for (const e of edges) {
      if (e.source === connectPanel.newNodeId) s.add(e.target)
      if (e.target === connectPanel.newNodeId) s.add(e.source)
    }
    return s
  }, [edges, connectPanel])

  const onInit = useCallback((inst: ReactFlowInstance) => {
    rfInstanceRef.current = inst
    setTimeout(() => inst.fitView({ padding: 0.18 }), 80)
  }, [])

  if (mindNodes.length === 0) {
    return (
      <div className="mindmap-empty" id="mindmap-canvas">
        <div className="mindmap-placeholder">
          <div className="placeholder-topic">{topic}</div>
          {streaming
            ? <p className="mindmap-streaming-hint"><Loader2 size={16} className="spin" /> 正在生成思维导图…</p>
            : <p>添加关键词并点击「AI 分析关联」后，思维导图将在此展示</p>
          }
        </div>
      </div>
    )
  }

  return (
    <div className="mindmap-container" id="mindmap-canvas" ref={containerRef}>
      <ReactFlow
        nodes={nodes} edges={edges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        edgeTypes={edgeTypes}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onPaneClick={() => { setCtxMenu(null); setInlineEdit(null); closeConnectPanel() }}
        onInit={onInit}
        fitView fitViewOptions={{ padding: 0.18 }}
        nodesDraggable elementsSelectable
        minZoom={0.15} maxZoom={2.5}
      >
        <Background color="#d4d9f0" gap={24} />
        <Controls style={{ background: '#fff', border: '1px solid #d4d9f0' }} />
        {showMinimap && (
          <MiniMap style={{ background: '#f0f4ff', border: '1px solid #d4d9f0' }}
            nodeColor={n => (n.data?.baseColor as string) ?? '#94a3b8'} />
        )}
        <div className="minimap-toggle" onClick={() => setShowMinimap(v => !v)}
          title={showMinimap ? '关闭预览图' : '打开预览图'}>
          {showMinimap ? '⊟' : '⊞'}
        </div>
      </ReactFlow>

      {/* ── Inline Edit Overlay ─────────────────────────────────────── */}
      {inlineEdit && (
        <div className="mm-inline-edit" style={{ left: inlineEdit.x, top: inlineEdit.y }}>
          <input
            ref={inlineRef}
            className="mm-inline-input"
            defaultValue={inlineEdit.value}
            style={{ width: inlineEdit.w }}
            onKeyDown={e => {
              if (e.key === 'Enter') commitEditAndMaybeConnect()
              if (e.key === 'Escape') { setInlineEdit(null); pendingConnectNodeRef.current = null }
            }}
            autoFocus
          />
          <button className="mm-inline-btn confirm" onClick={commitEditAndMaybeConnect} title="确认"><Check size={12} /></button>
          <button className="mm-inline-btn cancel" onClick={() => { setInlineEdit(null); pendingConnectNodeRef.current = null }} title="取消"><X size={12} /></button>
        </div>
      )}

      {/* ── Context Menu ────────────────────────────────────────────── */}
      {ctxMenu && (
        <div className="mm-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={e => e.stopPropagation()}>
          {ctxMenu.type === 'node' && ctxMenu.nodeId !== '__topic__' && (() => {
            const isLocked = !!(nodes.find(n => n.id === ctxMenu.nodeId)?.data?.locked)
            return (
              <>
                <button onClick={ctxEditNode}>✏️ 编辑标签</button>
                <button onClick={() => {
                  if (!ctxMenu.nodeId) return
                  setConnectSearch('')
                  setConnectPanel({ newNodeId: ctxMenu.nodeId, x: ctxMenu.x, y: ctxMenu.y })
                  setCtxMenu(null)
                }}><Link2 size={13} /> 添加关联</button>
                <button onClick={ctxToggleLock} className={isLocked ? 'lock-active' : ''}>
                  {isLocked ? '🔓 解除锁定' : '🔒 锁定节点'}
                </button>
                <div className="mm-ctx-sep" />
                <button onClick={ctxDeleteNode} className="danger">🗑️ 删除节点</button>
              </>
            )
          })()}
          {ctxMenu.type === 'edge' && (
            <>
              {ctxMenu.edgeIndex !== undefined && (
                <button onClick={ctxEditEdgeLabel}>✏️ 编辑关联标签</button>
              )}
              <button onClick={ctxDeleteEdge} className="danger">🗑️ 删除连线</button>
            </>
          )}
          {ctxMenu.type === 'pane' && (
            <button onClick={ctxAddNode}><Plus size={13} /> 添加节点</button>
          )}
        </div>
      )}

      {/* ── Connect Panel ──────────────────────────────────────────── */}
      {connectPanel && (() => {
        // The label of the "source" node (the one we're connecting from)
        const srcLabel = nodes.find(n => n.id === connectPanel.newNodeId)?.data?.label as string ?? '此节点'
        return (
          <div className="mm-connect-panel"
            style={{ left: Math.min(connectPanel.x, (containerRef.current?.clientWidth ?? 600) - 248), top: connectPanel.y }}
            onClick={e => e.stopPropagation()}>

            <div className="mm-connect-header">
              <Link2 size={13} />
              <span>选择关联节点</span>
              <button className="mm-connect-close" onClick={closeConnectPanel}><X size={13} /></button>
            </div>

            {/* Direction + label picker — shown when a target is selected */}
            {dirPicker ? (
              <div className="mm-dir-picker">
                <div className="mm-dir-title">设置连接方式</div>

                {/* Direction toggle */}
                <div className="mm-dir-row">
                  <button
                    className={`mm-dir-btn${dirPicker.dir === 'out' ? ' active' : ''}`}
                    onClick={() => setDirPicker(d => d ? { ...d, dir: 'out' } : d)}
                  >
                    <span className="mm-dir-node src">{srcLabel}</span>
                    <span className="mm-dir-arrow">→</span>
                    <span className="mm-dir-node tgt" style={{ borderColor: dirPicker.targetColor }}>
                      {dirPicker.targetLabel}
                    </span>
                  </button>
                  <button
                    className={`mm-dir-btn${dirPicker.dir === 'in' ? ' active' : ''}`}
                    onClick={() => setDirPicker(d => d ? { ...d, dir: 'in' } : d)}
                  >
                    <span className="mm-dir-node tgt" style={{ borderColor: dirPicker.targetColor }}>
                      {dirPicker.targetLabel}
                    </span>
                    <span className="mm-dir-arrow">→</span>
                    <span className="mm-dir-node src">{srcLabel}</span>
                  </button>
                </div>

                {/* Label input */}
                <input
                  className="mm-dir-label-input"
                  placeholder="连线标签（可选）"
                  value={dirPicker.label}
                  onChange={e => setDirPicker(d => d ? { ...d, label: e.target.value } : d)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmConnection() }}
                  autoFocus
                />

                <div className="mm-dir-actions">
                  <button className="mm-dir-confirm" onClick={confirmConnection}>
                    <Check size={12} /> 确认添加
                  </button>
                  <button className="mm-dir-cancel" onClick={() => setDirPicker(null)}>
                    返回
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  className="mm-connect-search"
                  placeholder="搜索节点..."
                  value={connectSearch}
                  onChange={e => setConnectSearch(e.target.value)}
                  autoFocus
                />

                <div className="mm-connect-list">
                  {/* Topic node */}
                  {(() => {
                    const isConn = alreadyConnected.has('__topic__')
                    return (
                      <button
                        className={`mm-connect-item${isConn ? ' connected' : ''}`}
                        onClick={() => handleNodeClick('__topic__', topic, '#5b5ef7')}
                        title={isConn ? '点击取消关联' : '选择方向后连接'}
                      >
                        <span className="mm-connect-dot" style={{ background: '#5b5ef7' }} />
                        <span className="mm-connect-name">{topic}</span>
                        <span className="mm-connect-toggle-icon">
                          {isConn ? <X size={11} /> : <Plus size={11} />}
                        </span>
                      </button>
                    )
                  })()}
                  {connectableNodes.map(n => {
                    const color: string = n.data?.baseColor ?? '#94a3b8'
                    const isConn = alreadyConnected.has(n.id)
                    return (
                      <button key={n.id}
                        className={`mm-connect-item${isConn ? ' connected' : ''}`}
                        onClick={() => handleNodeClick(n.id, n.data?.label as string, color)}
                        title={isConn ? '点击取消关联' : '选择方向后连接'}>
                        <span className="mm-connect-dot" style={{ background: color }} />
                        <span className="mm-connect-name">{n.data?.label as string}</span>
                        <span className="mm-connect-toggle-icon">
                          {isConn ? <X size={11} /> : <Plus size={11} />}
                        </span>
                      </button>
                    )
                  })}
                  {connectableNodes.length === 0 && !connectSearch && (
                    <p className="mm-connect-empty">暂无其他节点</p>
                  )}
                  {connectableNodes.length === 0 && connectSearch && (
                    <p className="mm-connect-empty">没有匹配的节点</p>
                  )}
                </div>

                <button className="mm-connect-done" onClick={closeConnectPanel}>
                  <Check size={13} /> 完成
                </button>
              </>
            )}
          </div>
        )
      })()}
    </div>
  )
}

export function MindMapView(props: Props) {
  return (
    <ReactFlowProvider>
      <MindMapInner {...props} />
    </ReactFlowProvider>
  )
}
