// Renders the whole diagram, not just the visible part of the canvas, to a
// JPEG or PNG in the browser. Nothing is uploaded; the image is downloaded.
import { toJpeg, toPng } from "html-to-image";
import { getRectOfNodes, getTransformForBounds, type Node } from "reactflow";
import { fileStem } from "./filename";

export type ImageFormat = "jpeg" | "png";

const PADDING = 48;
const MAX_SIDE = 8192; // stays inside browser canvas limits
const SCALE = 2; // sharp on high-density screens and in documents

const EXCLUDED_CLASSES = ["react-flow__minimap", "react-flow__controls", "react-flow__panel", "react-flow__attribution"];

export function imageFilename(name: string, format: ImageFormat): string {
  return `${fileStem(name)}.${format === "jpeg" ? "jpg" : "png"}`;
}

export function exportFrame(nodes: Node[]): { width: number; height: number; transform: string } {
  const bounds = getRectOfNodes(nodes);
  const width = Math.min(MAX_SIDE / SCALE, Math.max(320, Math.ceil(bounds.width + PADDING * 2)));
  const height = Math.min(MAX_SIDE / SCALE, Math.max(240, Math.ceil(bounds.height + PADDING * 2)));
  const [x, y, zoom] = getTransformForBounds(bounds, width, height, 0.1, 2, PADDING / Math.max(width, height));
  return { width, height, transform: `translate(${x}px, ${y}px) scale(${zoom})` };
}

export async function renderDiagramImage(
  flowElement: HTMLElement,
  nodes: Node[],
  format: ImageFormat,
  background: string,
): Promise<string> {
  const viewport = flowElement.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport || nodes.length === 0) throw new Error("There is nothing on the canvas to export.");
  const frame = exportFrame(nodes);
  const options = {
    // JPEG has no transparency, so always paint the canvas colour.
    backgroundColor: background,
    width: frame.width,
    height: frame.height,
    pixelRatio: SCALE,
    quality: 0.95,
    cacheBust: false,
    style: { width: `${frame.width}px`, height: `${frame.height}px`, transform: frame.transform },
    filter: (node: HTMLElement) => !EXCLUDED_CLASSES.some((name) => node.classList?.contains(name)),
  };
  return format === "jpeg" ? toJpeg(viewport, options) : toPng(viewport, options);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = window.document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
