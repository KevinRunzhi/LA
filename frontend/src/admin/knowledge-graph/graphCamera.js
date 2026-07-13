export const GRAPH_WIDTH = 1200;
export const GRAPH_HEIGHT = 780;
export const MIN_SCALE = 0.65;
export const MAX_SCALE = 2.2;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function fitGraphBounds(nodes, padding = 120) {
  if (!nodes.length) return { cx: GRAPH_WIDTH / 2, cy: GRAPH_HEIGHT / 2, scale: 1 };
  const xs = nodes.map((node) => node.layout.x);
  const ys = nodes.map((node) => node.layout.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(180, maxX - minX + padding * 2);
  const height = Math.max(140, maxY - minY + padding * 2);
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    scale: clamp(Math.min(GRAPH_WIDTH / width, GRAPH_HEIGHT / height), MIN_SCALE, MAX_SCALE),
  };
}

export function cameraTransform(camera) {
  return `translate(${GRAPH_WIDTH / 2} ${GRAPH_HEIGHT / 2}) scale(${camera.scale}) translate(${-camera.cx} ${-camera.cy})`;
}

export function easeOutQuint(value) {
  return 1 - Math.pow(1 - value, 5);
}

export function interpolateCamera(from, to, progress) {
  const eased = easeOutQuint(progress);
  return {
    cx: from.cx + (to.cx - from.cx) * eased,
    cy: from.cy + (to.cy - from.cy) * eased,
    scale: from.scale + (to.scale - from.scale) * eased,
  };
}

export function graphPointFromPointer(event, svg, camera) {
  const rect = svg.getBoundingClientRect();
  const screenX = ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH;
  const screenY = ((event.clientY - rect.top) / rect.height) * GRAPH_HEIGHT;
  return {
    screenX,
    screenY,
    worldX: camera.cx + (screenX - GRAPH_WIDTH / 2) / camera.scale,
    worldY: camera.cy + (screenY - GRAPH_HEIGHT / 2) / camera.scale,
  };
}
