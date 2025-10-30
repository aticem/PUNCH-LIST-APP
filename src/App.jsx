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

import tablesPolyUrl from "/tables_poly.geojson?url";
import tablesPointsUrl from "/tables_points.geojson?url";
import backgroundUrl from "/background.geojson?url";
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

/* -------------------- SAĞ TIK UNSELECT -------------------- */
function RightClickUnselect({ poly, multiSelected, setMultiSelected, setSelected }) {
  const map = useMap();
  const isRightDragging = useRef(false);

  function findTableAtLatLng(latlng) {
    const pt = point([latlng.lng, latlng.lat]);
    for (const f of poly.features) {
      const tid = getTableId(f.properties);
      if (tid && booleanPointInPolygon(pt, f)) return tid;
    }
    return null;
  }

  useMapEvents({
    contextmenu: (e) => {
      L.DomEvent.preventDefault(e);
      const latlng = e.latlng;
      const tid = findTableAtLatLng(latlng);
      if (tid && multiSelected.has(tid)) {
        setMultiSelected((prev) => {
          const next = new Set(prev);
          next.delete(tid);
          return next;
        });
        if (multiSelected.size === 1) setSelected(null);
      }
    },
  });

  return null;
}

/* -------------------- PUNCH LAYER (HOVER EFEKTİ) -------------------- */
function PunchLayer({ punches, polyGeoJSON, setSelectedPunch, safeTableId }) {
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

    Object.keys(punches).forEach((tid) => {
      const list = punches[tid] || [];

      // SERBEST PUNCH
      if (tid === "__free__") {
        list.forEach((p) => {
          if (!p.latlng) return;

          const marker = L.circleMarker(p.latlng, {
            radius: 7,
            color: "#fff",
            weight: 1.8,
            fillColor: "#f00",
            fillOpacity: 1,
            className: "punch-marker free-punch-marker",
            pane: "markerPane",
            zIndexOffset: 1000,
          }).addTo(layer);

          const hitArea = L.circle(p.latlng, {
            radius: 25,
            fill: false,
            stroke: false,
            interactive: true,
            pointerEvents: "all",
            className: "punch-hit-area",
          }).addTo(layer);

          hitArea.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            marker.openPopup();
          });

          // HOVER EFEKTİ
          marker.on("mouseover", () => {
            marker.setStyle({ radius: 10, zIndexOffset: 2000 });
          });
          marker.on("mouseout", () => {
            marker.setStyle({ radius: 7, zIndexOffset: 1000 });
          });

          const popupHTML = `
            <div style="font-family:sans-serif;min-width:180px;">
              <b style="color:#ff9800;">Serbest Punch</b>
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

          marker.bindPopup(popupHTML, {
            maxWidth: 260,
            className: "custom-punch-popup",
          });
        });
        return;
      }

      // MASA İÇİ PUNCH
      const polygon = polyIndexRef.current[tid];
      if (!polygon) return;

      list.forEach((p) => {
        if (!p.latlng) {
          if (!punchLocationsRef.current[p.id]) {
            punchLocationsRef.current[p.id] = generatePointInsidePolygon(polygon);
          }
          p.latlng = punchLocationsRef.current[p.id];
        }

        const marker = L.circleMarker(p.latlng, {
          radius: 6,
          color: "#fff",
          weight: 1.5,
          fillColor: "#f00",
          fillOpacity: 1,
          className: "punch-marker",
          pane: "markerPane",
          zIndexOffset: 1000,
        }).addTo(layer);

        const hitArea = L.circle(p.latlng, {
          radius: 20,
          fill: false,
          stroke: false,
          interactive: true,
          pointerEvents: "all",
          className: "punch-hit-area",
        }).addTo(layer);

        hitArea.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          setSelectedPunch({ ...p, table_id: tid });
        });

        // HOVER EFEKTİ
        marker.on("mouseover", () => {
          marker.setStyle({ radius: 9, zIndexOffset: 2000 });
        });
        marker.on("mouseout", () => {
          marker.setStyle({ radius: 6, zIndexOffset: 1000 });
        });
      });
    });
  }, [punches, map, setSelectedPunch, safeTableId]);

  return null;
}

/* -------------------- SEÇİM KONTROL -------------------- */
function SelectionControl({ poly, multiSelected, setMultiSelected, setIsSelecting, isSelecting, setSelected }) {
  const isDragging = useRef(false);
  const clickStartTime = useRef(0);
  const clickStartPos = useRef(null);
  useMapEvents({
    mousedown: (e) => {
      if (e.originalEvent.button !== 0) return;
      isDragging.current = true;
      setIsSelecting(true);
      clickStartTime.current = Date.now();
      clickStartPos.current = { x: e.originalEvent.clientX, y: e.originalEvent.clientY };
      const latlng = e.latlng;
      const pt = point([latlng.lng, latlng.lat]);
      let found = null;
      poly.features.forEach((f) => {
        const tid = getTableId(f.properties);
        if (tid && booleanPointInPolygon(pt, f)) found = tid;
      });
      if (found) {
        setMultiSelected((prev) => {
          const next = new Set(prev);
          next.add(found);
          return next;
        });
      }
    },
    mousemove: (e) => {
      if (!isSelecting || !isDragging.current) return;
      const latlng = e.latlng;
      const pt = point([latlng.lng, latlng.lat]);
      let found = null;
      poly.features.forEach((f) => {
        const tid = getTableId(f.properties);
        if (tid && booleanPointInPolygon(pt, f)) found = tid;
      });
      if (found) {
        setMultiSelected((prev) => {
          const next = new Set(prev);
          next.add(found);
          return next;
        });
      }
    },
    mouseup: (e) => {
      if (e.originalEvent.button !== 0) return;
      const duration = Date.now() - clickStartTime.current;
      const moved =
        clickStartPos.current &&
        (Math.abs(clickStartPos.current.x - e.originalEvent.clientX) > 5 ||
          Math.abs(clickStartPos.current.y - e.originalEvent.clientY) > 5);
      isDragging.current = false;
      setIsSelecting(false);
      if (duration < 250 && !moved) {
        const latlng = e.latlng;
        const pt = point([latlng.lng, latlng.lat]);
        let found = null;
        poly.features.forEach((f) => {
          const tid = getTableId(f.properties);
          if (tid && booleanPointInPolygon(pt, f)) found = tid;
        });
        if (found) {
          setSelected(found);
        }
      }
    },
  });
  return null;
}

/* -------------------- BOUNDARY İÇİNDE MASA DIŞI TIK -------------------- */
function BoundaryFreePunchClick({ poly, boundary, isSelecting, setSelected, setSelectedPunch, setNewPunch }) {
  useMapEvents({
    click: (e) => {
      if (isSelecting) return;
      L.DomEvent.stopPropagation(e);
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
  currentSetPunches(prev => ({
    ...prev,
    __free__: (prev.__free__ || []).filter(p => p.id !== id)
  }));
};

window.editFreePunch = (id) => {
  const punch = (currentPunches.__free__ || []).find(p => p.id === id);
  if (punch && currentStartEdit) {
    currentStartEdit({ ...punch, table_id: "__free__" });
  }
};

/* -------------------- ANA COMPONENT -------------------- */
export default function App() {
  const [poly, setPoly] = useState(null);
  const [points, setPoints] = useState(null);
  const [background, setBackground] = useState(null);
  const [boundary, setBoundary] = useState(null);

  const [punches, setPunches] = useState({});
  const [selected, setSelected] = useState(null);
  const [newPunch, setNewPunch] = useState(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);

  const [multiSelected, setMultiSelected] = useState(new Set());
  const [isSelecting, setIsSelecting] = useState(false);

  const isoRef = useRef(null);
  const [isoLoaded, setIsoLoaded] = useState(false);
  const [isoError, setIsoError] = useState(false);

  const [selectedPunch, setSelectedPunch] = useState(null);

  // Edit State
  const [editingPunch, setEditingPunch] = useState(null);
  const [editNote, setEditNote] = useState("");
  const [editPhoto, setEditPhoto] = useState(null);

  // Global referansları güncelle
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
      const [polyData, pointsData, bgData, boundaryData] = await Promise.all([
        loadSafe(tablesPolyUrl, "tables_poly.geojson"),
        loadSafe(tablesPointsUrl, "tables_points.geojson"),
        loadSafe(backgroundUrl, "background.geojson"),
        loadSafe(siteBoundaryUrl, "site_boundary.geojson"),
      ]);
      setPoly(polyData);
      setPoints(pointsData);
      setBackground(bgData);
      setBoundary(boundaryData);
    })();
  }, []);

  // localStorage
  useEffect(() => {
    const s = localStorage.getItem("punches");
    if (s) setPunches(JSON.parse(s));
  }, []);
  useEffect(() => {
    localStorage.setItem("punches", JSON.stringify(punches));
  }, [punches]);

  const initialCenter = useMemo(() => getSafeCenter(points), [points]);
  const safeTableId = typeof selected === "string" ? selected : null;
  const punchVersion = useMemo(() => Object.values(punches).flat().length, [punches]);
  const totalSelectedPunch = useMemo(
    () => Array.from(multiSelected).reduce((sum, tid) => sum + getPunchCount(punches, tid), 0),
    [multiSelected, punches]
  );

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
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const addPunch = () => {
    if (!newPunch || !newPunch.latlng) return;
    const key = newPunch.table_id || "__free__";
    const id = Date.now();
    const record = {
      id,
      table_id: key,
      isoX: newPunch.isoX ?? null,
      isoY: newPunch.isoY ?? null,
      note,
      photo,
      latlng: newPunch.latlng,
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
  };

  const clearSelection = () => setMultiSelected(new Set());

  const saveEdit = () => {
    if (!editingPunch) return;
    setPunches(prev => {
      const key = editingPunch.table_id || "__free__";
      return {
        ...prev,
        [key]: (prev[key] || []).map(p =>
          p.id === editingPunch.id
            ? { ...p, note: editNote, photo: editPhoto }
            : p
        )
      };
    });
    setEditingPunch(null);
    setEditNote("");
    setEditPhoto(null);
  };

  if (!points || !poly || !background || !boundary) {
    return (
      <div style={{ background: "#111", color: "#fff", padding: 12, textAlign: "center", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <b>Loading GeoJSON...</b>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <div className="selection-counter">
        <span>Seçili: <strong>{multiSelected.size}</strong> masa</span>
        <span>Toplam Punch: <strong>{totalSelectedPunch}</strong></span>
        {multiSelected.size > 0 && (
          <button onClick={clearSelection}>Temizle</button>
        )}
      </div>

      <MapContainer
        key={punchVersion}
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
        <GeoJSON data={background} style={() => ({ color: "#888", weight: 1, opacity: 0.6, fillColor: "#bbb", fillOpacity: 0.2 })} />
        <GeoJSON data={boundary} style={() => ({ color: "#2ecc71", weight: 2, opacity: 0.9, fillOpacity: 0 })} />

        <RightClickUnselect poly={poly} multiSelected={multiSelected} setMultiSelected={setMultiSelected} setSelected={setSelected} />
        <SelectionControl poly={poly} multiSelected={multiSelected} setMultiSelected={setMultiSelected} setIsSelecting={setIsSelecting} isSelecting={isSelecting} setSelected={setSelected} />
        <BoundaryFreePunchClick poly={poly} boundary={boundary} isSelecting={isSelecting} setSelected={setSelected} setSelectedPunch={setSelectedPunch} setNewPunch={setNewPunch} />

        <GeoJSON
          key={`poly-${punchVersion}`}
          data={poly}
          style={(feature) => {
            const tid = getTableId(feature.properties);
            const isSelected = tid === safeTableId;
            const isMulti = multiSelected.has(tid);
            const hasPunch = getPunchCount(punches, tid) > 0;
            return {
              color: isMulti ? "#ff9800" : isSelected ? "#007bff" : hasPunch ? "#d32f2f" : "#333",
              weight: isMulti ? 4 : isSelected ? 3 : hasPunch ? 2.5 : 2,
              opacity: 1,
              fillOpacity: isMulti ? 0.4 : isSelected ? 0.25 : hasPunch ? 0.15 : 0.1,
              fillColor: isMulti ? "#ff9800" : isSelected ? "#007bff" : hasPunch ? "#d32f2f" : "#666",
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
          }}
        />

        <PunchLayer punches={punches} polyGeoJSON={poly} setSelectedPunch={setSelectedPunch} safeTableId={safeTableId} />
      </MapContainer>

      {/* PANEL */}
      {safeTableId && (
        <div className="panel">
          <h3>{safeTableId}</h3>

          <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center" }}>
            <img
              ref={isoRef}
              src="/photos/table_iso.png"
              alt="Isometric"
              onLoad={() => setIsoLoaded(true)}
              onError={() => setIsoError(true)}
              onClick={onIsoClick}
              style={{ cursor: isoLoaded && !isoError ? "crosshair" : "default", width: "90%", borderRadius: 10 }}
            />

            {/* İZOMETRİK PUNCH NOKTALARI – HOVER EFEKTİ */}
            {(punches[safeTableId] || []).map((p) => (
              <div
                key={p.id}
                role="button"
                title={p.note || "Punch"}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPunch(prev => prev?.id === p.id ? null : p);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translate(-50%, -50%) scale(1.6)";
                  e.currentTarget.style.boxShadow = "0 0 12px rgba(255,0,0,0.7)";
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
                  width: 10,
                  height: 10,
                  background: "#f00",
                  borderRadius: "50%",
                  transform: "translate(-50%, -50%)",
                  border: "1.5px solid #fff",
                  boxShadow: "0 0 3px rgba(0,0,0,0.4)",
                  cursor: "pointer",
                  zIndex: 10,
                  transition: "all 0.2s ease",
                }}
              />
            ))}

            {/* İZOMETRİK POPUP – RESİM SINIRLARI İÇİNDE */}
            {selectedPunch && selectedPunch.table_id === safeTableId && (() => {
              const img = isoRef.current;
              if (!img) return null;

              const rect = img.getBoundingClientRect();
              const imgWidth = rect.width;
              const imgHeight = rect.height;

              const popupWidth = 280;
              const popupHeight = 220;

              const isoX = selectedPunch.isoX;
              const isoY = selectedPunch.isoY;

              let top, left, transform = "translate(-50%, 0)";

              if (isoY * imgHeight / 100 < popupHeight + 20) {
                top = `${isoY}%`;
                transform = "translate(-50%, 20px)";
              } else {
                top = `${isoY}%`;
                transform = "translate(-50%, -100%) translateY(-20px)";
              }

              const leftPx = (isoX / 100) * imgWidth;
              if (leftPx < popupWidth / 2) {
                left = `${(popupWidth / 2) / imgWidth * 100}%`;
                transform = transform.replace("-50%", "0%");
              } else if (leftPx > imgWidth - popupWidth / 2) {
                left = `${(imgWidth - popupWidth / 2) / imgWidth * 100}%`;
                transform = transform.replace("-50%", "-100%");
              } else {
                left = `${isoX}%`;
              }

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
                    <strong style={{ color: "#ff9800" }}>Punch</strong>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedPunch(null); }}
                      style={{ background: "transparent", border: "none", color: "#fff", fontSize: 18, cursor: "pointer" }}
                    >×</button>
                  </div>

                  {selectedPunch.photo && (
                    <img 
                      src={selectedPunch.photo} 
                      alt="Punch" 
                      style={{ width: "100%", borderRadius: 6, margin: "6px 0", display: "block" }} 
                    />
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
                        background: "#ff9800", color: "#fff", border: "none",
                        padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer"
                      }}
                    >
                      Düzenle
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm("Bu punch silinsin mi?")) {
                          setPunches(prev => ({
                            ...prev,
                            [safeTableId]: (prev[safeTableId] || []).filter(p => p.id !== selectedPunch.id)
                          }));
                          setSelectedPunch(null);
                        }
                      }}
                      style={{
                        background: "#f44336", color: "#fff", border: "none",
                        padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer"
                      }}
                    >
                      Sil
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>

          {(punches[safeTableId]?.length ?? 0) > 0 && (
            <button className="btn btn-red" onClick={() => { setSelectedPunch(null); deleteAllPunches(); }}>
              Tümünü Sil
            </button>
          )}

          {newPunch && newPunch.table_id === safeTableId && (
            <div style={{ width: "100%", textAlign: "center", marginTop: 12 }}>
              <input type="text" placeholder="Not (opsiyonel)" value={note} onChange={(e) => setNote(e.target.value)} />
              <input type="file" accept="image/*" onChange={onPhoto} style={{ display: "block", margin: "6px auto" }} />
              {photo && <img src={photo} alt="preview" style={{ width: "50%", margin: "8px auto", borderRadius: 8, display: "block" }} />}
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-green" onClick={addPunch}>Punch Ekle</button>
                <button className="btn btn-red" onClick={() => { setNewPunch(null); setNote(""); setPhoto(null); }}>İptal</button>
              </div>
            </div>
          )}

          <button className="btn btn-gray" onClick={() => { setSelectedPunch(null); setSelected(null); }}>
            Kapat
          </button>
        </div>
      )}

      {/* SERBEST PUNCH FORMU */}
      {newPunch && newPunch.table_id === "__free__" && (
        <div
          onClick={() => { setNewPunch(null); setNote(""); setPhoto(null); }}
          style={{
            position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1600,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 380, maxWidth: "92vw", background: "#111", border: "1px solid #333",
              borderRadius: 12, padding: 16, color: "#fff", boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>Yeni Punch (Masa Dışı)</span>
              <button onClick={() => { setNewPunch(null); setNote(""); setPhoto(null); }}
                style={{ background: "transparent", border: "none", color: "#fff", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
              >×</button>
            </div>

            <input type="text" placeholder="Not (opsiyonel)" value={note} onChange={(e) => setNote(e.target.value)}
              style={{ width: "100%", margin: "6px 0", padding: 8, borderRadius: 6, border: "1px solid #444", background: "#222", color: "#fff" }} />
            <input type="file" accept="image/*" onChange={onPhoto} style={{ display: "block", margin: "6px 0" }} />
            {photo && <img src={photo} alt="preview" style={{ width: "100%", margin: "8px 0", borderRadius: 8, display: "block" }} />}

            <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-gray" onClick={() => { setNewPunch(null); setNote(""); setPhoto(null); }}>İptal</button>
              <button className="btn btn-green" onClick={addPunch}>Punch Ekle</button>
            </div>
          </div>
        </div>
      )}

      {/* GLOBAL EDIT MODAL */}
      {editingPunch && (
        <div
          onClick={() => setEditingPunch(null)}
          style={{
            position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 2000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#111", color: "#fff", padding: 20, borderRadius: 16,
              width: 400, maxWidth: "92vw", boxShadow: "0 15px 40px rgba(0,0,0,0.5)",
              border: "1px solid #333"
            }}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 18 }}>Punch Düzenle</h3>

            <textarea
              placeholder="Not"
              value={editNote}
              onChange={e => setEditNote(e.target.value)}
              style={{
                width: "100%", minHeight: 80, padding: 10, borderRadius: 8,
                background: "#222", color: "#fff", border: "1px solid #444",
                resize: "vertical", fontSize: 14, marginBottom: 12
              }}
            />

            <input
              type="file"
              accept="image/*"
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onloadend = () => setEditPhoto(reader.result);
                reader.readAsDataURL(file);
              }}
              style={{ display: "block", marginBottom: 12 }}
            />

            {editPhoto && (
              <div style={{ position: "relative", display: "inline-block" }}>
                <img src={editPhoto} alt="edit" style={{ width: "100%", borderRadius: 8 }} />
                <button
                  onClick={() => setEditPhoto(null)}
                  style={{
                    position: "absolute", top: 6, right: 6, background: "#f44336",
                    color: "#fff", border: "none", borderRadius: "50%", width: 28, height: 28,
                    fontSize: 16, cursor: "pointer"
                  }}
                >×</button>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button className="btn btn-gray" onClick={() => setEditingPunch(null)}>
                İptal
              </button>
              <button className="btn btn-green" onClick={saveEdit}>
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}