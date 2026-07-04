// The deep import used by lib/retrieval/processing/pdf.ts — @types/pdf-parse
// only declares the package root.
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse from "pdf-parse"
  export default pdfParse
}
