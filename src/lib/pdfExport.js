import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const BRAND = "Beeshop's Place Lounge"
const SUBTEXT = "Restaurant & Bar"

export function createPDF(title, subtitle) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  
  // Header
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, 210, 28, 'F')
  doc.setTextColor(245, 158, 11)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(BRAND, 14, 11)
  doc.setTextColor(156, 163, 175)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(SUBTEXT, 14, 17)
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(title, 14, 24)
  if (subtitle) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.text(subtitle, 210 - 14, 24, { align: 'right' })
  }

  return doc
}

export function addTable(doc, head, body, startY) {
  autoTable(doc, {
    startY: startY || 35,
    head: [head],
    body,
    theme: 'grid',
    headStyles: { fillColor: [245, 158, 11], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 7, textColor: [30, 30, 30] },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    margin: { left: 14, right: 14 }
  })
  return doc.lastAutoTable.finalY
}

export function addSummaryRow(doc, label, value, y, color) {
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...(color || [0, 0, 0]))
  doc.text(label, 14, y)
  doc.text(value, 196, y, { align: 'right' })
  doc.setTextColor(0, 0, 0)
}

export function addFooter(doc) {
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(150, 150, 150)
    doc.text('Generated: ' + new Date().toLocaleString('en-NG'), 14, 290)
    doc.text('Page ' + i + ' of ' + pageCount, 196, 290, { align: 'right' })
  }
}

export function savePDF(doc, filename) {
  addFooter(doc)
  doc.save(filename)
}
