import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import L from "leaflet";

// ✅ public klasöründeki dosyalar ?url ile import edilir
import tablesPolyUrl from "/tables_poly.geojson?url";
import tablesPointsUrl from "/tables_points.geojson?url";

/* -------------------- yardımcı fonksiyonlar -------------------- */
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
  } catch {
    return [52.712, -1.706];
  }
}

function scatterOffsets(count, radius = 0.00006) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 2 * Math.PI;
    const dist = radius * (0.55 + Math.random() * 0.45);
    arr.push([Math.cos(angle) * dist, Math.sin(angle) * dist]);
  }
  return arr;
}

function getTableId(props) {
  return (
    props?.table_id ??
    props?.tableId ??
    props?.id ??
    props?.name ??
    null
  );
}

/* -------------------- ana component -------------------- */
export default function App() {
  const mapRef = useRef(null);
  const punchLayerRef = useRef(null);

  const [poly, setPoly] = useState(null);
  const [points, setPoints] = useState(null);
  const [punches, setPunches] = useState({});
  const [selected, setSelected] = useState(null);
  const [newPunch, setNewPunch] = useState(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const isoRef = useRef(null);
  const [isoLoaded, setIsoLoaded] = useState(false);
  const [isoError, setIsoError] = useState(false);

  /* -------------------- GeoJSON verilerini yükle (?url yöntemiyle) -------------------- */
  useEffect(() => {
    Promise.all([
      fetch(tablesPolyUrl).then((r) => r.json()),
      fetch(tablesPointsUrl).then((r) => r.json()),
    ])
      .then(([polyData, pointsData]) => {
        setPoly(polyData);
        setPoints(pointsData);
        console.log("✅ GeoJSON loaded via ?url import");
      })
      .catch((err) => console.error("GeoJSON load error", err));
  }, []);

  /* -------------------- localStorage -------------------- */
  useEffect(() => {
    const s = localStorage.getItem("punches");
    if (s) setPunches(JSON.parse(s));
  }, []);
  useEffect(() => {
    localStorage.setItem("punches", JSON.stringify(punches));
  }, [punches]);

  const initialCenter = useMemo(() => getSafeCenter(points), [points]);

  const handleMapCreate = (map) => {
    mapRef.current = map;
    if (!punchLayerRef.current) {
      punchLayerRef.current = L.layerGroup().addTo(map);
    }
  };

  /* -------------------- haritada kırmızı punch noktaları -------------------- */
  useEffect(() => {
    const layer = punchLayerRef.current;
    if (!layer || !points) return;
    layer.clearLayers();

    points.features.forEach((f) => {
      const tid = getTableId(f.properties);
      if (!tid) return;
      const list = punches[tid] || [];
      if (!list.length) return;

      const [lon, lat] = f.geometry.coordinates;
      const offs = scatterOffsets(list.length, 0.00006);
      list.forEach((p, i) => {
        const [dx, dy] = offs[i];
        const m = L.circleMarker([lat + dy, lon + dx], {
          radius: 3.5,
          color: "#f00",
          fillColor: "#f00",
          fillOpacity: 1,
          weight: 1,
        }).on("click", () => setSelected({ tableId: tid, punchId: p.id }));
        layer.addLayer(m);
      });
    });

    console.log(
      "🔴 rendered punch dots:",
      Object.values(punches).reduce((a, v) => a + v.length, 0)
    );
  }, [punches, points]);

  const safeTableId =
    typeof selected === "object" && selected !== null
      ? selected.tableId
      : typeof selected === "string"
      ? selected
      : null;

  /* -------------------- izometrik etkileşimleri -------------------- */
  const onIsoClick = (e) => {
    if (!isoRef.current || !isoLoaded || isoError || !safeTableId) return;
    const rect = isoRef.current.getBoundingClientRect();
    const isoX = ((e.clientX - rect.left) / rect.width) * 100;
    const isoY = ((e.clientY - rect.top) / rect.height) * 100;
    setNewPunch({ table_id: safeTableId, isoX, isoY });
  };

  const onPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const addPunch = () => {
    if (!newPunch || !newPunch.table_id) return;
    const id = Date.now();
    const record = {
      id,
      isoX: newPunch.isoX,
      isoY: newPunch.isoY,
      note,
      photo,
    };
    setPunches((prev) => ({
      ...prev,
      [newPunch.table_id]: [...(prev[newPunch.table_id] || []), record],
    }));
    setNewPunch(null);
    setNote("");
    setPhoto(null);
  };

  if (!points || !poly) {
    return (
      <div style={{ background: "#111", color: "#fff", padding: 12 }}>
        <b>Loading data...</b>
      </div>
    );
  }

  /* -------------------- render -------------------- */
  return (
    <div style={{ height: "100vh", width: "100vw", position: "relative" }}>
      <MapContainer
        whenCreated={handleMapCreate}
        style={{ height: "100%", width: "100%" }}
        center={initialCenter}
        zoom={18}
        minZoom={14}
        maxZoom={22}
        preferCanvas
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap"
        />

        {/* Gri masa alanları */}
        <GeoJSON
          data={poly}
          style={{ color: "#333", weight: 1, opacity: 0.6, fillOpacity: 0.05 }}
        />

        {/* Siyah centroid noktaları */}
        <GeoJSON
          data={points}
          pointToLayer={(f, latlng) =>
            L.circleMarker(latlng, {
              radius: 5,
              color: "#000",
              fillColor: "#000",
              fillOpacity: 1,
            })
          }
          onEachFeature={(f, layer) => {
            const tid = getTableId(f.properties);
            layer.on("click", () => setSelected(tid || null));
          }}
        />
      </MapContainer>

      {/* Sağ panel */}
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
                }}
              />
            ))}
          </div>

          {newPunch && (
            <div style={{ width: "100%", textAlign: "center" }}>
              <input
                type="text"
                placeholder="Not ekle"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <input type="file" accept="image/*" onChange={onPhoto} />
              <div>
                <button className="btn btn-green" onClick={addPunch}>
                  Punch Ekle
                </button>
                <button
                  className="btn btn-red"
                  onClick={() => setNewPunch(null)}
                >
                  İptal
                </button>
              </div>
            </div>
          )}

          {photo && (
            <img
              src={photo}
              alt="preview"
              style={{ width: "45%", marginTop: 8, borderRadius: 10 }}
            />
          )}

          <button className="btn btn-gray" onClick={() => setSelected(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
