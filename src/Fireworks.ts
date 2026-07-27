import { FIREWORKS_CLASS } from "./constants";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export class Fireworks {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private particles: Particle[] = [];
  private animId: number | null = null;
  private container: HTMLElement | null = null;

  show(): void {
    if (this.container) return; // Already showing

    this.container = document.body.createEl("div", { cls: FIREWORKS_CLASS });
    this.canvas = this.container.createEl("canvas");
    this.canvas.setCssProps({ width: "100%", height: "100%" });

    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.ctx = this.canvas.getContext("2d")!;

    // Spawn initial bursts
    this.spawnBurst(window.innerWidth * 0.3, window.innerHeight * 0.3);
    this.spawnBurst(window.innerWidth * 0.7, window.innerHeight * 0.2);
    this.spawnBurst(window.innerWidth * 0.5, window.innerHeight * 0.4);

    this.animate();

    // Auto-hide after 3 seconds
    window.setTimeout(() => this.hide(), 3000);
  }

  private spawnBurst(x: number, y: number): void {
    const colors = ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff", "#5f27cd"];
    const color = colors[Math.floor(Math.random() * colors.length)];

    for (let i = 0; i < 40; i++) {
      const angle = (Math.PI * 2 * i) / 40 + (Math.random() - 0.5) * 0.3;
      const speed = 2 + Math.random() * 4;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 40 + Math.random() * 30,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  private animate = (): void => {
    if (!this.ctx || !this.canvas) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.particles = this.particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05; // gravity
      p.vx *= 0.98; // drag
      p.life++;

      if (p.life >= p.maxLife) return false;

      const alpha = 1 - p.life / p.maxLife;
      this.ctx!.globalAlpha = alpha;
      this.ctx!.fillStyle = p.color;
      this.ctx!.beginPath();
      this.ctx!.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      this.ctx!.fill();

      return true;
    });

    if (this.particles.length > 0) {
      this.animId = window.requestAnimationFrame(this.animate);
    } else {
      this.hide();
    }
  };

  hide(): void {
    if (this.animId !== null) {
      window.cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    this.particles = [];
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.canvas = null;
    this.ctx = null;
  }

  dispose(): void {
    this.hide();
  }
}
