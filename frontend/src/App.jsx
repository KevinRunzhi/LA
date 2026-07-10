import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
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
  PhoneCall,
  Play,
  Plug,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  Video,
  Volume2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { api } from "./api/client";
import { SourceCard } from "./components/chat/SourceCard";
import { StreamingMarkdown } from "./components/chat/StreamingMarkdown";
import { ThinkingProcess } from "./components/chat/ThinkingProcess";
import { defaultInput } from "./data/fallbackDemo";
import { assistantSources, buildMaintenanceAnswer, retrievalStatuses } from "./data/streamingAssistantDemo";

const navItems = [
  { id: "workbench", label: "工作台", icon: LayoutDashboard },
  { id: "graph", label: "知识图谱", icon: GitBranch },
  { id: "records", label: "检修记录", icon: ClipboardList },
  { id: "settings", label: "设置", icon: Settings },
];

const intakeTasks = [
  {
    title: "描述现场现象",
    value: "温度告警、风扇声音异常",
    detail: "请描述现场看到的异常现象，系统将整理为诊断输入。",
  },
  {
    title: "设备位置识别",
    value: "某输气场站 · 站控柜 A01",
    detail: "根据现场描述与设备台账匹配场站、区域和机柜位置，并由工程师确认。",
  },
  {
    title: "补充设备型号",
    value: "研华 ACP-4000 / IPC-610",
    detail: "确认主演示设备为站控柜内工控机整机，不进入 PLC 控制柜完整诊断。",
  },
  {
    title: "确认灯值和阈值",
    value: "TEMP/FAN 告警，风扇转速偏低",
    detail: "重点确认风扇 <500 rpm、系统温度 >55°C、CPU 温度 >70°C 等判断条件。",
  },
  {
    title: "接入信息确认",
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
    options: ["研华 ACP-4000 / IPC-610", "西门子 IPC647E 工控机", "PLC 控制柜"],
  },
  {
    label: "设备角色",
    helper: "系统角色确认",
    source: "设备台账",
    options: ["站控画面与数据采集终端", "工程师站与监控终端", "PLC 逻辑控制单元"],
  },
  {
    label: "关联告警",
    helper: "异常信号确认",
    source: "现场描述 + 告警规则",
    options: ["TEMP/FAN、蜂鸣、温度升高", "仅温度升高（无 TEMP/FAN）", "通信中断 / 数据不上送"],
  },
];

function getIntakeBranch(selections, thresholdValues) {
  const model = selections["设备型号"] || "";
  const alarm = selections["关联告警"] || "";
  const led = thresholdValues["TEMP/FAN LED"] || "";
  const fan = thresholdValues["风扇转速"] || "";

  if (model.includes("PLC") || alarm.includes("通信")) {
    return {
      id: "equipment-mismatch",
      label: "设备链路重新评估",
      tone: "danger",
      title: "当前设备或告警与散热知识链不一致",
      detail: "系统已暂停沿用工控机散热结论，下一步应补充控制器状态、通信模块和数据上送信息。",
      diagnosis: "控制器 / 通信链路待补充",
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

function getBranchThresholdInputs(intakeBranch) {
  return intakeBranch?.id === "equipment-mismatch" ? controlBranchInputs : thresholdInputs;
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
        detail: "查看主板 FAN 接口位置，拆装前记录接线顺序，恢复时核对 FAN1/FAN2 连接。",
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
    agentName: "接诊 Agent",
    runningTitle: "接诊 Agent 正在生成下一步",
    doneTitle: "接诊 Agent 已生成下一步",
    runningSubtitle: "正在根据现场描述生成设备位置识别任务",
    doneSubtitle: "已生成“设备位置识别”任务",
    lines: [
      "现场描述已接入，系统正在整理异常关键词和场站位置线索。",
      "识别到散热相关信号：温度告警、风扇声音异常、风扇转速偏低。",
      "匹配场站设备台账：当前异常可能位于控制中心 / 站控柜 A01。",
      "生成下一步任务：设备位置识别。",
    ],
    evidence: [
      "现场异常描述：温度告警、风扇声音异常、风扇转速偏低",
      "场站位置提示：控制中心 / 站控柜 A01 / 工控机区域",
      "异常接入规则：先确认设备位置，再补充设备对象",
      "知识图谱节点：站控柜、工控机、散热异常、TEMP/FAN 告警",
      "MVP 演示流程：描述现象后先生成位置识别任务",
    ],
    result: "已生成设备位置识别任务。下一步请确认场站、控制中心和站控柜位置。",
  },
  {
    agentName: "位置识别 Agent",
    runningTitle: "位置识别 Agent 正在生成下一步",
    doneTitle: "位置识别 Agent 已生成下一步",
    runningSubtitle: "正在根据已确认位置生成设备信息补充任务",
    doneSubtitle: "已生成“补充设备信息”任务",
    lines: [
      "设备位置已由工程师确认，系统正在读取站控柜 A01 设备台账。",
      "匹配到工控机、PLC 控制柜、通信模块等已登记设备对象。",
      "当前异常描述与工控机散热告警特征相关，需要进一步确认具体型号和角色。",
      "生成下一步任务：补充设备信息。",
    ],
    evidence: [
      "位置确认：某输气场站 / 控制中心 / 站控柜 A01",
      "设备台账：站控柜 A01 已登记工控机与控制模块",
      "现场材料：图片、视频和音频证据集合",
      "异常关键词：温度告警、风扇声音异常、风扇转速偏低",
      "接入规则：位置确认后补充设备型号、角色与关联告警",
    ],
    result: "已生成设备信息补充任务。下一步请确认设备型号、设备角色和关联告警。",
  },
  {
    agentName: "设备识别 Agent",
    runningTitle: "设备识别 Agent 正在生成下一步",
    doneTitle: "设备识别 Agent 已生成下一步",
    runningSubtitle: "正在根据设备对象生成灯态与阈值确认页面",
    doneSubtitle: "已生成“确认灯值和阈值”页面",
    lines: [
      "设备对象已补充，系统正在核对站控柜 A01 内工控机信息。",
      "识别到主演示设备：研华 ACP-4000 / IPC-610 工控机。",
      "匹配散热异常判据：TEMP/FAN 灯、蜂鸣器、风扇转速、系统温度、CPU 温度。",
      "生成下一步页面：确认灯值和阈值。",
    ],
    evidence: [
      "设备型号：研华 ACP-4000 / IPC-610",
      "设备位置：控制中心 / 站控柜 A01",
      "设备角色：站控机 / 工控机",
      "维修指导：ACP-4000 / IPC-610 散热与风扇模块检查项",
      "告警知识：TEMP/FAN、蜂鸣器、风扇 rpm、系统温度、CPU 温度",
    ],
    result: "已生成告警与阈值确认页面。下一步请核对灯态、蜂鸣器、风扇转速和温度阈值。",
  },
  {
    agentName: "告警解析 Agent",
    runningTitle: "告警解析 Agent 正在生成下一步",
    doneTitle: "告警解析 Agent 已生成下一步",
    runningSubtitle: "正在把灯态和阈值整理为接入确认项",
    doneSubtitle: "已生成“接入信息确认”页面",
    lines: [
      "灯态与阈值信息已接入，系统正在判断异常信号是否指向散热链路。",
      "TEMP/FAN 告警、风扇低速和温度升高共同指向风道或风扇模块异常。",
      "整理诊断输入：现场描述、设备对象、灯态阈值和关联告警。",
      "生成下一步页面：接入信息确认。",
    ],
    evidence: [
      "TEMP/FAN 灯态：红灯为异常，绿灯为正常",
      "风扇状态：转速偏低或停转会触发散热异常方向",
      "阈值规则：风扇 rpm、系统温度、CPU 温度共同参与判断",
      "知识图谱节点：灯态、蜂鸣器、风扇模块、温度阈值",
      "安全提示：进入拆检前必须完成接入信息确认",
    ],
    result: "已生成接入信息确认页面。下一步请复核系统整理出的诊断输入，再触发分析诊断。",
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
    runningSubtitle: "正在把诊断结论转成步骤式检修向导",
    doneSubtitle: "已生成“确认告警与定位设备”页面",
    lines: [
      "诊断结论已确认，系统正在把散热异常结论转成工程师可执行的检修步骤。",
      "正在匹配安全作业顺序：先确认告警与设备位置，再进入断电隔离和风道检查。",
      "正在生成检查项、图片提示、阈值提醒和安全说明。",
      "生成下一步页面：确认告警与定位设备。",
    ],
    evidence: [
      "诊断结论：一次工控机散热相关异常",
      "可能原因排序：风道堵塞 / 滤网积尘、风扇低速或停转、机柜环境异常",
      "安全检修规则：先确认告警与定位，再执行断电和拆检",
      "维修指导：ACP-4000 / IPC-610 散热系统检修步骤",
      "MVP 检修向导结构：告警定位、安全隔离、风道检查、部件检查、恢复验证",
    ],
    result: "已生成检修向导第一页。下一步请确认 TEMP/FAN、蜂鸣器、风扇状态和设备位置。",
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

  if (intakeBranch?.id === "equipment-mismatch" && fromIndex === 3) {
    return {
      ...fallback,
      runningSubtitle: "正在把控制器与通信状态整理为接入摘要",
      doneSubtitle: "已生成“控制器 / 通信链路接入摘要”",
      lines: [
        "控制器与通信状态已接入，系统正在核对 RUN、LINK、数据上送和电源状态。",
        "当前输入指向控制器 / 通信链路，不再沿用工控机散热异常方向。",
        "整理诊断输入：PLC 设备对象、通信告警、控制器状态和数据上送状态。",
        "生成下一步页面：接入摘要确认。",
      ],
      evidence: [
        "控制器 RUN 状态",
        "通信模块 LINK 状态",
        "数据上送状态",
        "电源状态",
        "工程师对设备与告警的修正记录",
      ],
      result: "已生成控制器 / 通信链路接入摘要，下一步请复核后启动诊断。",
    };
  }

  if (intakeBranch?.id === "thermal-without-alarm" && fromIndex === 3) {
    return {
      ...fallback,
      lines: [
        "TEMP/FAN 未显示告警，但系统温度与 CPU 温度仍偏高。",
        "强告警证据减少，系统降低风扇故障优先级。",
        "重新排序诊断方向：环境温度、风道积尘、温度传感器优先。",
        "生成下一步页面：接入摘要确认。",
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
  name: "李师傅",
  role: "一线检修人员",
  site: "某输气场站",
  team: "站控运维一班",
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

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(defaultUser);
  const [navOpen, setNavOpen] = useState(false);
  const [activePage, setActivePage] = useState("workbench");
  const [stage, setStage] = useState("home");
  const [health, setHealth] = useState("连接中");
  const [scenario, setScenario] = useState(null);
  const [homeDraft, setHomeDraft] = useState("");
  const [intakeMaterials, setIntakeMaterials] = useState([]);
  const [activeMaterialId, setActiveMaterialId] = useState(null);
  const [previewMaterialId, setPreviewMaterialId] = useState(null);
  const materialUrlsRef = useRef(new Set());
  const [input, setInput] = useState(defaultInput);
  const [diagnosis, setDiagnosis] = useState(null);
  const [steps, setSteps] = useState([]);
  const [activeStep, setActiveStep] = useState(0);
  const [activeIntakeStep, setActiveIntakeStep] = useState(0);
  const [activeDiagnosisTask, setActiveDiagnosisTask] = useState(0);
  const [evidence, setEvidence] = useState([]);
  const [graph, setGraph] = useState([]);
  const [record, setRecord] = useState(null);
  const [expertReview, setExpertReview] = useState(null);
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
    if (stage === "guide") return 2;
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
    runStageTransition("diagnosis", 1, async () => {
      setSteps(await api.steps());
      setStage("guide");
      setActiveStep(0);
    });
  }

  async function completeCurrentStep() {
    if (!currentStep || triageAgentStatus === "running") return;
    runStageTransition("guide", activeStep, async () => {
      await api.completeStep(currentStep.id);
      const latestSteps = await api.steps();
      setSteps(latestSteps);
      if (activeStep < latestSteps.length - 1) {
        setActiveStep(activeStep + 1);
      } else {
        const result = await api.generateRecord();
        setRecord(result);
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
    setIntakeSelections((current) => ({ ...current, [label]: value }));
    setEquipmentFieldSources((current) => ({ ...current, [label]: "工程师手动确认" }));
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
    const typingTimer = window.setInterval(() => {
      currentCount += 1;
      setTriageCharCount(currentCount);
      setActiveTransition((current) => (
        current && current.type === type && current.fromIndex === fromIndex
          ? { ...current, charCount: currentCount }
          : current
      ));
    }, 48);

    [1, 2, 3, 4].forEach((count, index) => {
      window.setTimeout(() => setTriageTraceCount(count), 980 * (index + 1));
    });

    window.setTimeout(() => window.clearInterval(typingTimer), 7200);
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
    }, 7200);
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
    setAutoRecognizing(true);
    setAutoRecognized(false);
    setEquipmentTraceCount(0);
    [1, 2, 3, 4, 5].forEach((count, index) => {
      window.setTimeout(() => setEquipmentTraceCount(count), 520 * (index + 1));
    });
    setEquipmentFieldSources({});
    equipmentOptionGroups.forEach((group, index) => {
      window.setTimeout(() => {
        setIntakeSelections((current) => ({ ...current, [group.label]: group.options[0] }));
        setEquipmentFieldSources((current) => ({ ...current, [group.label]: group.source }));
      }, 760 * (index + 1));
    });
    window.setTimeout(() => {
      setAutoRecognizing(false);
      setAutoRecognized(true);
      setEquipmentTraceCount(5);
    }, 2850);
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
    setStage("record");
  }

  function buildRecordFromGuide() {
    if (triageAgentStatus === "running") return;
    runStageTransition("guide", guideTransitionAgents.length - 1, async () => {
      const result = await api.generateRecord();
      setRecord(result);
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
    if (pageId === "workbench" && !diagnosis && !record && stage !== "input") {
      setStage("home");
    }
  }

  function enterIntakeFromHome(value = homeDraft) {
    const nextInput = value.trim() || defaultInput;
    setInput(nextInput);
    setActivePage("workbench");
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
    window.setTimeout(() => {
      runStageTransition("intake", 0, () => setActiveIntakeStep(1));
    }, 180);
  }

  function jumpToPhase(phaseIndex) {
    if (triageAgentStatus === "running") return;
    setActiveTransition(null);
    setTriageAgentStatus("idle");
    setActivePage("workbench");
    if (phaseIndex === 0) setStage(stage === "home" ? "home" : "input");
    if (phaseIndex === 1 && diagnosis) setStage(stage === "analysis" ? "analysis" : "diagnosis");
    if (phaseIndex === 2 && diagnosis) setStage("guide");
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
    clearIntakeMaterials();
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
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
            <span><MapPin size={16} /> {currentUser.site || scenario?.site || "某输气场站"} · {currentUser.team}</span>
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
          <KnowledgeGraphPage graph={graph} evidence={evidence} />
        ) : activePage === "records" ? (
          <RecordPage record={record} onBuildRecord={buildRecord} />
        ) : activePage === "settings" ? (
          <SettingsPage currentUser={currentUser} onSave={setCurrentUser} />
        ) : stage === "home" ? (
          <HomeStage
            draft={homeDraft}
            userName={currentUser.name}
            materials={intakeMaterials}
            activeMaterialId={activeMaterialId}
            onDraft={setHomeDraft}
            onAddMaterials={addIntakeMaterials}
            onSelectMaterial={setActiveMaterialId}
            onRemoveMaterial={removeIntakeMaterial}
            onPreviewMaterial={setPreviewMaterialId}
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
              {stage === "input" && activeIntakeStep < 4 && (
                <InputStage
                  input={input}
                  materials={intakeMaterials}
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
              {stage === "input" && activeIntakeStep === 4 && (
                <IntakeSummaryStage
                  input={input}
                  materials={intakeMaterials}
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
                <RecordStage
                  record={record}
                  onApprove={approveExpertReview}
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
              intakeBranch={intakeBranch}
            />
          </section>
        )}
      </main>
      {previewMaterial && <MaterialPreviewModal material={previewMaterial} onClose={() => setPreviewMaterialId(null)} />}
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [account, setAccount] = useState("lishifu");
  const [password, setPassword] = useState("");

  function submitLogin(event) {
    event.preventDefault();
    onLogin(defaultUser);
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
        </form>
      </section>
    </main>
  );
}

function HomeStage({
  draft,
  userName,
  materials,
  activeMaterialId,
  onDraft,
  onAddMaterials,
  onSelectMaterial,
  onRemoveMaterial,
  onPreviewMaterial,
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
    { type: "document", title: "检修资料", detail: "工单与手册入口 · 后续接入", icon: Paperclip, enabled: false },
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
          <strong>某输气场站 · 站控区域</strong>
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
                const count = materials.filter((material) => material.type === item.type).length;
                return (
                  <button
                    className={classNames("collection-card", item.enabled && "enabled", count > 0 && "has-material")}
                    type="button"
                    key={item.title}
                    onClick={() => {
                      if (item.type === "image") imageInputRef.current?.click();
                      if (item.type === "video") videoInputRef.current?.click();
                      if (item.type === "audio") audioInputRef.current?.click();
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
  materials,
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

  return (
    <div className="stage-content intake-summary-stage">
      <header className="intake-summary-hero">
        <div>
          <p className="eyebrow">异常接入 · 摘要确认</p>
          <h2>接入摘要</h2>
          <p>现场信息已完成汇总。请在启动诊断前核对故障对象、现场材料和运行状态。</p>
        </div>
        <span className={branchBlocked ? "warning" : undefined}>
          {branchBlocked ? <AlertTriangle size={15} /> : <Check size={15} />}
          {branchBlocked ? "分支信息待补充" : "接入信息已就绪"}
        </span>
      </header>

      <div className="intake-summary-dashboard">
        <section className="summary-overview-card">
          <header><div><small>01 / 现场事件</small><h3>异常事件概览</h3></div><button onClick={() => onEdit(2)}>修改设备信息</button></header>
          <p className="summary-incident-text">{input || defaultInput}</p>
          <div className="summary-fact-grid">
            <p><span>设备型号</span><strong>{selections["设备型号"]}</strong></p>
            <p><span>设备角色</span><strong>{selections["设备角色"]}</strong></p>
            <p><span>关联告警</span><strong>{selections["关联告警"]}</strong></p>
            <p><span>故障位置</span><strong>控制中心 · 站控柜 A01</strong></p>
          </div>
        </section>

        <section className="summary-location-card">
          <header><div><small>02 / 故障位置</small><h3>某输气场站 · 控制中心 · 站控柜 A01</h3></div><button onClick={() => onEdit(1)}>修改</button></header>
          <div className="summary-location-map">
            <img src="/images/site-station-overview.png" alt="某输气场站控制中心站控柜 A01 故障点" />
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
          <div className={classNames("intake-branch-note", intakeBranch.tone)}>
            <span>{intakeBranch.label}</span>
            <strong>{intakeBranch.title}</strong>
            <p>{intakeBranch.detail}</p>
          </div>
        </section>
      </div>

      <footer className="intake-summary-launch">
        <div>
          <span>{branchBlocked ? "已识别非主演示诊断分支" : "诊断输入已准备完成"}</span>
          <strong>将基于 {materials.length} 项现场材料、1 个设备对象和 4 项运行参数，按“{intakeBranch.diagnosis}”启动多 Agent 会诊。</strong>
        </div>
        <button className="primary-button" onClick={onStart} disabled={loading || branchBlocked}>
          {loading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          {loading ? "正在启动诊断" : branchBlocked ? "需补充通信诊断案例" : "启动智能诊断"}
        </button>
      </footer>
    </div>
  );
}

function InputStage({
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

  return (
    <div className="stage-content input-stage dynamic-intake-stage">
      <div className="dynamic-intake-head">
        <div>
          <p className="eyebrow">异常接入 · Agent 动态接诊</p>
          <h2>现场接诊工作区</h2>
          <p>Agent 会根据现场输入，在当前页面逐步生成需要工程师确认的任务。</p>
        </div>
        <span className={classNames("intake-generation-state", intakeContinueRunning && "running", activeStep === 4 && "ready")}>
          {intakeContinueRunning ? <Loader2 size={14} className="spin" /> : activeStep === 4 ? <Check size={14} /> : <Radio size={14} />}
          {intakeContinueRunning ? "正在生成下一项任务" : activeStep === 4 ? "接入信息已就绪" : "等待现场确认"}
        </span>
      </div>

      <div className="dynamic-intake-board" data-active-step={activeStep}>
        <section className="dynamic-site-context">
          <div className="dynamic-site-toolbar">
            <div><Paperclip size={15} /><span>现场材料</span><strong>{materials.length > 0 ? `已接入 ${materials.length} 项` : "等待材料接入"}</strong></div>
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
          <div className="dynamic-symptom-strip">
            <span>现场描述</span>
            <p>{input || defaultInput}</p>
          </div>
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
                <small>修改后将重新运行接诊 Agent，并重新确认位置、设备、告警和接入摘要。</small>
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
                  <h3>{locationCompleted ? "某输气场站 · 控制中心 · 站控柜 A01" : "设备位置识别"}</h3>
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
                  <img src="/images/site-station-overview.png" alt="某输气场站控制中心站控柜 A01 故障点" />
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

          {activeStep >= 4 && (
            <section className="intake-floating-card intake-summary-card">
              <div className="intake-floating-head">
                <span>04</span>
                <div><small>接诊 Agent 汇总生成</small><h3>接入信息已就绪</h3></div>
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
      </div>
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
    "匹配设备台账：某输气场站 · 站控柜 A01。",
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
  const messages = [
    "正在解析现场描述、设备型号和故障现象...",
    "正在检索维修指导、阈值和历史知识条目...",
    "正在进行操作合规与安全要求校验...",
  ];
  const streamedItems = [
    ["读取现场描述：温度告警、风扇声音异常、前面板风扇转速偏低。", "识别设备上下文：ACP-4000 / IPC-610 工控机。", "初步判断进入散热异常诊断路径。"],
    ["检索 KB-001：ACP-4000 / IPC-610 散热系统结构。", "命中 KB-003：风扇 <500 rpm 告警阈值。", "命中 KB-004：系统温度与 CPU 温度判断条件。"],
    ["校验操作前置条件：断电、挂牌、防静电。", "确认拆检顺序：风道、滤网、风扇、恢复验证。", "形成可进入检修向导的安全边界。"],
  ];
  const progress = Math.min(100, Math.round((Math.max(0, activeAgentIndex) / agents.length) * 100));

  return (
    <div className="stage-content agent-run-stage">
      <div className="stage-copy">
        <p className="eyebrow">分析诊断</p>
        <h2>多 Agent 会诊进行中</h2>
        <p>系统正在按预设演示流程逐项分析。每个 Agent 完成后再进入下一项，全部完成后统一生成诊断结论。</p>
      </div>

      <div className="agent-run-workspace">
        <div className="run-progress-panel">
          <div className="progress-head">
            <strong>诊断执行进度</strong>
            <span>{progress}%</span>
          </div>
          <div className="progress-track">
            <div style={{ width: `${progress}%` }} />
          </div>
          <div className="execution-rail">
            {agents.map((agent, index) => {
              const done = index < activeAgentIndex;
              const running = index === activeAgentIndex;
              return (
                <div className={classNames("rail-step", done && "done", running && "running")} key={agent.name}>
                  <span>{done ? <Check size={14} /> : running ? <Loader2 size={14} className="spin" /> : index + 1}</span>
                  <p>{agent.name}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="agent-run-list">
          {agents.map((agent, index) => {
            const done = index < activeAgentIndex;
            const running = index === activeAgentIndex;
            return (
              <article className={classNames("agent-run-card", done && "done", running && "running")} key={agent.name}>
                <div className="agent-run-status">
                  {done && <Check size={18} />}
                  {running && <Loader2 size={18} className="spin" />}
                  {!done && !running && <span>{index + 1}</span>}
                </div>
                <div>
                  <strong>{agent.name}</strong>
                  <p>{done ? agent.content : running ? messages[index] || "正在分析..." : "等待上一个 Agent 完成"}</p>
                  {running && (
                    <div className="stream-lines">
                      {(streamedItems[index] || []).map((item, lineIndex) => (
                        <span style={{ animationDelay: `${lineIndex * 520}ms` }} key={item}>{item}</span>
                      ))}
                    </div>
                  )}
                </div>
                <span>{done ? "已完成" : running ? "运行中" : "等待中"}</span>
              </article>
            );
          })}
        </div>
      </div>

      <div className="analysis-waiting">
        <span className="pulse-dot" />
        <p>{activeAgentIndex >= agents.length ? "会诊完成，正在生成整版诊断结论..." : "请稍候，系统正在组织诊断依据。"}</p>
      </div>
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
            {transitionRunning ? "Agent 正在生成下一步" : "进入步骤式检修向导"} <ChevronRight size={16} />
          </button>
        )}
      </div>
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
        <button className="ghost-button reserved-action" title="演示按钮，后续接入专家电话会诊">
          <PhoneCall size={16} />
          专家电话会诊
          <span>预留</span>
        </button>
        <button className="ghost-button reserved-action" title="演示按钮，后续接入语音播报">
          <Volume2 size={16} />
          语音播报
          <span>预留</span>
        </button>
        <button className="ghost-button" onClick={onRecord} disabled={transitionRunning || !isLastGuideStep}>生成检修记录</button>
      </div>
    </div>
  );
}

function RecordStage({ record, onApprove, onBackGuide }) {
  if (!record) {
    return (
      <div className="stage-content">
        <h2>检修记录尚未生成</h2>
        <button className="ghost-button" onClick={onBackGuide}>返回检修向导</button>
      </div>
    );
  }

  return (
    <div className="stage-content record-stage">
      <div className="stage-copy">
        <p className="eyebrow">检修完成记录</p>
        <h2>{record.record_id}</h2>
        <p>{record.conclusion}</p>
      </div>
      <div className="record-grid">
        <article><span>设备</span><strong>{record.equipment}</strong></article>
        <article><span>故障</span><strong>{record.fault}</strong></article>
        <article><span>步骤完成</span><strong>{record.completed_steps.length} 项</strong></article>
        <article><span>专家状态</span><strong>{record.expert_status}</strong></article>
      </div>
      <div className="stage-actions">
        <button className="ghost-button" onClick={() => window.print()}>打印作业卡</button>
        <button className="primary-button" onClick={onApprove}>提交专家审核</button>
      </div>
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
  if (stage === "diagnosis" || stage === "guide") return 2;
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
                  visibleGuideSteps.map((step, index) => (
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

function RecordPage({ record, onBuildRecord }) {
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
  ].filter(Boolean);
  const [searchFault, setSearchFault] = useState("");
  const [detailRecordId, setDetailRecordId] = useState(null);
  const filteredRecords = records.filter((item) => item.fault.includes(searchFault.trim()));
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
              placeholder="搜索故障，例如：风扇、温度、滤网..."
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
                onClick={() => setDetailRecordId(item.id)}
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
      "请补充温度告警、风扇声音、前面板灯态，以及是否有现场图片或视频材料。",
      "请先核对系统匹配出的场站、控制中心和站控柜位置，确认后再生成设备信息任务。",
      `建议确认设备型号、设备角色和关联告警。当前重新评估结果：${intakeBranch?.detail || "等待字段确认"}`,
      intakeBranch?.id === "equipment-mismatch"
        ? "设备对象已修正为 PLC 控制柜，请核对控制器 RUN、通信 LINK、数据上送和电源状态。"
        : `重点核对 TEMP/FAN、风扇转速、系统温度和 CPU 温度。当前分支：${intakeBranch?.diagnosis || "等待运行值确认"}`,
      `接入信息确认后，将按“${intakeBranch?.diagnosis || "当前诊断方向"}”启动多 Agent 会诊。`,
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
    label: "辅助对话",
    suggestion: "先描述现场现象，我会辅助补充信息并解释当前步骤。",
  };
}

function getAssistantReply(stage, activeIntakeStep, analysisSubStep, currentStep, message) {
  const text = message.trim();
  if (stage === "input") {
    if (activeIntakeStep === 0) return "建议把现象拆成三类记录：告警灯态、声音/转速、温度变化。当前演示会优先识别为工控机散热异常。";
    if (activeIntakeStep === 1) return "当前先确认位置匹配结果：某输气场站、控制中心、站控柜 A01。位置确认后系统再读取该机柜的设备台账。";
    if (activeIntakeStep === 2) return "本步建议确认设备型号为 ACP-4000 / IPC-610，再补充工控机角色和 TEMP/FAN 关联告警。";
    if (activeIntakeStep === 3) return "阈值可以先按演示值填写：风扇 <500 rpm、系统温度 >55°C、CPU 温度 >70°C。后续接 API 后可由设备数据自动带入。";
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
  intakeBranch,
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
  const timersRef = useRef([]);

  function clearAssistantTimers() {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
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
    return clearAssistantTimers;
  }, [context.label, context.suggestion]);

  function sendMessage() {
    const text = draft.trim();
    if (!text || thinking || streaming) return;

    const userMessage = { id: `user-${Date.now()}`, role: "user", text };
    const reply = buildMaintenanceAnswer(text) || getAssistantReply(stage, activeIntakeStep, analysisSubStep, currentStep, text);
    const replyId = `assistant-${Date.now()}`;
    const evidenceItems = [
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

    evidenceItems.forEach((_, index) => {
      const timer = window.setTimeout(() => {
        setMessages((current) => current.map((message) => (
          message.id === replyId
            ? { ...message, evidenceVisibleCount: index + 1 }
            : message
        )));
      }, 900 + index * 520);
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
        }
      }, 700 + index * 34);
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
        <div>
          <strong>辅助对话</strong>
          <span>{context.label}</span>
        </div>
      </div>
      <div className="assistant-body">
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
                <p>{triageStatus === "running" && <i className="stream-cursor" />}</p>
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
