import { useEffect, useRef } from 'react';

/** Perspective projection gives each point a real depth and a camera-facing trail. */
export function ParticleBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;

        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const theme = window.matchMedia('(prefers-color-scheme: dark)');
        // Keep trail depth proportional to speed for a gentle sense of motion.
        const forwardSpeed = 0.045;
        const trailDuration = 0.12;
        let width = 0;
        let height = 0;
        let frame = 0;
        let lastTime = 0;
        let particles: { x: number; y: number; z: number }[] = [];
        const makeParticle = (z = 1) => ({
            x: (Math.random() - 0.5) * 3.2,
            y: (Math.random() - 0.5) * 3.2,
            z,
        });
        const draw = (delta: number) => {
            context.clearRect(0, 0, width, height);
            const focal = Math.max(width, height) * 0.48;
            context.fillStyle = theme.matches ? '#80ded0' : '#086b64';
            context.strokeStyle = context.fillStyle;
            for (let index = 0; index < particles.length; index++) {
                let particle = particles[index];
                particle.z -= delta * forwardSpeed;
                let x = width / 2 + (particle.x * focal) / particle.z;
                let y = height * 0.44 + (particle.y * focal) / particle.z;
                if (
                    particle.z < 0.08 ||
                    x < -24 ||
                    x > width + 24 ||
                    y < -24 ||
                    y > height + 24
                ) {
                    particle = particles[index] = makeParticle();
                    x = width / 2 + particle.x * focal;
                    y = height * 0.44 + particle.y * focal;
                }
                const depth = 1 - particle.z;
                context.globalAlpha =
                    (theme.matches ? 0.48 : 0.32) * Math.min(1, depth * 4);
                context.beginPath();
                context.arc(
                    x,
                    y,
                    Math.min(1.3, 0.38 / particle.z),
                    0,
                    Math.PI * 2,
                );
                context.fill();
                const previousDepth = particle.z + forwardSpeed * trailDuration;
                context.globalAlpha *= 0.65;
                context.beginPath();
                context.moveTo(
                    width / 2 + (particle.x * focal) / previousDepth,
                    height * 0.44 + (particle.y * focal) / previousDepth,
                );
                context.lineTo(x, y);
                context.lineWidth = 0.5;
                context.stroke();
            }
            context.globalAlpha = 1;
        };
        const animate = (time: number) => {
            draw(lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0);
            lastTime = time;
            frame = requestAnimationFrame(animate);
        };
        const sync = () => {
            cancelAnimationFrame(frame);
            lastTime = 0;
            draw(0);
            if (!motion.matches && !document.hidden) {
                frame = requestAnimationFrame(animate);
            }
        };
        const resize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            const ratio = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            particles = Array.from(
                {
                    length: Math.min(
                        160,
                        Math.max(50, Math.round((width * height) / 8500)),
                    ),
                },
                () => makeParticle(0.1 + Math.random() * 0.9),
            );
            sync();
        };
        resize();
        window.addEventListener('resize', resize);
        document.addEventListener('visibilitychange', sync);
        motion.addEventListener('change', sync);
        theme.addEventListener('change', sync);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', resize);
            document.removeEventListener('visibilitychange', sync);
            motion.removeEventListener('change', sync);
            theme.removeEventListener('change', sync);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="particle-background"
            aria-hidden="true"
        />
    );
}
