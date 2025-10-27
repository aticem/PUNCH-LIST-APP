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

/* -------------------- MASA KİMLİĞİ BUL -------------------- */
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

/* -------------------- PUNCH SAYISI -------------------- */
function getPunchCount(punches, tableId) {
  return (punches[tableId] || []).length;
}

/* -------------------- YARDIMCI FONKSİYONLAR -------------------- */
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

/* -------------------- PAN KONTROL (ORTA TIK) -------------------- */
function PanControl() {
  const map = useMap();
  useMapEvents({
    mousedown: (e) => {
      if (e.originalEvent.button === 1) map.dragging.enable();
    },
    mouseup: (e) => {
      if (e.originalEvent.button === 1) map.dragging.disable();
    },
  });
  return null;
}

/* -------------------- PUNCH LAYER -------------------- */
function PunchLayer({ punches, polyGeoJSON }) {
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
    const polyIndex = polyIndexRef.current;
    if (!layer || !polyGeoJSON) return;
    layer.clearLayers();

    Object.keys(punches).forEach((tid) => {
      const polygon = polyIndex[tid];
      if (!polygon) return;
      const list = punches[tid] || [];
      list.forEach((p) => {
        if (!p.latlng) {
          if (!punchLocationsRef.current[p.id]) {
            punchLocationsRef.current[p.id] = generatePointInsidePolygon(polygon);
          }
          p.latlng = punchLocationsRef.current[p.id];
        }
        L.circleMarker(p.latlng, {
          radius: 2.5,
          color: "#fff",
          weight: 1.2,
          fillColor: "#f00",
          fillOpacity: 1,
        }).addTo(layer);
      });
    });
  }, [punches, polyGeoJSON, map]);

  return null;
}

/* -------------------- SEÇİM KONTROL -------------------- */
function SelectionControl({
  poly,
  multiSelected,
  setMultiSelected,
  setIsSelecting,
  isSelecting,
  setSelected,
}) {
  const map = useMap();
  const isDragging = useRef(false);
  const clickStartTime = useRef(0);
  const clickStartPos = useRef(null);

  useMapEvents({
    mousedown: (e) => {
      if (e.originalEvent.button === 0) {
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
      if (e.originalEvent.button === 0) {
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
          if (found) setSelected(found);
        }
      }
    },
  });

  return null;
}

/* -------------------- ANA COMPONENT -------------------- */
export default function App() {
  const [poly, setPoly] = useState(null);
  const [points, setPoints] = useState(null);
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

  useEffect(() => {
    Promise.all([
      fetch(tablesPolyUrl).then((r) => r.json()),
      fetch(tablesPointsUrl).then((r) => r.json()),
    ])
      .then(([polyData, pointsData]) => {
        setPoly(polyData);
        setPoints(pointsData);
      })
      .catch((err) => console.error("GeoJSON error", err));
  }, []);

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
    () =>
      Array.from(multiSelected).reduce(
        (sum, tid) => sum + getPunchCount(punches, tid),
        0
      ),
    [multiSelected, punches]
  );

  const onIsoClick = (e) => {
    if (!isoRef.current || !isoLoaded || isoError || !safeTableId) return;
    const rect = isoRef.current.getBoundingClientRect();
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
    if (!newPunch || !newPunch.table_id || !newPunch.latlng) return;
    const id = Date.now();
    const record = { id, isoX: newPunch.isoX, isoY: newPunch.isoY, note, photo, latlng: newPunch.latlng };
    setPunches((prev) => ({
      ...prev,
      [newPunch.table_id]: [...(prev[newPunch.table_id] || []), record],
    }));
    setNewPunch(null);
    setNote("");
    setPhoto(null);
  };

  const deleteAllPunches = () => {
    if (!safeTableId) return;
    if (!window.confirm(`${safeTableId} için TÜM punch'lar silinecek. Emin misin?`)) return;
    setPunches((prev) => {
      const updated = { ...prev };
      delete updated[safeTableId];
      return updated;
    });
  };

  const clearSelection = () => setMultiSelected(new Set());

  if (!points || !poly) {
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
        <b>Loading GeoJSON...</b>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      {/* SEÇİM BİLGİSİ – SOL ÜSTTE SABİT */}
      <div className="selection-info" style={{
        position: "absolute",
        top: 16,
        left: 16,
        background: "rgba(25,25,30,0.9)",
        color: "#fff",
        padding: "10px 16px",
        borderRadius: 12,
        fontSize: 15,
        fontWeight: 600,
        zIndex: 1500,
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        minWidth: 260,
      }}>
        <span>Seçili: <strong>{multiSelected.size}</strong> masa</span>
        <span>Toplam Punch: <strong>{totalSelectedPunch}</strong></span>
        {multiSelected.size > 0 && (
          <button
            onClick={clearSelection}
            style={{
              background: "#f44336",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Temizle
          </button>
        )}
      </div>

      {/* HARİTA */}
      <MapContainer
        key={punchVersion}
        center={initialCenter}
        zoom={18}
        minZoom={14}
        maxZoom={22}
        style={{ height: "100%", width: "100%" }}
        preferCanvas
        dragging={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <PanControl />
        <SelectionControl
          poly={poly}
          multiSelected={multiSelected}
          setMultiSelected={setMultiSelected}
          setIsSelecting={setIsSelecting}
          isSelecting={isSelecting}
          setSelected={setSelected}
        />
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
        <PunchLayer punches={punches} polyGeoJSON={poly} />
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
            {(punches[safeTableId] || []).map((p) => (
              <div
                key={p.id}
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
                }}
              />
            ))}
          </div>
          {(punches[safeTableId]?.length ?? 0) > 0 && (
            <button
              className="btn btn-red"
              onClick={deleteAllPunches}
              style={{
                margin: "16px auto",
                display: "block",
                width: "80%",
                fontWeight: "bold",
                padding: "10px",
              }}
            >
              Tümünü Sil
            </button>
          )}
          {newPunch && (
            <div style={{ width: "100%", textAlign: "center", marginTop: 12 }}>
              <input
                type="text"
                placeholder="Not (opsiyonel)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{
                  width: "80%",
                  margin: "6px auto",
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid #444",
                  background: "#222",
                  color: "#fff",
                }}
              />
              <input type="file" accept="image/*" onChange={onPhoto} style={{ display: "block", margin: "6px auto" }} />
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
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-green" onClick={addPunch}>Punch Ekle</button>
                <button className="btn btn-red" onClick={() => { setNewPunch(null); setNote(""); setPhoto(null); }}>İptal</button>
              </div>
            </div>
          )}
          <button className="btn btn-gray" onClick={() => setSelected(null)} style={{ marginTop: 16, width: "80%", padding: "10px" }}>
            Kapat
          </button>
        </div>
      )}
    </div>
  );
}