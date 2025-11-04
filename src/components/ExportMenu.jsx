// src/components/ExportMenu.jsx
import React, { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import "jspdf-autotable";

export default function ExportMenu({ punches = {} }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  const allPunches = Array.isArray(punches)
    ? punches
    : Object.entries(punches).flatMap(([table_id, arr]) =>
        (arr || []).map((p) => ({ ...p, table_id }))
      );

  const exportExcel = () => {
    const data = allPunches.map((p, i) => ({
      No: i + 1,
      Subcontractor: p.subcontractor || "",
      Table_ID: p.table_id || "",
      Description: p.note || "",
      Status: p.status || "Open",
      Date: p.date
        ? new Date(p.date).toLocaleDateString()
        : new Date().toLocaleDateString(),
      Photo: p.photo ? "Attached" : "",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PunchList");

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(
      new Blob([wbout], { type: "application/octet-stream" }),
      "punch_list.xlsx"
    );
    setOpen(false);
  };

  const exportPDF = () => {
    const doc = new jsPDF("p", "pt", "a4");
    doc.setFontSize(16);
    doc.text("Punch List Report", 40, 40);

    const tableData = allPunches.map((p, i) => [
      i + 1,
      p.subcontractor || "",
      p.table_id || "",
      p.note || "",
      p.status || "Open",
      p.date
        ? new Date(p.date).toLocaleDateString()
        : new Date().toLocaleDateString(),
    ]);

    doc.autoTable({
      head: [["#", "Subcontractor", "Table", "Description", "Status", "Date"]],
      body: tableData,
      startY: 70,
      theme: "striped",
    });

    doc.save("punch_list.pdf");
    setOpen(false);
  };

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="export-menu-wrapper" ref={menuRef}>
      <div className="export-icon" onClick={() => setOpen(!open)}>
        ⋮
      </div>

      {open && (
        <div className="export-dropdown">
          <div className="export-item" onClick={exportExcel}>
            📊 Export Excel
          </div>
          <div className="export-item" onClick={exportPDF}>
            📄 Export PDF
          </div>
        </div>
      )}
    </div>
  );
}
