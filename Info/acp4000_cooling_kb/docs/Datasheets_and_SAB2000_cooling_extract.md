# 规格书与 SAB-2000 手册 — 散热/风扇/滤网相关内容抽取（4 合 1）

> 抽取日期：2026-07-06。本文件为围绕散热故障场景的节选抽取，完整内容以官方 PDF 为准。

---

## 一、ACP-4000 Datasheet（2025-03-17 版）

来源直链：https://advdownload.advantech.com.cn/productfile/PIS/ACP-4000/file/ACP-4000_DS%28031725%2920250317150019.pdf
来源页：https://www.advantech.com.cn/zh-cn/products/1-2jkd4b/acp-4000/mod_2d8ca4a0-dff9-4f0b-950b-0b65c000d9eb

### 特性（Features）
- Quiet 4U 上架式机箱，带**可视与声音告警通知**。
- LED 指示灯 + 告警通知用于系统故障检测。
- **低噪声 PWM 控制系统风扇**。
- **内置 Intelligent System Module**，支持整机风扇控制与远程管理。

### 散热规格
- 冷却风扇：**2 × 12 cm PWM 风扇，每个 82 CFM**。
- 空气过滤网：有。
- LED：Power、HDD、temperature、fan、电源电压状态。
- 智能模块硬件监控：CPU/系统风扇转速、CPU/系统温度（**仅研华 AIMB-78X、PCE-51XX/71XX 主板可启用 CPU 风扇转速与温度监控功能**）。
- 工作温度 0 ~ 40°C；湿度 10 ~ 85% @40°C 非凝结。

### 前视图标注要素
两个 82 CFM 冷却风扇、系统复位按钮、**报警复位按钮（Alarm reset button）**、PS/2、USB、电源开关、3×5.25" 驱动位、1×3.5" 内置硬盘位。

### 包装清单中的散热相关备件（本故障关键备件号）
| 料号 | 描述 | 数量 |
|---|---|---|
| **1750008561-01** | system fan 系统风扇 | 2 |
| 1700030260-01 | 系统风扇线（MB 母板版） | 2 |
| 1700029691-01 | 系统风扇线（BP 底板版） | 2 |
| **2130006147S000** | Door filter 门滤网 97.6 × 36.6 × 5 mm | 2 |
| **2130004803S000** | Fan filter 风扇滤网 115 × 195 × 5 mm | 1 |
| 1960002462 | 钥匙组（前门锁） | 1 |

### 订货信息（电源与本故障无关，仅记录整机料号线索）
ACP-4000BP-30F / BP-50F / MB-30F / MB-50F / MB-70F（300/500/700W ATX 单电源）。

---

## 二、IPC-610-H Datasheet（2022-10-06 版）

来源直链：https://advdownload.advantech.com/productfile/PIS/IPC-610-H/file/IPC-610-H_DS%28100622%2920221007094417.pdf
来源页：https://www.advantech.com/en-us/products/1-2jkd4b/ipc-610-h/mod_a8079bea-60a9-4791-a776-e8f7ff1b9dd6

### 特性
- 4U 机箱，带**可视告警通知**（无声音告警模块）。
- **双前置可维护带滤网冷却风扇（Dual front-accessible filtered cooling fans）**，提供优化气流。
- 前面板 LED 指示电源状态与 HDD 活动。
- **可上锁前门**防止未授权访问（检修需备钥匙）。

### 散热规格
- 冷却风扇：**2 × 12 cm，82 CFM/个**（非 PWM 标注）。
- 空气过滤网：有。
- LED：Power、HDD、电源电压状态（**无 TEMP/FAN 灯**）。
- 前视图标注：**Two easy-to-maintain fans（两个易维护风扇）**、Hold-down clamp、电源开关等。
- 工作温度 0 ~ 40°C。

### 备件（Spare Parts）——与 ACP-4000 通用
| 料号 | 描述 |
|---|---|
| **2130006147S000** | Door filter 门滤网 97.6 × 36.6 × 5 mm |
| **2130004803S000** | Fan filter 风扇滤网 115 × 195 × 5 mm |

---

## 三、IPC-610-L / IPC-611 Datasheet（2022-10-06 版）

来源直链：https://advdownload.advantech.com.cn/productfile/PIS/IPC-610-L/file/IPC-610-L_611_DS%28100622%2920221007094515.pdf
来源页：https://www.advantech.com.cn/zh-cn/products/1-2jkd4b/ipc-610-l/mod_f4efadf3-2fcb-4a2e-bd71-35e5fabb5849

### 特性
- 4U 15 槽机箱，**前部可达风扇（Front-Accessible Fan）**。
- **前部可达空气滤网，便于系统维护（Front-accessible air filter for easy system maintenance）**。
- 图示标注：**Easy-to-replace cooling fan and filter（易更换的冷却风扇与滤网）**。
- 可上锁前门。

### 散热规格
- 冷却风扇：**1 × 12 cm，82 CFM**（注意：L 型只有 1 个风扇，单点失效风险更高）。
- 空气过滤网：有。
- LED：**仅 Power 与 HDD**（无 TEMP/FAN 灯，无告警模块）。
- 工作温度 0 ~ 40°C。

### 备件（Spare Parts）——注意与 H 型料号不同
| 料号 | 描述 |
|---|---|
| **2130006149S000** | Fan filter 风扇滤网 127 × 127 × 5 mm |
| **2130004802S000** | Door filter 门滤网 142 × 97 × 5 mm |

---

## 四、SAB-2000 Intelligent System Alarm Board Startup Manual Ed.2（2015-10 印刷）

来源直链：https://advdownload.advantech.com/productfile/Downloadfile2/1-14RXHXX/SAB-2000_Startup%20Manual_Ed.2.pdf
来源页：https://www.advantech.com/en-us/support/details/manual?id=1-14RXBUM
适用：ACP-4000 智能告警板（Intelligent System Module 的独立文档，Part No. 2002S20001）

### 关键规格
- 风扇转速监控：最多 7 路，**量程 0 ~ 20000 RPM**。
- 温度：LM75 数字温度传感器，最多 4 路外接热敏电阻（TR1~TR4），-30 ~ +125°C。
- 内置蜂鸣器 + LED 告警；**自动智能风扇控制（Automatic smart fan control）**。
- 远程监控经 **SUSIAccess**（Ed.6 手册中已更新为 Device/On），可远程复位、开关机。

### 告警判据（LED & Beep 表，与 Ed.6 手册 Table 4.1 一致）
- FAN Normal：**>500 rpm**。
- CPU FAN fail：**<500 rpm** → LED 常亮报警（Warn）+ 持续蜂鸣。
- System fan fail：**<500 rpm** → LED 闪烁报警（Blinking Warn）+ 持续蜂鸣。
- TEMP Normal：—。
- CPU thermal fail：**>70°C** → 常亮报警 + 持续蜂鸣。
- System thermal fail（Thermistor）：**>55°C** → 闪烁报警 + 持续蜂鸣。
- Alarm Reset：按下后**静音 3 分钟**。
- Other：**Power off when system fail（仅 ATX）**，故障部位 LED 报警——系统故障时可配置断电保护。
- 注：LED 颜色因机箱不同可能有差别。

### 接线与开关要点
- **FAN1~FAN7 必须按顺序接线**：两个风扇必须接 FAN1 与 FAN2；顺序错误告警功能异常。
- SW1 Pin4~6 配置系统风扇数量（Disable ~ 7 个）；SW1 Pin7~9 配置温度传感器数量（Disable ~ 4 个）；**SW10：OFF=启用 Smart Fan，ON=禁用**。

---

## 五、公开检索缺口声明（2026-07-06 复核）

1. 研华官方**未公开**独立的 ACP-4000 / IPC-610 维修手册（Service/Maintenance Manual）——维护信息由用户手册 + 规格书 + SAB-2000 手册组合覆盖。
2. 官方支持站**未检索到**机箱级"风扇/滤网/温度"专题 FAQ 或 Knowledge Base 文章（仅有通用 CPU Fan Reference List 等非本机箱专属条目）。
3. 官方**未给出**滤网清洁、风扇更换的周期性维护建议数值。
4. 官方**无** ACP-4000 / IPC-610 机箱级 firmware/driver 公开下载包（软件生态为 Device/On、SUSIAccess、GitHub ADVANTECH-Corp/SUSI，属邻近资料）。
