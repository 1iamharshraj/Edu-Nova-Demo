import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { prisma } from '../prisma'
import { UPLOAD_ROOT } from '../modules/files/service'

// Shared PDF building blocks for Phase 4 (certificates, marksheets). Documents are rendered with pdfkit
// into a Buffer; `storePdf` persists one as a File row so it can be streamed later via /api/files or
// /api/certificates/:id/pdf.

export interface DocHeader { schoolName: string; title: string; subtitle?: string; serial?: string }
export interface KeyValue { label: string; value: string }

export const fmtLong = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })

export function renderToBuffer(draw: (doc: PDFKit.PDFDocument) => void | Promise<void>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Producer: 'EduNova' } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    Promise.resolve(draw(doc)).then(() => doc.end(), reject)
  })
}

// Letterhead: school name, document title, optional serial on the right, and a rule.
export function drawHeader(doc: PDFKit.PDFDocument, h: DocHeader) {
  const left = doc.page.margins.left
  const width = doc.page.width - left - doc.page.margins.right
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text(h.schoolName, left, 56, { width, align: 'center' })
  doc.moveDown(0.3)
  doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text('EduNova School Management System', { width, align: 'center' })
  doc.moveDown(1.2)
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text(h.title.toUpperCase(), { width, align: 'center', characterSpacing: 1.5 })
  if (h.subtitle) { doc.moveDown(0.2); doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text(h.subtitle, { width, align: 'center' }) }
  doc.moveDown(0.8)
  const y = doc.y
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor('#d1d5db').stroke()
  if (h.serial) {
    doc.font('Helvetica').fontSize(9).fillColor('#374151').text(`Serial No: ${h.serial}`, left, y + 8, { width, align: 'right' })
  }
  doc.y = y + 28
  doc.fillColor('#111827')
}

// Two-column label/value block.
export function drawFields(doc: PDFKit.PDFDocument, fields: KeyValue[]) {
  const left = doc.page.margins.left
  const width = doc.page.width - left - doc.page.margins.right
  for (const f of fields) {
    const y = doc.y
    doc.font('Helvetica').fontSize(10).fillColor('#6b7280').text(f.label, left, y, { width: 160 })
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(f.value || '—', left + 170, y, { width: width - 170 })
    doc.y = Math.max(doc.y, y + 18)
  }
}

// Simple table with a header row; column widths are proportional to `cols[i].w`.
export function drawTable(doc: PDFKit.PDFDocument, cols: { label: string; w: number; align?: 'left' | 'right' | 'center' }[], rows: string[][]) {
  const left = doc.page.margins.left
  const width = doc.page.width - left - doc.page.margins.right
  const total = cols.reduce((a, c) => a + c.w, 0)
  const widths = cols.map(c => (c.w / total) * width)
  const rowH = 20
  const line = (y: number) => doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor('#d1d5db').stroke()

  let y = doc.y
  doc.rect(left, y, width, rowH).fill('#f3f4f6')
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9)
  let x = left
  cols.forEach((c, i) => { doc.text(c.label, x + 6, y + 6, { width: widths[i] - 12, align: c.align ?? 'left' }); x += widths[i] })
  y += rowH
  doc.font('Helvetica').fontSize(10)
  for (const r of rows) {
    if (y + rowH > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.page.margins.top }
    x = left
    r.forEach((cell, i) => { doc.fillColor('#111827').text(cell, x + 6, y + 5, { width: widths[i] - 12, align: cols[i].align ?? 'left' }); x += widths[i] })
    y += rowH
    line(y)
  }
  doc.y = y + 10
}

// Footer: issuer signature line on the left, a QR encoding `qrText` on the right.
export async function drawFooter(doc: PDFKit.PDFDocument, opts: { issuedBy: string; issuedOn: string; qrText: string; place?: string }) {
  const left = doc.page.margins.left
  const width = doc.page.width - left - doc.page.margins.right
  const qr = await QRCode.toBuffer(opts.qrText, { type: 'png', width: 96, margin: 1 })
  const y = Math.max(doc.y + 30, doc.page.height - doc.page.margins.bottom - 120)
  doc.image(qr, left + width - 96, y, { width: 96 })
  doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text('Scan to verify', left + width - 96, y + 100, { width: 96, align: 'center' })

  doc.font('Helvetica').fontSize(10).fillColor('#374151').text(`Place: ${opts.place ?? 'EduNova Campus'}`, left, y + 10)
  doc.text(`Date: ${opts.issuedOn}`, left, y + 26)
  doc.moveTo(left, y + 74).lineTo(left + 200, y + 74).lineWidth(0.8).strokeColor('#9ca3af').stroke()
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(opts.issuedBy, left, y + 80, { width: 200 })
  doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('Authorised signatory', left, y + 94, { width: 200 })
}

// Persist a generated PDF as a File row of the school (bytes under uploads/<schoolId>/<id>).
export async function storePdf(schoolId: string, uploaderId: string | null, name: string, bytes: Buffer) {
  const id = crypto.randomUUID().replace(/-/g, '')
  const rel = path.join(schoolId, id)
  const dest = path.join(UPLOAD_ROOT, rel)
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  await fs.promises.writeFile(dest, bytes)
  return prisma.file.create({
    data: { id, schoolId, uploaderId, name, mime: 'application/pdf', size: bytes.length, path: rel, sha256: crypto.createHash('sha256').update(bytes).digest('hex') },
  })
}
