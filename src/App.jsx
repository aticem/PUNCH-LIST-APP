import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import L from "leaflet";

/* ---------- Güvenli merkez hesaplama ---------- */
function getSafeCenter(geojson) {
  try {
    const feats = geojson?.features || [];
    if (!feats.length) return [52.712, -1.706];
    let sx = 0, sy = 0, n = 0;
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === "Point") {
        const [lon, lat] = g.coordinates; // GeoJSON: [lon, lat]
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          sx += lon; sy += lat; n++;
        }
      }
    }
    if (!n) return [52.712, -1.706];
    return [sy / n, sx / n]; // [lat, lon]
  } catch { return [52.712, -1.706]; }
}

/* ---------- Zoom orantılı yarıçap ---------- */
function radiusForZoom(z, baseZoom = 18, baseRadius = 6, min = 2, max = 18) {
  const k = Math.pow(2, (z ?? baseZoom) - baseZoom);
  const r = baseRadius * k;
  return Math.max(min, Math.min(max, r));
}

/* ---------- Deterministik jitter: punch.id → küçük ofset ---------- */
/* Basit bir 32-bit hash */
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/* Mulberry32 PRNG */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
/* punch.id’ye bağlı stabil [dLon, dLat] üret */
function jitterForPunch(punchId, radius = 0.00005) {
  const rnd = mulberry32(hash32(punchId));
  const angle = rnd() * 2 * Math.PI;
  const dist = rnd() * radius; // 0..radius
  const dLon = Math.cos(angle) * dist;
  const dLat = Math.sin(angle) * dist;
  return [dLon, dLat];
}

export default function App() {
  const mapRef = useRef(null);
  const pointsRef = useRef(null);
  const punchLayerRef = useRef(null);

  const [background, setBackground] = useState(null);
  const [tables, setTables] = useState(null);
  const [selected, setSelected] = useState(null); // string table_id ya da {tableId, punchId}
  const [punches, setPunches] = useState({});     // { [table_id]: [{id, isoX, isoY, note, photo}] }
  const [newPunch, setNewPunch] = useState(null); // { table_id, isoX, isoY }
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);

  const isoRef = useRef(null);
  const [isoLoaded, setIsoLoaded] = useState(false);
  const [isoError, setIsoError] = useState(false);

  /* ---------- Veri yükleme ---------- */
  useEffect(() => {
    fetch("/background.geojson").then(r => r.json()).then(setBackground).catch(() => {});
    fetch("/tables.geojson").then(r => r.json()).then(setTables).catch(() => {});
  }, []);

  /* ---------- LocalStorage ---------- */
  useEffect(() => {
    const stored = localStorage.getItem("punches");
    if (stored) setPunches(JSON.parse(stored));
  }, []);
  useEffect(() => {
    localStorage.setItem("punches", JSON.stringify(punches));
  }, [punches]);

  /* ---------- Punch layer init ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (map && !punchLayerRef.current) {
      punchLayerRef.current = L.layerGroup().addTo(map);
    }
  }, [tables]);

  /* ---------- İlk merkez / boyut düzeltme ---------- */
  const initialCenter = useMemo(() => getSafeCenter(tables), [tables]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setTimeout(() => map.invalidateSize({ animate: false }), 0);
  }, [tables]);

  /* ---------- Zoom'a göre nokta yarıçapı ---------- */
  useEffect(() => {
    const map = mapRef.current;
    const group = pointsRef.current;
    if (!map || !group) return;

    const update = () => {
      const z = map.getZoom();
      const r = radiusForZoom(z);
      group.eachLayer(layer => {
        if (layer instanceof L.CircleMarker) layer.setRadius(r);
      });
    };

    update();
    map.on("zoom", update);
    map.on("zoomend", update);
    return () => {
      map.off("zoom", update);
      map.off("zoomend", update);
    };
  }, [pointsRef.current]);

  /* ---------- Harita üstü kırmızı punch noktaları (deterministik) ---------- */
  useEffect(() => {
    const punchLayer = punchLayerRef.current;
    if (!punchLayer || !tables) return;

    punchLayer.clearLayers();

    tables.features.forEach(feature => {
      const tableId = feature.properties.table_id;
      const punchList = punches[tableId] || [];
      if (!punchList.length) return;

      const [lon, lat] = feature.geometry.coordinates; // [lon, lat]

      punchList.forEach((punch) => {
        const [dLon, dLat] = jitterForPunch(punch.id); // punch.id’ye bağlı stabil jitter
        const punchLatLng = [lat + dLat, lon + dLon];  // [lat, lon]
        const marker = L.circleMarker(punchLatLng, {
          radius: 4,
          color: "#f00",
          fillColor: "#f00",
          fillOpacity: 0.9,
          weight: 1
        })
          .bindTooltip("Punch", { direction: "top", offset: [0, -6] })
          .on("click", () => {
            // Kırmızı nokta tıklandı → aynı masanın izometriği açılsın, ilgili punch sarı vurgulansın
            setSelected({ tableId, punchId: punch.id });
          });

        punchLayer.addLayer(marker);
      });
    });
  }, [punches, tables]);

  /* ---------- Seçim yardımcıları ---------- */
  const isPunchSelected = selected != null && typeof selected === "object";
  const selectedTableId = isPunchSelected ? selected.tableId : selected;
  const selectedPunch = isPunchSelected
    ? (punches[selectedTableId] || []).find(p => p.id === selected.punchId)
    : null;

  /* ---------- İzometrik tıklama → yeni punch ---------- */
  const handleIsoClick = (e) => {
    if (!isoRef.current || !isoLoaded || isoError || !selectedTableId) return;
    const rect = isoRef.current.getBoundingClientRect();
    const isoX = ((e.clientX - rect.left) / rect.width) * 100;
    const isoY = ((e.clientY - rect.top) / rect.height) * 100;
    setNewPunch({ table_id: selectedTableId, isoX, isoY });
  };

  /* ---------- Foto yükleme ---------- */
  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhoto(reader.result);
      reader.readAsDataURL(file);
    }
  };

  /* ---------- Punch kaydet ---------- */
  const addPunch = () => {
    if (!newPunch) return;
    const tableId = newPunch.table_id;
    const punchId = Date.now();
    const newP = { id: punchId, isoX: newPunch.isoX, isoY: newPunch.isoY, note, photo };
    setPunches(prev => ({
      ...prev,
      [tableId]: [...(prev[tableId] || []), newP]
    }));
    setNewPunch(null);
    setNote("");
    setPhoto(null);
  };

  const mapKey = useMemo(() => `m-${!!tables}`, [tables]);

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      {tables && (
        <MapContainer
          key={mapKey}
          whenCreated={(m) => (mapRef.current = m)}
          style={{ height: "100%", width: "100%" }}
          center={initialCenter}
          zoom={18}
          minZoom={14}
          maxZoom={22}
          preferCanvas
          zoomControl
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />

          {background && (
            <GeoJSON
              data={background}
              style={{ color: "#222", weight: 1, opacity: 0.6, fillOpacity: 0.05 }}
            />
          )}

          <GeoJSON
            data={tables}
            ref={pointsRef}
            pointToLayer={(feature, latlng) => {
              const z = mapRef.current?.getZoom?.() ?? 18;
              return L.circleMarker(latlng, {
                radius: radiusForZoom(z),
                color: "#000",
                fillColor: "#000",
                fillOpacity: 0.95,
                weight: 0.5
              }).bindTooltip(
                `${feature.properties?.table_id || ""}` +
                (() => {
                  const c = (punches[feature.properties?.table_id] || []).length;
                  return c ? ` — ${c} punch` : "";
                })(),
                { permanent: false, direction: "top", offset: [0, -8] }
              );
            }}
            onEachFeature={(feature, layer) => {
              layer.on("click", () => setSelected(feature.properties?.table_id || null));
            }}
          />
        </MapContainer>
      )}

      {selectedTableId && (
        <div
          style={{
            position: "absolute", right: 0, top: 0, bottom: 0, width: "40%",
            background: "#111", color: "#fff", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            borderLeft: "2px solid #333", zIndex: 1000, padding: "12px 0"
          }}
        >
          <h3 style={{ margin: "0 0 8px" }}>{selectedTableId}</h3>

          <div style={{ position: "relative", width: "90%", maxHeight: "80vh" }}>
            {isoError ? (
              <div style={{ color: "#f00", textAlign: "center" }}>
                İzometrik görüntü yüklenemedi. <code>public/photos/table_iso.png</code> dosyasını kontrol et.
              </div>
            ) : (
              <img
                ref={isoRef}
                src="/photos/table_iso.png"
                alt="Isometric"
                style={{ width: "100%", borderRadius: 10, objectFit: "contain", cursor: "crosshair" }}
                onLoad={() => { setIsoLoaded(true); setIsoError(false); }}
                onError={() => { setIsoError(true); }}
                onClick={handleIsoClick}
              />
            )}

            {(punches[selectedTableId] || []).map(p => (
              <div
                key={p.id}
                title="Punch"
                style={{
                  position: "absolute",
                  left: `${p.isoX}%`,
                  top: `${p.isoY}%`,
                  width: 10, height: 10,
                  background: "#f00",
                  borderRadius: "50%",
                  transform: "translate(-50%, -50%)"
                }}
              />
            ))}

            {selectedPunch && (
              <div
                style={{
                  position: "absolute",
                  left: `${selectedPunch.isoX}%`,
                  top: `${selectedPunch.isoY}%`,
                  width: 14, height: 14,
                  background: "#ff0",
                  borderRadius: "50%",
                  transform: "translate(-50%, -50%)",
                  boxShadow: "0 0 10px rgba(255,255,0,0.8)"
                }}
              />
            )}
          </div>

          {newPunch && (
            <div style={{ marginTop: "1rem", textAlign: "center", width: "100%" }}>
              <input
                type="text"
                placeholder="Not ekle"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
              />
              <div style={{ marginTop: 8 }}>
                <button onClick={addPunch} style={{ padding: "0.5rem 1rem", background: "#4caf50", color: "#fff", border: "none", borderRadius: 6 }}>
                  Punch Ekle
                </button>
                <button onClick={() => setNewPunch(null)} style={{ padding: "0.5rem 1rem", background: "#f44336", color: "#fff", border: "none", borderRadius: 6, marginLeft: "1rem" }}>
                  İptal
                </button>
              </div>
            </div>
          )}

          {photo && <img src={photo} alt="Punch Photo Preview" style={{ width: "50%", marginTop: "1rem", borderRadius: 10 }} />}

          <button
            onClick={() => {
              setSelected(null);        // paneli kapat
              setIsoLoaded(false);
              setIsoError(false);
              // panel kapanınca kırmızı noktalar zaten punchLayer’da görünmeye devam ediyor
            }}
            style={{ marginTop: "1rem", padding: "0.5rem 1rem", background: "#444", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
