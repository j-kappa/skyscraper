export interface ElementBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  opacity: number;
  tagName: string;
  hasBoundary: boolean;
  bgColor: string | null;
  borderRadius: number;
}

export interface ParseResult {
  blocks: ElementBlock[];
  screenshot: HTMLCanvasElement;
  pageWidth: number;
  pageHeight: number;
  screenshotScale: number;
}
