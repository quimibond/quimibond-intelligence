// pdf-parse@1 expone el parser real en lib/pdf-parse.js; el index del paquete
// intenta leer un PDF de prueba al cargarse (bug conocido), por eso se importa
// el módulo interno directamente.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer, options?: { max?: number; version?: string }): Promise<PdfParseResult>;
  export default pdfParse;
}
