import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Mic,
  MicOff,
  Monitor,
  PhoneOff,
  Radio,
  ShieldCheck,
  UserRound,
  Users,
  Video,
  VideoOff,
  Wifi,
  X,
} from "lucide-react";
import "../../styles/expert-video-consultation.css";

const experts = [
  {
    id: "wang-haifeng",
    name: "王海峰",
    title: "高级工控设备检修工程师",
    organization: "国家管网集团山东德州分输站 · 设备技术组",
    specialties: ["工控机", "站控系统", "散热系统", "工业通信"],
    eta: "预计 10 秒接入",
    recommended: true,
  },
  {
    id: "zhou-qiming",
    name: "周启明",
    title: "自动化控制系统高级工程师",
    organization: "山东区域技术支持中心 · 自动化组",
    specialties: ["PLC", "DCS", "控制网络"],
    eta: "预计 30 秒接入",
  },
  {
    id: "sun-jian",
    name: "孙健",
    title: "电气与仪表检修工程师",
    organization: "德州作业区 · 仪控保障组",
    specialties: ["电源系统", "仪表回路", "联锁保护"],
    eta: "预计 1 分钟接入",
  },
];

const connectionMessages = [
  "正在创建临时会诊室",
  "正在同步设备与告警上下文",
  "正在呼叫所选专家",
  "专家已接入",
];

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function ContextPanel({ currentStep, activeStep, totalSteps }) {
  return (
    <aside className="expert-call-context" aria-label="会诊上下文">
      <header>
        <div>
          <span>CONSULTATION CONTEXT</span>
          <strong>本次会诊资料</strong>
        </div>
        <FileText size={18} />
      </header>
      <div className="expert-call-context-list">
        <article>
          <small>现场位置</small>
          <strong>山东德州分输站 · 站控柜 A01</strong>
        </article>
        <article>
          <small>设备对象</small>
          <strong>研华 ACP-4000 / IPC-610 工控机</strong>
        </article>
        <article className="alert">
          <small>关联告警</small>
          <strong>TEMP/FAN 告警 · 风扇转速偏低</strong>
        </article>
        <article className="current">
          <small>当前检修步骤 · {activeStep + 1} / {totalSteps}</small>
          <strong>{currentStep.title}</strong>
          <p>{currentStep.description}</p>
        </article>
      </div>
      <footer><Check size={13} /> 设备、告警和当前步骤已同步</footer>
    </aside>
  );
}

export default function ExpertVideoConsultation({ currentStep, activeStep, totalSteps, onClose }) {
  const [phase, setPhase] = useState("selecting");
  const [selectedExpertId, setSelectedExpertId] = useState(experts[0].id);
  const [connectionStep, setConnectionStep] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [contextVisible, setContextVisible] = useState(true);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalDuration, setFinalDuration] = useState(0);

  const selectedExpert = useMemo(
    () => experts.find((expert) => expert.id === selectedExpertId) || experts[0],
    [selectedExpertId],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key !== "Escape") return;
      if (endConfirmOpen) {
        setEndConfirmOpen(false);
      } else if (phase === "connected") {
        setEndConfirmOpen(true);
      } else if (phase === "connecting") {
        setPhase("selecting");
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [endConfirmOpen, onClose, phase]);

  useEffect(() => {
    if (phase !== "connecting") return undefined;
    setConnectionStep(0);
    const stepTimer = window.setInterval(() => {
      setConnectionStep((current) => Math.min(current + 1, connectionMessages.length - 1));
    }, 650);
    const connectedTimer = window.setTimeout(() => {
      setPhase("connected");
      setElapsedSeconds(0);
    }, 2600);
    return () => {
      window.clearInterval(stepTimer);
      window.clearTimeout(connectedTimer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "connected") return undefined;
    const timer = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  function requestClose() {
    if (phase === "connected") {
      setEndConfirmOpen(true);
      return;
    }
    if (phase === "connecting") {
      setPhase("selecting");
      return;
    }
    onClose();
  }

  function endCall() {
    setFinalDuration(elapsedSeconds);
    setEndConfirmOpen(false);
    setPhase("complete");
  }

  return createPortal(
    <div className="expert-call-backdrop" role="presentation">
      <section className="expert-call-shell" role="dialog" aria-modal="true" aria-label="专家视频会诊">
        {phase === "selecting" && (
          <div className="expert-call-selecting">
            <header className="expert-call-select-head">
              <div>
                <span className="expert-call-kicker">EXPERT CONSULTATION DESK</span>
                <h2>发起专家视频会诊</h2>
                <p>系统将把当前设备、告警与检修进度同步给接入专家。</p>
              </div>
              <button type="button" onClick={requestClose} aria-label="关闭专家视频会诊"><X size={19} /></button>
            </header>

            <div className="expert-call-select-grid">
              <main className="expert-call-expert-list">
                <div className="expert-call-section-title">
                  <div><Users size={16} /><span><small>EXPERT DISPATCH</small><strong>选择接入专家</strong></span></div>
                  <em>3 位在线</em>
                </div>
                {experts.map((expert) => {
                  const selected = expert.id === selectedExpertId;
                  return (
                    <button
                      type="button"
                      className={`expert-call-expert-card${selected ? " selected" : ""}`}
                      aria-pressed={selected}
                      onClick={() => setSelectedExpertId(expert.id)}
                      key={expert.id}
                    >
                      <span className="expert-call-avatar">{expert.name.slice(-1)}</span>
                      <span className="expert-call-expert-copy">
                        <span><strong>{expert.name}</strong>{expert.recommended && <em>系统推荐</em>}</span>
                        <b>{expert.title}</b>
                        <small>{expert.organization}</small>
                        <span className="expert-call-specialties">{expert.specialties.map((item) => <i key={item}>{item}</i>)}</span>
                      </span>
                      <span className="expert-call-availability"><i /> 在线<small>{expert.eta}</small></span>
                      <span className="expert-call-radio">{selected && <Check size={14} />}</span>
                    </button>
                  );
                })}
              </main>
              <ContextPanel currentStep={currentStep} activeStep={activeStep} totalSteps={totalSteps} />
            </div>

            <footer className="expert-call-select-actions">
              <div><ShieldCheck size={16} /><span><small>本次为演示会诊</small><strong>不会调用摄像头、麦克风或真实视频服务</strong></span></div>
              <button type="button" className="expert-call-primary" onClick={() => setPhase("connecting")}>
                <Video size={17} /> 发起视频会诊 <ChevronRight size={16} />
              </button>
            </footer>
          </div>
        )}

        {phase === "connecting" && (
          <div className="expert-call-connecting">
            <header>
              <div><span className="expert-call-live-dot" /> 专家视频会诊</div>
              <button type="button" onClick={requestClose}>取消呼叫</button>
            </header>
            <div className="expert-call-black-screen connecting">
              <div className="expert-call-scan-line" />
              <div className="expert-call-connect-status">
                <span className="expert-call-connect-rings"><Video size={26} /></span>
                <small>SECURE SESSION INITIALIZING</small>
                <h2>{connectionMessages[connectionStep]}</h2>
                <p>{selectedExpert.name} · {selectedExpert.title}</p>
                <div>{connectionMessages.map((message, index) => <i className={index <= connectionStep ? "active" : ""} key={message} />)}</div>
              </div>
              <span className="expert-call-corner corner-a" />
              <span className="expert-call-corner corner-b" />
            </div>
          </div>
        )}

        {phase === "connected" && (
          <div className={`expert-call-room${contextVisible ? " with-context" : ""}`}>
            <header className="expert-call-room-head">
              <div className="expert-call-room-title"><span className="expert-call-live-dot" /><span><small>专家视频会诊</small><strong>{currentStep.title}</strong></span></div>
              <div className="expert-call-room-meta">
                <span><ShieldCheck size={13} /> 端到端加密</span>
                <span><Wifi size={13} /> 网络良好</span>
                <strong><Clock3 size={13} /> {formatDuration(elapsedSeconds)}</strong>
                <small>会议号 0714 806 001</small>
              </div>
              <button type="button" onClick={requestClose} aria-label="关闭会诊"><X size={18} /></button>
            </header>

            <main className="expert-call-room-stage">
              <div className="expert-call-video-wall">
                <div className="expert-call-black-screen connected">
                  <div className="expert-call-video-placeholder"><VideoOff size={24} /><span>专家视频画面 · 演示占位</span></div>
                  <div className="expert-call-nameplate"><span className="expert-call-live-dot" /><strong>{selectedExpert.name}</strong><small>{selectedExpert.title}</small></div>
                  <div className="expert-call-local-tile">
                    <VideoOff size={18} />
                    <span>山东德州分输站现场终端</span>
                    <i>{cameraEnabled ? "画面演示已开启" : "摄像头已关闭"}</i>
                  </div>
                  <span className="expert-call-corner corner-a" />
                  <span className="expert-call-corner corner-b" />
                </div>
              </div>
              {contextVisible && <ContextPanel currentStep={currentStep} activeStep={activeStep} totalSteps={totalSteps} />}
            </main>

            <footer className="expert-call-controls">
              <div className="expert-call-control-group">
                <button type="button" className={!micEnabled ? "off" : ""} onClick={() => setMicEnabled((current) => !current)} title={micEnabled ? "关闭麦克风" : "开启麦克风"}>
                  {micEnabled ? <Mic size={19} /> : <MicOff size={19} />}<span>{micEnabled ? "静音" : "解除静音"}</span>
                </button>
                <button type="button" className={!cameraEnabled ? "off" : ""} onClick={() => setCameraEnabled((current) => !current)} title={cameraEnabled ? "关闭摄像头演示状态" : "开启摄像头演示状态"}>
                  {cameraEnabled ? <Video size={19} /> : <VideoOff size={19} />}<span>{cameraEnabled ? "关闭摄像头" : "开启摄像头"}</span>
                </button>
                <button type="button" title="现场画面为演示占位"><Monitor size={19} /><span>现场画面</span></button>
                <button type="button" className={contextVisible ? "active" : ""} onClick={() => setContextVisible((current) => !current)} title="切换会诊资料栏"><FileText size={19} /><span>会诊资料</span></button>
              </div>
              <div className="expert-call-room-state"><Radio size={15} /><span><small>会诊状态</small><strong>{selectedExpert.name} 已接入</strong></span></div>
              <button type="button" className="expert-call-end" onClick={() => setEndConfirmOpen(true)}><PhoneOff size={18} /> 结束会诊</button>
            </footer>

            {endConfirmOpen && (
              <div className="expert-call-confirm-backdrop" role="presentation">
                <section className="expert-call-confirm" role="alertdialog" aria-modal="true" aria-label="确认结束会诊">
                  <span><PhoneOff size={22} /></span>
                  <h3>确认结束本次会诊？</h3>
                  <p>结束后将返回检修向导，当前检修步骤和已确认项目不会丢失。</p>
                  <div><button type="button" onClick={() => setEndConfirmOpen(false)}>继续会诊</button><button type="button" onClick={endCall}>确认结束</button></div>
                </section>
              </div>
            )}
          </div>
        )}

        {phase === "complete" && (
          <div className="expert-call-complete">
            <span className="expert-call-complete-mark"><Check size={32} /></span>
            <small>CONSULTATION COMPLETE</small>
            <h2>专家会诊已结束</h2>
            <p>本次演示会诊已完成，检修向导状态保持不变。</p>
            <div className="expert-call-complete-summary">
              <article><small>接入专家</small><strong>{selectedExpert.name}</strong><span>{selectedExpert.title}</span></article>
              <article><small>会诊时长</small><strong>{formatDuration(finalDuration)}</strong><span>演示计时</span></article>
              <article><small>上下文同步</small><strong>已完成</strong><span>设备、告警、当前步骤</span></article>
            </div>
            <div className="expert-call-future-note"><ShieldCheck size={16} /><span><strong>真实视频接入边界已预留</strong><small>后续可对接企业音视频 SDK 与会诊纪要服务。</small></span></div>
            <button type="button" className="expert-call-primary" onClick={onClose}>返回检修向导 <ChevronRight size={16} /></button>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
