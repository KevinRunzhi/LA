export const defaultInput =
  "站控柜内工控机温度告警，风扇声音异常，前面板风扇转速很低。";

export const fallbackScenario = {
  id: "oil-gas-station-acp4000-cooling",
  site: "山东德州分输站",
  cabinet: "站控柜 A01",
  equipment: "研华 ACP-4000 / IPC-610 工控机",
  fault: "高温告警 / 风道堵塞 / 散热异常",
  default_input: defaultInput,
  thresholds: [
    { label: "系统风扇转速", value: "< 500 rpm 判定异常" },
    { label: "系统温度", value: "> 55°C 判定过高" },
    { label: "CPU 温度", value: "> 70°C 判定过高" },
    { label: "环境温度", value: "≤ 40°C" },
    { label: "恢复观察", value: "≥ 10 分钟" },
  ],
};

export const fallbackDiagnosis = {
  title: "一次工控机散热相关异常",
  summary: "根据现场描述，当前异常优先判断为站控柜工控机散热异常，可能与风道堵塞、滤网积尘、风扇低速或接线异常有关。",
  risk: "长时间高温可能影响数据上传稳定性、告警可靠性和工控机运行连续性。",
  recommended_action: "进入步骤式检修向导，先确认告警与安全条件，再检查风道、滤网、风扇和恢复验证。",
  agents: [
    { name: "分析诊断 Agent", status: "已完成", content: "优先检查风道堵塞、滤网积尘和风扇异常。" },
    { name: "操作合规 Agent", status: "已完成", content: "拆检前必须通知负责人、正常关机、拔除电源并佩戴防静电手环。" },
    { name: "知识检索 Agent", status: "已完成", content: "命中 TEMP/FAN 告警、风扇转速 <500 rpm、系统温度 >55°C、CPU 温度 >70°C 等依据。" },
  ],
  step_options: [
    "确认告警与定位设备",
    "执行安全准备",
    "检查机柜环境与风道",
    "检查滤网、风扇和接线",
    "恢复运行与验证",
  ],
};

export const fallbackGuideSteps = [
  {
    id: "step-01-location",
    order: 1,
    title: "确认告警与定位设备",
    placeholder: "step-01-location",
    description: "记录 TEMP/FAN 灯状态、蜂鸣器状态、风扇转速、系统温度、CPU 温度和站控柜位置。",
    checks: ["TEMP/FAN 灯状态", "蜂鸣器状态", "风扇 rpm", "系统/CPU 温度", "站控柜位置"],
    safety: "仅做外观和状态确认，不进行拆检。",
    thresholds: ["风扇 < 500 rpm", "系统温度 > 55°C", "CPU 温度 > 70°C"],
    source: "ACP-4000 / IPC-610 散热异常维修指导",
  },
  {
    id: "step-02-safety",
    order: 2,
    title: "执行安全准备",
    placeholder: "step-02-safety",
    description: "通知值班负责人，正常关闭操作系统，拔除所有电源线，等待冷却并佩戴防静电手环。",
    checks: ["通知负责人", "正常关机", "拔除所有电源", "等待冷却", "防静电"],
    safety: "禁止带电拆装任何部件，拆线前拍照记录 FAN1/FAN2 顺序。",
    thresholds: [],
    source: "现场检修安全要求",
  },
  {
    id: "step-03-airflow",
    order: 3,
    title: "检查机柜环境与风道",
    placeholder: "step-03-airflow",
    description: "检查环境温度、进风口、出风口和机箱开孔是否被遮挡。",
    checks: ["环境温度 ≤ 40°C", "进风口无遮挡", "出风口无遮挡", "机箱开孔无遮挡"],
    safety: "保持设备断电状态下检查风道与遮挡物。",
    thresholds: ["环境温度 ≤ 40°C"],
    source: "ACP-4000 / IPC-610 工作环境要求",
  },
  {
    id: "step-04-filter-fan",
    order: 4,
    title: "检查滤网、风扇和接线",
    placeholder: "step-04-filter-fan",
    description: "检查门滤网、风扇滤网积尘，确认风扇是否异响、停转、低速，并核对 FAN1/FAN2 接线顺序。",
    checks: ["门滤网积尘", "风扇滤网积尘", "风扇异响/停转/低速", "FAN1/FAN2 顺序"],
    safety: "拆装风扇或线缆前必须断电并保留照片记录。",
    thresholds: ["风扇 < 500 rpm 判定异常"],
    source: "ACP-4000 / IPC-610 User Manual Ed.6 · 第 24、25、27 页",
  },
  {
    id: "step-05-verify",
    order: 5,
    title: "恢复运行与验证",
    placeholder: "step-05-verify",
    description: "装回滤网、锁闭前门、恢复供电并观察 TEMP/FAN 状态、风扇转速、温度和数据上传。",
    checks: ["TEMP/FAN 告警解除", "风扇 > 500 rpm", "系统 ≤ 55°C", "CPU ≤ 70°C", "数据上传稳定"],
    safety: "恢复后连续观察不少于 10 分钟。",
    thresholds: ["风扇 > 500 rpm", "系统 ≤ 55°C", "CPU ≤ 70°C", "观察 ≥ 10 分钟"],
    source: "恢复运行确认清单",
  },
];

export const fallbackEvidence = [
  { id: "KB-001", title: "ACP-4000 / IPC-610 散热系统结构", step: "步骤 1、3、4" },
  { id: "KB-002", title: "TEMP/FAN LED 与蜂鸣告警含义", step: "步骤 1" },
  { id: "KB-003", title: "风扇 <500 rpm 告警阈值", step: "步骤 1、5" },
  { id: "KB-004", title: "系统温度 >55°C 与 CPU >70°C 告警阈值", step: "步骤 1、5" },
  { id: "KB-005", title: "环境工作温度 0~40°C", step: "步骤 3" },
  { id: "KB-006", title: "断电、防静电和禁止带电拆装要求", step: "步骤 2" },
  { id: "KB-007", title: "门滤网与风扇滤网检查清理方法", step: "步骤 4" },
  { id: "KB-008", title: "风扇更换与 FAN1/FAN2 接线顺序", step: "步骤 4" },
  { id: "KB-009", title: "恢复运行确认清单", step: "步骤 5" },
  { id: "KB-010", title: "异常升级条件", step: "步骤 5" },
];

export const fallbackGraph = [
  { source: "输气场站", relation: "包含", target: "站控柜" },
  { source: "站控柜", relation: "包含", target: "工控机" },
  { source: "工控机", relation: "包含", target: "风道" },
  { source: "工控机", relation: "包含", target: "滤网" },
  { source: "工控机", relation: "包含", target: "风扇" },
  { source: "工控机", relation: "发生", target: "高温告警" },
  { source: "高温告警", relation: "可能原因", target: "风道堵塞" },
  { source: "高温告警", relation: "可能原因", target: "滤网积尘" },
  { source: "高温告警", relation: "可能原因", target: "风扇异常" },
  { source: "风扇异常", relation: "判断依据", target: "风扇转速 <500 rpm" },
  { source: "高温告警", relation: "判断依据", target: "系统温度 >55°C" },
  { source: "高温告警", relation: "判断依据", target: "CPU 温度 >70°C" },
  { source: "恢复验证", relation: "要求", target: "连续观察 ≥10 分钟" },
];

export const fallbackExpertReview = {
  id: "EXP-001",
  status: "approved",
  title: "沙尘环境滤网维护周期修正",
  content: "沙尘环境下，站控柜工控机滤网维护周期应从季度检查缩短为月度检查。恢复运行后需观察数据上传稳定不少于 10 分钟。",
  tag: "专家修正 · 已审核",
};

export function buildFallbackRecord(completedSteps) {
  return {
    record_id: "REC-ACP4000-001",
    equipment: fallbackScenario.equipment,
    fault: fallbackScenario.fault,
    completed_steps: completedSteps,
    thresholds: fallbackScenario.thresholds,
    safety_confirmed: completedSteps.some((step) => step.id === "step-02-safety"),
    conclusion: "疑似风道堵塞、滤网积尘或风扇低速导致散热异常，建议完成清理、接线核对和恢复观察。",
    expert_status: "待审核",
  };
}
