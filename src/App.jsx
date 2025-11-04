// src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, centroid } from "@turf/turf";
import "./App.css";
import ExportMenu from "./components/ExportMenu";   // ✅ sadece bu





function AimDot({ x, y }) {
  if (x == null || y == null) return null;
  return (
    <div
      className="aim-active"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <div className="aim-core"></div>
      <div className="aim-wave wave1"></div>
      <div className="aim-wave wave2"></div>
      <div className="aim-wave wave3"></div>
    </div>
  );
}

// GeoJSON dosyaları
import tablesPolyUrl from "/tables_poly.geojson?url";
import tablesPointsUrl from "/tables_points.geojson?url";
import siteBoundaryUrl from "/site_boundary.geojson?url";

/* -------------------- Yardımcı Fonksiyonlar -------------------- */
function getTableId(props) {
  if (!props) return null;
  if (props.table_id) return props.table_id;
  if (props.tableId) return props.tableId;
  if (props.id !== undefined) return String(props.id);
  if (props.name) return props.name;
  if (props.masa_id) return props.masa_id;
  if (props.masa_kodu) return props.masa_kodu;
  if (props.kod) return props.kod;
  for (const key in props) {
    const val = props[key];
    if (typeof val === "string" && /^R\d{1,3}_T\d{1,3}$/i.test(val.trim()))
      return val.trim().toUpperCase();
  }
  for (const key in props) {
    const val = props[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}
const getPunchCount = (punches, tableId) => (punches[tableId] || []).length;

function getSafeCenter(geojson) {
  try {
    const feats = geojson?.features || [];
    let sx = 0,
      sy = 0,
      n = 0;
    for (const f of feats) {
      if (f.geometry?.type === "Point") {
        const [lon, lat] = f.geometry.coordinates;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          sx += lon;
          sy += lat;
          n++;
        }
      }
    }
    return n ? [sy / n, sx / n] : [52.712, -1.706];
  } catch {
    return [52.712, -1.706];
  }
}

function generatePointInsidePolygon(polygon, maxTries = 100) {
  const bbox = L.geoJSON(polygon).getBounds();
  const sw = bbox.getSouthWest();
  const ne = bbox.getNorthEast();

  for (let i = 0; i < maxTries; i++) {
    const lng = sw.lng + Math.random() * (ne.lng - sw.lng);
    const lat = sw.lat + (1 - Math.random()) * (ne.lat - sw.lat); // Lat için 1 - Math.random() kullanılmalı
    const pt = point([lng, lat]);
    if (booleanPointInPolygon(pt, polygon)) return [lat, lng];
  }
  const coords = polygon.geometry.coordinates[0];
  const sumLat = coords.reduce((s, c) => s + c[1], 0);
  const sumLng = coords.reduce((s, c) => s + c[0], 0);
  return [sumLat / coords.length, sumLng / coords.length];
}

function isoClickToLatLng(polyFeature, isoX, isoY) {
  const bbox = L.geoJSON(polyFeature).getBounds();
  const sw = bbox.getSouthWest();
  const ne = bbox.getNorthEast();
  const lng = sw.lng + (isoX / 100) * (ne.lng - sw.lng);
  const lat = sw.lat + (1 - isoY / 100) * (ne.lat - sw.lat);
  const pt = point([lng, lat]);
  if (booleanPointInPolygon(pt, polyFeature)) return [lat, lng];
  return generatePointInsidePolygon(polyFeature);
}

/* -------------------- Hover ID Etiketi -------------------- */
function HoverLabel({ hover }) {
  if (!hover) return null;
  return (
    <div className="table-id-label" style={{ left: hover.x, top: hover.y }}>
      {hover.id}
    </div>
  );
}

/* -------------------- Kutu Seçim Overlay -------------------- */
function BoxSelectionOverlay({ startPoint, endPoint }) {
  if (!startPoint || !endPoint) return null;
  return (
    <div
      className="selection-box"
      style={{
        left: Math.min(startPoint.x, endPoint.x),
        top: Math.min(startPoint.y, endPoint.y),
        width: Math.abs(startPoint.x - endPoint.x),
        height: Math.abs(startPoint.y - endPoint.y),
      }}
    />
  );
}

/* -------------------- Sağ Tık Unselect -------------------- */
function RightClickUnselect({
  poly,
  punches,
  multiSelectedPunches,
  setMultiSelected,
  setSelected,
}) {
  useMapEvents({
    contextmenu: (e) => {
      L.DomEvent.preventDefault(e);
      const latlng = e.latlng;
      const pt = point([latlng.lng, latlng.lat]);
      let foundTableId = null;

      for (const f of poly.features) {
        const tid = getTableId(f.properties);
        if (tid && booleanPointInPolygon(pt, f)) {
          foundTableId = tid;
          break;
        }
      }

      if (foundTableId) {
        const punchIdsToRemove = (punches[foundTableId] || [])
          .filter((p) => multiSelectedPunches.has(p.id))
          .map((p) => p.id);

        if (punchIdsToRemove.length > 0) {
          setMultiSelected((prev) => {
            const next = new Set(prev);
            punchIdsToRemove.forEach((id) => next.delete(id));
            return next;
          });
        }
      } else {
        setSelected(null);
      }
    },
  });
  return null;
}

/* -------------------- Seçim Kontrol (DÜZELTİLMİŞ) -------------------- */
function SelectionControl({
  poly,
  punches,
  multiSelected,
  setMultiSelected,
  setIsSelecting,
  isSelecting,
  setSelected,
  setSelectionBox,
  setJustDragged,
}) {
  const map = useMap();
  const isDragging = useRef(false);
  const clickStartCoords = useRef(null);
  const clickStartLatLng = useRef(null);

  useMapEvents({
    mousedown: (e) => {
      if (e.originalEvent.button !== 0) return;

      // KRİTİK DÜZELTME: Tarayıcı varsayılan seçimini ve Leaflet click olayını engelle
      L.DomEvent.preventDefault(e.originalEvent);
      L.DomEvent.stopPropagation(e);

      map.dragging.disable();
      isDragging.current = true;
      setIsSelecting(true);

      clickStartCoords.current = {
        x: e.originalEvent.clientX,
        y: e.originalEvent.clientY,
      };
      clickStartLatLng.current = e.latlng;

      setSelectionBox({
        start: clickStartCoords.current,
        end: clickStartCoords.current,
      });

      if (!e.originalEvent.ctrlKey && !e.originalEvent.metaKey) {
        setMultiSelected(new Set());
      }
    },

    mousemove: (e) => {
      if (!isSelecting || !isDragging.current || !clickStartCoords.current)
        return;

      setSelectionBox({
        start: clickStartCoords.current,
        end: { x: e.originalEvent.clientX, y: e.originalEvent.clientY },
      });

      const moved =
        Math.hypot(
          clickStartCoords.current.x - e.originalEvent.clientX,
          clickStartCoords.current.y - e.originalEvent.clientY
        ) > 5;

      if (moved) {
        L.DomEvent.stopPropagation(e);

        const minLat = Math.min(
          clickStartLatLng.current.lat,
          e.latlng.lat
        );
        const maxLat = Math.max(
          clickStartLatLng.current.lat,
          e.latlng.lat
        );
        const minLng = Math.min(
          clickStartLatLng.current.lng,
          e.latlng.lng
        );
        const maxLng = Math.max(
          clickStartLatLng.current.lng,
          e.latlng.lng
        );

        const isAdditive = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
        const initialSelected = isAdditive ? multiSelected : new Set();
        const next = new Set(initialSelected);

        Object.values(punches)
          .flat()
          .forEach((p) => {
            if (!p.latlng) return;
            const [lat, lng] = p.latlng;
            if (
              lat >= minLat &&
              lat <= maxLat &&
              lng >= minLng &&
              lng <= maxLng
            ) {
              next.add(p.id);
            } else if (!isAdditive && initialSelected.has(p.id)) {
              next.delete(p.id);
            }
          });

        setMultiSelected(next);
      }
    },

    mouseup: (e) => {
      if (e.originalEvent.button !== 0) return;

      map.dragging.enable();

      const moved =
        clickStartCoords.current
          ? Math.hypot(
              clickStartCoords.current.x - e.originalEvent.clientX,
              clickStartCoords.current.y - e.originalEvent.clientY
            ) > 8
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

      // Tek tık — masa seçimi
      const latlng = e.latlng;
      const pt = point([latlng.lng, latlng.lat]);
      let foundTableId = null;
      poly.features.forEach((f) => {
        const tid = getTableId(f.properties);
        if (tid && booleanPointInPolygon(pt, f)) foundTableId = tid;
      });

      if (foundTableId) {
        setSelected(foundTableId);
        setMultiSelected(new Set());
      } else {
        setSelected(null);
        setMultiSelected(new Set());
      }
    },
  });

  return null;
}

/* -------------------- Boundary İçinde Masa Dışı Punch -------------------- */
function BoundaryFreePunchClick({
  poly,
  boundary,
  isSelecting,
  setSelected,
  setSelectedPunch,
  setNewPunch,
  justDragged,
}) {
  useMapEvents({
    click: (e) => {
      if (isSelecting || justDragged) return;

      const latlng = e.latlng;
      const pt = point([latlng.lng, latlng.lat]);

      let onTable = false;
      poly.features.forEach((f) => {
        const tid = getTableId(f.properties);
        if (tid && booleanPointInPolygon(pt, f)) onTable = true;
      });
      if (onTable) return;

      let insideBoundary = false;
      (boundary?.features || []).forEach((f) => {
        if (booleanPointInPolygon(pt, f)) insideBoundary = true;
      });
      if (!insideBoundary) return;

      setSelected(null);
      setSelectedPunch(null);
      setNewPunch({ table_id: "__free__", latlng: [latlng.lat, latlng.lng] });
    },
  });
  return null;
}

/* -------------------- Punch Layer -------------------- */
function PunchLayer({
  punches,
  polyGeoJSON,
  setSelectedPunch,
  safeTableId,
  multiSelectedPunches,
  subcontractors,
  activeFilter,
}) {
  const map = useMap();
  const layerRef = useRef(null);
  const polyIndexRef = useRef({});
  const punchLocationsRef = useRef({});

  useEffect(() => {
    if (!polyGeoJSON) return;
    const index = {};
    polyGeoJSON.features.forEach((f) => {
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

    const colorOf = (name) =>
      subcontractors.find((s) => s.name === name)?.color || "#f04";

    // her zaman interactive: izometrikte de popup açılmalı
    const areTablePunchesInteractive = true;

    Object.keys(punches).forEach((tid) => {
      (punches[tid] || [])
        .filter((p) => (activeFilter ? p.subcontractor === activeFilter : true))
        .forEach((p) => {
          if (!p.latlng) {
            if (tid !== "__free__" && polyIndexRef.current[tid]) {
              if (!punchLocationsRef.current[p.id]) {
                punchLocationsRef.current[p.id] = generatePointInsidePolygon(
                  polyIndexRef.current[tid]
                );
              }
              p.latlng = punchLocationsRef.current[p.id];
            } else return;
          }

          const isSelected = multiSelectedPunches.has(p.id);
          const marker = L.circleMarker(p.latlng, {
            radius: isSelected ? 9 : 6,
            color: isSelected ? "#00FFFF" : "#fff",
            weight: isSelected ? 2.5 : 1.5,
            fillColor: colorOf(p.subcontractor),
            fillOpacity: 1,
            className:
              tid === "__free__" ? "punch-marker free-punch-marker" : "punch-marker",
            pane: "markerPane",
            zIndexOffset: isSelected ? 1500 : 1000,
          }).addTo(layer);

          if (tid === "__free__") {
            const popupHTML = `
              <div style="font-family:sans-serif;min-width:200px;">
                <b style="color:#ffb74d;">Serbest Punch</b>
                <div style="font-size:12px;margin:4px 0;opacity:.9">Taşeron: <b>${p.subcontractor || "-"}</b></div>
                ${p.photo ? `<img src="${p.photo}" style="width:100%;border-radius:8px;margin:8px 0;" />` : ""}
                <div style="font-size:13px;margin-top:6px;white-space:pre-wrap;">${
                  p.note?.trim() || "<i style='opacity:.6'>(Not yok)</i>"
                }</div>
                <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">
                  <button onclick="window.editFreePunch(${p.id})" style="background:#ff9800;color:#111;border:none;padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-weight:800;">Düzenle</button>
                  <button onclick="window.deleteFreePunch(${p.id})" style="background:#e53935;color:#fff;border:none;padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer;font-weight:800;">Sil</button>
                </div>
              </div>`;
            marker.bindPopup(popupHTML, {
              maxWidth: 280,
              className: "custom-punch-popup",
            });
            L.circle(p.latlng, {
              radius: 25,
              fill: false,
              stroke: false,
              interactive: true,
            })
              .addTo(layer)
              .on("click", (e) => {
                L.DomEvent.stopPropagation(e);
                marker.openPopup();
              });
          } else if (areTablePunchesInteractive) {
            L.circle(p.latlng, {
              radius: 20,
              fill: false,
              stroke: false,
              interactive: true,
            })
              .addTo(layer)
              .on("click", (e) => {
                L.DomEvent.stopPropagation(e);
                setSelectedPunch({ ...p, table_id: tid });
              });
          }

          marker.on("mouseover", () =>
            marker.setStyle({ radius: 10, zIndexOffset: 2000 })
          );
          marker.on("mouseout", () =>
            marker.setStyle({
              radius: isSelected ? 9 : 6,
              zIndexOffset: isSelected ? 1500 : 1000,
            })
          );
        });
    });
  }, [
    punches,
    map,
    setSelectedPunch,
    safeTableId,
    multiSelectedPunches,
    subcontractors,
    activeFilter,
  ]);

  return null;
}

/* -------------------- Sadece Orta Tuş ile Pan (Harita) -------------------- */
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

/* -------------------- Global Yardımcılar -------------------- */
let currentPunches = {};
let currentSetPunches = null;
let currentStartEdit = null;
window.deleteFreePunch = (id) => {
  if (!currentSetPunches || !window.confirm("Bu punch silinsin mi?")) return;
  currentSetPunches((prev) => ({
    ...prev,
    __free__: (prev.__free__ || []).filter((p) => p.id !== id),
  }));
};
window.editFreePunch = (id) => {
  const punch = (currentPunches.__free__ || []).find((p) => p.id === id);
  if (punch && currentStartEdit) currentStartEdit({ ...punch, table_id: "__free__" });
};

/* -------------------- ANA COMPONENT -------------------- */
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

  const [hover, setHover] = useState(null); // hover label (masa id)

  // İzometrik pan/zoom (orta tuş + scroll)
  const isoWrapRef = useRef(null);
  const isoStageRef = useRef(null);
  const isoImgRef = useRef(null);
  const [isoZoom, setIsoZoom] = useState(1);
  const [isoOffset, setIsoOffset] = useState({ x: 0, y: 0 });
  const [isoPanning, setIsoPanning] = useState(false);
  const isoPanStart = useRef({ x: 0, y: 0 });
  const isoOffsetStart = useRef({ x: 0, y: 0 });

  const [selectedPunch, setSelectedPunch] = useState(null);

  // Edit Modal
  const [editingPunch, setEditingPunch] = useState(null);
  const [editNote, setEditNote] = useState("");
  const [editPhoto, setEditPhoto] = useState(null);

  // Taşeronlar
  const [subcontractors, setSubcontractors] = useState([]);
  const [newSub, setNewSub] = useState({ name: "", color: "#3f8cff" });
  const [showSettings, setShowSettings] = useState(false);
  const [activeSub, setActiveSub] = useState("");
  const [activeFilter, setActiveFilter] = useState("");

  // Hover grup highlight için layer kayıtları
  const tidLayersRef = useRef({});

  // Harita Refini buraya taşıdık (Conditional render hatasını çözmek için)
  const mapRef = useRef(null);

  // global referanslar
  useEffect(() => {
    currentPunches = punches;
    currentSetPunches = setPunches;
  }, [punches, setPunches]);
  const startEdit = (p) => {
    setEditingPunch(p);
    setEditNote(p.note || "");
    setEditPhoto(p.photo || null);
  };
  useEffect(() => {
    currentStartEdit = startEdit;
  }, [startEdit]);

  // GeoJSON yükleme
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
      setPoly(polyData);
      setPoints(pointsData);
      setBoundary(boundaryData);
    })();
  }, []);

  // localStorage
  useEffect(() => {
    const s = localStorage.getItem("punches");
    if (s) setPunches(JSON.parse(s));
    const storedSubs = localStorage.getItem("subcontractors");
    if (storedSubs) {
      const parsed = JSON.parse(storedSubs);
      setSubcontractors(parsed);
      setShowSettings(parsed.length === 0);
    } else setShowSettings(true);
  }, []);
  useEffect(() => {
    localStorage.setItem("punches", JSON.stringify(punches));
  }, [punches]);
  useEffect(() => {
    localStorage.setItem("subcontractors", JSON.stringify(subcontractors));
  }, [subcontractors]);

  const initialCenter = useMemo(() => getSafeCenter(points), [points]);
  const safeTableId = typeof selected === "string" ? selected : null;

  const totalSelectedPunch = multiSelected.size;
  const selectedTablesByPunch = useMemo(() => {
    const ids = new Set();
    if (totalSelectedPunch > 0) {
      Object.keys(punches).forEach((tid) => {
        (punches[tid] || []).forEach((p) => {
          if (multiSelected.has(p.id)) ids.add(tid);
        });
      });
    }
    return ids;
  }, [multiSelected, punches, totalSelectedPunch]);

  // Tüm punch'ları tek bir array'de topla (Export için gerekli)
  const allPunches = useMemo(() => Object.values(punches).flat(), [punches]);


  /* -------------------- TopBar (sağa hizalı Export eklendi) -------------------- */
  const TopBar = () => (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        right: 10,
        zIndex: 1700,
        display: "flex",
        // SOL ve SAĞ grupları ayırmak için 'space-between' kullan
        justifyContent: "space-between", 
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      {/* SOL GRUP: Legend, Sayaç, Filtre */}
      <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
        {/* Legend */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 10px",
            borderRadius: 10,
            color: "#fff",
            background: "rgba(20,22,28,0.85)",
            border: "1px solid rgba(255,255,255,0.06)",
            boxShadow: "0 6px 12px rgba(0,0,0,0.18)",
            backdropFilter: "blur(8px)",
          }}
        >
          {subcontractors.length === 0 ? (
            <span style={{ opacity: 0.7, fontSize: 12 }}>Legend</span>
          ) : (
            subcontractors.map((s) => (
              <span
                key={s.name}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <i
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    display: "inline-block",
                    background: s.color,
                    border: "1px solid #fff",
                  }}
                />
                <span style={{ fontSize: 12.5, opacity: 0.95 }}>{s.name}</span>
              </span>
            ))
          )}
        </div>

        {/* Sayaç + toplu sil */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 10,
            background: "rgba(20,22,28,0.85)",
            border: "1px solid rgba(255,255,255,0.06)",
            color: "#fff",
            boxShadow: "0 6px 12px rgba(0,0,0,0.18)",
            backdropFilter: "blur(8px)",
          }}
        >
          <span style={{ fontSize: 13.5 }}>
            {totalSelectedPunch || 0} punch seçili
          </span>
          {totalSelectedPunch > 0 && (
            <button
              onClick={deleteSelectedPunches}
              style={{
                background: "#e53935",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "6px 10px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Seçilenleri Sil
            </button>
          )}
        </div>

        {/* Filtre */}
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value)}
          title="Taşerona göre filtrele"
          style={{
            background: "rgba(20,22,28,0.85)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10,
            padding: "6px 10px",
            fontSize: 13,
            backdropFilter: "blur(8px)",
            boxShadow: "0 6px 12px rgba(0,0,0,0.18)",
            minWidth: 150,
          }}
        >
          <option value="">Tüm Taşeronlar</option>
          {subcontractors.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      
      {/* SAĞ GRUP: Export, Ayarlar */}
      <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
        
        {/* YENİ BİLEŞEN: ExportMenu */}
        <ExportMenu punches={allPunches} /> 

        {/* Ayarlar */}
        <button
          onClick={() => setShowSettings(true)}
          style={{
            background: "linear-gradient(135deg,#6d6ef9,#836bff)",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "8px 12px",
            fontWeight: 800,
            cursor: "pointer",
            boxShadow: "0 10px 26px rgba(109,110,249,0.35)",
          }}
        >
          ⚙️ Ayarlar
        </button>
      </div>
    </div>
  );

  /* -------------------- İzometrik Tıklama → Punch Oluştur -------------------- */
  const handleIsoStageWheel = (e) => {
    e.preventDefault();
    const n = Math.max(0.5, Math.min(3, isoZoom + (e.deltaY < 0 ? 0.1 : -0.1)));
    setIsoZoom(n);
  };
  const handleIsoStageMouseDown = (e) => {
    if (e.button !== 1) return; // sadece orta tuşla pan
    e.preventDefault();
    setIsoPanning(true);
    isoPanStart.current = { x: e.clientX, y: e.clientY };
    isoOffsetStart.current = { ...isoOffset };
    const onMove = (ev) => {
      if (!isoPanning) return;
      setIsoOffset({
        x: isoOffsetStart.current.x + (ev.clientX - isoPanStart.current.x),
        y: isoOffsetStart.current.y + (ev.clientY - isoPanStart.current.y),
      });
    };
    const onUp = () => {
      setIsoPanning(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const onIsoClick = (e) => {
    if (!safeTableId) return;

    // Transform uygulanmış img rect'inden yüzde koordinatı hesapla
    const img = isoImgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const isoX = ((e.clientX - rect.left) / rect.width) * 100;
    const isoY = ((e.clientY - rect.top) / rect.height) * 100;

    const polyFeature = poly?.features.find(
      (f) => getTableId(f.properties) === safeTableId
    );
    if (!polyFeature) return;

    const latlng = isoClickToLatLng(polyFeature, isoX, isoY);
    setNewPunch({ table_id: safeTableId, isoX, isoY, latlng });
  };

  const onPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const addPunch = () => {
    if (!newPunch || !newPunch.latlng) return;
    if (!activeSub) {
      alert("Lütfen bir taşeron seçin.");
      return;
    }
    const key = newPunch.table_id || "__free__";
    const id = Date.now();
    const record = {
      id,
      table_id: key,
      isoX: newPunch.isoX ?? null,
      isoY: newPunch.isoY ?? null,
      note,
      photo,
      subcontractor: activeSub,
      latlng: Array.isArray(newPunch.latlng)
        ? newPunch.latlng
        : [newPunch.latlng.lat, newPunch.latlng.lng],
      date: Date.now(), // Yeni eklenen alan: Oluşturma tarihi
    };
    setPunches((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), record],
    }));
    setNewPunch(null);
    setNote("");
    setPhoto(null);
  };

  const deleteAllPunches = () => {
    const safeId = typeof selected === "string" ? selected : null;
    if (!safeId) return;
    if (!window.confirm(`${safeId} için TÜM punch'lar silinsin mi?`)) return;
    setPunches((prev) => {
      const updated = { ...prev };
      delete updated[safeId];
      return updated;
    });
    setSelected(null);
  };

  const deleteSelectedPunches = () => {
    if (totalSelectedPunch === 0) return;
    if (
      !window.confirm(
        `Toplam ${totalSelectedPunch} punch silinecek. Emin misiniz?`
      )
    )
      return;
    setPunches((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((tableId) => {
        next[tableId] = (prev[tableId] || []).filter(
          (p) => !multiSelected.has(p.id)
        );
        if (next[tableId].length === 0) delete next[tableId];
      });
      return next;
    });
    setMultiSelected(new Set());
    setSelected(null);
  };

  const saveEdit = () => {
    if (!editingPunch) return;
    setPunches((prev) => {
      const key = editingPunch.table_id || "__free__";
      return {
        ...prev,
        [key]: (prev[key] || []).map((p) =>
          p.id === editingPunch.id
            ? { ...p, note: editNote, photo: editPhoto }
            : p
        ),
      };
    });
    setEditingPunch(null);
    setEditNote("");
    setEditPhoto(null);
  };

  /* --- İzometrik seçili punch değişince görüntüyü stabilize et (opsiyonel) --- */
  useEffect(() => {
    if (selectedPunch && selectedPunch.table_id === safeTableId) {
      const img = isoImgRef.current;
      if (img) {
        // bazı tarayıcılarda hızlı layout için
        img.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedPunch, safeTableId]);

  /* -------------------- Yükleniyor / Ayarlar -------------------- */
  if (!points || !poly || !boundary)
    return (
      <div
        style={{
          background: "#111",
          color: "#fff",
          padding: 12,
          textAlign: "center",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        GeoJSON yükleniyor...
      </div>
    );

  if (showSettings)
    return (
      <div
        style={{
          background: "#0f1115",
          color: "#fff",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div
          style={{
            width: 620,
            maxWidth: "92vw",
            background: "#141821",
            border: "1px solid #232733",
            borderRadius: 14,
            padding: 18,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Taşeron Ayarları</h2>
          <p style={{ opacity: 0.85 }}>
            Taşeron ekleyin, isim ve rengini dilediğiniz zaman düzenleyin.
          </p>

          <div style={{ display: "flex", gap: 10 }}>
            <input
              type="text"
              placeholder="Taşeron Adı"
              value={newSub.name}
              onChange={(e) => setNewSub({ ...newSub, name: e.target.value })}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 8,
                border: "1px solid #2c3342",
                background: "#0f1320",
                color: "#fff",
              }}
            />
            <input
              type="color"
              value={newSub.color}
              onChange={(e) => setNewSub({ ...newSub, color: e.target.value })}
              style={{
                width: 54,
                height: 42,
                borderRadius: 8,
                border: "1px solid #2c3342",
              }}
            />
            <button
              onClick={() => {
                if (!newSub.name.trim()) return;
                if (
                  subcontractors.some(
                    (s) =>
                      s.name.trim().toLowerCase() ===
                      newSub.name.trim().toLowerCase()
                  )
                ) {
                  alert("Bu isimde taşeron var.");
                  return;
                }
                setSubcontractors([...subcontractors, newSub]);
                setNewSub({ name: "", color: "#3f8cff" });
              }}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "none",
                background: "#3f8cff",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + Ekle
            </button>
          </div>

          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            {subcontractors.map((s, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "#0f1320",
                  border: "1px solid #232733",
                  borderRadius: 10,
                  padding: "8px 10px",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="color"
                    value={s.color}
                    onChange={(e) => {
                      const updated = [...subcontractors];
                      updated[i].color = e.target.value;
                      setSubcontractors(updated);
                    }}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      border: "1px solid #444",
                      background: "#0f1320",
                    }}
                  />
                  <input
                    type="text"
                    value={s.name}
                    onChange={(e) => {
                      const updated = [...subcontractors];
                      updated[i].name = e.target.value;
                      setSubcontractors(updated);
                    }}
                    style={{
                      width: 200,
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "1px solid #333",
                      background: "#1a1f2a",
                      color: "#fff",
                    }}
                  />
                </div>
                <button
                  onClick={() => {
                    if (window.confirm(`${s.name} taşeronu silinsin mi?`)) {
                      const updated = subcontractors.filter(
                        (_, idx) => idx !== i
                      );
                      setSubcontractors(updated);
                    }
                  }}
                  style={{
                    border: "none",
                    background: "#f44336",
                    color: "#fff",
                    borderRadius: 6,
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
                >
                  🗑️
                </button>
              </div>
            ))}
            {subcontractors.length === 0 && (
              <div style={{ opacity: 0.7, fontStyle: "italic" }}>
                Henüz taşeron eklenmedi.
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 16,
            }}
          >
            <button
              onClick={() => setShowSettings(false)}
              disabled={subcontractors.length === 0}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #2c3342",
                background:
                  subcontractors.length === 0 ? "#2c3342" : "#1e2430",
                color: "#fff",
                fontWeight: 700,
                cursor: subcontractors.length === 0 ? "not-allowed" : "pointer",
                opacity: subcontractors.length === 0 ? 0.6 : 1,
              }}
            >
              Başla
            </button>
          </div>
        </div>
      </div>
    );

  /* -------------------- Harita + TopBar + Hover Label -------------------- */
  // const mapRef = useRef(null); // <-- Buradan yukarıya taşındı

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <TopBar />
      <HoverLabel hover={hover} />

      <MapContainer
        center={initialCenter}
        zoom={18}
        minZoom={14}
        maxZoom={22}
        style={{ height: "100%", width: "100%" }}
        whenCreated={(m) => (mapRef.current = m)}
        preferCanvas
        dragging={false} // sadece orta tuşla pan (MiddleMouseDrag ile)
        scrollWheelZoom={true}
        doubleClickZoom={true}
      >
        <MiddleMouseDrag />

        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <GeoJSON
          data={boundary}
          style={() => ({ color: "#2ecc71", weight: 2, opacity: 0.9, fillOpacity: 0 })}
        />

        {/* MASALAR: grup hover + tooltip + click */}
        <GeoJSON
          data={poly}
          style={(feature) => {
            const tid = getTableId(feature.properties);
            const isSelected = tid === safeTableId;
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

            if (!tidLayersRef.current[tid]) tidLayersRef.current[tid] = new Set();
            tidLayersRef.current[tid].add(layer);

            const baseStyle = (hovered) => {
              const isSelected = tid === safeTableId;
              const hasPunch = getPunchCount(punches, tid) > 0;
              if (hovered && !isSelected) {
                return {
                  color: "#6a85ff",
                  weight: 2.5,
                  fillOpacity: 0.15,
                  fillColor: "#6a85ff",
                };
              }
              return {
                color: isSelected ? "#6a85ff" : hasPunch ? "#d32f2f" : "#3b3f4b",
                weight: isSelected ? 3 : hasPunch ? 2.5 : 2,
                fillOpacity: isSelected ? 0.25 : hasPunch ? 0.12 : 0.08,
                fillColor: isSelected ? "#6a85ff" : hasPunch ? "#d32f2f" : "#666",
              };
            };

            // Tooltip
            const tooltipContent = `
              <div style="font-weight:700; font-size:14px;">${tid}</div>
              <div style="font-size:12px; opacity:0.9; margin-top:2px;">Punch: <strong>${getPunchCount(
                punches,
                tid
              )}</strong></div>
            `;
            layer.bindTooltip(tooltipContent, {
              permanent: false,
              direction: "top",
              className: "leaflet-tooltip-custom",
              offset: [0, -10],
            });

            layer.on("mouseover", () => {
              // grup highlight
              const set = tidLayersRef.current[tid] || new Set();
              set.forEach((l) => l.setStyle(baseStyle(true)));
              layer.openTooltip();

              // hover label pozisyonu (masa centroid ekran koordinatı)
              const c = centroid(feature).geometry.coordinates; // [lng, lat]
              if (mapRef.current) {
                const p = mapRef.current.latLngToContainerPoint({
                  lat: c[1],
                  lng: c[0],
                });
                setHover({ id: tid, x: `${p.x}px`, y: `${p.y}px` });
              }
            });
            layer.on("mouseout", () => {
              const set = tidLayersRef.current[tid] || new Set();
              set.forEach((l) => l.setStyle(baseStyle(false)));
              layer.closeTooltip();
              setHover(null);
            });

            layer.on("click", (e) => {
              if (e.originalEvent.button !== 0 || e.target.dragging?.enabled())
                return;
              L.DomEvent.stopPropagation(e);
              setSelected(tid);
              setMultiSelected(new Set());
              setSelectedPunch(null);
              setNewPunch(null);
            });
          }}
        />

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

        <PunchLayer
          punches={punches}
          polyGeoJSON={poly}
          setSelectedPunch={setSelectedPunch}
          safeTableId={safeTableId}
          multiSelectedPunches={multiSelected}
          subcontractors={subcontractors}
          activeFilter={activeFilter}
        />

        <BoxSelectionOverlay
          startPoint={selectionBox?.start}
          endPoint={selectionBox?.end}
        />
      </MapContainer>

      {/* -------- SAĞ PANEL (İzometrik + Punch form) -------- */}
      {safeTableId && (
        <div className="panel" style={{ width: "360px", position: "absolute", right: 0, top: 0, bottom: 0 }}>
          <h3 style={{ marginBottom: 8 }}>
            <span style={{ color: "#6a85ff" }}>İzometrik</span> — {safeTableId}
          </h3>

          {/* Taşeron seçimi */}
          <div style={{ width: "90%", display: "flex", gap: 8, margin: "6px 0" }}>
            <label style={{ fontSize: 13, opacity: 0.9, minWidth: 85 }}>Taşeron:</label>
            <select
              value={activeSub}
              onChange={(e) => setActiveSub(e.target.value)}
              style={{
                flex: 1,
                padding: 8,
                borderRadius: 8,
                border: "1px solid #333",
                background: "#222",
                color: "#fff",
              }}
            >
              <option value="">Seçiniz…</option>
              {subcontractors.map((s, i) => (
                <option key={i} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* İzometrik alan: pan (orta tuş) + zoom (scroll) */}
          <div
            ref={isoWrapRef}
            className="iso-container"
            onWheel={handleIsoStageWheel}
            onMouseDown={handleIsoStageMouseDown}
            style={{ width: "90%", borderRadius: 12, marginBottom: 8, position: "relative", overflow: "hidden" }}
          >
            <div
              ref={isoStageRef}
              style={{
                position: "relative",
                width: "100%",
                height: "auto",
                transform: `translate(${isoOffset.x}px, ${isoOffset.y}px) scale(${isoZoom})`,
                transformOrigin: "center center",
              }}
              onClick={onIsoClick}
            >
              <img
                ref={isoImgRef}
                src="/photos/table_iso.png"
                alt="Isometric"
                style={{ width: "100%", display: "block", borderRadius: 12, cursor: "crosshair" }}
              />

              {/* İzometrik üstünde punch noktaları (filtreye uyar) */}
              {(punches[safeTableId] || [])
                .filter((p) => (activeFilter ? p.subcontractor === activeFilter : true))
                .map((p) => {
                  const color =
                    subcontractors.find((s) => s.name === p.subcontractor)?.color || "#f00";
                  const isActive = selectedPunch?.id === p.id;
                  return (
                    <div
                      key={p.id}
                      title={p.note || "Punch"}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPunch((prev) =>
                          prev?.id === p.id ? null : { ...p, table_id: safeTableId }
                        );
                      }}
                      style={{
                        position: "absolute",
                        left: `${p.isoX}%`,
                        top: `${p.isoY}%`,
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background: color,
                        transform: "translate(-50%, -50%)",
                        border: "2px solid #fff",
                        boxShadow: "0 0 3px rgba(0,0,0,0.4)",
                        cursor: "pointer",
                        zIndex: 10,
                        opacity: isActive ? 1 : 0.9,
                      }}
                    />
                  );
                })}

              {/* İzometrik popup — panel sınırlarına taşmadan */}
              {selectedPunch &&
                selectedPunch.table_id === safeTableId &&
                (() => {
                  const wrap = isoWrapRef.current;
                  const img = isoImgRef.current;
                  if (!wrap || !img) return null;

                  const imgRect = img.getBoundingClientRect();
                  const wrapRect = wrap.getBoundingClientRect();

                  const popupWidth = 280;
                  const popupHeight = 220;
                  const margin = 8;

                  const targetLeftAbs = imgRect.left + (selectedPunch.isoX / 100) * imgRect.width;
                  const targetTopAbs = imgRect.top + (selectedPunch.isoY / 100) * imgRect.height;

                  const minLeftAbs = wrapRect.left + margin + popupWidth / 2;
                  const maxLeftAbs = wrapRect.right - margin - popupWidth / 2;
                  const minTopAbs = wrapRect.top + margin + 40;
                  const maxTopAbs = wrapRect.bottom - margin - popupHeight;

                  const clampedLeftAbs = Math.max(minLeftAbs, Math.min(maxLeftAbs, targetLeftAbs));
                  let topAbs = targetTopAbs - popupHeight - 16;
                  if (topAbs < minTopAbs) topAbs = Math.min(maxTopAbs, targetTopAbs + 16);

                  // absolute pozisyon için wrap göreli koordinatlar
                  const leftRel = clampedLeftAbs - wrapRect.left;
                  const topRel = topAbs - wrapRect.top;

                  return (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: "absolute",
                        left: leftRel,
                        top: topRel,
                        transform: `translateX(-50%) scale(${1 / isoZoom})`, // DÜZELTME: Ters ölçekleme uygulandı
                        transformOrigin: "center bottom", // DÜZELTME: Ölçek merkezini ayarladık
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
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 10,
                        }}
                      >
                        <strong style={{ color: "#ffb74d" }}>Punch Detay</strong>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPunch(null);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#fff",
                            fontSize: 18,
                            cursor: "pointer",
                          }}
                        >
                          ×
                        </button>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            background:
                              subcontractors.find((s) => s.name === selectedPunch.subcontractor)?.color ||
                              "#f00",
                            border: "2px solid #fff",
                          }}
                        />
                        <div style={{ fontSize: 12.5, opacity: 0.9 }}>
                          Taşeron: <b>{selectedPunch.subcontractor || "-"}</b>
                        </div>
                      </div>
                      {selectedPunch.photo && (
                        <img
                          src={selectedPunch.photo}
                          alt="Punch"
                          style={{ width: "100%", borderRadius: 8, margin: "6px 0", display: "block" }}
                        />
                      )}
                      <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>
                        {selectedPunch.note?.trim() ? (
                          selectedPunch.note
                        ) : (
                          <i style={{ opacity: 0.6 }}>(Not yok)</i>
                        )}
                      </div>
                      <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(selectedPunch);
                            setSelectedPunch(null);
                          }}
                          style={{
                            background: "linear-gradient(135deg, #ffb74d, #ff9800)",
                            color: "#111",
                            border: "none",
                            padding: "6px 12px",
                            borderRadius: 10,
                            fontSize: 12,
                            cursor: "pointer",
                            fontWeight: 800,
                          }}
                        >
                          Düzenle
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm("Bu punch silinsin mi?")) {
                              setPunches((prev) => ({
                                ...prev,
                                [safeTableId]: (prev[safeTableId] || []).filter(
                                  (p) => p.id !== selectedPunch.id
                                ),
                              }));
                              setSelectedPunch(null);
                            }
                          }}
                          style={{
                            background: "linear-gradient(135deg, #ef5350, #e53935)",
                            color: "#fff",
                            border: "none",
                            padding: "6px 12px",
                            borderRadius: 10,
                            fontSize: 12,
                            cursor: "pointer",
                            fontWeight: 800,
                          }}
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  );
                })()}
            </div>
          </div>

          {/* Yeni Punch formu (izometrikte tıklayınca açılır) */}
          {newPunch && newPunch.table_id === safeTableId && (
            <div
              style={{
                width: "90%",
                textAlign: "center",
                marginTop: 8,
                padding: 10,
                border: "1px dashed #6a85ff",
                borderRadius: 8,
                background: "#222",
              }}
            >
              <h4 style={{ color: "#6a85ff", margin: "4px 0 8px" }}>
                Yeni Punch Ekle
              </h4>
              <div
                style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
              >
                <label style={{ fontSize: 13, opacity: 0.9, minWidth: 85 }}>
                  Taşeron:
                </label>
                <select
                  value={activeSub}
                  onChange={(e) => setActiveSub(e.target.value)}
                  style={{
                    flex: 1,
                    padding: 8,
                    borderRadius: 8,
                    border: "1px solid #333",
                    background: "#111",
                    color: "#fff",
                  }}
                >
                  <option value="">Seçiniz…</option>
                  {subcontractors.map((s, i) => (
                    <option key={i} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                placeholder="Not (opsiyonel)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: 60,
                  margin: "6px 0",
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid #444",
                  background: "#111",
                  color: "#fff",
                  resize: "vertical",
                }}
              />
              <input
                type="file"
                accept="image/*"
                onChange={onPhoto}
                style={{ display: "block", margin: "6px auto" }}
              />
              {photo && (
                <img
                  src={photo}
                  alt="preview"
                  style={{
                    width: "50%",
                    margin: "8px auto",
                    borderRadius: 8,
                    display: "block",
                  }}
                />
              )}
              <div
                style={{ marginTop: 8, display: "flex", justifyContent: "center", gap: 10 }}
              >
                <button
                  className="btn btn-green"
                  onClick={addPunch}
                  style={{ padding: "8px 12px" }}
                >
                  Punch Ekle
                </button>
                <button
                  className="btn btn-red"
                  onClick={() => {
                    setNewPunch(null);
                    setNote("");
                    setPhoto(null);
                  }}
                  style={{ padding: "8px 12px" }}
                >
                  İptal
                </button>
              </div>
            </div>
          )}

          <div style={{ width: "90%", marginTop: 12, display: "flex", justifyContent: "space-between" }}>
            {(punches[safeTableId]?.length ?? 0) > 0 && (
              <button className="btn btn-red" onClick={() => { setSelectedPunch(null); deleteAllPunches(); }}>
                Tüm Punchları Sil ({punches[safeTableId].length})
              </button>
            )}
            <button
              className="btn btn-gray"
              onClick={() => {
                setSelectedPunch(null);
                setSelected(null);
              }}
              style={{ width: "auto" }}
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* -------- Serbest Punch Formu (boundary içinde masa dışı) -------- */}
      {newPunch && newPunch.table_id === "__free__" && (
        <div
          onClick={() => {
            setNewPunch(null);
            setNote("");
            setPhoto(null);
          }}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 1600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 420,
              maxWidth: "92vw",
              background: "#111",
              border: "1px solid #333",
              borderRadius: 12,
              padding: 16,
              color: "#fff",
              boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                fontWeight: 700,
                marginBottom: 10,
                fontSize: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>Yeni Punch (Masa Dışı)</span>
              <button
                onClick={() => {
                  setNewPunch(null);
                  setNote("");
                  setPhoto(null);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fff",
                  fontSize: 18,
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 13, opacity: 0.9, minWidth: 85 }}>Taşeron:</label>
              <select
                value={activeSub}
                onChange={(e) => setActiveSub(e.target.value)}
                style={{
                  flex: 1,
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #333",
                  background: "#222",
                  color: "#fff",
                }}
              >
                <option value="">Seçiniz…</option>
                {subcontractors.map((s, i) => (
                  <option key={i} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              placeholder="Not (opsiyonel)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{
                width: "100%",
                minHeight: 60,
                margin: "6px 0",
                padding: 8,
                borderRadius: 6,
                border: "1px solid #444",
                background: "#222",
                color: "#fff",
                resize: "vertical",
              }}
            />
            <input
              type="file"
              accept="image/*"
              onChange={onPhoto}
              style={{ display: "block", margin: "6px 0" }}
            />
            {photo && (
              <img
                src={photo}
                alt="preview"
                style={{ width: "100%", margin: "8px 0", borderRadius: 8, display: "block" }}
              />
            )}

            <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="btn btn-gray"
                onClick={() => {
                  setNewPunch(null);
                  setNote("");
                  setPhoto(null);
                }}
                style={{ width: "auto" }}
              >
                İptal
              </button>
              <button className="btn btn-green" onClick={addPunch} style={{ width: "auto" }}>
                Punch Ekle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* -------- Edit Modal -------- */}
      {editingPunch && (
        <div
          onClick={() => setEditingPunch(null)}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#111",
              color: "#fff",
              padding: 20,
              width: 420,
              maxWidth: "90vw",
              borderRadius: 12,
              boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
              border: "1px solid #333",
            }}
          >
            <h4
              style={{
                borderBottom: "1px solid #333",
                paddingBottom: 10,
                marginBottom: 15,
                color: "#ff9800",
              }}
            >
              Punch Düzenle ({editingPunch.table_id})
            </h4>
            <textarea
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Not..."
              style={{
                width: "100%",
                minHeight: 80,
                margin: "6px 0",
                padding: 8,
                borderRadius: 6,
                border: "1px solid #444",
                background: "#222",
                color: "#fff",
                resize: "vertical",
              }}
            />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onloadend = () => setEditPhoto(reader.result);
                  reader.readAsDataURL(file);
                }
              }}
              style={{ display: "block", margin: "6px 0" }}
            />
            {editPhoto && (
              <img
                src={editPhoto}
                alt="preview"
                style={{ width: "100%", margin: "8px 0", borderRadius: 8, display: "block" }}
              />
            )}

            <div style={{ marginTop: 15, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-gray" onClick={() => setEditingPunch(null)} style={{ width: "auto" }}>
                İptal
              </button>
              <button
                onClick={saveEdit}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  background: "#ff9800",
                  color: "#111",
                  fontWeight: 800,
                }}
              >
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}