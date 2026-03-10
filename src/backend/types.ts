export type Position = [number, number];

export interface ViewportBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface RenderOptions {
  width: number;
  height: number;
  outputDir: string;
  product: string;
}

export interface CliOptions {
  alertId?: string;
  timestamp?: string;
  output?: string;
}
