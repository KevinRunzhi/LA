#!/usr/bin/env bash
# =====================================================================
# 研华 ACP-4000 / IPC-610 散热故障知识库 — 官方 PDF 一键下载脚本
# 用法：bash download_official_pdfs.sh
# 说明：全部为 Advantech 官方直链（2026-07-06 已逐一验证可访问）。
#       Windows 用户可直接复制 URL 到浏览器下载。
# =====================================================================
set -e
mkdir -p official_pdfs && cd official_pdfs

# 1. 【核心】ACP-4000/IPC-610 Series User Manual Ed.6（2025-10，三语合并）
#    含：LED 告警表、风扇更换、滤网更换、智能系统模块阈值、分解图
wget -c -O "ACP-4000_IPC-610_User_Manual_Ed6.pdf" \
  "https://advdownload.advantech.com/productfile/Downloadfile2/1-34CUSNM/ACP-4000_IPC-610_Series_User_Manual%283-in-1%29_Ed.6_UPDATED.pdf"

# 2. ACP-4000 Datasheet（2025-03-17）— 风扇/滤网备件号、告警复位按钮位置
wget -c -O "ACP-4000_Datasheet_20250317.pdf" \
  "https://advdownload.advantech.com.cn/productfile/PIS/ACP-4000/file/ACP-4000_DS%28031725%2920250317150019.pdf"

# 3. IPC-610-H Datasheet（2022-10-06）— 双前置带滤网风扇、备件号
wget -c -O "IPC-610-H_Datasheet_20221006.pdf" \
  "https://advdownload.advantech.com/productfile/PIS/IPC-610-H/file/IPC-610-H_DS%28100622%2920221007094417.pdf"

# 4. IPC-610-L/IPC-611 Datasheet（2022-10-06）— 前置滤网、单风扇、专属备件号
wget -c -O "IPC-610-L_611_Datasheet_20221006.pdf" \
  "https://advdownload.advantech.com.cn/productfile/PIS/IPC-610-L/file/IPC-610-L_611_DS%28100622%2920221007094515.pdf"

# 5. SAB-2000 Startup Manual Ed.2（2015-10）— 告警阈值、FAN 接线顺序、Smart Fan 开关
wget -c -O "SAB-2000_Startup_Manual_Ed2.pdf" \
  "https://advdownload.advantech.com/productfile/Downloadfile2/1-14RXHXX/SAB-2000_Startup%20Manual_Ed.2.pdf"

# ------ 以下为可选历史版本（版本对照/老机型用，非必需）------
# 6. Ed.5 合并手册（2021-03）
wget -c -O "ACP-4000_IPC-610_User_Manual_Ed5.pdf" \
  "https://advdownload.advantech.com/productfile/Downloadfile1/1-227RWXD/ACP-4000_IPC-610_Series_User_Manual%283-in-1%29_Ed.5-FINAL.pdf" || echo "[可选] Ed.5 下载失败，可跳过"

# 7. ACP-4000 老版手册 Ed.1（2002-01，含早期报警板章节）
wget -c -O "ACP-4000_Manual_Ed1_2002.pdf" \
  "https://advdownload.advantech.com/productfile/Downloadfile2/1-OBO0GL/ACP-4000_ed1.pdf" || echo "[可选] Ed.1 下载失败，可跳过"

# 8. IPC-610-H 老版手册 Ed.1（2002-07）
wget -c -O "IPC-610-H_Manual_Ed1_2002.pdf" \
  "https://advdownload.advantech.com/productfile/Downloadfile5/1-NURZ1/IPC-610-H_Manual_ed1.pdf" || echo "[可选] IPC-610-H Ed.1 下载失败，可跳过"

echo ""
echo "下载完成。文件位于 ./official_pdfs/"
ls -lh
