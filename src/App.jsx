// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/turf";

import tablesPolyUrl from "/tables_poly.geojson?url";
import tablesPointsUrl from "/tables_points.geojson?url";
import siteBoundaryUrl from "/site_boundary.geojson?url";

/* ================= helpers ================= */
function getTableId(props) {
  if (!props) return null;
  if (props.table_id) return props.table_id;
  if (props.tableId) return props.tableId;
  if (props.id !== undefined) return String(props.id);
  if (props.name) return props.name;
  if (props.masa_id) return props.masa_id;
  if (props.masa_kodu) return props.masa_kodu;
  if (props.kod) return props.kod;
  for (const k in props) {
    const v = props[k];
    if (typeof v === "string" && /^R\d{1,3}_T\d{1,3}$/i.test(v.trim())) return v.trim().toUpperCase();
  }
  for (const k in props) {
    const v = props[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
const getPunchCount = (punches, tableId) => (punches[tableId] || []).length;

function getSafeCenter(geojson) {
  try {
    const feats = geojson?.features || [];
    let sx = 0, sy = 0, n = 0;
    for (const f of feats) {
      if (f.geometry?.type === "Point") {
        const [lon, lat] = f.geometry.coordinates;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          sx += lon; sy += lat; n++;
        }
      }
    }
    return n ? [sy / n, sx / n] : [52.712, -1.706];
  } catch { return [52.712, -1.706]; }
}
function generatePointInsidePolygon(polygon, maxTries = 100) {
  const bbox = L.geoJSON(polygon).getBounds();
  const sw = bbox.getSouthWest(), ne = bbox.getNorthEast();
  for (let i = 0; i < maxTries; i++) {
    const lng = sw.lng + Math.random() * (ne.lng - sw.lng);
    const lat = sw.lat + Math.random() * (ne.lat - sw.lat);
    if (booleanPointInPolygon(point([lng, lat]), polygon)) return [lat, lng];
  }
  const coords = polygon.geometry.coordinates[0];
  const sumLat = coords.reduce((s, c) => s + c[1], 0);
  const sumLng = coords.reduce((s, c) => s + c[0], 0);
  return [sumLat / coords.length, sumLng / coords.length];
}
function isoClickToLatLng(polyFeature, isoX, isoY) {
  const bbox = L.geoJSON(polyFeature).getBounds();
  const sw = bbox.getSouthWest(), ne = bbox.getNorthEast();
  const lng = sw.lng + (isoX / 100) * (ne.lng - sw.lng);
  const lat = sw.lat + (1 - isoY / 100) * (ne.lat - sw.lat);
  if (booleanPointInPolygon(point([lng, lat]), polyFeature)) return [lat, lng];
  return generatePointInsidePolygon(polyFeature);
}

/* ================ overlay ================= */
function BoxSelectionOverlay({ startPoint, endPoint }) {
  if (!startPoint || !endPoint) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: Math.min(startPoint.x, endPoint.x),
        top: Math.min(startPoint.y, endPoint.y),
        width: Math.abs(startPoint.x - endPoint.x),
        height: Math.abs(startPoint.y - endPoint.y),
        border: "1.5px dashed #00d5ff",
        background: "rgba(0, 213, 255, 0.08)",
        borderRadius: 8,
        pointerEvents: "none",
        zIndex: 1400,
      }}
    />
  );
}

/* ============== right click unselect ============== */
function RightClickUnselect({ poly, punches, multiSelectedPunches, setMultiSelected, setSelected }) {
  useMapEvents({
    contextmenu: (e) => {
      L.DomEvent.preventDefault(e);
      const pt = point([e.latlng.lng, e.latlng.lat]);
      let tid = null;
      for (const f of poly.features) {
        const t = getTableId(f.properties);
        if (t && booleanPointInPolygon(pt, f)) { tid = t; break; }
      }
      if (tid) {
        const ids = (punches[tid] || []).filter(p => multiSelectedPunches.has(p.id)).map(p => p.id);
        if (ids.length) {
          setMultiSelected(prev => {
            const s = new Set(prev); ids.forEach(id => s.delete(id)); return s;
          });
        }
      } else setSelected(null);
    },
  });
  return null;
}

/* ============== punch layer ============== */
function PunchLayer({ punches, polyGeoJSON, setSelectedPunch, safeTableId, multiSelectedPunches, subcontractors, activeFilter }) {
  const map = useMap();
  const layerRef = useRef(null);
  const polyIndexRef = useRef({});
  const punchLocationsRef = useRef({});

  useEffect(() => {
    if (!polyGeoJSON) return;
    const index = {};
    polyGeoJSON.features.forEach(f => {
      const tid = getTableId(f.properties);
      if (tid) index[tid] = f;
    });
    polyIndexRef.current = index;
  }, [polyGeoJSON]);

  useEffect(() => {
    if (!layerRef.current) layerRef.current = L.layerGroup().addTo(map);
    return () => layerRef.current && layerRef.current.remove();
  }, [map]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const colorOf = (name) => subcontractors.find(s => s.name === name)?.color || "#f04";
    const interactive = !safeTableId;

    Object.keys(punches).forEach(tid => {
      (punches[tid] || []).filter(p => (activeFilter ? p.subcontractor === activeFilter : true)).forEach(p => {
        if (!p.latlng) {
          if (tid !== "__free__" && polyIndexRef.current[tid]) {
            if (!punchLocationsRef.current[p.id]) {
              punchLocationsRef.current[p.id] = generatePointInsidePolygon(polyIndexRef.current[tid]);
            }
            p.latlng = punchLocationsRef.current[p.id];
          } else return;
        }
        const isSel = multiSelectedPunches.has(p.id);
        const marker = L.circleMarker(p.latlng, {
          radius: isSel ? 9 : 6,
          color: isSel ? "#00FFFF" : "#fff",
          weight: isSel ? 2.5 : 1.5,
          fillColor: colorOf(p.subcontractor),
          fillOpacity: 1,
          className: tid === "__free__" ? "punch-marker free" : "punch-marker",
          pane: "markerPane",
          zIndexOffset: isSel ? 1500 : 1000,
        }).addTo(layer);

        if (tid === "__free__") {
          const html = `
            <div style="font-family:sans-serif;min-width:200px;">
              <b style="color:#ffb74d;">Serbest Punch</b>
              <div style="font-size:12px;margin:4px 0;opacity:.9">Taşeron: <b>${p.subcontractor || "-"}</b></div>
              ${p.photo ? `<img src="${p.photo}" style="width:100%;border-radius:8px;margin:8px 0;" />` : ""}
              <div style="font-size:13px;margin-top:6px;white-space:pre-wrap;">${p.note?.trim() || "<i style='opacity:.6'>(Not yok)</i>"}</div>
              <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
                <button onclick="window.editFreePunch(${p.id})" style="background:#ff9800;color:#111;border:none;padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-weight:800;">Düzenle</button>
                <button onclick="window.deleteFreePunch(${p.id})" style="background:#e53935;color:#fff;border:none;padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-weight:800;">Sil</button>
              </div>
            </div>`;
          marker.bindPopup(html, { maxWidth: 280, className: "custom-punch-popup" });
          L.circle(p.latlng, { radius: 25, fill: false, stroke: false, interactive: true })
            .addTo(layer)
            .on("click", (e) => { L.DomEvent.stopPropagation(e); marker.openPopup(); });
        } else if (interactive) {
          L.circle(p.latlng, { radius: 20, fill: false, stroke: false, interactive: true })
            .addTo(layer)
            .on("click", (e) => { L.DomEvent.stopPropagation(e); setSelectedPunch({ ...p, table_id: tid }); });
        }

        marker.on("mouseover", () => marker.setStyle({ radius: 10, zIndexOffset: 2000 }));
        marker.on("mouseout", () => marker.setStyle({ radius: isSel ? 9 : 6, zIndexOffset: isSel ? 1500 : 1000 }));
      });
    });
  }, [punches, safeTableId, multiSelectedPunches, subcontractors, activeFilter, map, setSelectedPunch]);

  return null;
}

/* ============== selection control ============== */
function SelectionControl({ poly, punches, multiSelected, setMultiSelected, setIsSelecting, isSelecting, setSelected, setSelectionBox, setJustDragged }) {
  const map = useMap();
  const isDragging = useRef(false);
  const startScreen = useRef(null);
  const startLatLng = useRef(null);

  useMapEvents({
    mousedown: (e) => {
      if (e.originalEvent.button !== 0) return;
      map.dragging.disable();
      isDragging.current = true;
      setIsSelecting(true);
      startScreen.current = { x: e.originalEvent.clientX, y: e.originalEvent.clientY };
      startLatLng.current = e.latlng;
      setSelectionBox({ start: startScreen.current, end: startScreen.current });
      if (!e.originalEvent.ctrlKey && !e.originalEvent.metaKey) setMultiSelected(new Set());
    },
    mousemove: (e) => {
      if (!isSelecting || !isDragging.current || !startScreen.current) return;
      setSelectionBox({ start: startScreen.current, end: { x: e.originalEvent.clientX, y: e.originalEvent.clientY } });

      const moved = Math.hypot(startScreen.current.x - e.originalEvent.clientX, startScreen.current.y - e.originalEvent.clientY) > 5;
      if (!moved) return;

      L.DomEvent.stopPropagation(e);

      const minLat = Math.min(startLatLng.current.lat, e.latlng.lat);
      const maxLat = Math.max(startLatLng.current.lat, e.latlng.lat);
      const minLng = Math.min(startLatLng.current.lng, e.latlng.lng);
      const maxLng = Math.max(startLatLng.current.lng, e.latlng.lng);

      const additive = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
      const base = additive ? multiSelected : new Set();
      const next = new Set(base);

      Object.values(punches).flat().forEach(p => {
        if (!p.latlng) return;
        const [lat, lng] = p.latlng;
        if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) next.add(p.id);
        else if (!additive && base.has(p.id)) next.delete(p.id);
      });

      setMultiSelected(next);
    },
    mouseup: (e) => {
      if (e.originalEvent.button !== 0) return;
      const moved = startScreen.current
        ? Math.hypot(startScreen.current.x - e.originalEvent.clientX, startScreen.current.y - e.originalEvent.clientY) > 8
        : false;
      setSelectionBox(null);
      isDragging.current = false;
      setIsSelecting(false);
      if (moved) {
        L.DomEvent.stopPropagation(e);
        setJustDragged(true);
        setTimeout(() => setJustDragged(false), 50);
        return;
      }
      // click to open table
      const pt = point([e.latlng.lng, e.latlng.lat]);
      let tid = null;
      poly.features.forEach((f) => {
        const t = getTableId(f.properties);
        if (t && booleanPointInPolygon(pt, f)) tid = t;
      });
      if (tid) { setSelected(tid); setMultiSelected(new Set()); }
      else { setSelected(null); setMultiSelected(new Set()); }
    },
  });
  return null;
}

/* ============== free punch click ============== */
function BoundaryFreePunchClick({ poly, boundary, isSelecting, setSelected, setSelectedPunch, setNewPunch, justDragged }) {
  useMapEvents({
    click: (e) => {
      if (isSelecting || justDragged) return;
      const pt = point([e.latlng.lng, e.latlng.lat]);
      let onTable = false;
      poly.features.forEach((f) => {
        const tid = getTableId(f.properties);
        if (tid && booleanPointInPolygon(pt, f)) onTable = true;
      });
      if (onTable) return;
      let inside = false;
      (boundary?.features || []).forEach((f) => { if (booleanPointInPolygon(pt, f)) inside = true; });
      if (!inside) return;
      setSelected(null); setSelectedPunch(null);
      setNewPunch({ table_id: "__free__", latlng: [e.latlng.lat, e.latlng.lng] });
    },
  });
  return null;
}

/* ============== globals for popup buttons ============== */
let currentPunches = {};
let currentSetPunches = null;
let currentStartEdit = null;
window.deleteFreePunch = (id) => {
  if (!currentSetPunches || !window.confirm("Bu punch silinsin mi?")) return;
  currentSetPunches(prev => ({ ...prev, __free__: (prev.__free__ || []).filter(p => p.id !== id) }));
};
window.editFreePunch = (id) => {
  const punch = (currentPunches.__free__ || []).find(p => p.id === id);
  if (punch && currentStartEdit) currentStartEdit({ ...punch, table_id: "__free__" });
};

/* ============== middle mouse drag (only) ============== */
function MiddleMouseDrag() {
  const map = useMap();
  const downRef = useRef(false);
  useEffect(() => {
    map.dragging.disable();
    map._container.style.cursor = "default";
    const onDown = (e) => {
      if (e.button === 1) {
        downRef.current = true;
        map.dragging.enable();
        map._container.style.cursor = "grabbing";
      }
    };
    const onUp = () => {
      if (downRef.current) {
        downRef.current = false;
        map.dragging.disable();
        map._container.style.cursor = "default";
      }
    };
    map._container.addEventListener("mousedown", onDown);
    map._container.addEventListener("mouseup", onUp);
    map._container.addEventListener("mouseleave", onUp);
    return () => {
      map._container.removeEventListener("mousedown", onDown);
      map._container.removeEventListener("mouseup", onUp);
      map._container.removeEventListener("mouseleave", onUp);
      map._container.style.cursor = "default";
    };
  }, [map]);
  return null;
}

/* ===================== App ===================== */
export default function App() {
  const [poly, setPoly] = useState(null);
  const [points, setPoints] = useState(null);
  const [boundary, setBoundary] = useState(null);

  const [punches, setPunches] = useState({});
  const [selected, setSelected] = useState(null);
  const [newPunch, setNewPunch] = useState(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);

  const [multiSelected, setMultiSelected] = useState(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState(null);
  const [justDragged, setJustDragged] = useState(false);

  const isoRef = useRef(null);
  const isoWrapRef = useRef(null);
  const [isoLoaded, setIsoLoaded] = useState(false);
  const [isoError, setIsoError] = useState(false);
  const [selectedPunch, setSelectedPunch] = useState(null);

  const [editingPunch, setEditingPunch] = useState(null);
  const [editNote, setEditNote] = useState("");
  const [editPhoto, setEditPhoto] = useState(null);

  const [subcontractors, setSubcontractors] = useState([]);
  const [newSub, setNewSub] = useState({ name: "", color: "#7c7cff" });
  const [showSettings, setShowSettings] = useState(false);
  const [activeSub, setActiveSub] = useState("");
  const [activeFilter, setActiveFilter] = useState("");

  // poly layer registry for group hover
  const tidLayersRef = useRef({}); // { tid: Set<layer> }

  useEffect(() => { currentPunches = punches; currentSetPunches = setPunches; }, [punches, setPunches]);
  const startEdit = (p) => { setEditingPunch(p); setEditNote(p.note || ""); setEditPhoto(p.photo || null); };
  useEffect(() => { currentStartEdit = startEdit; }, [startEdit]);

  // load data
  useEffect(() => {
    const loadSafe = async (url, name) => {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${name} not found`);
        const text = await r.text();
        if (!text.trim()) throw new Error("Empty file");
        return JSON.parse(text);
      } catch {
        return { type: "FeatureCollection", features: [] };
      }
    };
    (async () => {
      const [polyData, pointsData, boundaryData] = await Promise.all([
        loadSafe(tablesPolyUrl, "tables_poly.geojson"),
        loadSafe(tablesPointsUrl, "tables_points.geojson"),
        loadSafe(siteBoundaryUrl, "site_boundary.geojson"),
      ]);
      setPoly(polyData); setPoints(pointsData); setBoundary(boundaryData);
    })();
  }, []);
  useEffect(() => {
    const s = localStorage.getItem("punches"); if (s) setPunches(JSON.parse(s));
    const subs = localStorage.getItem("subcontractors");
    if (subs) { const p = JSON.parse(subs); setSubcontractors(p); setShowSettings(p.length === 0); }
    else setShowSettings(true);
  }, []);
  useEffect(() => { localStorage.setItem("punches", JSON.stringify(punches)); }, [punches]);
  useEffect(() => { localStorage.setItem("subcontractors", JSON.stringify(subcontractors)); }, [subcontractors]);

  const initialCenter = useMemo(() => getSafeCenter(points), [points]);
  const safeTableId = typeof selected === "string" ? selected : null;
  const totalSelectedPunch = multiSelected.size;

  const onIsoClick = (e) => {
    if (!isoRef.current || !isoLoaded || isoError || !safeTableId) return;
    if (selectedPunch) { setSelectedPunch(null); return; }
    const rect = isoRef.current.getBoundingClientRect();
    const isoX = ((e.clientX - rect.left) / rect.width) * 100;
    const isoY = ((e.clientY - rect.top) / rect.height) * 100;
    const polyFeature = poly?.features.find((f) => getTableId(f.properties) === safeTableId);
    if (!polyFeature) return;
    const latlng = isoClickToLatLng(polyFeature, isoX, isoY);
    setNewPunch({ table_id: safeTableId, isoX, isoY, latlng });
  };

  const onPhoto = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onloadend = () => setPhoto(r.result); r.readAsDataURL(f);
  };

  const addPunch = () => {
    if (!newPunch || !newPunch.latlng) return;
    if (!activeSub) { alert("Lütfen bir taşeron seçin."); return; }
    const key = newPunch.table_id || "__free__";
    const record = {
      id: Date.now(),
      table_id: key,
      isoX: newPunch.isoX ?? null,
      isoY: newPunch.isoY ?? null,
      note, photo,
      subcontractor: activeSub,
      latlng: Array.isArray(newPunch.latlng) ? newPunch.latlng : [newPunch.latlng.lat, newPunch.latlng.lng],
    };
    setPunches(prev => ({ ...prev, [key]: [...(prev[key] || []), record] }));
    setNewPunch(null); setNote(""); setPhoto(null);
  };

  const deleteAllPunches = () => {
    const id = typeof selected === "string" ? selected : null;
    if (!id) return;
    if (!window.confirm(`TÜM punch'lar silinsin mi?`)) return;
    setPunches(prev => { const u = { ...prev }; delete u[id]; return u; });
    setSelected(null);
  };
  const deleteSelectedPunches = () => {
    if (!totalSelectedPunch) return;
    if (!window.confirm(`Toplam ${totalSelectedPunch} punch silinecek. Emin misiniz?`)) return;
    setPunches(prev => {
      const n = { ...prev };
      Object.keys(n).forEach(k => {
        n[k] = (n[k] || []).filter(p => !multiSelected.has(p.id));
        if (n[k].length === 0) delete n[k];
      });
      return n;
    });
    setMultiSelected(new Set()); setSelected(null);
  };

  const saveEdit = () => {
    if (!editingPunch) return;
    setPunches(prev => {
      const key = editingPunch.table_id || "__free__";
      return { ...prev, [key]: (prev[key] || []).map(p => p.id === editingPunch.id ? { ...p, note: editNote, photo: editPhoto } : p) };
    });
    setEditingPunch(null); setEditNote(""); setEditPhoto(null);
  };

  /* ======= TopBar (all right aligned) ======= */
  const TopBar = () => (
    <div
      style={{
        position: "absolute", top: 10, left: 10, right: 10, zIndex: 1700,
        display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "stretch",
      }}
    >
      {/* legend */}
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 10, padding: "6px 10px",
          borderRadius: 10, color: "#fff", background: "rgba(20,22,28,0.85)",
          border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 6px 12px rgba(0,0,0,0.18)", backdropFilter: "blur(8px)",
        }}
      >
        {subcontractors.length === 0 ? (
          <span style={{ opacity: 0.7, fontSize: 12 }}>Legend</span>
        ) : (
          subcontractors.map(s => (
            <span key={s.name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <i style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block", background: s.color, border: "1px solid #fff" }} />
              <span style={{ fontSize: 12.5, opacity: 0.95 }}>{s.name}</span>
            </span>
          ))
        )}
      </div>

      {/* counter + delete */}
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px",
          borderRadius: 10, background: "rgba(20,22,28,0.85)", border: "1px solid rgba(255,255,255,0.06)",
          color: "#fff", boxShadow: "0 6px 12px rgba(0,0,0,0.18)", backdropFilter: "blur(8px)",
        }}
      >
        <span style={{ fontSize: 13.5 }}>{totalSelectedPunch || 0} punch seçili</span>
        {totalSelectedPunch > 0 && (
          <button
            onClick={deleteSelectedPunches}
            style={{ background: "#e53935", color: "#fff", border: "none", borderRadius: 8, padding: "6px 10px", fontWeight: 700, cursor: "pointer" }}
          >
            Seçilenleri Sil
          </button>
        )}
      </div>

      {/* filter */}
      <select
        value={activeFilter}
        onChange={(e) => setActiveFilter(e.target.value)}
        title="Taşerona göre filtrele"
        style={{
          background: "rgba(20,22,28,0.85)", color: "#fff", border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 10, padding: "6px 10px", fontSize: 13, backdropFilter: "blur(8px)", boxShadow: "0 6px 12px rgba(0,0,0,0.18)", minWidth: 150,
        }}
      >
        <option value="">Tüm Taşeronlar</option>
        {subcontractors.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
      </select>

      {/* settings */}
      <button
        onClick={() => setShowSettings(true)}
        style={{
          background: "linear-gradient(135deg,#6d6ef9,#836bff)", color: "#fff", border: "none",
          borderRadius: 10, padding: "8px 12px", fontWeight: 800, cursor: "pointer", boxShadow: "0 10px 26px rgba(109,110,249,0.35)",
        }}
      >
        ⚙️ Ayarlar
      </button>
    </div>
  );

  /* ======= loading / settings ======= */
  if (!points || !poly || !boundary) {
    return <div style={{ background: "#d9d9d9", color: "#111", height: "100vh", display: "grid", placeItems: "center", fontWeight: 700 }}>GeoJSON yükleniyor…</div>;
  }
  if (showSettings) {
    return (
      <div style={{ minHeight: "100vh", padding: 24, background: "#0f1117", color: "#fff", display: "grid", placeItems: "center" }}>
        <div style={{ width: 620, maxWidth: "92vw", borderRadius: 16, border: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(180deg,#151823,#12141c)", boxShadow: "0 40px 80px rgba(0,0,0,0.5)", padding: 18 }}>
          <h2 style={{ margin: "4px 0 8px" }}>Taşeron Ayarları</h2>
          <p style={{ opacity: 0.85, marginTop: 0 }}>Taşeron ekle / düzenle / sil. En az bir taşeron ekleyip <b>Başla</b> ile haritaya geç.</p>

          <div style={{ display: "flex", gap: 10, padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 12 }}>
            <input type="text" placeholder="Taşeron Adı" value={newSub.name}
              onChange={(e) => setNewSub({ ...newSub, name: e.target.value })}
              style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "#0f1320", color: "#fff" }} />
            <input type="color" value={newSub.color} onChange={(e) => setNewSub({ ...newSub, color: e.target.value })}
              title="Renk" style={{ width: 48, height: 42, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "#0f1320", cursor: "pointer" }} />
            <button
              onClick={() => {
                if (!newSub.name.trim()) return;
                if (subcontractors.some(s => s.name.trim().toLowerCase() === newSub.name.trim().toLowerCase())) { alert("Bu isimde taşeron var."); return; }
                setSubcontractors(prev => [...prev, newSub]);
                setNewSub({ name: "", color: "#7c7cff" });
              }}
              style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "linear-gradient(135deg,#6d6ef9,#836bff)", color: "#fff", fontWeight: 900, cursor: "pointer" }}
            >+ Ekle</button>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {subcontractors.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="color" value={s.color}
                    onChange={(e) => { const u = [...subcontractors]; u[i] = { ...u[i], color: e.target.value }; setSubcontractors(u); }}
                    style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "#0f1320" }} />
                  <input type="text" value={s.name}
                    onChange={(e) => { const u = [...subcontractors]; u[i] = { ...u[i], name: e.target.value }; setSubcontractors(u); }}
                    style={{ width: 220, maxWidth: "55vw", padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "#0f1320", color: "#fff" }} />
                </div>
                <button
                  onClick={() => { if (window.confirm(`${s.name} taşeronu silinsin mi?`)) setSubcontractors(subcontractors.filter((_, idx) => idx !== i)); }}
                  style={{ border: "none", background: "#e53935", color: "#fff", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontWeight: 800 }}
                >🗑️</button>
              </div>
            ))}
            {subcontractors.length === 0 && (
              <div style={{ opacity: 0.7, fontStyle: "italic", textAlign: "center", border: "1px dashed rgba(255,255,255,0.12)", padding: 10, borderRadius: 10 }}>
                Henüz taşeron eklenmedi.
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button
              onClick={() => setShowSettings(false)}
              disabled={subcontractors.length === 0}
              style={{
                padding: "10px 14px", borderRadius: 12, border: "none",
                background: subcontractors.length === 0 ? "#2f3347" : "linear-gradient(135deg,#6d6ef9,#836bff)",
                color: "#fff", fontWeight: 900, cursor: subcontractors.length === 0 ? "not-allowed" : "pointer", opacity: subcontractors.length === 0 ? 0.6 : 1,
              }}
            >Başla</button>
          </div>
        </div>
      </div>
    );
  }

  /* ======= map ======= */
  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <TopBar />

      <MapContainer
        center={initialCenter}
        zoom={18}
        minZoom={14}
        maxZoom={22}
        style={{ height: "100%", width: "100%", cursor: "default" }}
        preferCanvas
        dragging={false}
        scrollWheelZoom={true}
        doubleClickZoom={true}
      >
        <MiddleMouseDrag />

        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <GeoJSON data={boundary} style={() => ({ color: "#2ecc71", weight: 2, opacity: 0.9, fillOpacity: 0 })} />

        <RightClickUnselect
          poly={poly}
          punches={punches}
          multiSelectedPunches={multiSelected}
          setMultiSelected={setMultiSelected}
          setSelected={setSelected}
        />
        <SelectionControl
          poly={poly}
          punches={punches}
          multiSelected={multiSelected}
          setMultiSelected={setMultiSelected}
          setIsSelecting={setIsSelecting}
          isSelecting={isSelecting}
          setSelected={setSelected}
          setSelectionBox={setSelectionBox}
          setJustDragged={setJustDragged}
        />
        <BoundaryFreePunchClick
          poly={poly}
          boundary={boundary}
          isSelecting={isSelecting}
          setSelected={setSelected}
          setSelectedPunch={setSelectedPunch}
          setNewPunch={setNewPunch}
          justDragged={justDragged}
        />

        {/* --- TABLES with GROUP HOVER --- */}
        <GeoJSON
          data={poly}
          style={(feature) => {
            const tid = getTableId(feature.properties);
            const isSelected = tid === (typeof selected === "string" ? selected : null);
            const hasPunch = getPunchCount(punches, tid) > 0;
            return {
              color: isSelected ? "#6a85ff" : hasPunch ? "#d32f2f" : "#3b3f4b",
              weight: isSelected ? 3 : hasPunch ? 2.5 : 2,
              opacity: 1,
              fillOpacity: isSelected ? 0.25 : hasPunch ? 0.12 : 0.08,
              fillColor: isSelected ? "#6a85ff" : hasPunch ? "#d32f2f" : "#666",
            };
          }}
          onEachFeature={(feature, layer) => {
            const tid = getTableId(feature.properties);
            if (!tid) return;

            // registry for group hover
            if (!tidLayersRef.current[tid]) tidLayersRef.current[tid] = new Set();
            tidLayersRef.current[tid].add(layer);

            const baseStyle = (hovered) => {
              const safeId = typeof selected === "string" ? selected : null;
              const isSelected = tid === safeId;
              const hasPunch = getPunchCount(punches, tid) > 0;
              if (hovered && !isSelected) {
                return { color: "#6a85ff", weight: 2.5, fillOpacity: 0.15, fillColor: "#6a85ff" };
              }
              return {
                color: isSelected ? "#6a85ff" : hasPunch ? "#d32f2f" : "#3b3f4b",
                weight: isSelected ? 3 : hasPunch ? 2.5 : 2,
                fillOpacity: isSelected ? 0.25 : hasPunch ? 0.12 : 0.08,
                fillColor: isSelected ? "#6a85ff" : hasPunch ? "#d32f2f" : "#666",
              };
            };

            // tooltip (masa id + punch sayısı)
            const tooltipContent = `
              <div style="font-weight:700; font-size:14px;">${tid}</div>
              <div style="font-size:12px; opacity:0.9; margin-top:2px;">Punch: <strong>${getPunchCount(punches, tid)}</strong></div>
            `;
            layer.bindTooltip(tooltipContent, { permanent: false, direction: "top", className: "leaflet-tooltip-custom", offset: [0, -10] });

            // group hover highlight
            layer.on("mouseover", () => {
              const set = tidLayersRef.current[tid] || new Set();
              set.forEach(l => l.setStyle(baseStyle(true)));
              layer.openTooltip();
            });
            layer.on("mouseout", () => {
              const set = tidLayersRef.current[tid] || new Set();
              set.forEach(l => l.setStyle(baseStyle(false)));
              layer.closeTooltip();
            });

            layer.on("click", (e) => {
              if (e.originalEvent.button !== 0 || e.target.dragging?.enabled()) return;
              L.DomEvent.stopPropagation(e);
              setSelected(tid); setMultiSelected(new Set()); setSelectedPunch(null); setNewPunch(null);
            });
          }}
        />

        <PunchLayer
          punches={punches}
          polyGeoJSON={poly}
          setSelectedPunch={setSelectedPunch}
          safeTableId={safeTableId}
          multiSelectedPunches={multiSelected}
          subcontractors={subcontractors}
          activeFilter={activeFilter}
        />

        <BoxSelectionOverlay startPoint={selectionBox?.start} endPoint={selectionBox?.end} />
      </MapContainer>

      {/* ======= Isometric panel ======= */}
      {safeTableId && (
        <div
          style={{
            position: "absolute", top: 0, right: 0, width: 360, height: "100%",
            background: "linear-gradient(180deg, #1c1f2b, #171a24)", zIndex: 1500, padding: 16, color: "#fff",
            boxShadow: "-20px 0 60px rgba(0,0,0,0.45)", borderLeft: "1px solid rgba(255,255,255,0.06)", overflowY: "auto",
          }}
        >
          <h3 style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 10, marginBottom: 12 }}>
            <span style={{ color: "#6a85ff" }}>İzometrik Panel</span>
          </h3>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <label style={{ fontSize: 13, opacity: 0.9, minWidth: 95 }}>Taşeron:</label>
            <select
              value={activeSub}
              onChange={(e) => setActiveSub(e.target.value)}
              style={{ flex: 1, padding: 8, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(10,12,18,0.85)", color: "#fff" }}
            >
              <option value="">Seçiniz…</option>
              {subcontractors.map((s, i) => <option key={i} value={s.name}>{s.name}</option>)}
            </select>
          </div>

          <div ref={isoWrapRef} style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
            <img
              ref={isoRef}
              src="/photos/table_iso.png"
              alt="Isometric"
              onLoad={() => setIsoLoaded(true)}
              onError={() => setIsoError(true)}
              onClick={onIsoClick}
              style={{ cursor: isoLoaded && !isoError ? "crosshair" : "default", width: "90%", borderRadius: 14, opacity: isoError ? 0.4 : 1, boxShadow: "0 12px 36px rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.06)" }}
            />
            {isoError && (
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", color: "#ef5350", fontWeight: "bold", textAlign: "center" }}>
                İzometrik resim yüklenemedi!
              </div>
            )}

            {(punches[safeTableId] || [])
              .filter(p => (activeFilter ? p.subcontractor === activeFilter : true))
              .map(p => {
                const color = subcontractors.find(s => s.name === p.subcontractor)?.color || "#f00";
                const isActive = selectedPunch?.id === p.id;
                return (
                  <div
                    key={p.id}
                    role="button"
                    title={p.note || "Punch"}
                    onClick={(e) => { e.stopPropagation(); setSelectedPunch(prev => prev?.id === p.id ? null : p); }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = "translate(-50%, -50%) scale(1.6)"; e.currentTarget.style.boxShadow = "0 0 12px rgba(0,0,0,0.7)"; e.currentTarget.style.zIndex = "20"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = "translate(-50%, -50%) scale(1)"; e.currentTarget.style.boxShadow = "0 0 3px rgba(0,0,0,0.4)"; e.currentTarget.style.zIndex = "10"; }}
                    style={{
                      position: "absolute", left: `${p.isoX}%`, top: `${p.isoY}%`,
                      width: 12, height: 12, background: color, borderRadius: "50%", transform: "translate(-50%, -50%)",
                      border: "2px solid #fff", boxShadow: "0 0 3px rgba(0,0,0,0.4)", cursor: "pointer", zIndex: 10,
                      transition: "all 0.2s ease", pointerEvents: isoError ? "none" : "auto", opacity: isActive ? 1 : 0.9,
                    }}
                  />
                );
              })}

            {/* clamped popup inside panel */}
            {selectedPunch && selectedPunch.table_id === safeTableId && (() => {
              const img = isoRef.current, wrap = isoWrapRef.current;
              if (!img || !wrap) return null;

              const wrapRect = wrap.getBoundingClientRect();
              const imgRect = img.getBoundingClientRect();
              const popupWidth = 280, popupHeight = 220, margin = 8;

              // desired position in px relative to wrapper
              const targetLeftPxWithinImg = imgRect.left + (selectedPunch.isoX / 100) * imgRect.width;
              const targetTopPxWithinImg  = imgRect.top  + (selectedPunch.isoY / 100) * imgRect.height;

              // clamp to wrapper bounds
              const minLeft = wrapRect.left + margin + popupWidth / 2;
              const maxLeft = wrapRect.right - margin - popupWidth / 2;
              const minTop  = wrapRect.top  + margin + 40; // some space
              const maxTop  = wrapRect.bottom - margin - popupHeight;

              const leftPx = Math.max(minLeft, Math.min(maxLeft, targetLeftPxWithinImg));
              // prefer above if space allows
              let topPx = targetTopPxWithinImg - popupHeight - 16;
              if (topPx < minTop) topPx = Math.min(maxTop, targetTopPxWithinImg + 16);

              return (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "fixed",
                    left: leftPx,
                    top: topPx,
                    transform: "translateX(-50%)",
                    zIndex: 1600,
                    width: popupWidth,
                    maxWidth: 300,
                    background: "rgba(17,17,17,0.96)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 14,
                    padding: 14,
                    color: "#fff",
                    boxShadow: "0 24px 56px rgba(0,0,0,0.55)",
                    backdropFilter: "blur(10px)",
                    fontSize: 13.5,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <strong style={{ color: "#ffb74d" }}>Punch Detay</strong>
                    <button onClick={(e) => { e.stopPropagation(); setSelectedPunch(null); }} style={{ background: "transparent", border: "none", color: "#fff", fontSize: 18, cursor: "pointer" }}>×</button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: subcontractors.find(s => s.name === selectedPunch.subcontractor)?.color || "#f00", border: "2px solid #fff" }} />
                    <div style={{ fontSize: 12.5, opacity: 0.9 }}>Taşeron: <b>{selectedPunch.subcontractor || "-"}</b></div>
                  </div>
                  {selectedPunch.photo && (<img src={selectedPunch.photo} alt="Punch" style={{ width: "100%", borderRadius: 8, margin: "6px 0", display: "block" }} />)}
                  <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>
                    {selectedPunch.note?.trim() ? selectedPunch.note : <i style={{ opacity: 0.6 }}>(Not yok)</i>}
                  </div>
                  <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); startEdit(selectedPunch); setSelectedPunch(null); }}
                      style={{ background: "linear-gradient(135deg, #ffb74d, #ff9800)", color: "#111", border: "none", padding: "6px 12px", borderRadius: 10, fontSize: 12, cursor: "pointer", fontWeight: 800 }}
                    >Düzenle</button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm("Bu punch silinsin mi?")) {
                          setPunches(prev => ({ ...prev, [safeTableId]: (prev[safeTableId] || []).filter(p => p.id !== selectedPunch.id) }));
                          setSelectedPunch(null);
                        }
                      }}
                      style={{ background: "linear-gradient(135deg, #ef5350, #e53935)", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 10, fontSize: 12, cursor: "pointer", fontWeight: 800 }}
                    >Sil</button>
                  </div>
                </div>
              );
            })()}
          </div>

          {newPunch && newPunch.table_id === safeTableId && (
            <div style={{ width: "100%", textAlign: "center", marginTop: 12, padding: 12, border: "1px dashed rgba(106,133,255,0.6)", borderRadius: 12, background: "rgba(30,34,48,0.6)" }}>
              <h4 style={{ color: "#6a85ff", marginTop: 0, marginBottom: 8 }}>Yeni Punch Ekle</h4>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <label style={{ fontSize: 13, opacity: 0.9, minWidth: 95 }}>Taşeron:</label>
                <select value={activeSub} onChange={(e) => setActiveSub(e.target.value)}
                  style={{ flex: 1, padding: 8, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(10,12,18,0.85)", color: "#fff" }}>
                  <option value="">Seçiniz…</option>
                  {subcontractors.map((s, i) => <option key={i} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <textarea placeholder="Not (opsiyonel)" value={note} onChange={(e) => setNote(e.target.value)}
                style={{ width: "100%", minHeight: 60, margin: "6px 0", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(10,12,18,0.85)", color: "#fff", resize: "vertical", outline: "none" }} />
              <input type="file" accept="image/*" onChange={onPhoto} style={{ display: "block", margin: "6px auto" }} />
              {photo && <img src={photo} alt="preview" style={{ width: "50%", margin: "8px auto", borderRadius: 10, display: "block", boxShadow: "0 12px 30px rgba(0,0,0,0.35)" }} />}
              <div style={{ marginTop: 8, display: "flex", justifyContent: "center", gap: 10 }}>
                <button style={{ padding: "10px 16px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #43a047, #2e7d32)", color: "#fff", fontWeight: 900 }} onClick={addPunch}>Punch Ekle</button>
                <button style={{ padding: "10px 16px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #9e9e9e, #616161)", color: "#fff", fontWeight: 900 }} onClick={() => { setNewPunch(null); setNote(""); setPhoto(null); }}>İptal</button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}>
            {(punches[safeTableId]?.length ?? 0) > 0 && (
              <button
                style={{ padding: "10px 16px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #ef5350, #e53935)", color: "#fff", fontWeight: 900 }}
                onClick={() => { setSelectedPunch(null); deleteAllPunches(); }}
              >
                Tüm Punchları Sil ({punches[safeTableId].length})
              </button>
            )}
            <button
              style={{ padding: "10px 16px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #9e9e9e, #616161)", color: "#fff", fontWeight: 900 }}
              onClick={() => { setSelectedPunch(null); setSelected(null); }}
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* ======= free punch modal ======= */}
      {newPunch && newPunch.table_id === "__free__" && (
        <div onClick={() => { setNewPunch(null); setNote(""); setPhoto(null); }}
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 420, maxWidth: "92vw", background: "linear-gradient(180deg,#161922,#12141c)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 16, color: "#fff", boxShadow: "0 24px 56px rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}>
            <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>Yeni Punch (Masa Dışı)</span>
              <button onClick={() => { setNewPunch(null); setNote(""); setPhoto(null); }} style={{ background: "transparent", border: "none", color: "#fff", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 13, opacity: 0.9, minWidth: 95 }}>Taşeron:</label>
              <select value={activeSub} onChange={(e) => setActiveSub(e.target.value)}
                style={{ flex: 1, padding: 8, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(10,12,18,0.85)", color: "#fff" }}>
                <option value="">Seçiniz…</option>
                {subcontractors.map((s, i) => <option key={i} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <textarea placeholder="Not (opsiyonel)" value={note} onChange={(e) => setNote(e.target.value)}
              style={{ width: "100%", minHeight: 60, margin: "6px 0", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(10,12,18,0.85)", color: "#fff", resize: "vertical", outline: "none" }} />
            <input type="file" accept="image/*" onChange={onPhoto} style={{ display: "block", margin: "6px 0" }} />
            {photo && <img src={photo} alt="preview" style={{ width: "100%", margin: "8px 0", borderRadius: 10, display: "block" }} />}
            <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={{ padding: "10px 16px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #9e9e9e, #616161)", color: "#fff", fontWeight: 900 }}
                onClick={() => { setNewPunch(null); setNote(""); setPhoto(null); }}
              >İptal</button>
              <button style={{ padding: "10px 16px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #43a047, #2e7d32)", color: "#fff", fontWeight: 900 }}
                onClick={addPunch}
              >Punch Ekle</button>
            </div>
          </div>
        </div>
      )}

      {/* ======= edit modal ======= */}
      {editingPunch && (
        <div onClick={() => setEditingPunch(null)}
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "linear-gradient(180deg,#161922,#12141c)", color: "#fff", padding: 20, width: 420, maxWidth: "90vw", borderRadius: 14, boxShadow: "0 24px 56px rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" }}>
            <h4 style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 10, marginBottom: 15, color: "#ffb74d" }}>
              Punch Düzenle ({editingPunch.table_id})
            </h4>
            <textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Not..."
              style={{ width: "100%", minHeight: 80, margin: "6px 0", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(10,12,18,0.85)", color: "#fff", resize: "vertical", outline: "none" }} />
            <input type="file" accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onloadend = () => setEditPhoto(r.result); r.readAsDataURL(f); } }}
              style={{ display: "block", margin: "6px 0" }}
            />
            {editPhoto && <img src={editPhoto} alt="preview" style={{ width: "100%", margin: "8px 0", borderRadius: 10, display: "block" }} />}
            <div style={{ marginTop: 15, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={{ padding: "10px 16px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #9e9e9e, #616161)", color: "#fff", fontWeight: 900 }}
                onClick={() => setEditingPunch(null)}
              >İptal</button>
              <button style={{ padding: "10px 16px", borderRadius: 12, border: "none", cursor: "pointer", background: "linear-gradient(135deg, #ffb74d, #ff9800)", color: "#111", fontWeight: 900 }}
                onClick={saveEdit}
              >Kaydet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
