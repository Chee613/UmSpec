import os
import math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUTPUT_DIR = r'c:\Users\Chee\Documents\UmSpec\store_assets'
os.makedirs(OUTPUT_DIR, exist_ok=True)

USER_MODAL_PATH = r'C:\Users\Chee\.gemini\antigravity-ide\brain\8c23fd63-37c2-481a-a759-b4ad9a088df4\.user_uploaded\media_1791388969136.png'
ICON_PATH = r'c:\Users\Chee\Documents\UmSpec\icons\icon128.png'

# Fonts helper
def get_font(size, bold=False):
    font_name = "segoeuib.ttf" if bold else "segoeui.ttf"
    font_path = os.path.join(r"C:\Windows\Fonts", font_name)
    if os.path.exists(font_path):
        return ImageFont.truetype(font_path, size)
    alt_name = "arialbd.ttf" if bold else "arial.ttf"
    alt_path = os.path.join(r"C:\Windows\Fonts", alt_name)
    if os.path.exists(alt_path):
        return ImageFont.truetype(alt_path, size)
    return ImageFont.load_default()

def create_gradient_bg(w, h, top_color, bottom_color, add_glow=True, glow_center=(920, 400), glow_radius=480, glow_color=(37, 99, 235)):
    base = Image.new('RGB', (w, h))
    draw = ImageDraw.Draw(base)
    for y in range(h):
        t = y / (h - 1)
        r = int(top_color[0] + (bottom_color[0] - top_color[0]) * t)
        g = int(top_color[1] + (bottom_color[1] - top_color[1]) * t)
        b = int(top_color[2] + (bottom_color[2] - top_color[2]) * t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))
    
    if add_glow:
        glow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow)
        cx, cy = glow_center
        for r_step in range(glow_radius, 0, -8):
            alpha = int(75 * (1.0 - (r_step / glow_radius)**1.6))
            glow_draw.ellipse([cx - r_step, cy - r_step, cx + r_step, cy + r_step],
                              fill=(glow_color[0], glow_color[1], glow_color[2], alpha))
        glow = glow.filter(ImageFilter.GaussianBlur(35))
        base = Image.alpha_composite(base.convert('RGBA'), glow).convert('RGB')
        
    return base

def extract_clean_modal():
    im = Image.open(USER_MODAL_PATH).convert('RGBA')
    # Bounding box of the modal card
    card = im.crop((122, 86, 636, 875))
    cw, ch = card.size
    
    mask = Image.new('L', (cw, ch), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle((0, 0, cw, ch), radius=22, fill=255)
    
    card.putalpha(mask)
    return card

def add_drop_shadow(canvas, img_rgba, x, y, shadow_blur=35, shadow_offset=(0, 15), shadow_color=(0, 0, 0, 190)):
    sw, sh = img_rgba.size
    shadow = Image.new('RGBA', (sw + shadow_blur * 4, sh + shadow_blur * 4), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.rounded_rectangle((shadow_blur * 2 + shadow_offset[0], 
                             shadow_blur * 2 + shadow_offset[1], 
                             shadow_blur * 2 + shadow_offset[0] + sw, 
                             shadow_blur * 2 + shadow_offset[1] + sh), 
                            radius=24, fill=shadow_color)
    shadow = shadow.filter(ImageFilter.GaussianBlur(shadow_blur))
    
    canvas_rgba = canvas.convert('RGBA')
    canvas_rgba.alpha_composite(shadow, (x - shadow_blur * 2, y - shadow_blur * 2))
    canvas_rgba.alpha_composite(img_rgba, (x, y))
    return canvas_rgba.convert('RGB')

def draw_icon_badge(badge_type, theme_color=(59, 130, 246)):
    badge = Image.new('RGBA', (36, 36), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(badge)
    bg_col = (theme_color[0]//5, theme_color[1]//5, theme_color[2]//5, 230)
    border_col = (theme_color[0], theme_color[1], theme_color[2], 220)
    bdraw.rounded_rectangle((0, 0, 35, 35), radius=9, fill=bg_col, outline=border_col, width=1)
    
    col = (255, 255, 255, 245)
    if badge_type == 'bolt':
        pts = [(20, 6), (12, 18), (18, 18), (15, 30), (25, 16), (19, 16)]
        bdraw.polygon(pts, fill=col)
    elif badge_type == 'folder':
        bdraw.rounded_rectangle((8, 14, 28, 28), radius=2, fill=col)
        bdraw.rounded_rectangle((8, 10, 17, 15), radius=2, fill=col)
    elif badge_type == 'gamepad':
        bdraw.rounded_rectangle((8, 12, 28, 24), radius=5, fill=col)
        bdraw.rectangle((12, 16, 14, 20), fill=theme_color)
        bdraw.rectangle((10, 18, 16, 19), fill=theme_color)
        bdraw.ellipse((21, 15, 23, 17), fill=theme_color)
        bdraw.ellipse((24, 18, 26, 20), fill=theme_color)
    elif badge_type == 'shield':
        pts = [(18, 7), (28, 11), (28, 20), (18, 29), (8, 20), (8, 11)]
        bdraw.polygon(pts, fill=col)
        bdraw.line((18, 11, 18, 25), fill=theme_color, width=2)
    elif badge_type == 'cap':
        pts = [(18, 9), (29, 14), (18, 20), (7, 14)]
        bdraw.polygon(pts, fill=col)
        bdraw.rectangle((12, 18, 24, 23), fill=col)
        bdraw.line((27, 15, 27, 24), fill=col, width=2)
    elif badge_type == 'chart':
        bdraw.rectangle((9, 21, 12, 28), fill=col)
        bdraw.rectangle((16, 16, 19, 28), fill=col)
        bdraw.rectangle((23, 10, 26, 28), fill=col)
    elif badge_type == 'cancel':
        bdraw.ellipse((8, 8, 28, 28), outline=col, width=2)
        bdraw.line((13, 13, 23, 23), fill=col, width=2)
    elif badge_type == 'edit':
        pts = [(24, 8), (28, 12), (16, 26), (11, 26), (11, 21)]
        bdraw.polygon(pts, fill=col)
        
    return badge

# -------------------------------------------------------------
# SCREENSHOT 1: Main Overview & One-Click Batch Exporter
# -------------------------------------------------------------
def generate_screenshot_1():
    print("Generating Minimalist Screenshot 1 (Overview)...")
    canvas = create_gradient_bg(1280, 800, (11, 16, 26), (6, 9, 16), add_glow=True, glow_center=(960, 420), glow_color=(37, 99, 235))
    
    # Left Content Area (X: 80 to 620)
    draw = ImageDraw.Draw(canvas)
    
    # Category Pill
    pill_img = Image.new('RGBA', (1280, 800), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(pill_img)
    pdraw.rounded_rectangle((80, 110, 410, 146), radius=18, fill=(30, 41, 59, 200), outline=(59, 130, 246, 220), width=1)
    canvas = Image.alpha_composite(canvas.convert('RGBA'), pill_img).convert('RGB')
    draw = ImageDraw.Draw(canvas)
    
    f_pill = get_font(12, bold=True)
    draw.text((102, 119), "UNIVERSITI MALAYA • SPECTRUM COMPANION", font=f_pill, fill=(96, 165, 250))
    
    # Main Headline (Crisp, punchy, bold)
    f_h1 = get_font(48, bold=True)
    draw.text((80, 175), "One-Click Batch", font=f_h1, fill=(255, 255, 255))
    draw.text((80, 235), "Course Exporter", font=f_h1, fill=(96, 165, 250))
    
    # Clean minimalist feature pills (no verbose small descriptions)
    features = [
        ("bolt", "Zero-Touch Batch Download", (59, 130, 246)),
        ("folder", "Structured ZIP Folder Hierarchy", (16, 185, 129)),
        ("gamepad", "Built-In Dino Sync Engine", (249, 115, 22)),
        ("shield", "100% Client-Side & Private", (168, 85, 247))
    ]
    
    card_y = 350
    f_f_title = get_font(18, bold=True)
    
    for icon_type, title, col in features:
        card_rect = (80, card_y, 570, card_y + 58)
        c_layer = Image.new('RGBA', (1280, 800), (0, 0, 0, 0))
        cdraw = ImageDraw.Draw(c_layer)
        cdraw.rounded_rectangle(card_rect, radius=14, fill=(17, 24, 39, 180), outline=(37, 49, 70, 190), width=1)
        
        # Draw badge icon
        badge = draw_icon_badge(icon_type, theme_color=col)
        c_layer.alpha_composite(badge, (96, card_y + 11))
        
        canvas = Image.alpha_composite(canvas.convert('RGBA'), c_layer).convert('RGB')
        draw = ImageDraw.Draw(canvas)
        
        draw.text((148, card_y + 16), title, font=f_f_title, fill=(243, 244, 246))
        
        card_y += 74
        
    # Floating Modal on right side
    card = extract_clean_modal()
    card_w = 468
    card_h = int(card.height * (card_w / card.width))
    card_resized = card.resize((card_w, card_h), Image.Resampling.LANCZOS)
    canvas = add_drop_shadow(canvas, card_resized, 715, 42, shadow_blur=40, shadow_offset=(0, 20), shadow_color=(0, 0, 0, 220))
    
    out_path = os.path.join(OUTPUT_DIR, 'screenshot1_overview_1280x800.png')
    canvas.save(out_path, format='PNG')
    print("Saved:", out_path)

# -------------------------------------------------------------
# SCREENSHOT 2: Chrome Dino Runner & Telemetry
# -------------------------------------------------------------
def generate_screenshot_2():
    print("Generating Minimalist Screenshot 2 (Dino Runner)...")
    canvas = create_gradient_bg(1280, 800, (18, 16, 28), (9, 9, 18), add_glow=True, glow_center=(940, 410), glow_color=(234, 88, 12))
    draw = ImageDraw.Draw(canvas)
    
    # Pill Badge
    pill_img = Image.new('RGBA', (1280, 800), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(pill_img)
    pdraw.rounded_rectangle((80, 110, 380, 146), radius=18, fill=(30, 24, 45, 200), outline=(249, 115, 22, 220), width=1)
    canvas = Image.alpha_composite(canvas.convert('RGBA'), pill_img).convert('RGB')
    draw = ImageDraw.Draw(canvas)
    
    f_pill = get_font(12, bold=True)
    draw.text((102, 119), "LIVE PROGRESS & ENTERTAINMENT", font=f_pill, fill=(251, 146, 60))
    
    # Title
    f_h1 = get_font(48, bold=True)
    draw.text((80, 175), "Built-In Dino Runner", font=f_h1, fill=(255, 255, 255))
    draw.text((80, 235), "& Live Telemetry", font=f_h1, fill=(251, 146, 60))
    
    # Clean minimalist feature pills (no verbose small descriptions)
    features = [
        ("gamepad", "Spacebar & Tap Jump Physics", (249, 115, 22)),
        ("chart", "Real-Time Distance & High Score", (234, 179, 8)),
        ("bolt", "Live Download Sync Telemetry", (59, 130, 246)),
        ("cancel", "Instant Cancel & One-Click Retry", (239, 68, 68))
    ]
    
    card_y = 350
    f_f_title = get_font(18, bold=True)
    
    for icon_type, title, col in features:
        card_rect = (80, card_y, 570, card_y + 58)
        c_layer = Image.new('RGBA', (1280, 800), (0, 0, 0, 0))
        cdraw = ImageDraw.Draw(c_layer)
        cdraw.rounded_rectangle(card_rect, radius=14, fill=(25, 20, 35, 180), outline=(55, 45, 65, 190), width=1)
        
        badge = draw_icon_badge(icon_type, theme_color=col)
        c_layer.alpha_composite(badge, (96, card_y + 11))
        
        canvas = Image.alpha_composite(canvas.convert('RGBA'), c_layer).convert('RGB')
        draw = ImageDraw.Draw(canvas)
        
        draw.text((148, card_y + 16), title, font=f_f_title, fill=(243, 244, 246))
        
        card_y += 74
        
    # Right Side: Centered Spotlight on Dino Runner and Telemetry
    card = extract_clean_modal()
    cw, ch = card.size
    
    dino_crop = card.crop((18, 440, cw - 18, 735))
    dw, dh = dino_crop.size
    scale = 1.12
    dino_zoomed = dino_crop.resize((int(dw * scale), int(dh * scale)), Image.Resampling.LANCZOS)
    dm_w, dm_h = dino_zoomed.size
    
    # Apply rounded corner mask to make it a standalone floating widget
    dmask = Image.new('L', (dm_w, dm_h), 0)
    ddraw = ImageDraw.Draw(dmask)
    ddraw.rounded_rectangle((0, 0, dm_w, dm_h), radius=16, fill=255)
    dino_zoomed.putalpha(dmask)
    
    # Add subtle glowing neon border
    border_layer = Image.new('RGBA', (dm_w, dm_h), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(border_layer)
    bdraw.rounded_rectangle((0, 0, dm_w - 1, dm_h - 1), radius=16, outline=(249, 115, 22, 180), width=2)
    dino_zoomed.alpha_composite(border_layer)
    
    # Background full modal placed subtly behind
    modal_scaled = card.resize((int(cw * 0.70), int(ch * 0.70)), Image.Resampling.LANCZOS)
    canvas = add_drop_shadow(canvas, modal_scaled, 830, 40, shadow_blur=30, shadow_color=(0, 0, 0, 180))
    
    # Prominent Dino showcase card in front
    canvas = add_drop_shadow(canvas, dino_zoomed, 670, 340, shadow_blur=40, shadow_offset=(0, 16), shadow_color=(0, 0, 0, 240))
    
    out_path = os.path.join(OUTPUT_DIR, 'screenshot2_dino_runner_1280x800.png')
    canvas.save(out_path, format='PNG')
    print("Saved:", out_path)

# -------------------------------------------------------------
# SCREENSHOT 3: Smart 16-Faculty Taxonomy & Clean Organization
# -------------------------------------------------------------
def generate_screenshot_3():
    print("Generating Minimalist Screenshot 3 (Smart Taxonomy)...")
    canvas = create_gradient_bg(1280, 800, (8, 22, 26), (5, 14, 18), add_glow=True, glow_center=(960, 420), glow_color=(13, 148, 136))
    draw = ImageDraw.Draw(canvas)
    
    # Pill Badge
    pill_img = Image.new('RGBA', (1280, 800), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(pill_img)
    pdraw.rounded_rectangle((80, 110, 415, 146), radius=18, fill=(15, 30, 35, 200), outline=(20, 184, 166, 220), width=1)
    canvas = Image.alpha_composite(canvas.convert('RGBA'), pill_img).convert('RGB')
    draw = ImageDraw.Draw(canvas)
    
    f_pill = get_font(12, bold=True)
    draw.text((102, 119), "INTELLIGENT CURRICULUM CLASSIFICATION", font=f_pill, fill=(45, 212, 191))
    
    # Title
    f_h1 = get_font(48, bold=True)
    draw.text((80, 175), "All 16 UM Faculties", font=f_h1, fill=(255, 255, 255))
    draw.text((80, 235), "Fully Supported", font=f_h1, fill=(45, 212, 191))
    
    # Clean minimalist feature pills (no verbose small descriptions)
    features = [
        ("cap", "Complete UM 16-Faculty Coverage", (20, 184, 166)),
        ("chart", "Smart Degree Disambiguation Engine", (59, 130, 246)),
        ("edit", "Inline Customizable Programme Title", (234, 179, 8)),
        ("folder", "Structured Academic Syllabus ZIP", (16, 185, 129))
    ]
    
    card_y = 330
    f_f_title = get_font(18, bold=True)
    
    for icon_type, title, col in features:
        card_rect = (80, card_y, 570, card_y + 58)
        c_layer = Image.new('RGBA', (1280, 800), (0, 0, 0, 0))
        cdraw = ImageDraw.Draw(c_layer)
        cdraw.rounded_rectangle(card_rect, radius=14, fill=(13, 27, 32, 180), outline=(22, 60, 68, 190), width=1)
        
        badge = draw_icon_badge(icon_type, theme_color=col)
        c_layer.alpha_composite(badge, (96, card_y + 11))
        
        canvas = Image.alpha_composite(canvas.convert('RGBA'), c_layer).convert('RGB')
        draw = ImageDraw.Draw(canvas)
        
        draw.text((148, card_y + 16), title, font=f_f_title, fill=(243, 244, 246))
        
        card_y += 72
        
    # Left bottom: Faculty pill tags cloud
    f_tag = get_font(12, bold=True)
    t_layer = Image.new('RGBA', (1280, 800), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(t_layer)
    
    row1 = ["FSKTM (CS & IT)", "Faculty of Engineering", "Faculty of Business"]
    row2 = ["Faculty of Science", "Faculty of Medicine", "Faculty of Law", "+ 10 More"]
    
    def render_tag_row(tags, start_x, start_y):
        cur_x = start_x
        for t in tags:
            tw = int(tdraw.textlength(t, font=f_tag)) + 22
            tdraw.rounded_rectangle((cur_x, start_y, cur_x + tw, start_y + 28), radius=14, 
                                    fill=(15, 30, 36, 210), outline=(20, 184, 166, 180), width=1)
            tdraw.text((cur_x + 11, start_y + 5), t, font=f_tag, fill=(204, 251, 241))
            cur_x += tw + 10
            
    render_tag_row(row1, 80, 642)
    render_tag_row(row2, 80, 680)
    canvas = Image.alpha_composite(canvas.convert('RGBA'), t_layer).convert('RGB')
    
    # Right Side Modal
    card = extract_clean_modal()
    card_w = 468
    card_h = int(card.height * (card_w / card.width))
    card_resized = card.resize((card_w, card_h), Image.Resampling.LANCZOS)
    canvas = add_drop_shadow(canvas, card_resized, 715, 42, shadow_blur=40, shadow_color=(0, 0, 0, 220))
    
    out_path = os.path.join(OUTPUT_DIR, 'screenshot3_smart_taxonomy_1280x800.png')
    canvas.save(out_path, format='PNG')
    print("Saved:", out_path)

# -------------------------------------------------------------
# SMALL PROMO TILE (440 x 280 Canvas, RGB, No Alpha)
# -------------------------------------------------------------
def generate_small_promo():
    print("Generating Minimalist Small Promo Tile (440x280)...")
    canvas = create_gradient_bg(440, 280, (15, 23, 42), (8, 12, 22), add_glow=True, glow_center=(350, 140), glow_radius=180, glow_color=(37, 99, 235))
    draw = ImageDraw.Draw(canvas)
    
    # App Icon
    if os.path.exists(ICON_PATH):
        icon = Image.open(ICON_PATH).convert('RGBA').resize((72, 72), Image.Resampling.LANCZOS)
        canvas_rgba = canvas.convert('RGBA')
        canvas_rgba.alpha_composite(icon, (35, 32))
        canvas = canvas_rgba.convert('RGB')
        draw = ImageDraw.Draw(canvas)
        
    # Title
    f_h1 = get_font(32, bold=True)
    draw.text((122, 34), "UmSpec", font=f_h1, fill=(255, 255, 255))
    
    f_tag = get_font(12, bold=True)
    draw.text((124, 76), "UNIVERSITI MALAYA", font=f_tag, fill=(96, 165, 250))
    
    # Large Headline
    f_h2 = get_font(24, bold=True)
    draw.text((35, 135), "Smart Course Exporter", font=f_h2, fill=(243, 244, 246))
    
    # Bottom Badge
    f_badge = get_font(12, bold=True)
    badge_rect = (35, 195, 310, 232)
    b_layer = Image.new('RGBA', (440, 280), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(b_layer)
    bdraw.rounded_rectangle(badge_rect, radius=14, fill=(30, 41, 59, 190), outline=(59, 130, 246, 200), width=1)
    bdraw.text((50, 204), "1-CLICK BATCH ZIP  •  DINO RUNNER", font=f_badge, fill=(147, 197, 253))
    canvas = Image.alpha_composite(canvas.convert('RGBA'), b_layer).convert('RGB')
    
    out_path = os.path.join(OUTPUT_DIR, 'small_promo_440x280.png')
    canvas.save(out_path, format='PNG')
    print("Saved:", out_path)

# -------------------------------------------------------------
# MARQUEE PROMO TILE (1400 x 560 Canvas, RGB, No Alpha)
# -------------------------------------------------------------
def generate_marquee_promo():
    print("Generating Minimalist Marquee Promo Tile (1400x560)...")
    canvas = create_gradient_bg(1400, 560, (11, 15, 25), (6, 9, 15), add_glow=True, glow_center=(1050, 280), glow_radius=400, glow_color=(37, 99, 235))
    draw = ImageDraw.Draw(canvas)
    
    # Icon + Title
    if os.path.exists(ICON_PATH):
        icon = Image.open(ICON_PATH).convert('RGBA').resize((96, 96), Image.Resampling.LANCZOS)
        canvas_rgba = canvas.convert('RGBA')
        canvas_rgba.alpha_composite(icon, (80, 80))
        canvas = canvas_rgba.convert('RGB')
        draw = ImageDraw.Draw(canvas)
        
    f_h1 = get_font(52, bold=True)
    draw.text((195, 80), "UmSpec", font=f_h1, fill=(255, 255, 255))
    
    f_pill = get_font(14, bold=True)
    draw.text((198, 142), "THE OFFICIAL SPECTRUM BATCH EXPORTER COMPANION", font=f_pill, fill=(96, 165, 250))
    
    # Main Headline
    f_h2 = get_font(38, bold=True)
    draw.text((80, 220), "Archive All Semester Courses in 1-Click.", font=f_h2, fill=(243, 244, 246))
    
    # Badges
    pills = ["100% Client-Side", "Smart Folder Sorting", "16 UM Faculties", "Dino Runner Sync"]
    f_p = get_font(15, bold=True)
    px, py = 80, 310
    p_layer = Image.new('RGBA', (1400, 560), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(p_layer)
    for p in pills:
        pw = int(pdraw.textlength(p, font=f_p)) + 28
        pdraw.rounded_rectangle((px, py, px + pw, py + 44), radius=16, fill=(30, 41, 59, 180), outline=(59, 130, 246, 180), width=1)
        pdraw.text((px + 14, py + 11), p, font=f_p, fill=(191, 219, 254))
        px += pw + 18
    canvas = Image.alpha_composite(canvas.convert('RGBA'), p_layer).convert('RGB')
    
    # Floating preview on the right
    card = extract_clean_modal()
    cw, ch = card.size
    scale = 0.58
    card_resized = card.resize((int(cw * scale), int(ch * scale)), Image.Resampling.LANCZOS)
    canvas = add_drop_shadow(canvas, card_resized, 980, 40, shadow_blur=35, shadow_color=(0, 0, 0, 200))
    
    out_path = os.path.join(OUTPUT_DIR, 'marquee_promo_1400x560.png')
    canvas.save(out_path, format='PNG')
    print("Saved:", out_path)

# -------------------------------------------------------------
# STORE ICON (128 x 128)
# -------------------------------------------------------------
def generate_store_icon():
    print("Verifying Store Icon (128x128)...")
    if os.path.exists(ICON_PATH):
        im = Image.open(ICON_PATH)
        out_path = os.path.join(OUTPUT_DIR, 'store_icon_128x128.png')
        im.resize((128, 128), Image.Resampling.LANCZOS).save(out_path, format='PNG')
        print("Saved:", out_path)

if __name__ == '__main__':
    generate_screenshot_1()
    generate_screenshot_2()
    generate_screenshot_3()
    generate_small_promo()
    generate_marquee_promo()
    generate_store_icon()
    print("All minimalist store assets regenerated successfully!")
