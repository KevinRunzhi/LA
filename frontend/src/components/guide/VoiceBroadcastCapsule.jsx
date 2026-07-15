import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, X } from "lucide-react";
import "../../styles/voice-broadcast-capsule.css";

const generationMessages = [
  "正在提取当前检修步骤",
  "正在组织安全提示与操作顺序",
  "语音播报内容已就绪",
];

const waveformEnvelope = [
  0.3, 0.42, 0.58, 0.72, 0.86, 0.95, 0.82, 0.68, 0.9, 1,
  0.88, 0.73, 0.91, 0.76, 0.61, 0.5, 0.62, 0.44, 0.32,
];

function WaveformCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let animationFrame = 0;
    let resizeObserver;

    function resizeCanvas() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function draw(time = 0) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const centerY = height / 2;
      const spacing = width / (waveformEnvelope.length + 1);
      context.clearRect(0, 0, width, height);
      context.lineCap = "round";
      context.lineWidth = 3.2;

      waveformEnvelope.forEach((envelope, index) => {
        const firstWave = Math.sin(time * (0.0042 + (index % 4) * 0.0003) + index * 0.72);
        const secondWave = Math.sin(time * 0.0027 + index * 1.31);
        const motion = reduceMotion ? 0.62 : 0.48 + ((firstWave + secondWave + 2) / 4) * 0.52;
        const barHeight = Math.max(5, height * envelope * motion);
        const x = spacing * (index + 1);
        context.strokeStyle = index >= 7 && index <= 11
          ? "rgba(111, 220, 242, 0.98)"
          : "rgba(247, 252, 255, 0.96)";
        context.beginPath();
        context.moveTo(x, centerY - barHeight / 2);
        context.lineTo(x, centerY + barHeight / 2);
        context.stroke();
      });

      if (!reduceMotion) animationFrame = window.requestAnimationFrame(draw);
    }

    resizeCanvas();
    resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      if (reduceMotion) draw(0);
    });
    resizeObserver.observe(canvas);
    animationFrame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="voice-broadcast-waveform" aria-hidden="true" />;
}

export default function VoiceBroadcastCapsule({ currentStepTitle, onClose }) {
  const [phase, setPhase] = useState("generating");
  const [generationStep, setGenerationStep] = useState(0);
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    if (phase !== "generating") return undefined;
    const messageTwoTimer = window.setTimeout(() => setGenerationStep(1), 1500);
    const messageThreeTimer = window.setTimeout(() => setGenerationStep(2), 3000);
    const broadcastTimer = window.setTimeout(() => setPhase("broadcasting"), 4500);
    const dotTimer = window.setInterval(() => setDotCount((current) => current % 3 + 1), 360);
    return () => {
      window.clearTimeout(messageTwoTimer);
      window.clearTimeout(messageThreeTimer);
      window.clearTimeout(broadcastTimer);
      window.clearInterval(dotTimer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "completing") return undefined;
    const closeTimer = window.setTimeout(onClose, 650);
    return () => window.clearTimeout(closeTimer);
  }, [onClose, phase]);

  useEffect(() => {
    function cancelOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [onClose]);

  const liveLabel = phase === "generating"
    ? `Agent 生成中。${generationMessages[generationStep]}`
    : phase === "broadcasting"
      ? `正在播报当前检修步骤：${currentStepTitle}`
      : "播报完成";

  return createPortal(
    <div className="voice-broadcast-layer">
      <section
        className={`voice-broadcast-capsule phase-${phase}`}
        role="status"
        aria-live="polite"
        aria-label={liveLabel}
      >
        {phase === "generating" && <span className="voice-broadcast-progress" aria-hidden="true" />}
        <button
          type="button"
          className="voice-broadcast-control cancel"
          onClick={onClose}
          aria-label="取消语音播报"
          title="取消语音播报"
        >
          <X size={31} strokeWidth={2.2} />
        </button>

        <div className="voice-broadcast-center">
          {phase === "generating" && (
            <div className="voice-broadcast-generating">
              <Loader2 size={18} />
              <span>
                <strong>Agent 生成中<i>{".".repeat(dotCount)}</i></strong>
                <small key={generationStep}>{generationMessages[generationStep]}</small>
              </span>
            </div>
          )}
          {phase === "broadcasting" && <WaveformCanvas />}
          {phase === "completing" && <strong className="voice-broadcast-complete-text">播报完成</strong>}
        </div>

        <span className={`voice-broadcast-control-slot${phase === "generating" ? " hidden" : ""}`}>
          <button
            type="button"
            className="voice-broadcast-control confirm"
            onClick={() => setPhase("completing")}
            disabled={phase !== "broadcasting"}
            aria-label="完成语音播报"
            title="完成语音播报"
          >
            <Check size={31} strokeWidth={2.4} />
          </button>
        </span>
      </section>
    </div>,
    document.body,
  );
}
