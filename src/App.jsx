import React, { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import Papa from "papaparse";
import L from "leaflet";

/* ---------- ID normalizasyonu ---------- */
const normalizeId = (s) => {
  if (!s) return "";
  return String(s)
    .replace(/\uFEFF/g, "")              // BOM
    .replace(/[\u200B-\u200D]/g, "")     // zero-width
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/\b(SUBS?|TX|INV|STR)0+(\d+)\b/g, (_, p1, p2) => `${p1}${p2}`); // STR07->STR7
};

/* ---------- Fit To Data ---------- */
function FitToData({ data }) {
  const map = useMap();
  useEffect(() => {
    if (!data) return;
    const layer = new L.GeoJSON(data);
    const b = layer.getBounds();
    if (b.isValid()) map.fitBounds(b, { padding: [40, 40] });
  }, [data, map]);
  return null;
}

/* ---------- MMB pan + context menü kapama ---------- */
function InteractionManager({ setIsDragging }) {
  const map = useMap();
  const mmbDragging = useRef(false);
  const last = useRef(null);

  useEffect(() => {
    const el = map.getContainer();
    const preventCtx = (e) => e.preventDefault();
    el.addEventListener("contextmenu", preventCtx);

    const down = (e) => {
      if (e.button === 1) {
        mmbDragging.current = true;
        last.current = { x: e.clientX, y: e.clientY };
        setIsDragging(true);
      }
    };
    const move = (e) => {
      if (mmbDragging.current && last.current) {
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        last.current = { x: e.clientX, y: e.clientY };
        map.panBy([-dx, -dy], { animate: false });
      }
    };
    const up = () => {
      if (mmbDragging.current) {
        mmbDragging.current = false;
        last.current = null;
        setIsDragging(false);
      }
    };

    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      el.removeEventListener("contextmenu", preventCtx);
      el.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [map, setIsDragging]);

  return null;
}

/* ---------- Ana Uygulama ---------- */
export default function App() {
  const [data, setData] = useState(null);
  const [plusMap, setPlusMap] = useState({});
  const [minusMap, setMinusMap] = useState({});
  const [selected, setSelected] = useState(new Set());

  const [totalPlus, setTotalPlus] = useState(0);
  const [totalMinus, setTotalMinus] = useState(0);
  const [err, setErr] = useState("");

  // sürükleyerek boyama/silme
  const paintModeRef = useRef(null); // 'add' | 'erase' | null
  const [, _force] = useState(false);
  const setIsDragging = (v) => _force(v);

  /* GeoJSON yükle + ID normalize */
  useEffect(() => {
    fetch("/tables.geojson", { cache: "no-store" })
      .then((r) => r.text())
      .then((txt) => {
        let json;
        try { json = JSON.parse(txt); }
        catch { setErr("GeoJSON 404/HTML. public/tables.geojson yolunu kontrol et."); return; }
        if (Array.isArray(json.features)) {
          json.features.forEach((f) => {
            f.properties.string_id = normalizeId(f?.properties?.string_id);
          });
        }
        setData(json);
      })
      .catch((e) => setErr("GeoJSON yüklenemedi: " + e.message));
  }, []);

  /* CSV yükle (başlıklı/başlıksız, otomatik ayraç) */
  useEffect(() => {
    fetch("/strings.csv", { cache: "no-store" })
      .then((r) => r.text())
      .then((csvText) => {
        let p = Papa.parse(csvText, { header: true, skipEmptyLines: true });
        let rows = p.data || [];

        const hasStringCol = p.meta?.fields?.some((f) => /string.?id/i.test(f));
        if (!hasStringCol || rows.length === 0) {
          p = Papa.parse(csvText, { header: false, skipEmptyLines: true });
          rows = p.data.map((arr) => ({
            string_id: arr[0],
            str_plus: arr[1],
            str_minus: arr[2],
          }));
        }

        const field = {};
        (p.meta?.fields || ["string_id", "str_plus", "str_minus"]).forEach((f) => {
          const k = String(f).toLowerCase();
          if (/string.?id/.test(k)) field.id = f;
          if (/(str_?plus|plus|length_?plus|p)/.test(k)) field.plus = f;
          if (/(str_?minus|minus|length_?minus|m)/.test(k)) field.minus = f;
        });

        const plus = {}, minus = {};
        rows.forEach((row) => {
          const id = normalizeId(row[field.id ?? "string_id"] ?? row[0]);
          if (!id) return;
          const pVal = parseFloat(row[field.plus ?? "str_plus"] ?? row[1]);
          const mVal = parseFloat(row[field.minus ?? "str_minus"] ?? row[2]);
          if (!Number.isNaN(pVal)) plus[id] = pVal;
          if (!Number.isNaN(mVal)) minus[id] = mVal;
        });

        setPlusMap(plus);
        setMinusMap(minus);
      })
      .catch((e) => console.error("CSV load error:", e));
  }, []);

  /* yardımcılar */
  const addId = (id) => { 
    if (!id || selected.has(id)) return; 
    const s = new Set(selected); 
    s.add(id); 
    setSelected(s); 
  };
  
  const removeId = (id) => { 
    if (!id || !selected.has(id)) return; 
    const s = new Set(selected); 
    s.delete(id); 
    setSelected(s); 
  };

  const hasAny = (id) => {
    const p = plusMap[id], m = minusMap[id];
    return p != null || m != null;
  };

  const getValues = (id) => {
    const p = plusMap[id];
    const m = minusMap[id];
    const pTxt = p != null ? `${p.toFixed(2)} m` : "—";
    const mTxt = m != null ? `${m.toFixed(2)} m` : "—";
    return { pTxt, mTxt };
  };

  /* toplamlar */
  useEffect(() => {
    let sumP = 0, sumM = 0;
    selected.forEach((id) => {
      const p = plusMap[id], m = minusMap[id];
      if (p != null) sumP += p;
      if (m != null) sumM += m;
    });
    setTotalPlus(sumP);
    setTotalMinus(sumM);
  }, [selected, plusMap, minusMap]);

  /* stil */
  const style = (f) => {
    const id = f.properties?.string_id;
    const isSel = selected.has(id);
    const found = hasAny(id);
    let color = "#374151";
    let fillColor = "#374151";
    if (isSel && found) {
      color = "#22c55e";
      fillColor = "#22c55e";
    } else if (isSel && !found) {
      color = "#f59e0b";
      fillColor = "#f59e0b";
    }
    return { color, fillColor, weight: isSel ? 3 : 1, fillOpacity: isSel ? 0.8 : 0.6, pane: "overlayPane" };
  };

  /* layer event’leri */
  const onEach = (feature, layer) => {
    const id = feature.properties?.string_id || "No ID";
    layer.bindTooltip(id, { sticky: true, tolerance: 15 }); // Tolerans 10'dan 15'e artırıldı

    // Sol tık basılı: sürükleme için add mod aktif
    layer.on("mousedown", (e) => {
      if (e.originalEvent.button === 0) {
        paintModeRef.current = "add";
        L.DomEvent.stopPropagation(e); // Map pan'i durdur
      }
    });

    // Sol tık bırak: mod sıfırla
    layer.on("mouseup", (e) => {
      if (e.originalEvent.button === 0) {
        paintModeRef.current = null;
      }
    });

    // Sağ tık basılı: erase mod (unselect için)
    layer.on("contextmenu", (e) => {
      if (e.originalEvent.button === 2) {
        paintModeRef.current = "erase";
        if (selected.has(id)) removeId(id); // Direkt seçiliyse sil
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
      }
    });

    // Sağ tık bırak: mod sıfırla (global mouseup ile)
    layer.on("mouseover", (e) => {
      if (paintModeRef.current === "add" && !selected.has(id)) addId(id); // Sadece seçilmemişse ekle
      else if (paintModeRef.current === "erase" && e.originalEvent.buttons === 2 && selected.has(id)) removeId(id); // Direkt basılıyken seçiliyi sil
    });

    // Tek tık sol: sadece seç (popup yok)
    layer.on("click", (e) => {
      if (e.originalEvent.button === 0 && paintModeRef.current !== "add") {
        addId(id); // Silme yok, sadece ekle
      }
      L.DomEvent.stopPropagation(e);
    });

    // Sağ tek tık: sil (popup yok)
    layer.on("contextmenu", (e) => {
      if (paintModeRef.current !== "erase" && selected.has(id)) {
        removeId(id);
      }
    });
  };

  /* Map-level: Global mouseup ile mod sıfırla */
  const MouseMode = () => {
    const map = useMap();
    useEffect(() => {
      map.dragging.disable(); // Sol tuş pan kapalı
      const up = () => { paintModeRef.current = null; };
      map.on("mouseup", up);
      map.on("contextmenu", (e) => L.DomEvent.preventDefault(e));

      // Sağ tuş basılı tutma için map-level mod set
      map.on("mousedown", (e) => {
        if (e.originalEvent.button === 2) {
          paintModeRef.current = "erase";
        }
      });

      return () => {
        map.dragging.enable(); // Cleanup
        map.off("mouseup", up);
        map.off("mousedown");
      };
    }, [map]);
    return null;
  };

  if (err) return <div style={{ padding:16, color:"#b91c1c", background:"#fee2e2" }}>❌ {err}</div>;
  if (!data) return <div style={{ padding:16 }}>Loading map…</div>;

  return (
    <div style={{ height: "100vh", position: "relative" }}>
      {/* ÜST HUD */}
      <div style={{
        position: "absolute", top: 10, left: 10, right: 10, zIndex: 1000,
        display: "flex", gap: 16, justifyContent: "center", pointerEvents: "none"
      }}>
        <div style={{
          background: "rgba(15,23,42,0.9)", color: "#fff", padding: "8px 12px",
          borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.25)", fontWeight: 700, pointerEvents: "auto"
        }}>
          + DC cable: {totalPlus.toFixed(2)} m
        </div>
        <div style={{
          background: "rgba(15,23,42,0.9)", color: "#fff", padding: "8px 12px",
          borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.25)", fontWeight: 700, pointerEvents: "auto"
        }}>
          - DC cable: {totalMinus.toFixed(2)} m
        </div>
        <button
          onClick={() => setSelected(new Set())}
          style={{
            background: "rgba(220,38,38,0.9)", color: "#fff", padding: "8px 12px",
            borderRadius: 12, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
            fontWeight: 700, cursor: "pointer", pointerEvents: "auto"
          }}
        >
          Sıfırla
        </button>
      </div>

      {/* HARİTA */}
      <MapContainer
        style={{ height: "100%", width: "100%" }}
        preferCanvas={true}
        zoomControl={true}
        zoomSnap={0}
        zoomDelta={0.25}
        wheelPxPerZoomLevel={80}
        minZoom={2}
        maxZoom={22}
        doubleClickZoom={true}
        dragging={false}  // Sol tuş pan kapalı
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={19}
          maxZoom={22}
        />
        <FitToData data={data} />
        <InteractionManager setIsDragging={setIsDragging} />
        <MouseMode />
        <GeoJSON data={data} style={style} onEachFeature={onEach} smoothFactor={0} key={`${selected.size}-${Object.keys(plusMap).length}`} />
      </MapContainer>
    </div>
  );
}