import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import "../../styles/home-voice-input-demo.css";

const LISTENING_DURATION_MS = 3600;

export default function VoiceInputDemoButton() {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return undefined;

    const timeoutId = window.setTimeout(() => {
      setListening(false);
    }, LISTENING_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [listening]);

  return (
    <span className="home-voice-input-control">
      <button
        className={`home-voice-input-button${listening ? " is-listening" : ""}`}
        type="button"
        onClick={() => setListening((current) => !current)}
        aria-label={listening ? "停止语音输入演示" : "开始语音输入演示"}
        aria-pressed={listening}
        title={listening ? "停止语音输入演示" : "语音输入演示"}
      >
        <span className="home-voice-wave home-voice-wave-left" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="home-voice-mic-icon" aria-hidden="true">
          <Mic size={19} strokeWidth={2.2} />
        </span>
        <span className="home-voice-wave home-voice-wave-right" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>
      <span className="home-voice-input-status" aria-live="polite">
        {listening ? "语音输入演示进行中" : ""}
      </span>
    </span>
  );
}
