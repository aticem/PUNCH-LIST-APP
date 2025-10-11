import React, { useRef, useEffect, useState } from "react";
import { MapContainer, TileLayer, useMap, GeoJSON, ZoomControl } from "react-leaflet";
import L from "leaflet";
import MC4CapsFromGeoJSON from "./MC4CapsFromGeoJSON";
import "leaflet/dist/leaflet.css";

/** Panel GeoJSON'una tek sefer fit et */
function FitToPanelsOnce({ src, data, paddingRatio = 0.12, fitMaxZoom = 22 }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (fittedRef.current) return;
    let cancelled = false;

    async function loadAndFit() {
      try {
        let gj = data;
        if (!gj && src) {
          const r = await fetch(src);
          gj = await r.json();
        }
        if (cancelled || !gj) return;

        const layer = L.geoJSON(gj);
        const b = layer.getBounds();
        if (!b || !b.isValid()) return;

        map.whenReady(() => {
          map.invalidateSize();
          const padB = b.pad(paddingRatio);
          map.fitBounds(padB, { maxZoom: fitMaxZoom, animate: false });
          fittedRef.current = true;
        });
      } catch (e) {
        console.error("FitToPanelsOnce error:", e);
      }
    }

    loadAndFit();
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => { cancelled = true; window.removeEventListener("resize", onResize); };
  }, [map, src, data, paddingRatio, fitMaxZoom]);

  return null;
}

/** Zoom sadece wheel; diğer zoom yöntemleri kapalı. Drag pan kapalı (orta tuşla özel pan var). */
function ForceZoomBehaviors() {
  const map = useMap();
  useEffect(() => {
    map.scrollWheelZoom.enable();    // sadece wheel zoom
    map.doubleClickZoom.disable();   // çift tık kapalı
    map.touchZoom.disable();         // pinch kapalı
    map.keyboard.disable();          // klavye +/− kapalı
    map.dragging.disable();          // pan sadece orta tuşla

    const c = map.getContainer();
    L.DomEvent.disableScrollPropagation(c);
    L.DomEvent.disableClickPropagation(c);

    const onEnter = () => map.scrollWheelZoom.enable();
    c.addEventListener("mouseenter", onEnter);

    const t = setTimeout(() => map.invalidateSize(), 50);
    return () => { c.removeEventListener("mouseenter", onEnter); clearTimeout(t); };
  }, [map]);
  return null;
}

/** Orta tuş basılıyken özel PAN */
function PanWithMiddleMouse() {
  const map = useMap();
  useEffect(() => {
    const c = map.getContainer();
    let panning = false;
    let last = null;

    const onMouseDown = (e) => {
      if (e.button === 1) { // middle
        e.preventDefault();
        panning = true;
        last = L.point(e.clientX, e.clientY);
      }
    };
    const onMouseMove = (e) => {
      if (!panning || !last) return;
      const cur = L.point(e.clientX, e.clientY);
      const delta = cur.subtract(last);
      map.panBy(L.point(-delta.x, -delta.y), { animate: false });
      last = cur;
    };
    const endPan = () => { panning = false; last = null; };
    const onContextMenu = (e) => e.preventDefault(); // sağ tık menüsü kapalı (sağ tuş ON için)

    c.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endPan);
    c.addEventListener("contextmenu", onContextMenu);

    return () => {
      c.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endPan);
      c.removeEventListener("contextmenu", onContextMenu);
    };
  }, [map]);
  return null;
}

/** Üst toolbar */
function ViewToolbar({ src, data, stats, onReset }) {
  const map = useMap();
  const fit = async () => {
    try {
      let gj = data;
      if (!gj && src) {
        const r = await fetch(src);
        gj = await r.json();
      }
      if (!gj) return;
      const layer = L.geoJSON(gj);
      const b = layer.getBounds();
      if (b && b.isValid()) {
        map.invalidateSize();
        map.fitBounds(b.pad(0.12), { maxZoom: 22 });
      }
    } catch (e) { console.error("Manual fit error:", e); }
  };

  const chip = {
    display: "flex", alignItems: "center", gap: 8,
    marginLeft: 8, padding: "6px 12px",
    background: "#0b1220", borderRadius: 8,
    fontWeight: 800, fontSize: 15, lineHeight: 1
  };
  const label = {
    opacity: 0.8, fontWeight: 700, fontSize: 12,
    letterSpacing: "0.02em", textTransform: "uppercase"
  };

  return (
    <div style={{
      position: "absolute", top: 12, left: 12, zIndex: 1000,
      background: "rgba(15,23,42,0.85)", color: "#fff",
      padding: "10px 12px", borderRadius: 12,
      fontFamily: "Inter, system-ui, sans-serif", display: "flex", gap: 10, alignItems: "center", userSelect: "none",
    }}>
      <button onClick={fit} style={btnStyle}>Fit</button>
      <button onClick={() => map.zoomIn(1)} style={btnStyle}>+</button>
      <button onClick={() => map.zoomOut(1)} style={btnStyle}>−</button>

      <div style={chip}><span style={label}>MC4</span><span>{stats.unitsDone} / {stats.unitsTotal}</span></div>
      <div style={chip}><span style={label}>Masa</span><span>{stats.tablesDone} / {stats.total}</span></div>

      <button onClick={onReset} style={{ ...btnStyle, background: "#ef4444", color: "#fff" }}>Reset</button>
    </div>
  );
}
const btnStyle = { background: "#22c55e", border: "none", color: "#0b1220", fontWeight: 700, padding: "6px 10px", borderRadius: 8, cursor: "pointer" };

export default function App() {
  const [background, setBackground] = useState(null);
  const [stats, setStats] = useState({ total: 0, tablesDone: 0, capsOn: 0, unitsDone: 0, unitsTotal: 0 });
  const [resetToken, setResetToken] = useState(0);

  useEffect(() => {
    fetch("/background.geojson").then(r => (r.ok ? r.json() : null)).then(setBackground).catch(() => {});
  }, []);

  const doReset = () => {
    setResetToken(t => t + 1);
    setStats(s => ({ ...s, tablesDone: 0, capsOn: 0, unitsDone: 0 }));
  };

  return (
    <div className="map-wrapper">
      <MapContainer
        center={[0, 0]} zoom={3}
        style={{ height: "100vh", width: "100vw" }}
        preferCanvas
        scrollWheelZoom={true}
        wheelDebounceTime={0}
        wheelPxPerZoomLevel={80}
        zoomSnap={1}
        zoomDelta={1}
        minZoom={2}
        maxZoom={24}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxNativeZoom={19} />
        <ZoomControl position="topright" />
        <ForceZoomBehaviors />
        <PanWithMiddleMouse />

        <FitToPanelsOnce src="/panels.geojson" fitMaxZoom={22} />
        <ViewToolbar src="/panels.geojson" stats={stats} onReset={doReset} />

        {background && <GeoJSON data={background} style={{ color: "#111827", weight: 2, opacity: 0.9 }} />}
        <MC4CapsFromGeoJSON
          key={`mc4-${resetToken}`}
          src="/panels.geojson"
          capPx={12}
          onStats={setStats}
          resetToken={resetToken}
        />
      </MapContainer>
    </div>
  );
}
