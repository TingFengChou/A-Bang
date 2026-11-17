#!/usr/bin/env python3
"""阿幫吉祥物與圖示產生器（單一來源）。輸出到 public/brand/ 與 public/icons/icon.svg。
正式版請由插畫師重繪；此檔維持顏色與比例規範一致。"""
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
C = dict(blue='#3B82C4', tail='#2E6FB7', navy='#1F2A44', belly='#EAF3FB', red='#E24B4A',
         blush='#F4C0D1', teal='#0F766E', mint='#E1F5EE', yellow='#FBBF24', coral='#F0997B')

def bird(eyes='open', cap=True, pack=True, wave=True, tail=True):
    c = C; g = []
    if tail:
        g.append(f'<path d="M24 20 Q50 30 60 54 L49 59 Q40 40 18 31 Z" fill="{c["tail"]}"/>')
        g.append(f'<path d="M60 54 L49 59 L54 68 L65 63 Z" fill="#FFFFFF" stroke="{c["tail"]}" stroke-width="1.5"/>')
    if pack:
        g.append(f'<rect x="34" y="-10" width="28" height="38" rx="9" fill="{c["teal"]}"/>'
                 f'<rect x="44" y="-3" width="14" height="9" rx="3" fill="{c["mint"]}"/>'
                 f'<circle cx="49" cy="16" r="3.5" fill="{c["yellow"]}"/><circle cx="57" cy="22" r="3.5" fill="{c["coral"]}"/>')
    g.append(f'<circle cx="0" cy="0" r="46" fill="{c["blue"]}"/>')
    g.append(f'<path d="M-46 -2 A46 46 0 0 1 46 -2 Q30 -14 0 -14 Q-30 -14 -46 -2 Z" fill="{c["navy"]}"/>')
    g.append(f'<ellipse cx="0" cy="20" rx="28" ry="22" fill="{c["belly"]}"/>')
    if eyes == 'open':
        g.append(f'<circle cx="-15" cy="-6" r="8" fill="#FFF"/><circle cx="15" cy="-6" r="8" fill="#FFF"/>'
                 f'<circle cx="-13" cy="-5" r="4.5" fill="{c["navy"]}"/><circle cx="17" cy="-5" r="4.5" fill="{c["navy"]}"/>'
                 '<circle cx="-11.5" cy="-7" r="1.5" fill="#FFF"/><circle cx="18.5" cy="-7" r="1.5" fill="#FFF"/>')
    elif eyes == 'happy':
        g.append('<path d="M-21 -6 Q-15 -12 -9 -6" fill="none" stroke="#FFF" stroke-width="3" stroke-linecap="round"/>'
                 '<path d="M9 -6 Q15 -12 21 -6" fill="none" stroke="#FFF" stroke-width="3" stroke-linecap="round"/>')
    elif eyes == 'think':
        g.append(f'<circle cx="-15" cy="-6" r="8" fill="#FFF"/><circle cx="15" cy="-6" r="8" fill="#FFF"/>'
                 f'<circle cx="-12" cy="-9" r="4.5" fill="{c["navy"]}"/><circle cx="18" cy="-9" r="4.5" fill="{c["navy"]}"/>'
                 f'<circle cx="-58" cy="-44" r="4" fill="{c["navy"]}" opacity=".35"/><circle cx="-68" cy="-58" r="6" fill="{c["navy"]}" opacity=".35"/>')
    g.append(f'<path d="M-6 4 L6 4 L0 13 Z" fill="{c["red"]}"/>')
    g.append(f'<circle cx="-27" cy="8" r="6" fill="{c["blush"]}"/><circle cx="27" cy="8" r="6" fill="{c["blush"]}"/>')
    if cap:
        g.append(f'<path d="M-26 -42 Q0 -70 26 -42 Z" fill="{c["teal"]}"/><rect x="-30" y="-46" width="60" height="10" rx="5" fill="{c["teal"]}"/>'
                 f'<rect x="16" y="-44" width="26" height="7" rx="3.5" fill="{c["teal"]}"/><circle cx="0" cy="-60" r="3.5" fill="{c["yellow"]}"/>')
    if wave:
        g.append(f'<path d="M-44 8 Q-64 -6 -58 -26" fill="none" stroke="{c["blue"]}" stroke-width="10" stroke-linecap="round"/>')
    else:
        g.append(f'<path d="M-42 10 Q-54 20 -46 32" fill="none" stroke="{c["blue"]}" stroke-width="10" stroke-linecap="round"/>')
    g.append(f'<path d="M-10 44 L-12 54 M10 44 L12 54" stroke="{c["red"]}" stroke-width="4" stroke-linecap="round"/>')
    return '\n  '.join(g)

def svg(inner, title, tx=118, ty=124, sc=1.25, bg=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="{title}">\n'
            f'<title>{title}</title>\n{bg}<g transform="translate({tx} {ty}) scale({sc})">\n  {inner}\n</g>\n</svg>\n')

FILES = {
    'abang-default.svg': svg(bird('open'), '阿幫（預設：揮手）'),
    'abang-happy.svg': svg(bird('happy', wave=False), '阿幫（開心）'),
    'abang-think.svg': svg(bird('think', wave=False), '阿幫（查詢中）'),
    'icon.svg': svg(bird('open', pack=False, tail=False), '阿幫 App 圖示', tx=120, ty=130, sc=1.3,
                    bg=f'<rect width="240" height="240" rx="52" fill="{C["mint"]}"/>\n'),
}
if __name__ == '__main__':
    out = ROOT / 'public' / 'brand'; out.mkdir(parents=True, exist_ok=True)
    for name, content in FILES.items():
        (out / name).write_text(content, encoding='utf-8')
    (ROOT / 'public' / 'icons' / 'icon.svg').write_text(FILES['icon.svg'], encoding='utf-8')
    print('written:', ', '.join(FILES))
