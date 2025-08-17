declare module 'xlsx-populate/browser/xlsx-populate' {
  // Tipado mínimo útil para lo que usamos
  export interface Cell { value(v?: any): any; style(arg: any): any; }
  export interface Range { value(v?: any): any; style(arg: any): any; }
  export interface Column { width(w: number): void; }
  export interface Sheet {
    name(n: string): Sheet;
    cell(row: number, col: number): Cell;
    range(ref: string): Range;
    column(c: number): Column;
    freezePanes(row: number, col: number): void;
  }
  export interface Workbook {
    sheet(index: number): Sheet;
    addSheet(name: string): Sheet;
    outputAsync(): Promise<Blob>;
  }
  const XlsxPopulate: {
    fromBlankAsync(): Promise<Workbook>;
  };
  export default XlsxPopulate;
}
