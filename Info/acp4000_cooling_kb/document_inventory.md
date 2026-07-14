# 文档清单 — ACP-4000 / IPC-610 散热异常（滤网堵塞与风扇异常）知识库

> 核对日期：2026-07-06。"已获取"指本次已抓取全文并生成抽取文件；原始 PDF 请运行 `scripts/download_official_pdfs.sh` 下载。

| 序号 | 文档名称 | 建议文件名 | 来源网址 | 是否官方 | 适用型号 | 文档类型 | 与本故障的关系 | 是否已获取 |
|---|---|---|---|---|---|---|---|---|
| 1 | ACP-4000/IPC-610 Series User Manual Ed.6（2025-10） | ACP-4000_IPC-610_User_Manual_Ed6.pdf | 直链：advdownload.advantech.com/productfile/Downloadfile2/1-34CUSNM/…Ed.6_UPDATED.pdf；来源页：advantech.com.cn/zh-cn/support/details/manual?id=1-OEBIKC | 官方 | ACP-4000 / IPC-610-H / IPC-610-L / IPC-611 | 用户手册（含维护章节） | **核心依据**：Table 3.1 LED 含义（p15）、3.3 更换风扇（p16）、3.4 更换滤网（p17）、Table 4.1 告警阈值（p23）、FAN 接线顺序（p24）、Smart Fan 开关（p25）、分解图（p30-32）、安全指示 | ✅ 已抓取全文 |
| 2 | ACP-4000 Datasheet（2025-03-17） | ACP-4000_Datasheet_20250317.pdf | 直链：advdownload.advantech.com.cn/productfile/PIS/ACP-4000/file/ACP-4000_DS(031725)….pdf；来源页：ACP-4000 中国产品页 | 官方 | ACP-4000 | 规格书 | 2×12cm PWM 82CFM 风扇、滤网备件号 2130006147S000/2130004803S000、系统风扇 1750008561-01、报警复位按钮位置、0-40°C 工作温度 | ✅ 已抓取全文 |
| 3 | IPC-610-H Datasheet（2022-10-06） | IPC-610-H_Datasheet_20221006.pdf | 直链：advdownload.advantech.com/productfile/PIS/IPC-610-H/…pdf；来源页：IPC-610-H 全球产品页 | 官方 | IPC-610-H | 规格书 | 双前置带滤网可维护风扇、备件号与 ACP-4000 通用、无 TEMP/FAN 灯（诊断路径不同） | ✅ 已抓取全文 |
| 4 | IPC-610-L/IPC-611 Datasheet（2022-10-06） | IPC-610-L_611_Datasheet_20221006.pdf | 直链：advdownload.advantech.com.cn/productfile/PIS/IPC-610-L/…pdf；来源页：IPC-610-L 中国产品页 | 官方 | IPC-610-L / IPC-611 | 规格书 | 前置可达滤网/易更换风扇（单风扇）、专属滤网备件 2130006149S000/2130004802S000 | ✅ 已抓取全文 |
| 5 | SAB-2000 Startup Manual Ed.2（2015-10） | SAB-2000_Startup_Manual_Ed2.pdf | 直链：advdownload.advantech.com/productfile/Downloadfile2/1-14RXHXX/…pdf；来源页：advantech.com/en-us/support/details/manual?id=1-14RXBUM | 官方 | ACP-4000（告警板） | 智能告警板启动手册 | 风扇 <500rpm / 系统温度 >55°C / CPU >70°C 阈值最集中表述、0~20000RPM 量程、FAN 接线顺序、Smart Fan、ATX 故障断电 | ✅ 已抓取全文 |
| 6 | ACP-4000/IPC-610 User Manual Ed.5（2021-03） | ACP-4000_IPC-610_User_Manual_Ed5.pdf | 直链：advdownload.advantech.com/productfile/Downloadfile1/1-227RWXD/…Ed.5-FINAL.pdf（仅 PDF 直链，无稳定来源页） | 官方 | 同 Ed.6 | 用户手册（旧版） | 版本对照、老库存机型 | 可选，脚本含 |
| 7 | ACP-4000 User's Manual Ed.1（2002-01） | ACP-4000_Manual_Ed1_2002.pdf | 直链：advdownload.advantech.com/productfile/Downloadfile2/1-OBO0GL/ACP-4000_ed1.pdf | 官方 | 早期 ACP-4000 | 历史手册 | 早期报警说明（PWR 红=冗余电源故障等）；本故障仅作历史参照 | 可选，脚本含 |
| 8 | IPC-610-H User's Manual Ed.1（2002-07） | IPC-610-H_Manual_Ed1_2002.pdf | 直链：advdownload.advantech.com/productfile/Downloadfile5/1-NURZ1/IPC-610-H_Manual_ed1.pdf | 官方 | 早期 IPC-610-H | 历史手册 | 老机型装配参照 | 可选，脚本含 |
| 9 | ACP-4000/IPC-610 独立维修手册（Service Manual） | — | — | — | — | — | **官方未公开完整维修手册**——经产品页、支持下载页、公开索引复核，维修信息由 1+2+3+4+5 组合覆盖 | ❌ 不存在公开版本 |
| 10 | 机箱级风扇/滤网/温度 FAQ 或 KB 文章 | — | advantech.com/en-us/support/（支持站） | — | — | — | **未检索到本机箱专属公开 FAQ**（仅通用 CPU Fan Reference List 等非专属条目）；如需可走 MyAdvantech/工单 | ❌ 未找到公开版本 |
| 11 | 官方明示的滤网清洁/风扇更换维护周期 | — | — | — | — | — | **官方文档未明确给出维护周期**，需按现场粉尘环境自定（可作为"专家经验回流"演示点） | ❌ 官方未提供 |

## 已生成的知识库源文件（本文件夹内）

| 文件 | 内容 |
|---|---|
| docs/ACP4000_IPC610_User_Manual_Ed6_cooling_extract.md | Ed.6 手册散热相关章节全量抽取（含页码定位） |
| docs/Datasheets_and_SAB2000_cooling_extract.md | 三份规格书 + SAB-2000 手册散热相关抽取（4 合 1） |
| ACP4000_IPC610_cooling_fault_repair_guide.md | 最终介绍文档（选题背景→检修流程→作业卡→比赛拆分） |
| scripts/download_official_pdfs.sh | 官方 PDF 一键下载脚本（8 个直链） |
