export class Camera {
  centerX = 0;
  centerY = 0;
  zoom = 0.95;

  panByPixels(dx: number, dy: number, viewportHeight: number): void {
    const s = 2 / (viewportHeight * this.zoom);
    this.centerX -= dx * s;
    this.centerY += dy * s;
  }

  zoomAt(factor: number, ndcX: number, ndcY: number, aspect: number): void {
    const wx = this.centerX + (ndcX * aspect) / this.zoom;
    const wy = this.centerY + ndcY / this.zoom;
    this.zoom = Math.min(2000, Math.max(0.02, this.zoom * factor));
    this.centerX = wx - (ndcX * aspect) / this.zoom;
    this.centerY = wy - ndcY / this.zoom;
  }
}
