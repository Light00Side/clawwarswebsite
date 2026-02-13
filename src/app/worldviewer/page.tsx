'use client';

const medievalStyles = `
  @import url('https://fonts.googleapis.com/css2?family=MedievalSharp&display=swap');
  
  .medieval-ui {
    font-family: 'MedievalSharp', cursive;
  }
  
  /* Medieval themed scrollbars */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  ::-webkit-scrollbar-track {
    background: #1a1410;
    border-radius: 4px;
  }
  ::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #5a4632 0%, #3d2f1f 100%);
    border-radius: 4px;
    border: 1px solid #2a1f15;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #7a5a42 0%, #4d3f2f 100%);
  }
  ::-webkit-scrollbar-corner {
    background: #1a1410;
  }
  * {
    scrollbar-width: thin;
    scrollbar-color: #5a4632 #1a1410;
  }
  
  .scroll-panel {
    background: linear-gradient(180deg, #1a1410 0%, #0d0a08 100%);
    border: 2px solid #3d2f1f;
    box-shadow: inset 0 0 20px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5), inset 0 0 0 1px #5a4632;
  }
  
  .parchment-text {
    color: #c4a574;
    text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
  }
  
  .gold-text {
    color: #d4a855;
    text-shadow: 0 0 4px rgba(212, 168, 85, 0.3);
  }
  
  .copper-accent {
    border-color: #8b5a2b !important;
  }
  
  .stone-bg {
    background: radial-gradient(ellipse at center, #1a1614 0%, #0a0806 100%);
  }
`;


import { useEffect, useRef, useState } from 'react';
import pako from 'pako';

const WORLD_URL = 'https://server.ClawWars.xyz/world';
const WORLD_WS = 'wss://server.ClawWars.xyz/ws/world';
// Note: server.ClawWars.xyz is now fronted by Cloudflare Worker/DO
const CDN = 'https://cdn.clawwars.xyz/skins/';

type WorldSnapshot = {
  worldWidth: number;
  worldHeight: number;
  worldSize?: number;
  tiles: number[] | number[][];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  players: Array<{ id: string; name: string; x: number; y: number; skin?: string; look?: number }>;
  npcs: Array<{ id: string; name: string; x: number; y: number; skin?: string; stats?: { blocksMined?: number; itemsCrafted?: number; playtimeMs?: number } }>;
  animals: Array<{ id: string; type: string; x: number; y: number }>;
  chat?: Array<{ ts: number; message: string }>;
  worldSeed?: string;
  worldSeedInt?: number;
};

const SKY_TILE = 6;

const TILE_COLORS: Record<number, string> = {
  0: '#0a0a0a',    // void/cave
  1: '#6B4423',    // dirt - rich brown
  2: '#5a5a6a',    // stone - blue-gray
  3: '#8a8a9a',    // light stone
  4: '#2d5a1e',    // grass block
  5: '#3cb043',    // leaves
  6: '#87CEEB',    // sky
};

// Seeded random for consistent variation
const seededRand = (x: number, y: number) => {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

// Darken/lighten color
const adjustColor = (hex: string, amt: number): string => {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amt));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
};

const base64ToBytes = (b64: string) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

export default function WorldPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const lastMiniRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const mouseClientRef = useRef<{ x: number; y: number } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const samePan = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) =>
    !!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

  const clampPan = (p: { x: number; y: number }, tileSize: number) => {
    const wsW = snapshot?.worldWidth || snapshot?.worldSize || 256;
    const wsH = snapshot?.worldHeight || snapshot?.worldSize || 256;
    const viewW = Math.max(1, Math.min(wsW, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(wsH, Math.ceil(viewport.h / tileSize)));
    return {
      x: Math.max(0, Math.min(wsW - viewW, p.x)),
      y: Math.max(0, Math.min(wsH - viewH, p.y)),
    };
  };

  const [zoom, setZoom] = useState(1);
  const [zoomTarget, setZoomTarget] = useState(1);
  const [viewport, setViewport] = useState({ w: 1920, h: 1080 });
  const [showIntro, setShowIntro] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [chat, setChat] = useState<Array<{ ts: number; message: string }>>([]);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hovered, setHovered] = useState<any | null>(null);
  const playerImgRef = useRef<HTMLImageElement | null>(null);
  const npcImgRef = useRef<HTMLImageElement | null>(null);
  const swordImgRef = useRef<HTMLImageElement | null>(null);
  const pickImgRef = useRef<HTMLImageElement | null>(null);
  const boarImgRef = useRef<HTMLImageElement | null>(null);
  const formatUtc = () => new Date().toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true });
  const [timeUtc, setTimeUtc] = useState<string>("--:--");
  const [bubbles, setBubbles] = useState<Record<string, { message: string; expiresAt: number }>>({});
  const [effects, setEffects] = useState<Array<any>>([]);
  const [fxByActor, setFxByActor] = useState<Record<string, number>>({});
  const [miningByActor, setMiningByActor] = useState<Record<string, number>>({});
  const surfaceRef = useRef<number | null>(null);

  // Inject medieval styles
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = medievalStyles;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);


  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams(window.location.search);
    const followParam = params.get('follow');
    if (followParam) {
      setFollow(followParam);
      setShowIntro(false); // skip intro when auto-following
      const baseTile = 36;
      const minTiles = 30;
      const maxZoom = viewport.w / (minTiles * baseTile);
      setZoomTarget(maxZoom); // zoom all the way in
    }
    console.log('[world] connecting', WORLD_WS);
    const ws = new WebSocket(WORLD_WS);
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      console.log('[world] raw msg', evt.data);
      if (!mounted) return;
      try {
        let data: any = JSON.parse(evt.data);
        if (data?.compressed === 'deflate' && data?.data) {
          const bytes = base64ToBytes(data.data);
          const json = pako.inflateRaw(bytes, { to: 'string' });
          data = JSON.parse(json);
        }
        if (data?.ok) {
          setSnapshot(data);
          if (Array.isArray(data.chat)) setChat(data.chat);
        }
        if (data?.type === 'npcChat' && data.npcId) {
          const ttl = data.ttlMs || 6000;
          setBubbles((b) => ({
            ...b,
            [data.npcId]: { message: data.message, expiresAt: Date.now() + ttl },
          }));
        }
        if (data?.type === 'fx') {
          setEffects((fx) => [...fx, { ...data, expiresAt: Date.now() + 800 }]);
          if (data.actorId) setFxByActor((m) => ({ ...m, [data.actorId]: Date.now() + 400 }));
        }
        if (data?.type === 'mineState') {
          setMiningByActor((m) => ({ ...m, [data.actorId]: data.active ? Date.now() + 600 : 0 }));
        }
      } catch (e) {
        console.warn('[world] bad message', e);
      }
    };
    ws.onerror = (e) => {
      console.error('[world] ws error details', e);
      if (!mounted) return;
      console.error('[world] ws error', e);
      setError('Failed to connect to live world');
    };
    ws.onopen = () => {
      if (!mounted) return;
      console.log('[world] ws open');
      setError(null);
    };
    ws.onclose = (e) => {
      if (!mounted) return;
      console.warn('[world] ws close', e.code, e.reason);
    };
    // no REST fallback in push-only mode
    return () => {
      mounted = false;
      ws.close();
    };
  }, []);

  // viewport follows window size
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setViewport({ w, h });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowIntro(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // smooth zoom only (pan is direct)
  useEffect(() => {
    let raf: number;
    const tick = () => {
      setZoom((z) => {
        if (zoomTarget === null) return z;
        const nz = z + (zoomTarget - z) * 0.12;
        if (Math.abs(nz - zoomTarget) < 0.001) return zoomTarget;
        return nz;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [zoomTarget, pan]);

  useEffect(() => {
    const m = window.matchMedia('(pointer: coarse)');
    const check = () => setIsMobile(m.matches || window.innerWidth < 900);
    check();
    m.addEventListener('change', check);
    window.addEventListener('resize', check);
    return () => {
      m.removeEventListener('change', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  // pointer lock removed

  useEffect(() => {
    const p = new Image();
    p.src = "https://cdn.clawwars.xyz/sprites/molt.png";
    playerImgRef.current = p;
    const n = new Image();
    n.src = "https://cdn.clawwars.xyz/sprites/molt.png";
    npcImgRef.current = n;
    const sword = new Image();
    sword.src = 'https://cdn.clawwars.xyz/sprites/sword.png';
    swordImgRef.current = sword;
    const pick = new Image();
    pick.src = 'https://cdn.clawwars.xyz/sprites/pickaxe.png';
    pickImgRef.current = pick;
    const boar = new Image();
    boar.src = 'https://cdn.clawwars.xyz/sprites/boar.png';
    boarImgRef.current = boar;
  }, []);

  useEffect(() => {
    setTimeUtc(formatUtc());
    const t = setInterval(() => setTimeUtc(formatUtc()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat]);

  // init pan once snapshot is ready
  useEffect(() => {
    if (!snapshot || pan) return;
    const baseTile = showIntro ? 16 : 36;
    const worldSize = snapshot.worldWidth || snapshot.worldSize || 256;
    const worldHeight = snapshot.worldHeight || snapshot.worldSize || 256;
    const tileSize = Math.max(1, Math.round(baseTile * zoom));
    const viewW = Math.max(1, Math.min(worldSize, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(worldHeight, Math.ceil(viewport.h / tileSize)));
    const initial = { x: Math.floor(worldSize / 2 - viewW / 2), y: Math.floor(worldHeight * 0.22 - viewH / 2) };
    setPan(clampPan(initial, tileSize));
  }, [snapshot, zoom, viewport, showIntro]);

  // follow target
  useEffect(() => {
    if (!follow || !snapshot) return;
    const baseTile = showIntro ? 16 : 36;
    const tileSize = Math.max(1, Math.round(baseTile * zoom));
    const worldSize = snapshot.worldWidth || snapshot.worldSize || 256;
    const worldHeight = snapshot.worldHeight || snapshot.worldSize || 256;
    const viewW = Math.max(1, Math.min(worldSize, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(worldHeight, Math.ceil(viewport.h / tileSize)));
    const focus =
      snapshot.players?.find((p: any) => p.name.toLowerCase() === follow.toLowerCase()) ||
      snapshot.npcs?.find((p: any) => p.name.toLowerCase() === follow.toLowerCase()) ||
      snapshot.animals?.find((p: any) => p.name?.toLowerCase?.() === follow.toLowerCase());
    if (!focus) return;
    const target = { x: Math.floor(focus.x - viewW / 2), y: Math.floor(focus.y - viewH / 2) };
    const clamped = clampPan(target, tileSize);
    if (!samePan(pan, clamped)) setPan(clamped);
  }, [follow, snapshot, viewport, zoom, showIntro]);

  useEffect(() => {
    if (!follow || !snapshot) return;
    const p = snapshot.players?.find((pl: any) => pl.name.toLowerCase() === follow.toLowerCase());
    const n = snapshot.npcs?.find((pl: any) => pl.name.toLowerCase() === follow.toLowerCase());
    const a = snapshot.animals?.find((pl: any) => pl.name?.toLowerCase?.() === follow.toLowerCase());
    if (p) setHovered({ ...p });
    else if (n) setHovered({ ...n });
    else if (a) setHovered({ ...a });
  }, [follow, snapshot]);

  // Calculate surface once when world loads
  useEffect(() => {
    if (!snapshot) return;
    if (surfaceRef.current !== null) return; // already calculated
    const { worldWidth, worldHeight, tiles } = snapshot;
    const worldSize = worldWidth || snapshot.worldSize || 256;
    let sum = 0, count = 0;
    for (let x = 0; x < worldSize; x += 10) { // sample every 10th column
      for (let y = 0; y < (worldHeight || worldSize); y++) {
        const t = (tiles as number[])[y * worldSize + x];
        if (t !== SKY_TILE) { sum += y; count++; break; }
      }
    }
    surfaceRef.current = count ? Math.floor(sum / count) : Math.floor((worldHeight || worldSize) / 3);
  }, [snapshot?.worldSeed]);

  useEffect(() => {
    if (!snapshot || !canvasRef.current) return;
    const { worldWidth, worldHeight, tiles, players, npcs, animals } = snapshot;
    const worldSize = worldWidth || snapshot.worldSize || 256;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const baseTile = showIntro ? 16 : 36;
    const tileSize = Math.max(1, Math.round(baseTile * zoom));

    const viewW = Math.max(1, Math.min(worldSize, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(worldHeight || worldSize, Math.ceil(viewport.h / tileSize)));
    const viewWActual = viewW;
    const viewHActual = viewH;
    const is2d = Array.isArray(tiles) && Array.isArray(tiles[0]);

    // clamp handled at render time

    // use cached surfaceY (computed once on load)
    const surfaceY = surfaceRef.current ?? Math.floor((worldHeight || worldSize) / 3);

    const focus =
      (follow && players.find((p) => p.name.toLowerCase() === follow.toLowerCase())) ||
      players[0] ||
      npcs[0] ||
      animals[0] ||
      { x: worldSize / 2, y: surfaceY };

    let panBase = pan || { x: 0, y: 0 };

    const baseX = follow ? (panBase?.x ?? 0) : (snapshot.x ?? panBase?.x ?? 0);
    const baseY = follow ? (panBase?.y ?? 0) : (snapshot.y ?? panBase?.y ?? 0);
    const startX = Math.floor(Math.max(0, Math.min(worldSize - viewWActual, baseX)));
    const startY = Math.floor(Math.max(0, Math.min((worldHeight || worldSize) - viewHActual, baseY)));

    canvas.width = viewport.w;
    canvas.height = viewport.h;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < viewHActual; y++) {
      for (let x = 0; x < viewWActual; x++) {
        const worldX = startX + x;
        const worldY = startY + y;
        const tile = is2d
          ? (tiles as number[][])?.[y]?.[x]
          : (tiles as number[])[(worldY) * worldSize + (worldX)];
        const tileType = tile ?? 0;
        let baseColor = TILE_COLORS[tileType] || '#000';
        
        // Depth-based darkness (underground gets darker/bluer)
        const depthRatio = Math.max(0, (worldY - surfaceY) / ((worldHeight || worldSize) - surfaceY));
        const depthDarken = Math.floor(depthRatio * 40);
        
        // Void/cave underground
        if (tileType === 0 && worldY > surfaceY) {
          const caveDark = Math.floor(depthRatio * 20);
          baseColor = adjustColor('#0a0e14', -caveDark);
        }
        
        // Color variation based on position (seeded)
        const variation = Math.floor((seededRand(worldX, worldY) - 0.5) * 20);
        let color = adjustColor(baseColor, variation - depthDarken);
        
        // Draw base tile
        ctx.fillStyle = color;
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        
        // Tile outline (dark edge) for solid blocks
        if (tileType !== 0 && tileType !== 6 && tileSize >= 4) {
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x * tileSize + 0.5, y * tileSize + 0.5, tileSize - 1, tileSize - 1);
        }
        
        // Grass tufts on surface dirt/grass
        if ((tileType === 1 || tileType === 4) && tileSize >= 6) {
          const aboveTile = is2d 
            ? (tiles as number[][])?.[y-1]?.[x]
            : (tiles as number[])[(worldY - 1) * worldSize + worldX];
          if (aboveTile === 6 || aboveTile === 0 || worldY <= surfaceY) {
            ctx.fillStyle = '#3cb043';
            const tx = x * tileSize;
            const ty = y * tileSize;
            // Draw grass blades - lush and varied
            const bladeCount = Math.max(5, Math.floor(tileSize / 4));
            for (let g = 0; g < bladeCount; g++) {
              const seed1 = seededRand(worldX * 7 + g, worldY * 13);
              const seed2 = seededRand(worldX * 11 + g, worldY * 3);
              const gx = tx + (g / bladeCount) * tileSize + seed1 * (tileSize / bladeCount);
              const gh = tileSize * 0.3 + seed2 * tileSize * 0.5;
              const gw = Math.max(1, tileSize / 10);
              // Vary the green
              const greenShade = Math.floor(seed1 * 40);
              ctx.fillStyle = `rgb(${50 + greenShade}, ${160 + Math.floor(seed2 * 40)}, ${50 + greenShade})`;
              // Draw tapered blade (triangle)
              ctx.beginPath();
              ctx.moveTo(gx, ty);
              ctx.lineTo(gx + gw / 2, ty - gh);
              ctx.lineTo(gx + gw, ty);
              ctx.closePath();
              ctx.fill();
            }
          }
        }
        
        // Ore sparkle on stone
        if ((tileType === 2 || tileType === 3) && tileSize >= 6) {
          if (seededRand(worldX * 3, worldY * 7) > 0.85) {
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            const sx = x * tileSize + seededRand(worldX, worldY * 2) * (tileSize - 4) + 2;
            const sy = y * tileSize + seededRand(worldX * 2, worldY) * (tileSize - 4) + 2;
            ctx.fillRect(sx, sy, 2, 2);
          }
        }
      }
    }

    const toScreen = (x: number, y: number) => {
      return {
        sx: Math.floor((x - startX) * tileSize),
        sy: Math.floor((y - startY) * tileSize),
      };
    };

    const drawEntity = (x: number, y: number, color: string, look: number = 1) => {
      const { sx, sy } = toScreen(x, y);
      if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) return;
      ctx.fillStyle = color;
      ctx.fillRect(sx, sy, tileSize, tileSize);
      ctx.strokeStyle = '#ffffff66';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, tileSize - 1, tileSize - 1);
    };

    animals.forEach((a: any) => {
      const { sx, sy } = toScreen(a.x, a.y);
      const boarImg = boarImgRef.current;
      if (boarImg && boarImg.complete && boarImg.naturalWidth > 0) {
        const dir = (a.vx || 0) < 0 ? -1 : 1;
        ctx.save();
        ctx.translate(sx + (dir === -1 ? tileSize*3 : 0), sy);
        ctx.scale(dir, 1);
        ctx.drawImage(boarImg, 0, 0, tileSize*3, tileSize*3);
        ctx.restore();
      } else {
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(sx, sy, tileSize, tileSize);
        ctx.strokeStyle = '#ffffff66';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx + 0.5, sy + 0.5, tileSize - 1, tileSize - 1);
      }
    });
    npcs.forEach((n: any) => {
      const now = Date.now();
      const isDamaged = n.damagedUntil && now < n.damagedUntil;
      const isFighting = n.fightingUntil && now < n.fightingUntil;
      const isMining = (n.miningUntil && Date.now() < n.miningUntil) || (miningByActor[n.id] || 0) > Date.now();
      const shake = (isDamaged || fxByActor[n.id]) ? (Math.random() * 2 - 1) * 3 : 0;
      const { sx, sy } = toScreen(n.x, n.y);
      
      const npcImg = npcImgRef.current;
      if (npcImg && npcImg.complete && npcImg.naturalWidth > 0) {
        const dir = (Number((n as any).look ?? 1) === 0) ? -1 : 1;
        ctx.save();
        ctx.translate(sx + (dir === -1 ? tileSize : 0) + shake, sy + shake);
        ctx.scale(dir, 1);
        
        // Red tint when damaged
        if (isDamaged) {
          ctx.filter = 'sepia(1) saturate(5) hue-rotate(-50deg) brightness(1.2)';
        }
        
        ctx.drawImage(npcImg, 0, 0, tileSize, tileSize);
        ctx.filter = 'none';
        ctx.restore();
        
        // Draw tool (pickaxe when mining, sword otherwise) - outside NPC transform
        const tool = (n.activeTool === 'pick' || isMining) ? pickImgRef.current : swordImgRef.current;
        if (tool?.complete && tool.naturalWidth > 0) {
          ctx.save();
          const swingAngle = isFighting ? Math.sin(Date.now() / 30) * 1.2 : Math.sin(Date.now() / 100) * 0.4; // always swinging
          const toolScreenX = sx + (dir === 1 ? tileSize * 0.35 : tileSize * 0.65);
          ctx.translate(toolScreenX + shake, sy + tileSize * 0.5 + shake);
          ctx.scale(dir, 1); // flip tool when facing left
          ctx.rotate(-0.5 + swingAngle); // wider base angle for bigger swing arc
          ctx.drawImage(tool, -tileSize * 0.2, -tileSize * 0.2, tileSize * 0.4, tileSize * 0.4);
          ctx.restore();
        }
      } else {
        const color = isDamaged ? '#ff4444' : '#22D3EE';
        drawEntity(Math.floor(n.x), Math.floor(n.y), color);
      }
      
      // Health bar if damaged
      if (n.hp < (n.maxHp || 100)) {
        const hpRatio = n.hp / (n.maxHp || 100);
        ctx.fillStyle = '#333';
        ctx.fillRect(sx, sy - 4, tileSize, 3);
        ctx.fillStyle = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#facc15' : '#ef4444';
        ctx.fillRect(sx, sy - 4, tileSize * hpRatio, 3);
      }
    });
    players.forEach((p: any) => {
      const now = Date.now();
      const isDamaged = p.damagedUntil && now < p.damagedUntil;
      const isFighting = p.fightingUntil && now < p.fightingUntil;
      const isMining = (p.miningUntil && Date.now() < p.miningUntil) || (miningByActor[p.id] || 0) > Date.now();
      const { sx, sy } = toScreen(p.x, p.y);
      const dir = (Number(p.look ?? 1) === 0) ? -1 : 1;
      if (playerImgRef.current?.complete) {
        ctx.save();
        ctx.translate(sx + (dir === -1 ? tileSize*3 : 0), sy);
        ctx.scale(dir, 1);
        if (isDamaged) {
          ctx.filter = 'sepia(1) saturate(5) hue-rotate(-50deg) brightness(1.2)';
        }
        ctx.drawImage(playerImgRef.current, 0, 0, tileSize, tileSize);
        ctx.filter = 'none';
        ctx.restore();
      } else {
        const color = isDamaged ? '#ff4444' : '#F472B6';
        drawEntity(Math.floor(p.x), Math.floor(p.y), color, p.look ?? 1);
      }
            // held tool (pickaxe when mining, sword otherwise)
      const tool = isMining ? pickImgRef.current : swordImgRef.current;
      if (tool?.complete) {
        ctx.save();
        const swingAngle = isFighting ? Math.sin(Date.now() / 30) * 1.2 : Math.sin(Date.now() / 100) * 0.4;
        const toolX = sx + (dir === 1 ? tileSize * 0.35 : tileSize * 0.65);
        ctx.translate(toolX, sy + tileSize * 0.5);
        ctx.scale(dir, 1);
        ctx.rotate(-0.5 + swingAngle);
        ctx.drawImage(tool, -tileSize * 0.2, -tileSize * 0.2, tileSize * 0.4, tileSize * 0.4);
        ctx.restore();
      }
      // health bar
      if (p.hp < (p.maxHp || 100)) {
        const hpRatio = p.hp / (p.maxHp || 100);
        ctx.fillStyle = '#333';
        ctx.fillRect(sx, sy - 4, tileSize, 3);
        ctx.fillStyle = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#facc15' : '#ef4444';
        ctx.fillRect(sx, sy - 4, tileSize * hpRatio, 3);
      }
    });


    // draw effects
    const nowFx = Date.now();
    const activeFx = effects.filter((e) => e.expiresAt > nowFx);
    if (activeFx.length !== effects.length) setEffects(activeFx);
    const cleanedFx: Record<string, number> = {};
    for (const [k, v] of Object.entries(fxByActor)) {
      if (v > nowFx) cleanedFx[k] = v;
    }
    if (Object.keys(cleanedFx).length !== Object.keys(fxByActor).length) setFxByActor(cleanedFx);
    for (const e of activeFx) {
      if (e.kind === 'mine') {
        const { sx, sy } = toScreen(e.x, e.y);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 2, sy + 2, tileSize - 4, tileSize - 4);
      } else if (e.kind === 'build') {
        const { sx, sy } = toScreen(e.x, e.y);
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, tileSize - 2, tileSize - 2);
      } else if (e.kind === 'attack') {
        const a = toScreen(e.x1, e.y1);
        const b = toScreen(e.x2, e.y2);
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.sx + tileSize/2, a.sy + tileSize/2);
        ctx.lineTo(b.sx + tileSize/2, b.sy + tileSize/2);
        ctx.stroke();
      } else if (e.kind === 'explode') {
        const { sx, sy } = toScreen(e.x, e.y);
        const cx = sx + tileSize/2;
        const cy = sy + tileSize/2;
        // big fireball
        ctx.fillStyle = 'rgba(255,90,0,0.8)';
        ctx.beginPath();
        ctx.arc(cx, cy, tileSize*1.6, 0, Math.PI*2);
        ctx.fill();
        // inner core
        ctx.fillStyle = 'rgba(255,220,120,0.9)';
        ctx.beginPath();
        ctx.arc(cx, cy, tileSize*0.8, 0, Math.PI*2);
        ctx.fill();
        // shockwave ring
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, tileSize*2.2, 0, Math.PI*2);
        ctx.stroke();
        // debris sparks
        ctx.strokeStyle = 'rgba(255,200,0,0.9)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 8; i++) {
          const ang = (Math.PI * 2 * i) / 8;
          const r1 = tileSize*0.5;
          const r2 = tileSize*2.6;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang)*r1, cy + Math.sin(ang)*r1);
          ctx.lineTo(cx + Math.cos(ang)*r2, cy + Math.sin(ang)*r2);
          ctx.stroke();
        }
      } else if (e.kind === 'eat') {
        const { sx, sy } = toScreen(e.x, e.y);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx + tileSize/2, sy + tileSize/2, tileSize/2, 0, Math.PI*2);
        ctx.stroke();
      }
    }

    // draw minimap
    const mini = minimapRef.current;
    if (mini && Date.now() - lastMiniRef.current >= 2000) {
      lastMiniRef.current = Date.now();
      const maxW = 900;
      const maxH = 600;
      const scale = Math.min(maxW / worldSize, maxH / (worldHeight || worldSize)) * 0.5;
      const step = 60;
      mini.width = Math.floor(worldSize * scale);
      mini.height = Math.floor((worldHeight || worldSize) * scale);
      const mctx = mini.getContext('2d');
      if (mctx) {
        mctx.imageSmoothingEnabled = false;
        mctx.clearRect(0, 0, mini.width, mini.height);
        for (let y = 0; y < (worldHeight || worldSize); y++) {
          for (let x = 0; x < worldSize; x++) {
            const t = is2d ? (tiles as number[][])?.[y]?.[x] : (tiles as number[])[y * worldSize + x];
            let c = TILE_COLORS[t ?? 0] || '#000';
            if ((t ?? 0) === 0 && y > surfaceY) c = '#0b0f14';
            mctx.fillStyle = c;
            mctx.fillRect(x * scale, y * scale, Math.ceil(scale), Math.ceil(scale));
          }
        }
        const vx = startX * scale;
        const vy = startY * scale;
        const vw = viewWActual * scale;
        const vh = viewHActual * scale;

        // darken outside viewport (strong)
        mctx.fillStyle = 'rgba(0,0,0,0.7)';
        mctx.fillRect(0, 0, mini.width, vy);
        mctx.fillRect(0, vy + vh, mini.width, mini.height - (vy + vh));
        mctx.fillRect(0, vy, vx, vh);
        mctx.fillRect(vx + vw, vy, mini.width - (vx + vw), vh);

        mctx.strokeStyle = 'rgba(255,255,255,0.9)';
        mctx.lineWidth = 1;
        mctx.strokeRect(vx, vy, vw, vh);
        mctx.fillStyle = '#f472b6';
        mctx.fillRect(focus.x * scale - 1, focus.y * scale - 1, 3, 3);
      }
    }
    // bubble cleanup
    const now = Date.now();
    const cleaned: Record<string, { message: string; expiresAt: number }> = {};
    for (const [id, b] of Object.entries(bubbles)) {
      if (b.expiresAt > now) cleaned[id] = b;
    }
    if (Object.keys(cleaned).length !== Object.keys(bubbles).length) setBubbles(cleaned);

    // npc speech bubbles
    for (const n of npcs) {
      const b = bubbles[n.id];
      if (!b) continue;
      const { sx, sy } = toScreen(n.x, n.y);
      if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) continue;
      ctx.font = '12px sans-serif';
      const text = b.message;
      const padding = 4;
      const w = Math.min(220, ctx.measureText(text).width + padding * 2);
      const h = 18;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(sx - w / 2, sy - h - 6, w, h);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, sx - w / 2 + padding, sy - 8);
    }

    // hover detection (players/npcs)
    if (mouseRef.current) {
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const wx = startX + Math.floor(mx / tileSize);
      const wy = startY + Math.floor(my / tileSize);
      const foundPlayer = players.find((p) => Math.floor(p.x) === wx && Math.floor(p.y) === wy);
      const foundNpc = npcs.find((n) => Math.floor(n.x) === wx && Math.floor(n.y) === wy);
      const nextHover = foundPlayer ? { ...foundPlayer } : foundNpc ? { ...foundNpc } : null;
      if (nextHover?.id !== hovered?.id) setHovered(nextHover);
      if (!nextHover && hovered) setHovered(null);
    }
  }, [snapshot, pan, zoom, viewport, bubbles]);

  useEffect(() => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    if (!pan || !snapshot) return;
    const baseTile = showIntro ? 16 : 36;
    const tileSize = Math.max(1, Math.round(baseTile * zoomTarget));
    const wsW = snapshot.worldWidth || snapshot.worldSize || 256;
    const wsH = snapshot.worldHeight || snapshot.worldSize || 256;
    const viewW = Math.max(1, Math.min(wsW, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(wsH, Math.ceil(viewport.h / tileSize)));
    const x = Math.max(0, Math.min(wsW - viewW, Math.floor(pan.x)));
    const y = Math.max(0, Math.min(wsH - viewH, Math.floor(pan.y)));
    wsRef.current.send(JSON.stringify({ type: 'view', x, y, w: viewW, h: viewH }));
  }, [pan, zoomTarget, viewport, snapshot, showIntro]);

  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? -0.06 : 0.06;
    const baseTile = showIntro ? 16 : 36;
    const wsW = snapshot?.worldWidth || snapshot?.worldSize || 256;
    const wsH = snapshot?.worldHeight || snapshot?.worldSize || 256;
    const minZoomW = viewport.w / (wsW * baseTile);
    const minZoomH = viewport.h / (wsH * baseTile);
    const minZoom = Math.max(0.1, minZoomW, minZoomH);
    const minTiles = follow ? 30 : 25;
    const maxZoom = viewport.w / (minTiles * baseTile); // keep at least minTiles visible
    const next = Math.min(maxZoom, Math.max(minZoom, zoomTarget + delta));
    // zoom towards cursor
    const mouse = mouseRef.current;
    if (mouse && pan) {
      const tileSize = baseTile * zoom;
      const worldX = pan.x + mouse.x / tileSize;
      const worldY = pan.y + mouse.y / tileSize;
      const newTileSize = baseTile * next;
      setPan(clampPan({ x: worldX - mouse.x / newTileSize, y: worldY - mouse.y / newTileSize }, newTileSize));
    }
    setZoomTarget(next);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (showIntro) return;
    setIsDragging(true);
    mouseClientRef.current = { x: e.clientX, y: e.clientY };
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan?.x || 0, panY: pan?.y || 0 };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    mouseClientRef.current = { x: e.clientX, y: e.clientY };
    if (showIntro || !dragRef.current) return;
    const baseTile = showIntro ? 16 : 36;
    const tileSize = baseTile * zoom;
    const dx = (e.clientX - dragRef.current.x) / tileSize;
    const dy = (e.clientY - dragRef.current.y) / tileSize;
    const next = { x: dragRef.current.panX - dx, y: dragRef.current.panY - dy };
    setPan(clampPan(next, tileSize));
  };

  const stopDrag = () => {
    // click-to-follow if minimal drag
    const drag = dragRef.current;
    if (drag && snapshot && mouseRef.current && mouseClientRef.current) {
      const dxPx = Math.abs(mouseClientRef.current.x - drag.x);
      const dyPx = Math.abs(mouseClientRef.current.y - drag.y);
      if (dxPx < 5 && dyPx < 5) {
        const baseTile = showIntro ? 16 : 36;
        const tileSize = baseTile * zoom;
        const wx = Math.floor((pan?.x || 0) + mouseRef.current.x / tileSize);
        const wy = Math.floor((pan?.y || 0) + mouseRef.current.y / tileSize);
        const all = [...(snapshot.players || []), ...(snapshot.npcs || [])];
        const found = all.find((p) => Math.floor(p.x) === wx && Math.floor(p.y) === wy);
        if (found) {
          setFollow(found.name);
        }
      }
    }
    setIsDragging(false);
    dragRef.current = null;
  };

  // no pointer lock

  return (
    <div className="min-h-screen stone-bg medieval-ui">
      {error && <div className="p-4 text-sm text-red-400">{error}</div>}
      {!snapshot && !error && <div className="p-4 text-sm text-zinc-400">Loading…</div>}
      <div className="h-screen w-screen overflow-hidden stone-bg relative">
        <div className="fixed top-4 left-1/2 -translate-x-1/2 scroll-panel rounded px-4 py-2 text-xs parchment-text z-20">{timeUtc} {typeof snapshot?.worldSeedInt === 'number' ? `· seed ${snapshot.worldSeedInt}` : snapshot?.worldSeed ? `· seed ${snapshot.worldSeed}` : ''}</div>
                <div
          ref={containerRef}
          className="stone-bg w-full h-full absolute inset-0"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
        >
          <canvas ref={canvasRef} className="block w-full h-full" />
        </div>
        {!showIntro && !isMobile && (
          <div className="fixed right-4 top-4 scroll-panel rounded p-2 z-20">
            <canvas ref={minimapRef} className="minimap-canvas block" />
          </div>
        )}

        {!showIntro && !isMobile && (
          <div className="fixed left-4 top-4 w-[220px] space-y-1 scroll-panel rounded p-3 text-xs parchment-text z-20">
            <div className="text-[10px] uppercase tracking-[0.2em] gold-text">Active Players</div>
            <div className="max-h-56 space-y-1 overflow-auto parchment-text">
              {[...(snapshot?.players || []).map(p => ({...p, kind:'player'})), ...(snapshot?.npcs || []).map(n => ({...n, kind:'npc'}))].map((p) => (
                <button
                  key={`${p.kind}-${p.id}`}
                  className={`block w-full truncate rounded px-2 py-1 text-left hover:bg-amber-900/30 ${follow === p.name ? 'bg-amber-900/40' : ''}`}
                  onClick={() => {
                    setFollow(p.name);
                    if (snapshot) {
                      const base = 36;
                      const wsW = snapshot.worldWidth || snapshot.worldSize || 256;
                      const wsH = snapshot.worldHeight || snapshot.worldSize || 256;
                      const maxZoom = viewport.w / (30 * base); // at least 30 tiles visible
                      const minZoomW = viewport.w / (wsW * base);
                      const minZoomH = viewport.h / (wsH * base);
                      const minZoom = Math.max(0.1, minZoomW, minZoomH);
                      const targetZoom = Math.min(maxZoom, Math.max(minZoom, maxZoom));
                      setZoomTarget(targetZoom);

                      const viewW = Math.max(1, Math.min(wsW, Math.ceil(viewport.w / (base * targetZoom))));
                      const viewH = Math.max(1, Math.min(wsH, Math.ceil(viewport.h / (base * targetZoom))));
                      const next = { x: Math.floor(p.x - viewW / 2), y: Math.floor(p.y - viewH / 2) };
                      setPan(next);
                    }
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {follow && (
              <button
                className="mt-2 w-full rounded border border-amber-800/50 px-2 py-1 text-xs uppercase tracking-wide parchment-text hover:border-amber-600/70 hover:bg-amber-900/20"
                onClick={() => setFollow(null)}
              >
                Stop follow
              </button>
            )}
          </div>
        )}

        {!showIntro && !isMobile && (() => {
          const target = hovered || (follow && [...(snapshot?.players || []), ...(snapshot?.npcs || [])].find(p => p.name.toLowerCase() === follow.toLowerCase()));
          if (!target) return null;
          return (
            <div className="fixed right-4 bottom-4 w-[240px] space-y-1 scroll-panel rounded p-3 text-xs parchment-text z-20">
              <div className="text-[10px] uppercase tracking-[0.2em] gold-text">{follow && target.name.toLowerCase() === follow.toLowerCase() ? 'Following' : 'Player'}</div>
              <div className="text-sm font-semibold gold-text">{target.name}</div>
              <div className="grid grid-cols-2 gap-2 text-[11px] parchment-text">
                <div>Kills: {target.stats?.kills ?? 0}</div>
                <div>Deaths: {target.stats?.deaths ?? 0}</div>
                <div>K/D: {((target.stats?.kills ?? 0) / Math.max(1, target.stats?.deaths ?? 0)).toFixed(2)}</div>
                <div>Mined: {target.stats?.blocksMined ?? 0}</div>
                <div>Crafted: {target.stats?.itemsCrafted ?? 0}</div>
                <div>Playtime: {Math.floor((target.stats?.playtimeMs ?? 0) / 60000)}m</div>
              </div>
            </div>
          );
        })()}

        {!showIntro && !isMobile && (
          <div className="fixed left-4 bottom-4 w-[420px] space-y-2 scroll-panel rounded p-4 text-sm parchment-text z-20">
            <div className="text-[11px] uppercase tracking-[0.2em] gold-text">World Chat</div>
            <div ref={chatRef} className="max-h-56 space-y-1 overflow-y-auto pr-1 parchment-text">
              {chat.slice(-12).map((c) => {
                const isSystem = c.message.startsWith('🟡 ') || c.message.startsWith('🟢 ');
                const msg = isSystem ? c.message.replace(/^[\u{1F7E1}\u{1F7E2}]\s*/u, '') : c.message;
                return (
                  <div key={c.ts + msg} className={isSystem ? 'truncate text-yellow-400' : 'truncate'}>{msg}</div>
                );
              })}
            </div>
          </div>
        )}

        {(showIntro || isMobile) && (
          <div className="absolute inset-0 flex items-center justify-center" style={{background: "radial-gradient(ellipse at center, rgba(20,15,10,0.9) 0%, rgba(5,3,2,0.95) 100%)"}}>
            <div className="max-w-md scroll-panel rounded p-6 text-sm parchment-text shadow-xl">
              <div className="text-lg font-semibold gold-text">Welcome to the ClawWars Worldviewer</div>
              <div className="mt-2 parchment-text">
                {isMobile
                  ? 'World viewer is PC-only.'
                  : 'Drag to pan. Scroll to zoom. '}
              </div>
                            <div className="mt-2 parchment-text">
                {isMobile
                  ? 'World viewer is PC-only.'
                  : 'Click on players in the active player list to follow them. '}
              </div>
              {!isMobile && (
                <button
                  className="mt-4 rounded border-2 border-amber-800/60 px-4 py-2 text-xs uppercase tracking-wide gold-text hover:border-amber-600 hover:bg-amber-900/30"
                  onClick={() => {
                    setShowIntro(false);
                    if (snapshot) {
                      const baseTile = 36;
                      const wsW = snapshot.worldWidth || snapshot.worldSize || 256;
                      const wsH = snapshot.worldHeight || snapshot.worldSize || 256;
                      const minZoomW = viewport.w / (wsW * baseTile);
                      const minZoomH = viewport.h / (wsH * baseTile);
                      const minZoom = Math.max(0.1, minZoomW, minZoomH);
                      const maxZoom = viewport.w / (200 * baseTile);
                      const targetZoom = Math.min(maxZoom, Math.max(minZoom, zoomTarget));
                      setZoomTarget(targetZoom);

                      const tileSize = baseTile * targetZoom;
                      const viewW = Math.max(1, Math.min(wsW, Math.ceil(viewport.w / tileSize)));
                      const viewH = Math.max(1, Math.min(wsH, Math.ceil(viewport.h / tileSize)));
                      const surfaceY = surfaceRef.current ?? Math.floor(wsH / 2);
                      const focusX = (snapshot.players?.[0]?.x ?? wsW / 2);
                      const next = { x: Math.floor(focusX - viewW / 2), y: Math.floor(surfaceY - viewH / 2) };
                      setPan(next);
                    } else if (pan) {
                                          }
                  }}
                >
                  Enter world
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
