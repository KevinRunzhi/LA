import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BookOpen,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Cpu,
  Download,
  FileText,
  GitBranch,
  ImagePlus,
  Layers,
  LayoutDashboard,
  Loader2,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Mic,
  Music2,
  Paperclip,
  PackageCheck,
  Play,
  Plug,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Video,
  Volume2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { api } from "./api/client";
import AdminShell from "./admin/AdminShell";
import IndustrialKnowledgeGraphPage from "./admin/knowledge-graph/IndustrialKnowledgeGraphPage";
import { presentationApi } from "./admin/presentationApi";
import { SourceCard } from "./components/chat/SourceCard";
import { StreamingMarkdown } from "./components/chat/StreamingMarkdown";
import { ThinkingProcess } from "./components/chat/ThinkingProcess";
import ExpertVideoConsultation from "./components/consultation/ExpertVideoConsultation";
import VoiceBroadcastCapsule from "./components/guide/VoiceBroadcastCapsule";
import MaintenanceJobCardPrint from "./components/records/MaintenanceJobCardPrint";
import { defaultInput } from "./data/fallbackDemo";
import { maintenanceReferenceFallback, normalizeMaintenanceReferences } from "./data/maintenanceReferenceCatalog";
import { assistantSources, buildMaintenanceAnswer, retrievalStatuses } from "./data/streamingAssistantDemo";

const navItems = [
  { id: "workbench", label: "工作台", icon: LayoutDashboard },
  { id: "graph", label: "知识图谱", icon: GitBranch },
  { id: "records", label: "检修记录", icon: ClipboardList },
  { id: "settings", label: "设置", icon: Settings },
];

const PRESENTATION_CASE_ID = "CASE-ACP4000-001";
const maintenanceResultTemplate = {
  finalCause: "滤网积尘导致风道阻力升高，风扇老化导致转速持续偏低",
  actualResolution: "清理滤网并更换老化风扇，核对 FAN1/FAN2 接线",
  recoveryResult: "TEMP/FAN 告警解除，设备恢复正常",
  fanSpeedRpm: 1280,
  systemTemperatureC: 42,
  cpuTemperatureC: 58,
  observationMinutes: 15,
  residualRisk: "无明显遗留风险",
};

function recordFromFeedbackPackage(feedbackPackage, caseStatus) {
  if (!feedbackPackage) return null;
  const result = feedbackPackage.maintenanceResult || {};
  return {
    record_id: feedbackPackage.recordId || "REC-ACP4000-001",
    equipment: feedbackPackage.incident?.equipment || "研华 ACP-4000 / IPC-610 工控机",
    fault: feedbackPackage.incident?.fault || "高温告警 / 风道堵塞 / 散热异常",
    conclusion: feedbackPackage.diagnosis?.conclusion || result.recoveryResult || "检修已完成",
    expert_status: caseStatus === "archived_with_knowledge" ? "已审核" : "待审核",
    completed_steps: (feedbackPackage.completedSteps || []).map((step, index) => (
      typeof step === "string" ? { id: `submitted-step-${index}`, title: step, completed: true, checks: [] } : step
    )),
    safety_confirmed: true,
  };
}

const AGENT_STREAM_DELAY_MIN = 600;
const AGENT_STREAM_DELAY_MAX = 1800;

function getRandomAgentStreamDelay() {
  return Math.round(
    AGENT_STREAM_DELAY_MIN
      + Math.random() * (AGENT_STREAM_DELAY_MAX - AGENT_STREAM_DELAY_MIN),
  );
}

const intakeTasks = [
  {
    title: "确认发生时间",
    value: "2026-07-10 10:25 · 持续约 10 分钟",
    detail: "确认异常首次发现时间、持续时长和是否重复发生。",
  },
  {
    title: "确认发生地点",
    value: "山东德州分输站 · 站控柜 A01",
    detail: "根据现场描述与设备台账匹配场站、区域和机柜位置，并由工程师确认。",
  },
  {
    title: "确认发生事件",
    value: "研华 ACP-4000 / IPC-610",
    detail: "确认主演示设备为站控柜内工控机整机，不进入 PLC 控制柜完整诊断。",
  },
  {
    title: "补充其他现象",
    value: "TEMP/FAN 告警，风扇转速偏低",
    detail: "重点确认风扇 <500 rpm、系统温度 >55°C、CPU 温度 >70°C 等判断条件。",
  },
  {
    title: "核对依据与手册",
    value: "告警标准、设备台账、操作手册",
    detail: "查看系统本次判断使用的标准、台账、案例和设备操作手册。",
  },
  {
    title: "异常事件确认",
    value: "准备触发诊断",
    detail: "确认现场现象、设备型号和阈值信息后，启动多 Agent 分析诊断。",
  },
];

const diagnosisTasks = [
  {
    title: "触发诊断",
    value: "散热异常方向",
    detail: "基于异常接入阶段已确认的信息，启动散热异常方向的预设诊断流程。",
  },
  {
    title: "多 Agent 会诊",
    value: "分析、合规、知识检索",
    detail: "依次完成问题分析、操作合规检查和维修知识检索，形成诊断证据。",
  },
  {
    title: "弹出并生成诊断结论",
    value: "生成整版报告",
    detail: "所有 Agent 完成后，统一输出结构化诊断结论和进入检修向导入口。",
  },
];

const consultationAgentDetails = [
  {
    role: "故障机理分析",
    input: "异常描述、ACP-4000 / IPC-610、TEMP/FAN 告警与运行值",
    lines: ["拆分灯态、声音、转速和温度现象", "关联风道、滤网与风扇模块", "比较风扇低速和温升发生关系", "形成散热异常候选原因"],
    sources: ["现场异常事件全景", "设备台账 · 站控柜 A01", "TEMP/FAN 告警规则"],
    result: "风道受阻或风扇低速的可能性较高，进入散热异常诊断方向。",
  },
  {
    role: "维修知识检索",
    input: "设备对象、候选原因和告警阈值",
    lines: ["检索 ACP-4000 / IPC-610 散热结构", "命中风扇低于 500 rpm 判据", "比对系统温度与 CPU 温度阈值", "关联历史积尘与风扇故障案例"],
    sources: ["KB-001 · 散热系统结构", "KB-003 · 风扇转速阈值", "KB-004 · 温度判断条件"],
    result: "证据共同指向风道、滤网和风扇模块，应优先检查散热链路。",
  },
  {
    role: "操作安全与合规",
    input: "诊断方向、拟检查部件和现场作业边界",
    lines: ["校验断电与挂牌前置条件", "检查防静电和冷却等待要求", "核对风道、滤网、风扇拆检顺序", "补充恢复上电与持续观察要求"],
    sources: ["设备操作手册 · 安全章节", "现场检修作业规范", "历史检修记录 · 恢复验证"],
    result: "完成断电、挂牌和防静电确认后，可进入步骤式检修预方案。",
  },
];

const phaseSteps = [
  {
    title: "异常接入",
    items: intakeTasks.map((item) => item.title),
  },
  {
    title: "分析诊断",
    items: diagnosisTasks.map((item) => item.title),
  },
  {
    title: "检修向导",
    items: ["安全准备", "风道检查", "滤网/风扇检查", "恢复验证"],
  },
  {
    title: "记录与回流",
    items: ["生成检修记录", "专家审核", "知识沉淀"],
  },
];

const equipmentOptionGroups = [
  {
    label: "设备型号",
    helper: "推荐型号匹配",
    source: "设备台账",
    options: [
      "研华 ACP-4000 / IPC-610",
      "Rockwell ASEM 6300B-EW1 Box PC",
      "Rockwell ASEM 6300P-EW1 Panel PC",
      "Allen-Bradley 6177R 750R 工控机",
      "Allen-Bradley 6177R 1450R 工控机",
      "Rockwell ControlLogix 1756-L8x 控制器",
      "浙大中控 SUPCON ECS-700 控制站",
      "浙大中控 SUPCON JX-300XP 控制站",
      "霍尼韦尔 Experion PKS C300 控制器",
      "霍尼韦尔 ControlEdge PLC",
      "西门子 IPC647E 工控机",
    ],
  },
  {
    label: "设备角色",
    helper: "系统角色确认",
    source: "设备台账",
    options: [
      "站控画面与数据采集终端",
      "站控数据采集与业务软件运行终端",
      "现场操作员站与一体化人机界面",
      "机架式站控服务器与历史数据终端",
      "PLC 逻辑控制与 I/O 协调单元",
      "DCS 控制站冗余控制单元",
      "DCS 过程控制与安全联锁单元",
      "工程师站与监控终端",
    ],
  },
  {
    label: "关联告警",
    helper: "异常信号确认",
    source: "现场描述 + 告警规则",
    options: [
      "TEMP/FAN、蜂鸣、温度升高",
      "仅温度升高（无 TEMP/FAN）",
      "Power LED 熄灭 / 24 V DC 启动欠压",
      "POST 致命错误 / 启动失败",
      "控制器 OK 红闪 / Major Fault",
      "冗余电源单路失电 / I/O 通道故障",
      "C300 冗余切换 / I/O LINK 通信故障",
      "通信中断 / 数据不上送",
    ],
  },
];

const equipmentProfileDefaults = {
  "研华 ACP-4000 / IPC-610": ["站控画面与数据采集终端", "TEMP/FAN、蜂鸣、温度升高"],
  "Rockwell ASEM 6300B-EW1 Box PC": ["站控数据采集与业务软件运行终端", "Power LED 熄灭 / 24 V DC 启动欠压"],
  "Rockwell ASEM 6300P-EW1 Panel PC": ["现场操作员站与一体化人机界面", "Power LED 熄灭 / 24 V DC 启动欠压"],
  "Allen-Bradley 6177R 750R 工控机": ["机架式站控服务器与历史数据终端", "POST 致命错误 / 启动失败"],
  "Allen-Bradley 6177R 1450R 工控机": ["机架式站控服务器与历史数据终端", "POST 致命错误 / 启动失败"],
  "Rockwell ControlLogix 1756-L8x 控制器": ["PLC 逻辑控制与 I/O 协调单元", "控制器 OK 红闪 / Major Fault"],
  "浙大中控 SUPCON ECS-700 控制站": ["DCS 控制站冗余控制单元", "冗余电源单路失电 / I/O 通道故障"],
  "浙大中控 SUPCON JX-300XP 控制站": ["DCS 控制站冗余控制单元", "冗余电源单路失电 / I/O 通道故障"],
  "霍尼韦尔 Experion PKS C300 控制器": ["DCS 过程控制与安全联锁单元", "C300 冗余切换 / I/O LINK 通信故障"],
  "霍尼韦尔 ControlEdge PLC": ["PLC 逻辑控制与 I/O 协调单元", "通信中断 / 数据不上送"],
  "西门子 IPC647E 工控机": ["工程师站与监控终端", "POST 致命错误 / 启动失败"],
};

function getIntakeBranch(selections, thresholdValues) {
  const model = selections["设备型号"] || "";
  const alarm = selections["关联告警"] || "";
  const led = thresholdValues["TEMP/FAN LED"] || "";
  const fan = thresholdValues["风扇转速"] || "";

  if (/ControlLogix|ECS-700|JX-300XP|C300|ControlEdge|PLC/.test(model) || /Major Fault|I\/O|通信|数据不上送|冗余电源/.test(alarm)) {
    return {
      id: "equipment-mismatch",
      label: "设备链路重新评估",
      tone: "danger",
      title: "当前设备或告警与散热知识链不一致",
      detail: "系统已暂停沿用工控机散热结论，下一步应补充控制器状态、通信模块和数据上送信息。",
      diagnosis: "控制器 / 通信链路待补充",
    };
  }

  if (/Power LED|24 V DC/.test(alarm)) {
    return {
      id: "industrial-computer-power",
      label: "直流供电链路评估",
      tone: "warning",
      title: "当前异常指向工控机直流供电链路",
      detail: "下一步应核对设备端输入电压、Power LED、接线端子和系统启动完整性。",
      diagnosis: "工控机直流供电异常方向",
    };
  }

  if (/POST|启动失败/.test(alarm)) {
    return {
      id: "industrial-computer-startup",
      label: "整机启动链路评估",
      tone: "warning",
      title: "当前异常指向工控机上电自检或启动链路",
      detail: "下一步应核对电源状态、POST 结果、显示输出和系统启动完整性。",
      diagnosis: "工控机 POST / 启动异常方向",
    };
  }

  if (alarm.includes("无 TEMP/FAN") || led.includes("正常") || led.includes("未点亮")) {
    return {
      id: "thermal-without-alarm",
      label: "告警证据重新评估",
      tone: "warning",
      title: "强告警证据减少，调整诊断优先级",
      detail: "TEMP/FAN 未告警但温度仍偏高，优先核对环境温度、风道积尘和温度传感器。",
      diagnosis: "环境散热 / 传感器复核优先",
    };
  }

  if (fan && !fan.includes("<") && !fan.includes("低")) {
    return {
      id: "normal-fan",
      label: "运行值重新评估",
      tone: "warning",
      title: "风扇转速未显示低速特征",
      detail: "诊断重点由风扇故障调整为机柜环境、风道阻塞和温度采集偏差。",
      diagnosis: "环境散热路径优先",
    };
  }

  return {
    id: "standard-thermal",
    label: "标准散热分支",
    tone: "success",
    title: "告警与运行值共同指向散热链路",
    detail: "TEMP/FAN 告警、风扇低速和温度升高相互印证，继续生成散热异常诊断任务。",
    diagnosis: "工控机散热异常方向",
  };
}

const thresholdInputs = [
  ["TEMP/FAN LED", "告警", "保留告警状态", "前面板告警灯点亮或蜂鸣提示"],
  ["风扇转速", "< 500 rpm", "建议作为高优先级条件", "风扇转速偏低，优先检查滤网、风道和风扇"],
  ["系统温度", "> 55°C", "触发散热异常判断", "触发散热异常判断"],
  ["CPU 温度", "> 70°C", "判断过热风险", "结合系统温度判断过热风险"],
];

const controlBranchInputs = [
  ["控制器 RUN LED", "运行", "采用控制器运行状态", "确认控制器是否仍处于运行态"],
  ["通信模块 LINK", "异常", "标记通信链路异常", "核对通信模块、交换机端口与链路灯"],
  ["数据上送", "中断", "标记数据上送中断", "确认站控画面是否持续收到设备数据"],
  ["电源状态", "正常", "保留电源正常状态", "排除控制器或通信模块掉电"],
];

const industrialComputerPowerInputs = [
  ["Power LED 状态", "熄灭", "记录设备电源指示状态", "确认设备端是否已经获得有效输入电源"],
  ["设备端输入电压", "11.6 V", "记录启动瞬间最低电压", "与铭牌和对应型号手册的输入范围比较"],
  ["DC 端子状态", "疑似松动", "记录端子与极性状态", "检查端头紧固、极性和应力释放"],
  ["系统启动状态", "无法稳定启动", "记录业务系统恢复情况", "确认操作系统与站控业务软件是否完整启动"],
];

const industrialComputerStartupInputs = [
  ["电源 / 健康指示灯", "已上电", "记录整机供电与健康状态", "先区分未供电和上电后自检失败"],
  ["POST 结果", "致命错误", "记录上电自检结果", "区分内存、存储、外设和主板启动故障"],
  ["显示输出", "无有效画面", "记录本地显示状态", "核对显示链路和启动错误信息"],
  ["系统启动状态", "启动失败", "记录操作系统启动情况", "确认引导设备、系统镜像和业务软件状态"],
];

function getBranchThresholdInputs(intakeBranch) {
  if (intakeBranch?.id === "equipment-mismatch") return controlBranchInputs;
  if (intakeBranch?.id === "industrial-computer-power") return industrialComputerPowerInputs;
  if (intakeBranch?.id === "industrial-computer-startup") return industrialComputerStartupInputs;
  return thresholdInputs;
}

const guideVisuals = {
  "step-01-location": {
    defaultImage: "/images/guide/ipc-panel-indicators.png",
    defaultAlt: "工控机前面板与指示灯区域",
    frames: [
      {
        label: "TEMP/FAN 指示灯区域",
        status: "灯组确认",
        check: "TEMP/FAN 灯状态",
        image: "/images/guide/guide-step01-temp-fan.png",
        detail: "查看已标注的 TEMP/FAN 灯组：绿灯表示正常，红灯表示异常。当前演示按红灯异常进入散热告警排查。",
      },
      {
        label: "双风扇模块",
        status: "转速确认",
        check: "风扇 rpm",
        image: "/images/guide/guide-step01-fan-rpm.png",
        detail: "查看已标注的双风扇模块，结合现场声音和状态判断风扇是否低速、异响或停转。",
      },
      {
        label: "蜂鸣/告警指示面板",
        status: "告警确认",
        check: "蜂鸣器状态",
        image: "/images/guide/ipc-panel-indicators.png",
        detail: "当前暂无单独标注图。若现场伴随蜂鸣，结合指示灯区域判断：绿灯正常，红灯异常。",
      },
      {
        label: "温度灯组",
        status: "温度确认",
        check: "系统/CPU 温度",
        image: "/images/guide/guide-step01-temp-cpu.png",
        detail: "查看已标注的温度灯组：绿灯表示正常，红灯表示异常。这里不展示具体温度数值，只确认灯态。",
      },
    ],
  },
  "step-02-safety": {
    defaultImage: "/images/guide/guide-step02-front-view.png",
    defaultAlt: "工控机前视图与安全准备位置",
    frames: [
      {
        label: "通知负责人",
        status: "安全确认",
        check: "通知负责人",
        image: "/images/guide/guide-step02-front-view.png",
        detail: "开始安全准备前，先通知值班负责人，确认当前设备可以进入检修流程。",
      },
      {
        label: "正常关机",
        status: "电源确认",
        check: "正常关机",
        image: "/images/guide/guide-step02-shutdown-switch.png",
        detail: "按正常流程关闭系统，确认电源开关位置，避免直接带电拆装。",
      },
      {
        label: "拔除所有电源",
        status: "断电确认",
        check: "拔除所有电源",
        image: "/images/guide/guide-step02-unplug-power.png",
        detail: "关机后拔除所有电源线，确认设备处于断电状态后再进入后续检查。",
      },
      {
        label: "等待冷却",
        status: "冷却确认",
        check: "等待冷却",
        image: "/images/guide/guide-step02-front-view.png",
        detail: "设备断电后等待冷却，避免高温部件导致烫伤或误判。",
      },
      {
        label: "防静电",
        status: "防护确认",
        check: "防静电",
        image: "/images/guide/guide-step02-front-view.png",
        detail: "执行拆检前佩戴防静电手环，避免静电损伤工控机部件。",
      },
    ],
  },
  "step-03-airflow": {
    defaultImage: "/images/guide/guide-step03-env-temperature.png",
    defaultAlt: "工控机机柜环境与风道检查",
    frames: [
      {
        label: "环境温度",
        status: "环境确认",
        check: "环境温度 ≤ 40°C",
        image: "/images/guide/guide-step03-env-temperature.png",
        detail: "进入风道检查时，先确认机柜环境温度不高于 40°C，再继续检查通风条件。",
      },
      {
        label: "进风口",
        status: "风道确认",
        check: "进风口无遮挡",
        image: "/images/guide/guide-step03-air-in-out.png",
        detail: "查看已标注的风扇/风道区域，确认进风口没有遮挡物和明显积尘。",
      },
      {
        label: "出风口",
        status: "风道确认",
        check: "出风口无遮挡",
        image: "/images/guide/guide-step03-air-in-out.png",
        detail: "查看已标注的风扇/风道区域，确认出风口保持畅通，热风可以正常排出。",
      },
      {
        label: "机箱开孔",
        status: "开孔确认",
        check: "机箱开孔无遮挡",
        image: "/images/guide/guide-step03-chassis-openings.png",
        detail: "查看已标注的机箱开孔区域，确认开孔无遮挡，避免影响空气流通。",
      },
    ],
  },
  "step-04-filter-fan": {
    defaultImage: "/images/guide/guide-step04-door-filter.jpg",
    defaultAlt: "滤网、风扇和 FAN 接线检查示意",
    frames: [
      {
        label: "门滤网检查",
        status: "滤网确认",
        check: "门滤网积尘",
        image: "/images/guide/guide-step04-door-filter.jpg",
        detail: "查看前部门滤网拆装示意，确认滤网是否积尘、堵塞或变形。",
      },
      {
        label: "风扇滤网检查",
        status: "滤网确认",
        check: "风扇滤网积尘",
        image: "/images/guide/guide-step04-fan-filter.jpg",
        detail: "查看风扇滤网拆装示意，确认滤网是否积尘并影响进风。",
      },
      {
        label: "风扇模块检查",
        status: "风扇确认",
        check: "风扇异响/停转/低速",
        image: "/images/guide/guide-step04-fan-module.png",
        detail: "查看风扇模块结构，确认是否存在异响、停转或低速运行。",
      },
      {
        label: "FAN 接线顺序",
        status: "接线确认",
        check: "FAN1/FAN2 顺序",
        image: "/images/guide/guide-step04-fan-wiring.jpg",
        detail: "查看智能告警板 FAN 接口标签；拆线前拍照和标记，两只风扇应连续接入 FAN1、FAN2，不能跳号。",
      },
    ],
  },
  "step-05-verify": {
    defaultImage: "/images/guide/guide-step02-front-view.png",
    defaultAlt: "工控机恢复运行与验证前视图",
    frames: [
      {
        label: "告警解除",
        status: "恢复确认",
        check: "TEMP/FAN 告警解除",
        image: "/images/guide/guide-step02-front-view.png",
        detail: "恢复供电后观察前面板状态，确认 TEMP/FAN 告警解除，无持续蜂鸣或异常提示。",
      },
      {
        label: "风扇运行",
        status: "转速确认",
        check: "风扇 > 500 rpm",
        image: "/images/guide/guide-step02-front-view.png",
        detail: "恢复运行后确认风扇正常转动，转速恢复到安全范围，再继续观察温度变化。",
      },
      {
        label: "系统温度",
        status: "温度确认",
        check: "系统 ≤ 55°C",
        image: "/images/guide/guide-step02-front-view.png",
        detail: "确认系统温度回落到允许范围，避免清理后仍存在散热不足。",
      },
      {
        label: "CPU 温度",
        status: "温度确认",
        check: "CPU ≤ 70°C",
        image: "/images/guide/guide-step02-front-view.png",
        detail: "确认 CPU 温度处于允许范围，若仍持续升高，需要返回风道和风扇检查。",
      },
      {
        label: "数据上传",
        status: "通信确认",
        check: "数据上传稳定",
        image: "/images/guide/guide-step02-front-view.png",
        detail: "连续观察运行状态和数据上传，确认设备恢复后站控数据保持稳定。",
      },
    ],
  },
};

const generatedDiagnosisPlan = [
  "解析现场异常描述与告警信号",
  "匹配 ACP-4000 / IPC-610 散热结构",
  "检索 TEMP/FAN、风扇转速和温度阈值",
  "生成散热异常诊断结论与检修向导",
];

const intakeTransitionAgents = [
  {
    agentName: "时间解析 Agent",
    runningTitle: "时间解析 Agent 正在生成下一步",
    doneTitle: "时间解析 Agent 已生成下一步",
    runningSubtitle: "正在根据已确认时间生成发生地点任务",
    doneSubtitle: "已生成“确认发生地点”任务",
    lines: [
      "异常发生时间已由工程师确认，系统正在整理事件时间线。",
      "已记录持续时长和重复发生情况，正在关联现场描述。",
      "匹配场站设备台账：当前异常可能位于控制中心 / 站控柜 A01。",
      "生成下一步任务：确认发生地点。",
    ],
    evidence: [
      "现场异常描述：温度告警、风扇声音异常、风扇转速偏低",
      "场站位置提示：控制中心 / 站控柜 A01 / 工控机区域",
      "异常接入规则：先确认时间，再确认发生地点",
      "知识图谱节点：站控柜、工控机、散热异常、TEMP/FAN 告警",
      "MVP 演示流程：时间确认后生成地点识别任务",
    ],
    result: "已生成发生地点确认任务。下一步请确认场站、控制中心和站控柜位置。",
  },
  {
    agentName: "位置识别 Agent",
    runningTitle: "位置识别 Agent 正在生成下一步",
    doneTitle: "位置识别 Agent 已生成下一步",
    runningSubtitle: "正在根据已确认地点生成发生事件任务",
    doneSubtitle: "已生成“确认发生事件”任务",
    lines: [
      "设备位置已由工程师确认，系统正在读取站控柜 A01 设备台账。",
      "匹配到工控机、PLC 控制柜、通信模块等已登记设备对象。",
      "当前异常描述与工控机散热告警特征相关，需要进一步确认具体型号和角色。",
      "生成下一步任务：确认发生事件。",
    ],
    evidence: [
      "位置确认：山东德州分输站 / 控制中心 / 站控柜 A01",
      "设备台账：站控柜 A01 已登记工控机与控制模块",
      "现场材料：图片、视频和音频证据集合",
      "异常关键词：温度告警、风扇声音异常、风扇转速偏低",
      "接入规则：位置确认后补充设备型号、角色与关联告警",
    ],
    result: "已生成发生事件确认任务。下一步请确认设备型号、设备角色和关联告警。",
  },
  {
    agentName: "设备识别 Agent",
    runningTitle: "设备识别 Agent 正在生成下一步",
    doneTitle: "设备识别 Agent 已生成下一步",
    runningSubtitle: "正在根据发生事件生成其他现象补充任务",
    doneSubtitle: "已生成“补充其他现象”任务",
    lines: [
      "设备对象已补充，系统正在核对站控柜 A01 内工控机信息。",
      "识别到主演示设备：研华 ACP-4000 / IPC-610 工控机。",
      "匹配散热异常判据：TEMP/FAN 灯、蜂鸣器、风扇转速、系统温度、CPU 温度。",
      "生成下一步任务：补充其他现象。",
    ],
    evidence: [
      "设备型号：研华 ACP-4000 / IPC-610",
      "设备位置：控制中心 / 站控柜 A01",
      "设备角色：站控机 / 工控机",
      "维修指导：ACP-4000 / IPC-610 散热与风扇模块检查项",
      "告警知识：TEMP/FAN、蜂鸣器、风扇 rpm、系统温度、CPU 温度",
    ],
    result: "已生成其他现象补充任务。下一步请核对灯态、蜂鸣器、风扇转速、温度阈值和现场材料。",
  },
  {
    agentName: "依据检索 Agent",
    runningTitle: "依据检索 Agent 正在生成下一步",
    doneTitle: "依据检索 Agent 已生成下一步",
    runningSubtitle: "正在根据事件与现象检索依据标准和操作手册",
    doneSubtitle: "已生成“依据标准与操作手册”任务",
    lines: [
      "灯态与阈值信息已接入，系统正在判断异常信号是否指向散热链路。",
      "TEMP/FAN 告警、风扇低速和温度升高共同指向风道或风扇模块异常。",
      "正在命中设备台账、告警阈值、历史案例和操作手册章节。",
      "生成下一步任务：核对依据标准与操作手册。",
    ],
    evidence: [
      "TEMP/FAN 灯态：红灯为异常，绿灯为正常",
      "风扇状态：转速偏低或停转会触发散热异常方向",
      "阈值规则：风扇 rpm、系统温度、CPU 温度共同参与判断",
      "知识图谱节点：灯态、蜂鸣器、风扇模块、温度阈值",
      "安全提示：进入拆检前必须完成异常事件确认",
    ],
    result: "已生成依据标准与操作手册任务。下一步请核对系统本次判断使用的资料。",
  },
  {
    agentName: "事件归集 Agent",
    runningTitle: "事件归集 Agent 正在形成最终页面",
    doneTitle: "事件归集 Agent 已完成",
    runningSubtitle: "正在归集时间、地点、事件、现象与依据",
    doneSubtitle: "已生成“现场异常事件全景”页面",
    lines: [
      "发生时间、发生地点、发生事件和其他现象均已确认。",
      "依据标准与操作手册已完成核对。",
      "正在整理本次诊断方向和可用现场材料。",
      "生成下一步页面：现场异常事件全景。",
    ],
    evidence: [
      "已确认发生时间与持续时长",
      "已确认场站、控制中心和站控柜位置",
      "已确认设备对象与关联告警",
      "已确认运行状态与现场材料",
      "已核对告警标准与设备操作手册",
    ],
    result: "已生成现场异常事件全景。下一步请复核系统归集的事件信息，再启动智能诊断。",
  },
];

const diagnosisTransitionAgents = [
  {
    agentName: "结论生成 Agent",
    runningTitle: "结论生成 Agent 正在生成下一步",
    doneTitle: "结论生成 Agent 已生成下一步",
    runningSubtitle: "正在把多 Agent 会诊结果整理为诊断结论页面",
    doneSubtitle: "已生成“弹出并生成诊断结论”页面",
    lines: [
      "多 Agent 会诊已完成，系统正在汇总分析诊断、操作合规和知识检索结果。",
      "正在检索 TEMP/FAN 告警、风扇转速偏低、系统温度升高等知识图谱节点。",
      "正在对可能原因排序：风道堵塞 / 滤网积尘、风扇低速或停转、机柜环境通风异常。",
      "生成下一步页面：弹出并生成诊断结论。",
    ],
    evidence: [
      "分析诊断 Agent 输出：优先检查风道堵塞、滤网积尘和风扇异常",
      "操作合规 Agent 输出：拆检前必须正常关机、拔除电源并佩戴防静电手环",
      "知识检索 Agent 输出：命中 TEMP/FAN 告警、风扇转速 <500 rpm、系统温度 >55°C",
      "ACP-4000 / IPC-610 散热系统资料",
      "相似故障案例：工控机高温告警与风道堵塞",
      "知识图谱节点：工控机、散热异常、风扇模块、滤网积尘",
    ],
    result: "已生成诊断结论页面。下一步请查看可能原因排序，并决定是否进入步骤式检修向导。",
  },
  {
    agentName: "检修编排 Agent",
    runningTitle: "检修编排 Agent 正在生成下一步",
    doneTitle: "检修编排 Agent 已生成下一步",
    runningSubtitle: "正在把诊断结论整理为可编辑检修预方案",
    doneSubtitle: "已生成“检修预方案确认”页面",
    lines: [
      "诊断结论已确认，系统正在把散热异常结论转成可编辑的两级检修大纲。",
      "正在匹配安全作业顺序：先确认告警与设备位置，再进入断电隔离和风道检查。",
      "正在生成大步骤标题、所属小维修步骤、依据角标和安全说明。",
      "生成下一步页面：检修预方案确认。",
    ],
    evidence: [
      "诊断结论：一次工控机散热相关异常",
      "可能原因排序：风道堵塞 / 滤网积尘、风扇低速或停转、机柜环境异常",
      "安全检修规则：先确认告警与定位，再执行断电和拆检",
      "维修指导：ACP-4000 / IPC-610 散热系统检修步骤",
      "MVP 检修向导结构：告警定位、安全隔离、风道检查、部件检查、恢复验证",
    ],
    result: "已生成可编辑检修预方案。下一步请调整大步骤和小维修步骤，确认后再进入检修向导。",
  },
];

function getBranchTransitionConfig(intakeBranch, fromIndex, fallback) {
  if (intakeBranch?.id === "equipment-mismatch" && fromIndex === 2) {
    return {
      ...fallback,
      runningSubtitle: "正在重新评估设备对象并生成控制器/通信状态任务",
      doneSubtitle: "已生成“控制器与通信状态确认”页面",
      lines: [
        "工程师已将设备对象修正为 PLC 控制柜，系统停止沿用工控机散热知识链。",
        "关联告警已变更为通信中断 / 数据不上送，当前需要核对控制器与通信模块状态。",
        "重新生成确认字段：控制器 RUN、通信 LINK、数据上送、电源状态。",
        "生成下一步页面：控制器与通信状态确认。",
      ],
      evidence: [
        "工程师修正：设备型号为 PLC 控制柜",
        "工程师修正：设备角色为 PLC 逻辑控制单元",
        "关联告警：通信中断 / 数据不上送",
        "设备台账：控制器、通信模块与电源模块",
        "分支规则：设备或告警不一致时停止沿用散热结论",
      ],
      result: "已根据工程师修正重新生成控制器与通信状态任务，不再使用 TEMP/FAN 散热字段。",
    };
  }

  if (intakeBranch?.id === "equipment-mismatch" && fromIndex === 4) {
    return {
      ...fallback,
      runningSubtitle: "正在归集控制器与通信异常事件",
      doneSubtitle: "已生成“控制器 / 通信链路事件全景”",
      lines: [
        "控制器与通信状态已接入，系统正在核对 RUN、LINK、数据上送和电源状态。",
        "当前输入指向控制器 / 通信链路，不再沿用工控机散热异常方向。",
        "整理诊断输入：PLC 设备对象、通信告警、控制器状态和数据上送状态。",
        "生成下一步页面：现场异常事件全景。",
      ],
      evidence: [
        "控制器 RUN 状态",
        "通信模块 LINK 状态",
        "数据上送状态",
        "电源状态",
        "工程师对设备与告警的修正记录",
      ],
      result: "已生成控制器 / 通信链路事件全景，下一步请复核后启动诊断。",
    };
  }

  if (intakeBranch?.id === "thermal-without-alarm" && fromIndex === 4) {
    return {
      ...fallback,
      lines: [
        "TEMP/FAN 未显示告警，但系统温度与 CPU 温度仍偏高。",
        "强告警证据减少，系统降低风扇故障优先级。",
        "重新排序诊断方向：环境温度、风道积尘、温度传感器优先。",
        "生成下一步页面：现场异常事件全景。",
      ],
      result: "已按无灯态高温分支生成摘要，下一步优先复核环境散热与温度传感器。",
    };
  }

  return fallback;
}

const guideTransitionAgents = [
  {
    agentName: "安全隔离 Agent",
    runningTitle: "安全隔离 Agent 正在生成下一步",
    doneTitle: "安全隔离 Agent 已生成下一步",
    runningSubtitle: "正在根据告警定位结果生成安全隔离页面",
    doneSubtitle: "已生成“安全隔离与断电”页面",
    lines: [
      "告警与设备位置已确认，系统正在判断是否允许进入拆检前准备。",
      "正在匹配站控柜 A01 工控机的断电、冷却和防静电要求。",
      "正在生成工程师逐项确认的安全检查项。",
      "生成下一步页面：安全隔离与断电。",
    ],
    evidence: [
      "当前设备位置：控制中心 / 站控柜 A01 / 工控机区域",
      "告警确认结果：TEMP/FAN 异常、蜂鸣器状态、风扇状态",
      "安全规则：通知负责人、正常关机、拔除电源、等待冷却",
      "防静电要求：拆检前佩戴防静电手环",
      "ACP-4000 / IPC-610 维护注意事项",
    ],
    result: "已生成安全隔离与断电页面。下一步请按顺序完成负责人通知、正常关机、断电冷却和防静电确认。",
  },
  {
    agentName: "风道检查 Agent",
    runningTitle: "风道检查 Agent 正在生成下一步",
    doneTitle: "风道检查 Agent 已生成下一步",
    runningSubtitle: "正在根据安全隔离状态生成环境与风道检查页面",
    doneSubtitle: "已生成“检查机柜环境与风道”页面",
    lines: [
      "安全隔离已完成，系统正在生成非带电状态下的环境与风道检查项。",
      "正在匹配环境温度、进风口、出风口和机箱开孔无遮挡要求。",
      "正在组织图片提示和逐项勾选检查顺序。",
      "生成下一步页面：检查机柜环境与风道。",
    ],
    evidence: [
      "安全隔离结果：已完成关机、断电、冷却和防静电确认",
      "环境要求：机柜环境温度小于等于 40°C",
      "进风口 / 出风口无遮挡要求",
      "机箱开孔无遮挡要求",
      "散热异常知识节点：风道堵塞、通风条件异常",
    ],
    result: "已生成机柜环境与风道检查页面。下一步请确认环境温度、进风口、出风口和机箱开孔是否无遮挡。",
  },
  {
    agentName: "散热部件检查 Agent",
    runningTitle: "散热部件检查 Agent 正在生成下一步",
    doneTitle: "散热部件检查 Agent 已生成下一步",
    runningSubtitle: "正在根据风道检查结果生成滤网、风扇与接线页面",
    doneSubtitle: "已生成“检查滤网、风扇与接线”页面",
    lines: [
      "环境与风道检查已完成，系统正在进入散热部件层面的检查编排。",
      "正在匹配门滤网、风扇滤网、风扇异响、低速停转和 FAN1/FAN2 接线顺序。",
      "正在生成滤网、风扇模块和接线示意的检查项。",
      "生成下一步页面：检查滤网、风扇与接线。",
    ],
    evidence: [
      "风道检查结果：环境温度、进风口、出风口、机箱开孔已确认",
      "维修指导：滤网拆装与清理说明",
      "风扇模块检查项：积尘、异响、低速、停转",
      "FAN1/FAN2 接线与灯态知识节点",
      "相似案例：滤网积尘导致工控机温度告警",
    ],
    result: "已生成滤网、风扇与接线检查页面。下一步请检查滤网积尘、风扇状态和 FAN 接线顺序。",
  },
  {
    agentName: "恢复验证 Agent",
    runningTitle: "恢复验证 Agent 正在生成下一步",
    doneTitle: "恢复验证 Agent 已生成下一步",
    runningSubtitle: "正在根据散热部件处理结果生成恢复验证页面",
    doneSubtitle: "已生成“恢复运行与验证”页面",
    lines: [
      "滤网、风扇与接线检查已完成，系统正在生成恢复上电后的验证步骤。",
      "正在匹配风扇转速、系统温度、CPU 温度和连续观察时间要求。",
      "正在生成恢复运行、告警解除、数据上传稳定性的确认项。",
      "生成下一步页面：恢复运行与验证。",
    ],
    evidence: [
      "散热部件检查结果：滤网、风扇、接线已处理",
      "阈值规则：风扇转速恢复到正常范围",
      "阈值规则：系统温度和 CPU 温度恢复到安全范围",
      "恢复验证要求：连续观察不少于 10 分钟",
      "站控数据要求：数据上传稳定，无新增告警",
    ],
    result: "已生成恢复运行与验证页面。下一步请恢复上电并连续观察风扇、温度、告警和数据上传状态。",
  },
  {
    agentName: "记录归档 Agent",
    runningTitle: "记录归档 Agent 正在生成下一步",
    doneTitle: "记录归档 Agent 已生成下一步",
    runningSubtitle: "正在根据恢复验证结果生成检修记录页面",
    doneSubtitle: "已生成“检修记录”页面",
    lines: [
      "恢复运行与验证已完成，系统正在整理本次检修闭环。",
      "正在汇总诊断结论、已完成步骤、关键确认项和恢复验证结果。",
      "正在生成可打印作业卡、专家审核和知识回流所需字段。",
      "生成下一步页面：检修记录。",
    ],
    evidence: [
      "诊断结论：站控柜 A01 工控机散热异常",
      "已完成检查项：告警定位、安全隔离、风道检查、部件检查、恢复验证",
      "处理结果：滤网、风扇、接线与温度阈值已完成确认",
      "记录字段：设备、故障、步骤完成情况、专家状态",
      "知识回流要求：保留现场现象、处理结论和专家审核结果",
    ],
    result: "已生成检修记录页面。下一步可打印作业卡、提交专家审核，并将结论回流知识库。",
  },
];

const quickPrompts = [
  "工控机高温告警怎么办？",
  "PLC 通信中断如何排查？",
  "电源模块指示灯异常",
  "滤网堵塞如何处理？",
];

const modalityActions = [
  { label: "添加材料", icon: Paperclip },
  { label: "图片", icon: ImagePlus },
  { label: "视频", icon: Video },
];

const defaultUser = {
  account: "lishifu",
  userType: "engineer",
  name: "李师傅",
  role: "一线检修人员",
  site: "山东德州分输站",
  team: "站控运维一班",
};

const expertUser = {
  account: "expert",
  userType: "expert",
  name: "专家账号",
  role: "设备检修专家",
  site: "全场站",
  team: "专家审核中心",
};

function classNames(...items) {
  return items.filter(Boolean).join(" ");
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function materialTypeLabel(type) {
  if (type === "video") return "故障视频";
  if (type === "audio") return "故障音频";
  return "故障图片";
}

function MaterialMosaic({ materials, compact = false, onPreview, onRemove }) {
  if (!materials.length) {
    return (
      <div className={classNames("material-mosaic-empty", compact && "compact")}>
        <ImagePlus size={20} />
        <div>
          <strong>尚未接入现场材料</strong>
          <span>可选择故障图片、视频或音频</span>
        </div>
      </div>
    );
  }

  const visibleMaterials = materials.slice(0, 9);
  const remainingCount = Math.max(0, materials.length - visibleMaterials.length);

  return (
    <div className={classNames("material-mosaic", compact && "compact", `count-${Math.min(materials.length, 9)}`)}>
      {visibleMaterials.map((material, index) => (
        <article className="material-mosaic-item" key={material.id}>
          <button type="button" className="material-mosaic-preview" onClick={() => onPreview(material.id)}>
            <span className="material-mosaic-media">
              {material.type === "image" && <img src={material.url} alt="" />}
              {material.type === "video" && (
                <>
                  <video src={material.url} muted preload="metadata" aria-hidden="true" />
                  <i className="material-play-mark"><Play size={14} fill="currentColor" /></i>
                </>
              )}
              {material.type === "audio" && (
                <span className="material-audio-mark"><Music2 size={22} /><i /><i /><i /><i /></span>
              )}
              {remainingCount > 0 && index === visibleMaterials.length - 1 && (
                <span className="material-overflow-mark">+{remainingCount}</span>
              )}
            </span>
            <span className="material-mosaic-meta">
              <small>{materialTypeLabel(material.type)}</small>
              <strong>{material.name}</strong>
              <em>{formatFileSize(material.size)}</em>
            </span>
          </button>
          <button type="button" className="material-tile-remove" onClick={() => onRemove(material.id)} aria-label={`删除 ${material.name}`}>
            <X size={12} />
          </button>
        </article>
      ))}
    </div>
  );
}

function MaterialPreviewModal({ material, onClose }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="material-preview-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="material-preview-modal" role="dialog" aria-modal="true" aria-label={`${materialTypeLabel(material.type)}预览`}>
        <header>
          <div>
            <span>{materialTypeLabel(material.type)}</span>
            <strong>{material.name}</strong>
            <small>{formatFileSize(material.size)} · 当前浏览器会话</small>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭材料预览"><X size={18} /></button>
        </header>
        <div className="material-preview-body">
          {material.type === "image" && <img src={material.url} alt={`故障图片：${material.name}`} />}
          {material.type === "video" && <video src={material.url} controls autoPlay preload="metadata" />}
          {material.type === "audio" && (
            <div className="material-audio-player">
              <Music2 size={38} />
              <strong>{material.name}</strong>
              <audio src={material.url} controls autoPlay />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const referenceTypeMeta = {
  case: { label: "案例", longLabel: "历史案例", icon: Archive },
  knowledge: { label: "知识", longLabel: "检修知识", icon: BookOpen },
  manual: { label: "手册", longLabel: "厂商手册", icon: FileText },
};

function getReferenceCounts(references) {
  return references.reduce((counts, item) => ({
    ...counts,
    [item.type]: (counts[item.type] || 0) + 1,
  }), { case: 0, knowledge: 0, manual: 0 });
}

function ReferencePackageDock({ references, onOpen, onRemove }) {
  if (!references.length) return null;
  const counts = getReferenceCounts(references);

  return (
    <section className="reference-package-dock" aria-label="本次接诊资料包">
      <div className="reference-package-head">
        <div className="reference-package-title">
          <PackageCheck size={16} />
          <span><small>诊断参考</small><strong>本次接诊资料包 · {references.length} 项</strong></span>
        </div>
        <div className="reference-package-counts">
          <span>{counts.case} 案例</span><span>{counts.knowledge} 知识</span><span>{counts.manual} 手册</span>
          <button type="button" onClick={onOpen}>调整资料</button>
        </div>
      </div>
      <div className="reference-package-chips">
        {references.slice(0, 3).map((item) => (
          <span key={item.key}>
            <em>{referenceTypeMeta[item.type].label}</em>
            <strong>{item.title}</strong>
            <button type="button" onClick={() => onRemove(item.key)} aria-label={`移除 ${item.title}`}><X size={11} /></button>
          </span>
        ))}
        {references.length > 3 && <button type="button" className="reference-package-more" onClick={onOpen}>+{references.length - 3} 项</button>}
      </div>
    </section>
  );
}

function ReferencePickerModal({ catalog, catalogMode, selectedReferences, onClose, onConfirm }) {
  const [activeType, setActiveType] = useState("all");
  const [query, setQuery] = useState("");
  const [draftKeys, setDraftKeys] = useState(() => selectedReferences.map((item) => item.key));
  const allReferences = useMemo(() => {
    const catalogKeys = new Set(catalog.map((item) => item.key));
    return [...catalog, ...selectedReferences.filter((item) => !catalogKeys.has(item.key))];
  }, [catalog, selectedReferences]);
  const draftKeySet = useMemo(() => new Set(draftKeys), [draftKeys]);
  const selectedDraft = useMemo(
    () => allReferences.filter((item) => draftKeySet.has(item.key)),
    [allReferences, draftKeySet]
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleReferences = useMemo(() => allReferences.filter((item) => {
    if (activeType !== "all" && item.type !== activeType) return false;
    if (!normalizedQuery) return true;
    return `${item.id} ${item.title} ${item.meta} ${item.summary} ${item.tags.join(" ")}`.toLowerCase().includes(normalizedQuery);
  }), [activeType, allReferences, normalizedQuery]);
  const recommended = allReferences.filter((item) => item.recommended).slice(0, 4);
  const catalogCounts = getReferenceCounts(allReferences);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  function toggleReference(key) {
    setDraftKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function selectRecommended() {
    setDraftKeys((current) => [...new Set([...current, ...recommended.map((item) => item.key)])]);
  }

  const tabs = [
    ["all", "全部资料", allReferences.length],
    ["case", "历史案例", catalogCounts.case],
    ["knowledge", "检修知识", catalogCounts.knowledge],
    ["manual", "厂商手册", catalogCounts.manual],
  ];

  return (
    <div className="reference-picker-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="reference-picker-modal" role="dialog" aria-modal="true" aria-label="检修资料编组台">
        <header className="reference-picker-head">
          <div>
            <span className="eyebrow">MAINTENANCE REFERENCE STAGING</span>
            <h2>检修资料编组台</h2>
            <p>从专家知识库的案例、检修知识和厂商手册中，编组本次接诊要引用的资料。</p>
          </div>
          <div className="reference-catalog-state">
            <span>{catalogMode === "live" ? "知识库实时目录" : catalogMode === "partial" ? "部分目录 · 演示兜底" : "演示资料目录"}</span>
            <strong>{allReferences.length} 项可选资料</strong>
          </div>
          <button className="reference-picker-close" type="button" onClick={onClose} aria-label="关闭检修资料编组台"><X size={18} /></button>
        </header>

        <section className="reference-recommendation-rail">
          <div><Sparkles size={16} /><span><small>当前接诊建议</small><strong>工控机 · TEMP/FAN 与散热异常方向</strong></span></div>
          <div className="reference-recommendation-items">
            {recommended.map((item) => <span key={item.key}><em>{referenceTypeMeta[item.type].label}</em>{item.title}</span>)}
          </div>
          <button type="button" onClick={selectRecommended}><Plus size={14} />采用推荐资料</button>
        </section>

        <div className="reference-picker-toolbar">
          <div className="reference-type-tabs">
            {tabs.map(([value, label, count]) => <button type="button" className={activeType === value ? "active" : ""} onClick={() => setActiveType(value)} key={value}><span>{label}</span><em>{count}</em></button>)}
          </div>
          <label className="reference-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索故障、设备、资料标题或编号" />{query && <button type="button" onClick={() => setQuery("")} aria-label="清除搜索"><X size={13} /></button>}</label>
        </div>

        <div className="reference-picker-workspace">
          <section className="reference-catalog-wall" aria-label="可选检修资料">
            {visibleReferences.map((item, index) => {
              const Icon = referenceTypeMeta[item.type].icon;
              const selected = draftKeySet.has(item.key);
              return (
                <button
                  className={classNames("reference-catalog-card", `type-${item.type}`, selected && "selected")}
                  style={{ "--reference-index": index }}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleReference(item.key)}
                  key={item.key}
                >
                  <span className="reference-card-icon"><Icon size={18} /></span>
                  <span className="reference-card-copy">
                    <small>{item.eyebrow} · {item.id}</small>
                    <strong>{item.title}</strong>
                    <p>{item.summary}</p>
                    <span className="reference-card-meta">{item.meta}</span>
                    <span className="reference-card-tags">{item.tags.map((tag) => <em key={tag}>{tag}</em>)}</span>
                  </span>
                  <span className="reference-card-select">{selected ? <Check size={14} /> : <Plus size={14} />}</span>
                </button>
              );
            })}
            {!visibleReferences.length && <div className="reference-catalog-empty"><Search size={24} /><strong>没有匹配的检修资料</strong><span>请更换关键词或查看其他资料类型。</span><button type="button" onClick={() => { setQuery(""); setActiveType("all"); }}>查看全部资料</button></div>}
          </section>

          <aside className="reference-selection-tray">
            <header><div><span>本次接诊资料包</span><strong>{selectedDraft.length} 项已编组</strong></div><PackageCheck size={20} /></header>
            <div className="reference-tray-counts"><span>{getReferenceCounts(selectedDraft).case}<small>案例</small></span><span>{getReferenceCounts(selectedDraft).knowledge}<small>知识</small></span><span>{getReferenceCounts(selectedDraft).manual}<small>手册</small></span></div>
            <div className="reference-tray-list">
              {selectedDraft.map((item) => <article key={item.key}><span>{referenceTypeMeta[item.type].label}</span><div><strong>{item.title}</strong><small>{item.id}</small></div><button type="button" onClick={() => toggleReference(item.key)} aria-label={`移除 ${item.title}`}><X size={13} /></button></article>)}
              {!selectedDraft.length && <div className="reference-tray-empty"><BookOpen size={22} /><strong>尚未编组资料</strong><span>从左侧选择案例、知识或手册。</span></div>}
            </div>
            <footer>
              <button type="button" className="reference-clear-button" onClick={() => setDraftKeys([])} disabled={!selectedDraft.length}>清空</button>
              <button type="button" className="primary-button" onClick={() => onConfirm(selectedDraft)}><Check size={15} />确认并用于本次接诊</button>
            </footer>
          </aside>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(defaultUser);
  const [navOpen, setNavOpen] = useState(false);
  const [activePage, setActivePage] = useState("workbench");
  const [recordsView, setRecordsView] = useState("list");
  const [stage, setStage] = useState("home");
  const [health, setHealth] = useState("连接中");
  const [scenario, setScenario] = useState(null);
  const [homeDraft, setHomeDraft] = useState("");
  const [intakeMaterials, setIntakeMaterials] = useState([]);
  const [activeMaterialId, setActiveMaterialId] = useState(null);
  const [previewMaterialId, setPreviewMaterialId] = useState(null);
  const [referenceCatalog, setReferenceCatalog] = useState(maintenanceReferenceFallback);
  const [referenceCatalogMode, setReferenceCatalogMode] = useState("fallback");
  const [selectedReferences, setSelectedReferences] = useState([]);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const materialUrlsRef = useRef(new Set());
  const [input, setInput] = useState(defaultInput);
  const [incidentTime, setIncidentTime] = useState({
    detectedAt: "2026-07-10T10:25",
    duration: "约 10 分钟",
    recurrence: "首次发现",
  });
  const [diagnosis, setDiagnosis] = useState(null);
  const [steps, setSteps] = useState([]);
  const [activeStep, setActiveStep] = useState(0);
  const [activeIntakeStep, setActiveIntakeStep] = useState(0);
  const [activeDiagnosisTask, setActiveDiagnosisTask] = useState(0);
  const [evidence, setEvidence] = useState([]);
  const [graph, setGraph] = useState([]);
  const [record, setRecord] = useState(null);
  const [expertReview, setExpertReview] = useState(null);
  const [feedbackState, setFeedbackState] = useState(null);
  const [engineerSync, setEngineerSync] = useState(null);
  const [engineerSnapshot, setEngineerSnapshot] = useState(null);
  const [graphSyncBusy, setGraphSyncBusy] = useState(false);
  const [feedbackUploadStatus, setFeedbackUploadStatus] = useState("idle");
  const [feedbackUploadError, setFeedbackUploadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeAgentIndex, setActiveAgentIndex] = useState(-1);
  const [checkedGuideItems, setCheckedGuideItems] = useState({});
  const [intakeSelections, setIntakeSelections] = useState({});
  const [thresholdValues, setThresholdValues] = useState(
    Object.fromEntries(thresholdInputs.map(([label, value]) => [label, value]))
  );
  const [triageAgentStatus, setTriageAgentStatus] = useState("idle");
  const [triageTraceCount, setTriageTraceCount] = useState(0);
  const [triageCharCount, setTriageCharCount] = useState(0);
  const [activeTransition, setActiveTransition] = useState(null);
  const [autoRecognizing, setAutoRecognizing] = useState(false);
  const [autoRecognized, setAutoRecognized] = useState(false);
  const [equipmentTraceCount, setEquipmentTraceCount] = useState(0);
  const [equipmentFieldSources, setEquipmentFieldSources] = useState({});
  const [planRevisionEvents, setPlanRevisionEvents] = useState([]);

  useEffect(() => {
    Promise.all([
      api.health(),
      api.scenario(),
      api.steps(),
      api.evidence(),
      api.graph(),
    ])
      .then(([healthResult, scenarioResult, stepResult, evidenceResult, graphResult]) => {
        setHealth(
          healthResult.status === "ok"
            ? "后端已连接"
            : healthResult.status === "offline"
              ? "本地演示模式"
              : "后端异常"
        );
        setScenario(scenarioResult);
        setInput(scenarioResult.default_input || defaultInput);
        setSteps(stepResult);
        setEvidence(evidenceResult);
        setGraph(graphResult);
      })
      .catch(() => setHealth("后端未连接"));
  }, []);
  useEffect(() => {
    let active = true;
    Promise.allSettled([
      presentationApi.cases(),
      presentationApi.knowledge(),
      presentationApi.manuals(),
    ]).then(([caseResult, knowledgeResult, manualResult]) => {
      if (!active) return;
      const results = { case: caseResult, knowledge: knowledgeResult, manual: manualResult };
      const remoteCatalog = normalizeMaintenanceReferences({
        cases: caseResult.status === "fulfilled" && Array.isArray(caseResult.value) ? caseResult.value : [],
        knowledge: knowledgeResult.status === "fulfilled" && Array.isArray(knowledgeResult.value) ? knowledgeResult.value : [],
        manuals: manualResult.status === "fulfilled" && Array.isArray(manualResult.value) ? manualResult.value : [],
      });
      const failedTypes = Object.entries(results).filter(([, result]) => result.status === "rejected").map(([type]) => type);
      const fallbackCatalog = maintenanceReferenceFallback.filter((item) => failedTypes.includes(item.type));
      setReferenceCatalog([...remoteCatalog, ...fallbackCatalog]);
      setReferenceCatalogMode(failedTypes.length === 0 ? "live" : failedTypes.length === 3 ? "fallback" : "partial");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || currentUser.userType === "expert") return undefined;
    let active = true;
    presentationApi.switchRole("engineer")
      .then(() => Promise.all([
        presentationApi.state(),
        presentationApi.engineerSyncStatus(),
        presentationApi.engineerSnapshot(),
      ]))
      .then(([nextState, nextSync, nextSnapshot]) => {
        if (!active) return;
        setFeedbackState(nextState);
        setEngineerSync(nextSync);
        setEngineerSnapshot(nextSnapshot);
      })
      .catch(() => {
        if (!active) return;
        setFeedbackState(null);
        setEngineerSync(null);
        setEngineerSnapshot(null);
      });
    return () => { active = false; };
  }, [isAuthenticated, currentUser.userType]);

  useEffect(() => () => {
    materialUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    materialUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    if (!intakeMaterials.length) {
      setActiveMaterialId(null);
      return;
    }
    if (!intakeMaterials.some((item) => item.id === activeMaterialId)) {
      setActiveMaterialId(intakeMaterials[0].id);
    }
  }, [activeMaterialId, intakeMaterials]);

  const currentStep = steps[activeStep];
  const previewMaterial = intakeMaterials.find((item) => item.id === previewMaterialId) || null;
  const intakeBranch = useMemo(
    () => getIntakeBranch(intakeSelections, thresholdValues),
    [intakeSelections, thresholdValues]
  );

  const activePhase = useMemo(() => {
    if (stage === "home") return 0;
    if (stage === "input") return 0;
    if (stage === "analysis" || stage === "diagnosis") return 1;
    if (stage === "plan" || stage === "guide") return 2;
    return 3;
  }, [stage]);

  useEffect(() => {
    if (stage !== "analysis" || !diagnosis?.agents?.length) return undefined;

    let index = 0;
    const timers = [];
    setActiveAgentIndex(0);

    function advanceAgent() {
      index += 1;
      if (index < diagnosis.agents.length) {
        setActiveAgentIndex(index);
        timers.push(window.setTimeout(advanceAgent, 3200));
      } else {
        setActiveAgentIndex(diagnosis.agents.length);
        timers.push(window.setTimeout(() => {
          runStageTransition("diagnosis", 0, () => {
            setActiveDiagnosisTask(diagnosisTasks.length - 1);
            setStage("diagnosis");
          });
        }, 700));
      }
    }

    timers.push(window.setTimeout(advanceAgent, 3200));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [diagnosis, stage]);

  async function startDiagnosis() {
    setLoading(true);
    setActiveTransition(null);
    setTriageAgentStatus("idle");
    try {
      const result = await api.startDiagnosis(input || defaultInput);
      setDiagnosis(result);
      setSteps(await api.steps());
      setActivePage("workbench");
      setStage("analysis");
      setActiveStep(0);
      setActiveDiagnosisTask(0);
    } finally {
      setLoading(false);
    }
  }

  async function enterGuide() {
    if (triageAgentStatus === "running") return;
    setPlanRevisionEvents([]);
    runStageTransition("diagnosis", 1, () => {
      setStage("plan");
    });
  }

  function confirmMaintenancePlan(confirmedSteps) {
    setSteps(confirmedSteps);
    setCheckedGuideItems({});
    setActiveTransition(null);
    setTriageAgentStatus("idle");
    setActiveStep(0);
    setStage("guide");
  }

  function recordPlanRevision(message) {
    setPlanRevisionEvents((current) => [...current, message].slice(-8));
  }

  async function completeCurrentStep() {
    if (!currentStep || triageAgentStatus === "running") return;
    runStageTransition("guide", activeStep, async () => {
      await api.completeStep(currentStep.id);
      setSteps((current) => current.map((step, index) => (
        index === activeStep ? { ...step, completed: true } : step
      )));
      if (activeStep < steps.length - 1) {
        setActiveStep(activeStep + 1);
      } else {
        const result = await api.generateRecord();
        setRecord({
          ...result,
          completed_steps: steps.map((step) => ({ ...step, completed: true })),
          safety_confirmed: steps.some((step) => step.id === "step-02-safety" || step.checks.some((check) => lockedSafetyChecks.has(check))),
        });
        setStage("record");
      }
    });
  }

  function toggleGuideCheck(stepId, check) {
    setCheckedGuideItems((current) => {
      const checkedSet = new Set(current[stepId] || []);
      if (checkedSet.has(check)) {
        checkedSet.delete(check);
      } else {
        checkedSet.add(check);
      }
      return {
        ...current,
        [stepId]: Array.from(checkedSet),
      };
    });
  }

  function updateIntakeSelection(label, value) {
    const profile = label === "设备型号" ? equipmentProfileDefaults[value] : null;
    setIntakeSelections((current) => profile ? {
      ...current,
      [label]: value,
      "设备角色": profile[0],
      "关联告警": profile[1],
    } : { ...current, [label]: value });
    setEquipmentFieldSources((current) => profile ? {
      ...current,
      [label]: "工程师手动确认",
      "设备角色": "型号知识 + 设备台账",
      "关联告警": "型号知识 + 告警规则",
    } : { ...current, [label]: "工程师手动确认" });
    setAutoRecognized(false);
  }

  function addIntakeMaterials(fileList, requestedType, replaceId = null) {
    const files = Array.from(fileList || []).filter((file) => {
      if (requestedType === "video") return file.type.startsWith("video/");
      if (requestedType === "audio") return file.type.startsWith("audio/");
      return file.type.startsWith("image/");
    });
    if (!files.length) return;

    if (replaceId) removeIntakeMaterial(replaceId);

    const addedAt = Date.now();
    const nextItems = files.map((file, index) => {
      const url = URL.createObjectURL(file);
      materialUrlsRef.current.add(url);
      return {
        id: `material-${addedAt}-${index}`,
        type: requestedType,
        name: file.name,
        size: file.size,
        url,
      };
    });
    setIntakeMaterials((current) => [...current, ...nextItems]);
    setActiveMaterialId(nextItems[0].id);
  }

  function removeIntakeMaterial(materialId) {
    if (previewMaterialId === materialId) setPreviewMaterialId(null);
    setIntakeMaterials((current) => {
      const target = current.find((item) => item.id === materialId);
      if (target) {
        URL.revokeObjectURL(target.url);
        materialUrlsRef.current.delete(target.url);
      }
      return current.filter((item) => item.id !== materialId);
    });
  }

  function clearIntakeMaterials() {
    intakeMaterials.forEach((item) => {
      URL.revokeObjectURL(item.url);
      materialUrlsRef.current.delete(item.url);
    });
    setIntakeMaterials([]);
    setActiveMaterialId(null);
    setPreviewMaterialId(null);
  }

  function runStageTransition(type, fromIndex, onDone) {
    const streamStartDelay = type === "intake" && fromIndex === 0
      ? 1500
      : getRandomAgentStreamDelay();
    setTriageAgentStatus("running");
    setTriageTraceCount(0);
    setTriageCharCount(0);
    setActiveTransition({
      type,
      fromIndex,
      status: "running",
      charCount: 0,
    });

    let currentCount = 0;
    let typingTimer;
    window.setTimeout(() => {
      typingTimer = window.setInterval(() => {
        currentCount += 1;
        setTriageCharCount(currentCount);
        setActiveTransition((current) => (
          current && current.type === type && current.fromIndex === fromIndex
            ? { ...current, charCount: currentCount }
            : current
        ));
      }, 48);
    }, streamStartDelay);

    [1, 2, 3, 4].forEach((count, index) => {
      window.setTimeout(() => setTriageTraceCount(count), streamStartDelay + 980 * (index + 1));
    });

    window.setTimeout(() => window.clearInterval(typingTimer), streamStartDelay + 7200);
    window.setTimeout(() => {
      setTriageAgentStatus("done");
      setTriageCharCount(999);
      setActiveTransition((current) => (
        current && current.type === type && current.fromIndex === fromIndex
          ? { ...current, status: "done", charCount: 999 }
          : current
      ));
      window.setTimeout(() => {
        Promise.resolve(onDone?.());
      }, 520);
    }, streamStartDelay + 7200);
  }

  function continueIntakeStep() {
    if (activeIntakeStep >= intakeTasks.length - 1 || triageAgentStatus === "running") return;
    const nextStep = Math.min(intakeTasks.length - 1, activeIntakeStep + 1);
    runStageTransition("intake", activeIntakeStep, () => setActiveIntakeStep(nextStep));
  }

  function selectIntakeStep(index) {
    if (triageAgentStatus === "running") return;
    setActiveTransition(null);
    setTriageAgentStatus("idle");
    setTriageTraceCount(0);
    setTriageCharCount(0);
    setActiveIntakeStep(index);
  }

  function autoFillIntakeSelections() {
    const streamStartDelay = getRandomAgentStreamDelay();
    setAutoRecognizing(true);
    setAutoRecognized(false);
    setEquipmentTraceCount(0);
    [1, 2, 3, 4, 5].forEach((count, index) => {
      window.setTimeout(() => setEquipmentTraceCount(count), streamStartDelay + 520 * (index + 1));
    });
    setEquipmentFieldSources({});
    equipmentOptionGroups.forEach((group, index) => {
      window.setTimeout(() => {
        setIntakeSelections((current) => ({ ...current, [group.label]: group.options[0] }));
        setEquipmentFieldSources((current) => ({ ...current, [group.label]: group.source }));
      }, streamStartDelay + 760 * (index + 1));
    });
    window.setTimeout(() => {
      setAutoRecognizing(false);
      setAutoRecognized(true);
      setEquipmentTraceCount(5);
    }, streamStartDelay + 2850);
  }

  function updateThresholdValue(label, value) {
    setThresholdValues((current) => ({ ...current, [label]: value }));
  }

  function applyThresholdSuggestion(label, value) {
    setThresholdValues((current) => ({ ...current, [label]: value }));
  }

  async function buildRecord() {
    const result = await api.generateRecord();
    setRecord(result);
    setRecordsView("detail");
  }

  function buildRecordFromGuide() {
    if (triageAgentStatus === "running") return;
    runStageTransition("guide", guideTransitionAgents.length - 1, async () => {
      const result = await api.generateRecord();
      setRecord({
        ...result,
        completed_steps: steps.filter((step) => step.completed),
        safety_confirmed: steps.some((step) => step.id === "step-02-safety" || step.checks.some((check) => lockedSafetyChecks.has(check))),
      });
      setStage("record");
    });
  }

  async function approveExpertReview() {
    const result = await api.expertReview();
    setExpertReview(result);
    setDiagnosis(await api.startDiagnosis(input || defaultInput));
    setStage("expert");
  }

  function openNavPage(pageId) {
    setActivePage(pageId);
    if (pageId === "records") setRecordsView("list");
    if (pageId === "workbench" && !diagnosis && !record && stage !== "input") {
      setStage("home");
    }
  }

  function enterIntakeFromHome(value = homeDraft) {
    const nextInput = value.trim() || defaultInput;
    setInput(nextInput);
    setActivePage("workbench");
    setRecordsView("list");
    setStage("input");
    setActiveIntakeStep(0);
    setIntakeSelections({});
    setTriageAgentStatus("idle");
    setTriageTraceCount(0);
    setTriageCharCount(0);
    setActiveTransition(null);
    setAutoRecognizing(false);
    setAutoRecognized(false);
    setEquipmentTraceCount(0);
    setIncidentTime({
      detectedAt: "2026-07-10T10:25",
      duration: "约 10 分钟",
      recurrence: "首次发现",
    });
  }

  function jumpToPhase(phaseIndex) {
    if (triageAgentStatus === "running") return;
    setActiveTransition(null);
    setTriageAgentStatus("idle");
    setActivePage("workbench");
    setRecordsView("list");
    if (phaseIndex === 0) setStage(stage === "home" ? "home" : "input");
    if (phaseIndex === 1 && diagnosis) setStage(stage === "analysis" ? "analysis" : "diagnosis");
    if (phaseIndex === 2 && diagnosis) setStage(stage === "plan" ? "plan" : "guide");
    if (phaseIndex === 3 && record) setStage("record");
  }

  function handleLogin(user) {
    setCurrentUser(user);
    setIsAuthenticated(true);
    setActivePage("workbench");
    setStage("home");
  }

  function handleLogout() {
    setIsAuthenticated(false);
    setActivePage("workbench");
    setStage("home");
    setHomeDraft("");
    setFeedbackUploadStatus("idle");
    setFeedbackUploadError("");
    setSelectedReferences([]);
    setReferencePickerOpen(false);
    clearIntakeMaterials();
  }

  async function uploadMaintenanceRecord(feedbackPackage) {
    setFeedbackUploadStatus("uploading");
    setFeedbackUploadError("");
    try {
      const nextState = await presentationApi.submitCase(
        PRESENTATION_CASE_ID,
        feedbackPackage.maintenanceResult,
        feedbackPackage
      );
      setFeedbackState(nextState);
      setFeedbackUploadStatus("success");
      return nextState;
    } catch (error) {
      setFeedbackUploadStatus("error");
      setFeedbackUploadError(error.message || "上传失败，请稍后重试");
      throw error;
    }
  }

  async function syncEngineerKnowledge() {
    setGraphSyncBusy(true);
    try {
      await presentationApi.engineerSyncLatest();
      const [nextState, nextSync, nextSnapshot] = await Promise.all([
        presentationApi.state(),
        presentationApi.engineerSyncStatus(),
        presentationApi.engineerSnapshot(),
      ]);
      setFeedbackState(nextState);
      setEngineerSync(nextSync);
      setEngineerSnapshot(nextSnapshot);
    } finally {
      setGraphSyncBusy(false);
    }
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (currentUser.userType === "expert") {
    return (
      <div className="expert-portal-shell">
        <AdminShell portalRole="expert" onLogout={handleLogout} />
      </div>
    );
  }

  return (
    <div className={classNames("app-shell", navOpen && "nav-expanded")}>
      <aside className="sidebar">
        <button className="brand-mark" onClick={() => setNavOpen(!navOpen)} title="展开菜单">
          <Zap size={22} />
        </button>
        <button className="nav-toggle" onClick={() => setNavOpen(!navOpen)} title="菜单">
          <Menu size={18} />
          <span>菜单</span>
        </button>
        <nav className="sidebar-nav" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={classNames("nav-icon", activePage === item.id && "active")}
                title={item.label}
                onClick={() => openNavPage(item.id)}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">站控慧眼</p>
            <h1>
              {activePage === "graph"
                ? "知识图谱"
                : activePage === "records"
                  ? "检修记录"
                : activePage === "settings"
                  ? "设置"
                  : stage === "home"
                    ? "智能诊断入口"
                    : "智能诊断台"}
            </h1>
          </div>
          <div className="topbar-meta">
            <span><MapPin size={16} /> {currentUser.site || scenario?.site || "山东德州分输站"} · {currentUser.team}</span>
            <span><UserRound size={16} /> {currentUser.name} · {currentUser.role}</span>
            <span
              className={classNames(
                "health-pill",
                health === "后端已连接" && "ok",
                health === "本地演示模式" && "demo"
              )}
            >
              {health}
            </span>
            <button className="topbar-logout" onClick={handleLogout} title="退出登录">
              <LogOut size={15} />
              退出
            </button>
          </div>
        </header>

        {activePage === "graph" ? (
          feedbackState ? (
            <IndustrialKnowledgeGraphPage
              state={feedbackState}
              portalRole="engineer"
              engineerSnapshot={engineerSnapshot}
              engineerSync={engineerSync}
              busy={graphSyncBusy}
              onSync={syncEngineerKnowledge}
            />
          ) : (
            <div className="admin-loading"><Loader2 className="spin" /> 正在载入工程师知识图谱…</div>
          )
        ) : activePage === "records" ? (
          recordsView === "detail" && (record || feedbackState?.feedbackPackage) ? (
            <MaintenanceRecordPage
              record={record || recordFromFeedbackPackage(feedbackState?.feedbackPackage, feedbackState?.caseStatus)}
              scenario={scenario}
              diagnosis={diagnosis}
              incidentTime={incidentTime}
              input={input}
              materials={intakeMaterials}
              currentUser={currentUser}
              feedbackState={feedbackState}
              uploadStatus={feedbackUploadStatus}
              uploadError={feedbackUploadError}
              onUpload={uploadMaintenanceRecord}
              onPreviewMaterial={setPreviewMaterialId}
              onBackGuide={() => { setActivePage("workbench"); setStage("guide"); }}
              onBackList={() => setRecordsView("list")}
            />
          ) : (
            <RecordPage
              record={record || recordFromFeedbackPackage(feedbackState?.feedbackPackage, feedbackState?.caseStatus)}
              onBuildRecord={buildRecord}
              onOpenCurrent={() => setRecordsView("detail")}
            />
          )
        ) : activePage === "settings" ? (
          <SettingsPage currentUser={currentUser} onSave={setCurrentUser} />
        ) : stage === "home" ? (
          <HomeStage
            draft={homeDraft}
            userName={currentUser.name}
            materials={intakeMaterials}
            references={selectedReferences}
            activeMaterialId={activeMaterialId}
            onDraft={setHomeDraft}
            onAddMaterials={addIntakeMaterials}
            onSelectMaterial={setActiveMaterialId}
            onRemoveMaterial={removeIntakeMaterial}
            onPreviewMaterial={setPreviewMaterialId}
            onOpenReferencePicker={() => setReferencePickerOpen(true)}
            onRemoveReference={(referenceKey) => setSelectedReferences((current) => current.filter((item) => item.key !== referenceKey))}
            onSubmit={() => enterIntakeFromHome()}
            onQuickPrompt={(prompt) => setHomeDraft(prompt)}
            onUseQuickPrompt={enterIntakeFromHome}
          />
        ) : (
          <section className="stage-layout">
            <FlowPanel
              activePhase={activePhase}
              steps={steps}
              activeStep={activeStep}
              activeIntakeStep={activeIntakeStep}
              stage={stage}
              analysisSubStep={activeDiagnosisTask}
              activeAgentIndex={activeAgentIndex}
              activeTransition={activeTransition}
              onSelectPhase={jumpToPhase}
              onSelectIntake={(index) => {
                setActivePage("workbench");
                setStage("input");
                selectIntakeStep(index);
              }}
              onSelectAnalysis={(index) => {
                if (diagnosis && triageAgentStatus !== "running") {
                  setActivePage("workbench");
                  setStage("diagnosis");
                  setActiveTransition(null);
                  setTriageAgentStatus("idle");
                  setActiveDiagnosisTask(index);
                }
              }}
              onSelectStep={(index) => {
                if (diagnosis && triageAgentStatus !== "running") {
                  setActivePage("workbench");
                  setStage("guide");
                  setActiveTransition(null);
                  setTriageAgentStatus("idle");
                  setActiveStep(index);
                }
              }}
            />
            <div className="stage-card">
              {stage === "input" && activeIntakeStep < 5 && (
                <InputStage
                  input={input}
                  incidentTime={incidentTime}
                  materials={intakeMaterials}
                  references={selectedReferences}
                  activeMaterialId={activeMaterialId}
                  loading={loading}
                  activeStep={activeIntakeStep}
                  selections={intakeSelections}
                  thresholdValues={thresholdValues}
                  intakeBranch={intakeBranch}
                  equipmentFieldSources={equipmentFieldSources}
                  triageAgentStatus={triageAgentStatus}
                  activeTransition={activeTransition}
                  triageTraceCount={triageTraceCount}
                  autoRecognizing={autoRecognizing}
                  autoRecognized={autoRecognized}
                  equipmentTraceCount={equipmentTraceCount}
                  onInput={setInput}
                  onIncidentTimeChange={(field, value) => setIncidentTime((current) => ({ ...current, [field]: value }))}
                  onAddMaterials={addIntakeMaterials}
                  onSelectMaterial={setActiveMaterialId}
                  onRemoveMaterial={removeIntakeMaterial}
                  onPreviewMaterial={setPreviewMaterialId}
                  onAutoFill={autoFillIntakeSelections}
                  onSelectionChange={updateIntakeSelection}
                  onThresholdChange={updateThresholdValue}
                  onApplyThresholdSuggestion={applyThresholdSuggestion}
                  onSelectStep={selectIntakeStep}
                  onContinue={continueIntakeStep}
                  onStart={startDiagnosis}
                />
              )}
              {stage === "input" && activeIntakeStep === 5 && (
                <IntakeSummaryStage
                  input={input}
                  incidentTime={incidentTime}
                  materials={intakeMaterials}
                  references={selectedReferences}
                  selections={intakeSelections}
                  thresholdValues={thresholdValues}
                  intakeBranch={intakeBranch}
                  loading={loading}
                  onPreviewMaterial={setPreviewMaterialId}
                  onRemoveMaterial={removeIntakeMaterial}
                  onEdit={selectIntakeStep}
                  onStart={startDiagnosis}
                />
              )}
              {stage === "analysis" && diagnosis && (
                <AgentRunStage
                  agents={diagnosis.agents}
                  activeAgentIndex={activeAgentIndex}
                />
              )}
              {stage === "diagnosis" && diagnosis && (
                <DiagnosisStage
                  diagnosis={diagnosis}
                  evidence={evidence}
                  activeTask={activeDiagnosisTask}
                  transitionRunning={triageAgentStatus === "running"}
                  onSelectTask={setActiveDiagnosisTask}
                  onEnterGuide={enterGuide}
                />
              )}
              {stage === "plan" && (
                <MaintenancePlanStage
                  initialSteps={steps}
                  onBack={() => setStage("diagnosis")}
                  onConfirm={confirmMaintenancePlan}
                  onRevision={recordPlanRevision}
                />
              )}
              {stage === "guide" && currentStep && (
                <GuideStage
                  currentStep={currentStep}
                  activeStep={activeStep}
                  totalSteps={steps.length}
                  checkedItems={checkedGuideItems[currentStep.id] || []}
                  transitionRunning={triageAgentStatus === "running"}
                  onToggleCheck={(check) => toggleGuideCheck(currentStep.id, check)}
                  onPrev={() => setActiveStep(Math.max(0, activeStep - 1))}
                  onNext={completeCurrentStep}
                  onRecord={buildRecordFromGuide}
                />
              )}
              {stage === "record" && (
                <MaintenanceRecordPage
                  record={record}
                  scenario={scenario}
                  diagnosis={diagnosis}
                  incidentTime={incidentTime}
                  input={input}
                  materials={intakeMaterials}
                  currentUser={currentUser}
                  feedbackState={feedbackState}
                  uploadStatus={feedbackUploadStatus}
                  uploadError={feedbackUploadError}
                  onUpload={uploadMaintenanceRecord}
                  onPreviewMaterial={setPreviewMaterialId}
                  onBackGuide={() => setStage("guide")}
                />
              )}
              {stage === "expert" && (
                <ExpertStage
                  expertReview={expertReview}
                  onRestart={() => setStage("diagnosis")}
                />
              )}
            </div>

            <AssistantChat
              stage={stage}
              activeIntakeStep={activeIntakeStep}
              triageAgentStatus={triageAgentStatus}
              triageTraceCount={triageTraceCount}
              triageCharCount={triageCharCount}
              activeTransition={activeTransition}
              analysisSubStep={activeDiagnosisTask}
              currentStep={currentStep}
              diagnosis={diagnosis}
              activeAgentIndex={activeAgentIndex}
              intakeBranch={intakeBranch}
              planRevisionEvents={planRevisionEvents}
            />
          </section>
        )}
      </main>
      {previewMaterial && <MaterialPreviewModal material={previewMaterial} onClose={() => setPreviewMaterialId(null)} />}
      {referencePickerOpen && (
        <ReferencePickerModal
          catalog={referenceCatalog}
          catalogMode={referenceCatalogMode}
          selectedReferences={selectedReferences}
          onClose={() => setReferencePickerOpen(false)}
          onConfirm={(references) => {
            setSelectedReferences(references);
            setReferencePickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [account, setAccount] = useState("lishifu");
  const [password, setPassword] = useState("");

  function submitLogin(event) {
    event.preventDefault();
    const normalizedAccount = account.trim().toLowerCase();
    onLogin(normalizedAccount === "expert" || normalizedAccount === "zhuanjia" ? expertUser : defaultUser);
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-brand">
          <div className="brand-mark static">
            <Zap size={24} />
          </div>
          <div>
            <p className="eyebrow">站控慧眼</p>
            <h1>工控设备检修助手</h1>
          </div>
        </div>

        <form className="login-form" onSubmit={submitLogin}>
          <label className="login-field">
            <span>账号</span>
            <input
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              placeholder="请输入账号"
              autoComplete="username"
            />
          </label>
          <label className="login-field">
            <span>密码</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              type="password"
              autoComplete="current-password"
            />
          </label>

          <button className="login-submit" type="submit">
            登录
            <ChevronRight size={18} />
          </button>
          <div className="login-demo-accounts">
            <span>演示账号</span>
            <button type="button" onClick={() => setAccount("lishifu")}>工程师 · lishifu</button>
            <button type="button" onClick={() => setAccount("expert")}>专家 · expert</button>
          </div>
        </form>
      </section>
    </main>
  );
}

function HomeStage({
  draft,
  userName,
  materials,
  references,
  activeMaterialId,
  onDraft,
  onAddMaterials,
  onSelectMaterial,
  onRemoveMaterial,
  onPreviewMaterial,
  onOpenReferencePicker,
  onRemoveReference,
  onSubmit,
  onQuickPrompt,
  onUseQuickPrompt,
}) {
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const deviceObjects = [
    ["工控机", "研华 ACP-4000 / IPC-610 · 站控柜 A01", "已接入", Cpu, "active"],
    ["PLC 控制柜", "ControlLogix / S7-1500 类对象", "已接入", GitBranch, "pending"],
    ["控制器机架", "机架、电源、I/O 卡件", "已接入", Layers, "pending"],
    ["电源模块", "冗余电源与电源状态", "已接入", Plug, "pending"],
    ["通信模块", "交换机、串口、数据上传", "已接入", Radio, "pending"],
    ["控制柜环境", "温湿度、风道、粉尘", "已接入", ShieldCheck, "standby"],
  ];
  const collectionItems = [
    { type: "image", title: "故障图片", detail: "选择现场照片或面板照片", icon: ImagePlus, enabled: true },
    { type: "video", title: "故障视频", detail: "选择现场环境或设备视频", icon: Video, enabled: true },
    { type: "audio", title: "故障录音", detail: "选择异响或现场语音材料", icon: Mic, enabled: true },
    { type: "document", title: "检修资料", detail: "从案例、知识与厂商手册中编组", icon: Paperclip, enabled: true },
  ];
  const taskCards = [
    ["FT-TEMP-01", "温度告警", "当前演示闭环", "站控柜内工控机温度告警，风扇声音异常，前面板风扇转速很低。", true],
    ["FT-FAN-01", "风扇异响 / 转速低", "当前演示闭环", "工控机 TEMP/FAN 告警，疑似风扇低速、滤网积尘或风道堵塞。", true],
    ["FT-COMM-01", "通信中断", "已接入", "PLC 通信中断，现场需要补充通信状态、模块状态和网络连接情况。", false],
    ["FT-POWER-01", "电源异常", "已接入", "电源模块异常，现场需要补充供电状态、告警信息和模块位置。", false],
    ["FT-LED-01", "状态灯异常", "已接入", "设备状态灯异常，现场需要补充灯态、告警信息和设备位置。", false],
    ["FT-DATA-01", "数据不上送", "已接入", "数据上传中断，现场需要补充采集端、网络链路和平台接收状态。", false],
  ];
  const readinessItems = [
    ["异常来源", "站控机温度告警、风扇声音异常"],
    ["已知材料", "场站定位、设备台账、维修向导"],
    ["建议动作", "先完成现场描述，再进入异常接入"],
  ];
  const pipeline = ["现场接诊", "设备识别", "资料检索", "Agent 会诊", "安全校验", "作业卡", "专家回流"];

  return (
    <section className="home-stage">
      <div className="duty-strip">
        <div>
          <span>值班接诊</span>
          <strong>{userName} · 一线检修人员</strong>
        </div>
        <div>
          <span>当前场站</span>
          <strong>山东德州分输站 · 站控区域</strong>
        </div>
        <div>
          <span>接入对象</span>
          <strong>站控柜 A01 · 工控机</strong>
        </div>
        <div>
          <span>待处理</span>
          <strong>散热类故障 1 项</strong>
        </div>
      </div>

      <div className="industrial-home-grid">
        <aside className="device-object-panel">
          <div className="section-heading compact">
            <h3>设备对象</h3>
            <span>场站台账</span>
          </div>
          <div className="device-object-list">
            {deviceObjects.map(([name, meta, status, icon, tone]) => {
              const Icon = icon;
              return (
                <button className={`device-object-item ${tone}`} type="button" key={name}>
                  <span className="object-icon"><Icon size={17} /></span>
                  <span className="object-copy">
                    <strong>{name}</strong>
                    <small>{meta}</small>
                  </span>
                  <em>{status}</em>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="intake-workbench">
          <section className="intake-card">
            <div className="section-heading">
              <div>
                <span className="eyebrow">现场接诊</span>
                <h2>描述现场现象</h2>
              </div>
              <span className="status-badge">接诊入口</span>
            </div>
            <p>填写一线人员看到、听到、上传到系统的现象。不要先判断原因，先把现场事实录清楚。</p>
            <div className="intake-line">
              <input
                value={draft}
                onChange={(event) => onDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSubmit();
                }}
                placeholder="简述现场现象，如：站控柜内工控机温度告警，风扇声音异常..."
              />
              <button className="primary-button" onClick={onSubmit}>
                <Send size={16} />
                开始接诊
              </button>
            </div>
            <div className="intake-collection-head">
              <h3>现场采集</h3>
              <span>故障材料接入</span>
            </div>
            <div className="collection-grid">
              {collectionItems.map((item) => {
                const Icon = item.icon;
                const count = item.type === "document"
                  ? references.length
                  : materials.filter((material) => material.type === item.type).length;
                return (
                  <button
                    className={classNames("collection-card", item.enabled && "enabled", count > 0 && "has-material")}
                    type="button"
                    key={item.title}
                    onClick={() => {
                      if (item.type === "image") imageInputRef.current?.click();
                      if (item.type === "video") videoInputRef.current?.click();
                      if (item.type === "audio") audioInputRef.current?.click();
                      if (item.type === "document") onOpenReferencePicker();
                    }}
                    aria-disabled={!item.enabled}
                  >
                    <Icon size={18} />
                    <span className="collection-copy">
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <em>{count > 0 ? `${count} 项` : item.enabled ? "选择文件" : "预留"}</em>
                  </button>
                );
              })}
            </div>
            <input
              ref={imageInputRef}
              className="visually-hidden-input"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                onAddMaterials(event.target.files, "image");
                event.target.value = "";
              }}
            />
            <input
              ref={videoInputRef}
              className="visually-hidden-input"
              type="file"
              accept="video/*"
              multiple
              onChange={(event) => {
                onAddMaterials(event.target.files, "video");
                event.target.value = "";
              }}
            />
            <input
              ref={audioInputRef}
              className="visually-hidden-input"
              type="file"
              accept="audio/*"
              multiple
              onChange={(event) => {
                onAddMaterials(event.target.files, "audio");
                event.target.value = "";
              }}
            />

            <section className={classNames("home-material-dock", materials.length > 0 && "has-materials")} aria-live="polite">
              <div className="material-dock-head">
                <div>
                  <span>现场证据</span>
                  <strong>{materials.length > 0 ? `已选入 ${materials.length} 项材料` : "尚未选择现场材料"}</strong>
                </div>
                <small>{materials.length > 0 ? "将随接诊信息进入中央证据画布" : "可直接使用预置样例继续演示"}</small>
              </div>
              <MaterialMosaic
                materials={materials}
                compact
                onPreview={(materialId) => {
                  onSelectMaterial(materialId);
                  onPreviewMaterial(materialId);
                }}
                onRemove={onRemoveMaterial}
              />
            </section>
            <ReferencePackageDock references={references} onOpen={onOpenReferencePicker} onRemove={onRemoveReference} />
          </section>

          <section className="fault-task-section">
            <div className="section-heading compact">
              <h3>快速接诊</h3>
              <span>按故障类型发起</span>
            </div>
            <div className="fault-task-grid">
              {taskCards.map(([code, title, state, prompt, enabled]) => (
                <button
                  className={`fault-task-card ${enabled ? "enabled" : "disabled"}`}
                  type="button"
                  key={code}
                  aria-label={`${title}，${state}`}
                  onClick={() => {
                    onQuickPrompt(prompt);
                    if (enabled) onUseQuickPrompt(prompt);
                  }}
                >
                  <span>{code}</span>
                  <strong>{title}</strong>
                  <small>{state}</small>
                </button>
              ))}
            </div>
          </section>
        </main>

        <aside className="maintenance-dynamics">
          <div className="section-heading compact">
            <h3>接诊状态</h3>
            <span>工程视角</span>
          </div>
          {readinessItems.map(([label, value]) => (
            <article key={label}>
              <span className="status-dot info" />
              <div>
                <strong>{label}</strong>
                <p>{value}</p>
              </div>
            </article>
          ))}
          <article>
            <span className="status-dot warn" />
            <div>
              <strong>待专家审核 1 项</strong>
              <p>站控柜 A01 散热异常记录待复核。</p>
            </div>
          </article>
          <article>
            <span className="status-dot ok" />
            <div>
              <strong>最近诊断记录</strong>
              <p>工控机 TEMP/FAN 告警，已进入恢复验证。</p>
            </div>
          </article>
          <article>
            <span className="status-dot info" />
            <div>
              <strong>专家经验回流</strong>
              <p>沙尘环境滤网维护周期：季度调整为月度。</p>
            </div>
          </article>
          <article>
            <span className="status-dot neutral" />
            <div>
              <strong>知识库状态</strong>
              <p>知识条目 11 · 图谱关系 24 · 判据 5 项</p>
            </div>
          </article>
        </aside>
      </div>

      <div className="pipeline-strip">
        {pipeline.map((item, index) => (
          <span style={{ animationDelay: `${index * 300}ms` }} key={item}>
            <i>{index + 1}</i>
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}

function IntakeSummaryStage({
  input,
  incidentTime,
  materials,
  references,
  selections,
  thresholdValues,
  intakeBranch,
  loading,
  onPreviewMaterial,
  onRemoveMaterial,
  onEdit,
  onStart,
}) {
  const activeThresholdInputs = getBranchThresholdInputs(intakeBranch);
  const branchBlocked = intakeBranch.id === "equipment-mismatch";
  const materialCounts = materials.reduce((counts, material) => ({
    ...counts,
    [material.type]: (counts[material.type] || 0) + 1,
  }), {});
  const referenceCounts = getReferenceCounts(references);

  return (
    <div className="stage-content intake-summary-stage">
      <header className="intake-summary-hero">
        <div>
          <p className="eyebrow">异常事件确认 · 最终核对</p>
          <h2>现场异常事件全景</h2>
          <p>事件信息已归集。请在启动诊断前核对发生地点、事件对象、现场材料、诊断参考和运行状态。</p>
        </div>
        <span className={branchBlocked ? "warning" : undefined}>
          {branchBlocked ? <AlertTriangle size={15} /> : <Check size={15} />}
          {branchBlocked ? "分支信息待补充" : "事件信息已归集"}
        </span>
      </header>

      <div className="intake-summary-dashboard">
        <section className="summary-overview-card">
          <header><div><small>01 / 时间与事件</small><h3>异常事件概览</h3></div><div className="summary-edit-actions"><button onClick={() => onEdit(0)}>修改时间</button><button onClick={() => onEdit(2)}>修改设备</button></div></header>
          <p className="summary-incident-text">{input || defaultInput}</p>
          <div className="summary-fact-grid">
            <p><span>发生时间</span><strong>{incidentTime.detectedAt.replace("T", " ")} · {incidentTime.duration}</strong></p>
            <p><span>设备型号</span><strong>{selections["设备型号"]}</strong></p>
            <p><span>设备角色</span><strong>{selections["设备角色"]}</strong></p>
            <p><span>关联告警</span><strong>{selections["关联告警"]}</strong></p>
            <p><span>故障位置</span><strong>控制中心 · 站控柜 A01</strong></p>
          </div>
        </section>

        <section className="summary-location-card">
          <header><div><small>02 / 故障位置</small><h3>山东德州分输站 · 控制中心 · 站控柜 A01</h3></div><button onClick={() => onEdit(1)}>修改</button></header>
          <div className="summary-location-map">
            <img src="/images/site-station-overview.png" alt="山东德州分输站控制中心站控柜 A01 故障点" />
            <div className="location-pulse" />
            <MapPin size={21} />
          </div>
        </section>

        <section className="summary-material-card">
          <header>
            <div><small>03 / 现场材料</small><h3>已接入 {materials.length} 项证据</h3></div>
            <span>图片 {materialCounts.image || 0} · 视频 {materialCounts.video || 0} · 音频 {materialCounts.audio || 0}</span>
          </header>
          <MaterialMosaic materials={materials} compact onPreview={onPreviewMaterial} onRemove={onRemoveMaterial} />
        </section>

        <section className="summary-status-card">
          <header><div><small>04 / 告警与运行参数</small><h3>已确认运行状态</h3></div><button onClick={() => onEdit(3)}>修改</button></header>
          <div className="summary-status-grid">
            {activeThresholdInputs.map(([label]) => (
              <p key={label}><span>{label}</span><strong>{thresholdValues[label]}</strong></p>
            ))}
          </div>
        </section>

        <section className="summary-evidence-card">
          <header><div><small>05 / 判断依据</small><h3>为什么形成当前判断</h3></div><button onClick={() => onEdit(4)}>重新核对</button></header>
          <div className="summary-evidence-grid">
            <article><ShieldCheck size={16} /><div><span>依据标准</span><strong>TEMP/FAN 告警与风扇低速判据</strong><p>运行阈值、设备台账与历史案例共同支持当前诊断方向。</p></div></article>
            <article><PackageCheck size={16} /><div><span>本次接诊资料包</span><strong>{references.length ? `已引用 ${references.length} 项诊断参考` : "未额外编组检修资料"}</strong><p>{references.length ? `${referenceCounts.case} 个案例 · ${referenceCounts.knowledge} 条知识 · ${referenceCounts.manual} 份手册；${references.slice(0, 2).map((item) => item.title).join("、")}${references.length > 2 ? "等" : ""}。` : "系统仍使用默认阈值、设备台账与基础手册形成演示判断。"}</p></div></article>
          </div>
        </section>
      </div>

      <footer className="intake-summary-launch">
        <div>
          <span>{branchBlocked ? "已识别非主演示诊断分支" : "诊断输入已准备完成"}</span>
          <strong>将基于 {materials.length} 项现场材料、{references.length} 项诊断参考、1 个设备对象和 4 项运行参数，按“{intakeBranch.diagnosis}”启动多 Agent 会诊。</strong>
        </div>
        <button className="primary-button" onClick={onStart} disabled={loading || branchBlocked}>
          {loading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          {loading ? "正在启动诊断" : branchBlocked ? "需补充通信诊断案例" : "确认并启动智能诊断"}
        </button>
      </footer>
    </div>
  );
}

function InputStageLegacy({
  input,
  materials,
  activeMaterialId,
  loading,
  activeStep,
  selections,
  thresholdValues,
  intakeBranch,
  equipmentFieldSources,
  triageAgentStatus,
  activeTransition,
  autoRecognizing,
  autoRecognized,
  equipmentTraceCount,
  onInput,
  onAddMaterials,
  onSelectMaterial,
  onRemoveMaterial,
  onPreviewMaterial,
  onAutoFill,
  onSelectionChange,
  onThresholdChange,
  onApplyThresholdSuggestion,
  onSelectStep,
  onContinue,
  onStart,
}) {
  const addImageInputRef = useRef(null);
  const addVideoInputRef = useRef(null);
  const addAudioInputRef = useRef(null);
  const intakeContinueRunning = triageAgentStatus === "running" && activeTransition?.type === "intake";
  const transitionFrom = intakeContinueRunning ? activeTransition.fromIndex : -1;
  const deviceComplete = equipmentOptionGroups.every((group) => selections[group.label]);
  const activeThresholdInputs = getBranchThresholdInputs(intakeBranch);
  const thresholdComplete = activeThresholdInputs.every(([label]) => thresholdValues[label]?.trim());
  const locationCompleted = activeStep > 1 || transitionFrom === 1;
  const deviceCompleted = activeStep > 2 || transitionFrom === 2;
  const thresholdCompleted = activeStep > 3 || transitionFrom === 3;
  const equipmentRecognitionSteps = [
    "读取现场描述",
    "匹配设备台账",
    "检索维修知识库",
    "核对设备型号",
    "生成推荐字段",
  ];
  const businessStepTitles = [
    "重新确认初始报障",
    "确认异常发生地点",
    "确认发生事件与设备对象",
    "补充其他现象与运行状态",
  ];
  const confirmedTrail = [
    activeStep > 1 && { label: "发生地点", value: "控制中心 · 站控柜 A01", step: 1 },
    activeStep > 2 && { label: "发生事件", value: selections["关联告警"] || "设备与告警已确认", step: 2 },
  ].filter(Boolean);

  return (
    <div className="stage-content input-stage dynamic-intake-stage">
      <div className="dynamic-intake-head">
        <div>
          <p className="eyebrow">异常接入 · 当前业务 {String(activeStep + 1).padStart(2, "0")}</p>
          <h2>{businessStepTitles[activeStep] || "现场接诊工作区"}</h2>
          <p className="business-starting-fact"><span>初始报障</span>{input || defaultInput}</p>
        </div>
        <span className={classNames("intake-generation-state", intakeContinueRunning && "running", activeStep === 4 && "ready")}>
          {intakeContinueRunning ? <Loader2 size={14} className="spin" /> : activeStep === 4 ? <Check size={14} /> : <Radio size={14} />}
          {intakeContinueRunning ? "正在生成下一项任务" : activeStep === 4 ? "事件信息已归集" : "等待现场确认"}
        </span>
      </div>

      <div className="dynamic-intake-board" data-active-step={activeStep}>
        <section className="spatial-time-card">
          <div><CalendarClock size={15} /><span>发生时间</span></div>
          <strong>2026-07-10 · 10:25</strong>
          <small>系统建议 · 持续约 10 分钟</small>
        </section>

        {activeStep === 0 && (
          <section className="spatial-location-placeholder" aria-label="空间位置上下文准备中">
            <img src="/images/site-station-overview.png" alt="山东德州分输站布局" />
            <div><Loader2 size={16} className={intakeContinueRunning ? "spin" : undefined} /><strong>正在建立空间位置上下文</strong><span>确认初始报障后定位故障点</span></div>
          </section>
        )}

        <section className="dynamic-site-context">
          <div className="dynamic-site-toolbar">
            <div><Paperclip size={15} /><span>其他现象</span><strong>{materials.length > 0 ? `现场材料 ${materials.length} 项` : "等待现场材料"}</strong></div>
            <span className="dynamic-fault-status"><i /> {materials.length > 0 ? "现场证据已就绪" : "可使用预置案例"}</span>
          </div>
          <div className="dynamic-context-layout">
            <section className="evidence-collection-panel">
              <div className="evidence-panel-head">
                <div>
                  <span>现场证据集合</span>
                  <strong>图片 · 视频 · 音频</strong>
                </div>
                <small>点击材料后放大预览</small>
              </div>
              <MaterialMosaic
                materials={materials}
                onPreview={(materialId) => {
                  onSelectMaterial(materialId);
                  onPreviewMaterial(materialId);
                }}
                onRemove={onRemoveMaterial}
              />
              <div className="evidence-material-toolbar">
                <div className="evidence-material-actions">
                  <button type="button" onClick={() => addImageInputRef.current?.click()}><ImagePlus size={13} /> 添加图片</button>
                  <button type="button" onClick={() => addVideoInputRef.current?.click()}><Video size={13} /> 添加视频</button>
                  <button type="button" onClick={() => addAudioInputRef.current?.click()}><Mic size={13} /> 添加音频</button>
                </div>
                <span>仅在当前浏览器会话中预览</span>
              </div>
            </section>
          </div>
          <input
            ref={addImageInputRef}
            className="visually-hidden-input"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => {
              onAddMaterials(event.target.files, "image");
              event.target.value = "";
            }}
          />
          <input
            ref={addVideoInputRef}
            className="visually-hidden-input"
            type="file"
            accept="video/*"
            multiple
            onChange={(event) => {
              onAddMaterials(event.target.files, "video");
              event.target.value = "";
            }}
          />
          <input
            ref={addAudioInputRef}
            className="visually-hidden-input"
            type="file"
            accept="audio/*"
            multiple
            onChange={(event) => {
              onAddMaterials(event.target.files, "audio");
              event.target.value = "";
            }}
          />
        </section>

        <div className="dynamic-intake-tasks" aria-live="polite">
          {activeStep === 0 && intakeContinueRunning && (
            <div className="intake-generating-card">
              <Loader2 size={18} className="spin" />
              <div><strong>接诊 Agent 正在分析</strong><span>解析现象并匹配设备台账</span></div>
            </div>
          )}

          {activeStep === 0 && !intakeContinueRunning && (
            <section className="intake-floating-card intake-symptom-edit-card">
              <div className="intake-floating-head">
                <span>00</span>
                <div><small>现场信息重新确认</small><h3>修改异常事件描述</h3></div>
                <em>待重新分析</em>
              </div>
              <label className="intake-symptom-editor">
                <span>现场异常描述</span>
                <textarea
                  value={input}
                  aria-label="现场异常描述"
                  onChange={(event) => onInput(event.target.value)}
                  rows={4}
                />
                <small>修改后将重新运行接诊 Agent，并重新确认位置、设备、告警和最终事件信息。</small>
              </label>
              <button className="primary-button intake-card-action" onClick={onContinue} disabled={!input.trim()}>
                <Radio size={15} /> 重新分析并更新接入信息
              </button>
            </section>
          )}

          {activeStep >= 1 && (
            <section className={classNames("intake-floating-card intake-location-card", locationCompleted && "completed")}>
              <div className="intake-floating-head">
                <span>01</span>
                <div>
                  <small>{locationCompleted ? "已确认故障点" : "接诊 Agent 生成"}</small>
                  <h3>{locationCompleted ? "山东德州分输站 · 控制中心 · 站控柜 A01" : "设备位置识别"}</h3>
                </div>
                <em>{locationCompleted ? "已确认" : "需要确认"}</em>
              </div>
              {!locationCompleted ? (
                <>
                  <div className="location-task-body">
                    <div className="location-task-map">
                      <img src="/images/site-station-overview.png" alt="识别到的设备所在场站" />
                      <div className="location-pulse" />
                      <MapPin className="location-map-pin" size={18} />
                    </div>
                    <p className="location-map-caption"><MapPin size={13} /> 控制中心 · 站控柜 A01</p>
                  </div>
                  <button className="primary-button intake-card-action" onClick={onContinue} disabled={intakeContinueRunning}>
                    确认设备位置 <ChevronRight size={15} />
                  </button>
                </>
              ) : (
                <div className="location-confirmed-visual">
                  <img src="/images/site-station-overview.png" alt="山东德州分输站控制中心站控柜 A01 故障点" />
                  <div className="location-pulse" />
                  <MapPin className="location-map-pin" size={19} />
                  <button type="button" onClick={() => onSelectStep(1)}>修改位置</button>
                </div>
              )}
            </section>
          )}

          {activeStep >= 2 && (
            <section className={classNames("intake-floating-card intake-device-card", deviceCompleted && "completed")}>
              <div className="intake-floating-head">
                <span>02</span>
                <div><small>设备识别 Agent 生成</small><h3>补充设备信息</h3></div>
                <em>{deviceCompleted ? "已完成" : "需要确认"}</em>
              </div>
              {!deviceCompleted ? (
                <>
                  <div className="intake-field-grid">
                    {equipmentOptionGroups.map((group) => (
                      <label key={group.label}>
                        <span>{group.label}</span>
                        <select
                          value={selections[group.label] || ""}
                          aria-label={group.label}
                          onChange={(event) => onSelectionChange(group.label, event.target.value)}
                          disabled={autoRecognizing}
                        >
                          <option value="" disabled>请选择</option>
                          {group.options.map((option, index) => (
                            <option value={option} key={`${group.label}-${option}-${index}`}>{option}</option>
                          ))}
                        </select>
                        {equipmentFieldSources[group.label] && (
                          <small className={classNames("field-source-badge", equipmentFieldSources[group.label].includes("工程师") && "manual")}>
                            来源 · {equipmentFieldSources[group.label]}
                          </small>
                        )}
                      </label>
                    ))}
                  </div>
                  {intakeBranch.id !== "standard-thermal" && (
                    <div className={classNames("intake-branch-note", intakeBranch.tone)}>
                      <span>{intakeBranch.label}</span><strong>{intakeBranch.title}</strong><p>{intakeBranch.detail}</p>
                    </div>
                  )}
                  <div className="intake-recognition-row">
                    <div>
                      <strong>{autoRecognizing ? "设备识别 Agent 正在读取" : autoRecognized ? "系统建议已生成" : "可自动读取现场与台账信息"}</strong>
                      <div className="intake-recognition-trace">
                        {equipmentRecognitionSteps.slice(0, equipmentTraceCount).map((item) => <span key={item}><Check size={11} /> {item}</span>)}
                      </div>
                    </div>
                    <button className="ghost-button" onClick={onAutoFill} disabled={autoRecognizing}>
                      {autoRecognizing ? <Loader2 size={14} className="spin" /> : <Zap size={14} />}
                      {autoRecognizing ? "识别中" : "自动识别"}
                    </button>
                  </div>
                  <button className="primary-button intake-card-action" onClick={onContinue} disabled={!deviceComplete || intakeContinueRunning || autoRecognizing}>
                    确认设备信息 <ChevronRight size={15} />
                  </button>
                </>
              ) : (
                <div className="intake-retained-result">
                  <div className="intake-result-grid">
                    {equipmentOptionGroups.map((group) => (
                      <p key={group.label}><span>{group.label}</span><strong>{selections[group.label]}</strong></p>
                    ))}
                  </div>
                  <div className="intake-result-foot">
                    <span><Cpu size={13} /> 台账与现场特征匹配完成</span>
                    <button onClick={() => onSelectStep(2)}>修改信息</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {activeStep >= 3 && (
            <section className={classNames("intake-floating-card intake-threshold-card", thresholdCompleted && "completed")}>
              <div className="intake-floating-head">
                <span>03</span>
                <div>
                  <small>告警解析 Agent 生成</small>
                  <h3>{intakeBranch.id === "equipment-mismatch" ? "确认控制器与通信状态" : "确认告警与运行状态"}</h3>
                </div>
                <em>{thresholdCompleted ? "已完成" : "需要确认"}</em>
              </div>
              {!thresholdCompleted ? (
                <>
                  <div className="intake-field-grid threshold-fields">
                    {activeThresholdInputs.map(([label, value, suggestion]) => (
                      <label key={label}>
                        <span>{label}</span>
                        <input value={thresholdValues[label] || ""} aria-label={label} onChange={(event) => onThresholdChange(label, event.target.value)} />
                        <button type="button" onClick={() => onApplyThresholdSuggestion(label, value)}>采用建议：{suggestion}</button>
                      </label>
                    ))}
                  </div>
                  <div className={classNames("intake-branch-note", intakeBranch.tone)}>
                    <span>{intakeBranch.label}</span><strong>{intakeBranch.title}</strong><p>{intakeBranch.detail}</p>
                  </div>
                  <button className="primary-button intake-card-action" onClick={onContinue} disabled={!thresholdComplete || intakeContinueRunning}>
                    确认告警状态 <ChevronRight size={15} />
                  </button>
                </>
              ) : (
                <div className="intake-retained-result">
                  <div className="intake-result-grid threshold-result-grid">
                    {activeThresholdInputs.map(([label]) => (
                      <p key={label}><span>{label}</span><strong>{thresholdValues[label]}</strong></p>
                    ))}
                  </div>
                  <div className="intake-result-foot warning">
                    <span><AlertTriangle size={13} /> 已确认散热告警与运行状态</span>
                    <button onClick={() => onSelectStep(3)}>修改信息</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {activeStep >= 3 && (
            <section className="spatial-evidence-dock">
              <article>
                <span><ShieldCheck size={13} /> 依据标准</span>
                <strong>TEMP/FAN 告警与风扇低速判据</strong>
                <small>阈值规则 · 设备台账 · 历史案例</small>
              </article>
              <article>
                <span><FileText size={13} /> 操作手册</span>
                <strong>ACP-4000 / IPC-610 散热检查</strong>
                <small>已命中风道、滤网与风扇章节</small>
              </article>
            </section>
          )}

          {activeStep >= 4 && (
            <section className="intake-floating-card intake-summary-card">
              <div className="intake-floating-head">
                <span>04</span>
                <div><small>接诊 Agent 归集生成</small><h3>事件信息已归集</h3></div>
                <em>可诊断</em>
              </div>
              <div className="intake-summary-facts">
                <p><span>设备</span><strong>{selections["设备型号"]}</strong></p>
                <p><span>位置</span><strong>控制中心 · 站控柜 A01</strong></p>
                <p><span>告警</span><strong>{thresholdValues["TEMP/FAN LED"]} · {thresholdValues["风扇转速"]}</strong></p>
              </div>
              <div className="intake-diagnosis-tasks">
                {generatedDiagnosisPlan.map((task) => <span key={task}><Check size={11} /> {task}</span>)}
              </div>
              <button className="primary-button intake-card-action" onClick={onStart} disabled={loading}>
                {loading ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                {loading ? "正在进入分析诊断" : "触发诊断"}
              </button>
            </section>
          )}
        </div>

        {confirmedTrail.length > 0 && (
          <div className="spatial-confirmed-rail" aria-label="已确认步骤">
            <span><Check size={12} /> 已确认步骤</span>
            {confirmedTrail.map((item) => (
              <button type="button" key={item.label} onClick={() => onSelectStep(item.step)}>
                <small>{item.label}</small><strong>{item.value}</strong>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InputStage({
  input,
  incidentTime,
  materials,
  references,
  loading,
  activeStep,
  selections,
  thresholdValues,
  intakeBranch,
  equipmentFieldSources,
  triageAgentStatus,
  activeTransition,
  autoRecognizing,
  autoRecognized,
  equipmentTraceCount,
  onInput,
  onIncidentTimeChange,
  onAddMaterials,
  onRemoveMaterial,
  onPreviewMaterial,
  onAutoFill,
  onSelectionChange,
  onThresholdChange,
  onApplyThresholdSuggestion,
  onSelectStep,
  onContinue,
}) {
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const [expandedEvidence, setExpandedEvidence] = useState(null);
  const transitioning = triageAgentStatus === "running" && activeTransition?.type === "intake";
  const transitionFrom = transitioning ? activeTransition.fromIndex : -1;
  const deviceComplete = equipmentOptionGroups.every((group) => selections[group.label]);
  const activeThresholdInputs = getBranchThresholdInputs(intakeBranch);
  const thresholdComplete = activeThresholdInputs.every(([label]) => thresholdValues[label]?.trim());
  const recognitionSteps = ["读取现场描述", "匹配设备台账", "检索维修知识库", "核对设备型号", "生成推荐字段"];
  const taskTitles = ["确认异常发生时间", "确认异常发生地点", "确认发生事件与设备对象", "补充其他现象与运行状态", "核对判断依据与操作手册"];
  const knownItems = [
    { label: "初始报障", value: input || defaultInput, step: 0, visible: true },
    { label: "检修资料", value: references.length ? `${references.length} 项 · 本次接诊资料包` : "未额外编组", step: 4, visible: references.length > 0 },
    { label: "发生时间", value: `${incidentTime.detectedAt?.replace("T", " ")} · ${incidentTime.duration}`, step: 0, visible: activeStep > 0 },
    { label: "发生地点", value: "控制中心 · 站控柜 A01", step: 1, visible: activeStep > 1 },
    { label: "发生事件", value: selections["设备型号"] || "设备对象已确认", step: 2, visible: activeStep > 2 },
    { label: "其他现象", value: `${thresholdValues["TEMP/FAN LED"] || "告警"} · ${materials.length} 项材料`, step: 3, visible: activeStep > 3 },
  ].filter((item) => item.visible);
  const cardClass = (kind, step) => classNames("intake-current-task", `task-${kind}`, transitionFrom === step && "archiving");

  const uploadInput = (ref, accept, type) => (
    <input
      ref={ref}
      className="visually-hidden-input"
      type="file"
      accept={accept}
      multiple
      onChange={(event) => {
        onAddMaterials(event.target.files, type);
        event.target.value = "";
      }}
    />
  );

  return (
    <div className="stage-content input-stage spatial-intake-v12">
      <header className="spatial-v12-head">
        <div>
          <p className="eyebrow">异常接入 · 第 {activeStep + 1} / 5 项</p>
          <h2>{taskTitles[activeStep]}</h2>
        </div>
        <span className={classNames("intake-generation-state", transitioning && "running")}>
          {transitioning ? <Loader2 size={14} className="spin" /> : <Radio size={14} />}
          {transitioning ? "Agent 正在生成下一项" : "等待工程师确认"}
        </span>
      </header>

      <section className="known-context-dock" aria-label="已知信息">
        <div className="known-context-title"><Check size={14} /><span>已知信息</span></div>
        <div className="known-context-items">
          {knownItems.map((item, index) => (
            <button
              type="button"
              className={classNames("known-context-chip", index === knownItems.length - 1 && activeStep > 0 && "latest")}
              key={item.label}
              onClick={() => onSelectStep(item.step)}
            >
              <small>{item.label}</small><strong>{item.value}</strong>
            </button>
          ))}
        </div>
      </section>

      <div className="spatial-v12-board" data-step={activeStep}>
        <section className={classNames("spatial-v12-map", activeStep >= 1 && "located")}>
          <img src="/images/site-station-overview.png" alt="山东德州分输站控制中心布局及故障点" />
          <div className="map-scan-line" />
          {activeStep >= 1 && <><div className="location-pulse" /><MapPin className="location-map-pin" size={22} /></>}
          <div className="map-focus-caption">
            <span>{activeStep === 0 ? "空间上下文" : "已识别故障点"}</span>
            <strong>{activeStep === 0 ? "等待时间确认后定位" : "山东德州分输站 · 控制中心 · 站控柜 A01"}</strong>
          </div>
          {activeStep === 1 && !transitioning && (
            <button className="primary-button map-confirm-action staged-confirm" onClick={onContinue}>
              <MapPin size={15} /> 确认发生地点
            </button>
          )}
          {activeStep > 1 && <button className="map-edit-action" type="button" onClick={() => onSelectStep(1)}>修改地点</button>}
        </section>

        <div className="spatial-v12-task-slot" aria-live="polite">
          {transitioning && (
            <div className="next-task-generating">
              <Loader2 size={18} className="spin" />
              <div><strong>正在归档本项信息</strong><span>接诊 Agent 将生成下一项确认任务</span></div>
            </div>
          )}

          {activeStep === 0 && (
            <section className={cardClass("time", 0)}>
              <TaskCardHead number="01" kicker="发生时间" title="确认异常何时发生" />
              <label className="staged-field" style={{ "--field-index": 0 }}><span>首次发现时间</span><input type="datetime-local" value={incidentTime.detectedAt} onChange={(event) => onIncidentTimeChange("detectedAt", event.target.value)} /></label>
              <div className="task-two-columns staged-field" style={{ "--field-index": 1 }}>
                <label><span>持续时长</span><select value={incidentTime.duration} onChange={(event) => onIncidentTimeChange("duration", event.target.value)}><option>刚刚发现</option><option>约 10 分钟</option><option>约 30 分钟</option><option>超过 1 小时</option></select></label>
                <label><span>发生频次</span><select value={incidentTime.recurrence} onChange={(event) => onIncidentTimeChange("recurrence", event.target.value)}><option>首次发现</option><option>间歇出现</option><option>重复发生</option></select></label>
              </div>
              <label className="staged-field task-description" style={{ "--field-index": 2 }}><span>初始报障描述</span><textarea rows={3} value={input} onChange={(event) => onInput(event.target.value)} /></label>
              <button className="primary-button task-confirm-action staged-confirm" onClick={onContinue} disabled={!incidentTime.detectedAt || !input.trim()}>确认发生时间 <ChevronRight size={15} /></button>
            </section>
          )}

          {activeStep === 2 && (
            <section className={cardClass("event", 2)}>
              <TaskCardHead number="03" kicker="发生事件" title="确认设备与告警对象" />
              <div className="event-recognition-reason staged-field" style={{ "--field-index": 0 }}>
                <div><Cpu size={17} /><strong>为什么识别为该设备</strong></div>
                <p>报障描述中的“站控柜、TEMP/FAN、风扇转速低”同时命中站控柜 A01 台账和 ACP-4000 / IPC-610 散热知识条目。</p>
                <span>现场描述 + 场站台账 + 维修知识库</span>
              </div>
              <div className="intake-field-grid">
                {equipmentOptionGroups.map((group, index) => (
                  <label className="staged-field" style={{ "--field-index": index + 1 }} key={group.label}>
                    <span>{group.label}</span>
                    <select value={selections[group.label] || ""} onChange={(event) => onSelectionChange(group.label, event.target.value)} disabled={autoRecognizing}>
                      <option value="" disabled>请选择</option>
                      {group.options.map((option) => <option value={option} key={option}>{option}</option>)}
                    </select>
                    {equipmentFieldSources[group.label] && <small className="field-source-badge">来源 · {equipmentFieldSources[group.label]}</small>}
                  </label>
                ))}
              </div>
              <div className="intake-recognition-row staged-field" style={{ "--field-index": 5 }}>
                <div><strong>{autoRecognizing ? "设备识别 Agent 正在读取" : autoRecognized ? "系统建议已生成" : "可读取现场与台账信息"}</strong><div className="intake-recognition-trace">{recognitionSteps.slice(0, equipmentTraceCount).map((item) => <span key={item}><Check size={11} /> {item}</span>)}</div></div>
                <button className="ghost-button" onClick={onAutoFill} disabled={autoRecognizing}>{autoRecognizing ? <Loader2 size={14} className="spin" /> : <Zap size={14} />}{autoRecognizing ? "识别中" : "自动识别"}</button>
              </div>
              <button className="primary-button task-confirm-action staged-confirm" onClick={onContinue} disabled={!deviceComplete || transitioning || autoRecognizing}>确认发生事件 <ChevronRight size={15} /></button>
            </section>
          )}

          {activeStep === 3 && (
            <section className={cardClass("phenomena", 3)}>
              <TaskCardHead number="04" kicker="其他现象" title="补充运行状态与现场材料" />
              <div className="phenomena-category-strip staged-field" style={{ "--field-index": 0 }}>
                <span><Radio size={12} /> 灯态</span><span><Volume2 size={12} /> 声音</span><span><CalendarClock size={12} /> 温度</span><span><Zap size={12} /> 转速</span>
              </div>
              <div className="intake-field-grid threshold-fields">
                {activeThresholdInputs.map(([label, value, suggestion], index) => (
                  <label className="staged-field" style={{ "--field-index": index + 1 }} key={label}><span>{label}</span><input value={thresholdValues[label] || ""} onChange={(event) => onThresholdChange(label, event.target.value)} /><button type="button" onClick={() => onApplyThresholdSuggestion(label, value)}>采用建议：{suggestion}</button></label>
                ))}
              </div>
              <div className="task-materials staged-field" style={{ "--field-index": 5 }}>
                <div className="task-materials-head"><div><span>现场材料</span><strong>{materials.length} 项图片 / 视频 / 音频</strong></div><small>点击缩略图预览</small></div>
                <MaterialMosaic materials={materials} onPreview={onPreviewMaterial} onRemove={onRemoveMaterial} />
                <div className="evidence-material-actions"><button type="button" onClick={() => imageInputRef.current?.click()}><ImagePlus size={13} /> 图片</button><button type="button" onClick={() => videoInputRef.current?.click()}><Video size={13} /> 视频</button><button type="button" onClick={() => audioInputRef.current?.click()}><Mic size={13} /> 音频</button></div>
              </div>
              <button className="primary-button task-confirm-action staged-confirm" onClick={onContinue} disabled={!thresholdComplete || transitioning}>确认其他现象 <ChevronRight size={15} /></button>
            </section>
          )}

          {activeStep === 4 && (
            <section className={cardClass("evidence", 4)}>
              <TaskCardHead number="05" kicker="判断依据" title="核对标准与操作手册" />
              <button type="button" className={classNames("evidence-reference staged-field", expandedEvidence === "standard" && "expanded")} style={{ "--field-index": 0 }} onClick={() => setExpandedEvidence((value) => value === "standard" ? null : "standard")}><ShieldCheck size={18} /><div><span>依据标准 · 点击{expandedEvidence === "standard" ? "收起" : "展开"}</span><strong>TEMP/FAN 告警与风扇低速判据</strong><p>{expandedEvidence === "standard" ? "当前风扇转速低于 500 rpm，同时系统温度与 CPU 温度超过建议阈值，三项条件共同支持散热异常方向。" : "设备阈值、台账记录和历史检修案例共同形成当前判断。"}</p></div></button>
              {references.length ? (
                <section className="evidence-reference reference-package-evidence staged-field" style={{ "--field-index": 1 }}>
                  <PackageCheck size={18} />
                  <div><span>本次接诊资料包 · 已确认引用</span><strong>{references.length} 项案例、知识与厂商手册</strong><p>{references.slice(0, 3).map((item) => `${referenceTypeMeta[item.type].label} · ${item.title}`).join("；")}{references.length > 3 ? `；另有 ${references.length - 3} 项` : ""}</p></div>
                </section>
              ) : (
                <button type="button" className={classNames("evidence-reference staged-field", expandedEvidence === "manual" && "expanded")} style={{ "--field-index": 1 }} onClick={() => setExpandedEvidence((value) => value === "manual" ? null : "manual")}><FileText size={18} /><div><span>操作手册 · 点击{expandedEvidence === "manual" ? "收起" : "展开"}</span><strong>工控机散热检查</strong><p>{expandedEvidence === "manual" ? "手册中的风道、滤网和风扇维护章节与当前告警对象一致，因此进入诊断后优先生成断电确认、风道检查和风扇验证任务。" : "未额外编组检修资料，当前使用系统默认手册依据。"}</p></div></button>
              )}
              <div className={classNames("intake-branch-note staged-field", intakeBranch.tone)} style={{ "--field-index": 2 }}><span>{intakeBranch.label}</span><strong>{intakeBranch.title}</strong><p>{intakeBranch.detail}</p></div>
              <button className="primary-button task-confirm-action staged-confirm" onClick={onContinue} disabled={transitioning}>形成现场异常事件全景 <ChevronRight size={15} /></button>
            </section>
          )}
        </div>
      </div>

      {uploadInput(imageInputRef, "image/*", "image")}
      {uploadInput(videoInputRef, "video/*", "video")}
      {uploadInput(audioInputRef, "audio/*", "audio")}
    </div>
  );
}

function TaskCardHead({ number, kicker, title }) {
  return (
    <div className="intake-current-head">
      <span>{number}</span>
      <div><small>{kicker}</small><h3>{title}</h3></div>
      <em>当前任务</em>
    </div>
  );
}

function AgentStateBadge({ status, idleText = "待启动", runningText = "运行中", doneText = "已完成" }) {
  const isRunning = status === "running";
  const isDone = status === "done";
  return (
    <span className={classNames("agent-state-badge", isRunning && "running", isDone && "done")}>
      {isRunning && <Loader2 size={14} className="spin" />}
      {isDone && <Check size={14} />}
      {isRunning ? runningText : isDone ? doneText : idleText}
    </span>
  );
}

function AgentTraceList({ items, visibleCount }) {
  return (
    <ul className="agent-trace-list">
      {items.slice(0, visibleCount).map((item) => (
        <li className="agent-trace-item" key={item}>
          <span />
          {item}
        </li>
      ))}
    </ul>
  );
}

function EquipmentRecognitionAgent({ autoRecognizing, autoRecognized, visibleCount, selectedValues, onAutoFill }) {
  const traceItems = [
    "正在思考：优先确认当前异常是否属于已接入设备对象。",
    "读取现场描述：温度告警、风扇声音异常、风扇转速偏低。",
    "匹配设备台账：山东德州分输站 · 站控柜 A01。",
    "检索维修知识库：ACP-4000 / IPC-610 散热与告警面板。",
    "生成推荐字段：型号、位置、角色、关联告警。",
  ];
  const referenceItems = ["现场描述", "设备台账", "维修知识库"];
  const status = autoRecognizing ? "running" : autoRecognized ? "done" : "idle";
  const referenceCount = autoRecognized ? referenceItems.length : Math.max(0, Math.min(referenceItems.length, visibleCount - 1));

  return (
    <section className="equipment-agent-panel">
      <div className="equipment-agent-head">
        <div>
          <span>设备识别 Agent</span>
          <h3>自动识别当前检修对象</h3>
          <p>根据现场描述、设备台账和维修知识库推荐设备补充项。</p>
        </div>
        <AgentStateBadge status={status} idleText="待启动" runningText="识别中" doneText="已完成" />
      </div>
      <div className="equipment-agent-body">
        <div className="agent-thinking-card">
          <div className="agent-thinking-title">
            <strong>{autoRecognized ? "已完成识别，引用 3 类信息" : autoRecognizing ? "正在识别设备对象" : "等待启动识别"}</strong>
            <small>{autoRecognized ? "识别结果已填入下方字段" : "启动后展示识别轨迹"}</small>
          </div>
          {status === "idle" ? (
            <p>点击自动设备识别后，系统会按预设流程展示设备匹配轨迹。</p>
          ) : autoRecognizing && visibleCount === 0 ? (
            <div className="assistant-thinking-line compact">
              <Loader2 size={14} className="spin" />
              <p>正在思考设备对象、现场描述和台账匹配关系...</p>
            </div>
          ) : (
            <AgentTraceList items={traceItems} visibleCount={visibleCount} />
          )}
          <div className="agent-reference-chips">
            {(status === "idle" ? ["待读取信息", "待匹配对象"] : referenceItems.slice(0, referenceCount)).map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </div>
        <div className="agent-result-card">
          <strong>{autoRecognized ? "推荐补充项" : "操作"}</strong>
          {autoRecognized && selectedValues.length > 0 ? (
            <div className="recognized-values">
              {selectedValues.map((value) => <span key={value}>{value}</span>)}
            </div>
          ) : (
            <p>识别完成后，型号、位置、角色和关联告警会填入下方字段，工程师可继续调整。</p>
          )}
          <button className="primary-button" onClick={onAutoFill} disabled={autoRecognizing}>
            {autoRecognizing ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
            {autoRecognizing ? "识别中" : autoRecognized ? "重新识别" : "自动设备识别"}
          </button>
        </div>
      </div>
    </section>
  );
}

function AgentRunStage({ agents, activeAgentIndex }) {
  const progress = Math.min(100, Math.round((Math.max(0, activeAgentIndex) / agents.length) * 100));

  return (
    <div className="stage-content consultation-central-stage">
      <section className="consultation-central-status">
        <div className="consultation-orbit"><span /><span /><span /><Cpu size={30} /></div>
        <p className="eyebrow">分析诊断</p>
        <h2>{activeAgentIndex >= agents.length ? "会诊完成，正在生成诊断结论" : "多 Agent 会诊进行中"}</h2>
        <p>详细思考、检索依据和阶段结论正在右侧“多 Agent 会诊”区域持续生成。</p>
        <div className="consultation-event-summary">
          <span>事件对象</span><strong>站控柜 A01 · ACP-4000 / IPC-610</strong><em>散热异常方向</em>
        </div>
        <div className="consultation-progress-system">
          <div className="consultation-central-progress"><i style={{ width: `${progress}%` }} /></div>
          <span className="consultation-progress-value">{progress}%</span>
          <div className="consultation-status-dots">
            {agents.map((agent, index) => <span className={classNames(index < activeAgentIndex && "done", index === activeAgentIndex && "running")} key={agent.name}>{index < activeAgentIndex ? <Check size={12} /> : index + 1}<small>{agent.name}</small></span>)}
          </div>
        </div>
      </section>
    </div>
  );
}

function DiagnosisStage({ diagnosis, evidence, activeTask, transitionRunning, onSelectTask, onEnterGuide }) {
  const rankedCauses = [
    ["风道堵塞 / 滤网积尘", "优先级高", "现象与风扇声音异常、转速偏低、高温告警相符。"],
    ["风扇低速或停转", "优先级高", "需核对转速是否低于 500 rpm，并检查 FAN1/FAN2 接线顺序。"],
    ["机柜环境温度或通风条件异常", "待确认", "需确认环境温度是否超过 40°C，进出风口是否被遮挡。"],
  ];
  const isLastTask = activeTask === diagnosisTasks.length - 1;

  return (
    <div className="stage-content diagnosis-stage">
      <div className="stage-copy">
        <p className="eyebrow">分析诊断 · 第 {activeTask + 1} / {diagnosisTasks.length} 步</p>
        <h2>{diagnosisTasks[activeTask].title}</h2>
        <p>{diagnosisTasks[activeTask].detail}</p>
      </div>

      {activeTask === 0 && (
        <div className="diagnosis-step-screen">
          <section className="conclusion-card">
            <div>
              <span className="status-badge">已接收异常接入信息</span>
              <h3>散热异常诊断已触发</h3>
              <p>系统将基于设备型号、灯值阈值和现场现象进入预设多 Agent 会诊流程。</p>
            </div>
            <AlertTriangle size={26} />
          </section>
          <section className="handoff-grid">
            <article><span>设备</span><strong>研华 ACP-4000 / IPC-610</strong></article>
            <article><span>故障方向</span><strong>TEMP/FAN 与高温告警</strong></article>
            <article><span>诊断边界</span><strong>站控柜内工控机散热系统</strong></article>
          </section>
        </div>
      )}

      {activeTask === 1 && (
        <div className="diagnosis-step-screen">
          <section className="agent-strip">
            {diagnosis.agents.map((agent) => (
              <article key={agent.name}>
                <span>已完成</span>
                <strong>{agent.name}</strong>
                <p>{agent.content}</p>
              </article>
            ))}
          </section>

          <section className="evidence-row">
            {evidence.slice(0, 4).map((item) => (
              <article key={item.id}>
                <span>{item.id}</span>
                <strong>{item.title}</strong>
              </article>
            ))}
          </section>
        </div>
      )}

      {activeTask === 2 && (
        <div className="diagnosis-step-screen final-report">
          <section className="conclusion-card">
            <div>
              <span className="status-badge">建议进入检修向导</span>
              <h3>{diagnosis.title}</h3>
              <p>{diagnosis.summary}</p>
              <p>{diagnosis.risk}</p>
            </div>
            <AlertTriangle size={26} />
          </section>

          <section className="cause-ranking">
            <h3>可能原因排序</h3>
            {rankedCauses.map(([name, level, detail]) => (
              <article key={name}>
                <span>{level}</span>
                <strong>{name}</strong>
                <p>{detail}</p>
              </article>
            ))}
          </section>
        </div>
      )}

      <div className="stage-actions">
        <button
          className="ghost-button"
          onClick={() => onSelectTask(Math.max(0, activeTask - 1))}
          disabled={activeTask === 0}
        >
          <ChevronLeft size={16} />
          上一步
        </button>
        {!isLastTask ? (
          <button
            className="primary-button"
            onClick={() => onSelectTask(Math.min(diagnosisTasks.length - 1, activeTask + 1))}
            disabled={transitionRunning}
          >
            确认并继续 <ChevronRight size={16} />
          </button>
        ) : (
          <button className="primary-button" onClick={onEnterGuide} disabled={transitionRunning}>
            {transitionRunning ? <Loader2 size={16} className="spin" /> : null}
            {transitionRunning ? "正在生成检修预方案" : "生成检修预方案"} <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

const lockedSafetyChecks = new Set(["正常关机", "拔除所有电源", "等待冷却", "防静电"]);

function buildEditablePlan(steps) {
  return steps.map((step, stepIndex) => ({
    ...step,
    order: stepIndex + 1,
    origin: step.origin || "system",
    checks: step.checks.map((check, checkIndex) => ({
      id: `${step.id}-check-${checkIndex + 1}`,
      text: typeof check === "string" ? check : check.text,
      origin: typeof check === "string" ? "system" : check.origin || "system",
      source: typeof check === "string" ? step.source : check.source || step.source,
      locked: typeof check === "string" ? lockedSafetyChecks.has(check) : Boolean(check.locked),
    })),
  }));
}

function MaintenancePlanStage({ initialSteps, onBack, onConfirm, onRevision }) {
  const [systemPlan] = useState(() => buildEditablePlan(initialSteps));
  const [workingPlan, setWorkingPlan] = useState(() => buildEditablePlan(initialSteps));
  const [revisionCount, setRevisionCount] = useState(0);
  const [notice, setNotice] = useState("");
  const [visibleStepCount, setVisibleStepCount] = useState(1);
  const revisedTextFields = useRef(new Set());
  const idCounter = useRef(0);

  useEffect(() => {
    if (visibleStepCount >= workingPlan.length) return undefined;
    const timer = window.setTimeout(() => setVisibleStepCount((count) => count + 1), 420);
    return () => window.clearTimeout(timer);
  }, [visibleStepCount, workingPlan.length]);

  const checkCount = workingPlan.reduce((total, step) => total + step.checks.length, 0);
  const outlineGenerating = visibleStepCount < workingPlan.length;
  const canConfirm = !outlineGenerating && workingPlan.length > 0 && workingPlan.every((step) => (
    step.title.trim() && step.checks.length > 0 && step.checks.every((check) => check.text.trim())
  ));

  function markRevision(message) {
    setRevisionCount((count) => count + 1);
    setNotice(message);
    onRevision(message.trim());
  }

  function updateStep(stepId, field, value) {
    setWorkingPlan((current) => current.map((step) => (
      step.id === stepId ? { ...step, [field]: value, origin: "engineer" } : step
    )));
  }

  function markTextRevision(fieldKey, message, changed) {
    if (!changed) return;
    if (revisedTextFields.current.has(fieldKey)) return;
    revisedTextFields.current.add(fieldKey);
    markRevision(message);
  }

  function systemStepValue(stepId, field) {
    return systemPlan.find((step) => step.id === stepId)?.[field];
  }

  function systemCheckValue(stepId, checkId) {
    return systemPlan.find((step) => step.id === stepId)?.checks.find((check) => check.id === checkId)?.text;
  }

  function nextPlanId(prefix) {
    idCounter.current += 1;
    return `${prefix}-${Date.now()}-${idCounter.current}`;
  }

  function addStep() {
    const id = nextPlanId("plan-step");
    setWorkingPlan((current) => [
      ...current,
      {
        id,
        order: current.length + 1,
        title: "新增检修阶段",
        description: "请补充本阶段的检修目标。",
        placeholder: id,
        checks: [{ id: `${id}-check-1`, text: "请输入小维修步骤", origin: "engineer", source: "工程师现场补充", locked: false }],
        safety: "执行前确认现场安全条件。",
        thresholds: [],
        source: "工程师现场补充",
        origin: "engineer",
      },
    ]);
    markRevision("工程师新增了一个检修阶段。请修改阶段标题和小维修步骤。 ");
  }

  function removeStep(stepId) {
    const target = workingPlan.find((step) => step.id === stepId);
    if (target?.checks.some((check) => check.locked)) {
      setNotice("该阶段包含强制安全约束，不能删除。可以修改普通检查项。 ");
      return;
    }
    if (workingPlan.length === 1) {
      setNotice("检修方案至少需要保留一个大步骤。 ");
      return;
    }
    setWorkingPlan((current) => current.filter((step) => step.id !== stepId));
    markRevision(`工程师删除了“${target?.title || "检修阶段"}”。`);
  }

  function moveStep(stepId, direction) {
    setWorkingPlan((current) => {
      const index = current.findIndex((step) => step.id === stepId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next.map((step, stepIndex) => ({ ...step, order: stepIndex + 1 }));
    });
    markRevision("工程师调整了检修阶段顺序。 ");
  }

  function addCheck(stepId) {
    const id = nextPlanId("plan-check");
    setWorkingPlan((current) => current.map((step) => (
      step.id === stepId
        ? { ...step, checks: [...step.checks, { id, text: "新增小维修步骤", origin: "engineer", source: "工程师现场补充", locked: false }] }
        : step
    )));
    markRevision("工程师新增了一条小维修步骤。 ");
  }

  function updateCheck(stepId, checkId, value) {
    setWorkingPlan((current) => current.map((step) => (
      step.id === stepId
        ? { ...step, checks: step.checks.map((check) => check.id === checkId ? { ...check, text: value, origin: "engineer" } : check) }
        : step
    )));
  }

  function removeCheck(stepId, checkId) {
    const step = workingPlan.find((item) => item.id === stepId);
    const check = step?.checks.find((item) => item.id === checkId);
    if (check?.locked) {
      setNotice(`“${check.text}”属于强制安全约束，不能删除。`);
      return;
    }
    if (step?.checks.length === 1) {
      setNotice("每个大步骤至少需要保留一条小维修步骤。 ");
      return;
    }
    setWorkingPlan((current) => current.map((item) => (
      item.id === stepId ? { ...item, checks: item.checks.filter((candidate) => candidate.id !== checkId) } : item
    )));
    markRevision(`工程师删除了“${check?.text || "小维修步骤"}”。`);
  }

  function moveCheck(stepId, checkId, direction) {
    setWorkingPlan((current) => current.map((step) => {
      if (step.id !== stepId) return step;
      const index = step.checks.findIndex((check) => check.id === checkId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= step.checks.length) return step;
      const checks = [...step.checks];
      [checks[index], checks[targetIndex]] = [checks[targetIndex], checks[index]];
      return { ...step, checks };
    }));
    markRevision("工程师调整了小维修步骤顺序。 ");
  }

  function restoreSystemPlan() {
    setWorkingPlan(systemPlan.map((step) => ({ ...step, checks: step.checks.map((check) => ({ ...check })) })));
    revisedTextFields.current.clear();
    setRevisionCount(0);
    setNotice("已恢复检修编排 Agent 生成的系统初稿。 ");
    onRevision("工程师恢复了检修编排 Agent 的系统初稿。");
  }

  function confirmPlan() {
    if (!canConfirm) {
      setNotice("请确保每个大步骤都有标题，并至少保留一条有效的小维修步骤。 ");
      return;
    }
    const confirmedSteps = workingPlan.map((step, index) => ({
      ...step,
      order: index + 1,
      checks: step.checks.map((check) => check.text.trim()),
      planChecks: step.checks.map((check) => ({ ...check, text: check.text.trim() })),
      completed: false,
    }));
    onConfirm(confirmedSteps);
  }

  return (
    <div className="stage-content maintenance-plan-stage">
      <header className="plan-stage-head">
        <div>
          <p className="eyebrow">检修编排 · 工程师确认</p>
          <h2>检修预方案</h2>
          <p>系统已根据诊断结论生成两级检修大纲。可直接采用，也可以原位修改。</p>
        </div>
        <span>{outlineGenerating ? <Loader2 size={15} className="spin" /> : <Wrench size={15} />} {outlineGenerating ? "正在生成步骤提纲" : "等待工程师确认"}</span>
      </header>

      <div className="plan-metrics">
        <p><span>检修阶段</span><strong>{workingPlan.length}</strong></p>
        <p><span>小维修步骤</span><strong>{checkCount}</strong></p>
        <p><span>工程师修改</span><strong>{revisionCount}</strong></p>
        <p><span>强制安全项</span><strong>{workingPlan.flatMap((step) => step.checks).filter((check) => check.locked).length}</strong></p>
      </div>

      {notice && <div className="plan-notice" role="status">{notice}</div>}

      <section className="plan-outline" aria-label="检修预方案大纲">
        {workingPlan.slice(0, visibleStepCount).map((step, stepIndex) => (
          <article className="plan-outline-step" key={step.id}>
            <div className="plan-step-index">{String(stepIndex + 1).padStart(2, "0")}</div>
            <div className="plan-step-content">
              <header>
                <div className="plan-step-title-fields">
                  <input
                    value={step.title}
                    aria-label={`第 ${stepIndex + 1} 步标题`}
                    onChange={(event) => updateStep(step.id, "title", event.target.value)}
                    onBlur={() => markTextRevision(
                      `${step.id}:title`,
                      `工程师修改了第 ${stepIndex + 1} 个检修阶段标题。`,
                      systemStepValue(step.id, "title") !== step.title
                    )}
                  />
                  <input
                    value={step.description}
                    aria-label={`第 ${stepIndex + 1} 步描述`}
                    onChange={(event) => updateStep(step.id, "description", event.target.value)}
                    onBlur={() => markTextRevision(
                      `${step.id}:description`,
                      `工程师补充了“${step.title}”的检修目标。`,
                      systemStepValue(step.id, "description") !== step.description
                    )}
                  />
                </div>
                <div className="plan-step-actions">
                  <button onClick={() => moveStep(step.id, -1)} disabled={stepIndex === 0} title="上移阶段"><ChevronUp size={14} /></button>
                  <button onClick={() => moveStep(step.id, 1)} disabled={stepIndex === workingPlan.length - 1} title="下移阶段"><ChevronDown size={14} /></button>
                  <button className="danger" onClick={() => removeStep(step.id)} title="删除阶段"><Trash2 size={13} /></button>
                </div>
              </header>

              <div className="plan-source-row">
                <span>{step.origin === "engineer" ? "工程师修改" : "系统生成"}</span>
                <small>依据 · {step.source}</small>
              </div>

              <div className="plan-check-list">
                {step.checks.map((check, checkIndex) => (
                  <div className={classNames("plan-check-row", check.locked && "locked")} key={check.id}>
                    <i>{checkIndex + 1}</i>
                    <input
                      value={check.text}
                      aria-label={`${step.title}的小维修步骤 ${checkIndex + 1}`}
                      onChange={(event) => updateCheck(step.id, check.id, event.target.value)}
                      onBlur={() => markTextRevision(
                        `${step.id}:${check.id}`,
                        `工程师修改了“${step.title}”中的第 ${checkIndex + 1} 条小维修步骤。`,
                        systemCheckValue(step.id, check.id) !== check.text
                      )}
                    />
                    <span>{check.locked ? <><ShieldCheck size={11} /> 强制安全</> : check.origin === "engineer" ? "工程师修改" : "系统生成"}</span>
                    <div>
                      <button onClick={() => moveCheck(step.id, check.id, -1)} disabled={checkIndex === 0} title="上移小步骤"><ChevronUp size={12} /></button>
                      <button onClick={() => moveCheck(step.id, check.id, 1)} disabled={checkIndex === step.checks.length - 1} title="下移小步骤"><ChevronDown size={12} /></button>
                      <button className="danger" onClick={() => removeCheck(step.id, check.id)} disabled={check.locked} title={check.locked ? "强制安全项不可删除" : "删除小步骤"}><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
                <button className="plan-add-check" onClick={() => addCheck(step.id)}><Plus size={13} /> 添加小维修步骤</button>
              </div>
            </div>
          </article>
        ))}
        <button className="plan-add-step" onClick={addStep}><Plus size={15} /> 新增检修阶段</button>
      </section>

      <footer className="plan-stage-actions">
        <button className="ghost-button" onClick={onBack}><ChevronLeft size={15} /> 返回诊断结论</button>
        <button className="ghost-button" onClick={restoreSystemPlan}>恢复系统初稿</button>
        <div><span>当前方案</span><strong>{workingPlan.length} 个阶段 · {checkCount} 条小维修步骤 · 已修改 {revisionCount} 项</strong></div>
        <button className="primary-button" onClick={confirmPlan} disabled={!canConfirm}>确认方案并进入检修向导 <ChevronRight size={15} /></button>
      </footer>
    </div>
  );
}

function GuideStage({
  currentStep,
  activeStep,
  totalSteps,
  checkedItems,
  transitionRunning,
  onToggleCheck,
  onPrev,
  onNext,
  onRecord,
}) {
  const completedChecks = currentStep.checks.filter((check) => checkedItems.includes(check)).length;
  const allChecksDone = completedChecks === currentStep.checks.length;
  const checkProgress = Math.round((completedChecks / currentStep.checks.length) * 100);
  const isLastGuideStep = activeStep === totalSteps - 1;
  const visual = guideVisuals[currentStep.id];
  const [focusedCheck, setFocusedCheck] = useState(visual?.frames[0]?.check || currentStep.checks[0]);
  const [consultationOpen, setConsultationOpen] = useState(false);
  const [voiceBroadcastOpen, setVoiceBroadcastOpen] = useState(false);

  useEffect(() => {
    setFocusedCheck(guideVisuals[currentStep.id]?.frames[0]?.check || currentStep.checks[0]);
  }, [currentStep.id, currentStep.checks]);

  const activeFrame = visual?.frames.find((frame) => frame.check === focusedCheck);
  const visualImage = activeFrame?.image || visual?.defaultImage;
  const visualAlt = activeFrame?.label || visual?.defaultAlt;

  return (
    <div className="stage-content guide-stage">
      <div className="stage-copy">
        <p className="eyebrow">检修向导 · 第 {activeStep + 1} / {totalSteps} 步</p>
        <h2>{currentStep.title}</h2>
        <p>{currentStep.description}</p>
      </div>
      <div className="guide-progress">
        <div className="progress-head">
          <strong>本步确认进度</strong>
          <span>{completedChecks} / {currentStep.checks.length}</span>
        </div>
        <div className="progress-track">
          <div style={{ width: `${checkProgress}%` }} />
        </div>
      </div>
      <div className="guide-screen">
        {visual ? (
          <div className="guide-visual-card">
            <div className="guide-image-frame">
              <img className="guide-frame-image" key={visualImage} src={visualImage} alt={visualAlt} />
            </div>
            <div className="guide-visual-note">
              <div className="guide-note-head">
                <strong>{activeFrame?.label || "当前检查项"}</strong>
                <em>{activeFrame?.status || "文字确认"}</em>
              </div>
              <p>{activeFrame?.detail || "该检查项暂不切换图片，按右侧检查项完成确认即可。"}</p>
            </div>
          </div>
        ) : (
          <div className="image-placeholder">
            <Cpu size={34} />
            <strong>图片待补充</strong>
            <span>{currentStep.placeholder}</span>
          </div>
        )}
        <div className="guide-info">
          <div>
            <strong>检查项 · {completedChecks} / {currentStep.checks.length}</strong>
            <div className="check-step-list">
              {currentStep.checks.map((check, index) => (
                <button
                  key={check}
                  className={classNames(
                    "check-step-item",
                    checkedItems.includes(check) && "checked",
                    focusedCheck === check && "focused"
                  )}
                  onClick={() => {
                    setFocusedCheck(check);
                    onToggleCheck(check);
                  }}
                >
                  <span>{checkedItems.includes(check) ? <Check size={16} /> : index + 1}</span>
                  <p>{check}</p>
                </button>
              ))}
            </div>
          </div>
          {currentStep.thresholds.length > 0 && (
            <div className="threshold-box">
              <ShieldCheck size={18} />
              <p>{currentStep.thresholds.join(" · ")}</p>
            </div>
          )}
          <div className="safety-box">
            <ShieldCheck size={18} />
            <p>{currentStep.safety}</p>
          </div>
          <p className="source-line">来源依据：{currentStep.source}</p>
        </div>
      </div>
      <div className="stage-actions">
        <button className="ghost-button" onClick={onPrev} disabled={transitionRunning}><ChevronLeft size={16} /> 上一步</button>
        <button className="primary-button" onClick={onNext} disabled={!allChecksDone || transitionRunning}>
          {transitionRunning ? <Loader2 size={16} className="spin" /> : null}
          {transitionRunning ? "Agent 正在生成下一步" : "完成并继续"} <ChevronRight size={16} />
        </button>
        <button className="ghost-button" onClick={() => setConsultationOpen(true)} title="发起专家视频会诊">
          <Video size={16} />
          专家视频会诊
        </button>
        <button
          className="ghost-button"
          onClick={() => setVoiceBroadcastOpen((current) => !current)}
          title={voiceBroadcastOpen ? "取消语音播报演示" : "播放语音播报演示"}
        >
          <Volume2 size={16} />
          语音播报
        </button>
        <button className="ghost-button" onClick={onRecord} disabled={transitionRunning || !isLastGuideStep}>生成检修记录</button>
      </div>
      {consultationOpen && (
        <ExpertVideoConsultation
          currentStep={currentStep}
          activeStep={activeStep}
          totalSteps={totalSteps}
          onClose={() => setConsultationOpen(false)}
        />
      )}
      {voiceBroadcastOpen && (
        <VoiceBroadcastCapsule
          currentStepTitle={currentStep.title}
          onClose={() => setVoiceBroadcastOpen(false)}
        />
      )}
    </div>
  );
}

function MaintenanceRecordPage({
  record,
  scenario,
  diagnosis,
  incidentTime,
  input,
  materials,
  currentUser,
  feedbackState,
  uploadStatus,
  uploadError,
  onUpload,
  onPreviewMaterial,
  onBackGuide,
  onBackList,
}) {
  const [form, setForm] = useState(feedbackState?.engineerResult || maintenanceResultTemplate);

  useEffect(() => {
    if (feedbackState?.engineerResult) setForm(feedbackState.engineerResult);
  }, [feedbackState?.engineerResult]);

  if (!record) {
    return (
      <div className="maintenance-record-empty">
        <ClipboardList size={30} />
        <h2>检修记录尚未生成</h2>
        <button className="ghost-button" onClick={onBackGuide}>返回检修向导</button>
      </div>
    );
  }

  const caseStatus = feedbackState?.caseStatus || "awaiting_engineer_confirmation";
  const submitted = caseStatus !== "awaiting_engineer_confirmation";
  const uploading = uploadStatus === "uploading";
  const locked = submitted || uploading;
  const statusLabel = caseStatus === "archived_with_knowledge"
    ? "已审核并发布知识"
    : submitted
      ? "待专家审核"
      : "尚未上传";
  const completedSteps = record.completed_steps?.length
    ? record.completed_steps
    : [
        { id: "fallback-1", title: "断电、挂牌和防静电确认", completed: true },
        { id: "fallback-2", title: "清理滤网与风道", completed: true },
        { id: "fallback-3", title: "检查 FAN1/FAN2 接线", completed: true },
        { id: "fallback-4", title: "检查并更换老化风扇", completed: true },
        { id: "fallback-5", title: "恢复上电并观察 15 分钟", completed: true },
      ];
  const persistedMaterials = feedbackState?.feedbackPackage?.materials || [];
  const displayMaterials = materials?.length ? materials : persistedMaterials;
  const ready = ["finalCause", "actualResolution", "recoveryResult", "fanSpeedRpm", "systemTemperatureC", "cpuTemperatureC", "observationMinutes"]
    .every((key) => form[key] !== "" && form[key] != null);
  const occurredAt = incidentTime?.detectedAt
    ? new Date(incidentTime.detectedAt).toLocaleString("zh-CN", { hour12: false })
    : "2026-07-10 10:25";

  async function submitRecord() {
    if (!ready || locked) return;
    const feedbackPackage = {
      caseId: PRESENTATION_CASE_ID,
      recordId: record.record_id,
      engineerId: "lishifu",
      incident: {
        time: occurredAt,
        duration: incidentTime?.duration || "约 10 分钟",
        site: scenario?.site || "山东德州分输站",
        location: scenario?.cabinet || "站控柜 A01",
        equipment: record.equipment,
        fault: record.fault,
        description: input || scenario?.default_input || defaultInput,
      },
      diagnosis: {
        conclusion: diagnosis?.summary || "风道受阻、滤网积尘或风扇低速共同导致散热能力下降。",
        evidence: ["TEMP/FAN 告警", "风扇转速 420 rpm", "系统温度 58°C", "CPU 温度 74°C"],
      },
      maintenanceResult: form,
      completedSteps: completedSteps.map((step) => ({
        id: step.id,
        title: step.title,
        completed: step.completed !== false,
        safety: step.safety || "",
      })),
      recoveryMetrics: {
        before: { fanSpeedRpm: 420, systemTemperatureC: 58, cpuTemperatureC: 74, alarm: "TEMP/FAN 告警" },
        after: { fanSpeedRpm: form.fanSpeedRpm, systemTemperatureC: form.systemTemperatureC, cpuTemperatureC: form.cpuTemperatureC, alarm: form.recoveryResult },
        observationMinutes: form.observationMinutes,
      },
      materials: (materials || []).map(({ id, type, name, size }) => ({ id, type, name, size, persistence: "session_metadata" })),
      targetKnowledgeIds: ["KB-008"],
    };
    try {
      await onUpload(feedbackPackage);
    } catch {
      // 上传错误由页面级状态展示，保留当前表单供工程师重试。
    }
  }

  function printJobCard() {
    const previousTitle = document.title;
    const printDate = new Date(incidentTime?.detectedAt || occurredAt);
    const datePart = Number.isNaN(printDate.getTime())
      ? "未记录日期"
      : `${printDate.getFullYear()}${String(printDate.getMonth() + 1).padStart(2, "0")}${String(printDate.getDate()).padStart(2, "0")}`;
    const cleanup = () => {
      document.body.classList.remove("is-printing-job-card");
      document.title = previousTitle;
    };

    document.body.classList.add("is-printing-job-card");
    document.title = `工控机故障检修作业卡_${record.record_id}_${datePart}`;
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
  }

  return (
    <div className="maintenance-record-page">
      {onBackList && (
        <button className="maintenance-record-back" type="button" onClick={onBackList}>
          <ChevronLeft size={16} />
          返回检修记录
        </button>
      )}
      <header className="maintenance-record-hero">
        <div className="maintenance-record-title">
          <span><Check size={14} /> 检修闭环已完成</span>
          <h2>{record.record_id}</h2>
          <p>{record.conclusion}</p>
        </div>
        <div className={classNames("maintenance-record-status", submitted && "submitted", caseStatus === "archived_with_knowledge" && "published")}>
          <small>案例回流状态</small>
          <strong>{statusLabel}</strong>
          <em>{submitted ? `案例 ${PRESENTATION_CASE_ID}` : "确认后上传给专家"}</em>
        </div>
      </header>

      <section className="maintenance-record-meta">
        <article><MapPin size={16} /><div><span>设备与位置</span><strong>{record.equipment}</strong><small>{scenario?.site || "山东德州分输站"} · {scenario?.cabinet || "站控柜 A01"}</small></div></article>
        <article><AlertTriangle size={16} /><div><span>故障与告警</span><strong>{record.fault}</strong><small>TEMP/FAN · 风扇低速</small></div></article>
        <article><ClipboardList size={16} /><div><span>执行结果</span><strong>{completedSteps.length} 项全部完成</strong><small>安全项已确认 · 恢复验证通过</small></div></article>
        <article><CalendarClock size={16} /><div><span>记录信息</span><strong>{occurredAt}</strong><small>{currentUser?.name || "李师傅"} · 现场检修</small></div></article>
      </section>

      <div className="maintenance-record-body">
        <div className="maintenance-record-primary">
          <section className="record-report-section incident-chain">
            <header><div><span>01 / 事实与判断</span><h3>现场事实如何形成诊断</h3></div><ShieldCheck size={18} /></header>
            <div className="incident-chain-grid">
              <article><small>发生时间</small><strong>{occurredAt}</strong><p>{incidentTime?.duration || "约 10 分钟"} · {incidentTime?.recurrence || "首次发现"}</p></article>
              <article><small>发生地点</small><strong>{scenario?.site || "山东德州分输站"}</strong><p>{scenario?.cabinet || "站控柜 A01"}</p></article>
              <article className="wide"><small>现场现象</small><strong>{input || scenario?.default_input || defaultInput}</strong><p>来源：工程师描述 + 现场告警参数</p></article>
            </div>
            <div className="diagnosis-reason-line"><i>Agent 诊断</i><strong>{diagnosis?.summary || "风道受阻、滤网积尘或风扇低速共同导致散热能力下降。"}</strong><span>TEMP/FAN 告警 · 420 rpm · 系统 58℃ · CPU 74℃</span></div>
          </section>

          <section className="record-report-section maintenance-result-section">
            <header><div><span>02 / 工程师确认</span><h3>实际检修结果</h3></div>{!locked && <button onClick={() => setForm(maintenanceResultTemplate)}><Sparkles size={14} />一键采用现场结果</button>}</header>
            <div className="maintenance-result-fields">
              <label>最终故障原因<textarea readOnly={locked} value={form.finalCause} onChange={(event) => setForm({ ...form, finalCause: event.target.value })} /></label>
              <label>实际处理<textarea readOnly={locked} value={form.actualResolution} onChange={(event) => setForm({ ...form, actualResolution: event.target.value })} /></label>
              <label className="wide">恢复结果<input readOnly={locked} value={form.recoveryResult} onChange={(event) => setForm({ ...form, recoveryResult: event.target.value })} /></label>
              <label className="wide">遗留风险<input readOnly={locked} value={form.residualRisk} onChange={(event) => setForm({ ...form, residualRisk: event.target.value })} /></label>
            </div>
          </section>

          <section className="record-report-section recovery-comparison-section">
            <header><div><span>03 / 恢复验证</span><h3>处理前后参数对比</h3></div><Check size={18} /></header>
            <div className="recovery-comparison-table">
              <div className="table-head"><span>验证项</span><span>处理前</span><span>处理后</span><span>结论</span></div>
              <div><strong>风扇转速</strong><span>420 rpm</span><label><input readOnly={locked} type="number" value={form.fanSpeedRpm} onChange={(event) => setForm({ ...form, fanSpeedRpm: Number(event.target.value) })} /> rpm</label><em>恢复</em></div>
              <div><strong>系统温度</strong><span>58℃</span><label><input readOnly={locked} type="number" value={form.systemTemperatureC} onChange={(event) => setForm({ ...form, systemTemperatureC: Number(event.target.value) })} /> ℃</label><em>下降</em></div>
              <div><strong>CPU 温度</strong><span>74℃</span><label><input readOnly={locked} type="number" value={form.cpuTemperatureC} onChange={(event) => setForm({ ...form, cpuTemperatureC: Number(event.target.value) })} /> ℃</label><em>下降</em></div>
              <div><strong>TEMP/FAN</strong><span>告警</span><span>已解除</span><em>通过</em></div>
              <div><strong>连续观察</strong><span>—</span><label><input readOnly={locked} type="number" value={form.observationMinutes} onChange={(event) => setForm({ ...form, observationMinutes: Number(event.target.value) })} /> 分钟</label><em>稳定</em></div>
            </div>
          </section>
        </div>

        <aside className="maintenance-record-secondary">
          <section className="record-report-section completed-step-section">
            <header><div><span>执行轨迹</span><h3>已完成检修步骤</h3></div><strong>{completedSteps.length}/{completedSteps.length}</strong></header>
            <ol>{completedSteps.map((step, index) => <li key={step.id || index}><i><Check size={12} /></i><div><strong>{step.title || `检修步骤 ${index + 1}`}</strong><small>{step.safety || (index === 1 ? "强制安全项已锁定" : "现场确认完成")}</small></div></li>)}</ol>
          </section>

          <section className="record-report-section record-material-section">
            <header><div><span>现场证据</span><h3>图片、视频与音频</h3></div><strong>{displayMaterials.length} 项</strong></header>
            {displayMaterials.length ? <div className="record-material-grid">{displayMaterials.map((material) => (
              <button key={material.id} disabled={!material.url} onClick={() => material.url && onPreviewMaterial(material.id)}>
                {material.type === "image" && material.url ? <img src={material.url} alt={material.name} /> : material.type === "video" ? <Video size={20} /> : material.type === "audio" ? <Music2 size={20} /> : <Paperclip size={20} />}
                <span>{material.name}</span><small>{material.persistence === "session_metadata" ? "已保存元数据" : "本地会话材料"}</small>
              </button>
            ))}</div> : <div className="record-material-empty"><Paperclip size={22} /><strong>本次未附加现场材料</strong><p>案例仍可上传；专家将依据现场事实、步骤和恢复参数审核。</p></div>}
          </section>

          <section className="record-report-section traceability-section">
            <header><div><span>来源追溯</span><h3>案例与知识目标</h3></div><GitBranch size={18} /></header>
            <dl><div><dt>来源记录</dt><dd>{record.record_id}</dd></div><div><dt>目标案例</dt><dd>{PRESENTATION_CASE_ID}</dd></div><div><dt>目标知识</dt><dd>KB-008 · 风扇检查与更换</dd></div><div><dt>检修人员</dt><dd>{currentUser?.name || "李师傅"}</dd></div></dl>
          </section>
        </aside>
      </div>

      <footer className={classNames("maintenance-record-actions", submitted && "submitted")}>
        <div className="record-feedback-message">
          {submitted ? <Check size={20} /> : <Send size={20} />}
          <div><span>{submitted ? "上传成功" : "案例回流"}</span><strong>{submitted ? `案例 ${PRESENTATION_CASE_ID} 已进入专家待审核库` : "确认本次结果并上传给专家审核"}</strong><p>{submitted ? "工程师侧流程已完成。专家将在独立账号中修订案例、知识和图谱。" : "上传只生成待审核案例，不会直接修改正式知识库。"}</p></div>
        </div>
        {uploadError && <p className="record-upload-error"><AlertTriangle size={14} />{uploadError}</p>}
        <div className="record-action-buttons"><button className="ghost-button" onClick={printJobCard}>打印作业卡</button><button className="primary-button" disabled={!ready || locked} onClick={submitRecord}>{uploading ? <Loader2 className="spin" size={16} /> : submitted ? <Check size={16} /> : <FileText size={16} />}{uploading ? "正在上传…" : submitted ? "已上传至专家知识库" : "上传至专家知识库"}</button></div>
      </footer>
      <MaintenanceJobCardPrint
        record={record}
        scenario={scenario}
        incidentTime={incidentTime}
        input={input}
        currentUser={currentUser}
        result={form}
        completedSteps={completedSteps}
        materials={displayMaterials}
        caseStatus={caseStatus}
        occurredAt={occurredAt}
      />
    </div>
  );
}

function ExpertStage({ expertReview, onRestart }) {
  return (
    <div className="stage-content expert-stage">
      <div className="stage-copy">
        <p className="eyebrow">专家审核回流</p>
        <h2>{expertReview?.tag || "专家修正 · 已审核"}</h2>
        <p>{expertReview?.content}</p>
      </div>
      <div className="expert-note">
        <Wrench size={20} />
        <span>修正内容已写入知识库、图谱关系和专家经验记录。再次触发同类异常时会显示该专家修正。</span>
      </div>
      <div className="stage-actions">
        <button className="primary-button" onClick={onRestart}>再次查看诊断结论</button>
      </div>
    </div>
  );
}

function isAnalysisStepActive(stage, index, activeAgentIndex, analysisSubStep) {
  if (stage === "analysis") {
    if (index === 0) return activeAgentIndex < 0;
    if (index === 1) return activeAgentIndex >= 0;
    return false;
  }
  if (stage === "diagnosis") return index === analysisSubStep;
  return false;
}

function isAnalysisStepDone(stage, activePhase, index, activeAgentIndex, analysisSubStep) {
  if (activePhase > 1) return true;
  if (stage === "analysis") {
    if (index === 0) return activeAgentIndex >= 0;
    return false;
  }
  if (stage === "diagnosis") return index < analysisSubStep;
  return false;
}

function getAnalysisStepStatus(stage, activePhase, index, activeAgentIndex, analysisSubStep) {
  if (isAnalysisStepDone(stage, activePhase, index, activeAgentIndex, analysisSubStep)) return "已完成";
  if (isAnalysisStepActive(stage, index, activeAgentIndex, analysisSubStep)) {
    return stage === "analysis" && index === 1 ? "运行中" : "当前";
  }
  return "待处理";
}

function getIntakeStepStatus(activePhase, stage, index, activeIntakeStep) {
  if (activePhase > 0) return "已完成";
  if (stage === "input" && index === activeIntakeStep) return "当前";
  if (stage === "input" && index < activeIntakeStep) return "已完成";
  return "待处理";
}

function getVisiblePhaseLimit(stage) {
  if (stage === "input") return 0;
  if (stage === "analysis") return 1;
  if (stage === "diagnosis" || stage === "plan" || stage === "guide") return 2;
  return 3;
}

function getVisibleIntakeItems(activePhase, stage, activeIntakeStep) {
  if (activePhase > 0) return phaseSteps[0].items;
  if (stage !== "input") return phaseSteps[0].items.slice(0, 1);
  return phaseSteps[0].items.slice(0, activeIntakeStep + 1);
}

function getVisibleDiagnosisTasks(stage, activePhase, activeAgentIndex, analysisSubStep) {
  if (activePhase > 1 || stage === "guide" || stage === "record" || stage === "expert") {
    return diagnosisTasks;
  }
  if (stage === "diagnosis") {
    return diagnosisTasks.slice(0, analysisSubStep + 1);
  }
  if (stage === "analysis") {
    return diagnosisTasks.slice(0, activeAgentIndex >= 0 ? 2 : 1);
  }
  return diagnosisTasks.slice(0, 1);
}

function getVisibleGuideSteps(stage, steps, activeStep) {
  if (stage === "record" || stage === "expert") return steps;
  if (stage === "plan") return [{ id: "plan-confirm", title: "确认检修预方案", planNode: true, completed: false }];
  if (stage !== "guide") return [];
  return steps.slice(0, activeStep + 1);
}

function FlowPanel({
  activePhase,
  steps,
  activeStep,
  activeIntakeStep,
  stage,
  analysisSubStep,
  activeAgentIndex,
  activeTransition,
  onSelectPhase,
  onSelectIntake,
  onSelectAnalysis,
  onSelectStep,
}) {
  const [collapsed, setCollapsed] = useState(true);
  const visiblePhaseLimit = getVisiblePhaseLimit(stage);
  const visiblePhaseSteps = phaseSteps.slice(0, visiblePhaseLimit + 1);
  const transitionRunning = activeTransition?.status === "running";
  const visibleIntakeItems = getVisibleIntakeItems(activePhase, stage, activeIntakeStep);
  const visibleDiagnosisTasks = getVisibleDiagnosisTasks(stage, activePhase, activeAgentIndex, analysisSubStep);
  const visibleGuideSteps = getVisibleGuideSteps(stage, steps, activeStep);
  const generatedStepCount =
    visibleIntakeItems.length +
    (visiblePhaseLimit >= 1 ? visibleDiagnosisTasks.length : 0) +
    (visiblePhaseLimit >= 2 ? visibleGuideSteps.length : 0) +
    (visiblePhaseLimit >= 3 ? 1 : 0);

  return (
    <aside className={classNames("flow-panel", collapsed && "collapsed")}>
      <section className="flow-box">
        <div className="section-heading compact">
          {!collapsed && <h2>诊断流程</h2>}
          {!collapsed && <span>已生成 {generatedStepCount} 步</span>}
          <button
            type="button"
            className="flow-collapse-toggle"
            aria-label={collapsed ? "展开诊断流程" : "收起诊断流程"}
            title={collapsed ? "展开诊断流程" : "收起诊断流程"}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        <div className="phase-list">
          {visiblePhaseSteps.map((phase, phaseIndex) => (
            <div className={classNames("phase-item", phaseIndex === activePhase && "active", phaseIndex < activePhase && "done")} key={phase.title}>
              <button className="phase-title" onClick={() => !transitionRunning && onSelectPhase(phaseIndex)}>
                <span>{phaseIndex < activePhase ? <Check size={14} /> : phaseIndex + 1}</span>
                <strong>{phase.title}</strong>
              </button>
              <div className="sub-step-list">
                {phaseIndex === 0 ? (
                  visibleIntakeItems.map((item, index) => (
                    <button
                      className={classNames(
                        "sub-step",
                        stage === "input" && index === activeIntakeStep && "active",
                        getIntakeStepStatus(activePhase, stage, index, activeIntakeStep) === "已完成" && "done"
                      )}
                      key={`${item}-${index}`}
                      onClick={() => !transitionRunning && onSelectIntake(index)}
                    >
                      {getIntakeStepStatus(activePhase, stage, index, activeIntakeStep)} · {item}
                    </button>
                  ))
                ) : phaseIndex === 1 ? (
                  visibleDiagnosisTasks.map((task, index) => (
                    <button
                      key={task.title}
                      className={classNames(
                        "sub-step",
                        isAnalysisStepActive(stage, index, activeAgentIndex, analysisSubStep) && "active",
                        isAnalysisStepDone(stage, activePhase, index, activeAgentIndex, analysisSubStep) && "done"
                      )}
                      onClick={() => !transitionRunning && onSelectAnalysis(index)}
                    >
                      {getAnalysisStepStatus(stage, activePhase, index, activeAgentIndex, analysisSubStep)} · {task.title}
                    </button>
                  ))
                ) : phaseIndex === 2 && visibleGuideSteps.length > 0 ? (
                  visibleGuideSteps.map((step, index) => step.planNode ? (
                    <span className="sub-step active" key={step.id}>
                      当前 · {step.title}
                    </span>
                  ) : (
                    <button
                      key={step.id}
                      className={classNames("sub-step", stage === "guide" && index === activeStep && "active", step.completed && "done")}
                      onClick={() => !transitionRunning && onSelectStep(index)}
                    >
                      {step.completed ? "已完成" : stage === "guide" && index === activeStep ? "当前" : `步骤 ${index + 1}`} · {step.title}
                    </button>
                  ))
                ) : (
                  (phaseIndex === 3 ? phase.items.slice(0, 1) : phase.items).map((item, index) => (
                    <span className={classNames("sub-step", phaseIndex < activePhase && "done")} key={`${item}-${index}`}>
                      {phaseIndex < activePhase ? "已完成" : "待处理"} · {item}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

function KnowledgeGraphPage({ graph, evidence }) {
  const [selectedNode, setSelectedNode] = useState("工控机");
  const graphNodes = [
    { name: "输气场站", type: "场景", detail: "油气管道场站业务环境，包含站控柜与现场运维对象。", position: [12, 46] },
    { name: "站控柜", type: "设备容器", detail: "站控柜 A01，承载工控机及相关监控设备。", position: [28, 28] },
    { name: "工控机", type: "核心设备", detail: "研华 ACP-4000 / IPC-610 工控机，本次散热异常诊断对象。", position: [45, 46] },
    { name: "高温告警", type: "故障现象", detail: "由 TEMP/FAN、系统温度、CPU 温度等信号共同触发的异常现象。", position: [62, 24] },
    { name: "风道堵塞", type: "可能原因", detail: "进出风道被遮挡或积尘导致散热效率下降。", position: [76, 43] },
    { name: "滤网积尘", type: "可能原因", detail: "门滤网或风扇滤网积尘，导致进风阻力增大。", position: [64, 68] },
    { name: "风扇异常", type: "可能原因", detail: "风扇低速、停转、异响或 FAN1/FAN2 接线异常。", position: [40, 72] },
    { name: "恢复验证", type: "检修闭环", detail: "完成清理和恢复后，连续观察告警、温度、风扇转速和数据上传。", position: [84, 68] },
  ];
  const activeNode = graphNodes.find((node) => node.name === selectedNode) || graphNodes[2];
  const relatedEdges = graph.filter((edge) => edge.source === selectedNode || edge.target === selectedNode);
  const relatedKeywords = new Set([selectedNode, ...relatedEdges.flatMap((edge) => [edge.source, edge.target])]);
  const relatedEvidence = evidence.filter((item) => {
    const text = `${item.title} ${item.step}`;
    return Array.from(relatedKeywords).some((keyword) => text.includes(keyword) || keyword.includes("工控机"));
  });
  const visibleEvidence = relatedEvidence.length > 0 ? relatedEvidence : evidence.slice(0, 4);

  return (
    <section className="graph-page">
      <div className="graph-canvas panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">知识图谱</p>
            <h2>工控机散热异常子图</h2>
          </div>
          <span className="health-pill ok">{graph.length} 条关系</span>
        </div>
        <div className="node-map">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points="12,46 28,28 45,46 62,24 76,43" />
            <polyline points="45,46 64,68 84,68" />
            <polyline points="45,46 40,72" />
          </svg>
          {graphNodes.map((node) => (
            <button
              key={node.name}
              className={classNames(
                "graph-node",
                node.type === "故障现象" && "danger-node",
                selectedNode === node.name && "active"
              )}
              style={{ left: `${node.position[0]}%`, top: `${node.position[1]}%` }}
              onClick={() => setSelectedNode(node.name)}
            >
              <span>{node.type}</span>
              {node.name}
            </button>
          ))}
        </div>
        <div className="graph-legend">
          <span>场景</span>
          <span>设备</span>
          <span>故障</span>
          <span>原因</span>
          <span>验证</span>
        </div>
      </div>
      <aside className="panel graph-side">
        <div className="node-detail-card">
          <p className="eyebrow">当前节点</p>
          <h2>{activeNode.name}</h2>
          <span>{activeNode.type}</span>
          <p>{activeNode.detail}</p>
        </div>
        <div className="relation-list">
          <div className="section-heading compact">
            <h3>关联关系</h3>
            <span>{relatedEdges.length} 条</span>
          </div>
          {(relatedEdges.length > 0 ? relatedEdges : graph.slice(0, 6)).map((edge, index) => (
            <div className="relation-row" key={`${edge.source}-${edge.target}-${index}`}>
              <strong>{edge.source}</strong>
              <span>{edge.relation}</span>
              <strong>{edge.target}</strong>
            </div>
          ))}
        </div>
        <div className="evidence-mini">
          <div className="section-heading compact">
            <h3>知识条目</h3>
            <span>{visibleEvidence.length} 条</span>
          </div>
          {visibleEvidence.map((item) => (
            <article key={item.id}>
              <span>{item.id}</span>
              <strong>{item.title}</strong>
              <p>{item.step}</p>
            </article>
          ))}
        </div>
      </aside>
    </section>
  );
}

function RecordPage({ record, onBuildRecord, onOpenCurrent }) {
  const generatedRecord = record && {
    id: record.record_id,
    title: "站控柜 A01 工控机散热异常检修",
    equipment: record.equipment,
    fault: record.fault,
    status: record.expert_status,
    time: "今天 10:42",
    maintainer: "李师傅",
    duration: "42 分钟",
    conclusion: record.conclusion,
    isCurrent: true,
    tags: ["本次流程", "待归档"],
    checks: [
      `已完成 ${record.completed_steps.length || 0} 项检修步骤`,
      record.safety_confirmed ? "安全条件已确认" : "安全确认待补充",
      "支持打印作业卡和提交专家审核",
    ],
  };
  const records = [
    generatedRecord,
    {
      id: "REC-ACP4000-HIS-001",
      title: "站控柜 A01 工控机散热异常检修",
      equipment: "研华 ACP-4000 / IPC-610",
      fault: "TEMP/FAN 告警、风扇转速偏低",
      status: "已审核",
      time: "2026-07-04 09:36",
      maintainer: "李师傅",
      duration: "38 分钟",
      conclusion: "清理滤网和前面板风道后，风扇转速恢复，系统温度下降，告警解除。",
      tags: ["散热异常", "已回流知识库"],
      checks: ["完成断电挂牌与防静电确认", "完成滤网清理和风道检查", "恢复上电后连续观察 15 分钟"],
    },
    {
      id: "REC-IPC610-20260703",
      title: "站控工控机风扇异响排查",
      equipment: "IPC-610 工控机",
      fault: "风扇异响、局部温度升高",
      status: "已归档",
      time: "2026-07-03 16:18",
      maintainer: "王工",
      duration: "25 分钟",
      conclusion: "确认风扇积尘并完成清理，未发现接线松动。",
      tags: ["风扇检查", "低风险"],
      checks: ["检查 FAN1/FAN2 接线", "清理风扇叶片积尘", "记录恢复后转速"],
    },
    {
      id: "REC-STATION-A01-0702",
      title: "站控柜通风状态巡检",
      equipment: "站控柜 A01",
      fault: "例行巡检",
      status: "已归档",
      time: "2026-07-02 11:20",
      maintainer: "赵师傅",
      duration: "18 分钟",
      conclusion: "柜体通风良好，未发现进出风口遮挡。",
      tags: ["巡检", "无异常"],
      checks: ["确认柜门滤网状态", "检查柜内线缆遮挡", "记录环境温湿度"],
    },
    {
      id: "REC-6177R-20260701",
      title: "机架式工控机启动失败排查",
      equipment: "Rockwell 6177R 1450R",
      fault: "POST 中止、操作系统无法启动",
      status: "已审核",
      time: "2026-07-01 08:45",
      maintainer: "周工",
      duration: "53 分钟",
      conclusion: "断开外设后 POST 恢复正常，逐一接回确认 USB 数据采集器异常，更换外设并复测后系统正常启动。",
      tags: ["启动异常", "外设隔离"],
      checks: ["记录 POST 报错现象", "断电后隔离全部外设", "逐一接回并验证业务程序启动"],
    },
    {
      id: "REC-6300B-20260630",
      title: "控制柜工控机硬盘健康告警检修",
      equipment: "ASEM 6300B-EW1",
      fault: "SSD 健康告警、系统启动变慢",
      status: "已归档",
      time: "2026-06-30 14:12",
      maintainer: "陈工",
      duration: "68 分钟",
      conclusion: "诊断确认系统盘健康度下降，完成数据备份和同规格 SSD 更换，通过受控镜像恢复系统与业务应用。",
      tags: ["存储故障", "镜像恢复"],
      checks: ["导出存储健康与事件日志", "核对备份范围和目标磁盘", "验证驱动、应用与业务数据"],
    },
    {
      id: "REC-P6-20260629",
      title: "操作站显示黑屏故障处理",
      equipment: "Schneider Harmony P6 Basic",
      fault: "上电后黑屏、外接显示器画面正常",
      status: "已审核",
      time: "2026-06-29 10:28",
      maintainer: "孙工",
      duration: "36 分钟",
      conclusion: "检查确认内置显示线缆接触不良，重新固定线缆并恢复推荐分辨率后，画面持续稳定。",
      tags: ["显示异常", "线缆检查"],
      checks: ["确认主机与面板供电", "检查显示线缆和接口固定", "验证分辨率、刷新率与画面稳定性"],
    },
    {
      id: "REC-RACKIPC-20260628",
      title: "冗余电源切换异常检修",
      equipment: "Schneider Harmony Rack iPC Universal",
      fault: "冗余电源告警、单路掉电后设备重启",
      status: "待审核",
      time: "2026-06-28 15:40",
      maintainer: "王工",
      duration: "47 分钟",
      conclusion: "发现第二路电源输入端子松动，重新紧固并完成双路独立切换测试，设备运行未再中断。",
      tags: ["供电异常", "待专家复核"],
      checks: ["核对双路输入电压与接地", "检查电源模块指示状态", "分别模拟单路掉电并观察运行状态"],
    },
    {
      id: "REC-SBOX-20260627",
      title: "箱式工控机通信中断排查",
      equipment: "Magelis S-Box iPC Universal",
      fault: "双网口链路间歇中断、数据不上送",
      status: "已归档",
      time: "2026-06-27 09:55",
      maintainer: "赵师傅",
      duration: "41 分钟",
      conclusion: "确认网线水晶头压接不良且端口存在机械应力，更换屏蔽网线并恢复线缆固定后通信稳定。",
      tags: ["通信异常", "接口与线缆"],
      checks: ["检查链路灯与端口事件日志", "替换网线并解除接口应力", "连续验证数据上送 30 分钟"],
    },
    {
      id: "REC-VV5400-20260626",
      title: "薄客户端日期时间复位检修",
      equipment: "Rockwell VersaView 5400",
      fault: "断电后日期时间复位、启动配置丢失",
      status: "已审核",
      time: "2026-06-26 13:26",
      maintainer: "刘工",
      duration: "32 分钟",
      conclusion: "按型号要求更换 RTC 电池，重新设置日期、时间和启动参数，断电保持测试通过。",
      tags: ["RTC 电池", "配置恢复"],
      checks: ["备份原 BIOS 配置", "核对电池型号、极性和连接", "执行断电后的时间与配置保持测试"],
    },
    {
      id: "REC-RACKIPC-20260625",
      title: "机架式工控机监控告警恢复",
      equipment: "Schneider Harmony Rack iPC Performance",
      fault: "监控代理离线、远程告警持续上报",
      status: "已归档",
      time: "2026-06-25 17:08",
      maintainer: "周工",
      duration: "29 分钟",
      conclusion: "监控代理服务异常退出，恢复服务并修正不适用的温度阈值后，远程状态和事件上报恢复正常。",
      tags: ["监控告警", "阈值校验"],
      checks: ["导出告警与系统事件日志", "核对代理服务和网络连接", "验证远程状态、阈值与告警恢复"],
    },
  ].filter(Boolean);
  const [searchFault, setSearchFault] = useState("");
  const [detailRecordId, setDetailRecordId] = useState(null);
  const normalizedSearch = searchFault.trim().toLowerCase();
  const filteredRecords = records.filter((item) =>
    [item.id, item.title, item.equipment, item.fault, item.conclusion, ...item.tags]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch),
  );
  const selectedRecord = records.find((item) => item.id === detailRecordId);

  if (selectedRecord) {
    return (
      <section className="records-page">
        <div className="records-panel detail-mode">
          <div className="record-detail-topbar">
            <button className="ghost-button" onClick={() => setDetailRecordId(null)}>
              <ChevronLeft size={16} />
              返回记录列表
            </button>
            <div className="records-actions">
              <button className="ghost-button" onClick={() => window.print()}>
                <Download size={16} />
                导出
              </button>
            </div>
          </div>

          <article className="record-detail full-page">
            <div className="record-detail-head">
              <div>
                <span className={classNames("record-status", selectedRecord.status === "待审核" && "pending")}>
                  {selectedRecord.status}
                </span>
                <h3>{selectedRecord.title}</h3>
                <p>{selectedRecord.id}</p>
              </div>
              <ClipboardList size={30} />
            </div>

            <div className="record-meta-grid">
              <section>
                <span>设备</span>
                <strong>{selectedRecord.equipment}</strong>
              </section>
              <section>
                <span>故障</span>
                <strong>{selectedRecord.fault}</strong>
              </section>
              <section>
                <span>处理人</span>
                <strong>{selectedRecord.maintainer}</strong>
              </section>
              <section>
                <span>耗时</span>
                <strong>{selectedRecord.duration}</strong>
              </section>
            </div>

            <section className="record-conclusion">
              <div className="section-heading compact">
                <h3>本次维修主要内容</h3>
                <span><CalendarClock size={14} /> {selectedRecord.time}</span>
              </div>
              <p>{selectedRecord.conclusion}</p>
            </section>

            <section className="record-checks">
              <h3>关键确认项</h3>
              {selectedRecord.checks.map((check) => (
                <p key={check}><Check size={15} /> {check}</p>
              ))}
            </section>

            <div className="record-tags">
              {selectedRecord.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          </article>
        </div>
      </section>
    );
  }

  return (
    <section className="records-page">
      <div className="records-panel">
        <div className="records-head">
          <div>
            <p className="eyebrow">检修记录</p>
            <h2>记录台账</h2>
            <p>查看检修闭环、审核状态和关键处理结论。</p>
          </div>
          <div className="records-actions">
            <button className="ghost-button" onClick={() => window.print()}>
              <Download size={16} />
              导出
            </button>
            <button className="primary-button" onClick={onBuildRecord}>
              <FileText size={16} />
              生成演示记录
            </button>
          </div>
        </div>

        <div className="record-filter-row">
          <label>
            <Search size={15} />
            <input
              value={searchFault}
              onChange={(event) => setSearchFault(event.target.value)}
              placeholder="搜索型号或故障，例如：6177R、供电、风扇..."
            />
          </label>
          <span>共 {filteredRecords.length} 条</span>
        </div>

        <div className="record-list-full" aria-label="检修记录列表">
          {filteredRecords.length > 0 ? (
            filteredRecords.map((item) => (
              <button
                key={item.id}
                className="record-row-item"
                onClick={() => item.isCurrent ? onOpenCurrent() : setDetailRecordId(item.id)}
              >
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.time}</span>
                </div>
                <p>{item.fault}</p>
                <span>{item.equipment}</span>
                <span>{item.maintainer}</span>
                <span className={classNames("record-status", item.status === "待审核" && "pending")}>{item.status}</span>
                <ChevronRight size={18} />
              </button>
            ))
          ) : (
            <div className="record-empty">未找到相关故障记录。</div>
          )}
        </div>
      </div>
    </section>
  );
}

function SettingsPage({ currentUser, onSave }) {
  const [form, setForm] = useState({
    name: currentUser.name,
    site: currentUser.site,
    team: currentUser.team,
    role: currentUser.role,
    deviceScope: "站控柜 A01 · 工控机",
    notification: "仅高优先级告警",
    voiceMode: "仅检修步骤播报",
    exportFormat: "PDF 作业卡",
    expertMode: "异常结论后可提交专家审核",
    autoSaveRecord: true,
    showSafetyConfirm: true,
  });
  const [saved, setSaved] = useState(false);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  function saveSettings(event) {
    event.preventDefault();
    onSave({
      ...currentUser,
      name: form.name.trim() || currentUser.name,
      site: form.site.trim() || currentUser.site,
      team: form.team.trim() || currentUser.team,
      role: form.role,
    });
    setSaved(true);
  }

  return (
    <section className="settings-page">
      <form className="settings-panel" onSubmit={saveSettings}>
        <div className="settings-head">
          <div>
            <p className="eyebrow">个人与工作环境</p>
            <h2>日常使用设置</h2>
          </div>
          <button className="primary-button" type="submit">保存设置</button>
        </div>

        <div className="settings-grid">
          <section className="settings-section">
            <div className="section-heading compact">
              <h3>账号资料</h3>
              {saved && <span className="saved-badge">已保存</span>}
            </div>
            <label className="settings-field">
              <span>显示姓名</span>
              <input value={form.name} onChange={(event) => updateField("name", event.target.value)} />
            </label>
            <label className="settings-field">
              <span>当前身份</span>
              <select value={form.role} onChange={(event) => updateField("role", event.target.value)}>
                <option>一线检修人员</option>
                <option>专家审核人员</option>
                <option>运维管理员</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <div className="section-heading compact">
              <h3>场站与班组</h3>
              <span>同步顶部栏</span>
            </div>
            <label className="settings-field">
              <span>所属场站</span>
              <input value={form.site} onChange={(event) => updateField("site", event.target.value)} />
            </label>
            <label className="settings-field">
              <span>班组</span>
              <input value={form.team} onChange={(event) => updateField("team", event.target.value)} />
            </label>
          </section>

          <section className="settings-section">
            <div className="section-heading compact">
              <h3>默认设备范围</h3>
              <span>诊断入口默认使用</span>
            </div>
            <label className="settings-field">
              <span>设备范围</span>
              <select value={form.deviceScope} onChange={(event) => updateField("deviceScope", event.target.value)}>
                <option>站控柜 A01 · 工控机</option>
                <option>站控柜全部工控设备</option>
                <option>当前场站全部设备</option>
              </select>
            </label>
            <div className="settings-note">当前 MVP 主流程仍固定为 ACP-4000 / IPC-610 工控机散热异常。</div>
          </section>

          <section className="settings-section">
            <div className="section-heading compact">
              <h3>通知与语音</h3>
              <span>现场使用偏好</span>
            </div>
            <label className="settings-field">
              <span>告警通知</span>
              <select value={form.notification} onChange={(event) => updateField("notification", event.target.value)}>
                <option>仅高优先级告警</option>
                <option>全部告警</option>
                <option>关闭通知</option>
              </select>
            </label>
            <label className="settings-field">
              <span>语音播报</span>
              <select value={form.voiceMode} onChange={(event) => updateField("voiceMode", event.target.value)}>
                <option>仅检修步骤播报</option>
                <option>诊断结论与检修步骤播报</option>
                <option>关闭语音播报</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <div className="section-heading compact">
              <h3>作业卡与专家协同</h3>
              <span>检修闭环</span>
            </div>
            <label className="settings-field">
              <span>导出格式</span>
              <select value={form.exportFormat} onChange={(event) => updateField("exportFormat", event.target.value)}>
                <option>PDF 作业卡</option>
                <option>Word 作业卡</option>
                <option>打印版记录</option>
              </select>
            </label>
            <label className="settings-field">
              <span>专家协同</span>
              <select value={form.expertMode} onChange={(event) => updateField("expertMode", event.target.value)}>
                <option>异常结论后可提交专家审核</option>
                <option>检修完成后提交专家审核</option>
                <option>仅人工需要时提交</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <div className="section-heading compact">
              <h3>流程确认</h3>
              <span>安全习惯</span>
            </div>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={form.showSafetyConfirm}
                onChange={(event) => updateField("showSafetyConfirm", event.target.checked)}
              />
              <span>检修向导中始终显示安全确认</span>
            </label>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={form.autoSaveRecord}
                onChange={(event) => updateField("autoSaveRecord", event.target.checked)}
              />
              <span>检修完成后自动生成记录</span>
            </label>
          </section>
        </div>
      </form>
    </section>
  );
}

function PlaceholderPage({ title, text }) {
  return (
    <section className="single-page panel">
      <p className="eyebrow">预留页面</p>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function getAssistantContext(stage, activeIntakeStep, analysisSubStep, currentStep, diagnosis, intakeBranch) {
  if (stage === "input") {
    const suggestions = [
      "请先确认异常首次发现时间、持续时长和发生频次。已知报障描述会保留在顶部，不占用中央业务空间。",
      "请先核对系统匹配出的场站、控制中心和站控柜位置，确认后再生成设备信息任务。",
      `建议确认设备型号、设备角色和关联告警。当前重新评估结果：${intakeBranch?.detail || "等待字段确认"}`,
      intakeBranch?.id === "equipment-mismatch"
        ? "设备对象已修正为 PLC 控制柜，请核对控制器 RUN、通信 LINK、数据上送和电源状态。"
        : `重点核对 TEMP/FAN、风扇转速、系统温度和 CPU 温度。当前分支：${intakeBranch?.diagnosis || "等待运行值确认"}`,
      "请核对当前判断使用的告警标准、设备台账和操作手册；确认后系统会形成现场异常事件全景。",
      `异常事件确认后，将按“${intakeBranch?.diagnosis || "当前诊断方向"}”启动多 Agent 会诊。`,
    ];
    return {
      label: activeIntakeStep === 3 && intakeBranch?.id === "equipment-mismatch"
        ? "异常接入 · 控制器与通信状态"
        : `异常接入 · ${intakeTasks[activeIntakeStep]?.title || "现场信息"}`,
      suggestion: suggestions[activeIntakeStep] || suggestions[0],
    };
  }

  if (stage === "analysis") {
    return {
      label: "分析诊断 · 多 Agent 会诊",
      suggestion: "当前正在模拟分析诊断 Agent、操作合规 Agent 和知识检索 Agent 的运行过程。",
    };
  }

  if (stage === "diagnosis") {
    return {
      label: `分析诊断 · ${diagnosisTasks[analysisSubStep]?.title || "诊断结论"}`,
      suggestion: diagnosis
        ? "可以追问诊断依据、风险原因或为什么建议进入步骤式检修向导。"
        : "诊断结论生成后，我会辅助解释证据和下一步处理建议。",
    };
  }

  if (stage === "plan") {
    return {
      label: "检修向导 · 预方案确认",
      suggestion: "系统已生成两级检修大纲。可以修改大步骤和小维修步骤，强制安全项不能删除；确认后向导将使用当前版本。",
    };
  }

  if (stage === "guide" && currentStep) {
    return {
      label: `检修向导 · ${currentStep.title}`,
      suggestion: `${currentStep.description} 本步安全要求：${currentStep.safety}`,
    };
  }

  if (stage === "record") {
    return {
      label: "检修记录",
      suggestion: "可以追问本次检修记录、处理结论、关键确认项和后续专家审核状态。",
    };
  }

  return {
    label: "检修智能体",
    suggestion: "先描述现场现象，我会辅助补充信息并解释当前步骤。",
  };
}

function getAssistantReply(stage, activeIntakeStep, analysisSubStep, currentStep, message) {
  const text = message.trim();
  if (stage === "input") {
    if (activeIntakeStep === 0) return "请先确认异常首次发现时间、持续时长和发生频次。确认后系统会结合报障描述识别故障地点。";
    if (activeIntakeStep === 1) return "当前先确认位置匹配结果：山东德州分输站、控制中心、站控柜 A01。位置确认后系统再读取该机柜的设备台账。";
    if (activeIntakeStep === 2) return "本步建议确认设备型号为 ACP-4000 / IPC-610，再补充工控机角色和 TEMP/FAN 关联告警。";
    if (activeIntakeStep === 3) return "阈值可以先按演示值填写：风扇 <500 rpm、系统温度 >55°C、CPU 温度 >70°C。后续接 API 后可由设备数据自动带入。";
    if (activeIntakeStep === 4) return "请核对依据标准和操作手册。它们用于解释系统为什么形成当前判断，确认后会生成异常事件全景。";
    return "接入信息已经足够触发诊断。建议点击触发诊断，让系统进入多 Agent 会诊并生成诊断结论。";
  }

  if (stage === "analysis") {
    return "当前是模拟会诊流程：分析诊断 Agent 判断故障方向，操作合规 Agent 校验安全要求，知识检索 Agent 匹配维修知识条目。";
  }

  if (stage === "diagnosis") {
    if (analysisSubStep === 0) return "触发诊断后，系统会把异常限定在站控柜工控机散热系统，不扩展到 PLC 或全站设备。";
    if (analysisSubStep === 1) return "会诊依据主要来自 TEMP/FAN 告警、风扇转速、系统温度、CPU 温度和安全操作要求。";
    return "当前结论优先指向风道堵塞、滤网积尘或风扇低速。建议进入检修向导，按步骤完成确认和恢复验证。";
  }

  if (stage === "plan") {
    return "当前是检修预方案确认阶段。系统初稿可以直接采用，也可以由工程师增删改普通步骤；断电和防静电等强制安全项会保持锁定。";
  }

  if (stage === "guide" && currentStep) {
    if (currentStep.id === "step-02-safety") return "本步不要跳过：先通知负责人、正常关机、拔除电源、等待冷却，并佩戴防静电手环。";
    if (currentStep.id === "step-03-airflow") return "建议先看环境温度是否超过 40°C，再检查进风口、出风口和机箱开孔是否被遮挡。";
    if (currentStep.id === "step-04-filter-fan") return "建议先检查门滤网和风扇滤网积尘，再确认风扇是否异响、停转、低速，并核对 FAN1/FAN2 接线顺序。";
    if (currentStep.id === "step-05-verify") return "恢复后重点观察风扇是否高于 500 rpm、系统温度是否不高于 55°C、CPU 温度是否不高于 70°C，并连续观察不少于 10 分钟。";
    return "本步先完成外观和状态确认，不进行拆检。记录 TEMP/FAN、蜂鸣器、风扇 rpm、温度和站控柜位置。";
  }

  if (stage === "record") return "检修记录会沉淀本次故障、步骤完成情况、处理结论和专家审核状态，后续可以接导出或知识回流 API。";

  return text.includes("API")
    ? "后续这里可以替换为真实大模型 API：把当前阶段、步骤、用户问题和维修知识作为上下文传给后端。"
    : "我会根据当前步骤给出辅助建议。当前版本是本地模拟回复，用于演示交互效果。";
}

function AgentConsultationStream({ agents, activeAgentIndex, tick }) {
  const complete = activeAgentIndex >= agents.length;
  const progress = complete ? 100 : Math.round((Math.max(0, activeAgentIndex) / agents.length) * 100);

  return (
    <section className="consultation-stream" aria-live="polite">
      <header className="consultation-stream-overview">
        <div><span>会诊进度</span><strong>{complete ? "三路证据已汇合" : `${activeAgentIndex + 1} / ${agents.length} Agent 运行中`}</strong></div>
        <em>{progress}%</em>
        <div className="consultation-mini-track"><i style={{ width: `${progress}%` }} /></div>
      </header>
      <article className="consultation-input-message">
        <MapPin size={14} /><div><span>会诊输入</span><strong>站控柜 A01 · 工控机散热异常事件</strong><p>TEMP/FAN 告警、风扇低速、系统与 CPU 温度升高</p></div>
      </article>

      <div className="consultation-agent-thread">
        {agents.map((agent, index) => {
          const detail = consultationAgentDetails[index];
          const done = index < activeAgentIndex || complete;
          const running = index === activeAgentIndex && !complete;
          const visibleLineCount = done ? detail.lines.length : running ? Math.min(detail.lines.length, Math.max(1, Math.floor(tick / 2) + 1)) : 0;
          const visibleSourceCount = done ? detail.sources.length : running ? Math.min(detail.sources.length, Math.max(0, Math.floor((tick - 3) / 2))) : 0;
          const showResult = done || (running && tick >= 10);
          return (
            <article className={classNames("consultation-agent-message", done && "done", running && "running", !done && !running && "waiting")} key={agent.name}>
              <header>
                <span className="consultation-agent-icon">{done ? <Check size={14} /> : running ? <Loader2 size={14} className="spin" /> : index + 1}</span>
                <div><strong>{agent.name}</strong><small>{detail.role}</small></div>
                <em>{done ? "已完成" : running ? "会诊中" : "等待"}</em>
              </header>
              {(done || running) && (
                <div className="consultation-agent-content">
                  <p className="consultation-agent-input"><span>读取输入</span>{detail.input}</p>
                  <div className="consultation-thinking-lines">
                    {detail.lines.slice(0, visibleLineCount).map((line, lineIndex) => <p style={{ "--line-index": lineIndex }} key={line}><i />{line}{running && lineIndex === visibleLineCount - 1 && tick < 10 && <b className="stream-cursor" />}</p>)}
                  </div>
                  {(visibleSourceCount > 0 || done) && (
                    <div className="consultation-sources"><span>{done ? <Check size={11} /> : <Search size={11} className="consultation-searching" />}{done ? "已命中依据" : "正在检索依据"}</span>{detail.sources.slice(0, visibleSourceCount).map((source) => <small key={source}>{source}</small>)}</div>
                  )}
                  {showResult && <div className="consultation-agent-result"><span>阶段结论</span><p>{detail.result}</p></div>}
                  {done && index < agents.length - 1 && <div className="consultation-handoff"><GitBranch size={12} /> 已将阶段结果交给下一 Agent</div>}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {complete && (
        <div className="consultation-convergence">
          <div><span /><span /><span /><Check size={18} /></div>
          <strong>分析、知识与合规证据已汇合</strong>
          <p>正在生成结构化诊断结论与检修建议…</p>
        </div>
      )}
    </section>
  );
}

const ASSISTANT_PET_LABELS = {
  idle: "等待检修任务",
  starting: "正在启动检修分析",
  thinking: "正在分析当前步骤与检修上下文",
  complete: "辅助建议已生成",
};

function AssistantPet({ state }) {
  return (
    <span className="assistant-pet" aria-hidden="true">
      <span key={state} className={classNames("assistant-pet-sprite", state)} />
    </span>
  );
}

function AssistantChat({
  stage,
  activeIntakeStep,
  triageAgentStatus,
  triageTraceCount,
  triageCharCount,
  activeTransition,
  analysisSubStep,
  currentStep,
  diagnosis,
  activeAgentIndex,
  intakeBranch,
  planRevisionEvents,
}) {
  const context = getAssistantContext(stage, activeIntakeStep, analysisSubStep, currentStep, diagnosis, intakeBranch);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState(null);
  const [thinkingText, setThinkingText] = useState("");
  const [retrievalVisibleCount, setRetrievalVisibleCount] = useState(0);
  const [sourceVisibleCount, setSourceVisibleCount] = useState(0);
  const [processStarted, setProcessStarted] = useState(false);
  const [consultationTick, setConsultationTick] = useState(0);
  const [assistantPetState, setAssistantPetState] = useState("idle");
  const timersRef = useRef([]);
  const petTimersRef = useRef([]);
  const automaticPetBusyRef = useRef(false);
  const assistantBodyRef = useRef(null);

  function clearAssistantTimers() {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }

  function clearAssistantPetTimers() {
    petTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    petTimersRef.current = [];
  }

  function playAssistantPetState(state, duration, nextState) {
    clearAssistantPetTimers();
    setAssistantPetState(state);
    if (!duration || !nextState) return;
    const timer = window.setTimeout(() => setAssistantPetState(nextState), duration);
    petTimersRef.current.push(timer);
  }

  useEffect(() => {
    clearAssistantTimers();
    setMessages([
      {
        id: `hint-${context.label}`,
        role: "hint",
        text: context.suggestion,
      },
    ]);
    setDraft("");
    setThinking(false);
    setStreaming(false);
    setStreamingMessageId(null);
    setThinkingText("");
    setRetrievalVisibleCount(0);
    setSourceVisibleCount(0);
    setProcessStarted(false);
    clearAssistantPetTimers();
    automaticPetBusyRef.current = false;
    setAssistantPetState("idle");
    return () => {
      clearAssistantTimers();
      clearAssistantPetTimers();
    };
  }, [context.label, context.suggestion]);

  useEffect(() => {
    if (stage !== "analysis") {
      setConsultationTick(0);
      return undefined;
    }
    setConsultationTick(0);
    const timer = window.setInterval(() => setConsultationTick((value) => value + 1), 420);
    return () => window.clearInterval(timer);
  }, [activeAgentIndex, stage]);

  useEffect(() => {
    const container = assistantBodyRef.current;
    if (!container) return undefined;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeAgentIndex, consultationTick, messages, streamingMessageId, triageCharCount, triageTraceCount]);

  const analysisBusy = Boolean(
    stage === "analysis"
      && diagnosis?.agents?.length
      && activeAgentIndex < diagnosis.agents.length
  );
  const automaticPetBusy = triageAgentStatus === "running" || analysisBusy;

  useEffect(() => {
    if (thinking || streaming) {
      automaticPetBusyRef.current = automaticPetBusy;
      return;
    }

    const wasBusy = automaticPetBusyRef.current;
    automaticPetBusyRef.current = automaticPetBusy;
    if (automaticPetBusy) {
      if (!wasBusy) {
        playAssistantPetState("starting", 800, "thinking");
      } else {
        playAssistantPetState("thinking");
      }
      return;
    }

    if (wasBusy) {
      playAssistantPetState("complete", 900, "idle");
    }
  }, [automaticPetBusy, streaming, thinking]);

  function sendMessage() {
    const text = draft.trim();
    if (!text || thinking || streaming) return;

    const userMessage = { id: `user-${Date.now()}`, role: "user", text };
    const fanWiringQuestion = stage === "guide"
      && currentStep?.id === "step-04-filter-fan"
      && /FAN1|FAN2|接线顺序|风扇.{0,8}接线|接线.{0,8}风扇/i.test(text);
    const fanSpeedCauseQuestion = stage === "input"
      && activeIntakeStep === 3
      && intakeBranch?.id !== "equipment-mismatch"
      && /风扇.{0,8}转速.{0,16}(什么情况|原因|导致|为什么|异常|偏低|过低)|转速.{0,12}(偏低|过低|异常).{0,12}(原因|导致|为什么)/i.test(text);
    const reply = buildMaintenanceAnswer(text, {
      allowFanWiring: fanWiringQuestion,
      allowFanSpeedCause: fanSpeedCauseQuestion,
    })
      || getAssistantReply(stage, activeIntakeStep, analysisSubStep, currentStep, text);
    const replyId = `assistant-${Date.now()}`;
    const streamStartDelay = getRandomAgentStreamDelay();
    const evidenceItems = fanWiringQuestion
      ? [
          "当前步骤上下文：" + context.label,
          "ACP-4000 / IPC-610 User Manual Ed.6 · 印刷页 24 · FAN 连续接线说明",
          "ACP-4000 / IPC-610 User Manual Ed.6 · 印刷页 25 · Table 4.5 风扇数量配置",
          "ACP-4000 / IPC-610 User Manual Ed.6 · 印刷页 27 · Table 4.20 FAN 针脚定义",
          "风险提示：断电、标记原线序并做好防静电后再拆装",
        ]
      : fanSpeedCauseQuestion
        ? [
            "当前步骤上下文：" + context.label,
            "ACP-4000 / IPC-610 User Manual Ed.6 · 印刷页 20~23 · 转速监控、Smart Fan 与告警判据",
            "ACP-4000 / IPC-610 User Manual Ed.6 · 印刷页 24~25 · FAN 接线及数量配置",
            "ACP-4000 / IPC-610 User Manual Ed.6 · 印刷页 27 · +12V_FAN 与 FAN_DEC 针脚",
            "散热异常检修指南 · 积尘、卡滞、轴承、接线与告警板排查",
            "风险提示：断电并做好防静电后再检查风扇、插头和告警板",
          ]
      : [
          "当前步骤上下文：" + context.label,
          ...retrievalStatuses.map((item) => item.title),
          ...assistantSources.map((source) => source.title),
          "风险提示：断电、冷却、防静电后再进入拆检动作",
        ];

    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: replyId,
        role: "assistant",
        text: "",
        status: "running",
        evidenceItems,
        evidenceVisibleCount: 0,
      },
    ]);
    setDraft("");
    setThinking(true);
    setStreaming(true);
    setStreamingMessageId(replyId);
    setProcessStarted(true);
    setThinkingText("");
    setRetrievalVisibleCount(0);
    setSourceVisibleCount(0);
    clearAssistantTimers();
    playAssistantPetState("starting", 800, "thinking");

    evidenceItems.forEach((_, index) => {
      const timer = window.setTimeout(() => {
        setMessages((current) => current.map((message) => (
          message.id === replyId
            ? { ...message, evidenceVisibleCount: index + 1 }
            : message
        )));
      }, streamStartDelay + 200 + index * 520);
      timersRef.current.push(timer);
    });

    const chars = Array.from(reply);
    chars.forEach((char, index) => {
      const streamTimer = window.setTimeout(() => {
        setMessages((current) => current.map((message) => (
          message.id === replyId
            ? { ...message, text: `${message.text}${char}` }
            : message
        )));
        if (index === chars.length - 1) {
          setThinking(false);
          setStreaming(false);
          setStreamingMessageId(null);
          setMessages((current) => current.map((message) => (
            message.id === replyId
              ? { ...message, status: "done", evidenceVisibleCount: evidenceItems.length }
              : message
          )));
          playAssistantPetState("complete", 900, "idle");
        }
      }, streamStartDelay + index * 34);
      timersRef.current.push(streamTimer);
    });
  }

  const transitionConfigMap = {
    intake: intakeTransitionAgents,
    diagnosis: diagnosisTransitionAgents,
    guide: guideTransitionAgents,
  };
  const baseTransitionConfig = activeTransition
    ? transitionConfigMap[activeTransition.type]?.[activeTransition.fromIndex]
    : null;
  const transitionConfig = activeTransition?.type === "intake"
    ? getBranchTransitionConfig(intakeBranch, activeTransition.fromIndex, baseTransitionConfig)
    : baseTransitionConfig;
  const showTriageAgent = Boolean(activeTransition && transitionConfig);
  const triageStreamLines = transitionConfig?.lines || [];
  const triageEvidenceItems = transitionConfig?.evidence || [];
  const triageStatus = activeTransition?.status || "idle";
  const triageFullText = triageStreamLines.join("\n");
  const triageVisibleLines = triageFullText
    .slice(0, triageStatus === "done" ? triageFullText.length : triageCharCount)
    .split("\n")
    .filter((line, index, lines) => line || index < lines.length - 1);
  const triageEvidenceVisibleCount = triageStatus === "done"
    ? triageEvidenceItems.length
    : Math.max(0, Math.min(4, Math.floor((triageCharCount - 78) / 34) + 1));
  const showTriageEvidence = triageEvidenceVisibleCount > 0 || triageTraceCount >= 3 || triageStatus === "done";

  return (
    <aside className="assistant-chat">
      <div className="assistant-head">
        <MessageCircle size={16} />
        <div className="assistant-head-copy">
          <strong>{stage === "analysis" ? "多 Agent 会诊" : "检修智能体"}</strong>
          <span aria-live="polite">
            {assistantPetState === "idle" ? context.label : ASSISTANT_PET_LABELS[assistantPetState]}
          </span>
        </div>
        <AssistantPet state={assistantPetState} />
      </div>
      <div className="assistant-body" ref={assistantBodyRef}>
        {stage === "analysis" && diagnosis && (
          <AgentConsultationStream agents={diagnosis.agents} activeAgentIndex={activeAgentIndex} tick={consultationTick} />
        )}
        {showTriageAgent && (
          <section className="agent-stream-panel">
            <div className="agent-stream-head">
              {triageStatus === "running" ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
              <div>
                <strong>
                  {triageStatus === "done" ? transitionConfig.doneTitle : transitionConfig.runningTitle}
                  <ChevronRight size={13} />
                </strong>
                <span>{triageStatus === "done" ? transitionConfig.doneSubtitle : transitionConfig.runningSubtitle}</span>
              </div>
            </div>
            <div className="agent-stream-lines">
              {triageVisibleLines.length > 0 ? triageVisibleLines.map((line, index) => (
                <p key={`${line}-${index}`}>
                  {line}
                  {triageStatus === "running" && index === triageVisibleLines.length - 1 && <i className="stream-cursor" />}
                </p>
              )) : (
                <p>{triageStatus === "running" && triageCharCount > 0 && <i className="stream-cursor" />}</p>
              )}
            </div>
            {showTriageEvidence && (
              <div className="agent-evidence-box">
                <div className="agent-evidence-head">
                  {triageStatus === "done" ? (
                    <Check size={11} />
                  ) : (
                    <Loader2 size={11} className="spin" />
                  )}
                  {triageStatus === "done"
                    ? `已参考 ${triageEvidenceItems.length} 条检修依据`
                    : "正在搜索检修依据"}
                  <ChevronRight size={12} />
                </div>
                <ul>
                  {triageEvidenceItems
                    .slice(0, triageEvidenceVisibleCount)
                    .map((item) => (
                      <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {triageStatus === "done" && (
              <div className="agent-stream-result">
                <p><strong>{transitionConfig.agentName} 输出：</strong>{transitionConfig.result}</p>
              </div>
            )}
          </section>
        )}
        {stage === "plan" && planRevisionEvents.length > 0 && (
          <section className="assistant-plan-revisions">
            <div><Wrench size={12} /><strong>工程师修改记录</strong><span>{planRevisionEvents.length}</span></div>
            {planRevisionEvents.map((event, index) => <p key={`${event}-${index}`}>{event}</p>)}
          </section>
        )}
        <div className="assistant-api-note">当前为本地模拟回复，后续接入大模型 API 后替换此逻辑。</div>

        <div className="assistant-message-list">
          {messages.map((message) => (
            <div className={classNames("assistant-message", message.role)} key={message.id}>
              {message.role === "hint" && <span>当前步骤建议</span>}
              {message.role === "assistant" ? (
                <section className="agent-stream-panel assistant-agent-response">
                  <div className="agent-stream-head">
                    {message.status === "done" ? <Check size={15} /> : <Loader2 size={15} className="spin" />}
                    <div>
                      <strong>
                        {message.status === "done" ? "辅助诊断 Agent 已完成" : "辅助诊断 Agent 正在思考中"}
                        <ChevronRight size={13} />
                      </strong>
                      <span>{message.status === "done" ? "已生成当前步骤建议" : "正在结合当前步骤检索维修依据"}</span>
                    </div>
                  </div>
                  {(message.evidenceVisibleCount > 0 || message.status === "done") && (
                    <div className="agent-evidence-box">
                      <div className="agent-evidence-head">
                        {message.status === "done" ? <Check size={11} /> : <Loader2 size={11} className="spin" />}
                        {message.status === "done"
                          ? `已参考 ${message.evidenceItems.length} 条检修依据`
                          : "正在搜索检修依据"}
                        <ChevronRight size={12} />
                      </div>
                      <ul>
                        {message.evidenceItems.slice(0, message.evidenceVisibleCount).map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="agent-stream-result agent-stream-answer">
                    <StreamingMarkdown content={message.text} />
                    {message.id === streamingMessageId && <i className="stream-cursor" />}
                  </div>
                </section>
              ) : (
                <p>{message.text}</p>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="assistant-input">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") sendMessage();
          }}
          placeholder="追问当前步骤..."
        />
        <button onClick={sendMessage} disabled={!draft.trim() || thinking || streaming}>
          {thinking || streaming ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
      </div>
    </aside>
  );
}
