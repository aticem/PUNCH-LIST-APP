import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import L from "leaflet";

// Güvenli merkez hesaplama
function getSafeCenter(geojson) {
  try {
    const feats = geojson?.features || [];
    if (!feats.length) return [52.712, -1.706];
    let sx = 0, sy = 0, n = 0;
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === "Point") {
        const [lon, lat] = g.coordinates;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          sx += lon; sy += lat; n++;
        }
      }
    }
    if (!n) return [52.712, -1.706];
    return [sy / n, sx / n];
  } catch { return [52.712, -1.706]; }
}

// Zoom orantılı yarıçap
function radiusForZoom(z, baseZoom = 18, baseRadius = 6, min = 2, max = 18) {
  const k = Math.pow(2, (z ?? baseZoom) - baseZoom);
  const r = baseRadius * k;
  return Math.max(min, Math.min(max, r));
}

// Rastgele offset
function generateRandomOffsets(count, radius = 0.00005) {
  const offsets = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * 2 * Math.PI;
    const dist = Math.random() * radius;
    offsets.push([dist * Math.cos(angle), dist * Math.sin(angle)]);
  }
  return offsets;
}

export default function App() {
  const mapRef = useRef(null);
  const pointsRef = useRef(null);
  const punchLayerRef = useRef(null);

  const [background, setBackground] = useState(null);
  const [tables, setTables] = useState(null);
  const [selected, setSelected] = useState(null);
  const [punches, setPunches] = useState({});
  const [newPunch, setNewPunch] = useState(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const isoRef = useRef(null);
  const [isoLoaded, setIsoLoaded] = useState(false);
  const [isoError, setIsoError] = useState(false);

  useEffect(() => {
    fetch("/background.geojson").then(r => r.json()).then(setBackground).catch(() => {});
    fetch("/tables.geojson").then(r => r.json()).then(setTables).catch(() => {});
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("punches");
    if (stored) setPunches(JSON.parse(stored));
  }, []);

  useEffect(() => {
    localStorage.setItem("punches", JSON.stringify(punches));
  }, [punches]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && !punchLayerRef.current) {
      punchLayerRef.current = L.layerGroup().addTo(map);
    }
  }, [tables]);

  const initialCenter = useMemo(() => getSafeCenter(tables), [tables]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setTimeout(() => map.invalidateSize({ animate: false }), 0);
  }, [tables]);

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

  useEffect(() => {
    const punchLayer = punchLayerRef.current;
    if (!punchLayer || !tables) return;

    punchLayer.clearLayers();

    tables.features.forEach(feature => {
      const tableId = feature.properties.table_id;
      const punchList = punches[tableId] || [];
      if (!punchList.length) return;

      const [lon, lat] = feature.geometry.coordinates;
      const offsets = generateRandomOffsets(punchList.length);

      punchList.forEach((punch, idx) => {
        const [latOff, lonOff] = offsets[idx];
        const punchLatLng = [lat + latOff, lon + lonOff];
        const marker = L.circleMarker(punchLatLng, {
          radius: 3,
          color: "#f00",
          fillColor: "#f00",
          fillOpacity: 0.8,
          weight: 1
        }).on("click", () => {
          setSelected({ tableId, punchId: punch.id });
        });
        punchLayer.addLayer(marker);
      });
    });
  }, [punches, tables]);

  const handleIsoClick = (e) => {
    if (!isoRef.current || !isoLoaded || isoError) return;
    const rect = isoRef.current.getBoundingClientRect();
    const isoX = ((e.clientX - rect.left) / rect.width) * 100;
    const isoY = ((e.clientY - rect.top) / rect.height) * 100;
    console.log("Iso clicked at:", isoX, isoY);
    setNewPunch({ table_id: selectedTableId, isoX, isoY });
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setPhoto(reader.result);
      reader.readAsDataURL(file);
    }
  };

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

  const isPunchSelected = selected != null && typeof selected === "object";
  const selectedTableId = isPunchSelected ? selected.tableId : selected;
  const selectedPunch = isPunchSelected
    ? (punches[selected.tableId] || []).find(p => p.id === selected.punchId)
    : null;

  const mapKey = useMemo(() => `m-${!!tables}`, [tables]);

  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      {tables && (
        <MapContainer
          key={mapKey}
          whenCreated={m => (mapRef.current = m)}
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
              }).bindTooltip(feature.properties?.table_id || "", {
                permanent: false,
                direction: "top",
                offset: [0, -8]
              });
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
            alignItems: "center", justifyContent: "center", borderLeft: "2px solid #333", zIndex: 1000
          }}
        >
          <h3 style={{ margin: 0 }}>{selectedTableId}</h3>
          <div style={{ position: "relative", width: "90%", maxHeight: "80vh" }}>
            {isoError ? (
              <div style={{ color: "#f00", textAlign: "center" }}>
                İzometrik görüntü yüklenemedi. public/photos/table_iso.png dosyasını kontrol et.
              </div>
            ) : (
              <img
                ref={isoRef}
                src="/photos/table_iso.png"
                alt="Isometric"
                style={{ width: "100%", borderRadius: 10, objectFit: "contain", cursor: "crosshair" }}
                onLoad={() => {
                  setIsoLoaded(true);
                  setIsoError(false);
                  console.log("Izometrik yuklendi");
                }}
                onError={() => {
                  setIsoError(true);
                  console.log("Izometrik yuklenme hatasi - dosya yolu kontrol et: /photos/table_iso.png");
                }}
                onClick={handleIsoClick}
              />
            )}
            {(punches[selectedTableId] || []).map(p => (
              <div
                key={p.id}
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
                  transform: "translate(-50%, -50%)"
                }}
              />
            )}
          </div>
          {newPunch && (
            <div style={{ marginTop: "1rem", textAlign: "center" }}>
              <input
                type="text"
                placeholder="Not ekle"
                value={note}
                onChange={e => setNote(e.target.value)}
                style={{ marginBottom: "0.5rem", padding: "0.5rem", width: "80%", borderRadius: 4, border: "1px solid #333", background: "#222", color: "#fff" }}
              />
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                style={{ marginBottom: "0.5rem" }}
              />
              <button onClick={addPunch} style={{ padding: "0.5rem 1rem", background: "#4caf50", color: "#fff", border: "none", borderRadius: 6 }}>
                Punch Ekle
              </button>
              <button onClick={() => setNewPunch(null)} style={{ padding: "0.5rem 1rem", background: "#f44336", color: "#fff", border: "none", borderRadius: 6, marginLeft: "1rem" }}>
                İptal
              </button>
            </div>
          )}
          {photo && <img src={photo} alt="Punch Photo Preview" style={{ width: "50%", marginTop: "1rem", borderRadius: 10 }} />}
          <button
            onClick={() => {
              setSelected(null);
              setIsoLoaded(false);
              setIsoError(false);
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