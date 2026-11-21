#!/usr/bin/env python3
"""阿幫吉祥物（藍鵲，App 內）與 App 圖示（Λ 標誌）產生器（單一來源）。輸出到 public/brand/ 與 public/icons/icon.svg。
吉祥物正式版請由插畫師重繪；此檔維持顏色與比例規範一致。"""
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
C = dict(blue='#3B82C4', tail='#2E6FB7', navy='#1F2A44', belly='#EAF3FB', red='#E24B4A',
         blush='#F4C0D1', teal='#0F766E', mint='#E1F5EE', yellow='#FBBF24', coral='#F0997B',
         glow='#5EEAD4', deep='#134E4A')
# 2026-11-20 agent 感（Austin：「藍鵲可以改成 agent 感嗎」）：耳麥（隨時待命、跟小幫手通話）、右眼 HUD 鏡片（看資料）、
# 帽頂鈕扣變成訊號燈、背包加天線（工具包連線中）。帽子、背包、主色保留（BRAND.md）。

def bird(eyes='open', cap=False, pack=True, wave=True, tail=True, agent=True):  # 2026-11-20 Austin：不要帽子（招牌改成耳麥）
    c = C; g = []
    if tail:
        g.append(f'<path d="M24 20 Q50 30 60 54 L49 59 Q40 40 18 31 Z" fill="{c["tail"]}"/>')
        g.append(f'<path d="M60 54 L49 59 L54 68 L65 63 Z" fill="#FFFFFF" stroke="{c["tail"]}" stroke-width="1.5"/>')
    if pack:
        g.append(f'<rect x="34" y="-10" width="28" height="38" rx="9" fill="{c["teal"]}"/>'
                 f'<rect x="44" y="-3" width="14" height="9" rx="3" fill="{c["mint"]}"/>'
                 f'<circle cx="49" cy="16" r="3.5" fill="{c["yellow"]}"/><circle cx="57" cy="22" r="3.5" fill="{c["coral"]}"/>')
        if agent:  # 背包天線：工具包連線中
            g.append(f'<path d="M56 -10 L62 -30" stroke="{c["navy"]}" stroke-width="2.5" stroke-linecap="round"/><circle cx="62" cy="-31" r="3.5" fill="{c["glow"]}"/>')
    g.append(f'<circle cx="0" cy="0" r="46" fill="{c["blue"]}"/>')
    g.append(f'<path d="M-46 -2 A46 46 0 0 1 46 -2 Q30 -14 0 -14 Q-30 -14 -46 -2 Z" fill="{c["navy"]}"/>')
    g.append(f'<ellipse cx="0" cy="20" rx="28" ry="22" fill="{c["belly"]}"/>')
    if eyes == 'open':
        g.append(f'<circle cx="-15" cy="-6" r="8" fill="#FFF"/><circle cx="15" cy="-6" r="8" fill="#FFF"/>'
                 f'<circle cx="-13" cy="-5" r="4.5" fill="{c["navy"]}"/><circle cx="17" cy="-5" r="4.5" fill="{c["navy"]}"/>'
                 '<circle cx="-11.5" cy="-7" r="1.5" fill="#FFF"/><circle cx="18.5" cy="-7" r="1.5" fill="#FFF"/>')
    elif eyes == 'happy':
        g.append('<path d="M-21 -6 Q-15 -12 -9 -6" fill="none" stroke="#FFF" stroke-width="3.5" stroke-linecap="round"/>'
                 '<path d="M9 -6 Q15 -12 21 -6" fill="none" stroke="#FFF" stroke-width="3" stroke-linecap="round"/>')
    elif eyes == 'think':
        g.append(f'<circle cx="-15" cy="-6" r="8" fill="#FFF"/><circle cx="15" cy="-6" r="8" fill="#FFF"/>'
                 f'<circle cx="-12" cy="-9" r="4.5" fill="{c["navy"]}"/><circle cx="18" cy="-9" r="4.5" fill="{c["navy"]}"/>'
                 + ('' if agent else f'<circle cx="-58" cy="-44" r="4" fill="{c["navy"]}" opacity=".35"/><circle cx="-68" cy="-58" r="6" fill="{c["navy"]}" opacity=".35"/>'))
    if agent:  # 右眼 HUD 鏡片：半透明青色，邊框與小刻度（看得到資料）
        g.append(f'<rect x="3" y="-19" width="27" height="22" rx="7" fill="#FFFFFF" fill-opacity=".18"/>'
                 f'<rect x="3" y="-19" width="27" height="22" rx="7" fill="{c["glow"]}" fill-opacity=".28" stroke="{c["deep"]}" stroke-width="3"/>'
                 f'<path d="M30 -12 L40 -16" stroke="{c["teal"]}" stroke-width="2.5" stroke-linecap="round"/>')
        if eyes == 'think':  # 查詢中：鏡片上跑一條進度
            g.append(f'<rect x="8" y="-3" width="17" height="3.5" rx="1.7" fill="{c["deep"]}" opacity=".3"/><rect x="8" y="-3" width="10" height="3.5" rx="1.7" fill="{c["glow"]}"/>')
        if eyes == 'happy':  # 完成：鏡片上打勾
            g.append(f'<path d="M10 -9 L15 -4 L23 -13" fill="none" stroke="{c["teal"]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>')
    g.append(f'<path d="M-6 4 L6 4 L0 13 Z" fill="{c["red"]}"/>')
    g.append(f'<circle cx="-27" cy="8" r="6" fill="{c["blush"]}"/><circle cx="27" cy="8" r="6" fill="{c["blush"]}"/>')
    if agent:  # 冠羽（招牌，2026-11-20 Austin：「鳥類最漂亮的應是他的冠」）：三根往後梳、前長後短的冠羽（不加光點，Austin：頭上不需要光點）
        g.append(f'<path d="M-6 -44 C-10 -64 4 -80 26 -76 C12 -70 6 -58 6 -44 Z" fill="{c["navy"]}"/>'
                 f'<path d="M4 -44 C4 -60 16 -68 32 -64 C20 -60 15 -53 14 -42 Z" fill="#4A90D9"/>'  # 中間提亮、後面縮短（PR #31 設計審查：小尺寸才分得出層次）
                 f'<path d="M14 -42 C17 -52 26 -57 37 -52 C28 -50 24 -45 21 -39 Z" fill="{c["navy"]}"/>')
        # 耳麥：左耳罩（指示燈）、麥克風桿到嘴邊（不用頭帶，冠羽露出來）
        g.append(
                 f'<rect x="-54" y="-18" width="16" height="24" rx="7" fill="{c["deep"]}"/><rect x="-50" y="-13" width="8" height="14" rx="4" fill="{c["glow"]}"/>'
                 f'<path d="M-46 4 Q-40 20 -16 17" fill="none" stroke="{c["deep"]}" stroke-width="3.5" stroke-linecap="round"/><circle cx="-15" cy="17" r="4" fill="{c["deep"]}"/>')
    if cap:
        g.append(f'<path d="M-26 -42 Q0 -70 26 -42 Z" fill="{c["teal"]}"/><rect x="-30" y="-46" width="60" height="10" rx="5" fill="{c["teal"]}"/>'
                 f'<rect x="16" y="-44" width="26" height="7" rx="3.5" fill="{c["teal"]}"/><circle cx="0" cy="-60" r="3.5" fill="{c["yellow"]}"/>')
        if agent:  # 帽頂指示燈（鈕扣發光、外圈光暈）＋帽沿 LED 燈條：待命中的 agent（2026-11-20 改：拿掉像 Wi-Fi 的訊號弧線）
            g.append(f'<circle cx="0" cy="-60" r="8" fill="{c["glow"]}" opacity=".35"/><circle cx="0" cy="-60" r="4.5" fill="{c["glow"]}"/><circle cx="-1.3" cy="-61.3" r="1.5" fill="#FFF"/>'
                     f'<rect x="-24" y="-42.5" width="48" height="3" rx="1.5" fill="{c["glow"]}" opacity=".9"/>')
    if wave:
        g.append(f'<path d="M-44 8 Q-64 -6 -58 -26" fill="none" stroke="{c["blue"]}" stroke-width="10" stroke-linecap="round"/>')
    else:
        g.append(f'<path d="M-42 10 Q-54 20 -46 32" fill="none" stroke="{c["blue"]}" stroke-width="10" stroke-linecap="round"/>')
    g.append(f'<path d="M-10 44 L-12 54 M10 44 L12 54" stroke="{c["red"]}" stroke-width="4" stroke-linecap="round"/>')
    return '\n  '.join(g)

# ---- App 圖示：Λ 標誌（C2，2026-11-21 產品負責人決定：App 圖示不用藍鵲，改用比較有科技感的標誌；藍鵲留在 App 內當吉祥物）----
# 畫布 512×512：品牌青綠漸層底＋中下方光暈、亮白薄荷色的 Λ（Abang 的 A）、琥珀色發光核心、一圈軌道（右上一段亮弧）。
I = dict(bg0='#0B3B39', bg1='#0F766E', bg2='#14A396', glow='#5EEAD4', mint='#CCFBF1', ring='#99F6E4', core='#FBBF24', halo='#FDE68A')
ICON_RX = 111   # 圓角（PWA／favicon），約 21.7%
ADAPT = 2 / 3   # Android 自適應圖示：108dp 畫布只露出中間 72dp，內容縮成 2/3 後，遮罩裁出來的畫面與 iOS 方形圖示相同
MONO = 0.72     # 主題單色圖示：沒有軌道，Λ 放大一點（約 39×44dp，仍在 66dp 安全區內）

def icon_bg(p, rx=0, x0=0.0, size=512.0):
    """漸層底＋光暈。x0、size＝漸層對齊的方框（一般圖示是整張；自適應背景對齊中間露出的 72dp）。p＝id 前綴（同頁放多張不撞名）。"""
    n = lambda v: f'{v:.1f}'.rstrip('0').rstrip('.')
    r = f' rx="{rx}"' if rx else ''
    return (f'<defs><linearGradient id="{p}-g" gradientUnits="userSpaceOnUse" x1="{n(x0)}" y1="{n(x0)}" x2="{n(x0 + size)}" y2="{n(x0 + size)}">'
            f'<stop offset="0" stop-color="{I["bg0"]}"/><stop offset=".6" stop-color="{I["bg1"]}"/><stop offset="1" stop-color="{I["bg2"]}"/></linearGradient>'
            f'<radialGradient id="{p}-h" gradientUnits="userSpaceOnUse" cx="{n(x0 + size * .5)}" cy="{n(x0 + size * .62)}" r="{n(size * .5)}">'
            f'<stop offset="0" stop-color="{I["glow"]}" stop-opacity=".55"/><stop offset="1" stop-color="{I["glow"]}" stop-opacity="0"/></radialGradient></defs>\n'
            f'<rect width="512" height="512"{r} fill="url(#{p}-g)"/><rect width="512" height="512"{r} fill="url(#{p}-h)"/>\n')

def mark(p, orbit=True, mono=None):
    """Λ＋核心（＋軌道）。mono＝單色剪影的顏色（不畫核心外的光圈、不用漸層）。"""
    g = []
    if orbit:
        g.append(f'<circle cx="256" cy="262" r="176" fill="none" stroke="{I["ring"]}" stroke-opacity=".28" stroke-width="5"/>')
        g.append(f'<circle cx="256" cy="262" r="176" fill="none" stroke="{I["mint"]}" stroke-width="8" stroke-linecap="round" stroke-dasharray="150 956" transform="rotate(-60 256 262)"/>')
    stroke = mono or f'url(#{p}-s)'
    g.append(f'<path d="M150 384 L256 136 L362 384" fill="none" stroke="{stroke}" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>')
    g.append(f'<circle cx="256" cy="330" r="30" fill="{mono or I["core"]}"/>')
    if not mono:
        g.append(f'<circle cx="256" cy="330" r="46" fill="none" stroke="{I["halo"]}" stroke-opacity=".5" stroke-width="6"/>')
    defs = '' if mono else (f'<defs><linearGradient id="{p}-s" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="{I["mint"]}"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient></defs>\n')
    return defs + '\n'.join(g) + '\n'

def icon(title, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="{title}">\n<title>{title}</title>\n{body}</svg>\n'

def fit(inner, k, cy=256.0):
    """把標誌縮成 k 倍放回畫布正中央（cy＝原本的垂直中心）。"""
    return f'<g transform="translate({256 - 256 * k:.2f} {256 - cy * k:.2f}) scale({k:.4f})">\n{inner}</g>\n'

def svg(inner, title, tx=118, ty=124, sc=1.25, bg=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="{title}">\n'
            f'<title>{title}</title>\n{bg}<g transform="translate({tx} {ty}) scale({sc})">\n  {inner}\n</g>\n</svg>\n')

FILES = {
    'abang-default.svg': svg(bird('open'), '阿幫（預設：揮手）'),
    'abang-happy.svg': svg(bird('happy', wave=False), '阿幫（開心）'),
    'abang-think.svg': svg(bird('think', wave=False), '阿幫（查詢中）'),
    # App 圖示（Abang）＝ Λ 標誌：圓角（PWA／favicon）、方形不透明（iOS、maskable、apple-touch-icon）
    'icon.svg': icon('Abang App 圖示', icon_bg('i', rx=ICON_RX) + mark('i')),
    'icon-square.svg': icon('Abang App 圖示', icon_bg('q') + mark('q')),
    # Android 自適應圖示（scripts/build-icons.js 轉 PNG）：前景只有 Λ＋核心＋軌道（離中心最遠約 26dp，在 66dp 安全區的 33dp 半徑內，圓形與各種遮罩都裁不到）；背景是漸層＋光暈
    'icon-fg.svg': icon('Abang App 圖示前景', fit(mark('f'), ADAPT)),
    'icon-bg.svg': icon('Abang App 圖示背景', icon_bg('b', x0=256 - 256 * ADAPT, size=512 * ADAPT)),
    # 單色剪影（Λ＋核心）：Android 13+ 主題圖示、通知小圖示
    'icon-mono.svg': icon('Abang App 圖示（單色）', fit(mark('m', orbit=False, mono='#000000'), MONO, cy=260)),
}
if __name__ == '__main__':
    out = ROOT / 'public' / 'brand'; out.mkdir(parents=True, exist_ok=True)
    for name, content in FILES.items():
        (out / name).write_text(content, encoding='utf-8')
    (ROOT / 'public' / 'icons' / 'icon.svg').write_text(FILES['icon.svg'], encoding='utf-8')
    print('written:', ', '.join(FILES))
