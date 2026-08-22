import JSZip from "jszip"
import type { ScriptSegment } from "../domain/creation-contracts"

export type ScriptExportInput = {
  title: string
  segments?: ScriptSegment[]
  paragraphs?: string[]
  shootingTips?: string[]
}

export async function buildScriptDocx(input: ScriptExportInput) {
  const zip = new JSZip()
  zip.file("[Content_Types].xml", contentTypesXml)
  zip.file("_rels/.rels", packageRelationshipsXml)
  zip.file("word/document.xml", documentXml(input))
  zip.file("word/styles.xml", stylesXml)
  zip.file("word/_rels/document.xml.rels", documentRelationshipsXml)
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })
}

function documentXml(input: ScriptExportInput) {
  const spoken = input.segments?.filter((segment) => segment.kind === "spoken").map((segment) => segment.text)
    ?? input.paragraphs ?? []
  const production = input.segments?.filter((segment) => segment.kind === "shot_instruction" || segment.kind === "subtitle_emphasis")
    .map((segment) => segment.text) ?? input.shootingTips ?? []
  const notes = input.segments?.filter((segment) => segment.kind === "compliance_note").map((segment) => segment.text) ?? []
  const spokenParagraphs = spoken.map((text) => paragraphXml(text)).join("")
  const shootingTips = production.length
    ? production.map((text) => paragraphXml(`• ${text}`, "ShootingTip")).join("")
    : paragraphXml("暂无额外拍摄提示。", "ShootingTip")
  const complianceNotes = notes.length
    ? `${paragraphXml("内容备注", "Heading1")}${notes.map((text) => paragraphXml(`• ${text}`, "ShootingTip")).join("")}`
    : ""
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphXml(input.title, "Title")}
    ${paragraphXml("口播正文", "Heading1")}
    ${spokenParagraphs}
    ${paragraphXml("拍摄提示与制作提示", "Heading1")}
    ${shootingTips}
    ${complianceNotes}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`
}

function paragraphXml(text: string, style = "Normal") {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

const packageRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const documentRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:eastAsia="微软雅黑"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="180" w:line="360" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="360"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ShootingTip"><w:name w:val="Shooting Tip"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="666666"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`
