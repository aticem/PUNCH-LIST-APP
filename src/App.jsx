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

/* -------------------- PAN KONTROL + SAĞ TIK UNSELECT (SADECE İSTENEN DAVRANIŞ) -------------------- */
/* - Orta tuş basılı → pan (dragging enable), bırakınca disable
   - Sağ tuş tek tık: altındaki masa SEÇİLİ ise unselect, değilse hiçbir şey yapma
   - Sağ tuş basılı sürükle: gezdiği sürece altındaki SEÇİLİ masaları unselect et
   - Sağ tık pan yapmaz, sadece unselect mantığı çalışır */
function PanControl({ poly, multiSelected, setMultiSelected, setSelected }) {
  const map = useMap();
  const container = map.getContainer();
  const isRightDragging = useRef(false);

  function findTableAtLatLng(latlng) {
    const pt = point([latlng.lng, latlng.lat]);
    for (const f of poly.features) {
      const tid = getTableId(f.properties);
      if (tid && booleanPointInPolygon(pt, f)) return tid;
    }
    return null;
  }

  useEffect(() => {
    if (!container) return;

    // Başlangıçta pan kapalı; orta tuş ile açacağız
    map.dragging.disable();
    container.style.cursor = "default";

    const handleMouseDown = (e) => {
      // Orta tuş → pan başlasın
      if (e.button === 1) {
        e.preventDefault();
        container.style.cursor = "grabbing";
        map.dragging.enable();
      }

      // Sağ tuş → sadece unselect davranışı
      if (e.button === 2) {
        e.preventDefault();
        isRightDragging.current = true;

        const latlng = map.mouseEventToLatLng(e);
        const tid = findTableAtLatLng(latlng);

        // SADECE seçiliyse unselect
        if (tid && multiSelected.has(tid)) {
          setMultiSelected((prev) => {
            const next = new Set(prev);
            next.delete(tid);
            return next;
          });
          // Eğer sadece bir tane seçili masa kalmışsa ve onu da kaldırdıysa, detay panelini kapat
          if (multiSelected.size === 1) setSelected(null);
        }
        // Seçili değilse hiçbir şey yapma (clearSelection yok!)
      }
    };

    const handleMouseMove = (e) => {
      if (!isRightDragging.current) return;
      const latlng = map.mouseEventToLatLng(e);
      const tid = findTableAtLatLng(latlng);

      // Sağ tuş basılı gezdirirken, altındaki masa seçiliyse unselect
      if (tid && multiSelected.has(tid)) {
        setMultiSelected((prev) => {
          const next = new Set(prev);
          next.delete(tid);
          return next;
        });
      }
    };

    const handleMouseUp = (e) => {
      // Orta tuş bırakılınca pan kapansın
      if (e.button === 1) {
        e.preventDefault();
        map.dragging.disable();
        container.style.cursor = "default";
      }
      // Sağ tuş drag biter
      if (e.button === 2) {
        e.preventDefault();
        isRightDragging.current = false;
      }
    };

    // Sağ tık menüsünü kapat
    const preventCtx = (ev) => ev.preventDefault();
    container.addEventListener("contextmenu", preventCtx);
    container.addEventListener("mousedown", handleMouseDown);
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseup", handleMouseUp);

    return () => {
      container.removeEventListener("contextmenu", preventCtx);
      container.removeEventListener("mousedown", handleMouseDown);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseup", handleMouseUp);
    };
  }, [map, container, poly, multiSelected, setMultiSelected, setSelected]);

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
    if (!layer || !polyGeoJSON) return;
    layer.clearLayers();

    Object.keys(punches).forEach((tid) => {
      const polygon = polyIndexRef.current[tid];
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

  // 🆕 Eklenen state: izometrikteki kırmızı noktaya tıklayınca detay gösterimi
  const [selectedPunch, setSelectedPunch] = useState(null);

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
    // Eğer punch popup açıkken arka görsel tıklanırsa kapat (daha doğal UX)
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
    if (!newPunch || !newPunch.table_id || !newPunch.latlng) return;
    const id = Date.now();
    const record = {
      id,
      isoX: newPunch.isoX,
      isoY: newPunch.isoY,
      note,
      photo,
      latlng: newPunch.latlng,
    };
    setPunches((prev) => ({
      ...prev,
      [newPunch.table_id]: [...(prev[newPunch.table_id] || []), record],
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
      <div
        style={{
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
        }}
      >
        <span>
          Seçili: <strong>{multiSelected.size}</strong> masa
        </span>
        <span>
          Toplam Punch: <strong>{totalSelectedPunch}</strong>
        </span>
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
        dragging={false}  // Orta tuşla PanControl açıp kapatacak
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {/* SADECE MOUSE DAVRANIŞI İÇİN EKLEDİĞİMİZ BİLEŞEN */}
        <PanControl
          poly={poly}
          multiSelected={multiSelected}
          setMultiSelected={setMultiSelected}
          setSelected={setSelected}
        />

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
            const isSelected = tid === (typeof selected === "string" ? selected : null);
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

          <div
            style={{
              position: "relative",
              width: "100%",
              display: "flex",
              justifyContent: "center",
            }}
          >
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
              }}
            />

            {/* İzometrik üzerindeki mevcut punch noktaları */}
            {(punches[safeTableId] || []).map((p) => (
              <div
                key={p.id}
                role="button"
                title={p.note || "Punch"}
                onClick={(e) => {
                  e.stopPropagation(); // img tıklamasına düşmesin
                  setSelectedPunch(p);
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
                }}
              />
            ))}

            {/* 🆕 Punch Detay Popup (not + foto) */}
            {selectedPunch && (
              <div
                onClick={(e) => e.stopPropagation()} // içe tıklayınca kapanmasın
                style={{
                  position: "absolute",
                  left: `${selectedPunch.isoX}%`,
                  top: `${selectedPunch.isoY - 4}%`,
                  transform: "translate(-50%, -100%)",
                  background: "rgba(0,0,0,0.9)",
                  color: "#fff",
                  padding: "10px 12px",
                  borderRadius: 10,
                  fontSize: 13,
                  zIndex: 20,
                  minWidth: 180,
                  maxWidth: 240,
                  boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(4px)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                    gap: 8,
                  }}
                >
                  <strong style={{ fontSize: 12 }}>Punch Detayı</strong>
                  <button
                    onClick={() => setSelectedPunch(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#fff",
                      fontSize: 16,
                      cursor: "pointer",
                      lineHeight: 1,
                    }}
                    aria-label="Kapat"
                  >
                    ×
                  </button>
                </div>

                {selectedPunch.photo && (
                  <img
                    src={selectedPunch.photo}
                    alt="Punch"
                    style={{
                      width: "100%",
                      borderRadius: 8,
                      marginBottom: 6,
                      display: "block",
                    }}
                  />
                )}

                <div
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.35,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    opacity: 0.95,
                  }}
                >
                  {selectedPunch.note && selectedPunch.note.trim()
                    ? selectedPunch.note
                    : "(Not yok)"}
                </div>
              </div>
            )}
          </div>

          {(punches[safeTableId]?.length ?? 0) > 0 && (
            <button
              className="btn btn-red"
              onClick={() => {
                setSelectedPunch(null); // toplu silmeden önce popup'ı kapat
                deleteAllPunches();
              }}
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
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-green" onClick={addPunch}>
                  Punch Ekle
                </button>
                <button
                  className="btn btn-red"
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

          <button
            className="btn btn-gray"
            onClick={() => {
              setSelectedPunch(null);
              setSelected(null);
            }}
            style={{ marginTop: 16, width: "80%", padding: "10px" }}
          >
            Kapat
          </button>
        </div>
      )}
    </div>
  );
}
