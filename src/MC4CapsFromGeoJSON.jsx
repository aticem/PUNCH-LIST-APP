import React, { useEffect, useState, useRef, useMemo } from "react";
import { useMap, Pane, Polygon, FeatureGroup } from "react-leaflet";
import L from "leaflet";

const BODY_FILL = "#0f172a";
const BODY_STROKE = "#334155";
const CAP_ON = "#22c55e";
const CAP_OFF = "transparent";
const LS_KEY = "mc4-caps-state-v1";

// Hover görünümü (turuncu)
const HOVER_STROKE = "#f59e0b";   // amber-500
const HOVER_WEIGHT = 3;

// İmleç toleransı (ekran pikseli cinsinden)
const HOVER_TOL_PX = 16;

// ---- yardımcı (pixel uzayı) ----
function edgeLenPx(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.hypot(dx, dy); }
const add = (p, v) => L.point(p.x + v.x, p.y + v.y);
const sub = (a, b) => L.point(a.x - b.x, a.y - b.y);
const mul = (v, s) => L.point(v.x * s, v.y * s);
function norm(v){ const l=Math.hypot(v.x,v.y)||1; return L.point(v.x/l, v.y/l); }
const perp = (v) => L.point(-v.y, v.x);

// nokta → doğru parçası mesafesi (px)
function distPointToSeg(p, a, b) {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const ab2 = ab.x*ab.x + ab.y*ab.y || 1;
  const t = Math.max(0, Math.min(1, (ap.x*ab.x + ap.y*ab.y) / ab2));
  const proj = L.point(a.x + t*ab.x, a.y + t*ab.y);
  return edgeLenPx(p, proj);
}

// nokta poligon içinde mi? (ray casting) — px uzayı
function pointInPolygonPx(p, ringPx) {
  let inside = false;
  const n = ringPx.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ringPx[i].x, yi = ringPx[i].y;
    const xj = ringPx[j].x, yj = ringPx[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < (xj - xi) * (p.y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function getMainRing(feature) {
  const g = feature.geometry;
  if (g.type === "Polygon") return g.coordinates[0];
  if (g.type === "MultiPolygon") {
    let best = null;
    for (const poly of g.coordinates) if (!best || poly[0].length > best[0].length) best = poly;
    return best ? best[0] : null;
  }
  return null;
}
function ringLatLngToPx(ring, map) { return ring.map(([lng, lat]) => map.latLngToLayerPoint(L.latLng(lat, lng))); }
function centroidPx(points) {
  const s = points.reduce((acc,p)=>L.point(acc.x+p.x, acc.y+p.y), L.point(0,0));
  return L.point(s.x / points.length, s.y / points.length);
}
function findShortEdgesPx(pxRing) {
  const closed = pxRing[0].equals(pxRing[pxRing.length - 1]);
  const n = pxRing.length - (closed ? 1 : 0);
  const edges = [];
  for (let i = 0; i < n; i++) {
    const p0 = pxRing[i];
    const p1 = pxRing[(i + 1) % n];
    edges.push({ i, p0, p1, len: edgeLenPx(p0, p1) });
  }
  edges.sort((a,b) => a.len - b.len);
  return [edges[0], edges[1]]; // iki kısa kenar
}
function capPolygonPx(edge, centroidPxPoint, thicknessPx) {
  const mid = L.point((edge.p0.x + edge.p1.x)/2, (edge.p0.y + edge.p1.y)/2);
  const evec = norm(sub(edge.p1, edge.p0));
  let nvec = perp(evec);
  const toC = sub(centroidPxPoint, mid);
  if ((nvec.x * toC.x + nvec.y * toC.y) < 0) nvec = mul(nvec, -1);
  const inset = mul(nvec, thicknessPx);
  return [edge.p0, edge.p1, add(edge.p1, inset), add(edge.p0, inset)];
}
function pxPolyToLatLng(polyPx, map) { return polyPx.map(p => map.layerPointToLatLng(p)); }

export default function MC4CapsFromGeoJSON({
  src = "/panels.geojson",
  data = null,
  capPx = 12,
  onStats,
  resetToken = 0,
}) {
  const map = useMap();
  const [fc, setFc] = useState(null);
  const [state, setState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
  });
  const [tick, setTick] = useState(0); // zoom/pan tetiklemesi
  const [hoverId, setHoverId] = useState(null); // hover highlight için

  // Painting modu: 'none' | 'mark'(LEFT) | 'erase'(RIGHT)
  const paintingModeRef = useRef('none');

  // veri yükle
  useEffect(() => {
    if (data) { setFc(data); return; }
    fetch(src).then(r => r.json()).then(setFc).catch(console.error);
  }, [src, data]);

  // hareketleri izle
  useEffect(() => {
    const onMove = () => setTick(t => t + 1);
    map.on("zoomend", onMove);
    map.on("moveend", onMove);
    return () => { map.off("zoomend", onMove); map.off("moveend", onMove); };
  }, [map]);

  // persist
  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(state)); }, [state]);

  // reset
  useEffect(() => {
    setState({});
    try { localStorage.removeItem(LS_KEY); } catch {}
    setTick(t => t + 1);
    if (onStats) {
      const feats = fc?.type === "FeatureCollection" ? fc.features : (fc ? [fc] : []);
      const total = feats?.length || 0;
      onStats({ total, tablesDone: 0, capsOn: 0, unitsDone: 0, unitsTotal: total * 4 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  const features = fc?.type === "FeatureCollection" ? fc.features : (fc ? [fc] : []);
  const getId = (f, idx) => f.id ?? f.properties?.id ?? f.properties?.panel_id ?? `F-${idx}`;

  // Sayaç
  useEffect(() => {
    if (!onStats) return;
    const total = features.length;
    let capsOn = 0, tablesDone = 0;
    features.forEach((f, idx) => {
      const fid = getId(f, idx);
      const st = state[fid] || { start:false, end:false };
      if (st.start) capsOn += 1;
      if (st.end)   capsOn += 1;
      if (st.start && st.end) tablesDone += 1;
    });
    const unitsDone = capsOn * 2;
    const unitsTotal = total * 4;
    onStats({ total, tablesDone, capsOn, unitsDone, unitsTotal });
  }, [features, state, onStats]);

  // map container mouse butonları: LEFT=mark (işaretle), RIGHT=erase (sil)
  useEffect(() => {
    const c = map.getContainer();
    const onMouseDown = (e) => {
      if (e.button === 0) paintingModeRef.current = 'mark';
      else if (e.button === 2) paintingModeRef.current = 'erase';
      else paintingModeRef.current = 'none';
    };
    const onMouseUp = () => { paintingModeRef.current = 'none'; };
    const onContextMenu = (e) => e.preventDefault(); // sağ tık menüsü kapalı
    c.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    c.addEventListener("contextmenu", onContextMenu);
    return () => {
      c.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      c.removeEventListener("contextmenu", onContextMenu);
    };
  }, [map]);

  // Precompute: her feature için px ring (zoom/pan değişince güncelleriz)
  const pxCache = useMemo(() => {
    if (!features?.length) return [];
    return features.map((f) => {
      const ring = getMainRing(f);
      if (!ring) return null;
      const ringPx = ringLatLngToPx(ring, map);
      return { ring, ringPx };
    });
    // tick: her zoom/pan sonrası yeniden hesapla
  }, [features, map, tick]);

  // hover & toleransla en yakın paneli bul + brush uygula
  useEffect(() => {
    const c = map.getContainer();

    const onMouseMove = (e) => {
      const pt = L.point(e.clientX, e.clientY);

      let best = { fid: null, dist: Infinity, idx: -1 };
      pxCache.forEach((entry, idx) => {
        if (!entry) return;
        const ringPx = entry.ringPx;

        // Önce poligon içinde mi? İçindeyse mesafe 0
        let dMin = pointInPolygonPx(pt, ringPx) ? 0 : Infinity;

        // Değilse kenarlara en kısa mesafeyi hesapla (erken bırakmalı)
        if (dMin !== 0) {
          const n = ringPx.length - (ringPx[0].equals(ringPx[ringPx.length-1]) ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const a = ringPx[i], b = ringPx[(i+1) % n];
            const d = distPointToSeg(pt, a, b);
            if (d < dMin) dMin = d;
            if (dMin <= HOVER_TOL_PX) break; // yeterince yakınsa devam etmeye gerek yok
          }
        }

        if (dMin < best.dist) {
          best = { fid: getId(features[idx], idx), dist: dMin, idx };
        }
      });

      const within = best.dist <= HOVER_TOL_PX;
      setHoverId(within ? best.fid : null);

      // Brush: LEFT=mark, RIGHT=erase — toleransla
      if (within && paintingModeRef.current !== 'none') {
        const mode = paintingModeRef.current;
        if (mode === 'mark') {
          // ON
          setState(prev => {
            const cur = prev[best.fid] || { start:false, end:false };
            if (cur.start && cur.end) return prev;
            return { ...prev, [best.fid]: { start:true, end:true } };
          });
        } else if (mode === 'erase') {
          // OFF
          setState(prev => {
            const cur = prev[best.fid] || { start:false, end:false };
            if (!cur.start && !cur.end) return prev;
            return { ...prev, [best.fid]: { start:false, end:false } };
          });
        }
      }
    };

    c.addEventListener("mousemove", onMouseMove);
    return () => c.removeEventListener("mousemove", onMouseMove);
  }, [map, pxCache, features]);

  // yardımcılar
  const setBoth = (fid, value) => {
    setState(prev => {
      const cur = prev[fid] || { start:false, end:false };
      return { ...prev, [fid]: { start: value, end: value } };
    });
  };

  // Tek tık: LEFT=ON (işaretle), RIGHT=OFF (sil)
  const clickBody = (fid, e) => {
    const btn = e.originalEvent?.button;
    if (btn === 2) { setBoth(fid, false); return; } // sağ = OFF
    setBoth(fid, true);                              // sol = ON
  };
  const clickStart = (fid, e) => {
    const btn = e.originalEvent?.button;
    e.originalEvent?.stopPropagation?.();
    setState(prev => {
      const cur = prev[fid] || { start:false, end:false };
      return { ...prev, [fid]: { start: btn === 2 ? false : true, end: cur.end } };
    });
  };
  const clickEnd = (fid, e) => {
    const btn = e.originalEvent?.button;
    e.originalEvent?.stopPropagation?.();
    setState(prev => {
      const cur = prev[fid] || { start:false, end:false };
      return { ...prev, [fid]: { start: cur.start, end: btn === 2 ? false : true } };
    });
  };

  // Render
  return (
    <Pane name="mc4-caps" style={{ zIndex: 500 }}>
      <div style={{ display: "none" }}>{tick}</div>

      {features.map((f, idx) => {
        const ring = getMainRing(f);
        if (!ring) return null;

        const bodyLatLng = ring.map(([lng, lat]) => L.latLng(lat, lng));

        // cap'lar
        const ringPx = pxCache[idx]?.ringPx || ringLatLngToPx(ring, map);
        const centPx = centroidPx(ringPx);
        const [eStart, eEnd] = findShortEdgesPx(ringPx);
        const capStartLatLng = pxPolyToLatLng(capPolygonPx(eStart, centPx, capPx), map);
        const capEndLatLng   = pxPolyToLatLng(capPolygonPx(eEnd,   centPx, capPx), map);

        const fid = getId(f, idx);
        const st = state[fid] || { start:false, end:false };

        // Hover ise turuncu kontur + biraz kalın çizgi
        const hovered = hoverId === fid;
        const bodyStyle = hovered
          ? { color: HOVER_STROKE, weight: HOVER_WEIGHT, fillColor: BODY_FILL, fillOpacity: 1 }
          : { color: BODY_STROKE, weight: 1,            fillColor: BODY_FILL, fillOpacity: 1 };

        return (
          <FeatureGroup key={fid}>
            <Polygon
              positions={bodyLatLng}
              pathOptions={bodyStyle}
              eventHandlers={{
                click: (e) => clickBody(fid, e),  // LEFT ON / RIGHT OFF
                contextmenu: (e) => { e.originalEvent?.preventDefault?.(); setBoth(fid, false); },
              }}
            />
            <Polygon
              positions={capStartLatLng}
              pathOptions={{ color: "transparent", weight: 0, fillColor: st.start ? CAP_ON : CAP_OFF, fillOpacity: st.start ? 0.9 : 0 }}
              eventHandlers={{
                click: (e) => { e.originalEvent?.stopPropagation?.(); clickStart(fid, e); },
                contextmenu: (e) => { e.originalEvent?.preventDefault?.(); setState(prev => ({ ...prev, [fid]: { ...(prev[fid]||{end:false}), start: false } })); },
              }}
            />
            <Polygon
              positions={capEndLatLng}
              pathOptions={{ color: "transparent", weight: 0, fillColor: st.end ? CAP_ON : CAP_OFF, fillOpacity: st.end ? 0.9 : 0 }}
              eventHandlers={{
                click: (e) => { e.originalEvent?.stopPropagation?.(); clickEnd(fid, e); },
                contextmenu: (e) => { e.originalEvent?.preventDefault?.(); setState(prev => ({ ...prev, [fid]: { ...(prev[fid]||{start:false}), end: false } })); },
              }}
            />
          </FeatureGroup>
        );
      })}
    </Pane>
  );
}
