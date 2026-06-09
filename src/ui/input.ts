import type { Camera } from "../render/camera";

export interface InputHooks {
  toggleDebug: () => void;
  toggleOverlays: () => void;
  toggleMode: () => void;
  togglePause: () => void;
  reset: () => void;
}

export function installInput(canvas: HTMLCanvasElement, camera: Camera, hooks: InputHooks): void {
  window.addEventListener("keydown", (e) => {
    if (e.key === "/") {
      e.preventDefault();
      hooks.toggleDebug();
    } else if (e.key === "o" || e.key === "O") {
      hooks.toggleOverlays();
    } else if (e.key === "m" || e.key === "M") {
      hooks.toggleMode();
    } else if (e.key === "p" || e.key === "P") {
      hooks.togglePause();
    } else if (e.key === "r" || e.key === "R") {
      hooks.reset();
    }
  });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    camera.panByPixels((e.clientX - lastX) * dpr, (e.clientY - lastY) * dpr, canvas.height);
    lastX = e.clientX;
    lastY = e.clientY;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const factor = Math.exp(-e.deltaY * 0.001);
      camera.zoomAt(factor, ndcX, ndcY, canvas.width / canvas.height);
    },
    { passive: false },
  );
}
