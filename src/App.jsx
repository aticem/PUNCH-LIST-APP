// src/App.jsx — NET ÇÖZÜM (zoom out/in ile noktalar arka planla aynı oranda ölçeklenir)

import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import L from "leaflet";

/* Güvenli merkez (lon/lat ortalaması) */
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
    return [sy / n, sx / n]; // Leaflet center [lat, lon]
  } catch { return [52.712, -1.706]; }
}

/* Pür orantı: her zoom adımında ekran ölçeği 2x değişir -> 2^(Δz) */
function radiusForZoom(z, baseZoom = 18, baseRadius = 6, min = 2, max = 18) {
  const k = Math.pow(2, (z ?? baseZoom) - baseZoom);
  const r = baseRadius * k;
  return Math.max(min, Math.min(max, r));
}

export default function App() {
  const mapRef = useRef(null);
  const pointsRef = useRef(null);

  const [background, setBackground] = useState(null);
  const [tables, setTables] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    fetch("/background.geojson").then(r => r.json()).then(setBackground).catch(() => {});
    fetch("/tables.geojson").then(r => r.json()).then(setTables).catch(() => {});
  }, []);

  const initialCenter = useMemo(() => getSafeCenter(tables), [tables]);

  // İlk boyut doğrulaması
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    setTimeout(() => map.invalidateSize({ animate: false }), 0);
  }, [tables]);

  // Zoom ile tüm noktaların yarıçapını 2^(Δz) oranında güncelle
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

    update();                         // ilk değer
    map.on("zoom", update);
    map.on("zoomend", update);
    return () => {
      map.off("zoom", update);
      map.off("zoomend", update);
    };
  }, [pointsRef.current]);

  const mapKey = useMemo(() => `m-${!!tables}`, [tables]);

  return (
    <div style={{height:"100vh", width:"100vw", position:"relative"}}>
      {tables && (
        <MapContainer
          key={mapKey}
          whenCreated={(m)=> (mapRef.current = m)}
          style={{height:"100%", width:"100%"}}
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
              style={{ color:"#222", weight:1, opacity:0.6, fillOpacity:0.05 }}
            />
          )}

          {/* Noktalar: circleMarker + whenCreated ile layer referansı */}
          <GeoJSON
            data={tables}
            whenCreated={(layer)=>{ pointsRef.current = layer; }}
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

      {selected && (
        <div
          style={{
            position:"absolute", right:0, top:0, bottom:0, width:"40%",
            background:"#111", color:"#fff", display:"flex", flexDirection:"column",
            alignItems:"center", justifyContent:"center", borderLeft:"2px solid #333", zIndex:1000
          }}
        >
          <h3 style={{margin:0}}>{selected}</h3>
          <img
            src="/photos/table_iso.png"
            alt="Isometric"
            style={{width:"90%", borderRadius:10, maxHeight:"80vh", objectFit:"contain"}}
          />
          <button
            onClick={() => setSelected(null)}
            style={{marginTop:"1rem", padding:"0.5rem 1rem", background:"#444",
                    color:"#fff", border:"none", borderRadius:6, cursor:"pointer"}}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
