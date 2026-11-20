# 公車街景素材（Blender 4.5，低多邊形）：給公車頁「公車還有幾站到你這」的街景示意用。
# 執行：Blender --background --factory-startup --python scripts/blender/bus-scene.py -- public/img/scene
# 輸出（同一台正交相機、同樣畫布大小，網頁直接疊起來）：
#   street.png 路、人行道、站牌與候車亭、樹與房子（背景）
#   bus.png    公車（世界座標 x=0，朝 +x 往站牌開）；網頁依站數左右平移
#   scene.json 畫布大小、世界 x 每 +1 在畫面上移幾像素、站牌牌面位置、公車停靠時的 x
# 幾何全部在這裡用程式建，不用外部模型。品牌色 #0f766e（docs/BRAND.md）。
import bpy, math, sys, os, json
from bpy_extras.object_utils import world_to_camera_view

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'public/img/scene'
os.makedirs(out, exist_ok=True)
W_PX, H_PX, ORTHO = 960, 420, 21.0
TARGET = (2.0, 1.0, 0.8)
STOP_X = 7.0          # 站牌位置
BUS_STOP_AT = 3.2     # 公車停靠時車身中心的 x（車頭剛好到站牌前）

def lin(h):
    h = h.lstrip('#')
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)) + (1.0,)

def mat(name, color, rough=0.6, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(color)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = lin(emit)
        b.inputs['Emission Strength'].default_value = 1.2
    return m

def box(size, loc, m, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width, mod.segments = bevel, 3
    o.data.materials.append(m)
    return o

def cyl(r, depth, loc, m, rot=(0, 0, 0), verts=20, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    return o

def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras):
        for x in list(c):
            c.remove(x)

def setup(shadow_ground=True):
    s = bpy.context.scene
    s.render.engine = 'CYCLES'  # EEVEE 不支援透明背景上的「只接陰影」地面
    s.cycles.samples, s.cycles.use_denoising, s.cycles.device = 48, True, 'CPU'
    s.render.film_transparent = True
    s.render.resolution_x, s.render.resolution_y = W_PX, H_PX
    s.render.image_settings.file_format = 'PNG'
    s.render.image_settings.color_mode = 'RGBA'
    s.render.image_settings.compression = 100
    s.view_settings.view_transform = 'Standard'  # 品牌色不要被 Filmic／AgX 洗淡
    # 相機：正交，從前方略偏右上看（路大致水平，公車由左往右開向站牌）
    loc = (TARGET[0] + 5, TARGET[1] - 16, TARGET[2] + 10)
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object
    cam.data.type, cam.data.ortho_scale = 'ORTHO', ORTHO
    d = [TARGET[i] - loc[i] for i in range(3)]
    cam.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)
    s.camera = cam
    bpy.ops.object.light_add(type='SUN', location=(0, 0, 10), rotation=(math.radians(38), math.radians(-25), math.radians(20)))
    bpy.context.object.data.energy = 2.0
    bpy.context.object.data.angle = math.radians(10)
    w = s.world or bpy.data.worlds.new('w')
    s.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.92, 0.96, 1.0, 1)
    bg.inputs['Strength'].default_value = 0.55
    if shadow_ground:  # 只接陰影的地面：透明背景上也有落地陰影
        bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0.001))
        bpy.context.object.is_shadow_catcher = True
    return cam

def render(name):
    bpy.context.scene.render.filepath = os.path.join(out, name)
    bpy.ops.render.render(write_still=True)

def px(cam, p):
    v = world_to_camera_view(bpy.context.scene, cam, __import__('mathutils').Vector(p))
    return [round(v.x * W_PX, 1), round((1 - v.y) * H_PX, 1)]

BRAND = '#0f766e'

# ── 背景：路、人行道、站牌、候車亭、樹、房子 ──
reset()
cam = setup(shadow_ground=False)
box((80, 40, 0.02), (0, 6, -0.01), mat('ground', '#cfe3d6', 0.95))  # 街景有自己的地面（不透明）
asphalt, curb, dash = mat('asphalt', '#7d8a87', 0.95), mat('curb', '#eef1f0', 0.7), mat('dash', '#ffffff', 0.6)
grass = mat('grass', '#b9dcc4', 0.9)
box((60, 4.6, 0.08), (0, -0.9, 0.04), asphalt)
box((60, 2.2, 0.24), (0, 2.5, 0.12), curb, bevel=0.03)
box((60, 3.0, 0.1), (0, 5.1, 0.05), grass)
for i in range(-14, 15):
    box((1.3, 0.16, 0.02), (i * 2.2, -0.9, 0.09), dash)
pole, sign, white = mat('pole', '#5d6966', 0.4, 0.5), mat('sign', BRAND, 0.35), mat('white', '#ffffff', 0.5)
roofm, glassm, bench = mat('shelter', '#f4f6f5', 0.4), mat('sglass', '#9fd0c7', 0.15), mat('bench', '#b45309', 0.6)
cyl(0.08, 3.8, (STOP_X, 1.75, 1.9), pole)
box((0.14, 1.3, 0.85), (STOP_X, 1.75, 3.45), sign, bevel=0.08)
box((0.16, 0.8, 0.14), (STOP_X, 1.75, 3.6), white, bevel=0.03)
box((0.16, 0.55, 0.1), (STOP_X, 1.75, 3.33), white, bevel=0.03)
box((3.0, 1.5, 0.16), (STOP_X + 2.3, 2.85, 2.75), roofm, bevel=0.05)
box((2.9, 0.08, 2.1), (STOP_X + 2.3, 3.55, 1.7), glassm, bevel=0.03)
for x in (STOP_X + 0.9, STOP_X + 3.7):
    box((0.12, 0.12, 2.6), (x, 3.5, 1.4), pole)
box((2.0, 0.5, 0.14), (STOP_X + 2.3, 3.2, 0.62), bench, bevel=0.03)
leaf, trunk = mat('leaf', '#5fae7b', 0.8), mat('trunk', '#8a6a4f', 0.8)
for x in (-9, -2.5, 13.5):  # 低多邊形樹
    cyl(0.16, 1.2, (x, 4.6, 0.65), trunk, verts=8)
    cyl(1.0, 2.2, (x, 4.6, 2.3), leaf, verts=7, r2=0.0)
for x, h, c in ((-13, 1.8, '#b8c7d9'), (-6, 2.2, '#dcc6ad'), (1, 1.6, '#b9d3cd'), (17, 2.0, '#dcc6ad')):  # 遠方房子
    box((5.2, 3.2, h), (x, 7.6, h / 2), mat(f'b{x}', c, 0.8), bevel=0.06)
render('street.png')
meta = {
    'w': W_PX, 'h': H_PX,
    'unit': [round(a - b, 3) for a, b in zip(px(cam, (1, -0.9, 0)), px(cam, (0, -0.9, 0)))],  # 世界 x +1 在畫面上的位移
    'sign': px(cam, (STOP_X, 1.75, 4.0)),          # 站牌牌面上緣（放站名）
    'busStopAt': BUS_STOP_AT,
    'busLabel': px(cam, (0, -0.9, 3.6)),           # 公車 x=0 時車頂上方（放「還有 N 站」）
}

# ── 公車（x=0；只畫車，陰影一起算進來）──
reset()
setup()
body, roof, glass = mat('body', BRAND, 0.35), mat('roof', '#e7f3f1', 0.5), mat('glass', '#1d3b4f', 0.08, 0.2)
stripe, tyre, hub = mat('stripe', '#fbbf24', 0.4), mat('tyre', '#1f2a2c', 0.8), mat('hub', '#cfd8dc', 0.3, 0.6)
lamp = mat('lamp', '#fff7d6', 0.2, emit='#fff1b8')
L, Wd, H, z0, y0 = 6.0, 2.3, 2.3, 0.5, -0.9
box((L, Wd, H), (0, y0, z0 + H / 2), body, bevel=0.25)
box((L - 0.7, Wd - 0.5, 0.24), (0, y0, z0 + H + 0.08), roof, bevel=0.1)
box((L + 0.02, Wd + 0.02, 0.2), (0, y0, z0 + 0.5), stripe, bevel=0.05)
for i in range(4):  # 側窗（朝相機那側與另一側）
    x = -2.2 + i * 1.15
    for y in (y0 - Wd / 2, y0 + Wd / 2):
        box((0.95, 0.06, 0.95), (x, y, z0 + 1.55), glass, bevel=0.06)
box((0.06, Wd - 0.4, 1.2), (L / 2, y0, z0 + 1.5), glass, bevel=0.06)          # 擋風玻璃（車頭朝 +x）
box((0.95, 0.07, 1.7), (2.15, y0 - Wd / 2, z0 + 0.95), glass, bevel=0.05)      # 車門
box((0.07, 1.25, 0.32), (L / 2 + 0.01, y0, z0 + 2.12), lamp, bevel=0.04)       # 路線牌
for y in (y0 + 0.75, y0 - 0.75):
    box((0.07, 0.35, 0.22), (L / 2 + 0.01, y, z0 + 0.45), lamp, bevel=0.04)    # 車燈
for x in (-1.9, 1.9):
    for y in (y0 - Wd / 2 + 0.1, y0 + Wd / 2 - 0.1):
        cyl(0.5, 0.4, (x, y, 0.5), tyre, rot=(math.pi / 2, 0, 0))
        cyl(0.24, 0.42, (x, y, 0.5), hub, rot=(math.pi / 2, 0, 0))
render('bus.png')

with open(os.path.join(out, 'scene.json'), 'w') as f:
    json.dump(meta, f)
print('done', out, meta)
