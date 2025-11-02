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
import { point } from "@turf/turf";

// Lütfen bu yolların projenizde doğru olduğundan emin olun!
import tablesPolyUrl from "/tables_poly.geojson?url";
import tablesPointsUrl from "/tables_points.geojson?url";
import siteBoundaryUrl from "/site_boundary.geojson?url";

/* -------------------- YARDIMCI FONKSİYONLAR -------------------- */
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
    if (typeof val === "string" && /^R\d{1,3}_T\d{1,3}$/i.test(val.trim())) {
      return val.trim().toUpperCase();
    }
  }
  for (const key in props) {
    const val = props[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

function getPunchCount(punches, tableId) {
  return (punches[tableId] || []).length;
}

function getSafeCenter(geojson) {
  try {
    const feats = geojson?.features || [];
    let sx = 0, sy = 0, n = 0;
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
    // Başlangıç merkezi için sırasıyla [lat, lon]
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
    const lat = sw.lat + Math.random() * (ne.lat - sw.lat);
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

/* -------------------- KUTU SEÇİM OVERLAY -------------------- */
function BoxSelectionOverlay({ startPoint, endPoint }) {
  if (!startPoint || !endPoint) return null;
  const style = {
    position: "absolute",
    border: "2px dashed #00bcd4",
    background: "rgba(0,188,212,0.1)",
    pointerEvents: "none",
    zIndex: 1400,
    left: Math.min(startPoint.x, endPoint.x),
    top: Math.min(startPoint.y, endPoint.y),
    width: Math.abs(startPoint.x - endPoint.x),
    height: Math.abs(startPoint.y - endPoint.y),
  };
  return <div className="selection-box" style={style} />;
}

/* -------------------- SAĞ TIK UNSELECT (Punch bazlı) -------------------- */
function RightClickUnselect({ poly, punches, multiSelectedPunches, setMultiSelected, setSelected }) {
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

/* -------------------- PUNCH LAYER (Taşeron renkleri eklendi) -------------------- */
function PunchLayer({ punches, polyGeoJSON, setSelectedPunch, safeTableId, multiSelectedPunches, subcontractors }) {
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

    const subColorOf = (name) =>
      subcontractors.find((s) => s.name === name)?.color || "#f00";

    const areTablePunchesInteractive = !safeTableId;

    Object.keys(punches).forEach((tid) => {
      const list = punches[tid] || [];
      list.forEach((p) => {
        if (!p.latlng) {
          if (tid !== "__free__" && polyIndexRef.current[tid]) {
            if (!punchLocationsRef.current[p.id]) {
              punchLocationsRef.current[p.id] = generatePointInsidePolygon(polyIndexRef.current[tid]);
            }
            p.latlng = punchLocationsRef.current[p.id];
          } else {
            return;
          }
        }

        const isSelected = multiSelectedPunches.has(p.id);
        const fillColor = subColorOf(p.subcontractor);

        const marker = L.circleMarker(p.latlng, {
          radius: isSelected ? 9 : 6,
          color: isSelected ? "#00FFFF" : "#fff",
          weight: isSelected ? 2.5 : 1.5,
          fillColor,
          fillOpacity: 1,
          className: tid === "__free__" ? "punch-marker free-punch-marker" : "punch-marker",
          pane: "markerPane",
          zIndexOffset: isSelected ? 1500 : 1000,
        }).addTo(layer);

        if (tid === "__free__") {
          const popupHTML = `
            <div style="font-family:sans-serif;min-width:180px;">
              <b style="color:#ff9800;">Serbest Punch</b>
              <div style="font-size:12px;margin:4px 0;opacity:.9">Taşeron: <b>${p.subcontractor || "-"}</b></div>
              ${p.photo ? `<img src="${p.photo}" style="width:100%;border-radius:6px;margin:6px 0;display:block;" />` : ""}
              <div style="font-size:13px;margin-top:6px;white-space:pre-wrap;">
                ${p.note?.trim() ? p.note : '<i style="opacity:0.6;">(Not yok)</i>'}
              </div>
              <div style="margin-top:10px;display:flex;gap:6px;justify-content:flex-end;">
                <button onclick="window.editFreePunch(${p.id})"
                        style="background:#ff9800;color:#fff;border:none;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;">
                  Düzenle
                </button>
                <button onclick="window.deleteFreePunch(${p.id})"
                        style="background:#f44336;color:#fff;border:none;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;">
                  Sil
                </button>
              </div>
            </div>
          `;
          marker.bindPopup(popupHTML, { maxWidth: 260, className: "custom-punch-popup" });

          const hitArea = L.circle(p.latlng, {
            radius: 25, fill: false, stroke: false, interactive: true, pointerEvents: "all",
            className: "punch-hit-area",
          }).addTo(layer);
          hitArea.on("click", (e) => { L.DomEvent.stopPropagation(e); marker.openPopup(); });
        } else if (areTablePunchesInteractive) {
          const hitArea = L.circle(p.latlng, {
            radius: 20, fill: false, stroke: false, interactive: true, pointerEvents: "all",
            className: "punch-hit-area",
          }).addTo(layer);
          hitArea.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            setSelectedPunch({ ...p, table_id: tid });
          });
        }

        marker.on("mouseover", () => {
          marker.setStyle({ radius: 10, zIndexOffset: 2000 });
        });
        marker.on("mouseout", () => {
          marker.setStyle({ radius: isSelected ? 9 : 6, zIndexOffset: isSelected ? 1500 : 1000 });
        });
      });
    });
  }, [punches, safeTableId, multiSelectedPunches, subcontractors]);

  return null;
}

/* -------------------- SEÇİM KONTROL (kutu + tıklama) -------------------- */
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
  const clickStartTime = useRef(0);
  const clickStartCoords = useRef(null);
  const clickStartLatLng = useRef(null);

  useMapEvents({
    mousedown: (e) => {
      if (e.originalEvent.button !== 0) return;

      map.dragging.disable();

      isDragging.current = true;
      setIsSelecting(true);
      clickStartTime.current = Date.now();

      clickStartCoords.current = { x: e.originalEvent.clientX, y: e.originalEvent.clientY };
      clickStartLatLng.current = e.latlng;

      setSelectionBox({
        start: { x: e.originalEvent.clientX, y: e.originalEvent.clientY },
        end: { x: e.originalEvent.clientX, y: e.originalEvent.clientY },
      });

      if (!e.originalEvent.ctrlKey && !e.originalEvent.metaKey) {
        setMultiSelected(new Set());
      }
    },

    mousemove: (e) => {
      if (!isSelecting || !isDragging.current || !clickStartCoords.current) return;

      setSelectionBox({
        start: clickStartCoords.current,
        end: { x: e.originalEvent.clientX, y: e.originalEvent.clientY },
      });

      const screenMoveDistance = Math.hypot(
        clickStartCoords.current.x - e.originalEvent.clientX,
        clickStartCoords.current.y - e.originalEvent.clientY
      );
      const moved = screenMoveDistance > 5;

      if (moved) {
        L.DomEvent.stopPropagation(e);

        const startLatLng = clickStartLatLng.current;
        const endLatLng = e.latlng;

        const minLat = Math.min(startLatLng.lat, endLatLng.lat);
        const maxLat = Math.max(startLatLng.lat, endLatLng.lat);
        const minLng = Math.min(startLatLng.lng, endLatLng.lng);
        const maxLng = Math.max(startLatLng.lng, endLatLng.lng);

        const isAdditive = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
        const initialSelected = isAdditive ? multiSelected : new Set();
        const newSelectedPunches = new Set(initialSelected);

        Object.values(punches).flat().forEach((punch) => {
          if (!punch.latlng) return;
          const [lat, lng] = punch.latlng;
          if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
            newSelectedPunches.add(punch.id);
          } else if (!isAdditive && initialSelected.has(punch.id)) {
            newSelectedPunches.delete(punch.id);
          }
        });

        setMultiSelected(newSelectedPunches);
      }
    },

    mouseup: (e) => {
      if (e.originalEvent.button !== 0) return;

      map.dragging.enable();

      const duration = Date.now() - clickStartTime.current;
      const screenMoveDistance = clickStartCoords.current
        ? Math.hypot(clickStartCoords.current.x - e.originalEvent.clientX, clickStartCoords.current.y - e.originalEvent.clientY)
        : 0;
      const DRAG_THRESHOLD = 8;
      const moved = screenMoveDistance > DRAG_THRESHOLD;

      setSelectionBox(null);
      isDragging.current = false;
      setIsSelecting(false);

      if (moved) {
        L.DomEvent.stopPropagation(e);
        setJustDragged(true);
        setTimeout(() => setJustDragged(false), 50);
        return;
      }

      if (duration < 250) {
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
      }
    },
  });
  return null;
}

/* -------------------- BOUNDARY İÇİ MASA DIŞI TIK (free punch) -------------------- */
function BoundaryFreePunchClick({ poly, boundary, isSelecting, setSelected, setSelectedPunch, setNewPunch, justDragged }) {
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
      const feats = boundary?.features || [];
      for (const f of feats) {
        if (booleanPointInPolygon(pt, f)) {
          insideBoundary = true;
          break;
        }
      }
      if (!insideBoundary) return;

      setSelected(null);
      setSelectedPunch(null);
      setNewPunch({ table_id: "__free__", latlng: [latlng.lat, latlng.lng] });
    },
  });
  return null;
}

/* -------------------- GLOBAL FONKSİYONLAR -------------------- */
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
  if (punch && currentStartEdit) {
    currentStartEdit({ ...punch, table_id: "__free__" });
  }
};

/* -------------------- ANA COMPONENT -------------------- */
export default function App() {
  const [poly, setPoly] = useState(null);
  const [points, setPoints] = useState(null);
  const [boundary, setBoundary] = useState(null);

  const [punches, setPunches] = useState({});
  const [selected, setSelected] = useState(null); // Tekli masa seçimi (izometrik için)
  const [newPunch, setNewPunch] = useState(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);

  // Çoklu punch seçimi
  const [multiSelected, setMultiSelected] = useState(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState(null);
  const [justDragged, setJustDragged] = useState(false);

  const isoRef = useRef(null);
  const [isoLoaded, setIsoLoaded] = useState(false);
  const [isoError, setIsoError] = useState(false);

  const [selectedPunch, setSelectedPunch] = useState(null); // İzometrikte tıklanan punch

  // Edit
  const [editingPunch, setEditingPunch] = useState(null);
  const [editNote, setEditNote] = useState("");
  const [editPhoto, setEditPhoto] = useState(null);

  // --- Taşeron Sistemi ---
  const [subcontractors, setSubcontractors] = useState([]);
  const [newSub, setNewSub] = useState({ name: "", color: "#3f8cff" });
  const [showSettings, setShowSettings] = useState(false);
  const [activeSub, setActiveSub] = useState(""); // Punch eklerken seçilecek

  // Global referanslar
  useEffect(() => {
    currentPunches = punches;
    currentSetPunches = setPunches;
  }, [punches, setPunches]);

  const startEdit = (punch) => {
    setEditingPunch(punch);
    setEditNote(punch.note || "");
    setEditPhoto(punch.photo || null);
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
      } catch (err) {
        console.warn(`Warning: ${name} yüklenemedi:`, err.message);
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

  // localStorage (punch + subcontractors)
  useEffect(() => {
    const s = localStorage.getItem("punches");
    if (s) setPunches(JSON.parse(s));
    const subs = localStorage.getItem("subcontractors");
    if (subs) {
      const parsed = JSON.parse(subs);
      setSubcontractors(parsed);
      setShowSettings(parsed.length === 0); // boşsa ayar aç
    } else {
      setShowSettings(true);
    }
  }, []);
  useEffect(() => {
    localStorage.setItem("punches", JSON.stringify(punches));
  }, [punches]);
  useEffect(() => {
    localStorage.setItem("subcontractors", JSON.stringify(subcontractors));
  }, [subcontractors]);

  const initialCenter = useMemo(() => getSafeCenter(points), [points]);
  const safeTableId = typeof selected === "string" ? selected : null;

  // SAYAÇLAR
  const totalSelectedPunch = multiSelected.size; // Seçili punch adedi
  const selectedTablesByPunch = useMemo(() => {
    const tableIds = new Set();
    if (totalSelectedPunch > 0) {
      Object.keys(punches).forEach((tableId) => {
        (punches[tableId] || []).forEach((p) => {
          if (multiSelected.has(p.id)) tableIds.add(tableId);
        });
      });
    }
    return tableIds;
  }, [multiSelected, punches, totalSelectedPunch]);

  // İzometrik tıklama → yeni punch
  const onIsoClick = (e) => {
    if (!isoRef.current || !isoLoaded || isoError || !safeTableId) return;
    if (selectedPunch) {
      setSelectedPunch(null);
      return;
    }
    const rect = isoRef.current.getBoundingClientRect();
    const isoX = ((e.clientX - rect.left) / rect.width) * 100;
    const isoY = ((e.clientY - rect.top) / rect.height) * 100;

    const polyFeature = poly?.features.find((f) => getTableId(f.properties) === safeTableId);
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
      latlng: Array.isArray(newPunch.latlng) ? newPunch.latlng : [newPunch.latlng.lat, newPunch.latlng.lng],
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
    if (!window.confirm(`${safeId} için TÜM punch'lar silinecek. Emin misin?`)) return;
    setPunches((prev) => {
      const updated = { ...prev };
      delete updated[safeId];
      return updated;
    });
    setSelected(null);
  };

  // Seçilen punch'ları toplu sil
  const deleteSelectedPunches = () => {
    if (totalSelectedPunch === 0) return;
    if (!window.confirm(`Toplam ${totalSelectedPunch} punch silinecek. Emin misiniz?`)) return;

    setPunches((prevPunches) => {
      const nextPunches = { ...prevPunches };
      Object.keys(nextPunches).forEach((tableId) => {
        nextPunches[tableId] = (nextPunches[tableId] || []).filter((punch) => !multiSelected.has(punch.id));
        if (nextPunches[tableId].length === 0) delete nextPunches[tableId];
      });
      return nextPunches;
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
        [key]: (prev[key] || []).map((p) => (p.id === editingPunch.id ? { ...p, note: editNote, photo: editPhoto } : p)),
      };
    });
    setEditingPunch(null);
    setEditNote("");
    setEditPhoto(null);
  };

  // --- Taşeron Ekranı ---
  const addSubcontractor = () => {
    if (!newSub.name.trim()) return;
    if (subcontractors.some((s) => s.name.trim().toLowerCase() === newSub.name.trim().toLowerCase())) {
      alert("Bu isimde bir taşeron zaten var.");
      return;
    }
    setSubcontractors((prev) => [...prev, newSub]);
    setNewSub({ name: "", color: "#3f8cff" });
  };

  if (!points || !poly || !boundary) {
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
        <b>GeoJSON yükleniyor...</b>
      </div>
    );
  }

  // İlk kurulum veya Ayarlar açıkken
  if (showSettings) {
    return (
      <div
        style={{
          background: "#0f1115",
          color: "#fff",
          minHeight: "100vh",
          padding: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 520,
            maxWidth: "92vw",
            background: "#141821",
            border: "1px solid #232733",
            borderRadius: 14,
            padding: 18,
            boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
          }}
        >
          <h2 style={{ margin: 0, marginBottom: 10 }}>Taşeron Ayarları</h2>
          <p style={{ opacity: 0.85, marginTop: 0 }}>
            İstediğin kadar taşeron ekle. Her biri bir <b>isim</b> ve <b>renkle</b> kaydedilir.
          </p>

          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
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
              title="Renk seç"
              style={{ width: 54, height: 42, borderRadius: 8, border: "1px solid #2c3342", background: "#0f1320" }}
            />
            <button
              onClick={addSubcontractor}
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
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 14, height: 14, borderRadius: "50%", display: "inline-block", background: s.color, border: "2px solid #fff" }} />
                  <b>{s.name}</b>
                </div>
                <span style={{ fontSize: 12, opacity: 0.8 }}>{s.color}</span>
              </div>
            ))}
            {subcontractors.length === 0 && (
              <div style={{ opacity: 0.7, fontStyle: "italic", fontSize: 14 }}>Henüz taşeron eklenmedi.</div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button
              onClick={() => setShowSettings(false)}
              disabled={subcontractors.length === 0}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #2c3342",
                background: subcontractors.length === 0 ? "#2c3342" : "#1e2430",
                color: "#fff",
                fontWeight: 700,
                cursor: subcontractors.length === 0 ? "not-allowed" : "pointer",
                opacity: subcontractors.length === 0 ? 0.6 : 1,
              }}
              title={subcontractors.length === 0 ? "En az bir taşeron ekleyin" : "Başla"}
            >
              Başla
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Legend: sağ üst köşe
  const Legend = () => (
    <div
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        background: "rgba(25,25,30,0.92)",
        color: "#fff",
        padding: "10px 12px",
        borderRadius: 10,
        zIndex: 1600,
        boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
        minWidth: 180,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, opacity: 0.9 }}>Taşeron Legend</div>
      <div style={{ display: "grid", gap: 6 }}>
        {subcontractors.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                display: "inline-block",
                background: s.color,
                border: "2px solid #fff",
              }}
            />
            <span style={{ fontSize: 13 }}>{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // Seçim sayaç + toplu silme (sol üst)
  const SelectionCounter = () => (
    <div
      className="selection-counter"
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        background: "rgba(25, 25, 30, 0.92)",
        color: "#fff",
        padding: "8px 12px",
        borderRadius: 10,
        zIndex: 1600,
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
      }}
    >
      <span>Seçili: <strong>{selectedTablesByPunch.size}</strong> masa</span>
      <span>Toplam Punch: <strong>{totalSelectedPunch}</strong></span>
      {totalSelectedPunch > 0 && (
        <button
          onClick={deleteSelectedPunches}
          style={{
            padding: "4px 10px",
            cursor: "pointer",
            background: "#f44336",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontWeight: "bold",
          }}
        >
          Seçilenleri Sil
        </button>
      )}
    </div>
  );

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <SelectionCounter />
      <Legend />

      {/* Ayarlar butonu (sol alt) */}
      <button
        onClick={() => setShowSettings(true)}
        style={{
          position: "absolute",
          left: 10,
          bottom: 10,
          zIndex: 1600,
          background: "#1e2430",
          color: "#fff",
          border: "1px solid #2c3342",
          borderRadius: 10,
          padding: "8px 12px",
          cursor: "pointer",
        }}
      >
        ⚙️ Ayarlar
      </button>

      <MapContainer
        center={initialCenter}
        zoom={18}
        minZoom={14}
        maxZoom={22}
        style={{ height: "100%", width: "100%" }}
        preferCanvas
        dragging={true}
        scrollWheelZoom={true}
        doubleClickZoom={true}
      >
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

        <GeoJSON
          data={poly}
          style={(feature) => {
            const tid = getTableId(feature.properties);
            const isSelected = tid === safeTableId;
            const hasPunch = getPunchCount(punches, tid) > 0;
            return {
              color: isSelected ? "#007bff" : hasPunch ? "#d32f2f" : "#333",
              weight: isSelected ? 3 : hasPunch ? 2.5 : 2,
              opacity: 1,
              fillOpacity: isSelected ? 0.25 : hasPunch ? 0.15 : 0.1,
              fillColor: isSelected ? "#007bff" : hasPunch ? "#d32f2f" : "#666",
            };
          }}
          onEachFeature={(feature, layer) => {
            const tid = getTableId(feature.properties);
            if (!tid) return;
            const punchCount = getPunchCount(punches, tid);
            const tooltipContent = `
              <div style="font-weight:600; font-size:14px;">${tid}</div>
              <div style="font-size:12px; opacity:0.9; margin-top:2px;">Punch: <strong>${punchCount}</strong></div>
            `;
            layer.bindTooltip(tooltipContent, {
              permanent: false,
              direction: "top",
              className: "leaflet-tooltip-custom",
              offset: [0, -10],
            });
            layer.on("mouseover", () => layer.openTooltip());
            layer.on("mouseout", () => layer.closeTooltip());

            // Masa Tıklaması: paneli aç
            layer.on("click", (e) => {
              if (e.originalEvent.button !== 0 || e.target.dragging?.enabled()) return;
              L.DomEvent.stopPropagation(e);
              setSelected(tid);
              setMultiSelected(new Set());
              setSelectedPunch(null);
              setNewPunch(null);
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
        />

        {/* Kutu seçim overlay */}
        <BoxSelectionOverlay startPoint={selectionBox?.start} endPoint={selectionBox?.end} />
      </MapContainer>

      {/* --- İZOMETRİK PANEL --- */}
      {safeTableId && (
        <div
          className="panel"
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            width: 360,
            height: "100%",
            background: "#222",
            zIndex: 1500,
            padding: 16,
            color: "#fff",
            boxShadow: "-4px 0 10px rgba(0,0,0,0.5)",
            overflowY: "auto",
          }}
        >
          <h3 style={{ borderBottom: "2px solid #333", paddingBottom: 10, marginBottom: 15 }}>
            <span style={{ color: "#007bff" }}>Masa:</span> {safeTableId}
          </h3>

          {/* Aktif taşeron seçimi */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <label style={{ fontSize: 13, opacity: 0.9, minWidth: 95 }}>Taşeron:</label>
            <select
              value={activeSub}
              onChange={(e) => setActiveSub(e.target.value)}
              style={{
                flex: 1,
                padding: 8,
                borderRadius: 8,
                border: "1px solid #444",
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

          <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
            <img
              ref={isoRef}
              src="/photos/table_iso.png"
              alt="Isometric"
              onLoad={() => setIsoLoaded(true)}
              onError={() => setIsoError(true)}
              onClick={onIsoClick}
              style={{
                cursor: isoLoaded && !isoError ? "crosshair" : "default",
                width: "90%",
                borderRadius: 10,
                opacity: isoError ? 0.4 : 1,
              }}
            />

            {isoError && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  color: "#f44336",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
                İzometrik resim yüklenemedi!
              </div>
            )}

            {/* İzometrik üzerindeki punch noktaları (renkler taşerondan) */}
            {(punches[safeTableId] || []).map((p) => {
              const color =
                subcontractors.find((s) => s.name === p.subcontractor)?.color || "#f00";
              const isActive = selectedPunch?.id === p.id;
              return (
                <div
                  key={p.id}
                  role="button"
                  title={p.note || "Punch"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPunch((prev) => (prev?.id === p.id ? null : p));
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translate(-50%, -50%) scale(1.6)";
                    e.currentTarget.style.boxShadow = "0 0 12px rgba(0,0,0,0.7)";
                    e.currentTarget.style.zIndex = "20";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translate(-50%, -50%) scale(1)";
                    e.currentTarget.style.boxShadow = "0 0 3px rgba(0,0,0,0.4)";
                    e.currentTarget.style.zIndex = "10";
                  }}
                  style={{
                    position: "absolute",
                    left: `${p.isoX}%`,
                    top: `${p.isoY}%`,
                    width: 12,
                    height: 12,
                    background: color,
                    borderRadius: "50%",
                    transform: "translate(-50%, -50%)",
                    border: "2px solid #fff",
                    boxShadow: "0 0 3px rgba(0,0,0,0.4)",
                    cursor: "pointer",
                    zIndex: 10,
                    transition: "all 0.2s ease",
                    pointerEvents: isoError ? "none" : "auto",
                    opacity: isActive ? 1 : 0.9,
                  }}
                />
              );
            })}

            {/* İzometrik popup */}
            {selectedPunch && selectedPunch.table_id === safeTableId && (() => {
              const img = isoRef.current;
              if (!img) return null;

              const rect = img.getBoundingClientRect();
              const imgWidth = rect.width;
              const imgHeight = rect.height;

              const popupWidth = 280;

              const isoX = selectedPunch.isoX;
              const isoY = selectedPunch.isoY;

              let top, left, transform = "translate(-50%, 0)";

              if ((isoY * imgHeight) / 100 < 240) {
                top = `${isoY}%`;
                transform = "translate(-50%, 20px)";
              } else {
                top = `${isoY}%`;
                transform = "translate(-50%, -100%) translateY(-20px)";
              }

              const leftPx = (isoX / 100) * imgWidth;
              if (leftPx < popupWidth / 2) {
                left = `${(popupWidth / 2 / imgWidth) * 100}%`;
                transform = transform.replace("-50%", "0%");
              } else if (leftPx > imgWidth - popupWidth / 2) {
                left = `${((imgWidth - popupWidth / 2) / imgWidth) * 100}%`;
                transform = transform.replace("-50%", "-100%");
              } else {
                left = `${isoX}%`;
              }

              const subColor =
                subcontractors.find((s) => s.name === selectedPunch.subcontractor)?.color || "#f00";

              return (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    left,
                    top,
                    transform,
                    zIndex: 100,
                    width: popupWidth,
                    maxWidth: "86%",
                    background: "rgba(17,17,17,0.96)",
                    border: "1px solid #333",
                    borderRadius: 14,
                    padding: 14,
                    color: "#fff",
                    boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
                    backdropFilter: "blur(10px)",
                    fontSize: 13.5,
                    pointerEvents: "auto",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <strong style={{ color: "#ff9800" }}>Punch Detay</strong>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPunch(null);
                      }}
                      style={{ background: "transparent", border: "none", color: "#fff", fontSize: 18, cursor: "pointer" }}
                    >
                      ×
                    </button>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", display: "inline-block", background: subColor, border: "2px solid #fff" }} />
                    <div style={{ fontSize: 12.5, opacity: 0.9 }}>
                      Taşeron: <b>{selectedPunch.subcontractor || "-"}</b>
                    </div>
                  </div>

                  {selectedPunch.photo && (
                    <img src={selectedPunch.photo} alt="Punch" style={{ width: "100%", borderRadius: 6, margin: "6px 0", display: "block" }} />
                  )}

                  <div style={{ fontSize: 13, marginTop: 6, whiteSpace: "pre-wrap" }}>
                    {selectedPunch.note?.trim() ? selectedPunch.note : <i style={{ opacity: 0.6 }}>(Not yok)</i>}
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(selectedPunch);
                        setSelectedPunch(null);
                      }}
                      style={{
                        background: "#ff9800",
                        color: "#fff",
                        border: "none",
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 12,
                        cursor: "pointer",
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
                            [safeTableId]: (prev[safeTableId] || []).filter((p) => p.id !== selectedPunch.id),
                          }));
                          setSelectedPunch(null);
                        }
                      }}
                      style={{
                        background: "#f44336",
                        color: "#fff",
                        border: "none",
                        padding: "4px 10px",
                        borderRadius: 6,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Sil
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Yeni punch formu */}
          {newPunch && newPunch.table_id === safeTableId && (
            <div
              style={{
                width: "100%",
                textAlign: "center",
                marginTop: 12,
                padding: 10,
                border: "1px dashed #007bff",
                borderRadius: 8,
                background: "#333",
              }}
            >
              <h4 style={{ color: "#007bff", marginTop: 0 }}>Yeni Punch Ekle</h4>

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                <label style={{ fontSize: 13, opacity: 0.9, minWidth: 95 }}>Taşeron:</label>
                <select
                  value={activeSub}
                  onChange={(e) => setActiveSub(e.target.value)}
                  style={{
                    flex: 1,
                    padding: 8,
                    borderRadius: 8,
                    border: "1px solid #444",
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
              <input type="file" accept="image/*" onChange={onPhoto} style={{ display: "block", margin: "6px auto" }} />
              {photo && (
                <img
                  src={photo}
                  alt="preview"
                  style={{ width: "50%", margin: "8px auto", borderRadius: 8, display: "block" }}
                />
              )}
              <div style={{ marginTop: 8, display: "flex", justifyContent: "center", gap: 10 }}>
                <button
                  style={{
                    padding: "8px 15px",
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    background: "#28a745",
                    color: "#fff",
                  }}
                  onClick={addPunch}
                >
                  Punch Ekle
                </button>
                <button
                  style={{
                    padding: "8px 15px",
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    background: "#dc3545",
                    color: "#fff",
                  }}
                  onClick={() => {
                    setNewPunch(null);
                    setNote("");
                    setPhoto(null);
                  }}
                >
                  İptal
                </button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between" }}>
            {(punches[safeTableId]?.length ?? 0) > 0 && (
              <button
                style={{
                  padding: "10px 15px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: "#f44336",
                  color: "#fff",
                  fontWeight: "bold",
                }}
                onClick={() => {
                  setSelectedPunch(null);
                  deleteAllPunches();
                }}
              >
                Tüm Punchları Sil ({punches[safeTableId].length})
              </button>
            )}
            <button
              style={{
                padding: "10px 15px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: "#6c757d",
                color: "#fff",
              }}
              onClick={() => {
                setSelectedPunch(null);
                setSelected(null);
              }}
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* --- SERBEST PUNCH FORMU (boundary içinde, masa dışı) --- */}
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
              width: 400,
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

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <label style={{ fontSize: 13, opacity: 0.9, minWidth: 95 }}>Taşeron:</label>
              <select
                value={activeSub}
                onChange={(e) => setActiveSub(e.target.value)}
                style={{
                  flex: 1,
                  padding: 8,
                  borderRadius: 8,
                  border: "1px solid #444",
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
            <input type="file" accept="image/*" onChange={onPhoto} style={{ display: "block", margin: "6px 0" }} />
            {photo && (
              <img src={photo} alt="preview" style={{ width: "100%", margin: "8px 0", borderRadius: 8, display: "block" }} />
            )}

            <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                style={{
                  padding: "8px 15px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: "#6c757d",
                  color: "#fff",
                }}
                onClick={() => {
                  setNewPunch(null);
                  setNote("");
                  setPhoto(null);
                }}
              >
                İptal
              </button>
              <button
                style={{
                  padding: "8px 15px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: "#28a745",
                  color: "#fff",
                }}
                onClick={addPunch}
              >
                Punch Ekle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- GLOBAL EDIT MODAL --- */}
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
              <button
                style={{
                  padding: "8px 15px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: "#6c757d",
                  color: "#fff",
                }}
                onClick={() => setEditingPunch(null)}
              >
                İptal
              </button>
              <button
                style={{
                  padding: "8px 15px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: "#ff9800",
                  color: "#fff",
                }}
                onClick={saveEdit}
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
