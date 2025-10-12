import React, { useEffect, useState, useRef } from "react";
import { MapContainer, useMap } from "react-leaflet";
import L from "leaflet";

/* Stil seti */
const STYLE = {
  todo: { color: "#0f172a", weight: 1, fillColor: "#9ca3af", fillOpacity: 0.15 },
  half: { color: "#b45309", weight: 2, fillColor: "#fde68a", fillOpacity: 0.55 },
  full: { color: "#047857", weight: 2, fillColor: "#86efac", fillOpacity: 0.65 }
};

function bindCenteredLabel(lyr, text, className) {
  const center = lyr.getBounds().getCenter();
  lyr.bindTooltip(text, {
    permanent: true,
    direction: "center",
    offset: [0, 0],
    className,
    sticky: false,
    interactive: false
  });
  const tt = lyr.getTooltip?.();
  if (tt && tt.setLatLng) tt.setLatLng(center);
}

function setLayerStatus(lyr, newStatus) {
  lyr.feature.properties.status = newStatus;
  lyr.setStyle(STYLE[newStatus]);
  lyr.unbindTooltip();
  if (newStatus === "half") bindCenteredLabel(lyr, "%50", "table-label yellow");
  if (newStatus === "full") bindCenteredLabel(lyr, "%100", "table-label green");
}

export default function App() {
  const [data, setData] = useState(null);
  const [stats, setStats] = useState({ total: 0, half: 0, full: 0 });

  const geoRef = useRef(null);
  const fitDone = useRef(false);

  // Drag durumu
  const modeRef = useRef(null); // null | 'paint' | 'erase'
  const buttonsRef = useRef(0);
  const paintedThisDragRef = useRef(new Set());
  const erasedThisDragRef = useRef(new Set());

  useEffect(() => {
    fetch("/tables.geojson")
      .then(r => r.json())
      .then(fc => {
        fc.features.forEach((f, i) => {
          f.properties.id = f.properties.id || `F${i}`;
          f.properties.status = f.properties.status || "todo";
        });
        setData(fc);
        setStats(s => ({ ...s, total: fc.features.length }));
      })
      .catch(e => console.error("GeoJSON load error:", e));
  }, []);

  const updateStats = () => {
    if (!geoRef.current) return;
    let half = 0, full = 0;
    geoRef.current.eachLayer(l => {
      const st = l.feature.properties.status;
      if (st === "half") half++;
      if (st === "full") full++;
    });
    setStats(p => ({ ...p, half, full }));
  };

  const pct = (n, d) => (d ? Math.round((n * 100) / d) : 0);

  function Layer({ fc }) {
    const map = useMap();

    const advanceOneStep = (lyr, dragged = false) => {
      if (!lyr) return;
      const id = lyr.feature.properties.id;
      if (dragged && paintedThisDragRef.current.has(id)) return;

      const cur = lyr.feature.properties.status || "todo";
      if (cur === "todo") setLayerStatus(lyr, "half");
      else if (cur === "half") setLayerStatus(lyr, "full");
      else return;

      if (dragged) paintedThisDragRef.current.add(id);
      updateStats();
    };

    const eraseOne = (lyr, dragged = false) => {
      if (!lyr) return;
      const id = lyr.feature.properties.id;
      if (dragged && erasedThisDragRef.current.has(id)) return;

      if (lyr.feature.properties.status !== "todo") {
        setLayerStatus(lyr, "todo");
        if (dragged) erasedThisDragRef.current.add(id);
        updateStats();
      }
    };

    useEffect(() => {
      if (!fc) return;

      if (geoRef.current) geoRef.current.removeFrom(map);

      const layer = L.geoJSON(fc, {
        style: f => ({ ...STYLE[f.properties.status] }),
        onEachFeature: (f, lyr) => {
          // Tek sol tık: kademe arttır (drag modda değilse)
          lyr.on("click", (e) => {
            if (modeRef.current) return;
            if (e.originalEvent?.button !== 0) return;
            e.originalEvent.stopPropagation();
            advanceOneStep(lyr, false);
          });

          // Tek sağ tık: 0%
          lyr.on("contextmenu", (e) => {
            e.originalEvent.preventDefault();
            e.originalEvent.stopPropagation?.();
            if (modeRef.current) return;
            eraseOne(lyr, false);
          });

          // Sadece tuş basılıyken hızlı modlar
          lyr.on("mouseover", () => {
            if (modeRef.current === "paint" && (buttonsRef.current & 1)) {
              advanceOneStep(lyr, true);
            } else if (modeRef.current === "erase" && (buttonsRef.current & 2)) {
              eraseOne(lyr, true);
            }
          });

          // Görsel hover
          lyr.on("mouseover", () =>
            lyr.setStyle({
              ...STYLE[f.properties.status],
              weight: f.properties.status === "todo" ? 2 : 3
            })
          );
          lyr.on("mouseout", () => lyr.setStyle(STYLE[f.properties.status]));
        }
      }).addTo(map);

      geoRef.current = layer;

      if (!fitDone.current) {
        const b = layer.getBounds();
        if (b.isValid()) {
          map.fitBounds(b.pad(0.1), { animate: false });
          fitDone.current = true;
        }
      }

      // Map container events: mod ve buttons takibi
      const el = map.getContainer();
      const preventCtx = (e) => e.preventDefault();
      el.addEventListener("contextmenu", preventCtx);

      const onMouseDown = (e) => {
        buttonsRef.current = e.buttons || 0;
        if (e.button === 0) modeRef.current = "paint";
        else if (e.button === 2) modeRef.current = "erase";
        else return;

        paintedThisDragRef.current = new Set();
        erasedThisDragRef.current = new Set();

        map.dragging.disable();
        el.style.cursor = "crosshair";
      };

      const onMouseMove = (e) => {
        buttonsRef.current = e.buttons || 0;
        if (buttonsRef.current === 0 && modeRef.current) endDrag();
      };

      const endDrag = () => {
        modeRef.current = null;
        buttonsRef.current = 0;
        paintedThisDragRef.current.clear();
        erasedThisDragRef.current.clear();
        map.dragging.enable();
        el.style.cursor = "";
      };

      el.addEventListener("mousedown", onMouseDown);
      el.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", endDrag);

      return () => {
        el.removeEventListener("contextmenu", preventCtx);
        el.removeEventListener("mousedown", onMouseDown);
        el.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", endDrag);
        if (geoRef.current) {
          geoRef.current.removeFrom(map);
          geoRef.current = null;
        }
      };
    }, [fc, map]);

    return null;
  }

  const reset = () => {
    if (!geoRef.current) return;
    geoRef.current.eachLayer(l => {
      l.feature.properties.status = "todo";
      l.setStyle(STYLE.todo);
      l.unbindTooltip();
    });
    setStats(p => ({ ...p, half: 0, full: 0 }));
  };

  const percentHalf = pct(stats.half, stats.total);
  const percentFull = pct(stats.full, stats.total);

  return (
    <div className="app-shell">
      <div className="header">
        <div className="statsbar">
          {/* SOL blok: Ongoing */}
          <div className="stat-label">ongoing</div>
          <div className="stat-block">
            <div className="stat-count">{stats.half}/{stats.total}</div>
            <div className="badge orange">
              <span>{percentHalf}%</span>
            </div>
          </div>

          {/* SAĞ blok: Done */}
          <div className="stat-block">
            <div className="stat-count">{stats.full}/{stats.total}</div>
            <div className="badge green">
              <span>{percentFull}%</span>
            </div>
          </div>
          <div className="stat-label">done</div>

          <div className="header-actions">
            <button onClick={reset} style={{ padding: "4px 10px", borderRadius: 6 }}>
              Sıfırla
            </button>
          </div>
        </div>
      </div>

      <div className="map-wrap">
        <MapContainer
          center={[52.5, -1.9]}
          zoom={17}
          zoomControl={true}
          doubleClickZoom={false}
          style={{ height: "100%", width: "100%" }}   // ← ekledik
        >

          {data && <Layer fc={data} />}
        </MapContainer>
      </div>
    </div>
  );
}
