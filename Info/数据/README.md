# 工业计算机厂家官方手册资料说明

本目录收录 7 份 Rockwell Automation（Allen-Bradley）和 Schneider Electric 工业计算机官方资料，主要用于设备识别、安装接线、运行维护、故障诊断和维修案例编写。

## 使用说明

- 下文页码均为 **PDF 文件页序**，便于直接跳转；个别手册的纸面页码可能与 PDF 页序略有差异。
- 文件名中的中文是资料整理名称，手册正文语言见各条目的“语言”。
- 同品牌、同产品系列手册可直接用于型号参数和接口定位；跨品牌手册仅建议参考故障机理、排查方法和安全流程，不能替代目标型号的电气参数、端子定义、备件号或拆装步骤。
- 编写案例时，应优先引用目标设备手册，再用其他厂家的资料补充通用诊断思路，并明确标注“跨品牌参考”或“工程推导”。

## 快速索引

| 文件 | 设备范围 | 版本/日期 | 页数 | 最适合查询的内容 |
|---|---|---:|---:|---|
| [Rockwell-6177R 机架式工控机用户手册](<./Rockwell-6177R 机架式工控机用户手册.pdf>) | 6177R 750R、1450R 无显示工业计算机 | 6177R-UM002F-EN-P，2018-05 | 100 | AC 供电、机架安装、部件更换、PSU 更换、UEFI、硬件诊断 |
| [Rockwell-6300B-EW1 / 6300P-EW1 用户手册](<./Rockwell-6300B-EW1  6300P-EW1 入门级工业计算机  用户手册.pdf>) | ASEM 6300B-EW1 Box PC、6300P-EW1 Panel PC | 6300-UM003B-EN-P，2025-10 | 84 | 24 V DC 接线、端子与极性、UPS/关机信号、LED、启动方式、维护与故障排查 |
| [VersaView 安装与故障排查指南](<./rockwell-VersaView安装与故障排查指南.pdf>) | 早期 VersaView 工业计算机和显示器 | VV-TG001A-EN-P，2005-11 | 14 | 电源质量、温升、非受控断电、浪涌/跌落/噪声、诊断与预防维护 |
| [VersaView 用户手册](<./rockwell-VersaView用户手册.pdf>) | VersaView 5000，含 5200/5400，目录号 6200P/6200T/6200V | 6200-UM001D-EN-P，2020-04 | 72 | AC/DC 供电、安装、UEFI、硬件监控、故障排查、清洁和附件安装 |
| [Harmony P6 Basic 用户手册](<./Schneider Electric-Harmony P6 Basic用户手册.pdf>) | Harmony P6 基本型主机及面板型设备 | EIO0000005086.02，2026-02 | 146 | 中文规格、LED、DC 接线、接地、存储/内存更换、系统监控、备份恢复 |
| [Harmony Rack iPC 用户手册](<./Schneider Electric-Harmony Rack iPC用户手册.pdf>) | Rack iPC Optimized、Universal、Performance | EIO0000001755_05，2021-10 | 202 | AC 与冗余电源、机架结构、BIOS、存储/内存/扩展卡、系统监控和维护 |
| [Magelis S-Box iPC 用户手册](<./Schneider Electric-Magelis S-Box iPC用户手册.pdf>) | Magelis S-Box iPC Optimized、Universal | EIO0000001750.01，2016-12 | 150 | DC 供电、接地、接口、BIOS、存储与扩展卡、系统监控和维护 |

## 1. Rockwell 6177R 机架式工控机用户手册

**文件：** [Rockwell-6177R 机架式工控机用户手册.pdf](<./Rockwell-6177R 机架式工控机用户手册.pdf>)  
**官方标题：** *Non-display Industrial Computers User Manual*  
**发布号：** 6177R-UM002F-EN-P  
**日期：** 2018 年 5 月  
**语言：** 英文  
**适用设备：** Allen-Bradley 6177R 系列无显示工业计算机，重点包括 750R 和 1450R 机型，对应 6177R-MM、6177R-RM 等目录号。

### 主要内容

- 设备特性、硬件接口、状态指示灯和系统板：PDF 9-16 页。
- 安装环境、安装间距、尺寸、机架/机器安装和外设连接：PDF 17-26 页。
- AC 电源连接、功能接地和网络连接：PDF 27-28 页。
- 启动、重启、复位和关机：PDF 29-32 页。
- 拆装安全、硬盘、内存、RTC 电池和电源单元更换：PDF 33-48 页，其中 PSU 更换在 PDF 44-48 页。
- UEFI/BIOS、固件配置、诊断和 AMI 备份恢复：PDF 49-80 页。
- 硬件监控、系统故障排查、诊断、恢复默认值和清除 UEFI：PDF 81-86 页。
- 第二硬盘、I/O 固定架、扩展卡、滑轨和内存附件安装：PDF 87-96 页。

### 资料价值

适合编写 **机架式工控机无法上电、AC 输入异常、电源单元失效、存储故障、内存故障、RTC 电池故障、UEFI 配置异常** 等案例。其 PSU 更换流程和 6177R 硬件图仅适用于该系列，不应直接套用到 6300B/6300P。

## 2. Rockwell 6300B-EW1 / 6300P-EW1 用户手册

**文件：** [Rockwell-6300B-EW1  6300P-EW1 入门级工业计算机  用户手册.pdf](<./Rockwell-6300B-EW1  6300P-EW1 入门级工业计算机  用户手册.pdf>)  
**官方标题：** *ASEM 6300B-EW1 and 6300P-EW1 Entry Level Industrial Computers User Manual*  
**发布号：** 6300-UM003B-EN-P  
**日期：** 2025 年 10 月  
**语言：** 英文  
**适用设备：** ASEM 6300B-EW1 无显示 Box PC 和 6300P-EW1 一体化 Panel PC。

### 主要内容

- 产品目录号规则、外观、接口、扩展位、技术数据和尺寸：PDF 7-28 页。
- 安装安全、面板/墙装、接地与等电位连接：PDF 29-36 页。
- DC 电源要求、功耗、24 V DC 接线和以太网电缆固定：PDF 37-40 页。
- 后面板供电区、Power DC 连接器、UPS Tx/Rx 与 ATX/PS/SYS OFF 信号：PDF 42-47 页。
- 按钮、LED、上电方式、DIP 开关、手动启动、复位和关机：PDF 47-51 页。
- 系统镜像备份/恢复、Windows 11 升级、UEFI 更新和恢复出厂设置：PDF 53-64 页。
- BIOS/UEFI 设置与 Secure Boot：PDF 65-68 页。
- 维护安全、CFast、电池、机盖、扩展卡和前置 USB：PDF 69-78 页。
- 热报警、故障隔离、集成显示故障和系统默认选项：PDF 79-82 页。

### 资料价值

这是当前资料集中编写 **Rockwell 6300 系列供电系统故障案例** 的首要依据。它可支持以下内容：24 V DC 输入端子和极性定位、接地、Power/UPS/关机信号、LED 与启动状态、复电验证、维护前断电及故障隔离。

需注意：该手册只覆盖 **6300B-EW1/6300P-EW1 入门级机型**。其他 6300 系列外形相似也不能默认端子定义、功耗、扩展结构完全一致，必须先核对完整目录号。

## 3. Rockwell VersaView 安装与故障排查指南

**文件：** [rockwell-VersaView安装与故障排查指南.pdf](<./rockwell-VersaView安装与故障排查指南.pdf>)  
**官方标题：** *VersaView Installation and Troubleshooting Guide*  
**发布号：** VV-TG001A-EN-P  
**日期：** 2005 年 11 月  
**语言：** 英文  
**适用设备：** 文中列举早期 VersaView 6181P、6181F、6180W、6155R、6186M 等工业计算机和显示器。

### 主要内容

- 安装阶段的四类关键因素：供电、温度、应用备份和安装方式，PDF 2-7 页。
- 供电建议：受控关机、独立供电回路、避免电机/焊机等噪声源、正确接地及使用 UPS，PDF 3 页。
- 温度与机柜散热：间距、风道、机柜面积、通风/空调、滤网维护和 SSD 建议，PDF 4-5 页。
- 应用与存储：系统克隆、恢复介质、HDD/SSD 使用注意事项，PDF 6 页。
- 安装与抗振、防水、运输要求：PDF 7 页。
- VersaView 诊断工具及硬件测试：PDF 8 页。
- 供电故障专题：非受控断电、电压跌落、浪涌、谐波、噪声、支路容量和 UPS，PDF 9-10 页。
- DC 设备启动瞬间电流不足：手册指出部分 VersaView 设备上电浪涌可达 20 A、持续 5 ms，并建议使用电能质量分析仪或示波器确认启动期间电压是否保持在额定范围，PDF 10 页。该数值只可用于文中适用的 VersaView 设备，不能作为 6300B-EW1 的型号判据。
- 温度故障分析和硬盘、光驱、风扇、滤网、显示器预防维护：PDF 11-13 页。

### 资料价值

这是本目录中 **故障机理和排查思路最集中的专题资料**，特别适合补充供电质量故障案例的原因树和排查顺序，包括：异常断电、电压暂降/中断、瞬态浪涌、谐波与噪声、供电容量不足、接地不良及 UPS 选用。

由于资料较早，其中 Windows 事件说明、Ghost 克隆工具、Support CD 和旧型号信息具有历史性。用于新型号案例时，只能引用仍然成立的通用原理；具体电压、电流、事件码、工具和操作界面应以目标型号的现行手册为准。

## 4. Rockwell VersaView 5000 用户手册

**文件：** [rockwell-VersaView用户手册.pdf](<./rockwell-VersaView用户手册.pdf>)  
**官方标题：** *VersaView 5000 ThinManager Thin Clients and Industrial Computers User Manual*  
**发布号：** 6200-UM001D-EN-P  
**日期：** 2020 年 4 月  
**语言：** 英文  
**适用设备：** VersaView 5000 系列，包括 VersaView 5200 ThinManager 瘦客户机和 VersaView 5400 工业计算机，相关目录号为 6200P、6200T、6200V。

### 主要内容

- 5400 工业计算机与 5200 瘦客户机的硬件特性：PDF 9-16 页。
- 安装环境、危险场所要求、安装间距、尺寸、面板/VESA/无显示机型安装：PDF 17-30 页。
- DC 电源连接和 AC 电源选件：PDF 31-34 页。
- 启动、重启、关机与触摸屏注意事项：PDF 35-38 页。
- UEFI、硬件监控、系统镜像恢复和 UEFI 升级：PDF 39-46 页。
- 硬件监控、故障排查和系统默认值恢复：PDF 47-49 页。
- 显示器、进风口和散热片清洁：PDF 51-52 页。
- 各类安装板、DIN 导轨和机器安装附件：PDF 53-68 页。

### 资料价值

适合支持 **VersaView 5000 无法上电、AC/DC 电源接入、UEFI 异常、硬件监控告警、显示与安装问题**。其结构比 2005 年专题指南更新，但故障案例细节相对简洁，两份资料可配合使用。

## 5. Schneider Electric Harmony P6 Basic 用户手册

**文件：** [Schneider Electric-Harmony P6 Basic用户手册.pdf](<./Schneider Electric-Harmony P6 Basic用户手册.pdf>)  
**官方标题：** 《Harmony P6 基本型主机/型号 用户指南》  
**文档号：** EIO0000005086.02  
**日期：** 2026 年 2 月  
**语言：** 中文  
**适用设备：** Harmony P6 基本型主机模块及其面板型配置。

### 主要内容

- 型号、装箱内容、认证与标准：PDF 12-17 页。
- 主机/显示模块部件和 LED 指示：PDF 21-24 页。
- 电气、环境、结构、显示、触摸屏和接口规格：PDF 25-39 页。
- 尺寸、安装方式和面板开孔：PDF 40-55 页。
- DC 电源线准备、接线、电源注意事项和接地：PDF 56-59 页。
- M.2 SSD、SD 卡、DIMM 和可选通信接口安装：PDF 60-104 页。
- USB 电缆固定和前 USB 盖：PDF 105-109 页。
- 定期清洁检查、显示模块、安装垫圈、电池和背光灯维护：PDF 110-114 页。
- UEFI、Launcher、蜂鸣器、亮度、校准、电源、系统监视、备份和恢复：PDF 115-145 页。

### 资料价值

资料新、中文完整、图示和维护内容丰富，适合作为 **DC 供电、LED 状态、接地、存储、内存、显示、触摸、系统监控、备份恢复** 的跨品牌参考。用于 Rockwell 案例时，不能照搬 P6 的端子图、接口针脚、电压容差、报警阈值或拆装结构。

## 6. Schneider Electric Harmony Rack iPC 用户手册

**文件：** [Schneider Electric-Harmony Rack iPC用户手册.pdf](<./Schneider Electric-Harmony Rack iPC用户手册.pdf>)  
**官方标题：** 《Harmony Rack iPC - Optimized、Universal 和 Performance - 用户手册》  
**文档号：** EIO0000001755_05  
**日期：** 2021 年 10 月  
**语言：** 中文  
**适用设备：** Harmony Rack iPC Optimized、Universal 和 Performance 机架式工业计算机。

### 主要内容

- 产品包装、外观、LED/按钮、环境特性、尺寸和机架安装：PDF 15-48 页。
- 首次上电、接地、AC 电源线和冗余电源更换：PDF 49-60 页。
- BIOS 各菜单与系统配置：PDF 61-94 页。
- PCI/PCIe、存储、内存、串口、RAID 和智能风扇配置：PDF 95-126 页。
- PLC 连接、System Monitor、远程监控和通知中心：PDF 127-148 页。
- 重新安装、定期清洁和维护：PDF 149-160 页。
- 附件、主板、接口连接和跳线：PDF 161-200 页。

### 资料价值

适合研究 **机架式工控机 AC 供电、冗余电源、存储/RAID、风扇、主板接口、系统监控和远程告警**。对于 Rockwell 6177R，可借鉴机架式设备的通用检修逻辑，但所有电源模块、指示灯、主板接口和备件信息必须回到 6177R 手册确认。

## 7. Schneider Electric Magelis S-Box iPC 用户手册

**文件：** [Schneider Electric-Magelis S-Box iPC用户手册.pdf](<./Schneider Electric-Magelis S-Box iPC用户手册.pdf>)  
**官方标题：** 《Magelis S-Box iPC - Optimized 和 Universal - 用户手册》  
**文档号：** EIO0000001750.01  
**日期：** 2016 年 12 月  
**语言：** 中文  
**适用设备：** Magelis S-Box iPC Optimized 和 Universal 箱式工业计算机。

### 主要内容

- 产品包装、外观、环境特性、尺寸和安装：PDF 11-36 页。
- 首次上电、接地、DC 电源线和外部接口：PDF 37-54 页。
- 两类机型的 BIOS 设置：PDF 55-92 页。
- HDD/SSD、PCIe Mini、CFast/CompactFlash 等硬件维护：PDF 93-110 页。
- PLC 连接、System Monitor、远程监控和通知中心：PDF 111-132 页。
- 重新安装、定期清洁维护、附件和跳线：PDF 133-148 页。

### 资料价值

适合参考 **箱式工控机 DC 供电、接地、存储介质、扩展卡、系统监控和维护**。与 Rockwell 6300B 同属无显示箱式工业计算机，诊断流程具有一定通用性，但电源端子、极性图、额定值和机内结构不可跨型号复用。

## 按故障主题选用资料

| 故障/任务 | 首选资料 | 辅助资料 |
|---|---|---|
| Rockwell 6300B/6300P 无法上电、24 V DC 输入异常 | 6300B-EW1/6300P-EW1 用户手册 | VersaView 安装与故障排查指南；Harmony P6 Basic；Magelis S-Box iPC |
| 电压跌落、瞬态浪涌、噪声、谐波、异常断电 | VersaView 安装与故障排查指南 | 6300B/6300P 用户手册；6177R 用户手册 |
| Rockwell 6177R AC 输入或 PSU 故障 | 6177R 用户手册 | Harmony Rack iPC；VersaView 安装与故障排查指南 |
| 温度过高、风道堵塞、风扇/滤网问题 | VersaView 安装与故障排查指南 | VersaView 5000；Harmony Rack iPC；Harmony P6 Basic |
| LED、按钮、启动/复位/关机逻辑 | 目标型号用户手册 | 同品牌相近系列手册仅作解释辅助 |
| UEFI/BIOS、恢复默认值、系统镜像 | 目标型号用户手册 | VersaView 5000；Harmony P6 Basic |
| HDD/SSD/CFast、内存、RTC 电池 | 目标型号用户手册 | 6177R、Harmony P6 Basic、Harmony Rack iPC、Magelis S-Box iPC |
| 系统监控、远程告警、维护策略 | Harmony P6 Basic 或 Harmony Rack iPC | VersaView 5000；Magelis S-Box iPC |

## 建议的引用优先级

1. **型号完全一致的用户手册**：用于额定参数、接口定义、极性、灯态、拆装步骤和安全要求。
2. **同品牌同系列的官方资料**：用于补充工作原理、诊断工具和相近配置，但应核对目录号和版本。
3. **其他品牌官方手册**：只用于通用故障机理、测量方法和排查思路，并在案例中明确标注跨品牌参考。
4. **工程推导或现场经验**：当官方资料没有给出量化判据时，必须明确标为推导值，不能写成厂家规定。

---

整理日期：2026 年 7 月 13 日。上述说明依据本目录中 PDF 的封面、元数据、目录和正文内容整理。
