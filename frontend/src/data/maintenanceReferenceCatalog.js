const recommendedReferenceIds = new Set([
  "CASE-HIS-002",
  "KB-008",
  "DOC-ADVANTECH-ACP4000-IPC610-UM-ED6",
  "DOC-ADVANTECH-SAB2000-SM-ED2",
]);

const fallbackSource = {
  cases: [
    { id: "CASE-ACP4000-001", title: "站控柜 A01 工控机散热异常检修", equipment: "工控机", faultType: "散热异常", site: "山东德州分输站", cause: "滤网积尘与风扇低速共同造成温升。" },
    { id: "CASE-HIS-001", title: "工控机前门滤网积尘处理", equipment: "工控机", faultType: "散热异常", site: "历史案例库", cause: "滤网积尘造成风道阻力升高。" },
    { id: "CASE-HIS-002", title: "站控工控机风扇异响排查", equipment: "工控机", faultType: "风扇异常", site: "历史案例库", cause: "风扇老化导致异响与转速偏低。" },
    { id: "CASE-HIS-005", title: "控制柜环境温度偏高", equipment: "站控柜", faultType: "环境异常", site: "历史案例库", cause: "通风条件不足导致柜内温升。" },
    { id: "CASE-HIS-006", title: "冗余电源模块状态灯异常", equipment: "冗余电源模块", faultType: "电源异常", site: "历史案例库", cause: "供电链路间歇异常。" },
    { id: "CASE-HIS-009", title: "工控机启动后蜂鸣告警", equipment: "工控机", faultType: "启动异常", site: "历史案例库", cause: "启动自检触发蜂鸣告警。" },
  ],
  knowledge: [
    { id: "KB-008", title: "工控机风扇检查与更换", equipment: "工控机", faultType: "风扇异常", version: "1.1", summary: "结合告警、转速与温度阈值检查滤网、风道、风扇和接线。" },
    { id: "KB-003", title: "风扇低速告警阈值", equipment: "工控机", faultType: "风扇异常", version: "1.0", summary: "核对风扇转速与低速告警判断条件。" },
    { id: "KB-004", title: "系统与 CPU 温度判断条件", equipment: "工控机", faultType: "温度异常", version: "1.0", summary: "结合系统温度与 CPU 温度判断过热风险。" },
    { id: "KB-007", title: "门滤网与风道清理方法", equipment: "工控机", faultType: "散热异常", version: "1.0", summary: "规范清理滤网与风道并完成恢复确认。" },
    { id: "KB-010", title: "工控机整机异常与 POST 故障隔离", equipment: "工控机", faultType: "启动异常", version: "1.0", summary: "通过 POST 与外设隔离判断启动故障范围。" },
    { id: "KB-013", title: "HDD/SSD 存储健康与故障诊断", equipment: "工控机", faultType: "存储故障", version: "1.0", summary: "通过健康信息、诊断工具与备份判断介质风险。" },
    { id: "KB-015", title: "系统监控阈值、远程告警与事件日志", equipment: "工控机", faultType: "监控告警", version: "1.0", summary: "统一核对温度、风扇、电压、存储和网络监控对象。" },
    { id: "KB-018", title: "通信接口与外设故障隔离", equipment: "工控机", faultType: "通信与接口异常", version: "1.0", summary: "根据灯态、线缆、接口模式与逐一接回外设隔离问题。" },
  ],
  manuals: [
    { id: "DOC-ADVANTECH-ACP4000-IPC610-UM-ED6", manufacturer: "Advantech", title: "ACP-4000 / IPC-610 Series User Manual", publication: "Ed.6", pageCount: 50, productScope: ["工控机"], faultDomains: ["风扇", "滤网", "温度告警", "安全维护"] },
    { id: "DOC-ADVANTECH-SAB2000-SM-ED2", manufacturer: "Advantech", title: "SAB-2000 Intelligent System Alarm Board Startup Manual", publication: "Ed.2", pageCount: 3, productScope: ["智能告警模块"], faultDomains: ["风扇转速", "温度阈值", "FAN 接线", "远程监控"] },
    { id: "DOC-ROCKWELL-6177R-UM002F", manufacturer: "Rockwell Automation", title: "Non-display Industrial Computers User Manual", publication: "6177R-UM002F-EN-P", pageCount: 100, productScope: ["机架式工控机"], faultDomains: ["供电", "启动", "存储", "硬件诊断"] },
    { id: "DOC-ROCKWELL-VERSAVIEW-TG001A", manufacturer: "Rockwell Automation", title: "VersaView Installation and Troubleshooting Guide", publication: "VV-TG001A-EN-P", pageCount: 14, productScope: ["工业计算机与显示器"], faultDomains: ["温度", "风扇", "滤网", "显示"] },
    { id: "DOC-SCHNEIDER-RACK-1755-05", manufacturer: "Schneider Electric", title: "Harmony Rack iPC 用户手册", publication: "EIO0000001755_05", pageCount: 202, productScope: ["机架式工控机"], faultDomains: ["冗余电源", "智能风扇", "系统监控", "远程告警"] },
    { id: "DOC-SCHNEIDER-SBOX-1750-01", manufacturer: "Schneider Electric", title: "Magelis S-Box iPC 用户手册", publication: "EIO0000001750.01", pageCount: 150, productScope: ["箱式工控机"], faultDomains: ["供电", "接地", "存储", "通信接口"] },
  ],
};

function compact(values) {
  return values.filter(Boolean);
}

function normalizeCase(item) {
  return {
    key: `case:${item.id}`,
    id: item.id,
    type: "case",
    eyebrow: "历史案例",
    title: item.title,
    meta: compact([item.equipment, item.faultType]).join(" · "),
    tags: compact([item.faultType, item.site]).slice(0, 3),
    summary: item.cause || item.resolution || "已归档的现场检修经验，可用于相似异常对照。",
    recommended: recommendedReferenceIds.has(item.id),
  };
}

function normalizeKnowledge(item) {
  return {
    key: `knowledge:${item.id}`,
    id: item.id,
    type: "knowledge",
    eyebrow: `检修知识 · V${item.version || "1.0"}`,
    title: item.title,
    meta: compact([item.equipment, item.faultType]).join(" · "),
    tags: compact([item.faultType, item.verificationLevel]).slice(0, 3),
    summary: item.summary || `${item.equipment || "工控设备"}的${item.faultType || "通用"}检修知识。`,
    recommended: recommendedReferenceIds.has(item.id),
  };
}

function normalizeManual(item) {
  const productScope = Array.isArray(item.productScope) ? item.productScope : [];
  const faultDomains = Array.isArray(item.faultDomains) ? item.faultDomains : [];
  return {
    key: `manual:${item.id}`,
    id: item.id,
    type: "manual",
    eyebrow: "厂商手册",
    title: item.title,
    meta: compact([item.manufacturer, item.publication]).join(" · "),
    tags: faultDomains.slice(0, 3),
    summary: compact([productScope.join(" / "), item.pageCount ? `${item.pageCount} 页` : ""]).join(" · ") || "厂商原始技术资料。",
    recommended: recommendedReferenceIds.has(item.id),
  };
}

export function normalizeMaintenanceReferences({ cases = [], knowledge = [], manuals = [] } = {}) {
  return [
    ...cases.map(normalizeCase),
    ...knowledge.map(normalizeKnowledge),
    ...manuals.map(normalizeManual),
  ];
}

export const maintenanceReferenceFallback = normalizeMaintenanceReferences(fallbackSource);
