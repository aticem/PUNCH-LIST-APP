// src/components/ExportPunchList.jsx
import React from "react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import "jspdf-autotable";

/**
 * Excel ve PDF export bileşeni.
 * @param {Array|Object} punches - Punch listesi (object veya array olabilir)
 */
export default function ExportPunchList({ punches = {} }) {
  // Eğer punches bir obje ise tüm tabloları düzleştir
  const allPunches = Array.isArray(punches)
    ? punches
    : Object.entries(punches)
        .flatMap(([table_id, arr]) =>
          (arr || []).map((p) => ({ ...p, table_id }))
        );

  /* ---------------------- Excel Export ---------------------- */
  const exportExcel = () => {
    try {
      const data = allPunches.map((p, i) => ({
        No: i + 1,
        Subcontractor: p.subcontractor || "",
        Table_ID: p.table_id || "",
        Row_No: p.row_no || "",
        Description: p.note || p.desc || "",
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
    } catch (err) {
      console.error("Excel export error:", err);
      alert("❌ Excel export failed!");
    }
  };

  /* ---------------------- PDF Export ---------------------- */
  const exportPDF = async () => {
    try {
      const doc = new jsPDF("p", "pt", "a4");
      doc.setFontSize(16);
      doc.text("Punch List Report", 40, 40);

      const tableData = allPunches.map((p, i) => [
        i + 1,
        p.subcontractor || "",
        p.table_id || "",
        p.row_no || "",
        p.note || p.desc || "",
        p.status || "Open",
        p.date
          ? new Date(p.date).toLocaleDateString()
          : new Date().toLocaleDateString(),
      ]);

      doc.autoTable({
        head: [["#", "Subcontractor", "Table", "Row", "Description", "Status", "Date"]],
        body: tableData,
        startY: 70,
        theme: "striped",
        headStyles: { fillColor: [41, 128, 185] },
        styles: { fontSize: 9, cellPadding: 4 },
      });

      // Opsiyonel: fotoğraflar (ilk 10 kayıt)
      let yPos = doc.lastAutoTable.finalY + 30;
      allPunches.slice(0, 10).forEach((p, idx) => {
        if (p.photo) {
          doc.text(`Photo #${idx + 1}`, 40, yPos);
          try {
            doc.addImage(p.photo, "JPEG", 110, yPos - 10, 80, 60);
          } catch (e) {
            console.warn("Image add failed:", e);
          }
          yPos += 80;
        }
      });

      // Alt bilgi
      doc.setFontSize(10);
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 40, 800);
      doc.text("QA Signature: _______________________", 350, 800);

      doc.save("punch_list.pdf");
    } catch (err) {
      console.error("PDF export error:", err);
      alert("❌ PDF export failed!");
    }
  };

  /* ---------------------- Render ---------------------- */
  return (
    <div className="export-buttons">
      <button className="btn btn-gray" onClick={exportExcel}>
        📊 Export Excel
      </button>
      <button className="btn btn-green" onClick={exportPDF}>
        📄 Export PDF
      </button>
    </div>
  );
}
